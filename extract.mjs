// Turns raw OCR text from Looker Studio screenshots into the catalog shape.
// Heuristics only: it prefills what is readable and leaves the rest empty.

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

// El diccionario es la autoridad: un campo de captura se mapea igual que uno
// importado desde CSV, para que ambos caminos hablen el mismo idioma.
const CONCEPTOS = new Map();
const ALIASES = new Map();
try {
  const archivo = [path.join(HERE, '..', 'datos', 'conceptos.json'), path.join(HERE, 'datos', 'conceptos.json')]
    .find((file) => existsSync(file));
  const dic = JSON.parse(readFileSync(archivo, 'utf8'));
  for (const [key, concept] of Object.entries(dic.conceptos || {})) {
    CONCEPTOS.set(key, concept);
    ALIASES.set(normalize(key), key);
    for (const alias of concept.sinonimos || []) ALIASES.set(normalize(alias), key);
  }
} catch {
  // Sin diccionario se sigue extrayendo, pero sin concepto.
}

const TYPES = [
  [/scorecard|indicador|kpi|tarjeta/i, 'Scorecard'],
  [/serie temporal|time series/i, 'Serie temporal'],
  [/barras|bar chart/i, 'Barras'],
  [/columnas|column chart/i, 'Columnas'],
  [/l[ií]neas?|line chart/i, 'Líneas'],
  [/tabla din[aá]mica|pivot/i, 'Tabla dinámica'],
  [/\btabla\b|table/i, 'Tabla'],
  [/torta|anillo|dona|pie chart/i, 'Torta / anillo'],
  [/\bmapa\b|\bmap\b/i, 'Mapa'],
  [/dispersi[oó]n|scatter/i, 'Dispersión'],
  [/medidor|gauge/i, 'Medidor'],
];

const CONTROLS = [
  [/rango de fechas|date range/i, 'Rango de fechas'],
  [/lista desplegable|drop-?down/i, 'Lista desplegable'],
  [/casilla|checkbox/i, 'Casilla'],
  [/b[uú]squeda|search/i, 'Búsqueda'],
  [/deslizante|slider/i, 'Control deslizante'],
  [/par[aá]metro|parameter/i, 'Parámetro'],
  [/bot[oó]n|button/i, 'Botón'],
];

const FIELD_TYPES = [
  [/^texto$|^text$|^string$/i, 'Texto'],
  [/^n[uú]mero$|^number$|^numeric$|^num[eé]rico$/i, 'Número'],
  [/^fecha y hora$|^datetime$/i, 'Fecha y hora'],
  [/^fecha$|^date$/i, 'Fecha'],
  [/^booleano$|^boolean$/i, 'Booleano'],
  [/^geograf[ií]a$|^geo$/i, 'Geografía'],
  [/^moneda$|^currency$/i, 'Moneda'],
  [/^porcentaje$|^percent(age)?$/i, 'Porcentaje'],
  [/^entero$|^integer$/i, 'Entero'],
  [/^decimal$|^float$/i, 'Decimal'],
  [/^url$/i, 'URL'],
  [/^imagen$|^image$/i, 'Imagen'],
];

const JOIN_TYPES = [
  [/exterior\s*izda|left outer|left join/i, 'Externo izquierdo (left)'],
  [/exterior\s*dcha|right outer|right join/i, 'Externo derecho (right)'],
  [/exterior\s*total|full outer|full join/i, 'Externo completo (full)'],
  [/cruzada|cross join/i, 'Cruzado (cross)'],
  [/interior|inner join/i, 'Interno (inner)'],
];

const SECTION_KEYS = {
  'Páginas del tablero': 'paginas',
  Filtros: 'filtros',
  'Fuente de datos': 'fuente',
  'Combinación (joins)': 'joins',
};

const NOISE = /^(looker studio|google|archivo|editar|vista|insertar|p[aá]gina|organizar|recurso|ayuda|ver|compartir|restablecer)$/i;
const FIELD_HINT = /legajo|fecha|total|importe|saldo|carrera|sede|apellido|nombre|email|tel[eé]fono|periodo|tipo|comp|cuenta|monto|dni|plan|sucursal/i;

function cleanLines(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').replace(/\s+\./g, '.').trim())
    .filter((line) => line && !/^[^\p{L}\p{N}]+$/u.test(line) && !NOISE.test(line));
}

const firstMatch = (list, line) => list.find(([re]) => re.test(line));

function normFieldType(value) {
  const found = firstMatch(FIELD_TYPES, String(value).trim());
  return found ? found[1] : '';
}

