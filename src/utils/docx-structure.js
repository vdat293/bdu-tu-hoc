import fs from 'node:fs';
import { prepareGraduation, isolateProposalStyles } from './docx-graduation.js';
import {captureProposalBlock, markProposalBlock, restoreProposalBlock} from './docx-proposal-preservation.js';
import { repairDataTable, normalizeStructuredCaptions, ensureAcknowledgementFrame } from './docx-layout.js';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import {
  processStylesXml, normalizeWordprocessingPropertyOrder,
  normalizeTablesAndDrawings, stripReferenceHyperlinks,
  removeUnusedHyperlinkRelationships
} from './docx-postprocessor.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const parse = xml => load(xml, { xml: true });
// Keep readable Unicode while retaining XML escapes for syntax characters.
const xmlOf = ($, node) => $.xml(node).replace(/&#x([0-9a-f]+);/gi, (m, n) => Number.parseInt(n,16) > 127 ? String.fromCodePoint(Number.parseInt(n,16)) : m);
const tag = name => `w\\:${name}`;
const child = (node, name) => node.children(tag(name));
const val = (node, name) => child(node, name).attr('w:val');
const textOf = node => node.find(tag('t')).toArray().map(n => n.children?.map(c => c.data || '').join('')).join('');
const keyOf = s => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cm = n => Math.round(n * 1440 / 2.54);

function prop(node, name, xml) {
  let pp = child(node, 'pPr');
  if (!pp.length) { node.prepend('<w:pPr/>'); pp = child(node, 'pPr'); }
  child(pp, name).remove();
  if (xml) pp.append(xml);
}
function style(node, id) { prop(node, 'pStyle', `<w:pStyle w:val="${id}"/>`); }
function paragraph(text, id = 'WFBody') {
  return `<w:p><w:pPr><w:pStyle w:val="${id}"/></w:pPr><w:r><w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;
}
function fieldParagraph(code) {
  return `<w:p><w:pPr><w:pStyle w:val="WFBody"/></w:pPr><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> ${esc(code)} </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>Cập nhật mục lục trong Word.</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
}

// Resolve numbering without converting it to text. The same source numbering
// definitions are retained in the output; explicit numPr survives style changes.
function numberingReader(archive) {
  const $s = parse(archive.readAsText('word/styles.xml') || '<w:styles/>');
  const $n = parse(archive.readAsText('word/numbering.xml') || '<w:numbering/>');
  const styles = new Map($s(tag('style')).toArray().map(n => [$s(n).attr('w:styleId'), $s(n)]));
  const abstracts = new Map($n(tag('abstractNum')).toArray().map(n => [$n(n).attr('w:abstractNumId'), $n(n)]));
  const nums = new Map($n(tag('num')).toArray().map(n => [$n(n).attr('w:numId'), $n(n)]));
  const counters = new Map();
  function properties(id, seen = new Set()) {
    if (!id || seen.has(id) || !styles.has(id)) return {};
    seen.add(id);
    const s = styles.get(id), pp = child(s, 'pPr'), np = child(pp, 'numPr');
    return { ...properties(val(s, 'basedOn'), seen),
      ...(val(np, 'numId') !== undefined ? { numId: val(np, 'numId') } : {}),
      ...(val(np, 'ilvl') !== undefined ? { level: Number(val(np, 'ilvl')) } : {}),
      ...(val(pp, 'outlineLvl') !== undefined ? { outline: Number(val(pp, 'outlineLvl')) } : {}) };
  }
  function reference(p) {
    const pp = child(p, 'pPr'), np = child(pp, 'numPr');
    return { ...properties(val(pp, 'pStyle')),
      ...(val(np, 'numId') !== undefined ? { numId: val(np, 'numId') } : {}),
      ...(val(np, 'ilvl') !== undefined ? { level: Number(val(np, 'ilvl')) } : {}) };
  }
  function definition(numId, level, seen = new Set()) {
    if (seen.has(numId)) return null;
    seen.add(numId);
    const num = nums.get(numId);
    if (!num) return null;
    const abs = abstracts.get(val(num, 'abstractNumId'));
    if (!abs) return null;
    const link = val(abs, 'numStyleLink');
    if (link) return definition(properties(link).numId, level, seen);
    const override = child(num, 'lvlOverride').filter((_, n) => $n(n).attr('w:ilvl') === String(level));
    let lvl = child(override, 'lvl');
    if (!lvl.length) lvl = child(abs, 'lvl').filter((_, n) => $n(n).attr('w:ilvl') === String(level));
    if (!lvl.length) return null;
    return { format: val(lvl, 'numFmt'), template: val(lvl, 'lvlText') || '',
      start: Number(val(override, 'startOverride') ?? val(lvl, 'start') ?? 1),
      restart: val(lvl, 'lvlRestart') === undefined ? level : Number(val(lvl, 'lvlRestart')),
      legal: child(lvl, 'isLgl').length > 0 };
  }
  function renderNumber(n, fmt) {
    if (fmt === 'upperLetter' || fmt === 'lowerLetter') {
      let s = ''; for (let i = n; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s;
      return fmt === 'lowerLetter' ? s.toLowerCase() : s;
    }
    if (fmt === 'upperRoman' || fmt === 'lowerRoman') {
      let s = ''; for (const [v, c] of [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']]) while(n >= v) { s += c; n -= v; }
      return fmt === 'lowerRoman' ? s.toLowerCase() : s;
    }
    return fmt === 'decimalZero' ? String(n).padStart(2, '0') : String(n);
  }
  return p => {
    const ref = reference(p), level = ref.level ?? 0;
    if (!ref.numId || ref.numId === '0') return { ...ref, level, marker: '' };
    const def = definition(ref.numId, level);
    if (!def) return { ...ref, level, marker: '', unresolved: true };
    let values = counters.get(ref.numId);
    if (!values) { values = []; counters.set(ref.numId, values); }
    values[level] = values[level] === undefined ? def.start : values[level] + 1;
    for (let k = level + 1; k < 9; k++) {
      const d = definition(ref.numId, k);
      if (d && d.restart !== 0 && level < d.restart) values[k] = undefined;
    }
    const marker = def.template.replace(/%(\d)/g, (_, digit) => {
      const k = Number(digit) - 1, d = definition(ref.numId, k);
      return renderNumber(values[k] ?? d?.start ?? 1, def.legal ? 'decimal' : d?.format);
    });
    return { ...ref, level, marker, format: def.format };
  };
}

export function analyzeDocxStructure(inputPath) {
  const archive = typeof inputPath === 'string' ? new AdmZip(inputPath) : inputPath;
  const $ = parse(archive.readAsText('word/document.xml'));
  const body = $(tag('body'));
  if (body.length !== 1) throw new Error('DOCX không có phần thân tài liệu hợp lệ.');
  const nextNumber = numberingReader(archive);
  const records = [], fieldStack = [], warnings = [];
  let region = 'cover', summary = false, currentChapter = null, currentPart = null;
  let fieldId = 0;
  // Field ranges are tracked across paragraphs and content controls, including
  // TOC result paragraphs with no TOC style. No cached text establishes context.
  body.find(tag('p')).each((index, element) => {
    const p = $(element), text = textOf(p).trim(), key = keyOf(text).replace(/[.:]+$/, '');
    const pp = child(p, 'pPr'), styleId = val(pp, 'pStyle') || '';
    let inIndex = fieldStack.some(f => f.toc), indexId = fieldStack.find(f => f.toc)?.id;
    let indexCode = fieldStack.find(f => f.toc)?.code;
    p.find(`${tag('fldChar')},${tag('instrText')},${tag('fldSimple')}`).each((_, e) => {
      const n = $(e);
      if (e.name === 'w:fldChar') {
        if (n.attr('w:fldCharType') === 'begin') fieldStack.push({ id: ++fieldId, code: '', toc: false });
        if (n.attr('w:fldCharType') === 'end') fieldStack.pop();
      } else {
        const code = e.name === 'w:fldSimple' ? n.attr('w:instr') || '' : n.text();
        const f = fieldStack.at(-1);
        if (e.name === 'w:instrText' && f) { f.code += code; f.toc ||= /^\s*TOC\b/i.test(f.code); }
        if (/^\s*TOC\b/i.test(code) || f?.toc) {
          inIndex = true; indexId = f?.id ?? ++fieldId; indexCode = f?.code || code;
        }
      }
    });
    const insideTable = p.parents(tag('tbl')).length > 0;
    const rec = { index, element, text, styleId, region, role: 'body', chapter: currentChapter,
      part: currentPart, inIndex: inIndex || /^TOC\d|^TableofFigures$/i.test(styleId), indexId, indexCode, insideTable };
    records.push(rec);
    if (rec.inIndex) { rec.role = 'index'; return; }
    // Reading table list counters is necessary for preserving subsequent lists,
    // but table text never changes the report's region or heading hierarchy.
    rec.numbering = text ? nextNumber(p) : {marker:'',level:0};
    if (insideTable) { rec.role = 'table'; return; }
    if (p.parents(tag('txbxContent')).length) { rec.role = 'embedded'; return; }
    if (/^DE CUONG(?:\s|$)/.test(key)) { region = 'proposal'; rec.role = 'proposal_title'; summary = false; }
    else if (/^(?:NHAN XET|LOI CAM ON|LOI CAM DOAN|MUC LUC|DANH MUC)(?:\s|$)/.test(key) && text.length < 110) {
      region = 'front'; rec.role = 'front_title'; summary = false;
    } else if (['MO DAU','PHAN MO DAU','LOI MO DAU'].includes(key)) {
      region = 'introduction'; rec.role = 'intro_title'; summary = false;
    } else if (/^PHAN(?:\s+[IVX\d]+[.:]?)?\s+NOI DUNG$/.test(key)) {
      region = 'body'; rec.role = 'part_title'; currentPart = text; summary = false;
    } else if (['TAI LIEU THAM KHAO','REFERENCES','PHU LUC','APPENDIX','KET LUAN'].includes(key)) {
      region = key === 'PHU LUC' || key === 'APPENDIX' ? 'appendix' : key === 'KET LUAN' ? 'conclusion' : 'references';
      rec.role = 'major_title'; currentChapter = null; summary = false;
    } else if (region !== 'proposal') {
      const numberedText = rec.numbering.marker && rec.numbering.format !== 'bullet'
        ? `${rec.numbering.marker} ${text}` : text;
      const chapterMatch = numberedText.match(/^CHƯƠNG\s+(\d+)\s*[.:–—-]?\s*(.*)$/iu);
      const explicitHeading = /^Heading\d|^WFHeading\d/.test(styleId);
      const describesChapter = /(?:trình bày|hệ thống hoá|hệ thống hóa|đối chiếu|phân tích|giới thiệu|tổng kết)/iu.test(text.split(':').slice(1).join(':'));
      if (chapterMatch && !(region === 'introduction' && (summary || describesChapter) && !explicitHeading)) {
        rec.role = 'chapter'; rec.level = 1; rec.number = chapterMatch[1]; rec.displayText = numberedText;
        region = 'body'; summary = false; currentChapter = Number(rec.number);
      } else if (region === 'body') {
        const match = numberedText.match(/^(\d+(?:\.\d+){1,3})\.?\s+\S/u);
        if (match) {
          rec.role = 'heading'; rec.level = match[1].split('.').length; rec.number = match[1]; rec.displayText = numberedText;
          if (Number(match[1].split('.')[0]) !== currentChapter) {
            warnings.push(`Mục ${match[1]} chưa khớp chương đang xét; giữ số nguồn.`);
          }
        }
      } else if (region === 'introduction') {
        if (/^\d+[.)]\s+/.test(numberedText) && (explicitHeading || child(pp, 'keepNext').length)) {
          rec.role = 'intro_heading'; rec.displayText = numberedText;
        }
        if (/cấu trúc|bố cục|trình bày trong\s+\d+\s+chương/iu.test(text)) summary = true;
        if (chapterMatch) rec.role = 'chapter_summary';
      }
      const captionStyle = /^(?:HNH|BNG|Caption|WFFigureCaption|WFTableCaption)$/i.test(styleId);
      // A sentence such as "Hình 3.1 trình bày..." is a reference in prose.
      // Manual captions need a title separator; established caption styles or
      // SEQ fields also supply evidence when that separator is absent.
      const captionEvidence = captionStyle || /\bSEQ\b/i.test(p.find(tag('instrText')).text())
        || /^(Hình|Bảng)\s+\d+(?:[.\-]\d+)*[.:]\s+\S/iu.test(text);
      if (rec.role === 'body' && captionEvidence && /^(Hình|Bảng)\s+\d+(?:[.\-]\d+)*\s*[.:]?\s+\S/iu.test(text)) {
        rec.role = /^Hình/iu.test(text) ? 'figure_caption' : 'table_caption';
      }
    }
    rec.region = region; rec.chapter = currentChapter; rec.part = currentPart;
    if (region === 'proposal' && rec.role !== 'proposal_title') rec.role = 'proposal';
    if (region === 'cover') rec.role = 'cover';
  });
  const chapters = records.filter(r => r.role === 'chapter');
  const hasProposal = records.some(r => r.role === 'proposal_title');
  const hasIntroduction = records.some(r => r.role === 'intro_title');
  const hasParts = records.some(r => r.role === 'part_title');
  const automaticHeadings = records.filter(r => ['chapter','heading'].includes(r.role) && r.numbering?.marker).length;
  for (const rec of records.filter(r => r.role === 'proposal_title')) {
    const previous = $(rec.element).prev();
    // A proposal's institutional/signature masthead is part of the proposal,
    // even when it is a table immediately before the title.
    if (previous[0]?.name === 'w:tbl' && /TRUONG/.test(keyOf(textOf(previous))) && /CONG HOA/.test(keyOf(textOf(previous)))) rec.startElement = previous[0];
  }
  const documentType = records.find(r => r.role === 'cover' && /^(ĐỒ ÁN|KHÓA LUẬN|TIỂU LUẬN)/iu.test(r.text))?.text;
  return { archive, $, body, records, chapters, warnings, hasProposal, hasIntroduction, hasParts, automaticHeadings,
    documentType, requiresStructuredFormatting: hasProposal || hasIntroduction || hasParts || automaticHeadings > 0 || records.some(r=>r.inIndex),
    summary: { chapterCount: chapters.length, chapters: chapters.map(r => r.displayText), hasProposal, hasIntroduction,
      hasParts, automaticHeadings, protectedIndexParagraphs: records.filter(r => r.inIndex).length,
      chapterSummariesPreserved: records.filter(r => r.role === 'chapter_summary').length, warnings } };
}

function ensureStyles(archive, profile) {
  const $ = parse(archive.readAsText('word/styles.xml'));
  const ids = ['WFBody', ...[1,2,3,4].map(i => `WFHeading${i}`), 'WFCaption', 'TableofFigures', 'TOC1','TOC2','TOC3','TOC4'];
  let xml = `<w:styles xmlns:w="${W}">${ids.map(id => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="Normal"/>${/^WFHeading/.test(id) ? `<w:pPr><w:outlineLvl w:val="${Number(id.at(-1))-1}"/><w:keepNext/><w:keepLines/></w:pPr>` : ''}</w:style>`).join('')}</w:styles>`;
  xml = processStylesXml(xml, profile).xml;
  const add = parse(xml);
  add(tag('style')).each((_, e) => {
    const id = add(e).attr('w:styleId');
    // Word identifies built-in index styles by their English names, including
    // the space. "TOC1" creates a custom style that field updates won't use.
    const builtin=/^TOC[1-4]$/.test(id)?`toc ${id.at(-1)}`:id==='TableofFigures'?'table of figures':null;
    if(builtin){
      $(tag('style')).filter((_,s)=>val($(s),'name')?.toLowerCase()===builtin).remove();
      child(add(e),'name').attr('w:val',builtin);
      let pp=child(add(e),'pPr');if(!pp.length){add(e).append('<w:pPr/>');pp=child(add(e),'pPr');}
      pp.append(`<w:spacing w:before="0" w:after="0" w:line="288" w:lineRule="auto"/><w:ind w:left="${id==='TableofFigures'?0:(Number(id.at(-1))-1)*360}" w:right="360"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9071"/></w:tabs>`);
    }
    $(tag('style')).filter((_, s) => $(s).attr('w:styleId') === id).remove();
    $(tag('styles')).append(add.xml(e));
  });
  for (const [id, base, level] of [['WFIntroTitle','WFHeading1',0],['WFPartTitle','WFHeading1',0],['WFMajorTitle','WFHeading1',0],['WFIntroHeading','WFHeading2',1],['WFFrontTitle','WFHeading1',9],['WFFigureCaption','WFCaption',9],['WFTableCaption','WFCaption',9]]) {
    $(tag('style')).filter((_, e) => $(e).attr('w:styleId') === id).remove();
    $(tag('styles')).append(`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="${base}"/><w:pPr><w:keepNext w:val="${id==='WFFigureCaption'?0:1}"/><w:pageBreakBefore w:val="0"/><w:outlineLvl w:val="${level}"/></w:pPr></w:style>`);
  }
  if (!$(tag('style')).filter((_, e) => $(e).attr('w:styleId') === 'TableGrid').length) {
    $(tag('styles')).append('<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>');
  }
  // Normal and all source styles remain intact, particularly those used by the
  // preserved proposal. Only formatter-owned styles are added/replaced.
  archive.updateFile('word/styles.xml', Buffer.from(normalizeWordprocessingPropertyOrder($.xml()).xml));
}

