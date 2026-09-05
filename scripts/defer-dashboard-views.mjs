import fs from 'node:fs/promises';

const file = 'public/index.html';
const source = await fs.readFile(file, 'utf8');
const ids = new Set([
  'tab-leaderboard', 'tab-wordfmt', 'tab-survey', 'tab-english',
  'tab-enrollment', 'tab-learning', 'tab-clans', 'tab-confession'
]);

if ([...ids].every(id => source.includes(`id="bdu-view-fragment-${id}"`))) {
  console.log('Dashboard views already deferred.');
  process.exit(0);
}

function findSectionEnd(html, start) {
  const token = /<section\b[^>]*>|<\/section>/gi;
  token.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = token.exec(html))) {
    depth += match[0][1] === '/' ? -1 : 1;
    if (depth === 0) return token.lastIndex;
  }
  throw new Error(`Không tìm thấy </section> cho vị trí ${start}`);
}

const sections = [];
const opener = /<section\s+id="(tab-[^"]+)"[^>]*>/gi;
const existingTemplates = [...source.matchAll(/<template\s+id="bdu-view-fragment-[^"]+"[\s\S]*?<\/template>/gi)]
  .map(item => ({ start: item.index, end: item.index + item[0].length }));
let match;
while ((match = opener.exec(source))) {
  if (!ids.has(match[1])) continue;
  if (existingTemplates.some(template => match.index >= template.start && match.index < template.end)) continue;
  const end = findSectionEnd(source, match.index);
  sections.push({ id: match[1], start: match.index, end });
}

let output = source;
for (const section of sections.reverse()) {
  const body = source.slice(section.start, section.end);
  if (body.includes(`id="bdu-view-fragment-${section.id}"`)) continue;
  output = `${output.slice(0, section.start)}<template id="bdu-view-fragment-${section.id}" data-view-fragment="${section.id}">${body}</template>${output.slice(section.end)}`;
}

if (output !== source) await fs.writeFile(file, output, 'utf8');
console.log(`Deferred ${sections.length} dashboard views.`);