function isShortTitle(line) {
  const text = line.replace(/^[•·\-–]\s*/, '').trim();
  if (text.length < 3 || text.length > 90) return false;
  if (!/\p{L}/u.test(text)) return false;
  if (/^(campo|field|filtro|filter|dimensi[oó]n|dimension|m[eé]trica|metric)\s*[:|]/i.test(text)) return false;
  if (/\b(bigquery|sheets|sql server)\b/i.test(text)) return false;
  return !firstMatch(TYPES, text) && !firstMatch(CONTROLS, text);
}

function valueAfter(line, labels) {
  for (const label of labels) {
    const re = new RegExp(`${label}\\s*[:\\-]\\s*([^|]+)`, 'i');
    const found = line.match(re);
    if (found) return found[1].trim();
  }
  return '';
}

function addUnique(list, item, key) {
  if (!item || !item[key]) return;
  const normalized = item[key].toLowerCase();
  if (list.some((row) => String(row[key] || '').toLowerCase() === normalized)) return;
  list.push(item);
}

function readPaginas(lines, out) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const type = firstMatch(TYPES, line);
    const metric = valueAfter(line, ['m[eé]trica', 'metrica', 'metric']);
    const dimension = valueAfter(line, ['dimensi[oó]n', 'dimension']);
    if (!type) {
      const previous = out.graficos[out.graficos.length - 1];
      if (previous && metric && !previous.metrica) previous.metrica = metric;
      if (previous && dimension && !previous.dimension) previous.dimension = dimension;
      continue;
    }
    const sameLineTitle = line.split('|')[0].trim();
    const titulo =
      sameLineTitle && isShortTitle(sameLineTitle)
        ? sameLineTitle
        : [lines[i - 1], lines[i + 1]].find((candidate) => candidate && isShortTitle(candidate)) || '';
    if (!titulo) {
      out.preguntas.push(`Se ve un gráfico de tipo ${type[1]} sin título legible: completalo a mano.`);
      continue;
    }
    addUnique(out.graficos, { pagina: out.nombre, titulo, tipo: type[1], metrica: metric, dimension, definicion: '' }, 'titulo');
  }

  // A screenshot with no visible chart label is usually a table: the header row
  // is the only readable structure, so it becomes the dimension list.
  if (out.graficos.length) return;
  const header = lines.find((line) => {
    const words = line.split(/\s+/).filter((word) => word.length > 1);
    return words.length >= 5 && (line.match(new RegExp(FIELD_HINT.source, 'gi')) || []).length >= 3;
  });
  if (!header) return;
  const words = header
    .split(/\s+/)
    .map((word) => word.replace(/[.,;]+$/, '').replace(/_+$/, ''))
    .filter((word) => word.length > 1);
  const dimension = [...new Set(words)].slice(0, 12).join(', ');
  addUnique(
    out.graficos,
    { pagina: out.nombre, titulo: out.nombre || 'Tabla sin título', tipo: 'Tabla', metrica: '', dimension, definicion: '' },
    'titulo',
  );
}

function readFiltros(lines, out) {
  let last = null;
  for (const line of lines) {
    const named = valueAfter(line, ['filtro', 'filter']);
    if (named) {
      last = { nombre: named, control: '', campo: '', valores: '' };
      addUnique(out.filtros, last, 'nombre');
      continue;
    }
    const control = firstMatch(CONTROLS, line);
    if (control) {
      const target = last && !last.control ? last : null;
      if (target) target.control = control[1];
      else {
        const nombre = valueAfter(line, ['control']) || line.split('|')[0].trim();
        if (nombre && isShortTitle(nombre)) addUnique(out.filtros, { nombre, control: control[1], campo: '', valores: '' }, 'nombre');
      }
      continue;
    }
    const campo = valueAfter(line, ['campo', 'field']);
    if (campo && last && !last.campo) last.campo = campo;
  }
}

function readFuente(lines, out) {
  let previous = '';
  for (const line of lines) {
    if (/bigquery/i.test(line) || /^[\w-]+\.[\w-]+\.[\w-]+$/.test(line)) {
      addUnique(out.fuentes, { nombre: line, tipo: 'BigQuery', detalle: '' }, 'nombre');
    } else if (/google sheets/i.test(line)) {
      addUnique(out.fuentes, { nombre: line, tipo: 'Google Sheets', detalle: '' }, 'nombre');
    } else if (/sql server/i.test(line)) {
      addUnique(out.fuentes, { nombre: line, tipo: 'SQL Server', detalle: '' }, 'nombre');
    }

    const field = line.match(/^(?:campo|field)\s*[:\-]\s*([^|]+)(?:\|\s*(.+))?$/i);
    if (field) {
      addUnique(out.campos, { nombre: field[1].trim(), tipo: normFieldType(field[2] || ''), descripcion: '' }, 'nombre');
      previous = line;
      continue;
    }
    if (previous && isShortTitle(previous)) {
      const type = normFieldType(line);
      if (type) addUnique(out.campos, { nombre: previous, tipo: type, descripcion: '' }, 'nombre');
    }
    if (/[=()]/.test(line) && /\b(sum|count|case|concat|if|round|when|cast)\b/i.test(line) && previous) {
      const name = line.match(/^([\wáéíóúñ ]{2,40}?)\s*[:=]/i)?.[1]?.trim() || previous;
      addUnique(out.calculados, { nombre: name, formula: line, descripcion: '' }, 'nombre');
    }
    previous = isShortTitle(line) ? line : previous;
  }
  if (!out.fuentes.length) {
    const name = lines.find((line) => /\./.test(line) && isShortTitle(line));
    if (name) addUnique(out.fuentes, { nombre: name, tipo: '', detalle: '' }, 'nombre');
  }
}

