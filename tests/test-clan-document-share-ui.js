import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(dirname, '..');
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const js = fs.readFileSync(path.join(root, 'public/js/app.js'), 'utf8');

assert.match(html, /id="modal-clan-document-share"/, 'Thiếu modal chia sẻ tài liệu');
assert.match(html, /id="clan-document-name"[^>]*required/, 'Tên tài liệu phải là trường bắt buộc');
assert.match(html, /id="clan-document-description"[^>]*required/, 'Mô tả phải là trường bắt buộc');
assert.match(html, /id="clan-document-url"[^>]*type="url"[^>]*required/, 'Link tài liệu phải dùng input URL bắt buộc');
assert.match(js, /openClanDocumentShareModal\(\)/, 'Nút chia sẻ phải mở modal tài liệu');
assert.match(js, /category:\s*'material'/, 'Tài liệu phải được đăng đúng danh mục material');
assert.match(js, /attachments:\s*\[\{\s*url:\s*parsedUrl\.href,\s*title\s*\}\]/, 'Link phải được gửi như một tệp đính kèm');

console.log('✅ PASSED: Popup chia sẻ tài liệu có đủ Tên, Mô tả và Link, đồng thời gửi đúng payload.');
