// Emulates the host services the prototype expects (window.claude):
// persistent storage, image blobs, downloads and the vision model call.

(function () {
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const memory = {};


  function readCollection(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return memory[key] || {};
    }
  }

  function writeCollection(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      memory[key] = value;
    }
    window.dispatchEvent(new CustomEvent('catdb-change'));
  }


  const db = {
    collection(name) {
      const key = `catdb:${name}`;
      return {
        orderBy(field, direction = 'desc') {
          return {
            onSnapshot(callback) {
              const emit = () => {
                const all = readCollection(key);
                const sign = direction === 'asc' ? 1 : -1;
                const docs = Object.keys(all)
                  .map((id) => ({ id, data: () => clone(all[id]) }))
                  .sort((a, b) => sign * String(a.data()[field] || '').localeCompare(String(b.data()[field] || '')));
                callback({ docs, metadata: { hasPendingWrites: false } });
              };
              emit();
              window.addEventListener('catdb-change', emit);
              window.addEventListener('storage', emit);
              return () => {
                window.removeEventListener('catdb-change', emit);
                window.removeEventListener('storage', emit);
              };
            },
          };
        },
        doc(id) {
          return {
            async set(body) {
              const all = readCollection(key);
              all[id] = clone(body);
              writeCollection(key, all);
            },
            async delete() {
              const all = readCollection(key);
              delete all[id];
              writeCollection(key, all);
            },
          };
        },
      };
    },
  };

  const assets = {
    async upload(file) {
      const res = await fetch('/api/upload', {
        method: 'POST',
        headers: { 'content-type': file.type },
        body: file,
      });
      if (!res.ok) {
        const error = new Error('upload_failed');
        error.code = res.status === 413 ? 'too_large' : 'upload_failed';
        throw error;
      }
      return res.json();
    },
    async delete(id) {
      await fetch(`/api/upload/${encodeURIComponent(id)}`, { method: 'DELETE' });
    },
  };

  const downloads = {
    async save({ filename, data }) {
      const type = /\.csv$/i.test(filename) ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8';
      const blob = new Blob([data], { type });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    },
  };

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  async function mapError(res) {
    const error = new Error(`analyze_${res.status}`);
    const body = await res.json().catch(() => ({}));
    error.code =
      body.error === 'sin_clave'
        ? 'not_granted'
        : res.status === 429
          ? 'rate_limited'
          : res.status === 422
            ? 'image_rejected'
            : body.error === 'invalid_json'
              ? 'invalid_json'
              : 'refused';
    return error;
  }

  const sample = {
    async limits() {
      return { images: { maxCount: 4 } };
    },
    async json(prompt, options = {}) {
      const { images = [], signal, onText } = options;
      const payload = {
        prompt,
        images: await Promise.all(
          images.map(async (blob) => ({ mime: blob.type, dataBase64: await toBase64(blob) })),
        ),
      };
      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        signal,
      });
      if (typeof onText === 'function') onText();
      if (!res.ok) throw await mapError(res);
      return res.json();
    },
  };

  // ── Importar fuente: completa campos y conceptos sin OCR ──────────────
  function setStatus(text) {
    const status = document.querySelector('#status');
    if (status) status.textContent = text;
  }

  function applySource(data) {
    try {
      if (!work && typeof createNew === 'function') createNew();
    } catch {
      // createNew lives in the app script; if it is not reachable we bail out below
    }
    if (typeof work === 'undefined' || !work) {
      setStatus('Elegí o creá un tablero antes de importar la fuente.');
      return;
    }
    if (!work.fuentes.some((item) => item.nombre === data.nombre)) {
      work.fuentes.push({
        nombre: data.nombre,
        plataforma: 'CSV / archivo',
        objeto: [data.archivo, data.hoja].filter(Boolean).join(' · '),
        detalle: '',
      });
    }
    let added = 0;
    for (const campo of data.campos) {
      if (work.campos.some((row) => row.nombre === campo.nombre)) continue;
      work.campos.push({
        nombre: campo.nombre,
        tipo: campo.tipo,
        concepto: campo.concepto || '',
        descripcion: '',
      });
      added += 1;
    }
    if (data.sin_concepto.length) {
      const pendiente = `Campos sin concepto en ${data.nombre}: ${data.sin_concepto.join(', ')}.`;
      work.dudas = Array.isArray(work.dudas) ? work.dudas : [];
      if (!work.dudas.some((q) => q.texto === pendiente)) {
        work.dudas.push({ texto: pendiente, dimension: 'completitud', estado: 'abierta', nota: '' });
      }
    }
    if (typeof saveNow === 'function') saveNow();
    if (typeof renderEditorKeepScroll === 'function') renderEditorKeepScroll();
    setStatus(`Fuente importada: ${data.nombre} · ${added} campos nuevos · ${data.filas} filas · ${data.formato}`);
  }

  async function readSourceFile(file) {
    setStatus(`Leyendo ${file.name}…`);
    const response = await fetch('/api/source', {
      method: 'POST',
      headers: {
        'content-type': 'application/octet-stream',
        'x-filename': encodeURIComponent(file.name),
      },
      body: file,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const messages = {
        bad_format: 'Formato no soportado: usá CSV o XLSX.',
        empty: 'El archivo está vacío.',
        no_filename: 'No se pudo leer el nombre del archivo.',
      };
      setStatus(messages[data.error] || 'No se pudo leer la fuente.');
      return;
    }
    applySource(data);
  }


  // ── Exportar HTML autocontenido (versión para compartir) ─────────────
  const escapeHtml = (value) =>
    String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  const blobToDataUrl = (blob) =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });

  async function captureToDataUrl(capture) {
    const local = typeof localFiles !== 'undefined' ? localFiles.get(capture.id) : null;
    if (local) return blobToDataUrl(local);
    try {
      const response = await fetch(`/_blob/${capture.id}`);
      if (!response.ok) return '';
      return blobToDataUrl(await response.blob());
    } catch {
      return '';
    }
  }

  const HTML_STYLE = `
:root{--ink:#16181d;--muted:#6b7280;--line:#d9dce3;--soft:#f6f7f9;--accent:#1f4e79}
*{box-sizing:border-box}
body{margin:0;background:#eef0f4;color:var(--ink);font:15px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
.page{max-width:920px;margin:0 auto;background:#fff;padding:48px 56px;min-height:100vh;box-shadow:0 2px 24px rgba(16,24,40,.08)}
.kicker{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--muted);margin-bottom:10px}
h1{font-size:34px;line-height:1.15;margin:0 0 12px;letter-spacing:-.02em}
.version{font-size:14px;color:var(--muted);margin:0 0 6px}
.version b{color:var(--ink)}
.note{font-size:13px;color:var(--muted);border-left:3px solid var(--accent);padding-left:12px;margin:18px 0 26px}
nav{border-top:1px solid var(--line);border-bottom:1px solid var(--line);padding:14px 0;margin-bottom:8px}
nav a{display:inline-block;margin:0 18px 6px 0;color:var(--accent);text-decoration:none;font-size:14px}
nav a span{color:var(--muted)}
.tablero{padding-top:36px;margin-top:36px;border-top:2px solid var(--ink)}
.tablero:first-of-type{border-top:none;margin-top:8px}
h2{font-size:26px;margin:0 0 4px;letter-spacing:-.01em}
.estado{display:inline-block;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;background:var(--soft);border:1px solid var(--line);color:var(--muted);margin-bottom:14px}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px 22px;margin:0 0 20px;padding:16px 18px;background:var(--soft);border-radius:10px}
.meta div{font-size:13px}
.meta dt{color:var(--muted);font-size:11px;letter-spacing:.06em;text-transform:uppercase;margin-bottom:2px}
.meta dd{margin:0;font-weight:600}
h3{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin:30px 0 10px;padding-bottom:6px;border-bottom:1px solid var(--line)}
table{width:100%;border-collapse:collapse;font-size:13.5px}
th{text-align:left;font-size:11px;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);border-bottom:1px solid var(--line);padding:6px 10px 6px 0;font-weight:600;vertical-align:bottom}
td{padding:7px 10px 7px 0;border-bottom:1px solid #eef0f4;vertical-align:top}
td.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
tr:last-child td{border-bottom:none}
.vacio{color:var(--muted);font-size:13px;font-style:italic;padding:6px 0}
.objetivo{font-size:15px;margin:0 0 6px}
.galeria{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;margin-top:10px}
.galeria img{cursor:zoom-in}
.lb{position:fixed;inset:0;background:rgba(10,12,16,.95);z-index:9999;display:none;overflow:auto;padding:20px}
.lb.open{display:block}
.lb img{display:block;margin:0 auto;max-width:94vw;max-height:88vh;box-shadow:0 10px 50px rgba(0,0,0,.6);cursor:zoom-in;background:#fff}
.lb.real img{max-width:none;max-height:none;width:auto;cursor:zoom-out}
.lb .lb-hint{position:fixed;left:0;right:0;bottom:12px;text-align:center;color:#c9ccd4;font-size:12px;letter-spacing:.04em}
figure{margin:0;border:1px solid var(--line);border-radius:8px;overflow:hidden;background:var(--soft)}
figure img{display:block;width:100%;height:auto;background:#fff}
figcaption{font-size:11.5px;color:var(--muted);padding:6px 9px;border-top:1px solid var(--line)}
.dudas{margin:6px 0 0;padding-left:18px;font-size:13.5px}
.dim{display:inline-block;font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--accent);background:#eef3f9;border-radius:4px;padding:1px 6px;margin-left:4px;vertical-align:1px}
.gov{margin:26px 0 0;padding:18px 20px;background:var(--soft);border-radius:10px}
.gov h3{margin-top:0;border:none;padding:0}
.gov-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:10px;margin:10px 0 4px}
.gov-card{background:#fff;border:1px solid var(--line);border-radius:8px;padding:10px 12px;display:flex;flex-direction:column;gap:2px}
.gov-card b{font-size:21px;letter-spacing:-.02em}
.gov-card span{font-size:11.5px;color:var(--muted)}
.dudas li{margin-bottom:5px}
footer{margin-top:44px;padding-top:16px;border-top:1px solid var(--line);font-size:12px;color:var(--muted)}
@media print{
  body{background:#fff}
  .page{box-shadow:none;padding:0;max-width:none}
  .tablero{page-break-before:always}
  .tablero:first-of-type{page-break-before:auto}
  table,figure,.meta{page-break-inside:avoid}
  nav a{color:var(--ink)}
}
`;

  const LIGHTBOX_SCRIPT = `<script>
(function(){
  var lb = document.createElement('div'); lb.className = 'lb';
  var img = document.createElement('img');
  var hint = document.createElement('div'); hint.className = 'lb-hint';
  hint.textContent = 'Click en la imagen: tamaño real · Esc: cerrar';
  lb.appendChild(img); lb.appendChild(hint); document.body.appendChild(lb);
  function close(){ lb.classList.remove('open','real'); img.removeAttribute('src'); }
  document.addEventListener('click', function(e){
    var t = e.target;
    if (t.tagName === 'IMG' && t.closest('.galeria')) { img.src = t.src; lb.classList.add('open'); return; }
    if (!lb.classList.contains('open')) return;
    if (t === img) { lb.classList.toggle('real'); return; }
    close();
  });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') close(); });
})();
</scr` + `ipt>`;

  function tableHtml(columns, rows) {
    if (!rows || !rows.length) return '<p class="vacio">Sin datos.</p>';
    const head = columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join('');
    const body = rows
      .map((row) => {
        const cells = columns
          .map(([key, , style]) => {
            const value = row[key];
            const text = value === undefined || value === null || String(value).trim() === ''
              ? '<span style="color:#c2c6ce">—</span>'
              : escapeHtml(value);
            return `<td class="${style === 'mono' ? 'mono' : ''}">${text}</td>`;
          })
          .join('');
        return `<tr>${cells}</tr>`;
      })
      .join('');
    return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  }

  const COLS_EXPORT = {
    fuentes: [['nombre', 'Fuente'], ['plataforma', 'Plataforma'], ['objeto', 'Objeto', 'mono'], ['detalle', 'Notas']],
    joins: [['combinacion', 'Combinación'], ['izquierda', 'Tabla izquierda'], ['tipo', 'Unión'], ['derecha', 'Tabla derecha'], ['claves', 'Claves', 'mono']],
    filtros: [['nombre', 'Filtro'], ['control', 'Control'], ['campo', 'Campo'], ['valores', 'Valores u opciones']],
    graficos: [['pagina', 'Página'], ['titulo', 'Gráfico'], ['tipo', 'Tipo'], ['metrica', 'Métrica'], ['dimension', 'Dimensión'], ['definicion', 'Definición / regla']],
    campos: [['nombre', 'Campo', 'mono'], ['tipo', 'Tipo'], ['concepto', 'Concepto', 'mono'], ['descripcion', 'Descripción']],
    calculados: [['nombre', 'Campo', 'mono'], ['formula', 'Fórmula', 'mono'], ['descripcion', 'Qué significa']],
    dudas: [['texto', 'Duda'], ['dimension', 'Dimensión'], ['estado', 'Estado'], ['nota', 'Resolución']],
  };

  const TITULOS = {
    fuentes: 'Fuentes de datos', joins: 'Combinaciones (joins)', filtros: 'Filtros y controles',
    graficos: 'Gráficos e indicadores', campos: 'Campos', calculados: 'Campos calculados',
    dudas: 'Dudas y brechas de calidad',
  };
  const SECCION_LABEL = { paginas: 'Páginas', graficos: 'Gráficos', filtros: 'Filtros', fuentes: 'Fuentes', otros: 'Otras capturas' };

  function fichaHtml(doc, imagenes) {
    const meta = [
      ['Estado', doc.estado],
      ['Área', doc.area],
      ['Dueño del dato', doc.dueno],
      ['Custodio', doc.custodio],
      ['Usuarios', (doc.usuarios || []).join(', ')],
      ['Actualización', doc.frecuencia],
      ['Vigencia', [doc.vigente_desde, doc.vigente_hasta].filter(Boolean).join(' → ') || ''],
      ['Reemplazado por', doc.reemplazado_por],
      ['Enlace', doc.link],
    ]
      .filter(([, value]) => value && String(value).trim())
      .map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`)
      .join('');

    const secciones = Object.keys(COLS_EXPORT)
      .map((key) => {
        const rows = doc[key] || [];
        if (!rows.length) return '';
        return `<h3>${escapeHtml(TITULOS[key])}</h3>${tableHtml(COLS_EXPORT[key], rows)}`;
      })
      .join('');

    const pendientes = (doc.dudas || []).filter((q) => q.estado !== 'resuelta' && q.estado !== 'descartada');
    const dudas = pendientes.length
      ? `<h3>Dudas y brechas abiertas</h3><ul class="dudas">${pendientes.map((q) => `<li>${escapeHtml(q.texto)}${q.dimension ? ` <span class="dim">${escapeHtml(q.dimension)}</span>` : ''}</li>`).join('')}</ul>`
      : '';

    const galeria = Object.keys(imagenes).length
      ? `<h3>Capturas</h3>${Object.entries(imagenes)
          .map(([seccion, items]) => (items.length
            ? `<div class="galeria">${items
                .map((item) => `<figure><img src="${item.src}" alt="${escapeHtml(item.nombre)}"><figcaption>${escapeHtml(SECCION_LABEL[seccion] || seccion)} · ${escapeHtml(item.nombre)}</figcaption></figure>`)
                .join('')}</div>`
            : ''))
          .join('')}`
      : '';

    return `<section class="tablero" id="${escapeHtml(doc.id)}">
  <h2>${escapeHtml(doc.nombre)}</h2>
  <span class="estado">${escapeHtml(doc.estado || 'borrador')}</span>
  ${meta ? `<dl class="meta">${meta}</dl>` : ''}
  ${doc.objetivo ? `<p class="objetivo">${escapeHtml(doc.objetivo)}</p>` : ''}
  ${secciones}${dudas}${galeria}
</section>`;
  }

  async function buildCatalogHtml() {
    const lista = (typeof docs !== 'undefined' && typeof order !== 'undefined' && order.length)
      ? order.map((id) => ({ id, ...(typeof norm === 'function' ? norm(docs.get(id)) : docs.get(id)) }))
      : (typeof work !== 'undefined' && work ? [{ id: 'actual', ...(typeof norm === 'function' ? norm(work) : work) }] : []);

    const fichas = [];
    for (const doc of lista) {
      const porSeccion = {};
      for (const capture of doc.capturas || []) {
        const src = await captureToDataUrl(capture);
        if (!src) continue;
        const seccion = capture.seccion || 'otros';
        (porSeccion[seccion] ||= []).push({ nombre: capture.nombre || 'captura', src });
      }
      fichas.push({ doc, imagenes: porSeccion });
    }

    const now = new Date();
    const fecha = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
    const nav = fichas
      .map(({ doc }) => `<a href="#${escapeHtml(doc.id)}">${escapeHtml(doc.nombre)} <span>· ${(doc.campos || []).length} campos</span></a>`)
      .join('');

    const gov = typeof window.governanceData === 'function' ? window.governanceData() : null;
    const pct = (part, total) => (total ? Math.round((part / total) * 100) + '%' : '—');
    const govHtml = gov
      ? `<section class="gov">
  <h3>Resumen de gobernanza</h3>
  <div class="gov-cards">
    <div class="gov-card"><b>${gov.tableros}</b><span>tableros · ${gov.validados} validados</span></div>
    <div class="gov-card"><b>${pct(gov.conConcepto, gov.campos)}</b><span>campos con concepto (${gov.conConcepto}/${gov.campos})</span></div>
    <div class="gov-card"><b>${pct(gov.conObjeto, gov.fuentes)}</b><span>fuentes con objeto (${gov.conObjeto}/${gov.fuentes})</span></div>
    <div class="gov-card"><b>${gov.dudasAbiertas}</b><span>dudas abiertas</span></div>
    <div class="gov-card"><b>${gov.brechas.length}</b><span>tableros con brechas</span></div>
  </div>
  ${gov.brechas.length ? `<p class="vacio">Con brechas: ${gov.brechas.map(([t, f]) => `${escapeHtml(t)} (${escapeHtml(f)})`).join(' · ')}</p>` : ''}
</section>`
      : '';

    return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Catálogo de tableros UFLO · versión ${fecha}</title>
<style>${HTML_STYLE}</style>
</head>
<body>
<div class="page">
<header>
  <div class="kicker">Universidad de Flores · Gobernanza de datos</div>
  <h1>Catálogo de tableros</h1>
  <p class="version">Versión del <b>${fecha}</b> · ${hora} · ${fichas.length} ${fichas.length === 1 ? 'tablero' : 'tableros'}</p>
  <p class="note">Documento de solo lectura. Cada publicación se guarda con su fecha: para ver qué cambió en Looker, abrí la versión anterior y compará.</p>
  <nav>${nav}</nav>
</header>
${govHtml}
${fichas.map(({ doc, imagenes }) => fichaHtml(doc, imagenes)).join('\n')}
<footer>Generado el ${fecha} a las ${hora} · Catálogo de tableros UFLO</footer>
</div>
${LIGHTBOX_SCRIPT}
</body>
</html>`;
  }

  async function buildCatalogJson() {
    const lista = (typeof docs !== 'undefined' && typeof order !== 'undefined' && order.length)
      ? order.map((id) => ({ id, ...(typeof norm === 'function' ? norm(docs.get(id)) : docs.get(id)) }))
      : (typeof work !== 'undefined' && work ? [{ id: 'actual', ...(typeof norm === 'function' ? norm(work) : work) }] : []);
    let diccionario = null;
    let maestros = null;
    try {
      const response = await fetch('/api/maestros');
      if (response.ok) maestros = await response.json();
    } catch {
      maestros = null;
    }
    try {
      const response = await fetch('/api/diccionario');
      if (response.ok) diccionario = await response.json();
    } catch {
      diccionario = null;
    }
    return {
      esquema: 'catalogo-tableros-uflo/v1',
      generado: new Date().toISOString(),
      tableros: lista.map((doc) => ({
        id: doc.id,
        nombre: doc.nombre,
        estado: doc.estado,
        area: doc.area,
        dueno: doc.dueno,
        custodio: doc.custodio,
        vigente_desde: doc.vigente_desde,
        vigente_hasta: doc.vigente_hasta,
        reemplazado_por: doc.reemplazado_por,
        usuarios: doc.usuarios || [],
        frecuencia: doc.frecuencia,
        enlace: doc.link,
        objetivo: doc.objetivo,
        fuentes: doc.fuentes || [],
        joins: doc.joins || [],
        filtros: doc.filtros || [],
        graficos: doc.graficos || [],
        calculados: doc.calculados || [],
        campos: doc.campos || [],
        dudas: (doc.dudas || []).map((q) => ({ texto: q.texto, dimension: q.dimension, estado: q.estado, nota: q.nota })),
        capturas: (doc.capturas || []).map((c) => ({ id: c.id, nombre: c.nombre, seccion: c.seccion, analizada: c.analizada })),
      })),
      gobernanza: typeof window.governanceData === 'function' ? window.governanceData() : null,
      diccionario,
      maestros,
    };
  }

  async function exportCatalogJson() {
    setStatus('Armando el JSON…');
    try {
      const data = await buildCatalogJson();
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `catalogo-tableros-uflo_${stamp}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatus(`JSON listo: catalogo-tableros-uflo_${stamp}.json · ${data.tableros.length} tableros`);
    } catch (error) {
      setStatus('No se pudo armar el JSON: ' + (error && error.message ? error.message : 'error desconocido'));
    }
  }

  async function exportCatalogHtml() {
    setStatus('Armando el HTML con las capturas…');
    try {
      const html = await buildCatalogHtml();
      const stamp = new Date().toISOString().slice(0, 10);
      const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `catalogo-tableros-uflo_${stamp}.html`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      setStatus(`HTML listo: catalogo-tableros-uflo_${stamp}.html · versión ${stamp}`);
    } catch (error) {
      setStatus('No se pudo armar el HTML: ' + (error && error.message ? error.message : 'error desconocido'));
    }
  }

  function mountImport() {
    const actions = document.querySelector('.actions');
    if (!actions || document.getElementById('local-import')) return;

    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'local-import';
    button.textContent = 'Importar fuente';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.csv,.xlsx,.xls';
    input.hidden = true;
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      input.value = '';
      if (!file) return;
      try {
        await readSourceFile(file);
      } catch {
        setStatus('No se pudo importar la fuente.');
      }
    });

    button.addEventListener('click', () => input.click());
    actions.prepend(button);
    actions.after(input);

    if (!document.getElementById('local-export-html')) {
      const exportButton = document.createElement('button');
      exportButton.type = 'button';
      exportButton.id = 'local-export-html';
      exportButton.textContent = 'Exportar HTML';
      exportButton.addEventListener('click', exportCatalogHtml);
      button.after(exportButton);

      const jsonButton = document.createElement('button');
      jsonButton.type = 'button';
      jsonButton.id = 'local-export-json';
      jsonButton.textContent = 'Exportar JSON';
      jsonButton.addEventListener('click', exportCatalogJson);
      exportButton.after(jsonButton);
    }
  }

  if (document.querySelector('.actions')) mountImport();
  else document.addEventListener('DOMContentLoaded', mountImport);

  const services = { db, assets, sample, downloads };

  window.claude = {
    use(name) {
      if (!(name in services)) return Promise.reject(new Error(`unknown_service:${name}`));
      return Promise.resolve(services[name]);
    },
  };

})();
