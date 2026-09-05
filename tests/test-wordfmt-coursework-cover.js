import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import { formatStructuredDocx } from '../src/utils/docx-structure.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfmt-coursework-cover-test-'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const p = (text, style = '', extra = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

function fixture(name, body) {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:left="1701" w:right="1134" w:bottom="1134"/></w:sectPr></w:body></w:document>`));
  zip.addFile('word/styles.xml', Buffer.from(`<w:styles xmlns:w="${W}"/>`));
  zip.addFile('word/numbering.xml', Buffer.from(`<w:numbering xmlns:w="${W}"/>`));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  const file = path.join(temp, name + '.docx');
  zip.writeZip(file);
  return file;
}

try {
  const tieuLuanProfile = JSON.parse(fs.readFileSync(new URL('../profiles/tieu_luan.json', import.meta.url), 'utf8'));
  const gradProfile = JSON.parse(fs.readFileSync(new URL('../profiles/do_an_tot_nghiep.json', import.meta.url), 'utf8'));

  const bodyContent = p('CHƯƠNG 1: Tổng quan') + p('Nội dung chương 1.');
  const srcTieuLuan = fixture('source-tieu-luan', bodyContent);
  const outTieuLuan = path.join(temp, 'out-tieu-luan.docx');

  // 1. Format as tieu_luan with cover requested
  formatStructuredDocx(srcTieuLuan, outTieuLuan, {
    profile: tieuLuanProfile,
    documentType: 'tieu_luan',
    frontMatter: 'cover',
    instructor: 'ThS. Nguyễn Văn A',
    student: 'Trần Văn B',
    studentId: '21050001',
    className: '21TH01',
    topic: 'Nghiên cứu ứng dụng AI'
  });

  const zipTL = new AdmZip(outTieuLuan);
  const $tl = load(zipTL.readAsText('word/document.xml'), { xml: true });

  // Verify tieu_luan has EXACTLY 1 cover border twistedLines1
  assert.equal(
    $tl('w\\:pgBorders w\\:top[w\\:val="twistedLines1"]').length,
    1,
    'Tiểu luận môn phải có chính xác 1 trang bìa viền twistedLines1'
  );

  // Verify BDU logo is embedded
  assert.ok(zipTL.getEntry('word/media/wf-bdu-cover-logo.png'), 'Bìa tiểu luận phải có logo BDU');

  // Verify Wingdings ornament
  assert.equal(
    $tl('w\\:sym[w\\:font="Wingdings"][w\\:char="F026"]').length,
    1,
    'Bìa tiểu luận phải có họa tiết Wingdings'
  );

  // Verify document type title is TIỂU LUẬN MÔN HỌC
  const tlTitle = $tl('w\\:p').filter((_, el) => $tl(el).text().trim() === 'TIỂU LUẬN MÔN HỌC');
  assert.equal(tlTitle.length, 1, 'Bìa tiểu luận phải có tiêu đề TIỂU LUẬN MÔN HỌC');
  assert.equal(tlTitle.find('w\\:spacing').attr('w:before'), '320', 'Tiêu đề có before 16pt (320 dxa)');
  assert.equal(tlTitle.find('w\\:spacing').attr('w:after'), '120', 'Tiêu đề có after 6pt (120 dxa)');

  // Verify metadata fields with proper indents & tab stops
  const instructorP = $tl('w\\:p').filter((_, el) => $tl(el).text().includes('Người hướng dẫn:'));
  assert.equal(instructorP.length, 1, 'Bìa tiểu luận có dòng Người hướng dẫn');
  assert.equal(instructorP.find('w\\:ind').attr('w:left'), '3800', 'Metadata có left indent 3800');
  assert.equal(instructorP.find('w\\:tab').attr('w:pos'), '6500', 'Metadata có tab stop 6500');
  assert.equal(instructorP.find('w\\:spacing').attr('w:before'), '1800', 'Người hướng dẫn có before 90pt (1800 dxa)');

  // Verify date line
  const dateP = $tl('w\\:p').filter((_, el) => $tl(el).text().includes('Thành phố Hồ Chí Minh, tháng'));
  assert.equal(dateP.length, 1, 'Bìa tiểu luận có dòng ngày tháng');
  assert.equal(dateP.find('w\\:spacing').attr('w:before'), '3200', 'Dòng ngày tháng có before 160pt (3200 dxa)');

  // 2. Compare with do_an_tot_nghiep which must have 2 covers
  const srcGrad = fixture('source-grad', p('ĐỀ CƯƠNG ĐỒ ÁN TỐT NGHIỆP') + p('Nội dung đề cương') + bodyContent);
  const outGrad = path.join(temp, 'out-grad.docx');
  formatStructuredDocx(srcGrad, outGrad, {
    profile: gradProfile,
    documentType: 'do_an_tot_nghiep',
    instructor: 'ThS. Nguyễn Văn A',
    student: 'Trần Văn B',
    studentId: '21050001',
    className: '21TH01',
    topic: 'Nghiên cứu ứng dụng AI'
  });

  const zipGrad = new AdmZip(outGrad);
  const $grad = load(zipGrad.readAsText('word/document.xml'), { xml: true });

  // Verify graduation has 2 covers
  assert.equal(
    $grad('w\\:pgBorders w\\:top[w\\:val="twistedLines1"]').length,
    2,
    'Đồ án tốt nghiệp phải có chính xác 2 trang bìa viền twistedLines1'
  );

  const gradTitle = $grad('w\\:p').filter((_, el) => $grad(el).text().trim() === 'ĐỒ ÁN TỐT NGHIỆP');
  assert.equal(gradTitle.length, 2, 'Cả 2 bìa đồ án đều có tiêu đề ĐỒ ÁN TỐT NGHIỆP');

  console.log('✅ All coursework (1 cover) and graduation (2 covers) tests passed 100%!');
} finally {
  for (const f of fs.readdirSync(temp)) fs.unlinkSync(path.join(temp, f));
  fs.rmdirSync(temp);
}
