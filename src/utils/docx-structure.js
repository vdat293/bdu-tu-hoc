import fs from 'node:fs';
import { prepareGraduation, prepareCourseworkCover, isolateProposalStyles } from './docx-graduation.js';
import { readCoverMetadata, getCurrentMonthYear, computeBalancedCenteredWrap } from './docx-graduation-cover.js';
import {captureProposalBlock, markProposalBlock, restoreProposalBlock} from './docx-proposal-preservation.js';
import { repairDataTable, normalizeStructuredCaptions, ensureAcknowledgementFrame, convertTabbedTableBlocks } from './docx-layout.js';
import { upgradeEquationParagraphToOmml } from './docx-math.js';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import {
  processStylesXml, normalizeWordprocessingPropertyOrder,
  normalizeTablesAndDrawings, stripReferenceHyperlinks,
  removeUnusedHyperlinkRelationships, normalizeBodyText
} from './docx-postprocessor.js';

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const parse = xml => load(xml, { xml: true });
// Keep readable Unicode while retaining XML escapes for syntax characters.
const xmlOf = ($, node) => $.xml(node).replace(/&#x([0-9a-f]+);/gi, (m, n) => Number.parseInt(n,16) > 127 ? String.fromCodePoint(Number.parseInt(n,16)) : m);
const tag = name => `w\\:${name}`;
const child = (node, name) => node.children(tag(name));
const val = (node, name) => child(node, name).attr('w:val');
const textOf = node => node.find(tag('t')).toArray().map(n => n.children?.map(c => c.data || '').join('')).join('');
const mathTextOf = node => node.find('m\\:t').toArray().map(n => n.children?.map(c => c.data || '').join('')).join('');
const hasMathNode = node => node.find('m\\:oMathPara, m\\:oMath').length > 0;
const keyOf = s => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/\s+/g, ' ').trim();
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const cm = n => Math.round(n * 1440 / 2.54);

const REGULAR_CHAR_EM = {
  I: 0.333, J: 0.389,
  F: 0.556, L: 0.556, P: 0.556, S: 0.556,
  B: 0.611, E: 0.611, T: 0.611, Z: 0.611,
  C: 0.667, R: 0.667,
  A: 0.722, D: 0.722, G: 0.722, H: 0.722, K: 0.722, N: 0.722, O: 0.722,
  Q: 0.722, U: 0.722, V: 0.722, X: 0.722, Y: 0.722,
  M: 0.889, W: 0.944,
  i: 0.278, j: 0.278, l: 0.278,
  f: 0.333, r: 0.333, t: 0.333,
  s: 0.389,
  a: 0.444, c: 0.444, e: 0.444, z: 0.444,
  b: 0.500, d: 0.500, g: 0.500, h: 0.500, k: 0.500, n: 0.500, o: 0.500,
  p: 0.500, q: 0.500, u: 0.500, v: 0.500, x: 0.500, y: 0.500,
  w: 0.722, m: 0.778,
  ' ': 0.250, '.': 0.278, ',': 0.278, ':': 0.278, ';': 0.278, "'": 0.278,
  '!': 0.333, '?': 0.444, '-': 0.333, '/': 0.278, '(': 0.333, ')': 0.333,
  '[': 0.333, ']': 0.333, '"': 0.408, '&': 0.778, '%': 0.833
};

export function estimateRegularTextWidthPt(textStr, sizePt) {
  const raw = String(textStr || '').trim().replace(/\s+/g, ' ');
  let em = 0;
  for (const ch of raw) {
    const hasHorn = /[ƠƯơư]/u.test(ch);
    const base = ch === 'Đ' ? 'D' : ch === 'đ' ? 'd' : ch.normalize('NFD').replace(/\p{M}/gu, '');
    const chEm = REGULAR_CHAR_EM[base] ?? (/\d/.test(base) ? 0.500 : (base === base.toUpperCase() ? 0.722 : 0.500));
    em += chEm + (hasHorn ? 0.045 : 0);
  }
  return em * sizePt;
}

function wrapGreedyRegular(words, sizePt, limitPt) {
  const spacePt = 0.25 * sizePt;
  const lines = [];
  let curWords = [];
  let curWidth = 0;
  for (const word of words) {
    const wPt = estimateRegularTextWidthPt(word, sizePt);
    const nextWidth = curWords.length ? curWidth + spacePt + wPt : wPt;
    if (curWords.length && nextWidth > limitPt) {
      lines.push({ words: curWords, widthPt: curWidth });
      curWords = [word];
      curWidth = wPt;
    } else {
      curWords.push(word);
      curWidth = nextWidth;
    }
  }
  if (curWords.length) lines.push({ words: curWords, widthPt: curWidth });
  return lines;
}

function computeRightCellAntiOrphanIndentDxa(textStr, sizePt, cellWidthDxa) {
  const words = String(textStr || '').trim().split(/\s+/).filter(Boolean);
  const fullWidthPt = cellWidthDxa / 20;
  const effectiveMaxPt = Math.max(120, fullWidthPt - 8);
  if (words.length < 4) return 0;
  const initialLines = wrapGreedyRegular(words, sizePt, effectiveMaxPt);
  if (initialLines.length <= 1) return 0;
  const lastLine = initialLines.at(-1);
  const prevLine = initialLines.at(-2);
  const isOrphan = lastLine.words.length === 1
    || (lastLine.words.length === 2 && words.length >= 7 && lastLine.widthPt < effectiveMaxPt * 0.22 && prevLine.widthPt > effectiveMaxPt * 0.78);
  if (!isOrphan) return 0;
  const minTargetWords = words.length >= 6 ? 3 : 2;
  let fallbackIndent = 0;
  for (let limitPt = Math.floor(effectiveMaxPt - 6); limitPt >= Math.floor(effectiveMaxPt * 0.58); limitPt -= 4) {
    const candidate = wrapGreedyRegular(words, sizePt, limitPt);
    if (candidate.length > initialLines.length) break;
    const candLast = candidate.at(-1);
    if (candLast.words.length >= 2 && !fallbackIndent) {
      fallbackIndent = Math.max(0, Math.round((fullWidthPt - limitPt) * 20));
    }
    if (candLast.words.length >= minTargetWords || candLast.widthPt >= limitPt * 0.30) {
      return Math.max(0, Math.round((fullWidthPt - limitPt) * 20));
    }
  }
  return fallbackIndent;
}

function fitSingleLineCellText(textStr, cellWidthDxa, baseSizePt = 13, minSizePt = 10.5, safetyMarginPt = 8) {
  const clean = String(textStr || '').trim();
  if (!clean) return { sizePt: baseSizePt, leftIndentDxa: 0, fitsSingleLine: true };
  const safeWidthPt = Math.max(40, (cellWidthDxa / 20) - safetyMarginPt);
  const effectiveMin = Math.min(baseSizePt, minSizePt);
  for (let sz = baseSizePt; sz >= effectiveMin - 1e-6; sz -= 0.5) {
    const candidatePt = Math.round(sz * 2) / 2;
    if (estimateRegularTextWidthPt(clean, candidatePt) <= safeWidthPt) {
      return { sizePt: candidatePt, leftIndentDxa: 0, fitsSingleLine: true };
    }
  }
  const multiLineSizePt = Math.min(baseSizePt, Math.max(11, effectiveMin));
  return {
    sizePt: multiLineSizePt,
    leftIndentDxa: computeRightCellAntiOrphanIndentDxa(clean, multiLineSizePt, cellWidthDxa),
    fitsSingleLine: false
  };
}

export function computeHeaderLayout(leftText, rightText, baseSizePt = 13, totalWidthDxa = 9071) {
  const rawLeftDxa = Math.ceil(estimateRegularTextWidthPt(leftText, baseSizePt) * 20);
  const leftWidth = Math.min(3400, Math.max(1900, rawLeftDxa + 120));
  const rightWidth = totalWidthDxa - leftWidth;
  const leftFit = fitSingleLineCellText(leftText, leftWidth, baseSizePt, 11, 6);
  const rightFit = fitSingleLineCellText(rightText, rightWidth, baseSizePt, 10.5, 8);
  return {
    widths: [leftWidth, rightWidth],
    leftSizePt: leftFit.sizePt,
    rightSizePt: rightFit.sizePt,
    rightLeftIndentDxa: rightFit.leftIndentDxa,
    rightFitsSingleLine: rightFit.fitsSingleLine,
    bottomPaddingDxa: 60,
    afterBorderSpacerDxa: 120
  };
}

function leadingPageBorderSections(archive, maxSections = 3) {
  const documentXml = archive.readAsText('word/document.xml');
  const sections = [...documentXml.matchAll(/<w:sectPr\b[\s\S]*?<\/w:sectPr>/g)].map(match => match[0]);
  return sections.slice(0, maxSections).flatMap((sectionXml, index) => {
    const borders = sectionXml.match(/<w:pgBorders\b[\s\S]*?<\/w:pgBorders>/)?.[0] || '';
    const visible = /<w:(?:top|left|bottom|right)\b[^>]*\bw:val="(?!(?:nil|none)")[^"]+"/i.test(borders);
    return visible ? [index + 1] : [];
  });
}

function replaceBorderedLeadingCoverPages(analysis, borderedSections) {
  if (!borderedSections.length) return 0;
  const { $, body, records, archive } = analysis;
  const topNode = node => { let current = node; while (current.parent && current.parent !== body[0]) current = current.parent; return current; };
  const firstContent = records.find(record => ['proposal_title', 'front_title', 'intro_title', 'part_title', 'chapter', 'major_title'].includes(record.role));
  const boundary = firstContent && (firstContent.startElement || topNode(firstContent.element));
  const children = body.children().toArray();
  const end = boundary ? children.indexOf(boundary) : 0;
  if (end <= 0) return 0;

  // Page borders in the first three logical sections identify imported cover
  // templates. Replace just this leading block; the semantic boundary and all
  // proposal/front-matter content after it remain untouched.
  children.slice(0, end).forEach(node => $(node).remove());
  archive.updateFile('word/document.xml', Buffer.from($.xml()));
  return borderedSections.length;
}

function metadataFromBorderedLeadingCoverPages(analysis, borderedSections) {
  if (!borderedSections.length) return {};
  const { $, body, records } = analysis;
  const topNode = node => { let current = node; while (current.parent && current.parent !== body[0]) current = current.parent; return current; };
  const firstContent = records.find(record => ['proposal_title', 'front_title', 'intro_title', 'part_title', 'chapter', 'major_title'].includes(record.role));
  const boundary = firstContent && (firstContent.startElement || topNode(firstContent.element));
  const children = body.children().toArray();
  const end = boundary ? children.indexOf(boundary) : 0;
  if (end <= 0) return {};
  return readCoverMetadata(children.slice(0, end).map(node => textOf($(node))).join('\n'));
}

