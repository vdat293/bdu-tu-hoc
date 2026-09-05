import fs from 'node:fs/promises';

const file = 'public/index.html';
const source = await fs.readFile(file, 'utf8');
const token = /<picture\b[^>]*>|<\/picture>|<img\b[^>]*>/gi;
let pictureDepth = 0;
let cursor = 0;
let output = '';
let replacements = 0;
let match;

while ((match = token.exec(source))) {
  output += source.slice(cursor, match.index);
  const tag = match[0];
  if (/^<picture\b/i.test(tag)) {
    pictureDepth += 1;
    output += tag;
  } else if (/^<\/picture>/i.test(tag)) {
    pictureDepth = Math.max(0, pictureDepth - 1);
    output += tag;
  } else if (pictureDepth || !/assets\/images\/(?:logo-bdu-eng|logo-hao-quang-transparent)\.png/i.test(tag)) {
    output += tag;
  } else {
    const isWordmark = tag.includes('logo-bdu-eng.png');
    const sourceTag = isWordmark
      ? '<source type="image/webp" srcset="assets/images/logo-bdu-eng-512.webp 512w, assets/images/logo-bdu-eng-1024.webp 1024w" sizes="220px">'
      : '<source type="image/webp" srcset="assets/images/logo-hao-quang-256.webp 256w, assets/images/logo-hao-quang-512.webp 512w" sizes="64px">';
    output += `<picture>${sourceTag}${tag}</picture>`;
    replacements += 1;
  }
  cursor = token.lastIndex;
}
output += source.slice(cursor);
if (pictureDepth !== 0) throw new Error('HTML picture tag không cân bằng.');
if (replacements) await fs.writeFile(file, output, 'utf8');
console.log(`Wrapped ${replacements} non-picture logos with responsive WebP sources.`);
