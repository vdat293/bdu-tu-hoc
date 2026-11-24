import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import {
  analyzeDocxStructure, applyParagraphNotes, applyRoleOverrides, buildStructurePreview, formatStructuredDocx
} from '../src/utils/docx-structure.js';
import { normalizeParagraphNotes, normalizeRoleOverrides } from '../src/services/wordfmt.service.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'wordfmt-overrides-test-'));
const p = (text, style = '') => `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}</w:pPr><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
// Normal carries an outline level, a real template mistake seen in student files.
const styles = `<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr></w:style></w:styles>`;

function fixture(name, body) {
  const zip = new AdmZip();
  zip.addFile('word/document.xml', Buffer.from(`<w:document xmlns:w="${W}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`));
  zip.addFile('word/styles.xml', Buffer.from(styles));
  zip.addFile('word/numbering.xml', Buffer.from(`<w:numbering xmlns:w="${W}"/>`));
  zip.addFile('word/_rels/document.xml.rels', Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'));
  zip.addFile('[Content_Types].xml', Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  const file = path.join(temp, `${name}.docx`);
  zip.writeZip(file);
  return file;
}

const profile = JSON.parse(fs.readFileSync(new URL('../profiles/tieu_luan.json', import.meta.url), 'utf8'));
const options = { profile, instructor: 'GVHD', student: 'Sinh viên', frontMatter: '', onlyExistingCaptions: true };

try {
  const source = fixture('source',
    p('LỜI CẢM ƠN') + p('Cảm ơn thầy cô.')
    + p('TÓM TẮT') + p('Đề tài xây dựng website.')
    + p('Giới thiệu đề tài') + p('Đoạn giới thiệu.')
    + p('CHƯƠNG 1. TỔNG QUAN') + p('1.1. Quy trình') + p('Thông tin sinh viên.')
    + p('Danh mục môn học.') + p('Chương trình đào tạo.') + p('1.2. Phát biểu bài toán')
    + p('Tổng kết quy trình') + p('Nội dung tổng kết.')
    + p('KẾT LUẬN') + p('Kết luận đề tài.'));

  // 1. Automatic detection fixes.
  const analysis = analyzeDocxStructure(source);
  const byText = text => analysis.records.find(r => r.text === text);
  assert.equal(byText('TÓM TẮT').role, 'front_title', 'TÓM TẮT is recognized as a front-matter title');
  assert.equal(byText('Danh mục môn học.').role, 'body', 'a list item starting with "Danh mục" stays prose');
  assert.equal(byText('1.2. Phát biểu bài toán').role, 'heading', 'headings after that list item are still detected');
  assert.equal(byText('1.2. Phát biểu bài toán').region, 'body');
  assert.equal(byText('Nội dung tổng kết.').role, 'body', 'Normal outline level does not turn prose into headings');

  // 2. Preview payload.
  const preview = buildStructurePreview(analysis);
  const introItem = preview.items.find(item => item.t === 'Giới thiệu đề tài');
  assert.ok(introItem && introItem.kind === 'p');
  assert.equal(preview.summary.chapterCount, 1);
  assert.equal(normalizeRoleOverrides('{"1":"chapter","x":"body","2":"evil","3":"auto"}')['1'], 'chapter');
  assert.deepEqual(Object.keys(normalizeRoleOverrides('{"1":"chapter","x":"body","2":"evil","3":"auto"}')), ['1', '3']);
  assert.deepEqual(normalizeParagraphNotes({ 4: '  sửa  ', 5: '', bad: 'x' }), { 4: 'sửa' });

  // 3. Manual overrides survive analysis, formatting and a second run.
  const tomTat = byText('TÓM TẮT').index, intro = byText('Giới thiệu đề tài').index;
  const summaryHeading = byText('Tổng kết quy trình').index, oneTwo = byText('1.2. Phát biểu bài toán').index;
  const archive = new AdmZip(source);
  assert.equal(applyRoleOverrides(archive, { [tomTat]: 'major_title', [intro]: 'front_title', [summaryHeading]: 'heading3', [oneTwo]: 'body' }), 4);
  assert.equal(applyParagraphNotes(archive, { [summaryHeading]: 'Kiểm tra lại mục này' }), 1);
  const prepared = path.join(temp, 'prepared.docx');
  archive.writeZip(prepared);
  const forced = analyzeDocxStructure(prepared);
  assert.equal(forced.records[tomTat].role, 'major_title');
  assert.equal(forced.records[intro].role, 'front_title');
  assert.equal(forced.records[summaryHeading].role, 'heading');
  assert.equal(forced.records[summaryHeading].level, 3);
  assert.equal(forced.records[oneTwo].role, 'body');
  assert.equal(forced.records.length, analysis.records.length, 'markers do not change paragraph indexes');

  const out = path.join(temp, 'out.docx');
  formatStructuredDocx(prepared, out, options, forced);
  const output = new AdmZip(out);
  const documentXml = output.readAsText('word/document.xml');
  const findParagraph = text => documentXml.match(new RegExp(`<w:p\\b(?:(?!<w:p\\b)[\\s\\S])*?${text}[\\s\\S]*?</w:p>`))?.[0] || '';
  assert.match(findParagraph('TÓM TẮT'), /w:val="WFMajorTitle"/, 'TÓM TẮT becomes a Heading-1 level title in the TOC');
  assert.match(findParagraph('Tổng kết quy trình'), /w:val="WFHeading3"/);
  assert.match(findParagraph('1.2. Phát biểu bài toán'), /w:val="WFBody"/);
  assert.match(documentXml, /_WFRole_major_title/, 'override markers stay for re-formatting');
  assert.match(documentXml, /<w:commentReference w:id="\d+"\/>/);
  assert.match(output.readAsText('word/comments.xml'), /Kiểm tra lại mục này/);
  assert.match(output.readAsText('word/_rels/document.xml.rels'), /relationships\/comments/);
  assert.match(output.readAsText('[Content_Types].xml'), /comments\+xml/);
  const wfBody = output.readAsText('word/styles.xml').match(/<w:style[^>]*w:styleId="WFBody"[\s\S]*?<\/w:style>/)?.[0] || '';
  assert.match(wfBody, /<w:outlineLvl w:val="9"\/>/, 'body style blocks the inherited Normal outline level');

  const again = analyzeDocxStructure(out);
  assert.equal(again.records.find(r => r.text === 'TÓM TẮT').role, 'major_title');
  const promotedSummary = again.records.find(r => r.text.includes('Tổng kết quy trình'));
  assert.ok(promotedSummary, 'promoted Heading 3 survives re-analysis');
  assert.equal(promotedSummary.text, '1.1.1. Tổng kết quy trình');
  assert.equal(promotedSummary.level, 3);
  assert.equal(promotedSummary.number, '1.1.1');

  // 4. "auto" clears a previous decision.
  const clearArchive = new AdmZip(prepared);
  applyRoleOverrides(clearArchive, { [oneTwo]: 'auto' });
  const cleared = analyzeDocxStructure(clearArchive);
  assert.equal(cleared.records[oneTwo].role, 'heading');
  assert.equal(cleared.records[oneTwo].forced, undefined);

  console.log('✅ WordFmt role overrides: TÓM TẮT/front-matter detection, list-item false positives, preview payload, forced roles, notes as comments, persistence.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
