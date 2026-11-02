// Reads a data source (CSV or XLSX) and returns its fields with inferred
// types plus the canonical concept each one maps to.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import xlsx from 'xlsx';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// `datos/` puede estar al lado (proyecto) o dentro de la carpeta (copia sola).
const DICTIONARY = [path.join(HERE, '..', 'datos', 'conceptos.json'), path.join(HERE, 'datos', 'conceptos.json')]
  .find((file) => existsSync(file));

const dictionary = JSON.parse(readFileSync(DICTIONARY, 'utf8'));

const normalize = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

const aliases = new Map();
for (const [key, concept] of Object.entries(dictionary.conceptos)) {
  aliases.set(normalize(key), key);
  for (const alias of concept.sinonimos || concept.aliases || []) aliases.set(normalize(alias), key);
}

const MONTHS = 'ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic';
const DATE_PATTERNS = [
  /^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$/,
  /^\d{4}-\d{2}-\d{2}/,
  /^\d{1,2}\s+(?:de\s+)?(?:ene|feb|mar|abr|may|jun|jul|ago|sep|set|oct|nov|dic)[a-z]*\.?\s+\d{2,4}$/i,
  new RegExp(`^\\d{1,2}\\s+(?:${MONTHS})\\s+\\d{2,4}$`, 'i'),
];

function looksLikeDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return true;
  const text = String(value).trim();
  if (!text || text.length > 24) return false;
  return DATE_PATTERNS.some((pattern) => pattern.test(text));
}

function looksLikeNumber(value) {
  const text = String(value).trim();
  if (!text) return false;
  return /^-?\d{1,3}(?:[.,]\d{3})*(?:[.,]\d+)?$/.test(text) || /^-?\d+(?:[.,]\d+)?$/.test(text);
}

function inferType(values) {
  const sample = values.filter((value) => value !== null && value !== undefined && String(value).trim() !== '');
  if (!sample.length) return 'Texto';
  const dates = sample.filter(looksLikeDate).length;
  if (dates / sample.length >= 0.9) return 'Fecha';
  const numbers = sample.filter(looksLikeNumber).length;
  if (numbers / sample.length >= 0.9) return 'Número';
  return 'Texto';
}

function readRows(buffer, format) {
  const workbook =
    format === 'csv'
      ? xlsx.read(buffer.toString('utf8').replace(/^\uFEFF/, ''), { type: 'string', raw: true })
      : xlsx.read(buffer, { type: 'buffer', raw: true, cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true, blankrows: false });
  return { sheetName, rows };
}

export function readSource(buffer, filename) {
  const format = /\.csv$/i.test(filename) ? 'csv' : /\.xlsx?$/i.test(filename) ? 'xlsx' : '';
  if (!format) throw Object.assign(new Error('formato_no_soportado'), { code: 'bad_format' });

  const { sheetName, rows } = readRows(buffer, format);
  if (!rows.length) throw Object.assign(new Error('archivo_vacio'), { code: 'empty' });

  const header = rows[0].map((cell) => String(cell ?? '').trim()).filter(Boolean);
  const body = rows.slice(1, 400);

  const campos = header.map((name, index) => {
    const values = body.map((row) => row[index]);
    const concepto = aliases.get(normalize(name)) || '';
    return {
      nombre: name,
      tipo: inferType(values),
      concepto,
      etiqueta: concepto ? dictionary.conceptos[concepto].etiqueta : '',
    };
  });

  return {
    nombre: path.basename(filename, path.extname(filename)),
    archivo: filename,
    formato: format === 'csv' ? 'CSV' : 'XLSX',
    hoja: format === 'csv' ? '' : sheetName,
    filas: Math.max(rows.length - 1, 0),
    campos,
    sin_concepto: campos.filter((field) => !field.concepto).map((field) => field.nombre),
  };
}
