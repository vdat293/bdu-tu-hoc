import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import AdmZip from 'adm-zip';
import { WordFmtService } from '../src/services/wordfmt.service.js';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const python = process.env.WORDFMT_TEST_PYTHON || 'python3';
const fixturePath = path.join(os.tmpdir(), `wordfmt-e2e-${process.pid}.docx`);
let outputPath = '';
const outputPaths = [];

function textOf(xml) {
  return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(match => match[1]).join('');
}

function styleOf(stylesXml, styleId) {
  return stylesXml.match(new RegExp(`<w:style\\b(?=[^>]*w:styleId="${styleId}")[^>]*>[\\s\\S]*?<\\/w:style>`))?.[0] || '';
}

try {
  execFileSync(python, [
    path.join(rootDir, 'tests/fixtures/build-wordfmt-fixture.py'),
    fixturePath
  ], { cwd: rootDir, stdio: 'inherit' });

  const result = await WordFmtService.formatDocx({
    inputPath: fixturePath,
    instructor: 'ThS. Nguyễn Văn A',
    student: 'Nguyễn Văn B',
    studentId: '24050001',
    topic: 'Đề tài kiểm tra WordFmt',
    className: '24TH01',
    documentTitle: 'TIỂU LUẬN MÔN HỌC',
    location: 'Thành phố Hồ Chí Minh',
    month: '9',
    year: '2026',
    documentMode: 'digital_document',
    frontMatter: 'cover,comments,thanks'
  });
  outputPath = result.outputPath;
  outputPaths.push(outputPath);

  const archive = new AdmZip(outputPath);
  const documentXml = archive.readAsText('word/document.xml');
  const stylesXml = archive.readAsText('word/styles.xml');
  const relationshipsXml = archive.readAsText('word/_rels/document.xml.rels');
  const headers = archive.getEntries()
    .filter(entry => /^word\/wfHeader.*\.xml$/i.test(entry.entryName))
    .map(entry => archive.readAsText(entry.entryName));
  const footersXml = archive.getEntries()
    .filter(entry => /^word\/wfFooter.*\.xml$/i.test(entry.entryName))
    .map(entry => archive.readAsText(entry.entryName))
    .join('');

  assert.doesNotMatch(documentXml, /[–—]/);
  assert.match(documentXml, /&quot;ngoặc kép thẳng&quot;|"ngoặc kép thẳng"/);
  assert.doesNotMatch(documentXml, /<w:hyperlink\b/);
  assert.doesNotMatch(relationshipsXml, /relationships\/hyperlink/);
  assert.match(documentXml, /https:\/\/example\.com\/reference/);
  assert.match(documentXml, /<w:b w:val="1"\/>[\s\S]*Cụm in đậm cần được giữ/);
  assert.match(documentXml, /<w:i w:val="1"\/>[\s\S]*Tên sách cần in nghiêng/);

  const thanks = documentXml.indexOf('LỜI CẢM ƠN');
  const toc = documentXml.indexOf('MỤC LỤC');
  const figures = documentXml.indexOf('DANH MỤC HÌNH ẢNH');
  const tables = documentXml.indexOf('DANH MỤC BẢNG');
  const chapter = documentXml.indexOf('CHƯƠNG 1. GIỚI THIỆU TỔNG QUAN');
  assert.ok(thanks < toc && toc < figures && figures < tables && tables < chapter);

  assert.match(documentXml, /Tên tiểu luận:/);
  assert.match(documentXml, /Sinh viên thực hiện:/);
  assert.match(documentXml, /Thành phố Hồ Chí Minh, tháng 9 năm 2026/);
  const bodyStyle = styleOf(stylesXml, 'WFBody');
  const heading1Style = styleOf(stylesXml, 'WFHeading1');
  const captionStyle = styleOf(stylesXml, 'WFCaption');
  assert.match(bodyStyle, /<w:spacing w:before="120" w:after="0" w:line="288"/);
  assert.match(heading1Style, /<w:pageBreakBefore\/>/);
  assert.match(heading1Style, /<w:spacing w:before="240" w:after="480"/);
  assert.match(captionStyle, /<w:i(?:\s|\/|>)/);
  assert.match(captionStyle, /<w:b(?:\s|\/|>)/);
  assert.match(documentXml, /TOC \\o "1-4"/);
  assert.match(documentXml, /TOC \\c "Hinh"/);
  assert.match(documentXml, /TOC \\c "Bang"/);
  assert.match(footersXml, /<w:instrText[^>]*> PAGE <\/w:instrText>/);

  assert.ok(headers.some(xml => textOf(xml).includes('TIỂU LUẬN MÔN HỌCChương 1. Giới thiệu tổng quan')));
  assert.ok(headers.some(xml => textOf(xml).includes('TIỂU LUẬN MÔN HỌCTài liệu tham khảo')));
  assert.equal(result.report.outputNormalization.compliance.a4Portrait, true);
  assert.equal(result.report.outputNormalization.compliance.margins, true);
  assert.equal(result.report.outputNormalization.compliance.bodySpacing, true);
  assert.equal(result.report.outputNormalization.compliance.referenceHyperlinksRemoved, true);
  assert.equal(result.report.outputNormalization.compliance.wordCompatibleAnchors, true);
  assert.equal(result.report.outputNormalization.compliance.wordprocessingPropertyOrder, true);
  assert.equal(result.report.outputNormalization.tableCaptionsMoved, 1);
  assert.equal(result.report.outputNormalization.figureCaptionsMoved, 1);
  assert.equal(result.report.outputNormalization.decorativeDrawingsRemoved, 0);

  const bindingResult = await WordFmtService.formatDocx({
    inputPath: fixturePath,
    instructor: 'ThS. Nguyễn Văn A',
    student: 'Nguyễn Văn B',
    studentId: '24050001',
    topic: 'Đề tài kiểm tra WordFmt',
    className: '24TH01',
    location: 'Thành phố Hồ Chí Minh',
    month: '9',
    year: '2026',
    documentMode: 'binding_package',
    frontMatter: 'cover,comments,thanks'
  });
  outputPaths.push(bindingResult.outputPath);
  const bindingArchive = new AdmZip(bindingResult.outputPath);
  const bindingDocumentXml = bindingArchive.readAsText('word/document.xml');
  assert.equal(bindingResult.report.outputNormalization.bindingPagesInserted, 2);
  assert.equal((bindingDocumentXml.match(/TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG/g) || []).length, 2);
  assert.equal(bindingResult.report.outputNormalization.sectionsNormalized, result.report.outputNormalization.sectionsNormalized + 2);

  console.log('✅ WordFmt end-to-end: profile, OOXML, headers, lists, captions and references passed.');
} finally {
  for (const filePath of [fixturePath, ...outputPaths]) {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
}
