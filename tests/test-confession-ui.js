import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const appJs = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const styleCss = fs.readFileSync(new URL('../public/css/style.css', import.meta.url), 'utf8');
const showcaseCss = fs.readFileSync(new URL('../public/css/showcase.css', import.meta.url), 'utf8');

const confessionSection = html.match(/<section id="tab-confession"[\s\S]*?<\/section>/)?.[0] || '';
const deleteModal = html.match(/<!-- Modal: Xác nhận xóa bài viết -->[\s\S]*?<!-- ={10,}/)?.[0] || '';
const deleteHandler = appJs.match(/container\.querySelectorAll\('\.btn-delete-post'\)[\s\S]*?\/\/ Toggle Comments/)?.[0] || '';
const forumRenderer = appJs.match(/function renderConfessionCardHtml[\s\S]*?async function handleSubmitConfession/)?.[0] || '';

assert.ok(confessionSection, 'Phải tìm thấy khu vực Confession.');
assert.doesNotMatch(confessionSection, /<svg\b|widget-icon|platform-icon/, 'Confession phải dùng giao diện text-first, không có icon trang trí.');
assert.equal((confessionSection.match(/class="forum-widget glass-panel"/g) || []).length, 2, 'Sidebar Confession chỉ được giữ hai widget chính.');
assert.doesNotMatch(confessionSection, /BẢNG VINH DANH HỌC THUẬT|NỘI QUY & BẢO MẬT/);
assert.match(confessionSection, /forum-hero-banner[\s\S]*?forum-two-column-layout[\s\S]*?forum-main-column[\s\S]*?forum-quick-composer[\s\S]*?forum-sidebar-column/, 'Hero phải full-width; sidebar phải bắt đầu ngang hàng với khu đăng bài.');

assert.ok(deleteModal.includes('id="modal-delete-post"'), 'Phải có modal xác nhận xóa tùy biến.');
assert.doesNotMatch(deleteModal, /<svg\b/, 'Modal xóa không được dùng icon trang trí.');
assert.match(deleteModal, /Giữ lại bài viết/);
assert.match(deleteModal, /Xóa bài viết/);

assert.match(deleteHandler, /requestDeletePostConfirmation/);
assert.doesNotMatch(deleteHandler, /\bconfirm\s*\(/, 'Xóa bài không được dùng popup confirm mặc định của trình duyệt.');
assert.doesNotMatch(forumRenderer, /<svg\b/, 'Card Confession không được chèn icon thao tác.');
assert.match(styleCss, /--forum-surface:\s*rgba\(255, 253, 249, 0\.96\)/, 'Card sáng phải đủ đục để đọc nội dung.');
assert.match(styleCss, /#tab-confession \.forum-post-card\s*\{[\s\S]*?background:\s*var\(--forum-surface\)/);
assert.match(styleCss, /#tab-confession \.forum-widget\s*\{[\s\S]*?background:\s*var\(--forum-surface\)/);
assert.match(styleCss, /#tab-confession \.forum-sidebar-column\s*\{[\s\S]*?position:\s*sticky;[\s\S]*?top:\s*-20px;[\s\S]*?margin-top:\s*0;/, 'Sidebar desktop phải kích hoạt sticky muộn mà không dịch vị trí ban đầu.');
assert.doesNotMatch(styleCss, /#tab-confession \.classroom-card-thumb svg[\s\S]{0,120}display:\s*none/, 'Logo Drive trong thẻ tài liệu phải được hiển thị.');
assert.match(showcaseCss, /\.parallax-type\s*\{[\s\S]*?opacity:\s*\.022/, 'Watermark nền phải đủ nhẹ để không xuyên qua nội dung.');

console.log('✓ Confession dùng modal xóa tùy biến, giao diện text-first và surface dễ đọc.');
