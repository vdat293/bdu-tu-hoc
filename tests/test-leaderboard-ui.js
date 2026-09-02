import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

assert.match(html, /data-tab="tab-leaderboard"/);
assert.match(html, /<span class="nav-icon">04<\/span>[\s\S]*Bảng Xếp Hạng/);
assert.doesNotMatch(html, /id="leaderboard-cohort-select"/);
assert.match(html, /data-scope="class"/);
assert.match(html, /data-scope="faculty"/);
assert.match(html, /data-scope="institute"/);
assert.match(html, /data-scope="school"/);
assert.match(html, /id="stat-gpa-school-rank"/);
assert.match(html, /id="stat-gpa-10-school-rank"/);
assert.match(html, /id="stat-credit-school-rank"/);
assert.doesNotMatch(html, /id="academic-ranking-panel"/);
assert.doesNotMatch(html, /Dense rank/i);
assert.match(app, /#\$\{rank\.hang\} \$\{rank\.pham_vi\}/);
assert.match(app, /xep_hang_noi_bat/);
assert.match(app, /stat-gpa-10-school-rank/);
assert.match(app, /stat-credit-school-rank/);
assert.match(app, /Tự động theo Khóa/);
assert.doesNotMatch(app, /available_cohorts/);
assert.match(app, /createTextNode|textContent/);

console.log('✓ Inline best-looking rank and automatic class/faculty/institute leaderboard UI');
