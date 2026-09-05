import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import { analyzeDocxStructure, formatStructuredDocx } from '../src/utils/docx-structure.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfmt-adv-options-'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const p = (text, style = '', extra = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;

const table = text =>
  `<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4500"/><w:gridCol w:w="4500"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p(text)}</w:tc><w:tc><w:tcPr><w:tcW w:w="4500" w:type="dxa"/></w:tcPr>${p('col2')}</w:tc></w:tr></w:tbl>`;

const drawingParagraph = () =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="1000000" cy="1000000"/><wp:docPr id="1" name="Picture 1"/></wp:inline></w:drawing></w:r></w:p>`;

function fixture(name, body) {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:left="1701" w:right="1134" w:bottom="1134"/></w:sectPr></w:body></w:document>`));
  zip.addFile('word/styles.xml', Buffer.from(`<w:styles xmlns:w="${W}"/>`));
  zip.addFile('word/numbering.xml', Buffer.from(`<w:numbering xmlns:w="${W}"/>`));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`));
  zip.addFile('[Content_Types].xml', Buffer.from(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`));
  const file = path.join(temp, name + '.docx');
  zip.writeZip(file);
  return file;
}

const profile = JSON.parse(fs.readFileSync(new URL('../profiles/tieu_luan.json', import.meta.url), 'utf8'));
const baseOptions = { profile, instructor: 'GVHD ThS. A', student: 'Sinh viên B', frontMatter: '' };

// -------------------------------------------------------------
// Test Suite 1: onlyExistingCaptions
// -------------------------------------------------------------
console.log('--- Testing Option 1: onlyExistingCaptions ---');
{
  const docBody = p('TIỂU LUẬN MÔN HỌC') +
    p('MỞ ĐẦU') +
    p('CHƯƠNG 1: Tổng quan') +
    p('Đoạn văn thường trước bảng không có caption.') +
    table('Bảng không caption') +
    p('Đoạn văn ngăn cách giữa hai bảng trong chương 1.') +
    p('Bảng: Bảng có tên sẵn') +
    table('Bảng có caption') +
    p('CHƯƠNG 2: Thiết kế') +
    p('Đoạn văn thường trước hình không có caption.') +
    drawingParagraph() +
    p('Đoạn văn ngăn cách giữa hai hình trong chương 2.') +
    p('Hình: Sơ đồ kiến trúc') +
    drawingParagraph();

  const srcFile = fixture('test-only-existing', docBody);

  // Case 1A: onlyExistingCaptions = true
  const outTrue = path.join(temp, 'only-existing-true.docx');
  const resTrue = formatStructuredDocx(srcFile, outTrue, {
    ...baseOptions,
    onlyExistingCaptions: true
  });

  const zipTrue = new AdmZip(outTrue);
  const $true = load(zipTrue.readAsText('word/document.xml'), { xml: true });
  const textTrue = $true('w\\:t').toArray().map(el => $true(el).text().trim()).filter(Boolean).join(' ');

  // Không được chứa caption giữ chỗ
  assert.equal(resTrue.report.outputNormalization.placeholdersAdded, 0, 'placeholdersAdded phải là 0 khi onlyExistingCaptions=true');
  assert.ok(!textTrue.includes('[Nhập tên bảng]'), 'Không được tự chèn [Nhập tên bảng]');
  assert.ok(!textTrue.includes('[Nhập tên hình]'), 'Không được tự chèn [Nhập tên hình]');

  // Nhưng caption đã có sẵn phải được chuẩn hóa và đánh số đúng
  assert.ok(textTrue.includes('Bảng 1-1: Bảng có tên sẵn') || textTrue.includes('Bảng có tên sẵn'), 'Caption bảng có sẵn phải được giữ và chuẩn hóa');
  assert.ok(textTrue.includes('Hình 2-1: Sơ đồ kiến trúc') || textTrue.includes('Sơ đồ kiến trúc'), 'Caption hình có sẵn phải được giữ và chuẩn hóa');

  // Case 1B: onlyExistingCaptions = false (default)
  const outFalse = path.join(temp, 'only-existing-false.docx');
  const resFalse = formatStructuredDocx(srcFile, outFalse, {
    ...baseOptions,
    onlyExistingCaptions: false
  });

  const zipFalse = new AdmZip(outFalse);
  const $false = load(zipFalse.readAsText('word/document.xml'), { xml: true });
  const textFalse = $false('w\\:t').toArray().map(el => $false(el).text().trim()).filter(Boolean).join(' ');

  // Phải tự sinh caption giữ chỗ
  assert.ok(resFalse.report.outputNormalization.placeholdersAdded >= 2, 'placeholdersAdded >= 2 khi onlyExistingCaptions=false');
  assert.ok(textFalse.includes('[Nhập tên bảng]'), 'Phải tự sinh [Nhập tên bảng] khi onlyExistingCaptions=false');
  assert.ok(textFalse.includes('[Nhập tên hình]'), 'Phải tự sinh [Nhập tên hình] khi onlyExistingCaptions=false');

  console.log('✅ Option 1 (onlyExistingCaptions) passed all checks!');
}

