/**
 * Test nền tảng giao diện /admin sau redesign sang React + Vite.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const adminHtml = fs.readFileSync(path.join(ROOT, 'client/admin.html'), 'utf8');
const adminAppJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/AdminApp.jsx'), 'utf8');
const adminCss = fs.readFileSync(path.join(ROOT, 'client/src/admin/styles/admin.css'), 'utf8');
const iconsJsx = fs.readFileSync(path.join(ROOT, 'client/src/admin/components/Icons.jsx'), 'utf8');
const formatJs = fs.readFileSync(path.join(ROOT, 'client/src/admin/utils/format.js'), 'utf8');

const EMOJI_RE = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;

let failed = 0;
function check(name, fn) {
  try {
    fn();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`✗ ${name}`);
    console.log(`    ${error?.message || error}`);
  }
}

check('theme mặc định là SÁNG (light-first) ở cả markup và React shell', () => {
  assert.match(adminHtml, /<html[^>]*data-theme="light"/, 'client/admin.html phải đặt data-theme="light"');
  assert.match(adminAppJsx, /const DEFAULT_THEME = 'light'/, "AdminApp.jsx phải khai DEFAULT_THEME = 'light'");
  assert.match(adminAppJsx, /===\s*'dark'\s*\?\s*'light'\s*:\s*'dark'/, 'Công tắc theme phải chuyển qua lại dark <-> light');
});

check('token light-first và dark override đã khai báo trong admin.css', () => {
  assert.ok(adminCss.includes('[data-theme="light"]'), 'admin.css thiếu [data-theme="light"]');
  assert.ok(adminCss.includes('[data-theme="dark"]'), 'admin.css thiếu [data-theme="dark"]');
  for (const token of [
    '--color-primary',
    '--color-background',
    '--color-card',
    '--color-foreground',
    '--color-muted-foreground',
    '--color-border',
    '--color-destructive'
  ]) {
    assert.ok(adminCss.includes(token), `admin.css thiếu token ${token}`);
  }
  for (const hex of ['#F8FAFC', '#FFFFFF', '#1E3A8A', '#475569', '#DBEAFE', '#1E40AF', '#3B82F6', '#D97706', '#DC2626', '#E9EEF6']) {
    assert.ok(adminCss.toUpperCase().includes(hex), `admin.css thiếu màu ${hex}`);
  }
});

check('sidebar và icon dùng inline SVG, không dùng emoji', () => {
  assert.match(iconsJsx, /<svg/, 'Icons.jsx phải dựng SVG inline');
  assert.doesNotMatch(adminAppJsx, EMOJI_RE, 'AdminApp.jsx không được chứa emoji');
  assert.doesNotMatch(adminCss, EMOJI_RE, 'admin.css không được chứa emoji');
});

check('helper định dạng số và thời gian dùng chung đã có trong format.js', () => {
  for (const fnName of ['safeNumber', 'formatNumber', 'formatPercent', 'formatDurationMs', 'formatDateTime']) {
    assert.match(formatJs, new RegExp(`export function ${fnName}\\(`), `format.js thiếu helper ${fnName}`);
  }
  assert.match(formatJs, /toLocaleString\('vi-VN'/, 'formatNumber phải dùng locale vi-VN');
});

check('hộp thoại và drawer đều khai báo role="dialog" và hỗ trợ đóng bằng Esc', () => {
  for (const file of ['AuthGateModal.jsx', 'LogDetailModal.jsx', 'PurgeModal.jsx', 'StudentJourneyDrawer.jsx']) {
    const src = fs.readFileSync(path.join(ROOT, 'client/src/admin/components', file), 'utf8');
    assert.match(src, /role="dialog"/, `${file} thiếu role="dialog"`);
    assert.match(src, /aria-modal="true"/, `${file} thiếu aria-modal="true"`);
    assert.match(src, /Escape/, `${file} thiếu xử lý phím Esc`);
  }
});

function readToken(css, theme, name) {
  const startRe = theme === 'dark' ? /\[data-theme="dark"\]\s*\{/ : /:root,\s*\[data-theme="light"\]\s*\{/;
  const start = css.search(startRe);
  assert.ok(start !== -1, `admin.css thiếu khối theme ${theme}`);
  const block = css.slice(start, css.indexOf('\n}', start));
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  assert.ok(match, `admin.css thiếu token ${name} ở theme ${theme}`);
  return match[1].trim();
}

function parseCssColor(value, css, theme, depth = 0) {
  const raw = String(value).trim();
  const ref = raw.match(/^var\((--[a-z-]+)\)$/i);
  if (ref && depth < 5) return parseCssColor(readToken(css, theme, ref[1]), css, theme, depth + 1);
  const hex = raw.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgba = raw.match(/^rgba?\(([^)]+)\)$/i);
  if (rgba) {
    const parts = rgba[1].split(',').map((p) => parseFloat(p));
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  throw new Error(`Không đọc được màu "${raw}"`);
}

function composite(top, bottom) {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
}

function relativeLuminance([r, g, b]) {
  const ch = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

function contrastRatio(fg, bg) {
  const l1 = relativeLuminance(fg);
  const l2 = relativeLuminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

check('chữ trên nền tint đạt >= 4.5:1 ở cả hai theme Light và Dark', () => {
  const pairs = [
    ['--color-success-text', '--tint-success', 'success'],
    ['--color-warning-text', '--tint-warning', 'warning'],
    ['--color-destructive-text', '--tint-danger', 'danger']
  ];
  for (const theme of ['light', 'dark']) {
    const page = parseCssColor(readToken(adminCss, theme, '--color-background'), adminCss, theme);
    const card = composite(parseCssColor(readToken(adminCss, theme, '--color-card'), adminCss, theme), page);
    for (const [textToken, tintToken, label] of pairs) {
      const bg = composite(parseCssColor(readToken(adminCss, theme, tintToken), adminCss, theme), card);
      const fg = parseCssColor(readToken(adminCss, theme, textToken), adminCss, theme);
      const ratio = contrastRatio(fg, bg);
      assert.ok(ratio >= 4.5, `${theme} ${label}: chỉ đạt ${ratio.toFixed(2)}:1`);
    }
  }
});

check('prefers-reduced-motion và chống tràn ngang đã khai báo trong admin.css', () => {
  assert.ok(adminCss.includes('@media (prefers-reduced-motion: reduce)'), 'Thiếu reduced-motion');
  assert.match(adminCss, /\.admin-main-wrapper\s*\{[^}]*min-width:\s*0\s*;/, 'Thiếu min-width: 0');
  assert.match(adminCss, /\.table-scroll\s*\{[^}]*overflow-x:\s*auto/, 'Thiếu .table-scroll overflow-x: auto');
});

check('pill mốc thời gian khai báo aria-pressed trong AdminApp.jsx', () => {
  assert.match(adminAppJsx, /role="group"[^>]*aria-label="Chọn mốc thời gian"/);
  assert.match(adminAppJsx, /aria-pressed=\{active\}/);
});

if (failed > 0) {
  console.log(`✗ Admin redesign UI: ${failed} ca thất bại.`);
  process.exitCode = 1;
} else {
  console.log('✓ Admin redesign UI: toàn bộ ca đạt.');
}
