import assert from 'node:assert/strict';
import {
  buildListContext,
  materializeAutomaticLists,
  mapHeadersToSectionTitles,
  normalizeAcademicHeader,
  normalizeAcademicLists,
  normalizeFrontMatter,
  normalizeReferenceHeader,
  normalizeReferenceSection,
  normalizeSectionProperties,
  processDocumentXml,
  processStylesXml,
  removeUnusedHyperlinkRelationships,
  replaceEnDashes,
  replaceStraightDoubleQuotes,
  stripReferenceHyperlinks
} from '../src/utils/docx-postprocessor.js';

const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="WFHeading2"/></w:pPr><w:r><w:rPr><w:color w:val="2F5496" w:themeColor="accent1"/></w:rPr><w:t>1.1 Tiêu đề – thử nghiệm — mở rộng</w:t></w:r></w:p>
    <w:p><w:pPr><w:pStyle w:val="WFBody"/></w:pPr><w:r><w:rPr><w:b/><w:bCs/></w:rPr><w:t>Nội dung "trích </w:t></w:r><w:r><w:t>dẫn" không đậm</w:t></w:r></w:p>
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:styleId="WFHeading2"><w:name w:val="WF Heading 2"/><w:rPr><w:color w:val="2F5496" w:themeColor="accent1"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="WFBody"><w:name w:val="WF Body"/><w:rPr><w:b/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr></w:pPr></w:style>
  <w:style w:type="paragraph" w:styleId="ListBullet2"><w:pPr><w:numPr><w:numId w:val="7"/></w:numPr></w:pPr></w:style>
</w:styles>`;

const numberingXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:abstractNum w:abstractNumId="3">
    <w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl>
    <w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/></w:lvl>
  </w:abstractNum>
  <w:abstractNum w:abstractNumId="4"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum>
  <w:num w:numId="7"><w:abstractNumId w:val="3"/></w:num>
  <w:num w:numId="8"><w:abstractNumId w:val="4"/></w:num>
</w:numbering>`;

const listDocumentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:pPr><w:pStyle w:val="ListBullet"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="7"/></w:numPr><w:tabs><w:tab w:val="num" w:pos="720"/></w:tabs><w:ind w:left="720" w:hanging="360"/></w:pPr><w:r><w:tab/></w:r><w:r><w:t>Mục cấp một</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="WFBody"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="7"/></w:numPr><w:ind w:left="1440" w:hanging="360"/></w:pPr><w:r><w:t>Mục cấp hai</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="ListBullet2"/></w:pPr><w:r><w:t>Mục cấp hai từ style</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="WFBody"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="8"/></w:numPr></w:pPr><w:r><w:t>Mục đánh số phải giữ nguyên</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="WFBody"/></w:pPr><w:r><w:t>- Mục gõ thủ công</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="WFHeading2"/></w:pPr><w:r><w:t>1.1 Heading phải giữ nguyên</w:t></w:r></w:p>
</w:body></w:document>`;

const referenceDocumentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
  <w:p><w:pPr><w:pStyle w:val="WFBody"/><w:jc w:val="left"/></w:pPr><w:r><w:rPr><w:color w:val="2F5496"/><w:sz w:val="30"/><w:i/></w:rPr><w:t>TÀI LIỆU THAM KHẢO</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="WFBody"/><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs><w:ind w:left="720"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t>1) Bảnh, T. T. (2021). Giáo trình.</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="WFBody"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="30"/></w:rPr><w:t>2. MongoDB Documentation. https://mongodb.com</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="WFHeading1"/></w:pPr><w:r><w:t>PHỤ LỤC</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="WFBody"/></w:pPr><w:r><w:t>1) Không phải tài liệu tham khảo</w:t></w:r></w:p>
</w:body></w:document>`;

const referenceHeaderXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p><w:r><w:t>TÀI LIỆU THAM KHẢO</w:t></w:r><w:r><w:t>TIỂU LUẬN MÔN HỌC</w:t></w:r></w:p>
</w:hdr>`;

const referenceHyperlinkDocumentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>
  <w:p><w:pPr><w:pStyle w:val="WFHeading1"/></w:pPr><w:r><w:t>TÀI LIỆU THAM KHẢO</w:t></w:r></w:p>
  <w:p><w:pPr><w:pStyle w:val="WFBody"/></w:pPr><w:r><w:t>[1] Nguồn: </w:t></w:r><w:hyperlink r:id="rId9"><w:r><w:rPr><w:i/></w:rPr><w:t>https://example.com</w:t></w:r></w:hyperlink></w:p>
</w:body></w:document>`;

const relationshipsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/>
</Relationships>`;

const dashResult = replaceEnDashes(documentXml);
assert.equal(dashResult.replacements, 2);
assert.ok(dashResult.xml.includes('Tiêu đề - thử nghiệm - mở rộng'));

const quoteResult = replaceStraightDoubleQuotes(dashResult.xml);
assert.equal(quoteResult.replacements, 2);
assert.match(quoteResult.xml, /Nội dung “trích <\/w:t>[\s\S]*?dẫn” không đậm/);
assert.doesNotMatch(quoteResult.xml, /<w:t>[^<]*"/);

const documentResult = processDocumentXml(quoteResult.xml);
assert.equal(documentResult.stats.headingParagraphs, 1);
assert.equal(documentResult.stats.bodyParagraphs, 1);
assert.match(documentResult.xml, /<w:color w:val="000000"\/>/);
assert.doesNotMatch(documentResult.xml, /w:themeColor=/);
assert.match(documentResult.xml, /<w:b\/>/);
assert.match(documentResult.xml, /<w:bCs\/>/);
assert.match(documentResult.xml, /<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"\/>/);

const stylesResult = processStylesXml(stylesXml);
assert.equal(stylesResult.stats.headingStyles, 1);
assert.equal(stylesResult.stats.bodyStyles, 1);
assert.match(stylesResult.xml, /styleId="WFHeading2"[\s\S]*?<w:color w:val="000000"\/>/);
assert.match(stylesResult.xml, /styleId="WFBody"[\s\S]*?<w:b w:val="0"\/>/);
assert.match(stylesResult.xml, /styleId="WFBody"[\s\S]*?<w:rFonts w:ascii="Times New Roman"/);
assert.match(stylesResult.xml, /styleId="WFBody"[\s\S]*?<w:spacing w:before="120" w:after="0" w:line="288"/);
assert.match(stylesResult.xml, /styleId="WFHeading2"[\s\S]*?<w:spacing w:before="120" w:after="120"/);

const listContext = buildListContext(numberingXml, stylesXml);
const listResult = normalizeAcademicLists(listDocumentXml, listContext);
assert.equal(listResult.stats.listParagraphsConverted, 0);
assert.equal(listResult.stats.listsPreserved, true);
assert.match(listResult.xml, /<w:t>Mục cấp một<\/w:t>/);
assert.match(listResult.xml, /<w:t>Mục cấp hai<\/w:t>/);
assert.match(listResult.xml, /<w:t>Mục cấp hai từ style<\/w:t>/);
assert.match(listResult.xml, /<w:t>Mục đánh số phải giữ nguyên<\/w:t>/);
assert.match(listResult.xml, /<w:t>- Mục gõ thủ công<\/w:t>/);
assert.match(listResult.xml, /<w:t>1\.1 Heading phải giữ nguyên<\/w:t>/);
assert.match(listResult.xml, /w:pos="720"|w:left="720"|w:left="1440"|<w:tab\/>/);
assert.match(listResult.xml, /<w:numId w:val="8"\/>/);

const materializedLists = materializeAutomaticLists(listDocumentXml, listContext);
assert.equal(materializedLists.stats.automaticListsMaterialized, 4);
assert.match(materializedLists.xml, /<w:t>- Mục cấp một<\/w:t>/);
assert.match(materializedLists.xml, /<w:t>\+ Mục cấp hai<\/w:t>/);
assert.match(materializedLists.xml, /<w:t>- Mục cấp hai từ style<\/w:t>/);
assert.match(materializedLists.xml, /<w:t>1\. Mục đánh số phải giữ nguyên<\/w:t>/);
assert.match(materializedLists.xml, /<w:t>- Mục gõ thủ công<\/w:t>/);

const referenceResult = normalizeReferenceSection(referenceDocumentXml);
assert.equal(referenceResult.stats.referenceHeadingsNormalized, 1);
assert.equal(referenceResult.stats.referenceEntriesNormalized, 2);
assert.match(referenceResult.xml, /<w:pStyle w:val="WFHeading1"\/>[\s\S]*?<w:jc w:val="center"\/>/);
assert.match(referenceResult.xml, /<w:color w:val="000000"\/>/);
assert.match(referenceResult.xml, /<w:sz w:val="36"\/>/);
assert.match(referenceResult.xml, /<w:t>1\) Bảnh, T\. T\. \(2021\)\. Giáo trình\.<\/w:t>/);
assert.match(referenceResult.xml, /<w:t>2\. MongoDB Documentation\. https:\/\/mongodb\.com<\/w:t>/);
assert.match(referenceResult.xml, /<w:jc w:val="left"\/>/);
assert.match(referenceResult.xml, /w:pos="720"|w:left="720"/);
assert.match(referenceResult.xml, /<w:t>1\) Không phải tài liệu tham khảo<\/w:t>/);

const referenceHeaderResult = normalizeReferenceHeader(referenceHeaderXml);
assert.equal(referenceHeaderResult.cleared, false);
assert.equal(referenceHeaderResult.xml, referenceHeaderXml);

const strippedLinks = stripReferenceHyperlinks(referenceHyperlinkDocumentXml);
assert.equal(strippedLinks.stats.hyperlinksRemoved, 1);
assert.doesNotMatch(strippedLinks.xml, /<w:hyperlink/);
assert.match(strippedLinks.xml, /<w:i\/>[\s\S]*?<w:t>https:\/\/example\.com<\/w:t>/);
const strippedRelationships = removeUnusedHyperlinkRelationships(
  relationshipsXml,
  strippedLinks.removedRelationshipIds,
  strippedLinks.xml
);
assert.equal(strippedRelationships.relationshipsRemoved, 1);
assert.doesNotMatch(strippedRelationships.xml, /relationships\/hyperlink/);

const sectionDocumentXml = `<w:document xmlns:w="x"><w:body><w:p><w:pPr><w:sectPr><w:pgSz w:w="12240" w:h="15840" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:pPr></w:p></w:body></w:document>`;
const normalizedSections = normalizeSectionProperties(sectionDocumentXml);
assert.match(normalizedSections.xml, /w:w="11906" w:h="16838" w:orient="portrait"/);
assert.match(normalizedSections.xml, /w:top="1134" w:right="1134" w:bottom="1134" w:left="1701"/);
assert.match(normalizedSections.xml, /<w:pgBorders/);

const formattingProfile = JSON.parse(
  await import('node:fs').then(({ readFileSync }) => (
    readFileSync(new URL('../profiles/tieu_luan.json', import.meta.url), 'utf8')
  ))
);
assert.equal(formattingProfile.header_footer.suppress_header_on_heading1_page, false);
assert.equal(
  formattingProfile.header_footer.header_left,
  formattingProfile.cover.document_type
);
assert.equal(formattingProfile.header_footer.header_right, '{section_title}');
assert.equal(formattingProfile.lists.normalize_all, false);
assert.equal(formattingProfile.references.remove_hyperlinks, true);

console.log('✅ DOCX post-processor: định dạng BDU được chuẩn hóa và nội dung ngoài phạm vi được bảo toàn.');
