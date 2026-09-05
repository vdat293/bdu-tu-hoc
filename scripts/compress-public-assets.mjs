/**
 * Create Brotli sidecars for publishable CSS/JS assets.
 * The server serves these files only when the browser advertises br support.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { brotliCompress, constants } from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const compress = promisify(brotliCompress);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(root, 'public');
const extensions = new Set(['.css', '.js', '.json', '.svg']);
const brotliOptions = {
  params: {
    [constants.BROTLI_PARAM_QUALITY]: 5,
    [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT
  }
};

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(fullPath));
    else if (extensions.has(path.extname(entry.name).toLowerCase()) && !entry.name.endsWith('.br')) files.push(fullPath);
  }
  return files;
}

const files = await walk(publicDir);
let saved = 0;
for (const file of files) {
  const source = await fs.readFile(file);
  const compressed = await compress(source, brotliOptions);
  await fs.writeFile(`${file}.br`, compressed);
  saved += 1;
  const relative = path.relative(root, file).replaceAll('\\', '/');
  console.log(`${relative}: ${source.length} -> ${compressed.length} bytes`);
}
console.log(`Created ${saved} Brotli sidecars.`);
