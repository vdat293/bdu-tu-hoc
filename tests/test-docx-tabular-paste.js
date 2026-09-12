import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import { analyzeDocxStructure, formatStructuredDocx } from '../src/utils/docx-structure.js';
import { convertTabbedTableBlocks } from '../src/utils/docx-layout.js';
import { extractWordprocessingText, normalizeBodyText } from '../src/utils/docx-postprocessor.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfmt-tabular-paste-test-'));
const profile = JSON.parse(fs.readFileSync(new URL('../profiles/tieu_luan.json', import.meta.url), 'utf8'));

const run = (text, bold = true) => `<w:r>${bold ? '<w:rPr><w:b/><w:bCs/></w:rPr>' : ''}<w:t>${text}</w:t></w:r>`;
const paragraph = (text, bold = true) => `<w:p><w:pPr/>${run(text, bold)}</w:p>`;
const tabParagraph = cells => `<w:p><w:pPr/>${cells.map((cell, index) => `${run(cell)}${index < cells.length - 1 ? '<w:r><w:tab/></w:r>' : ''}`).join('')}</w:p>`;

const sourceStyles = `<w:styles xmlns:w="${W}">
  <w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
</w:styles>`;

function makeDocx(name, body) {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:left="1701" w:right="1134" w:bottom="1134"/></w:sectPr></w:body></w:document>`));
  zip.addFile('word/styles.xml', Buffer.from(sourceStyles));
  zip.addFile('word/numbering.xml', Buffer.from(`<w:numbering xmlns:w="${W}"/>`));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  const file = path.join(temp, name);
  zip.writeZip(file);
  return file;
}

try {
  const extracted = extractWordprocessingText('<w:p><w:pPr><w:tabs><w:tab w:pos="720"/></w:tabs></w:pPr><w:r><w:t>A&amp;B</w:t></w:r><w:r><w:tab/></w:r><w:r><w:br/><w:t>C</w:t></w:r></w:p>');
  assert.equal(extracted, 'A&B\t\nC', 'body extraction preserves visible tabs/line breaks and ignores pPr tabs');
  const lower = normalizeBodyText('<w:p><w:pPr><w:pStyle w:val="WFBody"/></w:pPr><w:r><w:t>API &#x110;&#x1eb6;t Ph&#x00f2;ng</w:t></w:r></w:p>', { bodyTextCase: 'lower' });
  assert.match(lower.xml, /<w:t>api đặt phòng<\/w:t>/u, 'literal lowercase remains an explicit opt-in');

  const raw = `<w:document xmlns:w="${W}"><w:body>
    ${tabParagraph(['Mã', 'Nội dung', 'Ghi chú'])}
    ${tabParagraph(['A01', 'Một nội dung dài', 'Đã kiểm tra'])}
    ${tabParagraph(['A02', 'Nội dung khác', 'Cần bổ sung'])}
    ${paragraph('Đoạn ngắt giữa hai vùng', false)}
    ${paragraph('Đoạn thường chỉ có một tab', false).replace('</w:p>', '<w:r><w:tab/></w:r></w:p>')}
  </w:body></w:document>`;
  const $raw = load(raw, { xml: true });
  const rawResult = convertTabbedTableBlocks($raw, $raw('w\\:body'));
  assert.deepEqual(rawResult, { tablesConverted: 1, rowsConverted: 3 });
  assert.equal($raw('w\\:body').children('w\\:tbl').length, 1);
  assert.equal($raw('w\\:tbl').first().children('w\\:tr').length, 3);
  assert.equal($raw('w\\:tbl').first().children('w\\:tr').first().children('w\\:tc').length, 3);
  assert.equal($raw('w\\:tbl').find('w\\:tab').length, 0, 'converted cells must not retain layout tabs');
  assert.equal($raw('w\\:body').children('w\\:p').filter((_, p) => $raw(p).find('w\\:tab').length).length, 1, 'short ambiguous tabbed prose stays unchanged');

  const body = [
    paragraph('CHƯƠNG 1: Kiểm thử bảng tab'),
    paragraph('Bảng 1.1. Bảng được dán từ LLM'),
    tabParagraph(['Cột A', 'Cột B', 'Cột C']),
    tabParagraph(['A01', 'Một nội dung dài', 'Đã kiểm tra']),
    tabParagraph(['A02', 'Nội dung khác', 'Cần bổ sung']),
    ...Array.from({ length: 12 }, (_, index) => paragraph(`Đoạn body ${index + 1} cần hiển thị chữ thường.`))
  ].join('');
  const source = makeDocx('source.docx', body);
  const output = path.join(temp, 'output.docx');
  const options = { profile, instructor: 'GVHD', student: 'SV', frontMatter: '', onlyExistingCaptions: true };
  const result = formatStructuredDocx(source, output, options, analyzeDocxStructure(source));
  assert.equal(result.report.outputNormalization.tabbedTablesConverted, 1);
  assert.equal(result.report.outputNormalization.tabbedTableRowsConverted, 3);

  const $out = load(new AdmZip(output).readAsText('word/document.xml'), { xml: true });
  const table = $out('w\\:tbl').first();
  assert.equal(table.children('w\\:tr').length, 3);
  assert.equal(table.find('w\\:tblBorders w\\:top').attr('w:val'), 'single');
  const bodyBold = $out('w\\:p').filter((_, p) => $out(p).find('w\\:pStyle').attr('w:val') === 'WFBody' && !$out(p).parents('w\\:tbl').length)
    .find('w\\:rPr > w\\:b, w\\:rPr > w\\:bCs');
  assert.equal(bodyBold.length, 0, 'uniform pasted direct bold is normalized for body paragraphs');
  assert.ok(table.find('w\\:tr').first().find('w\\:b').length > 0, 'table header emphasis is retained');
  console.log('✅ Tab-pasted prose: conservative native-table conversion and body direct-bold normalization.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