function indexPageDefinition(title) {
  const normalized = keyOf(title);
  if (normalized === 'MUC LUC') {
    return {
      kind: 'toc',
      label: 'MỤC LỤC',
      field: 'TOC \\t "WFIntroTitle,1,WFIntroHeading,2,WFPartTitle,1,WFMajorTitle,1,WFHeading1,1,WFHeading2,2,WFHeading3,3,WFHeading4,4" \\h'
    };
  }
  if (/^(?:DANH MUC|MUC LUC) (?:CAC )?(?:HINH|HINH ANH|HINH VE)\b/.test(normalized)) {
    return { kind: 'figures', label: 'DANH MỤC HÌNH ẢNH', field: 'TOC \\c "Hinh" \\h' };
  }
  if (/^(?:DANH MUC|MUC LUC) (?:CAC )?(?:BANG|BANG BIEU)\b/.test(normalized)) {
    return { kind: 'tables', label: 'DANH MỤC BẢNG', field: 'TOC \\c "Bang" \\h' };
  }
  return null;
}

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
function fieldControl(code) {
  return `<w:sdt><w:sdtContent>${fieldParagraph(code)}</w:sdtContent></w:sdt>`;
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

// Manual role overrides chosen in the preview editor. They are stored as hidden
// bookmarks (leading underscore) so they survive every re-analysis pass and
// remain valid OOXML; re-formatting an output keeps the user's decisions.
export const ROLE_OVERRIDE_KEYS = ['chapter', 'heading2', 'heading3', 'heading4', 'major_title', 'front_title',
  'intro_title', 'body', 'equation', 'signature', 'figure_caption', 'table_caption'];
const ROLE_BOOKMARK_PREFIX = '_WFRole_';

function forcedRoleOf($, p) {
  const name = p.children(tag('bookmarkStart')).toArray().map(e => $(e).attr('w:name') || '')
    .find(n => n.startsWith(ROLE_BOOKMARK_PREFIX));
  const key = name?.slice(ROLE_BOOKMARK_PREFIX.length);
  return ROLE_OVERRIDE_KEYS.includes(key) ? key : null;
}

/**
 * Apply preview-editor role overrides to an archive in place.
 * @param {AdmZip} archive
 * @param {Record<string,string>} overrides paragraph index (as reported by
 *   analyzeDocxStructure on the same input) → role key, or 'auto' to clear.
 * @returns {number} number of paragraphs changed
 */
export function applyRoleOverrides(archive, overrides = {}) {
  const entries = Object.entries(overrides || {}).filter(([index, role]) =>
    /^\d+$/.test(index) && (role === 'auto' || ROLE_OVERRIDE_KEYS.includes(role)));
  if (!entries.length) return 0;
  const $ = parse(archive.readAsText('word/document.xml'));
  const paragraphs = $(tag('body')).find(tag('p')).toArray();
  let nextId = Math.max(880000, ...$(tag('bookmarkStart')).toArray().map(e => Number($(e).attr('w:id')) || 0)) + 1;
  let changed = 0;
  for (const [index, role] of entries) {
    const element = paragraphs[Number(index)];
    if (!element) continue;
    const p = $(element);
    p.children(tag('bookmarkStart')).each((_, e) => {
      const node = $(e);
      if (!(node.attr('w:name') || '').startsWith(ROLE_BOOKMARK_PREFIX)) return;
      const id = node.attr('w:id');
      p.children(tag('bookmarkEnd')).filter((__, end) => $(end).attr('w:id') === id).remove();
      node.remove();
    });
    if (role !== 'auto') {
      const id = nextId++;
      const marker = `<w:bookmarkStart w:id="${id}" w:name="${ROLE_BOOKMARK_PREFIX}${role}"/><w:bookmarkEnd w:id="${id}"/>`;
      const pPr = child(p, 'pPr');
      if (pPr.length) pPr.after(marker); else p.prepend(marker);
    }
    changed++;
  }
  archive.updateFile('word/document.xml', Buffer.from(xmlOf($)));
  return changed;
}

/**
 * Attach preview-editor notes as Word comments, so the author can find the
 * places they flagged directly in the formatted document.
 * @param {AdmZip} archive
 * @param {Record<string,string>} notes paragraph index → note text
 * @returns {number} number of comments added
 */
export function applyParagraphNotes(archive, notes = {}, author = 'BDU WordFmt') {
  const entries = Object.entries(notes || {})
    .map(([index, note]) => [index, String(note ?? '').trim().slice(0, 1000)])
    .filter(([index, note]) => /^\d+$/.test(index) && note);
  if (!entries.length) return 0;
  const $ = parse(archive.readAsText('word/document.xml'));
  const paragraphs = $(tag('body')).find(tag('p')).toArray();
  const commentsXml = archive.readAsText('word/comments.xml') || `<w:comments xmlns:w="${W}"></w:comments>`;
  const $c = parse(commentsXml);
  let nextId = Math.max(-1, ...$c(tag('comment')).toArray().map(e => Number($c(e).attr('w:id')) || 0),
    ...$(tag('commentRangeStart')).toArray().map(e => Number($(e).attr('w:id')) || 0)) + 1;
  const date = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  let added = 0;
  for (const [index, note] of entries) {
    const element = paragraphs[Number(index)];
    if (!element) continue;
    const p = $(element), id = nextId++;
    const pPr = child(p, 'pPr');
    const start = `<w:commentRangeStart w:id="${id}"/>`;
    if (pPr.length) pPr.after(start); else p.prepend(start);
    p.append(`<w:commentRangeEnd w:id="${id}"/><w:r><w:commentReference w:id="${id}"/></w:r>`);
    const body = note.split(/\r?\n/).map(line => `<w:p><w:r><w:t xml:space="preserve">${esc(line)}</w:t></w:r></w:p>`).join('');
    $c(tag('comments')).append(`<w:comment w:id="${id}" w:author="${esc(author)}" w:initials="WF" w:date="${date}">${body}</w:comment>`);
    added++;
  }
  if (!added) return 0;
  archive.updateFile('word/document.xml', Buffer.from(xmlOf($)));
  const commentsOut = xmlOf($c);
  if (archive.getEntry('word/comments.xml')) archive.updateFile('word/comments.xml', Buffer.from(commentsOut));
  else archive.addFile('word/comments.xml', Buffer.from(commentsOut));
  const rels = parse(archive.readAsText('word/_rels/document.xml.rels'));
  if (!rels('Relationship').toArray().some(e => /\/comments$/.test(rels(e).attr('Type') || ''))) {
    rels('Relationships').append(`<Relationship Id="wfComments" Type="${R}/comments" Target="comments.xml"/>`);
    archive.updateFile('word/_rels/document.xml.rels', Buffer.from(rels.xml()));
  }
  const types = parse(archive.readAsText('[Content_Types].xml'));
  if (!types('Override').toArray().some(e => types(e).attr('PartName') === '/word/comments.xml')) {
    types('Types').append('<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>');
    archive.updateFile('[Content_Types].xml', Buffer.from(types.xml()));
  }
  return added;
}

function buildSourceStyleAlignmentMap(archive) {
  const $s = parse(archive.readAsText('word/styles.xml') || '<w:styles/>');
  return new Map($s(tag('style')).toArray().map(n => [$s(n).attr('w:styleId'), $s(n)]));
}

function resolveSourceLayout(p, styleMap) {
  const pp = child(p, 'pPr');
  let jc = val(pp, 'jc') || '';
  let left = Number(child(pp, 'ind').attr('w:left') || 0);
  let sId = val(pp, 'pStyle');
  const seen = new Set();
  while ((!jc || !left) && sId && !seen.has(sId) && styleMap.has(sId)) {
    seen.add(sId);
    const st = styleMap.get(sId);
    const spp = child(st, 'pPr');
    if (!jc) jc = val(spp, 'jc') || '';
    if (!left) left = Number(child(spp, 'ind').attr('w:left') || 0);
    sId = val(st, 'basedOn');
  }
  return { jc, left };
}

const SIGNATURE_ROLE_KEY_RE = /^(?:SINH VIEN(?: THUC HIEN)?|SVTH|NGUOI THUC HIEN|NHOM(?: SINH VIEN)?(?: THUC HIEN)?|TAC GIA|NGUOI VIET|HOC VIEN(?: THUC HIEN)?)$/;
const SIGNATURE_DATE_KEY_RE = /^(?:[\p{L}\s.]+,\s*)?(?:NGAY\b[\s\S]*THANG\b[\s\S]*NAM\b|THANG\b[\s\S]*NAM\b)/iu;

function isStandaloneEquation($, p, text, styleId, region, numbering, sourceJc = '') {
  if (!['introduction', 'body', 'conclusion', 'front'].includes(region)) return false;
  if (numbering?.numId && numbering.numId !== '0') return false;
  if (/^(?:WFEquation|Equation|Formula|Math|DisplayEquation|BlockEquation)$/i.test(styleId)) return true;
  if (p.find('m\\:oMathPara').length > 0) return true;
  if (p.find('m\\:oMath').length > 0) {
    const outsideText = p.find(tag('t')).toArray()
      .filter(n => $(n).parents('m\\:oMath').length === 0)
      .map(n => $(n).text())
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    const strippedEqNum = outsideText.replace(/^(?:[\(\[]\d+(?:[.\-]\d+)*[\)\]])\s*|\s*(?:[\(\[]\d+(?:[.\-]\d+)*[\)\]])$/g, '').trim();
    return !strippedEqNum;
  }

  const trimmed = text.trim();
  if (trimmed.length < 3 || trimmed.length > 260) return false;
  if (/^\s*(?:\$\$[\s\S]+\$\$|\\\[[\s\S]+\\\])\s*$/.test(trimmed)) return true;
  if (/^\s*(?:[-+•◦▪‣●○]|\d+[.)]|[a-zA-Z][.)]|\[\d+\])\s+/u.test(trimmed)) return false;
  const core = trimmed.replace(/\s*[\(\[]\d+(?:[.\-]\d+)+[\)\]]\s*$/, '').trim();
  if (/(?<!\.)\.$|[;?!:]$/.test(core)) return false;
  if (/https?:\/\/|www\./i.test(core)) return false;
  if (/\b(?:const|let|var|function|return|import|export|class|def|async|await|SELECT|FROM|WHERE|INSERT|UPDATE|console\.log|System\.out)\b/.test(core)) return false;
  const hasLatexMathCmd = /\\(?:frac|dfrac|tfrac|sqrt|sum|prod|int|hat|widehat|tilde|bar|vec|alpha|beta|gamma|delta|epsilon|eta|theta|lambda|mu|pi|sigma|omega|nabla|partial|infty|leq|geq|neq|approx|in|cdot|times)\b/.test(core);
  if (hasLatexMathCmd) return true;

  const wasCentered = sourceJc === 'center';
  const hasVertAlignScript = p.find(`${tag('vertAlign')}[w\\:val="subscript"],${tag('vertAlign')}[w\\:val="superscript"]`).length > 0;
  const hasSymbolFont = p.find(tag('rFonts')).toArray().some(e => /Cambria Math|Symbol|MT Extra|Euclid/i.test($(e).attr('w:ascii') || $(e).attr('w:hAnsi') || ''));
  const hasMathUnicode = /[∑∏∫∬∮√∛∇∂∞≈≠≡≤≥≪≫±∓×÷⋅∘⊗⊕⊙∈∉⊂⊃⊆⊇∪∩∀∃⇒⇔↦∼∝⊥∥∠°′″₀-₉⁰-⁹⁺⁻⁼⁽⁾ᵢⱼₖₙₘᵣᵤᵥᵀ̂̄̃⃗α-ωΑ-Ω]/u.test(core);
  const hasMathFunc = /\b(?:exp|ln|log|log2|log10|sin|cos|tan|cot|sec|csc|sinh|cosh|tanh|arcsin|arccos|arctan|lim|sup|inf|argmin|argmax|softmax|sigmoid|ReLU|GELU|Var|Cov|Std|MSE|RMSE|MAE|MAPE|SSE|SST|SSR|BCE|CE|OLS|KL|IoU|AUC)\b/.test(core);
  const hasRelationOp = /(?:=|≈|≠|≡|≤|≥|<=|>=|->|→|⇒|⇔|↦|∼|∝)/.test(core);
  const hasArithmeticOp = /(?:[+\-−*/^]|×|÷)/.test(core);

  if (!hasRelationOp && !(hasArithmeticOp && (hasMathUnicode || hasVertAlignScript || hasMathFunc))) return false;
  const hasMathFeature = hasMathUnicode || hasVertAlignScript || hasSymbolFont || hasMathFunc
    || /[()[\]|_^]/.test(core)
    || /\b[a-zA-Z]\s*=\s*[-+0-9a-zA-Z(]/.test(core);
  if (!hasMathFeature) return false;

  const words = core.split(/\s+/).filter(Boolean);
  const viProseWords = words.filter(w => {
    const clean = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
    return clean.length >= 2 && /[àáảãạăắằẳẵặâấầẩẫậđèéẻẽẹêếềểễệìíỉĩịòóỏõọôốồổỗộơớờởỡợùúủũụưứừửữựỳýỷỹỵ]/iu.test(clean);
  });
  if (wasCentered) return viProseWords.length <= 8;
  return viProseWords.length <= 4 && (viProseWords.length / Math.max(1, words.length)) <= 0.45;
}

