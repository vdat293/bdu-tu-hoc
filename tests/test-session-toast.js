import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
const showcaseCss = fs.readFileSync(new URL('../public/css/showcase.css', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');

assert.match(app, /showToast\(reason \|\|[^\n]+, 'warning'\)/);
assert.match(css, /\.toast-warning\s*\{[\s\S]*background:\s*rgba\(255, 252, 249, \.98\)/);
assert.match(css, /\.toast-warning[\s\S]*border-left[^;]*#b7791f/);
assert.match(css, /\.toast-warning \.toast-mark[\s\S]*#b7791f/);
assert.match(showcaseCss, /\.toast-warning::after[\s\S]*#8c1515[\s\S]*#b7791f/);

console.log('✓ Session-expired toast uses the warm BDU login palette');
