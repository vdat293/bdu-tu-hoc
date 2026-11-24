import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { WordFmtService } from '../src/services/wordfmt.service.js';
import { WordFmtController } from '../src/modules/wordfmt/wordfmt.controller.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const WP = 'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing';
const A = 'http://schemas.openxmlformats.org/drawingml/2006/main';
const PIC = 'http://schemas.openxmlformats.org/drawingml/2006/picture';

// Minimal valid 1x1 transparent PNG
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z/C/HgAGgwJ/lK3Q6wAAAABJRU5ErkJggg==',
  'base64'
);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfmt-preview-renderer-'));

const p = (text, style = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

const drawingParagraph = (rId = 'rIdImg1') =>
  `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="2880000" cy="1800000"/><wp:docPr id="10" name="Sample" descr="Sơ đồ kiến trúc"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:blipFill><a:blip r:embed="${rId}"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;

const sampleTable = `<w:tbl>
  <w:tblPr><w:tblW w:w="9071" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4"/></w:tblBorders></w:tblPr>
  <w:tblGrid><w:gridCol w:w="3000"/><w:gridCol w:w="6071"/></w:tblGrid>
  <w:tr><w:trPr><w:tblHeader/></w:trPr>
    <w:tc><w:p><w:r><w:t>Tiêu chí</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>Mô tả chi tiết</w:t></w:r></w:p></w:tc>
  </w:tr>
  <w:tr>
    <w:tc><w:p><w:r><w:t>Khổ giấy</w:t></w:r></w:p></w:tc>
    <w:tc><w:p><w:r><w:t>Chuẩn A4 đứng 21 x 29.7 cm</w:t></w:r></w:p></w:tc>
  </w:tr>
</w:tbl>`;

function buildSampleDocx(name) {
  const zip = new AdmZip();
  const body = [
    p('LỜI CẢM ƠN'),
    p('Em xin chân thành cảm ơn quý thầy cô Khoa CNTT.'),
    p('SINH VIÊN THỰC HIỆN'),
    p('Nguyễn Vũ Đạt'),
    p('MỤC LỤC'),
    p('TÓM TẮT'),
    p('Báo cáo trình bày quy trình xây dựng hệ thống tự động định dạng.'),
    p('CHƯƠNG 1. CƠ SỞ LÝ THUYẾT'),
    p('1.1. Tổng quan kiến trúc hệ thống'),
    p('Nội dung chi tiết mục 1.1 của báo cáo học thuật BDU.'),
    p('p = 1 / (1 + exp(-z))'),
    p('Bảng 1.1: Thông số kỹ thuật định dạng'),
    sampleTable,
    drawingParagraph('rIdImg1'),
    p('Hình 1.1: Sơ đồ kiến trúc tổng thể'),
    p('Hình 1.1 so sánh hiệu năng giữa các phương pháp và không phải chú thích hình.'),
    p('TÀI LIỆU THAM KHẢO'),
    p('[1] Trường Đại học Bình Dương (2026), Hướng dẫn trình bày tiểu luận.')
  ].join('');

  zip.addFile(
    'word/document.xml',
    Buffer.from(
      `<w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:wp="${WP}" xmlns:a="${A}" xmlns:pic="${PIC}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
    )
  );
  zip.addFile('word/styles.xml', Buffer.from(`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`));
  zip.addFile('word/numbering.xml', Buffer.from(`<w:numbering xmlns:w="${W}"/>`));
  zip.addFile(
    'word/_rels/document.xml.rels',
    Buffer.from(
      `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdImg1" Type="${R}/image" Target="media/chart.png"/></Relationships>`
    )
  );
  zip.addFile('word/media/chart.png', TINY_PNG);
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  const filePath = path.join(temp, `${name}.docx`);
  zip.writeZip(filePath);
  return filePath;
}