// "Combinar datos" shows the two table names; "Configuración de combinación"
// shows the key condition as "campo (Tabla 1) = campo (Tabla 2)".
const KEY_SIDE = /([A-Za-z_][A-Za-z0-9_]{2,})\s*(?:tabl?a|rabl?a|tabl?la)\s*[12zZ]/gi;
const KEY_ROW = /^\s*(?:abc|123|[a-z]{2,3})\s+\|\s*([a-z_][a-z0-9_]{1,})/i;

function normalizeIdent(token) {
  return String(token || '')
    .replace(/^(?:abc|123|rec|mec|mue|wo|sec|fac|nec|abe|ec|qe)/i, '')
    .replace(/(?:tabl?a|rabl?a|tabl?la)\s*\d*$/i, '')
    .replace(/^[0-9]+|[^A-Za-z0-9_]/g, '');
}

// Field names read cleanly in the "Campos disponibles" list; use them to repair
// the mangled identifiers inside the join condition.
function resolveIdent(token, vocabulary) {
  const cleaned = normalizeIdent(token);
  const lower = String(token || '').toLowerCase();
  const known = [...vocabulary]
    .filter((word) => word.length >= 3 && lower.includes(word))
    .sort((a, b) => b.length - a.length)[0];
  return known || cleaned;
}

function readJoins(lines, out, context) {
  const text = lines.join('\n');
  const isDialog = /combinar datos|configuraci[oó]n de combinaci[oó]n|condiciones de combinaci[oó]n/i.test(text);
  if (!isDialog) return;

  for (const line of lines) {
    const field = line.match(KEY_ROW);
    if (field) context.vocabulary.add(field[1].toLowerCase());
  }

  for (const [index, line] of lines.entries()) {
    if (!/nombre de la tabla/i.test(line)) continue;
    for (const following of lines.slice(index, index + 3)) {
      for (const match of following.matchAll(/\.\s*([\p{Lu}][\p{L}]{2,})/gu)) {
        if (!context.tables.includes(match[1])) context.tables.push(match[1]);
      }
    }
  }

  for (const line of lines) {
    const sides = [...line.matchAll(KEY_SIDE)].map((match) => match[1]);
    if (sides.length < 2) continue;
    const pair = sides.slice(0, 2).map((side) => resolveIdent(side, context.vocabulary));
    if (pair[0] && pair[1] && !context.keys.includes(`${pair[0]} = ${pair[1]}`)) {
      context.keys.push(`${pair[0]} = ${pair[1]}`);
    }
  }

  if (/operador de combinaci[oó]n/i.test(text)) context.sawSelector = true;
}

function buildJoins(out, context) {
  if (!context.tables.length && !context.keys.length) return;
  const [izquierda = '', derecha = ''] = context.tables;
  const keyPair = context.keys[0] || '';
  const combinacion = derecha || izquierda;
  if (!combinacion) return;
  addUnique(
    out.joins,
    { combinacion, izquierda, tipo: '', derecha, claves: keyPair ? keyPair.split(' = ').join(' = ') : '' },
    'combinacion',
  );
  if (!out.fuentes.some((fuente) => fuente.nombre === izquierda) && izquierda) {
    addUnique(out.fuentes, { nombre: izquierda, tipo: 'Combinación', detalle: '' }, 'nombre');
  }
  if (!out.fuentes.some((fuente) => fuente.nombre === derecha) && derecha) {
    addUnique(out.fuentes, { nombre: derecha, tipo: 'Combinación', detalle: '' }, 'nombre');
  }
  if (context.keys.length > 1) {
    out.preguntas.push(`Se leyeron ${context.keys.length} condiciones de combinación distintas: revisá si faltan uniones.`);
  }
  if (context.sawSelector && !out.joins[0].tipo) {
    out.preguntas.push('El selector de unión se ve en la captura, pero no cuál está activo: confirmá el tipo (Interior, Exterior izda., etc.).');
  }
  if (!keyPair) {
    out.preguntas.push('No se pudo leer la condición de combinación: confirmá qué campos se cruzan.');
  }
}

