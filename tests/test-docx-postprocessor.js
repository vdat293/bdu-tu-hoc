import assert from 'node:assert/strict';
import {
  buildListContext,
  normalizeAcademicLists,
  normalizeReferenceHeader,
  normalizeReferenceSection,
  processDocumentXml,
  processStylesXml,
  replaceEnDashes,
  replaceStraightDoubleQuotes
} from '../src/utils/docx-postprocessor.js';

const documentXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="WFHeading2"/></w:pPr><w:r><w:rPr><w:color w:val="2F5496" w:themeColor="accent1"/></w:rPr><w:t>1.1 Tiêu đề – thử nghiệm</w:t></w:r></w:p>
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

const dashResult = replaceEnDashes(documentXml);
assert.equal(dashResult.replacements, 1);
assert.ok(dashResult.xml.includes('Tiêu đề - thử nghiệm'));

const quoteResult = replaceStraightDoubleQuotes(dashResult.xml);
assert.equal(quoteResult.replacements, 2);
assert.match(quoteResult.xml, /Nội dung “trích <\/w:t>[\s\S]*?dẫn” không đậm/);
assert.doesNotMatch(quoteResult.xml, /<w:t>[^<]*"/);

const documentResult = processDocumentXml(quoteResult.xml);
assert.equal(documentResult.stats.headingParagraphs, 1);
assert.equal(documentResult.stats.bodyParagraphs, 1);
assert.match(documentResult.xml, /<w:color w:val="000000"\/>/);
assert.doesNotMatch(documentResult.xml, /w:themeColor=/);
assert.match(documentResult.xml, /<w:b w:val="0"\/>/);
assert.match(documentResult.xml, /<w:bCs w:val="0"\/>/);

const stylesResult = processStylesXml(stylesXml);
assert.equal(stylesResult.stats.headingStyles, 1);
assert.equal(stylesResult.stats.bodyStyles, 1);
assert.match(stylesResult.xml, /styleId="WFHeading2"[\s\S]*?<w:color w:val="000000"\/>/);
assert.match(stylesResult.xml, /styleId="WFBody"[\s\S]*?<w:b w:val="0"\/>/);

const listContext = buildListContext(numberingXml, stylesXml);
const listResult = normalizeAcademicLists(listDocumentXml, listContext);
assert.equal(listResult.stats.listParagraphsConverted, 5);
assert.equal(listResult.stats.automaticListsConverted, 4);
assert.equal(listResult.stats.manualListsConverted, 1);
assert.match(listResult.xml, /<w:t>1\) Mục cấp một<\/w:t>/);
assert.match(listResult.xml, /<w:t>2\) Mục cấp hai<\/w:t>/);
assert.match(listResult.xml, /<w:t>3\) Mục cấp hai từ style<\/w:t>/);
assert.match(listResult.xml, /<w:t>4\) Mục đánh số phải giữ nguyên<\/w:t>/);
assert.match(listResult.xml, /<w:t>5\) Mục gõ thủ công<\/w:t>/);
assert.match(listResult.xml, /<w:t>1\.1 Heading phải giữ nguyên<\/w:t>/);
assert.doesNotMatch(listResult.xml, /w:pos="720"|w:left="720"|w:left="1440"|<w:tab\/>/);
assert.doesNotMatch(listResult.xml, /<w:numId w:val="8"\/>/);

const referenceResult = normalizeReferenceSection(referenceDocumentXml);
assert.equal(referenceResult.stats.referenceHeadingsNormalized, 1);
assert.equal(referenceResult.stats.referenceEntriesNormalized, 2);
assert.match(referenceResult.xml, /<w:pStyle w:val="WFHeading1"\/>[\s\S]*?<w:jc w:val="center"\/>/);
assert.match(referenceResult.xml, /<w:color w:val="000000"\/>/);
assert.match(referenceResult.xml, /<w:sz w:val="36"\/>/);
assert.match(referenceResult.xml, /<w:t>\[1\] Bảnh, T\. T\. \(2021\)\. Giáo trình\.<\/w:t>/);
assert.match(referenceResult.xml, /<w:t>\[2\] MongoDB Documentation\. https:\/\/mongodb\.com<\/w:t>/);
assert.match(referenceResult.xml, /<w:sz w:val="26"\/>/);
assert.match(referenceResult.xml, /<w:b w:val="0"\/>/);
assert.match(referenceResult.xml, /<w:jc w:val="left"\/>/);
assert.doesNotMatch(referenceResult.xml, /w:pos="720"|w:left="720"/);
assert.match(referenceResult.xml, /<w:t>1\) Không phải tài liệu tham khảo<\/w:t>/);

const referenceHeaderResult = normalizeReferenceHeader(referenceHeaderXml);
assert.equal(referenceHeaderResult.cleared, true);
assert.match(referenceHeaderResult.xml, /<w:hdr[^>]*><w:p\/><\/w:hdr>/);
assert.doesNotMatch(referenceHeaderResult.xml, /TÀI LIỆU THAM KHẢO|TIỂU LUẬN MÔN HỌC/);

console.log('✅ DOCX post-processor: heading, body, dấu câu và mọi danh sách được chuẩn hóa.');
