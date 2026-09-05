import fs from 'node:fs/promises';

const file = 'public/index.html';
const html = await fs.readFile(file, 'utf8');
const updated = html.replace(/<img\b([\s\S]*?)>/gi, (tag, attrs) => {
  if (/\bloading\s*=|\bfetchpriority\s*=|university-wordmark/.test(attrs)) return tag;
  return `<img${attrs} loading="lazy" decoding="async">`;
});
if (updated !== html) await fs.writeFile(file, updated, 'utf8');
console.log(JSON.stringify({ file, changed: updated !== html, images: (updated.match(/<img\b/gi) || []).length }));
