import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync('public/index.html', 'utf8');
const app = fs.readFileSync('public/js/app.js', 'utf8');
const interactions = fs.readFileSync('public/js/interactions.js', 'utf8');
const showcaseStyle = fs.readFileSync('public/css/showcase.css', 'utf8');
const loader = fs.readFileSync('public/js/core/view-fragment-loader.js', 'utf8');
const styleLoader = fs.readFileSync('public/js/core/style-loader.js', 'utf8');
const server = fs.readFileSync('server.js', 'utf8');
const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const featureBundles = ['automation', 'learning', 'community'].map(name => fs.readFileSync(`public/js/features/${name}.js`, 'utf8'));
assert.doesNotMatch(html, /js\/features\//, 'Feature bundle nặng không được chặn tải trang login');
const deferredIds = ['tab-leaderboard', 'tab-wordfmt', 'tab-survey', 'tab-english', 'tab-enrollment', 'tab-learning', 'tab-clans', 'tab-confession'];

for (const id of deferredIds) {
  assert.match(html, new RegExp(`id="bdu-view-fragment-${id}"`), `${id} phải có template fragment`);
  assert.match(html, new RegExp(`<section id="${id}"`), `${id} phải tồn tại trong fragment`);
}

const withoutTemplates = html.replace(/<template\b[\s\S]*?<\/template>/gi, '');
assert.equal((html.match(/<template id="bdu-view-fragment-/g) || []).length, deferredIds.length, 'Số fragment phải đúng với danh sách lazy view');
assert.equal((withoutTemplates.match(/<section id="tab-/g) || []).length, 3, 'Chỉ giữ grades/profile/schedule trong DOM ban đầu');
assert.match(loader, /BDUViewFragments/);
assert.match(loader, /template\.replaceWith\(content\)/);
assert.match(app, /BDUViewFragments\?\.mount\(tabId\)/);
assert.match(app, /ensureFeatureInitialized\(tabId\)/);
assert.match(app, /import\(moduleUrl\)/, 'Feature nặng phải dùng native import()');
assert.match(app, /features\/(?:automation|learning|community)\.js\?v=20260905-perf-v22/, 'Feature bundle phải được version hóa');
for (const featureBundle of featureBundles) assert.match(featureBundle, /export function initialize\(tabId\)/, 'Feature bundle phải có entrypoint lazy');
assert.match(app, /window\.BDUAppRuntime\s*=/, 'Core phải công bố runtime bridge tường minh');
assert.match(app, /\bconfession:\s*\{[\s\S]*?framePreview:\s*null/, 'Core phải khởi tạo state confession trước khi module cộng đồng tải lười');
assert.match(showcaseStyle, /html\[data-motion="reduced"\] \.tab-pane\s*\{\s*animation:\s*none\s*!important;/, 'Reduced motion không được giữ tab ở opacity 0');
assert.match(showcaseStyle, /\.parallax-type[\s\S]*?opacity:\s*\.048/, 'Watermark BDU nền phải đủ rõ để nhận diện');
assert.match(interactions, /logo-bdu-eng-1024\.webp/, 'Watermark BDU phải dùng asset độ phân giải đủ cao');
assert.match(html, /<picture class="brand-watermark-wrap">[\s\S]*?hero-brand-watermark/, 'Hero watermark phải có wrapper giữ đúng hệ tọa độ');
assert.match(showcaseStyle, /\.hero-profile > :not\(\.brand-watermark\):not\(\.brand-watermark-wrap\)/, 'Wrapper watermark không được chiếm gap của nội dung hero');
assert.match(showcaseStyle, /\.brand-watermark-wrap \{ position: absolute; inset: 0; display: block; z-index: 0;/, 'Wrapper watermark phải phủ đúng toàn bộ khối chứa');
assert.match(showcaseStyle, /html\[data-motion="reduced"\] \.hero-overall-rank-badge[\s\S]*?-webkit-text-fill-color: var\(--rank-color\)/, 'Badge thứ hạng phải còn chữ khi giảm hiệu ứng');
assert.match(app, /BDUClientStyles\?\.ensureDashboard/, 'Dashboard CSS phải tải sau khi xác thực');
assert.match(app, /BDUClientStyles\?\.resetLogin/, 'Logout phải bật lại login CSS');
assert.match(styleLoader, /const version = '20260905-perf-v22'/, 'Style loader phải version hóa dashboard CSS');
assert.match(styleLoader, /insertBefore\(link, showcase\)/, 'Dashboard CSS phải đứng trước showcase CSS để giữ đúng cascade');
const bootBlock = app.slice(app.indexOf('function bootApplication()'), app.indexOf('window.BDUAppBoot'));
for (const initializer of ['initLeaderboard()', 'initWordFmtTool()', 'initSurveyBot()', 'initEnglishExerciseBot()', 'initLearningHub()', 'initClansModule()', 'initConfessionModule()']) {
  assert.doesNotMatch(bootBlock, new RegExp(`\\b${initializer.replace(/[()]/g, '\\$&')}`), `${initializer} không được chạy eager trong boot`);
}
const outsidePicture = html.replace(/<picture\b[\s\S]*?<\/picture>/gi, '');
assert.doesNotMatch(outsidePicture, /<img[^>]+assets\/images\/(?:logo-bdu-eng|logo-hao-quang-transparent)\.png/i, 'Logo PNG phải có fallback trong picture WebP');
assert.ok((html.match(/<source type="image\/webp"[^>]+assets\/images\/(?:logo-bdu-eng|logo-hao-quang)/gi) || []).length >= 10, 'Các logo dashboard phải có source WebP');
assert.equal(packageJson.scripts['compress:assets'], 'node scripts/compress-public-assets.mjs', 'Phải có lệnh tạo Brotli sidecar');
assert.match(server, /Content-Encoding', 'br'/, 'Server phải phục vụ Brotli khi client hỗ trợ');
assert.match(server, /Vary', 'Accept-Encoding'/, 'Brotli response phải khai báo Vary');
assert.ok(fs.statSync('public/css/style.css.br').size < fs.statSync('public/css/style.css').size, 'Brotli CSS phải nhỏ hơn bản nguồn');
assert.match(html, /css\/login\.min\.css\?v=20260905-perf-v22/, 'HTML phải dùng login CSS minified có version');
assert.match(html, /css\/showcase\.min\.css\?v=20260905-perf-v22/, 'HTML phải dùng showcase CSS minified có version');
assert.ok(fs.statSync('public/css/login.min.css').size < fs.statSync('public/css/login.css').size, 'Login CSS minified phải nhỏ hơn source');
assert.ok(fs.statSync('public/css/login.min.css.br').size < fs.statSync('public/css/login.min.css').size, 'Login CSS Brotli phải nhỏ hơn bản minified');
assert.equal(packageJson.scripts['split:css'], 'node scripts/split-public-css.mjs', 'Phải có lệnh tái tạo login CSS split');
assert.ok(fs.statSync('public/css/style.min.css').size < fs.statSync('public/css/style.css').size, 'CSS minified phải nhỏ hơn source');
console.log('✓ Client view fragments and lazy feature initialization contract passed');