function cleanTitle(line) {
  return line
    .replace(/^[A-ZÁÉÍÓÚ]{1,3}\s+(?=[\p{L}])/u, '')
    .replace(/^[•·\-–]\s*/, '')
    .trim();
}

// Browser chrome, menus and window titles make poor catalog names.
function looksLikeTitle(line) {
  const text = cleanTitle(line);
  if (text.length < 8 || text.length > 70) return false;
  if (/[()[\]{}|—–=<>/\\]|looker studio|combinar datos/i.test(text)) return false;
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters / text.length < 0.6) return false;
  return text.split(/\s+/).filter((word) => word.length > 1).length >= 2;
}

// ── Absorber campos desde las capturas ──────────────────────────────────
// Looker muestra los campos como pills: "legajo, tipo, nro, fecha, total".
// Eso es texto OCR legible, así que se convierte en la tabla de campos y se
// mapea contra el diccionario. Es la vía por la que una captura alimenta la
// gobernanza sin pedirle al usuario que suba el CSV.
const NOISE_TOKEN = /^(?:[\d\W_]+)$/;

function cleanToken(raw) {
  const text = String(raw ?? '')
    .replace(/[\u00b7\u2022"'`]/g, '')
    .replace(/^[\s.,;:|()[\]{}<>]+|[\s.,;:|()[\]{}<>]+$/g, '')
    .trim();
  if (text.length < 3 || text.length > 40) return '';
  if (/[\u2014\u2013?\u00bf\u2026]/.test(text)) return ''; // OCR dudoso
  if (NOISE_TOKEN.test(text)) return '';
  const letters = (text.match(/\p{L}/gu) || []).length;
  if (letters < 2) return '';
  return text;
}

function splitTokens(raw) {
  return String(raw ?? '')
    .split(/,|;|\s+i\s+/)
    .map(cleanToken)
    .filter(Boolean);
}

function absorbCampos(out) {
  const seen = new Set(out.campos.map((row) => normalize(row.nombre)));
  const add = (nombre, origen) => {
    const key = normalize(nombre);
    if (!key || !nombre || seen.has(key) || out.campos.length >= 80) return;
    const concepto = ALIASES.get(key) || '';
    const tipo = concepto && CONCEPTOS.get(concepto)?.tipo ? CONCEPTOS.get(concepto).tipo : '';
    out.campos.push({ nombre, tipo, concepto, descripcion: origen });
    seen.add(key);
  };
  for (const graph of out.graficos) {
    for (const raw of [graph.dimension, graph.metrica]) {
      for (const token of splitTokens(raw)) add(token, 'Leído en la captura del gráfico');
    }
  }
  for (const filter of out.filtros) if (filter.campo) add(cleanToken(filter.campo), 'Leído en la captura de filtros');
  for (const calc of out.calculados) if (calc.nombre) add(cleanToken(calc.nombre), 'Campo calculado');
}

export function extract(results) {
  const out = {
    nombre: '',
    objetivo: '',
    frecuencia: '',
    fuentes: [],
    joins: [],
    filtros: [],
    graficos: [],
    calculados: [],
    campos: [],
    preguntas: [],
  };
  const context = { tables: [], keys: [], sawSelector: false, vocabulary: new Set() };

  for (const { section, text } of results) {
    const key = SECTION_KEYS[section] || section || 'paginas';
    const lines = cleanLines(text);
    const readable = lines.join(' ').replace(/[^\p{L}\p{N}]/gu, '').length;
    if (lines.length < 3 || readable < 25) {
      out.preguntas.push(`La captura de ${section || key} no se pudo leer: probá con una imagen más grande.`);
      continue;
    }
    // Only a dashboard screenshot carries the board name; dialogs and crops do not.
    if (key === 'paginas' && !out.nombre) {
      const title = lines.map(cleanTitle).find(looksLikeTitle);
      if (title) out.nombre = title;
    }
    if (!out.objetivo) {
      const description = lines.find((line) => /^contiene\b/i.test(line));
      if (description) out.objetivo = description;
    }
    if (key === 'paginas') readPaginas(lines, out);
    if (key === 'filtros') readFiltros(lines, out);
    if (key === 'fuente') readFuente(lines, out);
    if (key === 'joins') readJoins(lines, out, context);
  }

  buildJoins(out, context);
  absorbCampos(out);

  for (const graph of out.graficos) {
    if (!graph.metrica && out.preguntas.length < 6) {
      out.preguntas.push(`Confirmá la métrica de “${graph.titulo}”.`);
    }
  }
  for (const filter of out.filtros) {
    if (!filter.campo && out.preguntas.length < 8) {
      out.preguntas.push(`Confirmá qué campo filtra “${filter.nombre}”.`);
    }
  }

  return out;
}