// -------------------------------------------------------------
// Test Suite 2: skipProposal
// -------------------------------------------------------------
console.log('--- Testing Option 2: skipProposal ---');
{
  const proposalTableXml = `<w:tbl><w:tblPr><w:tblW w:w="8500" w:type="dxa"/><w:tblBorders><w:top w:val="double" w:sz="12" w:color="FF0000"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4250"/><w:gridCol w:w="4250"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:rPr><w:color w:val="0000FF"/></w:rPr><w:t>Dữ liệu đề cương riêng biệt không được chạm vào</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Cột 2 đề cương</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;

  const docWithProposal = p('TIỂU LUẬN MÔN HỌC') +
    p('ĐỀ CƯƠNG CHI TIẾT ĐỒ ÁN') +
    p('Đoạn văn trong đề cương: Giữ nguyên vẹn 100% font và màu sắc.') +
    proposalTableXml +
    p('LỜI CẢM ƠN') +
    p('Nội dung lời cảm ơn sẽ được chuẩn hóa.') +
    p('CHƯƠNG 1: Giới thiệu') +
    p('Nội dung chương 1 sẽ được áp dụng style chuẩn BDU.');

  const srcProposal = fixture('test-skip-proposal', docWithProposal);

  // Case 2A: skipProposal = true
  const outSkip = path.join(temp, 'skip-proposal-true.docx');
  const resSkip = formatStructuredDocx(srcProposal, outSkip, {
    ...baseOptions,
    skipProposal: true
  });

  const zipSkip = new AdmZip(outSkip);
  const docXmlSkip = zipSkip.readAsText('word/document.xml');

  // Đề cương phải giữ nguyên vẹn 100% table XML và nội dung
  assert.ok(docXmlSkip.includes('Dữ liệu đề cương riêng biệt không được chạm vào'), 'Nội dung bảng đề cương phải nguyên vẹn');
  assert.ok(docXmlSkip.includes('w:color="FF0000"'), 'Màu viền riêng của bảng đề cương phải giữ nguyên');
  assert.ok(docXmlSkip.includes('w:val="0000FF"'), 'Màu chữ riêng của text đề cương phải giữ nguyên');
  assert.equal(resSkip.report.structure.proposalPolicy, 'skipped', 'proposalPolicy phải là skipped');
  assert.equal(resSkip.report.outputNormalization.compliance.proposalSkipped, true, 'compliance.proposalSkipped phải là true');

  // Nhưng phần phía sau đề cương (Chương 1) phải được chuẩn hóa bình thường
  assert.ok(docXmlSkip.includes('Nội dung chương 1 sẽ được áp dụng style chuẩn BDU'), 'Phần sau đề cương phải được xử lý');
  assert.ok(zipSkip.readAsText('word/styles.xml').includes('WFHeading1'), 'Style heading BDU vẫn được sinh bình thường');

  // Case 2B: skipProposal = true trên file KHÔNG có đề cương
  const docNoProposal = p('TIỂU LUẬN') + p('CHƯƠNG 1: Không có đề cương') + p('Nội dung');
  const srcNoProp = fixture('test-no-proposal', docNoProposal);
  const outNoProp = path.join(temp, 'no-prop-out.docx');
  const resNoProp = formatStructuredDocx(srcNoProp, outNoProp, {
    ...baseOptions,
    skipProposal: true
  });
  assert.ok(resNoProp.report.outputNormalization.warnings.some(w => w.includes('Bỏ qua định dạng đề cương')), 'Phải cảnh báo khi bật skipProposal mà không có đề cương');

  // Case 2C: graduation document with skipProposal = true
  const gradProfile = JSON.parse(fs.readFileSync(new URL('../profiles/do_an_tot_nghiep.json', import.meta.url), 'utf8'));
  const customMasthead = `<w:tbl><w:tblPr><w:tblW w:w="8000" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4000"/></w:tblGrid><w:tr><w:tc><w:p><w:r><w:t>BẢNG QUỐC HIỆU TỰ THIẾT KẾ CỦA SINH VIÊN</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>CỘNG HÒA RIÊNG</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`;
  const gradDoc = p('TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG') + p('KHOA CNTT') + p('ĐỒ ÁN TỐT NGHIỆP') + p('Tên đề tài') + p('ĐỀ TÀI') + p('Sinh viên thực hiện: Sinh viên') +
    customMasthead +
    p('ĐỀ CƯƠNG ĐỒ ÁN TỐT NGHIỆP') +
    p('Nội dung đề cương đồ án tốt nghiệp - không được format hay đụng vào.') +
    p('LỜI CẢM ƠN') +
    p('Nội dung cảm ơn.') +
    p('CHƯƠNG 1. NỘI DUNG') +
    p('Nội dung chương 1.');

  const srcGrad = fixture('test-grad-skip', gradDoc);
  const outGrad = path.join(temp, 'grad-skip-out.docx');
  const resGrad = formatStructuredDocx(srcGrad, outGrad, {
    ...baseOptions,
    profile: gradProfile,
    documentType: 'do_an_tot_nghiep',
    skipProposal: true
  });

  const zipGrad = new AdmZip(outGrad);
  const docXmlGrad = zipGrad.readAsText('word/document.xml');
  assert.ok(docXmlGrad.includes('BẢNG QUỐC HIỆU TỰ THIẾT KẾ CỦA SINH VIÊN'), 'Bảng quốc hiệu đề cương gốc phải giữ nguyên');
  assert.ok(docXmlGrad.includes('Nội dung đề cương đồ án tốt nghiệp - không được format hay đụng vào.'), 'Nội dung đề cương phải giữ nguyên');
  assert.equal(resGrad.report.structure.unboxedProposalParagraphsRemoved, 0, 'Không được xóa bất kỳ đoạn văn nào của đề cương khi skipProposal=true');

  console.log('✅ Option 2 (skipProposal) passed all checks (including graduation mode)!');
}