export function analyzeDocxStructure(inputPath) {
  const archive = typeof inputPath === 'string' ? new AdmZip(inputPath) : inputPath;
  const $ = parse(archive.readAsText('word/document.xml'));
  const body = $(tag('body'));
  if (body.length !== 1) throw new Error('DOCX không có phần thân tài liệu hợp lệ.');
  const nextNumber = numberingReader(archive);
  const styleMap = buildSourceStyleAlignmentMap(archive);
  const records = [], fieldStack = [], warnings = [];
  let region = 'cover', summary = false, currentChapter = null, currentPart = null;
  let currentFrontKey = '', inSignatureBlock = false;
  let fieldId = 0;
  // Field ranges are tracked across paragraphs and content controls, including
  // TOC result paragraphs with no TOC style. No cached text establishes context.
  body.find(tag('p')).each((index, element) => {
    const p = $(element), rawWText = textOf(p).trim(), rawMText = mathTextOf(p).trim();
    const text = rawWText || rawMText;
    const key = keyOf(rawWText).replace(/[.:]+$/, '');
    const pp = child(p, 'pPr'), styleId = val(pp, 'pStyle') || '';
    const sourceLayout = resolveSourceLayout(p, styleMap);
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
      part: currentPart, inIndex: inIndex || /^TOC\d|^TableofFigures$/i.test(styleId), indexId, indexCode, insideTable,
      hasOmml: hasMathNode(p), sourceJc: sourceLayout.jc, sourceLeft: sourceLayout.left };
    records.push(rec);
    if (rec.inIndex) { rec.role = 'index'; return; }
    // Reading table list counters is necessary for preserving subsequent lists,
    // but table text never changes the report's region or heading hierarchy.
    rec.numbering = rawWText ? nextNumber(p) : {marker:'',level:0};
    if (insideTable) { rec.role = 'table'; return; }
    if (p.parents(tag('txbxContent')).length) { rec.role = 'embedded'; return; }
    const forced = (text || rec.hasOmml) ? forcedRoleOf($, p) : null;
    const isBullet = rec.numbering.format === 'bullet';
    const isUpper = /\p{L}/u.test(rawWText) && rawWText === rawWText.toLocaleUpperCase('vi-VN');
    const beforeContent = ['cover', 'front', 'proposal'].includes(region);
    // List items such as "Danh mục môn học." inside a chapter are prose, not a
    // new front-matter page. After the body starts, only an uppercase title
    // without list numbering or trailing punctuation can open front matter.
    const frontTitleLike = Boolean(rawWText) && !isBullet && !/[.;,]$/.test(rawWText) && rawWText.length < 110 && (beforeContent || isUpper);
    const frontKey = /^(?:NHAN XET|LOI CAM ON|LOI CAM DOAN|MUC LUC|DANH MUC)(?:\s|$)/.test(key)
      || (beforeContent && /^(?:TOM TAT(?: DE TAI| DO AN| KHOA LUAN| TIEU LUAN)?|ABSTRACT|LOI NOI DAU|LOI GIOI THIEU|DANH SACH (?:HINH|BANG|CAC)[\p{L} ]*)$/u.test(key));
    if (forced) {
      rec.forced = forced;
      const numberedText = rec.numbering.marker && !isBullet ? `${rec.numbering.marker} ${text}` : text;
      rec.displayText = numberedText; summary = false; inSignatureBlock = false;
      if (forced === 'chapter') {
        const chapterNumber = numberedText.match(/^CHƯƠNG\s+(\d+)/iu)?.[1] || String((currentChapter || 0) + 1);
        rec.role = 'chapter'; rec.level = 1; rec.number = chapterNumber;
        region = 'body'; currentChapter = Number(chapterNumber); currentFrontKey = '';
      } else if (/^heading[2-4]$/.test(forced)) {
        rec.role = 'heading'; rec.level = Number(forced.at(-1));
        rec.number = numberedText.match(/^(\d+(?:\.\d+)*)\.?\s/u)?.[1] || '';
        if (region === 'cover') region = 'front';
      } else if (forced === 'major_title') {
        rec.role = 'major_title'; currentChapter = null; currentFrontKey = '';
        if (region === 'cover') region = 'front';
      } else if (forced === 'front_title') {
        rec.role = 'front_title'; currentFrontKey = key;
        if (region === 'cover') region = 'front';
      } else if (forced === 'intro_title') {
        rec.role = 'intro_title'; region = 'introduction'; currentFrontKey = '';
      } else {
        rec.role = forced;
        if (region === 'cover') region = 'front';
      }
    }
    else if (/^DE CUONG(?:\s|$)/.test(key)) { region = 'proposal'; rec.role = 'proposal_title'; summary = false; currentFrontKey = ''; inSignatureBlock = false; }
    else if (frontKey && frontTitleLike) {
      region = 'front'; rec.role = 'front_title'; summary = false; currentFrontKey = key; inSignatureBlock = false;
    } else if (['MO DAU','PHAN MO DAU','LOI MO DAU'].includes(key)) {
      region = 'introduction'; rec.role = 'intro_title'; summary = false; currentFrontKey = ''; inSignatureBlock = false;
    } else if (/^PHAN(?:\s+[IVX\d]+[.:]?)?\s+NOI DUNG$/.test(key)) {
      region = 'body'; rec.role = 'part_title'; currentPart = rawWText; summary = false; currentFrontKey = ''; inSignatureBlock = false;
    } else if (['TAI LIEU THAM KHAO','REFERENCES','PHU LUC','APPENDIX','KET LUAN'].includes(key)) {
      region = key === 'PHU LUC' || key === 'APPENDIX' ? 'appendix' : key === 'KET LUAN' ? 'conclusion' : 'references';
      rec.role = 'major_title'; currentChapter = null; summary = false; currentFrontKey = ''; inSignatureBlock = false;
    } else if (region !== 'proposal') {
      const numberedText = rec.numbering.marker && rec.numbering.format !== 'bullet'
        ? `${rec.numbering.marker} ${rawWText}` : rawWText;
      const chapterMatch = numberedText.match(/^CHƯƠNG\s+(\d+)\s*[.:–—-]?\s*(.*)$/iu);
      const explicitHeading = /^Heading\d|^WFHeading\d/.test(styleId);
      const describesChapter = /(?:trình bày|hệ thống hoá|hệ thống hóa|đối chiếu|phân tích|giới thiệu|tổng kết)/iu.test(rawWText.split(':').slice(1).join(':'));
      if (chapterMatch && !(region === 'introduction' && (summary || describesChapter) && !explicitHeading)) {
        rec.role = 'chapter'; rec.level = 1; rec.number = chapterMatch[1]; rec.displayText = numberedText;
        region = 'body'; summary = false; currentChapter = Number(rec.number); currentFrontKey = ''; inSignatureBlock = false;
      } else if (region === 'body') {
        const match = numberedText.match(/^(\d+(?:\.\d+){1,3})\.?\s+\S/u);
        // Outline levels inherited from Normal are a common template mistake;
        // only direct levels or a dedicated (non-Normal) style count.
        const styleOutline = styleId && !/^(?:Normal|WFBody|WFEquation|WFSignature)$/i.test(styleId) ? rec.numbering.outline : undefined;
        const outline = Number(val(pp, 'outlineLvl') ?? styleOutline ?? styleId.match(/^Heading(\d)$/)?.[1] - 1);
        if (match) {
          rec.role = 'heading'; rec.level = match[1].split('.').length; rec.number = match[1]; rec.displayText = numberedText;
          inSignatureBlock = false;
          if (Number(match[1].split('.')[0]) !== currentChapter) {
            warnings.push(`Mục ${match[1]} chưa khớp chương đang xét; giữ số nguồn.`);
          }
        } else if (outline >= 1 && outline <= 3 && rawWText.length <= 200 && !isBullet) {
          // Word heading styles without a typed number ("Heading 2" + text).
          rec.role = 'heading'; rec.level = outline + 1; rec.number = ''; rec.displayText = numberedText;
          inSignatureBlock = false;
        }
      } else if (region === 'introduction') {
        if (/^\d+[.)]\s+/.test(numberedText) && (explicitHeading || child(pp, 'keepNext').length)) {
          rec.role = 'intro_heading'; rec.displayText = numberedText; inSignatureBlock = false;
        }
        if (/cấu trúc|bố cục|trình bày trong\s+\d+\s+chương/iu.test(rawWText)) summary = true;
        if (chapterMatch) rec.role = 'chapter_summary';
      }
      const captionStyle = /^(?:HNH|BNG|Caption|WFFigureCaption|WFTableCaption)$/i.test(styleId);
      // A sentence such as "Hình 3.1 trình bày..." is a reference in prose.
      // Manual captions need a title separator; established caption styles or
      // SEQ fields also supply evidence when that separator is absent.
      const captionEvidence = captionStyle || /\bSEQ\b/i.test(p.find(tag('instrText')).text())
        || /^(Hình|Bảng)\s*:\s*\S/iu.test(rawWText)
        || /^(Hình|Bảng)\s*:\s*$/iu.test(rawWText)
        || /^(Hình|Bảng)\s+\d+(?:[.\-]\d+)*[.:]\s+\S/iu.test(rawWText);
      if (rec.role === 'body' && captionEvidence && (/^(Hình|Bảng)\s*:/iu.test(rawWText) || /^(Hình|Bảng)\s+\d+(?:[.\-]\d+)*\s*[.:]?\s+\S/iu.test(rawWText))) {
        rec.role = /^Hình/iu.test(rawWText) ? 'figure_caption' : 'table_caption';
        inSignatureBlock = false;
      }

      // Preserve right-aligned / right-indented author signature blocks at the end
      // of Lời cảm ơn / Lời cam đoan / Mở đầu instead of flattening them into WFBody.
      const inSignableSection = (region === 'front' && /^(?:LOI CAM ON|LOI CAM DOAN|LOI NOI DAU|LOI GIOI THIEU)\b/.test(currentFrontKey))
        || region === 'introduction';
      if (rec.role === 'body' && inSignableSection && (!rec.numbering?.numId || rec.numbering.numId === '0')) {
        const isSigRole = SIGNATURE_ROLE_KEY_RE.test(key) || styleId === 'WFSignature';
        const isSigDate = rawWText.length > 0 && rawWText.length <= 95 && !/[.;]$/.test(rawWText) && SIGNATURE_DATE_KEY_RE.test(key);
        const isRightShort = region === 'front' && rawWText.length > 0 && rawWText.length <= 85 && !/[.;]$/.test(rawWText)
          && (sourceLayout.jc === 'right' || sourceLayout.jc === 'end' || sourceLayout.left >= 2880);
        if (isSigRole || isSigDate || isRightShort) {
          inSignatureBlock = true;
        }
        if (inSignatureBlock) {
          if (!rawWText || (rawWText.length <= 95 && !/[.;]$/.test(rawWText))) {
            rec.role = 'signature';
          } else {
            inSignatureBlock = false;
          }
        }
      }

      // Detect standalone mathematical display formulas (both native OMML and
      // Unicode/sub-superscript formula lines) so they stay centered and clean.
      if (rec.role === 'body' && isStandaloneEquation($, p, rawWText, styleId, region, rec.numbering, sourceLayout.jc)) {
        rec.role = 'equation';
        if (!rec.displayText && rawMText && !rawWText) rec.displayText = rawMText;
      }
    }
    rec.region = region; rec.chapter = currentChapter; rec.part = currentPart;
    if (forced) return;
    if (region === 'proposal' && rec.role !== 'proposal_title') rec.role = 'proposal';
    if (region === 'appendix' && rec.role !== 'major_title') rec.role = 'appendix';
    if (region === 'cover') rec.role = 'cover';
  });
  const chapters = records.filter(r => r.role === 'chapter');
  const hasProposal = records.some(r => r.role === 'proposal_title');
  const hasAppendix = records.some(r => r.region === 'appendix');
  const hasIntroduction = records.some(r => r.role === 'intro_title');
  const hasParts = records.some(r => r.role === 'part_title');
  const automaticHeadings = records.filter(r => ['chapter','heading'].includes(r.role) && r.numbering?.marker).length;
  for (const rec of records.filter(r => r.role === 'proposal_title')) {
    const previous = $(rec.element).prev();
    // A proposal's institutional/signature masthead is part of the proposal,
    // even when it is a table immediately before the title.
    if (previous[0]?.name === 'w:tbl' && (/TRUONG|BO GIAO DUC|KHOA|VIEN|CONG HOA|QUOC HIEU/iu.test(keyOf(textOf(previous))))) rec.startElement = previous[0];
  }
  const documentType = records.find(r => r.role === 'cover' && /^(ĐỒ ÁN|KHÓA LUẬN|TIỂU LUẬN)/iu.test(r.text))?.text;
  return { archive, $, body, records, chapters, warnings, hasProposal, hasAppendix, hasIntroduction, hasParts, automaticHeadings,
    documentType, requiresStructuredFormatting: hasProposal || hasAppendix || hasIntroduction || hasParts || automaticHeadings > 0 || records.some(r=>r.inIndex),
    summary: { chapterCount: chapters.length, chapters: chapters.map(r => r.displayText), hasProposal, hasAppendix, hasIntroduction,
      hasParts, automaticHeadings, protectedIndexParagraphs: records.filter(r => r.inIndex).length,
      chapterSummariesPreserved: records.filter(r => r.role === 'chapter_summary').length, warnings } };
}

const PREVIEW_ROLE = { chapter: 'chapter', major_title: 'major_title', front_title: 'front_title', intro_title: 'intro_title',
  part_title: 'part_title', intro_heading: 'intro_heading', figure_caption: 'figure_caption', table_caption: 'table_caption',
  equation: 'equation', signature: 'signature',
  body: 'body', chapter_summary: 'body', proposal: 'proposal', proposal_title: 'proposal_title', appendix: 'appendix', cover: 'cover' };

function allTextRunsBold($, p) {
  const runs = p.find(tag('r')).toArray().filter(run => textOf($(run)).trim());
  return runs.length > 0 && runs.every(run => isBoldPropertyOn($, $(run).children(tag('rPr')).first()[0]));
}

