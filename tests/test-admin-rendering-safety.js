import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('public/admin/admin.js', 'utf8');

assert.match(source, /const safeMssv = escapeHtml\(s\.mssv\)/);
assert.match(source, /const safeFullName = escapeHtml\(s\.full_name/);
assert.match(source, /const methodCls = `method-\$\{cssToken\(method\)\}`/);
assert.match(source, /data-log="\$\{jsonStr\}"/);
assert.doesNotMatch(source, /class="mssv-tag" style="font-weight: 700;">\$\{s\.mssv\}/);
assert.doesNotMatch(source, /title="\$\{ep\.path\}">\$\{ep\.path\}/);

console.log('✅ Admin dynamic renderers escape or normalize untrusted values.');
