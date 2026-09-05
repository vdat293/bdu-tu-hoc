import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import { analyzeDocxStructure, formatStructuredDocx } from '../src/utils/docx-structure.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfmt-caption-test-'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const p = (text, style = '', extra = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const table = text => `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p(text)}</w:tc><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p('col2')}</w:tc></w:tr></w:tbl>`;
const drawingParagraph = () => `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1000000" cy="1000000"/><wp:docPr id="1" name="Picture 1"/></wp:inline></w:drawing></w:r></w:p>`;

function fixture(name, body) {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:left="1701" w:right="1134" w:bottom="1134"/></w:sectPr></w:body></w:document>`));
  zip.addFile('word/styles.xml', Buffer.from(`<w:styles xmlns:w="${W}"/>`));
  zip.addFile('word/numbering.xml', Buffer.from(`<w:numbering xmlns:w="${W}"/>`));
  const file = path.join(temp, name + '.docx');
  zip.writeZip(file);
  return file;
}

const profile = JSON.parse(fs.readFileSync(new URL('../profiles/tieu_luan.json', import.meta.url), 'utf8'));
const options = { profile, instructor: 'GVHD', student: 'Sinh viên', frontMatter: '' };

try {
  // Test 1: Bảng và Hình hoàn toàn chưa có caption trong các chương
  const body1 = p('TIỂU LUẬN MÔN HỌC') +
    p('MỞ ĐẦU') +
    p('CHƯƠNG 1: Tổng quan') +
    p('Đoạn văn trước bảng.') +
    table('Dữ liệu bảng 1') +
    p('Đoạn văn sau bảng.') +
    p('CHƯƠNG 2: Thiết kế') +
    p('Đoạn văn trước hình.') +
    drawingParagraph() +
    p('Đoạn văn sau hình.');

  const source1 = fixture('missing-captions', body1);
  const out1 = path.join(temp, 'missing-captions-out.docx');
  const result1 = formatStructuredDocx(source1, out1, options);

  const outZip1 = new AdmZip(out1);
  const $1 = load(outZip1.readAsText('word/document.xml'), { xml: true });
  const paragraphs1 = $1('w\\:p').toArray().map(el => $1(el).find('w\\:t').text().trim()).filter(Boolean);

  // Phải tự sinh caption giữ chỗ
  assert.ok(paragraphs1.some(t => t.startsWith('Bảng 1-1: [Nhập tên bảng]')), 'Phải tự sinh caption giữ chỗ cho Bảng 1-1');
  assert.ok(paragraphs1.some(t => t.startsWith('Hình 2-1: [Nhập tên hình]')), 'Phải tự sinh caption giữ chỗ cho Hình 2-1');

  // Kiểm tra vị trí: Caption bảng phải ở trước bảng, Caption hình phải ở sau hình
  const tableNode1 = $1('w\\:tbl').first();
  const prevToTable = tableNode1.prev();
  assert.ok(prevToTable.find('w\\:t').text().includes('Bảng 1-1: [Nhập tên bảng]'), 'Caption bảng phải nằm ngay phía trên bảng');

  const drawingNode1 = $1('w\\:drawing').first().parents('w\\:p').first();
  const nextToDrawing = drawingNode1.next();
  assert.ok(nextToDrawing.find('w\\:t').text().includes('Hình 2-1: [Nhập tên hình]'), 'Caption hình phải nằm ngay phía dưới hình');

  // Kiểm tra field SEQ
  const tableInstr = prevToTable.find('w\\:instrText').text();
  assert.ok(tableInstr.includes('SEQ Bang'), 'Caption bảng phải dùng field SEQ Bang');

  const figureInstr = nextToDrawing.find('w\\:instrText').text();
  assert.ok(figureInstr.includes('SEQ Hinh'), 'Caption hình phải dùng field SEQ Hinh');

  // Kiểm tra warnings
  const warnings = result1.report.outputNormalization.warnings;
  assert.ok(warnings.some(w => w.includes('[Nhập tên bảng]')), 'Phải có cảnh báo chèn caption giữ chỗ bảng');
  assert.ok(warnings.some(w => w.includes('[Nhập tên hình]')), 'Phải có cảnh báo chèn caption giữ chỗ hình');

  // Test 2: Caption dạng marker không số: Bảng: Tên và Hình: Tên
  const body2 = p('MỞ ĐẦU') +
    p('PHẦN NỘI DUNG') +
    p('CHƯƠNG 1: Phân tích hệ thống') +
    p('Bảng: Danh sách thành viên nhóm') +
    table('Thành viên 1') +
    p('Hình: Kiến trúc giải pháp tổng thể') +
    drawingParagraph(); // Caption hình đặt trước ảnh (ngược vị trí)

  const source2 = fixture('marker-captions', body2);
  const out2 = path.join(temp, 'marker-captions-out.docx');
  formatStructuredDocx(source2, out2, options);

  const outZip2 = new AdmZip(out2);
  const $2 = load(outZip2.readAsText('word/document.xml'), { xml: true });
  const paragraphs2 = $2('w\\:p').toArray().map(el => $2(el).find('w\\:t').text().trim()).filter(Boolean);

  assert.ok(paragraphs2.some(t => t.startsWith('Bảng 1-1: Danh sách thành viên nhóm')), 'Phải đánh số Bảng 1-1 từ marker');
  assert.ok(paragraphs2.some(t => t.startsWith('Hình 1-1: Kiến trúc giải pháp tổng thể')), 'Phải đánh số Hình 1-1 từ marker');

  // Caption hình đặt trước ảnh phải tự động chuyển xuống sau ảnh
  const drawingNode2 = $2('w\\:drawing').first().parents('w\\:p').first();
  const nextToDrawing2 = drawingNode2.next();
  assert.ok(nextToDrawing2.find('w\\:t').text().includes('Hình 1-1: Kiến trúc giải pháp tổng thể'), 'Caption hình phải được tự động chuyển xuống sau hình');

  // Test 3: Caption rỗng Bảng: và Hình:
  const body3 = p('MỞ ĐẦU') +
    p('CHƯƠNG 1: Bảng rỗng') +
    p('Bảng:') +
    table('Bảng không tên') +
    drawingParagraph() +
    p('Hình:');

  const source3 = fixture('empty-markers', body3);
  const out3 = path.join(temp, 'empty-markers-out.docx');
  formatStructuredDocx(source3, out3, options);

  const outZip3 = new AdmZip(out3);
  const $3 = load(outZip3.readAsText('word/document.xml'), { xml: true });
  const paragraphs3 = $3('w\\:p').toArray().map(el => $3(el).find('w\\:t').text().trim()).filter(Boolean);

  assert.ok(paragraphs3.some(t => t.startsWith('Bảng 1-1: [Nhập tên bảng]')), 'Marker rỗng Bảng: phải thành [Nhập tên bảng]');
  assert.ok(paragraphs3.some(t => t.startsWith('Hình 1-1: [Nhập tên hình]')), 'Marker rỗng Hình: phải thành [Nhập tên hình]');

  // Test 4: Nhiều bảng và hình trong cùng một chương
  const body4 = p('MỞ ĐẦU') +
    p('CHƯƠNG 1: Đa đối tượng') +
    table('Bảng thứ nhất') +
    drawingParagraph() +
    table('Bảng thứ hai') +
    drawingParagraph();

  const source4 = fixture('multiple-objects', body4);
  const out4 = path.join(temp, 'multiple-objects-out.docx');
  formatStructuredDocx(source4, out4, options);

  const outZip4 = new AdmZip(out4);
  const $4 = load(outZip4.readAsText('word/document.xml'), { xml: true });
  const paragraphs4 = $4('w\\:p').toArray().map(el => $4(el).find('w\\:t').text().trim()).filter(Boolean);

  assert.ok(paragraphs4.some(t => t.startsWith('Bảng 1-1: [Nhập tên bảng]')), 'Bảng 1-1');
  assert.ok(paragraphs4.some(t => t.startsWith('Bảng 1-2: [Nhập tên bảng]')), 'Bảng 1-2');
  assert.ok(paragraphs4.some(t => t.startsWith('Hình 1-1: [Nhập tên hình]')), 'Hình 1-1');
  assert.ok(paragraphs4.some(t => t.startsWith('Hình 1-2: [Nhập tên hình]')), 'Hình 1-2');

  console.log('✅ All caption placeholder and numbering tests passed successfully!');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
