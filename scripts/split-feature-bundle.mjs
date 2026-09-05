import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync('public/js/features-dashboard-bundle.js', 'utf8');
const bodyStart = source.indexOf('// TAB 4: WORDFMT INTEGRATION');
const exportStart = source.indexOf('const featureInitializers');
if (bodyStart < 0 || exportStart <= bodyStart) throw new Error('Không tìm thấy feature bundle nguồn.');

const prefix = source.slice(0, bodyStart);
const body = source.slice(bodyStart, exportStart);
const markers = {
  automation: ['// TAB 4: WORDFMT INTEGRATION', '// TAB 8: LEARNING HUB RENDERING'],
  learning: ['// TAB 8: LEARNING HUB RENDERING', '// CLB & NHÓM HỌC TẬP'],
  community: ['// CLB & NHÓM HỌC TẬP', '// BDU CONFESSION & DIỄN ĐÀN SINH VIÊN']
};
const initializers = {
  automation: ['tab-wordfmt', 'tab-survey', 'tab-english'],
  learning: ['tab-learning'],
  community: ['tab-clans', 'tab-confession']
};

fs.mkdirSync('public/js/features', { recursive: true });
for (const [name, [startMarker, endMarker]] of Object.entries(markers)) {
  const start = body.indexOf(startMarker);
  const end = name === 'community' ? body.length : body.indexOf(endMarker, start);
  if (start < 0 || end <= start) throw new Error(`Không tìm thấy vùng ${name}.`);
  const section = body.slice(start, end);
  const functions = [...section.matchAll(/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]);
  const uniqueFunctions = [...new Set(functions)];
  const initializerMap = initializers[name].map(id => `  '${id}': ${id === 'tab-wordfmt' ? 'initWordFmtTool' : id === 'tab-survey' ? 'initSurveyBot' : id === 'tab-english' ? 'initEnglishExerciseBot' : id === 'tab-learning' ? 'initLearningHub' : id === 'tab-clans' ? 'initClansModule' : 'initConfessionModule'}`).join(',\n');
  const footer = `\n\nconst featureInitializers = {\n${initializerMap}\n};\n\nexport function initialize(tabId) {\n  const initializer = featureInitializers[tabId];\n  if (!initializer) return false;\n  initializer();\n  return true;\n}\n\nObject.assign(window, {\n${uniqueFunctions.map(fn => `  ${fn}`).join(',\n')}\n});\n`;
  fs.writeFileSync(path.join('public/js/features', `${name}.js`), `${prefix}${section}${footer}`, 'utf8');
  console.log(`${name}: ${section.length} bytes, ${uniqueFunctions.length} functions`);
}
