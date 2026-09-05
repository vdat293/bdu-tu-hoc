import fs from 'node:fs';

const appPath = 'public/js/app.js';
const source = fs.readFileSync(appPath, 'utf8');
if (source.includes('BDU_FEATURE_BUNDLE_PLACEHOLDER')) {
  console.log('Dashboard feature bundle đã được tách.');
  process.exit(0);
}
const startMarker = '// TAB 4: WORDFMT INTEGRATION';
const endMarker = '// MODAL DETAILS';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker);
if (start < 0 || end <= start) throw new Error('Không tìm thấy ranh giới feature bundle.');

const coreSource = source.slice(0, start);
const featureSource = source.slice(start, end);
const coreFunctions = [...coreSource.matchAll(/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]);
const featureFunctions = [...featureSource.matchAll(/(?:^|\n)(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/g)].map(match => match[1]);
const unique = values => [...new Set(values)];
const aliases = unique(['AppState', 'BduApi', ...coreFunctions]);
const prefix = `/** Lazy dashboard feature bundle. Loaded only when a heavy view is opened. */\nconst runtime = window.BDUAppRuntime || {};\nconst { ${aliases.join(', ')} } = runtime;\n\n`;
const exports = `\n\nconst featureInitializers = {\n  'tab-wordfmt': initWordFmtTool,\n  'tab-survey': initSurveyBot,\n  'tab-english': initEnglishExerciseBot,\n  'tab-learning': initLearningHub,\n  'tab-clans': initClansModule,\n  'tab-confession': initConfessionModule\n};\n\nexport function initialize(tabId) {\n  const initializer = featureInitializers[tabId];\n  if (!initializer) return false;\n  initializer();\n  return true;\n}\n\nObject.assign(window, {\n${unique(featureFunctions).map(name => `  ${name}`).join(',\n')}\n});\n`;
fs.writeFileSync('public/js/features-dashboard-bundle.js', `${prefix}${featureSource}${exports}`, 'utf8');
const replacement = `// BDU_FEATURE_BUNDLE_PLACEHOLDER\n// Heavy dashboard features are loaded by native import() when their tab is opened.\n`;
fs.writeFileSync(appPath, `${source.slice(0, start)}${replacement}${source.slice(end)}`, 'utf8');
console.log(`Tách ${unique(featureFunctions).length} hàm feature vào public/js/features-dashboard-bundle.js.`);