try {
  const inputPath = buildSampleDocx('full_report');

  // 1. Rich rendered preview generates A4 pages, cover, dotted lines, live TOC, tables, images, OMML Math AST & source mappings
  const richPreview = await WordFmtService.previewStructure(inputPath, {
    renderDocument: true,
    documentType: 'tieu_luan',
    documentMode: 'digital_document',
    instructor: 'ThS. Nguyễn Hồ Hải',
    student: 'Nguyễn Vũ Đạt',
    studentId: '24050001',
    className: '2405SE01',
    topic: 'Xây dựng không gian review tài liệu kiểu Google Docs',
    frontMatter: 'cover,comments,thanks',
    roleOverrides: { 5: 'major_title' }, // TÓM TẮT -> Heading 1 in TOC
    paragraphNotes: { 8: 'Kiểm tra lại trích dẫn ở mục 1.1' }
  });

  assert.ok(richPreview.document, 'Rendered document payload should be present');
  assert.ok(richPreview.document.pageCount >= 6, `Expected >= 6 A4 pages, got ${richPreview.document.pageCount}`);

  const pages = richPreview.document.pages;
  // Page 0: Cover page with twistedLines1 border
  assert.equal(pages[0].isCover, true);
  assert.equal(pages[0].borderStyle, 'twistedLines1');
  assert.equal(pages[0].header, null, 'Cover page must not show running header');

  // Dotted review lines exist on Nhận xét giảng viên page
  const hasDottedPage = pages.some((pg) => pg.blocks.filter((b) => b.kind === 'dotted_line').length >= 15);
  assert.equal(hasDottedPage, true, 'Instructor review page should render >= 15 dotted lines');

  // TOC, List of Figures, and List of Tables blocks are populated independently with live page labels
  const tocBlocks = pages.flatMap((pg) => pg.blocks.filter((b) => b.kind === 'toc' && b.tocType === 'main'));
  assert.equal(tocBlocks.length, 1, 'Exactly one main TOC block should exist');
  assert.ok(
    tocBlocks[0].entries.some((e) => /CHƯƠNG 1/i.test(e.title) && e.pageLabel === '1'),
    'Chapter 1 should reset page label to Arabic "1" in live TOC'
  );
  assert.ok(
    !tocBlocks[0].entries.some((e) => /^Hình 1-1|^Bảng 1-1/i.test(e.title)),
    'Main TOC must not include Figure or Table captions'
  );

  const figTocBlocks = pages.flatMap((pg) => pg.blocks.filter((b) => b.kind === 'toc' && b.tocType === 'figures'));
  assert.equal(figTocBlocks.length, 1, 'List of Figures (DANH MỤC HÌNH ẢNH) TOC block should exist');
  assert.ok(
    figTocBlocks[0].entries.some((e) => /Hình 1-1: Sơ đồ kiến trúc tổng thể/i.test(e.title) && e.sourceIndex !== null),
    'List of Figures should include formatted figure caption with sourceIndex'
  );
  assert.ok(
    !figTocBlocks[0].entries.some((e) => /CHƯƠNG 1/i.test(e.title) || /so sánh hiệu năng/i.test(e.title)),
    'List of Figures must exclude chapter headings and prose sentences starting with "Hình 1-1"'
  );

  const tabTocBlocks = pages.flatMap((pg) => pg.blocks.filter((b) => b.kind === 'toc' && b.tocType === 'tables'));
  assert.equal(tabTocBlocks.length, 1, 'List of Tables (DANH MỤC BẢNG) TOC block should exist');
  assert.ok(
    tabTocBlocks[0].entries.some((e) => /Bảng 1-1: Thông số kỹ thuật định dạng/i.test(e.title) && e.sourceIndex !== null),
    'List of Tables should include formatted table caption with sourceIndex'
  );
  assert.ok(
    !tabTocBlocks[0].entries.some((e) => /CHƯƠNG 1/i.test(e.title)),
    'List of Tables must exclude chapter headings'
  );

  // Equation converted to OMML Math AST (frac node for 1 / (1 + exp(-z)))
  const eqBlock = pages.flatMap((pg) => pg.blocks).find((b) => b.kind === 'equation');
  assert.ok(eqBlock && eqBlock.mathAst, 'Standalone formula should carry a parsed Math AST');

  // Bordered data table & embedded PNG data URL extracted safely
  const tblBlock = pages.flatMap((pg) => pg.blocks).find((b) => b.kind === 'table' && b.bordered);
  assert.ok(tblBlock && tblBlock.rows.length === 2, 'Data table with 2 rows should be rendered');

  const imgBlock = pages.flatMap((pg) => pg.blocks).find((b) => b.kind === 'image' && !b.isCoverLogo);
  assert.ok(imgBlock && imgBlock.src?.startsWith('data:image/png;base64,'), 'Valid PNG media should be extracted as safe data URL');

  // Source paragraph bookmark mapping & attached comment note preserved across front-matter reordering
  assert.ok(richPreview.document.locations['8'], 'Source index 8 should map to its exact A4 page location');
  const notedBlock = pages.flatMap((pg) => pg.blocks).find((b) => b.sourceIndex === 8);
  assert.equal(notedBlock?.note, 'Kiểm tra lại trích dẫn ở mục 1.1');

  // 2. Final formatDocx output must NOT leak temporary `_WFSrc_*` bookmarks AND supports ownership-checked post-format preview
  const formatted = await WordFmtService.formatDocx({
    inputPath,
    ownerMssv: '24050001',
    instructor: 'ThS. Nguyễn Hồ Hải',
    student: 'Nguyễn Vũ Đạt',
    studentId: '24050001',
    className: '2405SE01',
    topic: 'Xây dựng không gian review tài liệu kiểu Google Docs',
    documentType: 'tieu_luan',
    frontMatter: 'cover,comments,thanks',
    roleOverrides: { 5: 'major_title' },
    paragraphNotes: { 8: 'Kiểm tra lại trích dẫn ở mục 1.1' }
  });

  try {
    const outZip = new AdmZip(formatted.outputPath);
    const outXml = outZip.readAsText('word/document.xml');
    assert.doesNotMatch(outXml, /_WFSrc_/, 'Final downloadable DOCX must never contain temporary _WFSrc_ bookmarks');

    // Ownership enforcement on previewFormattedOutput & controller
    const denied = await WordFmtService.previewFormattedOutput(formatted.outputFile, '99999999');
    assert.equal(denied, null, 'Different MSSV must not access formatted output preview');

    const allowed = await WordFmtService.previewFormattedOutput(formatted.outputFile, '24050001');
    assert.ok(allowed?.document?.pageCount >= 6, 'Owner MSSV receives full rendered A4 pages of output DOCX');

    // Controller 404 check for non-owner
    let statusSent = 200;
    let jsonSent = null;
    await WordFmtController.previewFormattedDocx(
      { params: { filename: formatted.outputFile }, verifiedMssv: '99999999', headers: {} },
      {
        status(code) { statusSent = code; return this; },
        setHeader() {},
        json(payload) { jsonSent = payload; return this; }
      }
    );
    assert.equal(statusSent, 404);
    assert.equal(jsonSent?.result, false);
  } finally {
    if (fs.existsSync(formatted.outputPath)) fs.unlinkSync(formatted.outputPath);
  }

  // 3. Static manually-typed MỤC LỤC with tab leaders + page numbers must NOT create duplicate chapters or false suspects
  const pWithTabLeader = (title, pageNo) =>
    `<w:p><w:r><w:t xml:space="preserve">${title}</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>${pageNo}</w:t></w:r></w:p>`;
  const staticTocZip = new AdmZip();
  const staticTocBody = [
    p('LỜI CẢM ƠN'),
    p('Em xin cảm ơn giảng viên hướng dẫn.'),
    p('TÓM TẮT'),
    p('Nội dung tóm tắt tiểu luận.'),
    p('MỤC LỤC'),
    pWithTabLeader('LỜI CẢM ƠN', '2'),
    pWithTabLeader('TÓM TẮT', '2'),
    pWithTabLeader('Chương 1. Giới thiệu đề tài', '4'),
    pWithTabLeader('1.1. Mục tiêu, ý nghĩa', '4'),
    pWithTabLeader('Chương 2. Cơ sở lý thuyết', '6'),
    pWithTabLeader('TÀI LIỆU THAM KHẢO', '18'),
    p('DANH MỤC HÌNH ẢNH'),
    pWithTabLeader('Hình 1.1. Sơ đồ tổng quan', '5'),
    p('Chương 1. Giới thiệu đề tài'),
    p('1.1. Mục tiêu, ý nghĩa'),
    p('Đoạn văn gốc sẽ được chỉnh sửa trực tiếp.'),
    p('Đoạn văn thừa cần xóa bỏ.'),
    sampleTable,
    p('Chương 2. Cơ sở lý thuyết'),
    p('Nội dung chương 2.'),
    p('TÀI LIỆU THAM KHẢO'),
    p('[1] Tài liệu chuẩn BDU.')
  ].join('');
  staticTocZip.addFile(
    'word/document.xml',
    Buffer.from(`<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${staticTocBody}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`)
  );
  staticTocZip.addFile('word/styles.xml', Buffer.from(`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`));
  staticTocZip.addFile('word/numbering.xml', Buffer.from(`<w:numbering xmlns:w="${W}"/>`));
  staticTocZip.addFile('word/_rels/document.xml.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
  staticTocZip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  const staticTocPath = path.join(temp, 'static_toc_report.docx');
  staticTocZip.writeZip(staticTocPath);

  const staticPreview = await WordFmtService.previewStructure(staticTocPath, {
    renderDocument: true,
    instructor: 'TS. Lê Hoàng Hiệp',
    student: 'Nguyễn Vũ Đạt',
    studentId: '24050126',
    documentType: 'tieu_luan'
  });
  assert.equal(staticPreview.summary.chapterCount, 2, 'Static TOC chapter lines must not be double-counted as real chapters');
  assert.equal(staticPreview.summary.suspectCount, 0, 'Static TOC lines must not trigger false heading suggestions');

  // 4. Direct Word-like paragraph mutations (inline edit, chained inserts, and delete including sole table-cell safety)
  const editItem = staticPreview.items.find((it) => /Đoạn văn gốc sẽ được chỉnh sửa/.test(it.t));
  const deleteItem = staticPreview.items.find((it) => /Đoạn văn thừa cần xóa bỏ/.test(it.t));
  assert.ok(editItem && deleteItem, 'Editable and deletable paragraphs should exist in preview items');

  const mutationsPayload = {
    edits: {
      [editItem.i]: 'Đoạn văn ĐÃ ĐƯỢC SỬA TRỰC TIẾP trên trang A4.'
    },
    deletes: [String(deleteItem.i)],
    inserts: [
      { id: 'ins_1', afterKey: String(editItem.i), role: 'heading2', text: '1.2. Mục mới thêm trực tiếp' },
      { id: 'ins_2', afterKey: 'ins_1', role: 'body', text: 'Nội dung của mục 1.2 vừa thêm mới như trình soạn thảo Word.' }
    ]
  };

  const mutatedPreview = await WordFmtService.previewStructure(staticTocPath, {
    renderDocument: true,
    instructor: 'TS. Lê Hoàng Hiệp',
    student: 'Nguyễn Vũ Đạt',
    documentType: 'tieu_luan',
    paragraphMutations: mutationsPayload
  });
  assert.ok(
    mutatedPreview.items.some((it) => it.i === 'ins_1' && it.role === 'heading2'),
    'Inserted heading2 paragraph should preserve its ins_1 key and heading2 role in preview'
  );

  const mutatedOut = await WordFmtService.formatDocx({
    inputPath: staticTocPath,
    ownerMssv: '24050126',
    instructor: 'TS. Lê Hoàng Hiệp',
    student: 'Nguyễn Vũ Đạt',
    studentId: '24050126',
    documentType: 'tieu_luan',
    paragraphMutations: mutationsPayload
  });

  try {
    assert.equal(mutatedOut.report.structure.manualContentEdits, 4);
    const mutZip = new AdmZip(mutatedOut.outputPath);
    const mutXml = mutZip.readAsText('word/document.xml');
    assert.match(mutXml, /Đoạn văn ĐÃ ĐƯỢC SỬA TRỰC TIẾP trên trang A4\./);
    assert.match(mutXml, /1\.2\. Mục mới thêm trực tiếp/);
    assert.match(mutXml, /Nội dung của mục 1\.2 vừa thêm mới như trình soạn thảo Word\./);
    assert.doesNotMatch(mutXml, /Đoạn văn thừa cần xóa bỏ/);
    assert.doesNotMatch(mutXml, /Chương 1\. Giới thiệu đề tài<\/w:t><\/w:r><w:r><w:tab\/><\/w:r><w:r><w:t>4/, 'Static TOC lines must be replaced by dynamic TOC field');
    assert.doesNotMatch(mutXml, /_WFSrc_/);
  } finally {
    if (fs.existsSync(mutatedOut.outputPath)) fs.unlinkSync(mutatedOut.outputPath);
  }

  console.log('✅ WordFmt OOXML A4 preview renderer: cover, dotted lines, live TOC Roman/Arabic pages, static TOC cleanup, inline Word mutations, tables, PNG media, OMML Math AST, clean export & MSSV ownership.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
