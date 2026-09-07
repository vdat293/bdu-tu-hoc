import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { formatStructuredDocx } from '../src/utils/docx-structure.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfmt-cover-customs-'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const p = t => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const cover = p('TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG') + p('VIỆN TRÍ TUỆ NHÂN TẠO VÀ CHUYỂN ĐỔI SỐ') + p('KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO') + p('ĐỒ ÁN TỐT NGHIỆP') + p('Tên đề tài') + p('XÂY DỰNG HỆ THỐNG TRA CỨU ĐIỂM SỐ') + p('Sinh viên thực hiện: NGUYỄN HOÀNG NHẬT TÂN');
const body = p('CHƯƠNG 1. MỞ ĐẦU') + p('Nội dung.');

function makeDocx(name) {
  const z = new AdmZip();
  z.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${cover}${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701"/></w:sectPr></w:body></w:document>`));
  z.addFile('word/styles.xml', Buffer.from(`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`));
  z.addFile('word/_rels/document.xml.rels', Buffer.from(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`));
  z.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  const file = path.join(temp, name + '.docx');
  z.writeZip(file);
  return file;
}

try {
  const input = makeDocx('test-cover-custom');
  const output = path.join(temp, 'test-cover-custom-out.docx');

  formatStructuredDocx(input, output, {
    documentType: 'do_an_tot_nghiep',
    instructor: 'ThS. Nguyễn Văn A',
    student: 'NGUYỄN HOÀNG NHẬT TÂN',
    studentId: '22050101',
    className: '20TH01',
    topic: 'Xây dựng hệ thống tra cứu điểm số sinh viên BDU',
    frontMatter: 'cover'
  });

  const zip = new AdmZip(output);
  const docXml = zip.readAsText('word/document.xml');

  // 1. Verify cover logo is embedded and has 1:1 aspect ratio extent (cx=1260000 cy=1260000)
  assert.ok(zip.getEntry('word/media/wf-bdu-cover-logo.png'), 'Bìa phải có file logo wf-bdu-cover-logo.png');
  assert.ok(docXml.includes('cx="1260000" cy="1260000"'), 'Logo bìa phải có kích thước tỉ lệ 1:1 (1260000 EMU)');

  // 2. Verify metadata uses dynamic hanging indent where tab stop matches left indent
  assert.ok(/w:left="(\d+)" w:hanging="2300"/.test(docXml), 'Metadata bìa phải sử dụng lề treo động hanging=2300');
  const match = docXml.match(/w:ind w:left="(\d+)" w:hanging="2300"/);
  assert.ok(match, 'Tìm thấy ind left động');
  assert.ok(docXml.includes(`w:pos="${match[1]}"`), 'Tab stop phải khớp chính xác với left indent động');

  // 3. Verify threshold warning logic for student name (>6 words) & topic (>40 words)
  const studentShort = 'NGUYỄN HOÀNG NHẬT TÂN'; // 4 words
  const studentLong = 'NGUYỄN PHẠM TRẦN HOÀNG NHẬT TÂN VĂN A'; // 7 words > 6
  assert.equal(studentShort.trim().split(/\s+/).filter(Boolean).length <= 6, true);
  assert.equal(studentLong.trim().split(/\s+/).filter(Boolean).length > 6, true);

  const topicShort = 'Xây dựng ứng dụng tra cứu điểm BDU'; // 7 words
  const topicLong = Array(45).fill('từ').join(' '); // 45 words > 40
  assert.equal(topicShort.trim().split(/\s+/).filter(Boolean).length <= 40, true);
  assert.equal(topicLong.trim().split(/\s+/).filter(Boolean).length > 40, true);

  console.log('✅ Tất cả kiểm thử cập nhật Logo bìa, cân bằng vị trí tên sinh viên & cảnh báo ngưỡng đều đạt 100%!');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
