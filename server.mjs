// Local runtime for the UFLO board catalog prototype.
// Serves the single-file prototype with a shim that emulates the host
// services the app expects (storage, image blobs, downloads, analysis).

import { createServer } from 'node:http';
import { readFile, writeFile, unlink, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';
import { recognize } from './ocr.mjs';
import { extract } from './extract.mjs';
import { readSource } from './sources.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROTOTYPE = path.join(HERE, 'app.html');

// `datos/` puede estar al lado (proyecto) o dentro de la carpeta (copia sola).
const datos = (nombre) =>
  [path.join(HERE, '..', 'datos', nombre), path.join(HERE, 'datos', nombre)].find((file) => existsSync(file));
const SHIM = path.join(HERE, 'shim.js');
const BLOBS = path.join(HERE, 'blobs');

const PORT = Number(process.env.PORT || 4173);
const HOST = '127.0.0.1';
const MAX_BODY = 20 * 1024 * 1024;

const MIME_EXT = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('too_large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function renderWithShim() {
  const html = await readFile(PROTOTYPE, 'utf8');
  const marker = '<script>\nconst $ = ';
  const at = html.indexOf(marker);
  if (at === -1) throw new Error('no_marker');
  return html.slice(0, at) + '<script src="/shim.js"></script>\n' + html.slice(at);
}

async function servePrototype(res) {
  const output = await renderWithShim();
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(output);
}

async function serveShim(res) {
  const js = await readFile(SHIM, 'utf8');
  res.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8', 'cache-control': 'no-store' });
  res.end(js);
}

async function serveBlob(res, id) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return json(res, 400, { error: 'bad_id' });
  try {
    const meta = JSON.parse(await readFile(path.join(BLOBS, `${id}.json`), 'utf8'));
    const bytes = await readFile(path.join(BLOBS, id));
    res.writeHead(200, { 'content-type': meta.mime || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(bytes);
  } catch {
    json(res, 404, { error: 'not_found' });
  }
}

async function upload(req, res) {
  const mime = (req.headers['content-type'] || '').split(';')[0].trim();
  if (!MIME_EXT[mime]) return json(res, 415, { error: 'bad_type' });
  let bytes;
  try {
    bytes = await readBody(req);
  } catch (e) {
    return json(res, e.status || 400, { error: e.message === 'too_large' ? 'too_large' : 'bad_body' });
  }
  if (!bytes.length) return json(res, 400, { error: 'empty' });
  const id = `cap-${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  await writeFile(path.join(BLOBS, id), bytes);
  await writeFile(path.join(BLOBS, `${id}.json`), JSON.stringify({ mime, name: `captura.${MIME_EXT[mime]}` }));
  json(res, 200, { id });
}

async function removeUpload(res, id) {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) return json(res, 400, { error: 'bad_id' });
  for (const file of [id, `${id}.json`]) {
    try {
      await unlink(path.join(BLOBS, file));
    } catch {
      // already gone
    }
  }
  res.writeHead(204);
  res.end();
}

// The prompt lists the images in order as "Imagen 1: Páginas del tablero".
function readSections(prompt) {
  const sections = [];
  for (const match of String(prompt || '').matchAll(/^Imagen \d+:\s*(.+)$/gm)) {
    sections.push(match[1].trim());
  }
  return sections;
}

async function analyze(req, res) {
  let payload;
  try {
    payload = JSON.parse((await readBody(req, 40 * 1024 * 1024)).toString('utf8'));
  } catch {
    return json(res, 400, { error: 'bad_body' });
  }
  const images = Array.isArray(payload.images) ? payload.images : [];
  if (!images.length) return json(res, 400, { error: 'no_images' });
  const sections = readSections(payload.prompt);

  const results = [];
  for (const [index, image] of images.entries()) {
    if (!image || !image.dataBase64) continue;
    let text;
    try {
      text = await recognize(Buffer.from(image.dataBase64, 'base64'));
    } catch (error) {
      console.error(`ocr failed on image ${index + 1}:`, error && error.message);
      return json(res, 422, { error: 'image_rejected' });
    }
    results.push({ section: sections[index] || 'Páginas del tablero', text });
  }
  if (!results.length) return json(res, 400, { error: 'no_images' });

  json(res, 200, extract(results));
}

async function importSource(req, res) {
  const filename = decodeURIComponent(req.headers['x-filename'] || '');
  if (!filename) return json(res, 400, { error: 'no_filename' });
  let bytes;
  try {
    bytes = await readBody(req);
  } catch (e) {
    return json(res, e.status || 400, { error: 'bad_body' });
  }
  try {
    json(res, 200, readSource(bytes, filename));
  } catch (e) {
    json(res, e.code === 'bad_format' ? 415 : 400, { error: e.code || 'bad_file' });
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);
    const route = url.pathname;

    if (req.method === 'GET' && route === '/') return await servePrototype(res);
    if (req.method === 'GET' && route === '/shim.js') return await serveShim(res);
    if (req.method === 'GET' && route === '/api/health') return json(res, 200, { mode: 'ocr' });
    if (req.method === 'GET' && route === '/api/diccionario') {
      const raw = await readFile(datos('conceptos.json'), 'utf8');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(raw);
    }
    if (req.method === 'GET' && route === '/api/maestros') {
      const raw = await readFile(datos('maestros.json'), 'utf8');
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      return res.end(raw);
    }
    if (req.method === 'GET' && route.startsWith('/_blob/')) return await serveBlob(res, decodeURIComponent(route.slice(7)));
    if (req.method === 'POST' && route === '/api/upload') return await upload(req, res);
    if (req.method === 'DELETE' && route.startsWith('/api/upload/')) return await removeUpload(res, decodeURIComponent(route.slice(12)));
    if (req.method === 'POST' && route === '/api/analyze') return await analyze(req, res);
    if (req.method === 'POST' && route === '/api/source') return await importSource(req, res);

    json(res, 404, { error: 'not_found' });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) json(res, 500, { error: 'server_error' });
  }
});

await mkdir(BLOBS, { recursive: true });
server.listen(PORT, HOST, () => {
  console.log(`Catálogo UFLO local: http://${HOST}:${PORT}`);
  console.log('Análisis: OCR local (tesseract) — sin servicios externos');
});
