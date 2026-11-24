import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import { analyzeDocxStructure, buildStructurePreview, formatStructuredDocx, computeHeaderLayout } from '../src/utils/docx-structure.js';
import { computeBalancedCenteredWrap, getCurrentMonthYear } from '../src/utils/docx-graduation-cover.js';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfmt-2026-fixes-'));
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';

const p = (text, style = '', extraPPr = '', extraRPr = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extraPPr}</w:pPr><w:r>${extraRPr ? `<w:rPr>${extraRPr}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

function fixture(name, bodyXml) {
  const zip = new AdmZip();
  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:m="${M}"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:left="1701" w:right="1134" w:bottom="1134"/></w:sectPr></w:body></w:document>`
    )
  );
  zip.addFile('word/styles.xml', Buffer.from(`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`));
  zip.addFile('word/numbering.xml', Buffer.from(`<w:numbering xmlns:w="${W}"/>`));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  const file = path.join(temp, `${name}.docx`);
  zip.writeZip(file);
  return file;
}

try {
  const tieuLuanProfile = JSON.parse(fs.readFileSync(new URL('../profiles/tieu_luan.json', import.meta.url), 'utf8'));
  const gradProfile = JSON.parse(fs.readFileSync(new URL('../profiles/do_an_tot_nghiep.json', import.meta.url), 'utf8'));
  const { month: expectedCurMonth, year: expectedCurYear } = getCurrentMonthYear();

  // ---------------------------------------------------------------------------
  // 1. Coursework E2E: Cover label, anti-orphan faculty/topic, auto month/year,
  //    Header/Footer from Lời cảm ơn onwards, right-aligned signature & math!
  // ---------------------------------------------------------------------------
  const courseworkBody = [
    p('NHẬN XÉT CỦA GIẢNG VIÊN'),
    p('LỜI CẢM ƠN'),
    p('Em xin cảm ơn giảng viên phụ trách học phần Nhập môn trí tuệ nhân tạo đã trang bị những kiến thức nền tảng về tìm kiếm, học máy và phương pháp đánh giá mô hình.'),
    p('Những thiếu sót trong cách trình bày và phân tích thuộc trách nhiệm của em. Em trân trọng các ý kiến góp ý của giảng viên để hoàn thiện báo cáo.'),
    p('SINH VIÊN THỰC HIỆN', '', '<w:jc w:val="right"/>', '<w:b/>'),
    p('Nguyễn Vũ Đạt', '', '<w:jc w:val="right"/>'),
    p('MỤC LỤC'),
    p('CHƯƠNG 1. CƠ SỞ LÝ THUYẾT'),
    p('1.3. Các thuật toán hồi quy'),
    p('Với d đặc trưng, mô hình tuyến tính dùng hệ số chặn b và véc-tơ trọng số w. Bình phương tối thiểu (OLS) ước lượng các tham số sao cho tổng bình phương phần dư nhỏ nhất.'),
    p('ŷᵢ = b + wᵀxᵢ    MSE = (1/n) Σᵢ (yᵢ - ŷᵢ)²'),
    p('1.3.2. Hồi quy Logistic nhị phân'),
    p('Với nhãn y ∈ {0, 1}, hồi quy Logistic ánh xạ điểm số z = b + wᵀx sang xác suất p của lớp dương tính bằng hàm Sigmoid.'),
    p('p = 1/(1 + exp(-z))'),
    p('BCE = -(1/n) Σᵢ [yᵢ ln(pᵢ) + (1 - yᵢ) ln(1 - pᵢ)]'),
    p('1.3.3. Hồi quy Logistic đa lớp Softmax'),
    p('pₖ = exp(zₖ) / Σⱼ exp(zⱼ)    ŷ = argmaxₖ pₖ'),
    p('CE = -(1/n) Σᵢ Σₖ yᵢₖ ln(pᵢₖ)'),
    p('Với J bằng nửa MSE, gradient theo w là Xᵀ(ŷ - y)/n và theo b là trung bình phần dư dự đoán.'),
    p('θ mới = θ cũ − η ∇J(θ cũ)'),
    p('Ridge: SSE + α Σⱼ wⱼ²    Lasso: SSE/(2n) + α Σⱼ |wⱼ|'),
    p('MAE = (1/n) Σᵢ |yᵢ - ŷᵢ|    RMSE = √MSE    R² = 1 − SSE/SST'),
    // Native OMML equation right before next chapter (must NOT be pruned as empty paragraph!)
    `<w:p><m:oMathPara><m:oMath><m:r><m:t>J(w) = 1/2n ||Xw - y||^2</m:t></m:r></m:oMath></m:oMathPara></w:p>`,
    p('CHƯƠNG 2. THỰC NGHIỆM'),
    // Three consecutive numbered tabbed equations (must NOT be converted into a table!)
    `<w:p><w:r><w:t>y = ax + b</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>(2.1)</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t>z = cx + d</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>(2.2)</w:t></w:r></w:p>`,
    `<w:p><w:r><w:t>u = ex + f</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>(2.3)</w:t></w:r></w:p>`
  ].join('');

  const srcCoursework = fixture('coursework-all-fixes', courseworkBody);

  // Verify preview does not mark SINH VIÊN THỰC HIỆN as suspect major_title and detects equations
  const previewAnalysis = analyzeDocxStructure(srcCoursework);
  const preview = buildStructurePreview(previewAnalysis);
  const sigPreview = preview.items.find(item => item.t === 'SINH VIÊN THỰC HIỆN');
  assert.ok(sigPreview, 'Preview includes SINH VIÊN THỰC HIỆN');
  assert.equal(sigPreview.role, 'signature', 'SINH VIÊN THỰC HIỆN is classified as signature');
  assert.equal(sigPreview.suspect, undefined, 'SINH VIÊN THỰC HIỆN is not flagged as suspect heading');
  assert.ok(preview.summary.equationCount >= 12, 'Preview detects all standalone and OMML equations');

  const outCoursework = path.join(temp, 'out-coursework-fixes.docx');
  const resCoursework = formatStructuredDocx(srcCoursework, outCoursework, {
    profile: tieuLuanProfile,
    documentType: 'tieu_luan',
    frontMatter: 'cover,comments,thanks',
    instructor: 'ThS. Nguyễn Hồ Hải',
    student: 'Nguyễn Vũ Đạt',
    studentId: '24050001',
    className: '2405SE01',
    // Topic that would leave 1 orphan word ("BDU") on line 2 at 20pt without balanced symmetric wrap
    topic: 'XÂY DỰNG HỆ THỐNG QUẢN LÝ ĐIỂM SỐ BDU'
    // month & year intentionally omitted -> must auto-fill current month/year!
  });

  const zipCW = new AdmZip(outCoursework);
  const $cw = load(zipCW.readAsText('word/document.xml'), { xml: true });

  // Requirement 1: "Giảng viên hướng dẫn:" instead of "Người hướng dẫn:"
  assert.equal($cw.text().includes('Người hướng dẫn:'), false, 'Cover must not use Người hướng dẫn:');
  assert.equal(
    $cw('w\\:p').filter((_, el) => $cw(el).text().includes('Giảng viên hướng dẫn:')).length,
    1,
    'Cover must display Giảng viên hướng dẫn:'
  );

  // Requirement 3: Faculty line scaled so "TẠO" never drops alone onto line 2, and orphan topic balanced
  const facultyP = $cw('w\\:p').filter((_, el) => $cw(el).text().trim() === 'KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO');
  assert.equal(facultyP.length, 1, 'Faculty line exists on cover');
  const facultyHalfPt = Number(facultyP.find('w\\:sz').first().attr('w:val'));
  assert.ok(facultyHalfPt <= 27, `Faculty font size (${facultyHalfPt / 2}pt) auto-fits within 16cm so "TẠO" never wraps alone`);

  const orphanCheck = computeBalancedCenteredWrap('XÂY DỰNG HỆ THỐNG QUẢN LÝ ĐIỂM SỐ BDU', 20, 9071);
  assert.ok(orphanCheck.indentDxa > 0, 'Orphan 1-word wrap triggers positive symmetric indent');
  const topicP = $cw('w\\:p').filter((_, el) => $cw(el).text().trim() === 'XÂY DỰNG HỆ THỐNG QUẢN LÝ ĐIỂM SỐ BDU');
  assert.equal(topicP.find('w\\:ind').attr('w:left'), String(orphanCheck.indentDxa));
  assert.equal(topicP.find('w\\:ind').attr('w:right'), String(orphanCheck.indentDxa));

  // Requirement 4: Auto-fill current month & year when user leaves month/year blank
  const expectedDateLine = `Thành phố Hồ Chí Minh, tháng ${expectedCurMonth} năm ${expectedCurYear}`;
  assert.equal(
    $cw('w\\:p').filter((_, el) => $cw(el).text().trim() === expectedDateLine).length,
    1,
    `Cover auto-fills current month/year: "${expectedDateLine}"`
  );

  // Requirement 2 (Coursework): Header & Footer hidden on Cover (sec 0) and Nhận xét (sec 1),
  // shown from Lời cảm ơn (sec 2) onwards; lowerRoman starts at 1 on Nhận xét (sec 1)!
  const cwSections = $cw('w\\:sectPr').toArray();
  const cwRels = load(zipCW.readAsText('word/_rels/document.xml.rels'), { xml: true });
  const targetByRelId = id => cwRels(`Relationship[Id="${id}"]`).attr('Target');
  const headerXmlAt = idx => {
    const rId = $cw(cwSections[idx]).find('w\\:headerReference[w\\:type="default"]').attr('r:id');
    return zipCW.readAsText(`word/${targetByRelId(rId)}`);
  };
  const footerXmlAt = idx => {
    const rId = $cw(cwSections[idx]).find('w\\:footerReference[w\\:type="default"]').attr('r:id');
    return zipCW.readAsText(`word/${targetByRelId(rId)}`);
  };

  // Section 0 = Cover, Section 1 = Nhận xét của giảng viên, Section 2 = Lời cảm ơn, Section 3 = Mục lục...
  assert.equal(headerXmlAt(0).includes('<w:tbl>'), false, 'Cover has no header table');
  assert.equal(footerXmlAt(0).includes('<w:tbl>'), false, 'Cover has no footer table');
  assert.equal(headerXmlAt(1).includes('<w:tbl>'), false, 'Nhận xét của giảng viên has no header');
  assert.equal(footerXmlAt(1).includes('<w:tbl>'), false, 'Nhận xét của giảng viên has no footer');
  assert.equal($cw(cwSections[1]).find('w\\:pgNumType').attr('w:fmt'), 'lowerRoman');
  assert.equal($cw(cwSections[1]).find('w\\:pgNumType').attr('w:start'), '1', 'lowerRoman counting starts right after cover');

  assert.equal(headerXmlAt(2).includes('LỜI CẢM ƠN'), true, 'Lời cảm ơn shows Header');
  assert.equal(footerXmlAt(2).includes('PAGE'), true, 'Lời cảm ơn shows Footer with PAGE field');
  assert.equal($cw(cwSections[2]).find('w\\:pgNumType').attr('w:fmt'), 'lowerRoman');
  assert.equal($cw(cwSections[2]).find('w\\:pgNumType').attr('w:start'), undefined, 'Lời cảm ơn continues lowerRoman count (ii)');

  // Requirement 5: Lời cảm ơn signature block stays right-aligned, bold role, spaced cleanly
  const sigRoleP = $cw('w\\:p').filter((_, el) => $cw(el).text().trim() === 'SINH VIÊN THỰC HIỆN');
  const sigNameP = $cw('w\\:p').filter((_, el) => $cw(el).text().trim() === 'Nguyễn Vũ Đạt');
  assert.equal(sigRoleP.length, 1);
  assert.equal(sigNameP.length, 1);
  assert.equal(sigRoleP.find('w\\:pStyle').attr('w:val'), 'WFSignature');
  assert.equal(sigRoleP.find('w\\:jc').attr('w:val'), 'right', 'SINH VIÊN THỰC HIỆN stays right-aligned');
  assert.ok(sigRoleP.find('w\\:b').length > 0, 'SINH VIÊN THỰC HIỆN stays bold');
  assert.ok(Number(sigRoleP.find('w\\:spacing').attr('w:after')) >= 480, 'Signature role preserves clean signing space before name');
  assert.equal(sigNameP.find('w\\:pStyle').attr('w:val'), 'WFSignature');
  assert.equal(sigNameP.find('w\\:jc').attr('w:val'), 'right', 'Student signature name stays right-aligned');

  // Requirement 6: Mathematical formulas are upgraded into native Word OMML (<m:oMathPara>/<m:oMath>)
  // with stacked fractions (<m:f>), summations (<m:nary>), accents (<m:acc>), radicals (<m:rad>),
  // under-limits (<m:limLow>), sub/superscripts (<m:sSub>/<m:sSup>/<m:sSubSup>), and Cambria Math!
  const equationParas = $cw('w\\:p').filter((_, el) => $cw(el).find('w\\:pStyle').attr('w:val') === 'WFEquation');
  assert.equal(equationParas.length, 12, 'All 12 standalone/OMML/numbered equations use WFEquation');

  // Sigmoid formula: p = 1/(1 + exp(-z)) -> real stacked fraction <m:f> with num=1, den=1+exp(−z)
  const sigmoidP = equationParas.filter((_, el) => $cw(el).text().includes('exp') && !$cw(el).text().includes('argmax'));
  assert.equal(sigmoidP.length, 1, 'Sigmoid equation upgraded to OMML');
  assert.equal(sigmoidP.find('m\\:oMathPara m\\:jc').attr('m:val'), 'center');
  assert.equal(sigmoidP.find('m\\:f m\\:num').text().trim(), '1', 'Sigmoid numerator is 1');
  assert.ok(sigmoidP.find('m\\:f m\\:den').text().includes('1+exp'), 'Sigmoid denominator is 1 + exp(−z)');

  // Softmax formula: pₖ = exp(zₖ) / Σⱼ exp(zⱼ)    ŷ = argmaxₖ pₖ
  const softmaxP = equationParas.filter((_, el) => $cw(el).text().includes('argmax'));
  assert.equal(softmaxP.length, 1, 'Softmax equation upgraded to OMML');
  assert.equal(softmaxP.find('m\\:f').length, 1, 'Softmax has stacked fraction exp(z_k) / ∑_j exp(z_j)');
  assert.equal(softmaxP.find('m\\:f m\\:den m\\:nary').length, 1, 'Softmax denominator contains ∑_j');
  assert.equal(softmaxP.find('m\\:limLow').length, 1, 'argmax_k uses display under-limit <m:limLow>');
  assert.ok(softmaxP.find('m\\:acc').length >= 1, 'ŷ uses real math hat accent <m:acc>');

  // Ridge/Lasso & MAE/RMSE/R²: verify <m:sSubSup> (w_j^2), <m:rad> (√MSE), <m:d> (|w_j|, [...])
  assert.ok($cw('m\\:f').length >= 7, 'All fractional expressions converted to real stacked <m:f>');
  assert.ok($cw('m\\:nary').length >= 8, 'All Σ summations converted to real <m:nary>');
  assert.ok($cw('m\\:rad').length >= 1, '√MSE converted to real radical <m:rad>');
  assert.ok($cw('m\\:sSubSup').length >= 1, 'w_j^2 converted to simultaneous <m:sSubSup>');
  assert.ok($cw('m\\:d').length >= 8, 'Brackets, parens, and absolute bars use auto-scaling <m:d>');
  assert.equal($cw('w\\:document').attr('xmlns:m'), M, 'Document root declares xmlns:m math namespace');
  assert.equal(load(zipCW.readAsText('word/settings.xml'), { xml: true })('m\\:mathPr m\\:mathFont').attr('m:val'), 'Cambria Math');

  const inlineMathProse = $cw('w\\:p').filter((_, el) => $cw(el).text().includes('hồi quy Logistic ánh xạ điểm số'));
  assert.equal(inlineMathProse.find('w\\:pStyle').attr('w:val'), 'WFBody', 'Prose mentioning inline math stays WFBody');

  assert.equal($cw('m\\:oMathPara').length, 9, '8 upgraded display formulas + 1 native OMML equation at chapter end survive');
  assert.equal(resCoursework.report.outputNormalization.tabbedTablesConverted, 0, 'Numbered tabbed equations are not turned into a table');
  const numberedEq = $cw('w\\:p').filter((_, el) => $cw(el).text().includes('(2.1)'));
  assert.equal(numberedEq.find('w\\:pStyle').attr('w:val'), 'WFEquation');
  assert.equal(numberedEq.find('m\\:oMath').length, 1, 'Numbered equation also upgraded to inline OMML alongside tab number');
  assert.equal(numberedEq.find('w\\:tab[w\\:val="center"][w\\:pos="4536"]').length, 1);
  assert.equal(numberedEq.find('w\\:tab[w\\:val="right"][w\\:pos="9071"]').length, 1);

  // Verify idempotency when formatting the output DOCX a second time
  const outCourseworkAgain = path.join(temp, 'out-coursework-again.docx');
  const resAgain = formatStructuredDocx(outCoursework, outCourseworkAgain, {
    profile: tieuLuanProfile,
    documentType: 'tieu_luan',
    frontMatter: 'cover,comments,thanks',
    instructor: 'ThS. Nguyễn Hồ Hải',
    student: 'Nguyễn Vũ Đạt',
    studentId: '24050001',
    className: '2405SE01',
    topic: 'XÂY DỰNG HỆ THỐNG QUẢN LÝ ĐIỂM SỐ BDU'
  });
  const $cw2 = load(new AdmZip(outCourseworkAgain).readAsText('word/document.xml'), { xml: true });
  assert.equal($cw2('m\\:oMathPara').length, $cw('m\\:oMathPara').length, 'OMML equations are idempotent on repeated formatting');
  assert.equal(resAgain.report.outputNormalization.compliance.wordprocessingPropertyOrder, true);

  // ---------------------------------------------------------------------------
  // 2. Graduation Thesis E2E: 2 covers (uncounted) + Đề cương (i) + Nhận xét GVHD (ii)
  //    + Nhận xét GVPB (iii) + Lời cảm ơn (iv -> FIRST section with Header/Footer!)
  // ---------------------------------------------------------------------------
  const gradSrc = fixture(
    'grad-4th-page-thanks',
    [
      p('TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG'),
      p('KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO'),
      p('ĐỒ ÁN TỐT NGHIỆP'),
      p('XÂY DỰNG HỆ THỐNG HỌC TẬP'),
      p('ĐỀ CƯƠNG ĐỒ ÁN TỐT NGHIỆP'),
      p('Nội dung đề cương 1 trang.'),
      p('LỜI CẢM ƠN'),
      p('Em chân thành cảm ơn quý thầy cô.'),
      p('SINH VIÊN THỰC HIỆN'),
      p('Trần Văn B'),
      p('MỤC LỤC'),
      p('CHƯƠNG 1. MỞ ĐẦU'),
      p('Nội dung chương 1.')
    ].join('')
  );
  const outGrad = path.join(temp, 'out-grad-4th-page.docx');
  formatStructuredDocx(gradSrc, outGrad, {
    profile: gradProfile,
    documentType: 'do_an_tot_nghiep',
    instructor: 'TS. Lê Văn C',
    student: 'Trần Văn B',
    studentId: '22050099',
    className: '22SE01',
    topic: 'XÂY DỰNG HỆ THỐNG HỌC TẬP'
  });

  const zipGrad = new AdmZip(outGrad);
  const $grad = load(zipGrad.readAsText('word/document.xml'), { xml: true });
  const gradRels = load(zipGrad.readAsText('word/_rels/document.xml.rels'), { xml: true });
  const gradSections = $grad('w\\:sectPr').toArray();
  const gradHdr = idx => {
    const rId = $grad(gradSections[idx]).find('w\\:headerReference[w\\:type="default"]').attr('r:id');
    const target = gradRels(`Relationship[Id="${rId}"]`).attr('Target');
    return zipGrad.readAsText(`word/${target}`);
  };
  const gradFtr = idx => {
    const rId = $grad(gradSections[idx]).find('w\\:footerReference[w\\:type="default"]').attr('r:id');
    const target = gradRels(`Relationship[Id="${rId}"]`).attr('Target');
    return zipGrad.readAsText(`word/${target}`);
  };

  // Sections:
  // 0: Cover 1 (no HF)
  // 1: Cover 2 (no HF)
  // 2: Đề cương (no HF, lowerRoman start=1 -> page i)
  // 3: Nhận xét GVHD (no HF, lowerRoman -> page ii)
  // 4: Nhận xét GVPB (no HF, lowerRoman -> page iii)
  // 5: LỜI CẢM ƠN (HAS HF, lowerRoman continues -> page iv = 4 La Mã!)
  // 6: MỤC LỤC (HAS HF, lowerRoman -> page v)
  // 7: CHƯƠNG 1 (HAS HF, decimal start=1 -> page 1)
  for (const idx of [0, 1, 2, 3, 4]) {
    assert.equal(gradHdr(idx).includes('<w:tbl>'), false, `Graduation section ${idx} before Lời cảm ơn must have no header`);
    assert.equal(gradFtr(idx).includes('<w:tbl>'), false, `Graduation section ${idx} before Lời cảm ơn must have no footer`);
  }
  assert.equal($grad(gradSections[2]).find('w\\:pgNumType').attr('w:fmt'), 'lowerRoman');
  assert.equal($grad(gradSections[2]).find('w\\:pgNumType').attr('w:start'), '1', 'Đề cương starts lowerRoman at i (covers excluded)');
  for (const idx of [3, 4, 5, 6]) {
    assert.equal($grad(gradSections[idx]).find('w\\:pgNumType').attr('w:fmt'), 'lowerRoman');
    assert.equal($grad(gradSections[idx]).find('w\\:pgNumType').attr('w:start'), undefined, `Section ${idx} continues lowerRoman without reset so Lời cảm ơn is iv`);
  }
  assert.equal(gradHdr(5).includes('LỜI CẢM ƠN'), true, 'Lời cảm ơn (section 5) is the first section showing Header');
  assert.equal(gradFtr(5).includes('PAGE'), true, 'Lời cảm ơn (section 5) displays Footer with Roman page iv');
  assert.equal($grad(gradSections[7]).find('w\\:pgNumType').attr('w:fmt'), 'decimal');
  assert.equal($grad(gradSections[7]).find('w\\:pgNumType').attr('w:start'), '1', 'Chapter 1 resets to decimal 1');

  // ---------------------------------------------------------------------------
  // 7. Long Chapter Header Optimization: compact left column, auto-scaled right
  //    size (13pt -> 11-12pt) to fit 1 line, vAlign="bottom", and 6pt clearance
  // ---------------------------------------------------------------------------
  const shortHdrLayout = computeHeaderLayout('TIỂU LUẬN MÔN HỌC', 'CHƯƠNG 1. GIỚI THIỆU TỔNG QUAN', 13, 9071);
  assert.equal(shortHdrLayout.widths[0] + shortHdrLayout.widths[1], 9071);
  assert.ok(shortHdrLayout.widths[0] < 2850, `Left column compacts tightly (${shortHdrLayout.widths[0]} dxa < 3000)`);
  assert.equal(shortHdrLayout.leftSizePt, 13);
  assert.equal(shortHdrLayout.rightSizePt, 13);
  assert.equal(shortHdrLayout.rightFitsSingleLine, true);

  const ch2HdrLayout = computeHeaderLayout(
    'TIỂU LUẬN MÔN HỌC',
    'CHƯƠNG 2. PHÂN TÍCH BÀI TOÁN VÀ XÂY DỰNG MÔ HÌNH',
    13,
    9071
  );
  assert.equal(ch2HdrLayout.leftSizePt, 13, 'Left label stays 13pt');
  assert.ok(ch2HdrLayout.rightSizePt >= 11 && ch2HdrLayout.rightSizePt <= 12, `Long chapter right label scales cleanly (${ch2HdrLayout.rightSizePt}pt)`);
  assert.equal(ch2HdrLayout.rightFitsSingleLine, true, 'CHƯƠNG 2. PHÂN TÍCH BÀI TOÁN VÀ XÂY DỰNG MÔ HÌNH fits on 1 single line');

  const longHdrSrc = fixture(
    'long-header-ch2',
    [
      p('LỜI CẢM ƠN'),
      p('Em xin chân thành cảm ơn.'),
      p('MỤC LỤC'),
      p('CHƯƠNG 1. GIỚI THIỆU TỔNG QUAN'),
      p('Nội dung chương 1.'),
      p('CHƯƠNG 2. PHÂN TÍCH BÀI TOÁN VÀ XÂY DỰNG MÔ HÌNH'),
      p('Nội dung chương 2.')
    ].join('')
  );
  const outLongHdr = path.join(temp, 'out-long-header.docx');
  formatStructuredDocx(longHdrSrc, outLongHdr, {
    profile: tieuLuanProfile,
    documentType: 'tieu_luan',
    instructor: 'TS. Lê Hoàng Hiệp',
    student: 'Nguyễn Vũ Đạt',
    studentId: '24050001',
    className: '24TH01',
    topic: 'DỰ ĐOÁN PHÂN LOẠI CHẤT LƯỢNG BẰNG THUẬT TOÁN HỒI QUY'
  });
  const zipLongHdr = new AdmZip(outLongHdr);
  const longHdrXmls = zipLongHdr.getEntries()
    .filter(e => /^word\/wfStructureHeader\d+\.xml$/.test(e.entryName))
    .map(e => e.getData().toString('utf8'));
  const ch2HdrXml = longHdrXmls.find(xml => xml.includes('CHƯƠNG 2. PHÂN TÍCH BÀI TOÁN VÀ XÂY DỰNG MÔ HÌNH'));
  assert.ok(ch2HdrXml, 'Header XML for Chapter 2 exists');
  assert.match(ch2HdrXml, /<w:vAlign w:val="bottom"\/>/, 'Header cells align at bottom baseline');
  assert.match(ch2HdrXml, /<w:bottom w:w="60" w:type="dxa"\/>/, 'Header cells include 3pt bottom padding above border');
  assert.match(ch2HdrXml, /<w:spacing w:before="0" w:after="0" w:line="120" w:lineRule="exact"\/>/, 'Header includes 6pt (120 dxa) buffer below border so tables never touch it');
  assert.match(ch2HdrXml, /<w:sz w:val="26"\/><w:szCs w:val="26"\/>[\s\S]*TIỂU LUẬN MÔN HỌC/, 'Left header cell stays 13pt');
  assert.match(ch2HdrXml, /<w:sz w:val="2[1-4]"\/><w:szCs w:val="2[1-4]"\/>[\s\S]*CHƯƠNG 2\. PHÂN TÍCH BÀI TOÁN VÀ XÂY DỰNG MÔ HÌNH/, 'Right header cell auto-scales to 11-12pt so MÔ HÌNH never wraps');

  console.log('✅ All 7 BDU WordFmt 2026 formatting fixes verified 100%!');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