function applyParagraphFormat($, p, rec, profile) {
  const heading = rec.role === 'chapter' || rec.role === 'heading';
  const id = heading ? `WFHeading${rec.level}` : ({ intro_title:'WFIntroTitle', part_title:'WFPartTitle',
    major_title:'WFMajorTitle', front_title:'WFFrontTitle', intro_heading:'WFIntroHeading',
    figure_caption:'WFFigureCaption', table_caption:'WFTableCaption' })[rec.role] || 'WFBody';
  style(p, id);
  const number = rec.numbering;
  if (number?.numId && number.numId !== '0') prop(p, 'numPr', `<w:numPr><w:ilvl w:val="${number.level}"/><w:numId w:val="${number.numId}"/></w:numPr>`);
  // Remove source paragraph overrides only for properties normalized by the
  // profile. Inline emphasis and special runs (equations/symbols) survive.
  for (const name of ['spacing','jc','outlineLvl','pageBreakBefore']) prop(p, name, '');
  const major = /_title$/.test(rec.role) || rec.role === 'chapter';
  if (heading || major || rec.role === 'intro_heading') {
    prop(p, 'keepNext', '<w:keepNext/>'); prop(p, 'keepLines', '<w:keepLines/>');
    if (number?.numId && number.numId !== '0' && !number.marker) throw new Error(`Không đọc được số tự động tại: ${rec.text.slice(0,80)}`);
    const level = rec.level || (rec.role === 'intro_heading' ? 2 : 1);
    const cfg = profile.headings?.[level === 1 ? 'chapter' : `level${level}`] || {};
    const numberPosition = cm(cfg.number_position_cm ?? (level === 3 ? 1.27 : level === 4 ? 2.54 : 0));
    // Reserve enough room for long labels; for manual labels measure their
    // approximate glyph width instead of inserting whitespace into user text.
    const label = number?.marker || rec.number || '';
    const labelWidth = level === 1 ? 0 : Math.max(360, Math.ceil(label.length * (cfg.size_pt || 14) * 10 + 90));
    const indent = level === 1 ? '<w:ind w:left="0" w:right="0" w:firstLine="0"/>'
      : `<w:ind w:left="${numberPosition + labelWidth}" w:right="0" w:hanging="${labelWidth}"/>`;
    prop(p, 'ind', indent);
    prop(p, 'tabs', `<w:tabs><w:tab w:val="clear" w:pos="720"/><w:tab w:val="left" w:pos="${numberPosition + labelWidth}"/></w:tabs>`);
    prop(p, 'pageBreakBefore', '<w:pageBreakBefore w:val="0"/>');
    const size = (rec.role==='front_title' && keyOf(rec.text)==='LOI CAM ON' ? 16 : cfg.size_pt) || (level === 1 ? 18 : level === 2 ? 16 : level === 3 ? 14 : 13);
    // Mutate each existing rPr through a local XML selection supplied by the
    // caller's Cheerio API (all text and bookmarks stay at the same positions).
    p.find(tag('r')).each((_, e) => {
      const r = $(e);
      let rp = child(r, 'rPr'); if (!rp.length) { r.prepend('<w:rPr/>'); rp = child(r, 'rPr'); }
      for (const name of ['rStyle','rFonts','sz','szCs','b','bCs','i','iCs','color','caps','smallCaps']) child(rp,name).remove();
      rp.append(`<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b w:val="${level < 4 ? 1 : 0}"/><w:i w:val="${level >= 3 ? 1 : 0}"/><w:color w:val="000000"/><w:sz w:val="${size*2}"/><w:szCs w:val="${size*2}"/>`);
    });
  } else if (!number?.numId || number.numId === '0') {
    if (rec.role === 'body' || rec.role === 'chapter_summary') prop(p, 'ind', '<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
  }
  if (!heading && !major && rec.role !== 'intro_heading') {
    p.find(tag('r')).each((_, e) => {
      const r = $(e);
      if (!child(r,'t').length) return;
      let rp = child(r,'rPr'); if (!rp.length) { r.prepend('<w:rPr/>'); rp = child(r,'rPr'); }
      // Keep emphasis and symbol fonts, but remove source body font sizes.
      for (const name of ['sz','szCs']) child(rp,name).remove();
      rp.append('<w:sz w:val="26"/><w:szCs w:val="26"/>');
    });
  }
}

export function formatStructuredDocx(inputPath, outputPath, options, analysis = analyzeDocxStructure(inputPath)) {
  const graduation = options.documentType === 'do_an_tot_nghiep';
  const originalProposalSection=graduation?captureProposalBlock(analysis)?.sectionXml:'';
  let graduationReport = {};
  if (graduation) {
    graduationReport = prepareGraduation(analysis, options);
    const warnings = analysis.warnings;
    analysis = analyzeDocxStructure(analysis.archive);
    analysis.warnings.push(...warnings);
  }
  const { archive, $, body, records } = analysis;
  if(graduation)graduationReport.proposalStylesIsolated=isolateProposalStyles(analysis);
  const proposalBlock=graduation?captureProposalBlock(analysis):null;
  if(proposalBlock)markProposalBlock(analysis,proposalBlock);
  $(tag('document')).attr('xmlns:r', R);
  const profile = options.profile || {};
  const originalNumbering = archive.readAsText('word/numbering.xml');
  const originalProposal = records.filter(r=>r.region==='proposal' && !r.inIndex && r.text).map(r=>r.text);
  const preserved = new Set(records.filter(r => r.region==='proposal' || ['cover','embedded'].includes(r.role)).map(r => r.element));
  // Keep complete proposal tables through every shared normalization pass.
  // Restoring serialized subtrees also protects merged cells, drawings and links.
  const protectedTables = graduation ? body.children(tag('tbl')).toArray().filter(e =>
    records.some(r => r.region==='proposal' && $(r.element).parents(tag('tbl')).toArray().includes(e))
  ).map(e => ({element:e, xml:xmlOf($,e)})) : [];
  const generatedIndexes = new Set();
  const tocCode = 'TOC \\t "WFIntroTitle,1,WFIntroHeading,2,WFPartTitle,1,WFMajorTitle,1,WFHeading1,1,WFHeading2,2,WFHeading3,3,WFHeading4,4" \\h';
  let restoredIndexes = 0;
  for (const rec of records) {
    const p = $(rec.element);
    if (rec.inIndex) {
      const code = rec.indexCode || '';
      const figure = /(?:Hinh|Hình|HNH|Figure)/iu.test(code) || /^Hình\s/iu.test(rec.text);
      const table = /(?:Bang|Bảng|BNG|Table)/iu.test(code) || /^Bảng\s/iu.test(rec.text);
      const id = figure ? 'figures' : table ? 'tables' : rec.indexId ?? 'legacy-index';
      if (!generatedIndexes.has(id)) {
        const replacement = fieldParagraph(figure ? 'TOC \\c "Hinh" \\h' : table ? 'TOC \\c "Bang" \\h' : tocCode);
        p.before(replacement); generatedIndexes.add(id); restoredIndexes++;
      }
      p.remove(); continue;
    }
    if (preserved.has(rec.element) || rec.insideTable || (graduation && rec.styleId==='WFGraduationForm')) continue;
    applyParagraphFormat($, p, rec, profile);
    if (!rec.text && /^Heading|^WFHeading/.test(rec.styleId)) prop(p,'numPr','<w:numPr><w:numId w:val="0"/></w:numPr>');
  }
  // Remove source spacer paragraphs immediately before an index, including
  // leading spacers inside a TOC content control. Keep fields and other objects.
  body.find(tag('instrText')).filter((_,e)=>/^\s*TOC\b/i.test($(e).text())).each((_,e)=>{
    let node=$(e).parents(tag('p')).first();
    while(node.length && node[0]!==body[0]) {
      let previous=node.prev();
      while(previous[0]?.name==='w:p' && !textOf(previous).trim()
        && !previous.find('w\\:fldChar,w\\:instrText,w\\:fldSimple,w\\:drawing,w\\:pict,w\\:object,w\\:sectPr,w\\:bookmarkStart,w\\:bookmarkEnd,w\\:tab').length) {
        const next=previous.prev(); previous.remove(); previous=next;
      }
      if(previous.length)break;
      const parent=node.parent();
      if(!['w:sdtContent','w:sdt'].includes(parent[0]?.name))break;
      node=parent;
      if(node[0]?.name==='w:sdtContent')node=node.parent();
    }
  });
  // Format the existing cover's typography without replacing its author data.
  // Unknown artwork and tables remain in place; blank spacer paragraphs give
  // way to deterministic spacing on the actual cover text.
  let coverTopic = false, coverMetadata = false;
  for(const rec of records.filter(r=>r.role==='cover' && !r.insideTable)) {
    if(graduation)continue; // Dedicated cover layout owns logo, fields and spacing.
    const p=$(rec.element), key=keyOf(rec.text);
    if(!rec.text && !p.find(`${tag('drawing')},${tag('pict')}`).length) {p.remove();continue;}
    let size=14,bold=false,italic=false,before=0,align='center';
    if(/^TRUONG|^KHOA|^VIEN/.test(key)){size=15;bold=true;}
    else if(/^(DO AN|KHOA LUAN|TIEU LUAN|BAO CAO)/.test(key)){size=24;bold=true;before=60;}
    else if(/^TEN (DE TAI|TIEU LUAN)/.test(key)){size=16;italic=true;before=20;coverTopic=true;}
    else if(/^(NGUOI HUONG DAN|GIANG VIEN|SINH VIEN|MA SO SINH VIEN|MSSV|LOP|GVHD|SVTH)/.test(key)) {
      before=coverMetadata?0:60;coverMetadata=true;coverTopic=false;align='left';
    } else if(/THANG|NAM\s+20\d{2}/.test(key)){size=14;bold=true;before=70;coverTopic=false;}
    else if(coverTopic){size=20;bold=true;}
    prop(p,'jc',`<w:jc w:val="${align}"/>`);
    prop(p,'ind','<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
    prop(p,'spacing',`<w:spacing w:before="${before*20}" w:after="120" w:line="240" w:lineRule="auto"/>`);
    prop(p,'pageBreakBefore','<w:pageBreakBefore w:val="0"/>');
    p.find(tag('r')).each((_,e)=>{
      const r=$(e); let rp=child(r,'rPr');if(!rp.length){r.prepend('<w:rPr/>');rp=child(r,'rPr');}
      for(const name of ['rFonts','sz','szCs'])child(rp,name).remove();
      rp.append(`<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="${size*2}"/><w:szCs w:val="${size*2}"/>`);
      if(bold){child(rp,'b').remove();rp.append('<w:b/>');}
      if(italic){child(rp,'i').remove();rp.append('<w:i/>');}
    });
  }
  let tablesCentered=0, drawingParagraphsCentered=0, wideTablesDetected=0, tablesResized=0;
  const tableWidth = cm(21 - (profile.page?.margins_cm?.left ?? 3) - (profile.page?.margins_cm?.right ?? 2));
  const proposalLeads=new Set(records.map(r=>r.startElement).filter(Boolean));
  const protectedTable = table => proposalLeads.has(table)||records.some(r=>r.insideTable && ['cover','proposal'].includes(r.region) && $(r.element).parents(tag('tbl')).toArray().includes(table));
  body.find(tag('tbl')).each((_,table)=> {
    if(protectedTable(table))return;
    // Front-matter signature/comment layouts are not data tables.
    const rec=records.find(r=>r.insideTable && $(r.element).parents(tag('tbl')).toArray().includes(table));
    if(rec?.region==='front' && !records.slice(0,rec.index).reverse().find(r=>r.role==='front_title')?.text.includes('VIẾT TẮT'))return;
    repairDataTable($,table,tableWidth);
    tablesCentered++;tablesResized++;
  });
  for(const rec of records) {
    if(rec.insideTable||preserved.has(rec.element)||!rec.element.parent)continue;
    const p=$(rec.element);
    if(!p.find(tag('drawing')).length)continue;
    // Keep node identity used by the semantic section map.
    const result=normalizeTablesAndDrawings(xmlOf($,rec.element));
    const normalized=parse(result.xml);
    p.html(normalized(tag('p')).first().html());
    drawingParagraphsCentered+=result.stats.drawingParagraphsCentered;
  }
  ensureStyles(archive, profile);
  if(graduation) {
    const styles=parse(archive.readAsText('word/styles.xml'));
    for(const id of ['WFGraduationForm','WFCoverStart','WFGraduationCover']) {
      styles(tag('style')).filter((_,e)=>styles(e).attr('w:styleId')===id).remove();
      styles(tag('styles')).append(`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:outlineLvl w:val="9"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="26"/><w:color w:val="000000"/></w:rPr></w:style>`);
    }
    archive.updateFile('word/styles.xml',Buffer.from(styles.xml()));
  }
  const captionStats = normalizeStructuredCaptions($, records, analysis.warnings);
  // Remove empty TOC content controls, while preserving controls with other data.
  body.find(tag('sdt')).each((_, e) => { if (!$(e).find(tag('p')).length && !$(e).find(tag('tbl')).length) $(e).remove(); });
  // Every logical section gets independent header relationships. sectPr belongs
  // to the preceding section; never map it using a cached TOC heading.
  const starts = [];
  let firstChapter = true;
  const topNode = node => { let n = node; while (n.parent && n.parent !== body[0]) n = n.parent; return n; };
  for (const rec of records) {
    if (rec.insideTable || rec.inIndex || !rec.element.parent) continue;
    if (graduation && rec.styleId==='WFCoverStart') {
      starts.push({node:topNode(rec.element),role:'cover',title:''});
      continue;
    }
    if (['proposal_title','front_title','intro_title','part_title','chapter','major_title'].includes(rec.role)) {
      const node = rec.startElement || topNode(rec.element);
      if (rec.role === 'chapter' && starts.at(-1)?.role === 'part_title' && !starts.at(-1).containsChapter) {
        starts.at(-1).title = rec.displayText; starts.at(-1).isFirstChapter = firstChapter; firstChapter = false;
        starts.at(-1).containsChapter = true;
        continue;
      }
      starts.push({ node, role: rec.role, title: rec.displayText || rec.text,
        isFirstChapter: rec.role === 'chapter' && firstChapter, rec });
      if (rec.role === 'chapter') firstChapter = false;
    }
  }
  // Source files sometimes start with empty page-break paragraphs, not a cover.
  while (body.children().first()[0]?.name === 'w:p' && !textOf(body.children().first()).trim()
    && !body.children().first().find(`${tag('drawing')},${tag('pict')},${tag('object')}`).length) body.children().first().remove();
  // An initial page break before the first cover text is a blank page artifact.
  body.children().first().find(`${tag('br')}[w\\:type="page"]`).first().remove();
  const requested = new Set((options.frontMatter || '').split(',').map(s=>s.trim()));
  const hasCover = records.some(r=>r.role==='cover' && r.text);
  const coverLine = (text,size,before=0,bold=false) => `<w:p><w:pPr><w:spacing w:before="${before*20}" w:after="120"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b w:val="${bold?1:0}"/><w:sz w:val="${size*2}"/></w:rPr><w:t>${esc(text)}</w:t></w:r></w:p>`;
  if (requested.has('cover') && !hasCover) {
    body.prepend(coverLine(options.institution || profile.cover?.institution || '',15,0,true)
      + coverLine(options.faculty || profile.cover?.faculty || '',15,0,true)
      + coverLine('---oOo---',15) + coverLine(options.documentTitle || 'TIỂU LUẬN MÔN HỌC',24,70,true)
      + coverLine('Tên đề tài:',16,18) + coverLine(options.topic || 'TÊN ĐỀ TÀI',20,6,true)
      + coverLine(`Người hướng dẫn: ${options.instructor}`,14,60)
      + coverLine(`Sinh viên thực hiện: ${options.student}`,14)
      + (options.studentId?coverLine(`Mã số sinh viên: ${options.studentId}`,14):'')
      + (options.className?coverLine(`Lớp: ${options.className}`,14):'')
      + coverLine(`${options.location || profile.cover?.location || 'Thành phố Hồ Chí Minh'}${options.month?', tháng '+options.month:''}${options.year?', năm '+options.year:''}`,14,70,true));
  }
  for (const [option,label] of [['comments','NHẬN XÉT CỦA GIẢNG VIÊN'],['thanks','LỜI CẢM ƠN']]) {
    if(graduation && option==='comments')continue;
    if (!requested.has(option) || records.some(r=>r.role==='front_title' && (option==='thanks'?keyOf(r.text)==='LOI CAM ON':keyOf(r.text).startsWith('NHAN XET')))) continue;
    const target=starts.find(s=>s.role==='front_title'||s.role==='intro_title'||s.role==='chapter'||s.role==='part_title');
    if (!target) continue;
    const commentLine='<w:p><w:pPr><w:pStyle w:val="WFBody"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9071"/></w:tabs><w:spacing w:before="0" w:after="0" w:line="460" w:lineRule="exact"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:r><w:tab/></w:r></w:p>';
    const nodes=$(paragraph(label,'WFFrontTitle')+(option==='comments'?commentLine.repeat(24):paragraph('')));
    $(target.node).before(nodes);
    starts.push({node:nodes[0],role:'front_title',title:label});
  }
  // Move the entire thanks block, including tables and controls, before TOC.
  const thanks=starts.find(s=>keyOf(s.title)==='LOI CAM ON');
  const toc=starts.find(s=>keyOf(s.title)==='MUC LUC');
  let frontMatterReordered=false;
  if (thanks && toc) {
    const children=body.children().toArray(), from=children.indexOf(thanks.node), to=children.indexOf(toc.node);
    if(from>to) {
      const boundaries=new Set(starts.map(s=>s.node)); let end=from+1;
      while(end<children.length&&!boundaries.has(children[end]))end++;
      $(toc.node).before(children.slice(from,end)); frontMatterReordered=true;
    }
  }
  // Restore the legacy thanks frame; original shapes take precedence.
  let acknowledgementFramesAdded=0;
  if(thanks && ensureAcknowledgementFrame($,thanks.node))acknowledgementFramesAdded++;
  const figures=starts.find(s=>/DANH MUC (?:CAC )?HINH/.test(keyOf(s.title)));
  const tables=starts.find(s=>/DANH MUC (?:CAC )?BANG/.test(keyOf(s.title)));
  if(figures && tables) {
    const nodes=body.children().toArray(), from=nodes.indexOf(figures.node), to=nodes.indexOf(tables.node);
    if(from>to){const boundaries=new Set(starts.map(s=>s.node));let end=from+1;while(end<nodes.length&&!boundaries.has(nodes[end]))end++;$(tables.node).before(nodes.slice(from,end));frontMatterReordered=true;}
  }
  starts.sort((a,b)=>body.children().toArray().indexOf(a.node)-body.children().toArray().indexOf(b.node));
  const firstElement = body.children().first()[0];
  if (starts[0]?.node !== firstElement) starts.unshift({ node: firstElement, role: 'cover', title: '' });
  let bindingPagesInserted = 0;
  if (!graduation && options.documentMode === 'binding_package' && starts[0]?.role === 'cover' && starts[1]) {
    const children = body.children().toArray(), end = children.indexOf(starts[1].node);
    const copy = $(children.slice(0,end).map(e=>xmlOf($,e)).join(''));
    copy.find(`${tag('sectPr')},${tag('bookmarkStart')},${tag('bookmarkEnd')}`).remove();
    copy.find(tag('p')).addBack(tag('p')).removeAttr('w14:paraId').removeAttr('w14:textId');
    let drawingId = Math.max(0,...$('wp\\:docPr').toArray().map(e=>Number($(e).attr('id'))||0));
    copy.find('wp\\:docPr').each((_,e)=>$(e).attr('id',String(++drawingId)));
    const blank = $(paragraph(''));
    $(starts[1].node).before(blank).before(copy);
    starts.splice(1,0,{node:blank[0],role:'cover',title:''},{node:copy[0],role:'cover',title:''});
    bindingPagesInserted=2;
  }
  // Capture original section geometry for proposal before removing boundaries.
  const proposalStart = records.find(r => r.role === 'proposal_title');
  let proposalGeometry = '';
  if (proposalStart) {
    let after = false;
    body.find(`${tag('p')},${tag('sectPr')}`).each((_, e) => {
      if (e === proposalStart.element) after = true;
      if (after && e.name === 'w:sectPr' && !proposalGeometry) proposalGeometry = $.xml(e);
    });
  }
  body.find(tag('sectPr')).remove(); child(body,'sectPr').remove();
  // Old hard page breaks next to semantic starts produce blank pages when a
  // nextPage section is added. Clear only the boundary whitespace, not content.
  for (const start of starts.slice(1)) {
    let prev = $(start.node).prev();
    while (prev.length && prev[0].name === 'w:p' && !textOf(prev).trim() && !prev.find(`${tag('drawing')},${tag('pict')},${tag('object')},${tag('tab')}`).length) {
      const next = prev.prev(); prev.remove(); prev = next;
    }
    $(start.node).find(`${tag('br')}[w\\:type="page"]`).remove();
  }
  const rels = parse(archive.readAsText('word/_rels/document.xml.rels'));
  const types = parse(archive.readAsText('[Content_Types].xml'));
  const addPart = (name, kind, xml) => {
    const id = `wfStructure_${name.replace(/\W/g,'_')}`;
    rels('Relationship').filter((_, e) => rels(e).attr('Id') === id).remove();
    rels('Relationships').append(`<Relationship Id="${id}" Type="${R}/${kind}" Target="${name}"/>`);
    if (!types('Override').toArray().some(e => types(e).attr('PartName') === `/word/${name}`)) types('Types').append(`<Override PartName="/word/${name}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${kind}+xml"/>`);
    archive.addFile(`word/${name}`, Buffer.from(xml)); return id;
  };
  const title = graduation ? 'ĐỒ ÁN TỐT NGHIỆP' : analysis.documentType || options.documentTitle || 'TIỂU LUẬN MÔN HỌC';
  const hfRun = text => `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="20"/></w:rPr><w:t>${esc(text)}</w:t></w:r>`;
  const hfParagraph = (left, right, page = false) => {
    const cell = (width,align,content) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="${align}"/></w:pPr>${content}</w:p></w:tc>`;
    const pageField = '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>'+hfRun('1')+'<w:r><w:fldChar w:fldCharType="end"/></w:r>';
    const widths = page ? [4000,1071,4000] : [3000,6071];
    return `<w:tbl><w:tblPr><w:tblW w:w="9071" w:type="dxa"/><w:tblBorders><w:${page?'top':'bottom'} w:val="single" w:sz="4" w:color="808080"/></w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr>${cell(widths[0],'left',hfRun(left))}${page?cell(widths[1],'center',pageField):''}${cell(widths.at(-1),'right',hfRun(right))}</w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`;
  };
  let bodyStarted = false;
  const firstNumberedSection = starts.findIndex(s=>s.role!=='cover');
  for (let i=0; i<starts.length; i++) {
    const s = starts[i]; if(s.isFirstChapter) bodyStarted = true;
    const h = addPart(`wfStructureHeader${i}.xml`,'header', `<w:hdr xmlns:w="${W}">${s.role==='cover'?'<w:p/>':hfParagraph(title,s.title)}</w:hdr>`);
    const f = addPart(`wfStructureFooter${i}.xml`,'footer', `<w:ftr xmlns:w="${W}">${s.role==='cover'?'<w:p/>':hfParagraph(`GVHD: ${options.instructor}`,`SVTH: ${options.student}`,true)}</w:ftr>`);
    const margins = (graduation && s.role==='cover' && profile.cover?.margins_cm) || profile.page?.margins_cm || {top:2,bottom:2,left:3,right:2};
    let geometry = `<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${cm(margins.top)}" w:right="${cm(margins.right)}" w:bottom="${cm(margins.bottom)}" w:left="${cm(margins.left)}" w:header="567" w:footer="567" w:gutter="0"/>`;
    if(s.role==='proposal_title' && proposalGeometry) {
      const pg = parse(proposalGeometry); geometry = pg(tag('pgSz')).toArray().concat(pg(tag('pgMar')).toArray()).map(e=>pg.xml(e)).join('') || geometry;
    }
    const border=graduation ? profile.cover?.page_border : null;
    const coverBorder=border ? '<w:pgBorders w:offsetFrom="page" w:zOrder="front" w:display="allPages">'+['top','left','bottom','right'].map(side=>`<w:${side} w:val="${esc(border.style)}" w:sz="${border.size_eighth_points}" w:space="${['top','bottom'].includes(side)?border.top_bottom_space_pt:border.left_right_space_pt}" w:color="${esc(border.color_hex)}"/>`).join('')+'</w:pgBorders>' : '<w:pgBorders w:offsetFrom="page">'+['top','left','bottom','right'].map(side=>`<w:${side} w:val="single" w:sz="8" w:space="18" w:color="000000"/>`).join('')+'</w:pgBorders>';
    let section = `<w:sectPr><w:headerReference w:type="default" r:id="${h}"/><w:headerReference w:type="even" r:id="${h}"/><w:headerReference w:type="first" r:id="${h}"/><w:footerReference w:type="default" r:id="${f}"/><w:footerReference w:type="even" r:id="${f}"/><w:footerReference w:type="first" r:id="${f}"/><w:type w:val="nextPage"/>${geometry}${s.role==='cover' && textOf($(s.node)).trim()?coverBorder:''}<w:pgNumType w:fmt="${bodyStarted?'decimal':'lowerRoman'}"${s.isFirstChapter || i===firstNumberedSection ? ' w:start="1"':''}/></w:sectPr>`;
    if(graduation && s.role==='proposal_title' && originalProposalSection) section=normalizeWordprocessingPropertyOrder(originalProposalSection).xml;
    if (i === starts.length-1) body.append(section);
    else $(starts[i+1].node).before(`<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/>${section}</w:pPr></w:p>`);
  }
  let dashReplacements=0;
  body.find(tag('t')).each((_,e)=>{
    if(preserved.has($(e).parents(tag('p')).first()[0]))return;
    const text=$(e).text();dashReplacements+=(text.match(/[–—]/g)||[]).length;
    $(e).text(text.replace(/[–—]/g,'-'));
  });
  // Hide protected subtrees from string-based global cleanup. Restore before
  // removing unused relationships so links inside the proposal remain valid.
  if(!proposalBlock)protectedTables.forEach((entry,i)=>$(entry.element).replaceWith(`<!--WF_PROTECTED_TABLE_${i}-->`));
  let documentXml = xmlOf($);
  const hyperlinks = stripReferenceHyperlinks(documentXml);
  documentXml = hyperlinks.xml;
  documentXml = normalizeWordprocessingPropertyOrder(documentXml).xml;
  protectedTables.forEach((entry,i)=>{documentXml=documentXml.replace(`<!--WF_PROTECTED_TABLE_${i}-->`,entry.xml);});
  documentXml=restoreProposalBlock(documentXml,proposalBlock);
  const relationshipResult = removeUnusedHyperlinkRelationships(rels.xml(), hyperlinks.removedRelationshipIds, documentXml);
  archive.updateFile('word/document.xml', Buffer.from(documentXml));
  archive.updateFile('word/_rels/document.xml.rels', Buffer.from(relationshipResult.xml));
  archive.updateFile('[Content_Types].xml', Buffer.from(types.xml()));
  const settings = parse(archive.readAsText('word/settings.xml') || `<w:settings xmlns:w="${W}"/>`);
  settings(tag('updateFields')).remove(); settings(tag('settings')).append('<w:updateFields w:val="true"/>');
  archive.addFile('word/settings.xml', Buffer.from(settings.xml()));
  archive.writeZip(outputPath);
  const verified = analyzeDocxStructure(outputPath);
  const chapterStructure = JSON.stringify(verified.chapters.map(r=>r.number)) === JSON.stringify(analysis.chapters.map(r=>r.number));
  const proposalPreserved = JSON.stringify(verified.records.filter(r=>r.region==='proposal'&&!r.inIndex&&r.text).map(r=>r.text)) === JSON.stringify(originalProposal);
  const proposalTablesPreserved = protectedTables.every(entry=>documentXml.includes(entry.xml));
  const proposalBlockPreserved=!proposalBlock || documentXml.includes(proposalBlock.xml);
  if(!chapterStructure || !proposalPreserved || !proposalTablesPreserved || !proposalBlockPreserved) throw new Error('Kiểm tra sau định dạng phát hiện thay đổi cấu trúc chương hoặc nội dung đề cương.');
  const $out=verified.$, sections=$out(tag('sectPr')).toArray();
  const expectedMargins=profile.page?.margins_cm || {top:2,bottom:2,left:3,right:2};
  const a4Portrait=sections.every(s=>Number(child($out(s),'pgSz').attr('w:w'))===11906 && Number(child($out(s),'pgSz').attr('w:h'))===16838);
  const margins=sections.every((s,i)=>Object.entries((graduation && starts[i]?.role==='cover' && profile.cover?.margins_cm) || expectedMargins).every(([k,v])=>Number(child($out(s),'pgMar').attr(`w:${k}`))===cm(v)));
  const headingIndentation=verified.records.filter(r=>r.role==='heading' && r.level>=3).every(r=>{
    const ind=$out(r.element).find(tag('ind')).first();
    return Number(ind.attr('w:left'))-Number(ind.attr('w:hanging')||0)===cm(profile.headings?.[`level${r.level}`]?.number_position_cm ?? (r.level===3?1.27:2.54));
  });
  return { success:true, outputPath, fileSize:fs.statSync(outputPath).size,
    report: { appliedProfile:{profileId:profile.profile_id,sourceRevision:profile.source_revision},
      structure:{...analysis.summary,engine:'ooxml-structure-v1',proposalPolicy:'preserve',documentTitle:title,documentType:options.documentType || 'tieu_luan',...graduationReport},
      outputNormalization:{ headersNormalized:starts.length, sectionsNormalized:starts.length, indexesRebuilt:restoredIndexes,
        enDashesReplaced:dashReplacements, hyperlinksRemoved:hyperlinks.stats.hyperlinksRemoved, frontMatterReordered, bindingPagesInserted,
        compliance:{ a4Portrait,margins,bodySpacing:archive.readAsText('word/styles.xml').includes('w:before="120" w:after="0" w:line="288"'),
          listsPreserved:archive.readAsText('word/numbering.xml')===originalNumbering,
          smartQuotesPreserved:true,referenceHyperlinksRemoved:stripReferenceHyperlinks(documentXml).stats.hyperlinksRemoved===0,
          longDashesNormalized:!verified.records.some(r=>!['cover','proposal'].includes(r.region)&&/[–—]/.test(r.text)),
          wideTablesFitPortrait:wideTablesDetected===0,headingStructure:chapterStructure,headingIndentation,proposalPreserved,proposalTablesPreserved,proposalBlockPreserved },
        tablesCentered, drawingParagraphsCentered, wideTablesDetected, tablesResized, acknowledgementFramesAdded, ...captionStats,
        warnings:analysis.warnings } } };
}