function suspectHeading($, rec) {
  if (!['body', 'chapter_summary'].includes(rec.role) || rec.region === 'cover' || !rec.text) return null;
  const text = rec.text;
  if (text.length > 150 || /[.;,]$/.test(text) || rec.numbering?.format === 'bullet') return null;
  const key = keyOf(text).replace(/[.:]+$/, '');
  if (SIGNATURE_ROLE_KEY_RE.test(key)) return null;
  const numbered = text.match(/^(\d+(?:\.\d+){0,3})\.?\s+\S/u);
  if (/^CHƯƠNG\s+\d+/iu.test(text)) return { reason: 'Bắt đầu bằng "Chương"', suggest: 'chapter' };
  if (/^(?:TOM TAT|ABSTRACT|LOI NOI DAU|LOI MO DAU|MO DAU|KET LUAN|TAI LIEU THAM KHAO|PHU LUC|DANH MUC)(?:\s|$)/.test(key)) {
    return { reason: 'Từ khóa tiêu đề lớn', suggest: /^(?:TOM TAT|ABSTRACT|LOI NOI DAU|DANH MUC)/.test(key) ? 'front_title' : 'major_title' };
  }
  if (numbered && numbered[1].includes('.') && text.length <= 120) {
    return { reason: 'Có số mục như tiêu đề', suggest: `heading${Math.min(4, numbered[1].split('.').length)}` };
  }
  const isUpper = /\p{L}{2}/u.test(text) && text === text.toLocaleUpperCase('vi-VN');
  if (isUpper && text.length >= 4 && text.length <= 100) return { reason: 'Chữ in hoa, ngắn', suggest: 'major_title' };
  if (text.length <= 90 && !/:/.test(text.slice(0, -1)) && allTextRunsBold($, $(rec.element))) {
    return { reason: 'In đậm toàn đoạn', suggest: rec.region === 'body' ? 'heading3' : 'front_title' };
  }
  return null;
}

/**
 * Compact, JSON-safe outline of a document for the preview editor. `i` is the
 * paragraph index accepted by applyRoleOverrides for the same input file.
 */
export function buildStructurePreview(analysis, { maxText = 280 } = {}) {
  const { $, records } = analysis;
  const items = [];
  const seenTables = new Set(), seenIndexes = new Set();
  for (const rec of records) {
    const p = $(rec.element);
    if (rec.inIndex) {
      const id = rec.indexId ?? 'index';
      if (!seenIndexes.has(id)) {
        seenIndexes.add(id);
        items.push({ i: rec.index, kind: 'index', t: 'Mục lục / danh mục tự động (sẽ được tạo lại)', role: 'index', region: rec.region });
      }
      continue;
    }
    if (rec.insideTable) {
      const table = p.parents(tag('tbl')).last();
      if (!table.length || seenTables.has(table[0])) continue;
      seenTables.add(table[0]);
      const cells = table.find(tag('tc')).toArray().slice(0, 4).map(c => textOf($(c)).trim()).filter(Boolean);
      items.push({ i: rec.index, kind: 'table', t: cells.join(' | ').slice(0, maxText), rows: table.children(tag('tr')).length, role: 'table', region: rec.region });
      continue;
    }
    if (rec.role === 'embedded') continue;
    if (!rec.text) {
      if (rec.hasOmml) {
        items.push({ i: rec.index, kind: 'p', t: '[Công thức toán học]', role: PREVIEW_ROLE[rec.role] || 'equation', region: rec.region });
      } else if (p.find(`${tag('drawing')},${tag('pict')},${tag('object')}`).length) {
        items.push({ i: rec.index, kind: 'image', t: '', role: 'image', region: rec.region });
      }
      continue;
    }
    const role = rec.role === 'heading' ? `heading${rec.level}` : PREVIEW_ROLE[rec.role] || 'body';
    const item = { i: rec.index, kind: 'p', t: (rec.displayText || rec.text).slice(0, maxText), role, region: rec.region };
    if (rec.forced) item.forced = true;
    const suspect = suspectHeading($, rec);
    if (suspect) { item.suspect = suspect.reason; item.suggest = suspect.suggest; }
    items.push(item);
  }
  return {
    items,
    paragraphCount: records.length,
    summary: {
      chapterCount: analysis.chapters.length,
      headingCount: records.filter(r => r.role === 'heading').length,
      equationCount: records.filter(r => r.role === 'equation').length,
      suspectCount: items.filter(item => item.suspect).length,
      forcedCount: items.filter(item => item.forced).length
    }
  };
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
    if (['WFBody', 'WFCaption'].includes(id)) {
      // Source templates sometimes give Normal an outline level; body text must
      // never inherit it into the navigation pane or outline-based TOCs.
      let pp = child(add(e), 'pPr'); if (!pp.length) { add(e).append('<w:pPr/>'); pp = child(add(e), 'pPr'); }
      child(pp, 'outlineLvl').remove(); pp.append('<w:outlineLvl w:val="9"/>');
    }
    $(tag('styles')).append(add.xml(e));
  });
  for (const [id, base, level] of [['WFIntroTitle','WFHeading1',0],['WFPartTitle','WFHeading1',0],['WFMajorTitle','WFHeading1',0],['WFIntroHeading','WFHeading2',1],['WFFrontTitle','WFHeading1',9],['WFFigureCaption','WFCaption',9],['WFTableCaption','WFCaption',9]]) {
    $(tag('style')).filter((_, e) => $(e).attr('w:styleId') === id).remove();
    $(tag('styles')).append(`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:basedOn w:val="${base}"/><w:pPr><w:keepNext w:val="${id==='WFFigureCaption'?0:1}"/><w:pageBreakBefore w:val="0"/><w:outlineLvl w:val="${level}"/></w:pPr></w:style>`);
  }
  $(tag('style')).filter((_, e) => $(e).attr('w:styleId') === 'WFEquation').remove();
  $(tag('styles')).append('<w:style w:type="paragraph" w:styleId="WFEquation"><w:name w:val="WFEquation"/><w:basedOn w:val="WFBody"/><w:pPr><w:keepLines/><w:pageBreakBefore w:val="0"/><w:spacing w:before="160" w:after="160" w:line="288" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="center"/><w:outlineLvl w:val="9"/></w:pPr></w:style>');
  $(tag('style')).filter((_, e) => $(e).attr('w:styleId') === 'WFSignature').remove();
  $(tag('styles')).append('<w:style w:type="paragraph" w:styleId="WFSignature"><w:name w:val="WFSignature"/><w:basedOn w:val="WFBody"/><w:pPr><w:keepLines/><w:pageBreakBefore w:val="0"/><w:spacing w:before="60" w:after="0" w:line="288" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="right"/><w:outlineLvl w:val="9"/></w:pPr></w:style>');
  for (const id of ['WFGraduationForm', 'WFCoverStart', 'WFGraduationCover']) {
    $(tag('style')).filter((_, e) => $(e).attr('w:styleId') === id).remove();
    $(tag('styles')).append(`<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${id}"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/><w:jc w:val="center"/><w:outlineLvl w:val="9"/></w:pPr><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="26"/><w:color w:val="000000"/></w:rPr></w:style>`);
  }
  if (!$(tag('style')).filter((_, e) => $(e).attr('w:styleId') === 'TableGrid').length) {
    $(tag('styles')).append('<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style>');
  }
  // Normal and all source styles remain intact, particularly those used by the
  // preserved proposal. Only formatter-owned styles are added/replaced.
  archive.updateFile('word/styles.xml', Buffer.from(normalizeWordprocessingPropertyOrder($.xml()).xml));
}

function isBoldPropertyOn($, propertiesNode) {
  if (!propertiesNode || !propertiesNode.name) return false;
  return $(propertiesNode).children(`${tag('b')},${tag('bCs')}`).toArray().some(node => {
    const value = $(node).attr('w:val');
    return value === undefined || !/^(?:0|false|off|none)$/iu.test(String(value));
  });
}

function paragraphHasDirectBold($, paragraph) {
  const p = $(paragraph);
  const paragraphProperties = p.children(tag('pPr')).children(tag('rPr')).first();
  if (isBoldPropertyOn($, paragraphProperties[0])) return true;
  return p.find(tag('r')).toArray()
    .filter(run => $(run).find(tag('t')).length > 0)
    .some(run => isBoldPropertyOn($, $(run).children(tag('rPr')).first()[0]));
}

function hasUniformDirectBodyBold($, records) {
  const candidates = records.filter(record => !record.insideTable && !record.inIndex
    && ['body', 'chapter_summary'].includes(record.role) && record.text?.trim());
  if (candidates.length < 12) return false;
  return candidates.every(record => paragraphHasDirectBold($, record.element));
}

function clearDirectBold($, paragraph) {
  const p = $(paragraph);
  let changed = false;
  const removeBold = propertiesNode => {
    if (!propertiesNode?.name) return;
    for (const name of ['b', 'bCs']) {
      const nodes = $(propertiesNode).children(tag(name));
      if (nodes.length) { nodes.remove(); changed = true; }
    }
  };
  removeBold(p.children(tag('pPr')).children(tag('rPr')).first()[0]);
  p.find(tag('r')).each((_, run) => removeBold($(run).children(tag('rPr')).first()[0]));
  return changed;
}