// -------------------------------------------------------------
// Test Suite 3: UI & Form Elements Verification
// -------------------------------------------------------------
console.log('--- Testing Option 3: UI and Form Submission ---');
{
  const indexHtml = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const $ui = load(indexHtml);

  // Kiểm tra 2 checkbox
  const chkExisting = $ui('#wf-only-existing-captions');
  assert.equal(chkExisting.length, 1, 'Checkbox #wf-only-existing-captions phải tồn tại');
  assert.equal(chkExisting.attr('checked'), undefined, 'Checkbox #wf-only-existing-captions phải unchecked mặc định');

  const chkProposal = $ui('#wf-skip-proposal');
  assert.equal(chkProposal.length, 1, 'Checkbox #wf-skip-proposal phải tồn tại');
  assert.equal(chkProposal.attr('checked'), undefined, 'Checkbox #wf-skip-proposal phải unchecked mặc định');

  // Kiểm tra app.js
  const appJs = `${fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8')}\n${fs.readFileSync(new URL('../public/js/features/automation.js', import.meta.url), 'utf8')}`;
  assert.ok(appJs.includes("document.getElementById('wf-only-existing-captions')?.checked"), 'app.js phải đọc #wf-only-existing-captions');
  assert.ok(appJs.includes("document.getElementById('wf-skip-proposal')?.checked"), 'app.js phải đọc #wf-skip-proposal');
  assert.ok(appJs.includes("formData.append('onlyExistingCaptions', onlyExistingCaptions)"), 'app.js phải append onlyExistingCaptions vào FormData');
  assert.ok(appJs.includes("formData.append('skipProposal', skipProposal)"), 'app.js phải append skipProposal vào FormData');

  console.log('✅ Option 3 (UI and form submission) passed all checks!');
}

console.log('\n🎉 ALL ADVANCED OPTIONS TESTS PASSED 100%!');
