// Local OCR built on tesseract.js: reads the text in screenshots.
// No external service, no per-use cost. Language data is cached once.
// Screenshots are upscaled first: tesseract reads small UI text far better
// around 2600 px wide than at its original size.

import { createWorker } from 'tesseract.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const exec = promisify(execFile);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const TARGET_WIDTH = 2600;

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = createWorker('spa+eng', 1, { cachePath: HERE, logger: () => {} }).catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

async function upscale(buffer) {
  const id = crypto.randomUUID();
  const input = path.join(os.tmpdir(), `${id}.png`);
  const output = path.join(os.tmpdir(), `${id}-x.png`);
  try {
    await writeFile(input, buffer);
    await exec('sips', ['--resampleWidth', String(TARGET_WIDTH), input, '--out', output], { timeout: 20000 });
    return await readFile(output);
  } catch {
    return buffer;
  } finally {
    await unlink(input).catch(() => {});
    await unlink(output).catch(() => {});
  }
}

export async function recognize(buffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(await upscale(buffer));
  return data.text || '';
}