function applyParagraphFormat($, p, rec, profile, options = {}) {
  const heading = rec.role === 'chapter' || rec.role === 'heading';
  const id = heading ? `WFHeading${rec.level}` : ({ intro_title:'WFIntroTitle', part_title:'WFPartTitle',
    major_title:'WFMajorTitle', front_title:'WFFrontTitle', intro_heading:'WFIntroHeading',
    figure_caption:'WFFigureCaption', table_caption:'WFTableCaption',
    equation:'WFEquation', signature:'WFSignature' })[rec.role] || 'WFBody';
  const existingPPr = child(p, 'pPr');
  const existingSpacing = child(existingPPr, 'spacing');
  const srcBefore = Number(existingSpacing.attr('w:before') || 0);
  const srcAfter = Number(existingSpacing.attr('w:after') || 0);
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
    const size = (rec.role==='front_title' && keyOf(rec.text)==='LOI CAM ON' ? 16 : cfg.size_pt) || (level === 1 ? 18 : level === 2 ? 16 : level === 3 ? 14 : 13);
    // Reserve enough room for long labels; for manual labels measure their
    // approximate glyph width instead of inserting whitespace into user text.
    const label = number?.marker || rec.number || '';
    const labelWidth = level === 1 ? 0 : Math.max(360, Math.ceil(label.length * (cfg.size_pt || 14) * 10 + 90));
    const centeredWrap = level === 1 ? computeBalancedCenteredWrap(rec.displayText || rec.text, size, 9071) : { indentDxa: 0 };
    const indent = level === 1 ? `<w:ind w:left="${centeredWrap.indentDxa}" w:right="${centeredWrap.indentDxa}" w:firstLine="0"/>`
      : `<w:ind w:left="${numberPosition + labelWidth}" w:right="0" w:hanging="${labelWidth}"/>`;
    prop(p, 'ind', indent);
    prop(p, 'tabs', `<w:tabs><w:tab w:val="clear" w:pos="720"/><w:tab w:val="left" w:pos="${numberPosition + labelWidth}"/></w:tabs>`);
    prop(p, 'pageBreakBefore', '<w:pageBreakBefore w:val="0"/>');
    // Mutate each existing rPr through a local XML selection supplied by the
    // caller's Cheerio API (all text and bookmarks stay at the same positions).
    p.find(tag('r')).each((_, e) => {
      const r = $(e);
      if (r.parents('m\\:oMath').length) return;
      let rp = child(r, 'rPr'); if (!rp.length) { r.prepend('<w:rPr/>'); rp = child(r, 'rPr'); }
      for (const name of ['rStyle','rFonts','sz','szCs','b','bCs','i','iCs','color','caps','smallCaps']) child(rp,name).remove();
      rp.append(`<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:b w:val="${level < 4 ? 1 : 0}"/><w:i w:val="${level >= 3 ? 1 : 0}"/><w:color w:val="000000"/><w:sz w:val="${size*2}"/><w:szCs w:val="${size*2}"/>`);
    });
    return false;
  }
  if (rec.role === 'equation') {
    prop(p, 'keepLines', '<w:keepLines/>');
    prop(p, 'pageBreakBefore', '<w:pageBreakBefore w:val="0"/>');
    prop(p, 'ind', '<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
    prop(p, 'spacing', '<w:spacing w:before="160" w:after="160" w:line="288" w:lineRule="auto"/>');
    const upgraded = upgradeEquationParagraphToOmml($, p[0]);
    if (upgraded && upgraded.numbered) {
      prop(p, 'tabs', '<w:tabs><w:tab w:val="center" w:pos="4536"/><w:tab w:val="right" w:pos="9071"/></w:tabs>');
      prop(p, 'jc', '<w:jc w:val="left"/>');
      return false;
    }
    if (upgraded && upgraded.upgraded) {
      prop(p, 'jc', '<w:jc w:val="center"/>');
      return false;
    }
    const hasInlineTab = p.find(tag('tab')).length > 0;
    const trailingEqNumber = hasInlineTab && /[\(\[]\d+(?:[.\-]\d+)*[\)\]]\s*$/.test(rec.text || '');
    if (trailingEqNumber) {
      prop(p, 'tabs', '<w:tabs><w:tab w:val="center" w:pos="4536"/><w:tab w:val="right" w:pos="9071"/></w:tabs>');
      prop(p, 'jc', '<w:jc w:val="left"/>');
      const firstContent = p.children().toArray().find(n => n.name !== 'w:pPr' && n.name !== 'w:bookmarkStart' && n.name !== 'w:bookmarkEnd');
      const startsWithTab = firstContent && (firstContent.name === 'w:tab' || $(firstContent).children().first()[0]?.name === 'w:tab');
      if (!startsWithTab) {
        const anchor = child(p, 'pPr');
        if (anchor.length) anchor.after('<w:r><w:tab/></w:r>'); else p.prepend('<w:r><w:tab/></w:r>');
      }
    } else {
      prop(p, 'jc', '<w:jc w:val="center"/>');
    }
    p.find('m\\:oMathPara').each((_, mp) => {
      const omp = $(mp);
      let mpPr = omp.children('m\\:oMathParaPr');
      if (!mpPr.length) { omp.prepend('<m:oMathParaPr/>'); mpPr = omp.children('m\\:oMathParaPr'); }
      mpPr.children('m\\:jc').remove();
      mpPr.append('<m:jc m:val="center"/>');
    });
    p.find(tag('r')).each((_, e) => {
      const r = $(e);
      if (r.parents('m\\:oMath').length) return;
      if (!child(r, 't').length) return;
      child(r, 't').each((__, tNode) => {
        if (/\s{2,}|^\s|\s$/.test($(tNode).text())) $(tNode).attr('xml:space', 'preserve');
      });
      let rp = child(r, 'rPr'); if (!rp.length) { r.prepend('<w:rPr/>'); rp = child(r, 'rPr'); }
      const existingFont = child(rp, 'rFonts').attr('w:ascii') || child(rp, 'rFonts').attr('w:hAnsi') || '';
      if (!/Cambria Math|Symbol|MT Extra|Euclid/i.test(existingFont)) {
        child(rp, 'rFonts').remove();
        rp.prepend('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>');
      }
      for (const name of ['sz', 'szCs']) child(rp, name).remove();
      rp.append('<w:sz w:val="26"/><w:szCs w:val="26"/>');
    });
    return false;
  }
  if (rec.role === 'signature') {
    prop(p, 'pageBreakBefore', '<w:pageBreakBefore w:val="0"/>');
    if (rec.sourceLeft >= 2880 && rec.sourceJc === 'center') {
      prop(p, 'ind', `<w:ind w:left="${rec.sourceLeft}" w:right="0" w:firstLine="0"/>`);
      prop(p, 'jc', '<w:jc w:val="center"/>');
    } else {
      prop(p, 'ind', '<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
      prop(p, 'jc', '<w:jc w:val="right"/>');
    }
    const sigKey = keyOf(rec.text || '').replace(/[.:]+$/, '');
    const isSigRole = SIGNATURE_ROLE_KEY_RE.test(sigKey);
    const isSigDate = Boolean(rec.text) && SIGNATURE_DATE_KEY_RE.test(sigKey);
    const isSigHint = /^\(?KY\b[\s\S]*HO TEN\)?$/i.test(sigKey) || /^\(KY TEN\)$/i.test(sigKey);
    const nextP = p.next();
    const nextText = nextP[0]?.name === 'w:p' ? textOf(nextP).trim() : '';
    const nextHasBlankOrHint = nextP[0]?.name === 'w:p' && (!nextText || /KY\b[\s\S]*HO TEN|KY TEN/i.test(keyOf(nextText)));
    if (!rec.text) {
      prop(p, 'keepNext', '<w:keepNext/>');
      prop(p, 'spacing', '<w:spacing w:before="0" w:after="0" w:line="288" w:lineRule="auto"/>');
      return false;
    }
    if (isSigDate) {
      prop(p, 'keepNext', '<w:keepNext/>');
      prop(p, 'spacing', `<w:spacing w:before="${Math.max(240, srcBefore)}" w:after="60" w:line="288" w:lineRule="auto"/>`);
    } else if (isSigRole) {
      prop(p, 'keepNext', '<w:keepNext/>');
      const prevIsDate = p.prev()[0]?.name === 'w:p' && SIGNATURE_DATE_KEY_RE.test(keyOf(textOf(p.prev())));
      const afterDxa = nextHasBlankOrHint ? Math.max(60, srcAfter) : Math.max(480, srcAfter);
      prop(p, 'spacing', `<w:spacing w:before="${prevIsDate ? 60 : Math.max(240, srcBefore)}" w:after="${afterDxa}" w:line="288" w:lineRule="auto"/>`);
    } else if (isSigHint) {
      prop(p, 'keepNext', '<w:keepNext/>');
      const nextIsBlank = nextP[0]?.name === 'w:p' && !nextText;
      prop(p, 'spacing', `<w:spacing w:before="0" w:after="${nextIsBlank ? 60 : Math.max(480, srcAfter)}" w:line="240" w:lineRule="auto"/>`);
    } else {
      prop(p, 'keepLines', '<w:keepLines/>');
      prop(p, 'spacing', `<w:spacing w:before="${srcBefore > 120 ? srcBefore : 60}" w:after="0" w:line="288" w:lineRule="auto"/>`);
    }
    const szVal = isSigHint ? 24 : 26;
    p.find(tag('r')).each((_, e) => {
      const r = $(e);
      if (!child(r, 't').length) return;
      let rp = child(r, 'rPr'); if (!rp.length) { r.prepend('<w:rPr/>'); rp = child(r, 'rPr'); }
      for (const name of ['rFonts', 'sz', 'szCs', 'color']) child(rp, name).remove();
      rp.prepend('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>');
      if (isSigRole) {
        for (const name of ['b', 'bCs', 'i', 'iCs']) child(rp, name).remove();
        rp.append('<w:b/><w:bCs/>');
      } else if (isSigDate || isSigHint) {
        for (const name of ['b', 'bCs', 'i', 'iCs']) child(rp, name).remove();
        rp.append('<w:i/><w:iCs/>');
      }
      rp.append(`<w:color w:val="000000"/><w:sz w:val="${szVal}"/><w:szCs w:val="${szVal}"/>`);
    });
    return false;
  }
  if (!number?.numId || number.numId === '0') {
    if (rec.role === 'body' || rec.role === 'chapter_summary') prop(p, 'ind', '<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
  }
  if (!heading && !major && rec.role !== 'intro_heading') {
    p.find(tag('r')).each((_, e) => {
      const r = $(e);
      if (r.parents('m\\:oMath').length) return;
      if (!child(r,'t').length) return;
      let rp = child(r,'rPr'); if (!rp.length) { r.prepend('<w:rPr/>'); rp = child(r,'rPr'); }
      // Keep emphasis and symbol fonts, but remove source body font sizes.
      for (const name of ['sz','szCs']) child(rp,name).remove();
      rp.append('<w:sz w:val="26"/><w:szCs w:val="26"/>');
    });
  }
  if (options.regularizeBodyBold && ['body', 'chapter_summary'].includes(rec.role)) {
    return clearDirectBold($, p);
  }
  return false;
}

export function ensureMissingCaptionPlaceholders($, body, records, warnings = []) {
  let placeholdersAdded = 0;
  const processedVisuals = new Set();

  const isMeaningful = (el) => {
    if (!el || !el.name) return false;
    if (el.name === 'w:tbl') return true;
    if (el.name === 'w:p') {
      const p = $(el);
      if (p.find('w\\:drawing, w\\:pict').length > 0) return true;
      if (hasMathNode(p)) return true;
      if (p.find('w\\:sectPr').length > 0) return true;
      return textOf(p).trim().length > 0;
    }
    return false;
  };

  const getPrevMeaningful = (el) => {
    let cur = $(el).prev();
    while (cur.length) {
      if (isMeaningful(cur[0])) return cur;
      cur = cur.prev();
    }
    return null;
  };

  const getNextMeaningful = (el) => {
    let cur = $(el).next();
    while (cur.length) {
      if (isMeaningful(cur[0])) return cur;
      cur = cur.next();
    }
    return null;
  };

  const getCaptionInfo = (node) => {
    if (!node || node.name !== 'w:p') return null;
    const p = $(node);
    const text = textOf(p).trim();
    const match = text.match(/^(\s*)(Hình|Bảng)(?:\s+(\d+(?:[.\-]\d+)*)\s*[:.\-–—]\s*|\s*[:.\-–—]\s*|\s+(\d+(?:[.\-]\d+)*)\s*$|\s*$)/iu);
    if (!match) return null;
    const kind = /^Hình/iu.test(match[2]) ? 'Hình' : 'Bảng';
    const oldNumber = match[3] || match[4] || null;
    const rawTitle = text.slice(match[0].length).trim();
    const isEmptyMarker = !rawTitle;
    return { kind, oldNumber, rawTitle, isEmptyMarker, element: node, p };
  };

  let currentChapter = null;
  for (const child of body.children().toArray()) {
    if (child.name === 'w:p') {
      const p = $(child);
      const text = textOf(p).trim();
      const rec = records.find(r => r.element === child);
      if (rec?.role === 'chapter' || /^CHƯƠNG\s+\d+/iu.test(text)) {
        const numMatch = text.match(/^CHƯƠNG\s+(\d+)/iu);
        if (numMatch) currentChapter = Number(numMatch[1]);
        else if (rec?.chapter) currentChapter = rec.chapter;
      } else if (rec?.role === 'major_title' || ['appendix', 'references', 'conclusion', 'cover', 'proposal', 'front'].includes(rec?.region)) {
        currentChapter = null;
      } else if (rec?.chapter != null) {
        currentChapter = rec.chapter;
      }
    }

    if (!currentChapter || currentChapter <= 0) continue;

    if (child.name === 'w:tbl') {
      const table = child;
      if (processedVisuals.has(table)) continue;
      processedVisuals.add(table);

      const rec = records.find(r => r.insideTable && $(r.element).parents(tag('tbl')).toArray().includes(table));
      if (rec && ['cover', 'proposal', 'front', 'appendix', 'references', 'conclusion'].includes(rec.region)) continue;

      const prev = getPrevMeaningful(table);
      const next = getNextMeaningful(table);
      const prevCap = prev ? getCaptionInfo(prev[0]) : null;
      const nextCap = next ? getCaptionInfo(next[0]) : null;

      if ((prevCap && prevCap.kind === 'Bảng') || (nextCap && nextCap.kind === 'Bảng')) {
        const existingCap = (prevCap && prevCap.kind === 'Bảng') ? prevCap : nextCap;
        if (existingCap.isEmptyMarker) {
          existingCap.p.find(tag('t')).first().text('Bảng: [Nhập tên bảng]');
        }
        if (nextCap && nextCap.kind === 'Bảng' && (!prevCap || prevCap.kind !== 'Bảng')) {
          $(table).before(nextCap.p);
        }
        continue;
      }

      const placeholder = '[Nhập tên bảng]';
      const captionXml = `<w:p><w:pPr><w:pStyle w:val="WFTableCaption"/><w:jc w:val="center"/><w:keepNext w:val="1"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="26"/><w:b/><w:i/></w:rPr><w:t xml:space="preserve">Bảng: ${placeholder}</w:t></w:r></w:p>`;
      const captionEl = $(captionXml);
      $(table).before(captionEl);

      const tableRecIndex = records.findIndex(r => r.insideTable && $(r.element).parents(tag('tbl')).toArray().includes(table));
      const insertAt = tableRecIndex >= 0 ? tableRecIndex : records.length;
      records.splice(insertAt, 0, {
        element: captionEl[0],
        text: `Bảng: ${placeholder}`,
        styleId: 'WFTableCaption',
        region: 'body',
        role: 'table_caption',
        chapter: currentChapter,
        part: null,
        inIndex: false,
        insideTable: false
      });

      placeholdersAdded++;
      warnings.push(`Đã thêm caption giữ chỗ "Bảng: ${placeholder}"; hãy nhập tên phù hợp hoặc xóa dòng caption nếu không cần.`);
    }

    if (child.name === 'w:p') {
      const p = $(child);
      if (p.find('w\\:drawing, w\\:pict').length > 0) {
        if (processedVisuals.has(child)) continue;
        processedVisuals.add(child);

        const rec = records.find(r => r.element === child);
        if (rec && ['cover', 'proposal', 'front', 'appendix', 'references', 'conclusion'].includes(rec.region)) continue;

        const prev = getPrevMeaningful(child);
        const next = getNextMeaningful(child);
        const prevCap = prev ? getCaptionInfo(prev[0]) : null;
        const nextCap = next ? getCaptionInfo(next[0]) : null;

        if ((prevCap && prevCap.kind === 'Hình') || (nextCap && nextCap.kind === 'Hình')) {
          const existingCap = (nextCap && nextCap.kind === 'Hình') ? nextCap : prevCap;
          if (existingCap.isEmptyMarker) {
            existingCap.p.find(tag('t')).first().text('Hình: [Nhập tên hình]');
          }
          if (prevCap && prevCap.kind === 'Hình' && (!nextCap || nextCap.kind !== 'Hình')) {
            $(child).after(prevCap.p);
          }
          continue;
        }

        const placeholder = '[Nhập tên hình]';
        const captionXml = `<w:p><w:pPr><w:pStyle w:val="WFFigureCaption"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="26"/><w:b/><w:i/></w:rPr><w:t xml:space="preserve">Hình: ${placeholder}</w:t></w:r></w:p>`;
        const captionEl = $(captionXml);
        $(child).after(captionEl);

        const pRecIndex = records.findIndex(r => r.element === child);
        const insertAt = pRecIndex >= 0 ? pRecIndex + 1 : records.length;
        records.splice(insertAt, 0, {
          element: captionEl[0],
          text: `Hình: ${placeholder}`,
          styleId: 'WFFigureCaption',
          region: 'body',
          role: 'figure_caption',
          chapter: currentChapter,
          part: null,
          inIndex: false,
          insideTable: false
        });

        placeholdersAdded++;
        warnings.push(`Đã thêm caption giữ chỗ "Hình: ${placeholder}"; hãy nhập tên phù hợp hoặc xóa dòng caption nếu không cần.`);
      }
    }
  }

  return placeholdersAdded;
}

export function formatStructuredDocx(inputPath, outputPath, options, analysis = analyzeDocxStructure(inputPath)) {
  const leadingPageBordersDetected = leadingPageBorderSections(analysis.archive);
  // The incoming border pages may be the only reliable source for these values
  // when a previously exported graduation document is formatted again.
  const borderedCoverMetadata = metadataFromBorderedLeadingCoverPages(analysis, leadingPageBordersDetected);
  options = {
    ...options,
    instructor: options.instructor || borderedCoverMetadata.instructor,
    student: options.student || borderedCoverMetadata.student,
    studentId: options.studentId || borderedCoverMetadata.studentId,
    className: options.className || borderedCoverMetadata.className
  };
  const borderedLeadingCoverPagesReplaced = replaceBorderedLeadingCoverPages(analysis, leadingPageBordersDetected);
  if (borderedLeadingCoverPagesReplaced) {
    analysis = analyzeDocxStructure(analysis.archive);
    analysis.warnings.push(`Đã thay ${borderedLeadingCoverPagesReplaced} trang đầu có page border bằng bìa chuẩn của tool.`);
  }
  const graduation = options.documentType === 'do_an_tot_nghiep';
  const profile = options.profile || {};
  const shouldSkipProposal = Boolean(options.skipProposal);
  const preserveProposal = graduation || shouldSkipProposal;
  const originalProposalSection = preserveProposal ? captureProposalBlock(analysis, options)?.sectionXml : '';
  let graduationReport = {};
  if (graduation) {
    graduationReport = prepareGraduation(analysis, options);
    const warnings = analysis.warnings;
    analysis = analyzeDocxStructure(analysis.archive);
    analysis.warnings.push(...warnings);
  } else {
    const coversAdded = prepareCourseworkCover(analysis, options);
    if (coversAdded || analysis.records.some(r => r.region === 'cover' && r.text)) {
      const warnings = analysis.warnings;
      analysis = analyzeDocxStructure(analysis.archive);
      analysis.warnings.push(...warnings);
    }
  }
  let tabbedTableResult = { tablesConverted: 0, rowsConverted: 0 };
  const tableWidthForConversion = cm(21 - (profile.page?.margins_cm?.left ?? 3) - (profile.page?.margins_cm?.right ?? 2));
  const convertibleRegions = new Set(['introduction', 'body', 'conclusion']);
  tabbedTableResult = convertTabbedTableBlocks(analysis.$, analysis.body, {
    width: tableWidthForConversion,
    // Cover, front-matter, proposal, equation and signature layouts also use tabs by
    // design. Only prose paragraphs are eligible for table recovery.
    shouldConvert: paragraph => {
      const record = analysis.records.find(item => item.element === paragraph);
      if (record && (record.role === 'equation' || record.role === 'signature')) return false;
      return !record || convertibleRegions.has(record.region);
    }
  });
  if (tabbedTableResult.tablesConverted) {
    const warnings = analysis.warnings;
    // The converter works on the Cheerio tree owned by the current analysis.
    // Persist it before re-analysis; otherwise the next parse would reload
    // the untouched archive and silently discard the newly-created tables.
    analysis.archive.updateFile('word/document.xml', Buffer.from(analysis.$.xml()));
    analysis = analyzeDocxStructure(analysis.archive);
    analysis.warnings.push(...warnings);
    analysis.warnings.push(`Đã chuyển ${tabbedTableResult.tablesConverted} cụm văn bản ngăn bằng tab thành bảng Word thật.`);
  }
  const bodyDirectBoldMode = profile.body?.bold === false && hasUniformDirectBodyBold(analysis.$, analysis.records);
  const { archive, $, body, records } = analysis;
  if(preserveProposal) {
    const isolated = isolateProposalStyles(analysis);
    if(graduation) graduationReport.proposalStylesIsolated = isolated;
  }
  const proposalBlock = preserveProposal ? captureProposalBlock(analysis, options) : null;
  if(proposalBlock) markProposalBlock(analysis, proposalBlock);
  if(shouldSkipProposal && !analysis.hasProposal) {
    analysis.warnings.push('Tùy chọn "Bỏ qua định dạng đề cương" được bật nhưng tài liệu không có phần đề cương.');
  }
  $(tag('document')).attr('xmlns:r', R);
  $(tag('document')).attr('xmlns:m', M);
  const originalNumbering = archive.readAsText('word/numbering.xml');
  const originalProposal = records.filter(r=>r.region==='proposal' && !r.inIndex && r.text).map(r=>r.text);
  const originalAppendix = records.filter(r=>r.region==='appendix' && !r.inIndex && r.text).map(r=>r.text);
  const preserved = new Set(records.filter(r => r.region==='proposal' || (r.region==='appendix' && r.role!=='major_title') || ['cover','embedded'].includes(r.role)).map(r => r.element));
  // Keep complete proposal and appendix tables through every shared normalization pass.
  // Restoring serialized subtrees also protects merged cells, drawings and links.
  const proposalTables = preserveProposal ? body.children(tag('tbl')).toArray().filter(e =>
    records.some(r => r.region==='proposal' && $(r.element).parents(tag('tbl')).toArray().includes(e))
  ).map(e => ({element:e, xml:xmlOf($,e)})) : [];
  const appendixTables = body.children(tag('tbl')).toArray().filter(e =>
    records.some(r => r.region==='appendix' && $(r.element).parents(tag('tbl')).toArray().includes(e))
  ).map(e => ({element:e, xml:xmlOf($,e)}));
  const protectedTables = [...proposalTables, ...appendixTables];
  const generatedIndexes = new Set();
  const tocCode = 'TOC \\t "WFIntroTitle,1,WFIntroHeading,2,WFPartTitle,1,WFMajorTitle,1,WFHeading1,1,WFHeading2,2,WFHeading3,3,WFHeading4,4" \\h';
  let restoredIndexes = 0;
  let bodyDirectBoldNormalized = 0;
  for (const rec of records) {
    const p = $(rec.element);
    if (rec.inIndex) {
      const code = rec.indexCode || '';
      const figure = /(?:Hinh|Hình|HNH|Figure)/iu.test(code) || /^Hình\s/iu.test(rec.text);
      const table = /(?:Bang|Bảng|BNG|Table)/iu.test(code) || /^Bảng\s/iu.test(rec.text);
      const id = figure ? 'figures' : table ? 'tables' : rec.indexId ?? 'legacy-index';
      if (!generatedIndexes.has(id)) {
        // This is an existing index: retain its original field switches.
        // In particular, lists based on a Vietnamese caption style (\t "HÌNH,1"
        // or \t "BẢNG,1") are not equivalent to a SEQ-caption list (\c).
        const replacement = fieldParagraph(code || tocCode);
        p.before(replacement); generatedIndexes.add(id); restoredIndexes++;
      }
      p.remove(); continue;
    }
    if (preserved.has(rec.element) || rec.insideTable || (graduation && rec.styleId==='WFGraduationForm')) continue;
    if (applyParagraphFormat($, p, rec, profile, { regularizeBodyBold: bodyDirectBoldMode })) bodyDirectBoldNormalized++;
    if (!rec.text && /^Heading|^WFHeading/.test(rec.styleId)) prop(p,'numPr','<w:numPr><w:numId w:val="0"/></w:numPr>');
  }
  // Remove source spacer paragraphs immediately before an index, including
  // leading spacers inside a TOC content control. Keep fields and other objects.
  body.find(tag('instrText')).filter((_,e)=>/^\s*TOC\b/i.test($(e).text())).each((_,e)=>{
    let node=$(e).parents(tag('p')).first();
    while(node.length && node[0]!==body[0]) {
      let previous=node.prev();
      while(previous[0]?.name==='w:p' && !textOf(previous).trim() && !hasMathNode(previous)
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
    if(graduation || rec.styleId==='WFCoverStart' || rec.styleId==='WFGraduationCover')continue; // Dedicated cover layout owns logo, fields and spacing.
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
  const protectedTable = table => proposalLeads.has(table)||records.some(r=>r.insideTable && ['cover','proposal','appendix'].includes(r.region) && $(r.element).parents(tag('tbl')).toArray().includes(table));
  body.find(tag('tbl')).each((_,table)=> {
    if(protectedTable(table))return;
    // Front-matter signature/comment layouts are not data tables.
    const rec=records.find(r=>r.insideTable && $(r.element).parents(tag('tbl')).toArray().includes(table));
    if(rec?.region==='front' && !records.slice(0,rec.index).reverse().find(r=>r.role==='front_title')?.text.includes('VIẾT TẮT'))return;
    if (bodyDirectBoldMode && rec?.region !== 'front') {
      $(table).find(tag('p')).each((_, paragraph) => {
        if (clearDirectBold($, paragraph)) bodyDirectBoldNormalized++;
      });
    }
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
  const placeholdersAdded = options.onlyExistingCaptions
    ? 0
    : ensureMissingCaptionPlaceholders($, body, records, analysis.warnings);
  const captionStats = normalizeStructuredCaptions($, records, analysis.warnings);
  captionStats.placeholdersAdded = placeholdersAdded;
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
  while (body.children().first()[0]?.name === 'w:p' && !textOf(body.children().first()).trim() && !hasMathNode(body.children().first())
    && !body.children().first().find(`${tag('drawing')},${tag('pict')},${tag('object')}`).length) body.children().first().remove();
  // An initial page break before the first cover text is a blank page artifact.
  body.children().first().find(`${tag('br')}[w\\:type="page"]`).first().remove();
  const requested = new Set((options.frontMatter || '').split(',').map(s=>s.trim()));
  const hasCover = records.some(r=>r.role==='cover' && r.text);
  const coverLine = (text,size,before=0,bold=false) => `<w:p><w:pPr><w:spacing w:before="${before*20}" w:after="120"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b w:val="${bold?1:0}"/><w:sz w:val="${size*2}"/></w:rPr><w:t>${esc(text)}</w:t></w:r></w:p>`;
  if (requested.has('cover') && !hasCover && !records.some(r=>r.role==='cover')) {
    const { month: fallbackMonth, year: fallbackYear } = getCurrentMonthYear();
    const resolvedFallbackMonth = String(options.month || '').trim() || fallbackMonth;
    const resolvedFallbackYear = String(options.year || '').trim() || fallbackYear;
    body.prepend(coverLine(options.institution || profile.cover?.institution || '',15,0,true)
      + coverLine(options.faculty || profile.cover?.faculty || '',15,0,true)
      + coverLine('---oOo---',15) + coverLine(options.documentTitle || 'TIỂU LUẬN MÔN HỌC',24,70,true)
      + coverLine('Tên đề tài:',16,18) + coverLine(options.topic || 'TÊN ĐỀ TÀI',20,6,true)
      + coverLine(`Giảng viên hướng dẫn: ${options.instructor}`,14,60)
      + coverLine(`Sinh viên thực hiện: ${options.student}`,14)
      + (options.studentId?coverLine(`Mã số sinh viên: ${options.studentId}`,14):'')
      + (options.className?coverLine(`Lớp: ${options.className}`,14):'')
      + coverLine(`${options.location || profile.cover?.location || 'Thành phố Hồ Chí Minh'}, tháng ${resolvedFallbackMonth} năm ${resolvedFallbackYear}`,14,70,true));
  }
  const commentLine='<w:p><w:pPr><w:pStyle w:val="WFBody"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9071"/></w:tabs><w:spacing w:before="0" w:after="0" w:line="460" w:lineRule="exact"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="left"/></w:pPr><w:r><w:tab/></w:r></w:p>';
  for (const [option,label] of [['comments','NHẬN XÉT CỦA GIẢNG VIÊN'],['thanks','LỜI CẢM ƠN']]) {
    if(graduation && option==='comments')continue;
    if (!requested.has(option) || records.some(r=>r.role==='front_title' && (option==='thanks'?keyOf(r.text)==='LOI CAM ON':keyOf(r.text).startsWith('NHAN XET')))) continue;
    const target=starts.find(s=>s.role==='front_title'||s.role==='intro_title'||s.role==='chapter'||s.role==='part_title');
    if (!target) continue;
    const nodes=$(paragraph(label,'WFFrontTitle')+(option==='comments'?commentLine.repeat(24):paragraph('')));
    $(target.node).before(nodes);
    starts.push({node:nodes[0],role:'front_title',title:label});
  }
  // Existing coursework review pages (e.g. "NHẬN XÉT CỦA GIẢNG VIÊN HƯỚNG DẪN"
  // / "NHẬN XÉT CỦA CÁN BỘ PHẢN BIỆN") often arrive without dotted writing lines.
  // Fill them with dotted lines before the signature block so they match BDU form layout.
  if (!graduation) {
    const allChildren = body.children().toArray();
    const startSet = new Set(starts.map(s => s.node));
    const isDivider = t => /^[-–—_.*~\s]*o[0o]o[-–—_.*~\s]*$/i.test(t);
    const isSignature = el => {
      const k = keyOf(textOf($(el)));
      if (el.name === 'w:tbl') return /(?:GIANG VIEN|CAN BO|GV)\s+(?:HUONG DAN|PHAN BIEN)|NGAY.*THANG.*NAM/.test(k);
      return /^(?:GIANG VIEN|CAN BO|GV)\s+(?:HUONG DAN|PHAN BIEN)$/.test(k) || /(?:THANH PHO|BINH DUONG|NGAY).*THANG.*NAM/.test(k);
    };
    for (const start of starts) {
      if (start.role !== 'front_title' || !keyOf(start.title).startsWith('NHAN XET')) continue;
      const from = allChildren.indexOf(start.node);
      if (from < 0) continue;
      let to = from + 1;
      while (to < allChildren.length && !startSet.has(allChildren[to])) to++;
      const sectionNodes = allChildren.slice(from + 1, to);
      const hasDottedLines = sectionNodes.some(el =>
        $(el).find(`${tag('tab')}[w\\:leader="dot"]`).length > 0 || /^[.\s…_]{5,}$/.test(textOf($(el)).trim())
      );
      if (hasDottedLines) continue;
      let signatureNode = null;
      let hasWrittenReview = false;
      for (const el of sectionNodes) {
        const t = textOf($(el)).trim();
        if (!signatureNode && isSignature(el)) { signatureNode = el; continue; }
        if (el.name === 'w:p' && isDivider(t)) { prop($(el), 'jc', '<w:jc w:val="center"/>'); continue; }
        if (t && !/^[.\s…_\-]+$/.test(t)) hasWrittenReview = true;
      }
      const lineCount = hasWrittenReview ? 4 : (signatureNode ? 20 : 24);
      const lines = $(commentLine.repeat(lineCount));
      if (signatureNode) {
        $(signatureNode).before(lines);
      } else if (sectionNodes.length) {
        $(sectionNodes.at(-1)).after(lines);
      } else {
        $(start.node).after(lines);
      }
    }
  }
  // Rebuild only index pages already present in the source. Static lists and
  // stale cached Word results both become one canonical tool-owned field;
  // indexes absent from the input are never introduced.
  const sourceStarts = [...starts];
  const sourceChildren = body.children().toArray();
  const replacements = new Map();
  sourceStarts.forEach((start, index) => {
    const definition = start.role === 'front_title' && indexPageDefinition(start.title);
    if (!definition) return;
    const startIndex = sourceChildren.indexOf(start.node);
    if (startIndex < 0) return;
    const currentKey = keyOf(start.title);
    const nextIndex = sourceStarts.slice(index + 1)
      .find(next => {
        const nextIndexDefinition = next.role === 'front_title' && indexPageDefinition(next.title);
        // Static TOC content can itself begin with “Mục lục …”, which the
        // structural classifier labels as a front title. It belongs to the
        // same block, not a new boundary.
        return nextIndexDefinition || next.role !== 'front_title' || !keyOf(next.title).startsWith(currentKey);
      });
    const nextChildIndex = nextIndex ? sourceChildren.indexOf(nextIndex.node) : -1;
    const entry = replacements.get(definition.kind) || { definition, blocks: [] };
    entry.blocks.push({ start, nodes: sourceChildren.slice(startIndex, nextChildIndex >= 0 ? nextChildIndex : sourceChildren.length) });
    replacements.set(definition.kind, entry);
  });
  const removedStartNodes = new Set();
  const generatedIndexStarts = [];
  for (const { definition, blocks } of replacements.values()) {
    const first = blocks[0];
    const replacement = $(paragraph(definition.label, 'WFFrontTitle') + fieldControl(definition.field));
    $(first.start.node).before(replacement);
    for (const block of blocks) {
      removedStartNodes.add(block.start.node);
      block.nodes.forEach(node => $(node).remove());
    }
    generatedIndexStarts.push({ node: replacement[0], role: 'front_title', title: definition.label });
  }
  if (removedStartNodes.size) {
    for (let index = starts.length - 1; index >= 0; index -= 1) {
      if (removedStartNodes.has(starts[index].node)) starts.splice(index, 1);
    }
    starts.push(...generatedIndexStarts);
  }
  // Auto-generate List of Figures (DANH MỤC HÌNH ẢNH) and List of Tables (DANH MỤC BẢNG)
  // if not already present in the source but corresponding content exists.
  const hasFiguresIndex = replacements.has('figures') || starts.some(s => /^(?:DANH MUC|MUC LUC) (?:CAC )?(?:HINH|HINH ANH|HINH VE)\b/.test(keyOf(s.title)));
  const hasTablesIndex = replacements.has('tables') || starts.some(s => /^(?:DANH MUC|MUC LUC) (?:CAC )?(?:BANG|BANG BIEU)\b/.test(keyOf(s.title)));
  const hasFigureContent = records.some(r => r.role === 'figure_caption');
  const hasTableContent = records.some(r => r.role === 'table_caption');

  const missingIndexes = [];
  if (!hasFiguresIndex && (hasFigureContent || requested.has('figures'))) {
    missingIndexes.push({ kind: 'figures', label: 'DANH MỤC HÌNH ẢNH', field: 'TOC \\c "Hinh" \\h' });
  }
  if (!hasTablesIndex && (hasTableContent || requested.has('tables'))) {
    missingIndexes.push({ kind: 'tables', label: 'DANH MỤC BẢNG', field: 'TOC \\c "Bang" \\h' });
  }

  if (missingIndexes.length > 0) {
    const tocStart = starts.find(s => keyOf(s.title) === 'MUC LUC');
    let anchorNode = null;
    if (tocStart) {
      const sortedStarts = [...starts].sort((a, b) => body.children().toArray().indexOf(a.node) - body.children().toArray().indexOf(b.node));
      const tocIdx = sortedStarts.indexOf(tocStart);
      if (tocIdx >= 0 && tocIdx + 1 < sortedStarts.length) {
        anchorNode = sortedStarts[tocIdx + 1].node;
      }
    }
    if (!anchorNode) {
      const firstBodyStart = starts.find(s => ['chapter', 'intro_title', 'part_title', 'major_title'].includes(s.role));
      if (firstBodyStart) {
        anchorNode = firstBodyStart.node;
      }
    }

    for (const def of missingIndexes) {
      const replacement = $(paragraph(def.label, 'WFFrontTitle') + fieldControl(def.field));
      if (anchorNode) {
        $(anchorNode).before(replacement);
      } else {
        body.append(replacement);
      }
      const newStart = { node: replacement[0], role: 'front_title', title: def.label };
      starts.push(newStart);
      generatedIndexStarts.push(newStart);
    }
  }

  const indexPagesRebuilt = generatedIndexStarts.length;
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
    while (prev.length && prev[0].name === 'w:p' && !textOf(prev).trim() && !hasMathNode(prev) && !prev.find(`${tag('drawing')},${tag('pict')},${tag('object')},${tag('tab')}`).length) {
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
  const headerFooter = profile.header_footer || {};
  const headerFooterFont = String(headerFooter.font || 'Times New Roman').trim() || 'Times New Roman';
  const configuredHeaderFooterSize = Number(headerFooter.size_pt);
  const headerFooterSizePt = Number.isFinite(configuredHeaderFooterSize) && configuredHeaderFooterSize > 0
    ? configuredHeaderFooterSize
    : 13;
  const hfRunPropsFor = (sizePt = headerFooterSizePt) => {
    const szVal = Math.round(sizePt * 2);
    return `<w:rFonts w:ascii="${esc(headerFooterFont)}" w:hAnsi="${esc(headerFooterFont)}" w:eastAsia="${esc(headerFooterFont)}" w:cs="${esc(headerFooterFont)}"/><w:sz w:val="${szVal}"/><w:szCs w:val="${szVal}"/>`;
  };
  const hfRunProperties = hfRunPropsFor(headerFooterSizePt);
  const emptyHfParagraph = `<w:p><w:pPr><w:rPr>${hfRunProperties}</w:rPr></w:pPr></w:p>`;
  const hfRun = (text, sizePt = headerFooterSizePt) => `<w:r><w:rPr>${hfRunPropsFor(sizePt)}</w:rPr><w:t>${esc(text)}</w:t></w:r>`;
  const hfFieldRun = content => `<w:r><w:rPr>${hfRunProperties}</w:rPr>${content}</w:r>`;
  const hfParagraph = (left, right, page = false) => {
    const cell = (width, align, content, sizePt = headerFooterSizePt, leftIndentDxa = 0, vAlign = 'bottom') => {
      const indXml = leftIndentDxa > 0 ? `<w:ind w:left="${leftIndentDxa}" w:right="0" w:firstLine="0"/>` : '';
      return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="${vAlign}"/></w:tcPr><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>${indXml}<w:jc w:val="${align}"/><w:rPr>${hfRunPropsFor(sizePt)}</w:rPr></w:pPr>${content}</w:p></w:tc>`;
    };
    if (page) {
      const widths = [4150, 771, 4150];
      const leftFit = fitSingleLineCellText(left, widths[0], headerFooterSizePt, 11, 8);
      const rightFit = fitSingleLineCellText(right, widths[2], headerFooterSizePt, 11, 8);
      const pageField = hfFieldRun('<w:fldChar w:fldCharType="begin"/>') + hfFieldRun('<w:instrText xml:space="preserve"> PAGE </w:instrText>') + hfFieldRun('<w:fldChar w:fldCharType="separate"/>') + hfRun('1') + hfFieldRun('<w:fldChar w:fldCharType="end"/>');
      const cellMar = '<w:tblCellMar><w:top w:w="60" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>';
      return `<w:tbl><w:tblPr><w:tblW w:w="9071" w:type="dxa"/><w:tblBorders><w:top w:val="single" w:sz="4" w:color="808080"/></w:tblBorders><w:tblLayout w:type="fixed"/>${cellMar}</w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr>${cell(widths[0], 'left', hfRun(left, leftFit.sizePt), leftFit.sizePt, 0, 'top')}${cell(widths[1], 'center', pageField, headerFooterSizePt, 0, 'top')}${cell(widths[2], 'right', hfRun(right, rightFit.sizePt), rightFit.sizePt, rightFit.leftIndentDxa, 'top')}</w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="20" w:lineRule="exact"/></w:pPr></w:p>`;
    }
    const layout = computeHeaderLayout(left, right, headerFooterSizePt, 9071);
    const { widths } = layout;
    const cellMar = `<w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="${layout.bottomPaddingDxa}" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>`;
    return `<w:tbl><w:tblPr><w:tblW w:w="9071" w:type="dxa"/><w:tblBorders><w:bottom w:val="single" w:sz="4" w:color="808080"/></w:tblBorders><w:tblLayout w:type="fixed"/>${cellMar}</w:tblPr><w:tblGrid>${widths.map(w => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr>${cell(widths[0], 'left', hfRun(left, layout.leftSizePt), layout.leftSizePt, 0, 'bottom')}${cell(widths[1], 'right', hfRun(right, layout.rightSizePt), layout.rightSizePt, layout.rightLeftIndentDxa, 'bottom')}</w:tr></w:tbl><w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="${layout.afterBorderSpacerDxa}" w:lineRule="exact"/></w:pPr></w:p>`;
  };
  let bodyStarted = false;
  const firstNumberedSection = starts.findIndex(s => s.role !== 'cover');
  const thanksSectionIndex = starts.findIndex(s => s.role === 'front_title' && keyOf(s.title) === 'LOI CAM ON');
  let coverSectionCount = 0;
  for (let i=0; i<starts.length; i++) {
    const s = starts[i]; if(s.isFirstChapter) bodyStarted = true;
    const isPreThanksFrontMatter = s.role === 'cover'
      || s.role === 'proposal_title'
      || (s.role === 'front_title' && /^(?:NHAN XET|LOI CAM DOAN)\b/.test(keyOf(s.title)));
    const showHeaderFooter = s.role !== 'cover' && (thanksSectionIndex >= 0 ? i >= thanksSectionIndex : !isPreThanksFrontMatter);
    const h = addPart(`wfStructureHeader${i}.xml`,'header', `<w:hdr xmlns:w="${W}">${showHeaderFooter ? hfParagraph(title, s.title) : emptyHfParagraph}</w:hdr>`);
    const f = addPart(`wfStructureFooter${i}.xml`,'footer', `<w:ftr xmlns:w="${W}">${showHeaderFooter ? hfParagraph(`GVHD: ${options.instructor}`, `SVTH: ${options.student}`, true) : emptyHfParagraph}</w:ftr>`);
    const margins = (s.role==='cover' && profile.cover?.margins_cm) || profile.page?.margins_cm || {top:2,bottom:2,left:3,right:2};
    let geometry = `<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="${cm(margins.top)}" w:right="${cm(margins.right)}" w:bottom="${cm(margins.bottom)}" w:left="${cm(margins.left)}" w:header="567" w:footer="567" w:gutter="0"/>`;
    if(s.role==='proposal_title' && proposalGeometry) {
      const pg = parse(proposalGeometry); geometry = pg(tag('pgSz')).toArray().concat(pg(tag('pgMar')).toArray()).map(e=>pg.xml(e)).join('') || geometry;
    }
    let coverBorder = '';
    const isCoverSection = s.role === 'cover' && textOf($(s.node)).trim();
    if (isCoverSection) {
      const border = profile.cover?.page_border;
      if (graduation || border?.style === 'twistedLines1') {
        coverBorder = '<w:pgBorders w:display="allPages" w:offsetFrom="page">'
          + ['top','left','bottom','right'].map(side => `<w:${side} w:val="twistedLines1" w:sz="18" w:space="31" w:color="auto"/>`).join('')
          + '</w:pgBorders>';
        coverSectionCount++;
      } else {
        const spaceFor = side => border?.space_pt ?? (['top','bottom'].includes(side) ? border?.top_bottom_space_pt : border?.left_right_space_pt) ?? 18;
        coverBorder = border ? '<w:pgBorders w:offsetFrom="page" w:zOrder="front" w:display="allPages">'+['top','left','bottom','right'].map(side=>`<w:${side} w:val="${esc(border.style || 'single')}" w:sz="${border.size_eighth_points || 8}" w:space="${spaceFor(side)}" w:color="${esc(border.color_hex || '000000')}"/>`).join('')+'</w:pgBorders>' : '<w:pgBorders w:offsetFrom="page">'+['top','left','bottom','right'].map(side=>`<w:${side} w:val="single" w:sz="8" w:space="18" w:color="000000"/>`).join('')+'</w:pgBorders>';
      }
    }
    let section = `<w:sectPr><w:headerReference w:type="default" r:id="${h}"/><w:headerReference w:type="even" r:id="${h}"/><w:headerReference w:type="first" r:id="${h}"/><w:footerReference w:type="default" r:id="${f}"/><w:footerReference w:type="even" r:id="${f}"/><w:footerReference w:type="first" r:id="${f}"/><w:type w:val="nextPage"/>${geometry}${coverBorder}<w:pgNumType w:fmt="${bodyStarted?'decimal':'lowerRoman'}"${s.isFirstChapter || i===firstNumberedSection ? ' w:start="1"':''}/>${isCoverSection ? '<w:titlePg/>' : ''}</w:sectPr>`;
    if(preserveProposal && s.role==='proposal_title' && originalProposalSection) {
      if (shouldSkipProposal) {
        section = normalizeWordprocessingPropertyOrder(originalProposalSection).xml;
      } else {
        const propSec = parse(originalProposalSection);
        const sp = propSec(tag('sectPr')).first();
        child(sp, 'headerReference').remove();
        child(sp, 'footerReference').remove();
        sp.prepend(`<w:headerReference w:type="default" r:id="${h}"/><w:headerReference w:type="even" r:id="${h}"/><w:headerReference w:type="first" r:id="${h}"/><w:footerReference w:type="default" r:id="${f}"/><w:footerReference w:type="even" r:id="${f}"/><w:footerReference w:type="first" r:id="${f}"/>`);
        child(sp, 'pgNumType').remove();
        sp.append(`<w:pgNumType w:fmt="lowerRoman"${i === firstNumberedSection ? ' w:start="1"' : ''}/>`);
        section = normalizeWordprocessingPropertyOrder(propSec.xml()).xml;
      }
    }
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
  const bodyTextResult = normalizeBodyText(documentXml, { profile });
  documentXml = bodyTextResult.xml;
  protectedTables.forEach((entry,i)=>{documentXml=documentXml.replace(`<!--WF_PROTECTED_TABLE_${i}-->`,entry.xml);});
  documentXml=restoreProposalBlock(documentXml,proposalBlock);
  const relationshipResult = removeUnusedHyperlinkRelationships(rels.xml(), hyperlinks.removedRelationshipIds, documentXml);
  archive.updateFile('word/document.xml', Buffer.from(documentXml));
  archive.updateFile('word/_rels/document.xml.rels', Buffer.from(relationshipResult.xml));
  archive.updateFile('[Content_Types].xml', Buffer.from(types.xml()));
  const settings = parse(archive.readAsText('word/settings.xml') || `<w:settings xmlns:w="${W}" xmlns:m="${M}"/>`);
  settings(tag('settings')).attr('xmlns:m', M);
  settings(tag('updateFields')).remove(); settings(tag('settings')).append('<w:updateFields w:val="true"/>');
  if (records.some(r => r.role === 'equation' || r.hasOmml) && !settings('m\\:mathPr').length) {
    settings(tag('settings')).append('<m:mathPr><m:mathFont m:val="Cambria Math"/><m:brkBin m:val="before"/><m:brkBinSub m:val="--"/><m:smallFrac m:val="0"/><m:dispDef/><m:lMargin m:val="0"/><m:rMargin m:val="0"/><m:defJc m:val="centerGroup"/><m:wrapIndent m:val="1440"/><m:intLim m:val="subSup"/><m:naryLim m:val="undOvr"/></m:mathPr>');
  }
  archive.addFile('word/settings.xml', Buffer.from(settings.xml()));
  archive.writeZip(outputPath);
  const verified = analyzeDocxStructure(outputPath);
  const chapterStructure = JSON.stringify(verified.chapters.map(r=>r.number)) === JSON.stringify(analysis.chapters.map(r=>r.number));
  const proposalPreserved = !preserveProposal || JSON.stringify(verified.records.filter(r=>r.region==='proposal'&&!r.inIndex&&r.text).map(r=>r.text)) === JSON.stringify(originalProposal);
  const proposalTablesPreserved = !preserveProposal || proposalTables.every(entry=>documentXml.includes(entry.xml));
  const proposalBlockPreserved = !proposalBlock || documentXml.includes(proposalBlock.xml);
  const hasAppendix = analysis.hasAppendix || records.some(r => r.region === 'appendix');
  const appendixPreserved = !hasAppendix || JSON.stringify(verified.records.filter(r=>r.region==='appendix'&&!r.inIndex&&r.text).map(r=>r.text)) === JSON.stringify(originalAppendix);
  const appendixTablesPreserved = appendixTables.every(entry => documentXml.includes(entry.xml));
  if(!chapterStructure || !proposalPreserved || !proposalTablesPreserved || !proposalBlockPreserved || !appendixPreserved || !appendixTablesPreserved) throw new Error('Kiểm tra sau định dạng phát hiện thay đổi cấu trúc chương, nội dung đề cương hoặc nội dung phụ lục.');
  const $out=verified.$, sections=$out(tag('sectPr')).toArray();
  const expectedMargins=profile.page?.margins_cm || {top:2,bottom:2,left:3,right:2};
  const a4Portrait=sections.every(s=>Number(child($out(s),'pgSz').attr('w:w'))===11906 && Number(child($out(s),'pgSz').attr('w:h'))===16838);
  const margins=sections.every((s,i)=>Object.entries((starts[i]?.role==='cover' && profile.cover?.margins_cm) || expectedMargins).every(([k,v])=>Number(child($out(s),'pgMar').attr(`w:${k}`))===cm(v)));
  const headingIndentation=verified.records.filter(r=>r.role==='heading' && r.level>=3).every(r=>{
    const ind=$out(r.element).find(tag('ind')).first();
    return Number(ind.attr('w:left'))-Number(ind.attr('w:hanging')||0)===cm(profile.headings?.[`level${r.level}`]?.number_position_cm ?? (r.level===3?1.27:2.54));
  });
  const wordCompatibleAnchors=(documentXml.match(/<wp:anchor\b[^>]*>[\s\S]*?<\/wp:anchor>/g)||[]).every(anchor=>{
    const wrap=anchor.search(/<wp:wrap(?:None|Square|Tight|Through|TopAndBottom)\b/);
    const extent=anchor.search(/<wp:extent\b/);
    const effectExtent=anchor.search(/<wp:effectExtent\b/);
    return wrap<0 || (extent>=0 && wrap>extent && (effectExtent<0 || wrap>effectExtent));
  });
  const wordprocessingPropertyOrder=normalizeWordprocessingPropertyOrder(documentXml).xml===documentXml;
  const equationsFormatted = records.filter(r => r.role === 'equation').length;
  const signaturesFormatted = records.filter(r => r.role === 'signature' && r.text).length;
  return { success:true, outputPath, fileSize:fs.statSync(outputPath).size,
    report: { appliedProfile:{profileId:profile.profile_id,sourceRevision:profile.source_revision},
      structure:{...analysis.summary,hasAppendix,appendixPreserved,engine:'ooxml-structure-v1',proposalPolicy:shouldSkipProposal?'skipped':'preserve',documentTitle:title,documentType:options.documentType || 'tieu_luan',...graduationReport},
      outputNormalization:{ headersNormalized:starts.length, sectionsNormalized:starts.length, indexesRebuilt:restoredIndexes,
        indexPagesRebuilt, leadingPageBordersDetected, borderedLeadingCoverPagesReplaced, tableFontSizePt:13,
        headerFooterFont, headerFooterSizePt,
        equationsFormatted, signaturesFormatted,
        enDashesReplaced:dashReplacements, hyperlinksRemoved:hyperlinks.stats.hyperlinksRemoved, frontMatterReordered, bindingPagesInserted,
        compliance:{ a4Portrait,margins,bodySpacing:archive.readAsText('word/styles.xml').includes('w:before="120" w:after="0" w:line="288"'),
          listsPreserved:archive.readAsText('word/numbering.xml')===originalNumbering,
          smartQuotesPreserved:true,referenceHyperlinksRemoved:stripReferenceHyperlinks(documentXml).stats.hyperlinksRemoved===0,
          longDashesNormalized:!verified.records.some(r=>!['cover','proposal','appendix'].includes(r.region)&&/[–—]/.test(r.text)),
          wideTablesFitPortrait:wideTablesDetected===0,wordCompatibleAnchors,wordprocessingPropertyOrder,headingStructure:chapterStructure,headingIndentation,
          proposalPreserved,proposalTablesPreserved,proposalBlockPreserved,proposalSkipped:shouldSkipProposal,
          appendixPreserved,appendixTablesPreserved },
        tablesCentered, drawingParagraphsCentered, wideTablesDetected, tablesResized, acknowledgementFramesAdded,
        tabbedTablesConverted: tabbedTableResult.tablesConverted, tabbedTableRowsConverted: tabbedTableResult.rowsConverted,
        bodyTextCase: bodyTextResult.stats.bodyTextCase, bodyTextNodesNormalized: bodyTextResult.stats.bodyTextNodesNormalized,
        bodyDirectBoldMode, bodyDirectBoldNormalized, ...captionStats,
        warnings:analysis.warnings } } };
}
