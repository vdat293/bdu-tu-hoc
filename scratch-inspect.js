import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';

const tempDir = './temp';
const files = fs.readdirSync(tempDir).filter(f => f.endsWith('.docx')).map(f => ({
  name: f,
  mtime: fs.statSync(path.join(tempDir, f)).mtimeMs
})).sort((a,b) => b.mtime - a.mtime);

const docxPath = process.argv[2] || (files.length > 0 ? path.join(tempDir, files[0].name) : null);

if (!docxPath || !fs.existsSync(docxPath)) {
  console.log('DOCX file not found:', docxPath);
  process.exit(1);
}

console.log('Inspecting file:', docxPath);
const zip = new AdmZip(docxPath);
const docXml = zip.readAsText('word/document.xml');
const $ = load(docXml, { xml: true });

$('w\\:p').slice(0, 20).each((i, el) => {
  const text = $(el).text().trim();
  if (text) console.log(`[p ${i}] ${text}`);
});












