/**
 * OOXML (.docx) -> Paginated A4 Document Preview Model
 *
 * Converts a formatted DOCX archive into a safe, XSS-free JSON tree of A4 pages
 * (with exact sections, margins, twistedLines1 cover borders, Wingdings ornaments,
 * headers/footers, Roman/Arabic page numbers, live-populated TOC/Figure/Table lists,
 * data tables, raster images, and OMML Math ASTs) while preserving source paragraph
 * indexes (_WFSrc_<index>) for Google Docs-style interactive reviewing & commenting.
 */

import { load } from 'cheerio';

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const SRC_BOOKMARK_PREFIX = '_WFSrc_';
const ROLE_BOOKMARK_PREFIX = '_WFRole_';

const DXA_PER_PT = 20;
const DXA_PER_CM = 1440 / 2.54;
const EMU_PER_CM = 360000;
const EMU_PER_PT = 12700;

const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024; // 1.5 MB per image inline cap
const MAX_TOTAL_MEDIA_BYTES = 8 * 1024 * 1024; // 8 MB total preview payload cap

const tag = (n) => `w\\:${n}`;
const mTag = (n) => `m\\:${n}`;
const parseXml = (xml) => load(xml || '', { xml: true, decodeEntities: true });
const parseXmlPreserve = (xml) => load(xml || '', { xml: true, decodeEntities: false });
const child = (node, n) => node.children(tag(n));
const val = (node, n, attr = 'w:val') => child(node, n).first().attr(attr);

function decodeXmlEntities(str) {
  return String(str || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function dxaToPt(dxa, fallbackPt = 0) {
  const num = Number(dxa);
  return Number.isFinite(num) ? num / DXA_PER_PT : fallbackPt;
}

function dxaToCm(dxa, fallbackCm = 0) {
  const num = Number(dxa);
  return Number.isFinite(num) ? +(num / DXA_PER_CM).toFixed(3) : fallbackCm;
}

function emuToCm(emu, fallbackCm = 0) {
  const num = Number(emu);
  return Number.isFinite(num) && num > 0 ? +(num / EMU_PER_CM).toFixed(3) : fallbackCm;
}

function emuToPt(emu, fallbackPt = 0) {
  const num = Number(emu);
  return Number.isFinite(num) && num > 0 ? num / EMU_PER_PT : fallbackPt;
}

function toRomanLower(num) {
  const n = Math.max(1, Math.floor(Number(num) || 1));
  const pairs = [
    [1000, 'm'], [900, 'cm'], [500, 'd'], [400, 'cd'],
    [100, 'c'], [90, 'xc'], [50, 'l'], [40, 'xl'],
    [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']
  ];
  let rem = n;
  let out = '';
  for (const [v, s] of pairs) {
    while (rem >= v) {
      out += s;
      rem -= v;
    }
  }
  return out;
}

function formatPageNumber(num, fmt = 'decimal') {
  if (fmt === 'lowerRoman') return toRomanLower(num);
  if (fmt === 'upperRoman') return toRomanLower(num).toUpperCase();
  return String(num);
}

function normalizeKey(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[đĐ]/g, 'D')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function isBoolOn($, propNode) {
  if (!propNode || !propNode.length) return undefined;
  const raw = propNode.attr('w:val');
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'none') return false;
  return true;
}

/**
 * Stamps `_WFSrc_<index>` bookmarks onto every non-empty paragraph in `word/document.xml`
 * of a disposable preview archive so source paragraph indices survive reordering and
 * section splitting during `formatStructuredDocx`.
 */
export function stampSourceParagraphBookmarks(archive) {
  const docEntry = archive.getEntry('word/document.xml');
  if (!docEntry) return 0;
  const $ = parseXmlPreserve(archive.readAsText('word/document.xml'));
  const body = $(tag('body'));
  if (!body.length) return 0;

  let nextId = Math.max(
    940000,
    ...$(tag('bookmarkStart')).toArray().map((e) => Number($(e).attr('w:id')) || 0)
  ) + 1;

  let stamped = 0;
  body.find(tag('p')).each((index, el) => {
    const p = $(el);
    const hasContent = Boolean(
      p.find(tag('t')).text().trim()
      || p.find(`${mTag('oMath')},${mTag('oMathPara')},${tag('drawing')},${tag('pict')},${tag('object')},${tag('tab')},${tag('sym')}`).length
    );
    if (!hasContent) return;

    const id = nextId++;
    const marker = `<w:bookmarkStart w:id="${id}" w:name="${SRC_BOOKMARK_PREFIX}${index}"/><w:bookmarkEnd w:id="${id}"/>`;
    const pPr = child(p, 'pPr');
    if (pPr.length) pPr.after(marker);
    else p.prepend(marker);
    stamped++;
  });

  if (stamped) {
    archive.updateFile('word/document.xml', Buffer.from($.xml()));
  }
  return stamped;
}

/**
 * Removes any `_WFSrc_<index>` bookmarks from an archive if needed.
 */
export function stripSourceParagraphBookmarks(archive) {
  if (!archive.getEntry('word/document.xml')) return 0;
  const $ = parseXmlPreserve(archive.readAsText('word/document.xml'));
  const ids = new Set();
  $(tag('bookmarkStart')).each((_, el) => {
    const node = $(el);
    const name = node.attr('w:name') || '';
    if (name.startsWith(SRC_BOOKMARK_PREFIX)) {
      ids.add(node.attr('w:id'));
      node.remove();
    }
  });
  if (!ids.size) return 0;
  $(tag('bookmarkEnd')).each((_, el) => {
    const node = $(el);
    if (ids.has(node.attr('w:id'))) node.remove();
  });
  archive.updateFile('word/document.xml', Buffer.from($.xml()));
  return ids.size;
}

function detectSafeRasterMime(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) return null;
  if (buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4E && buffer[3] === 0x47) {
    return 'image/png';
  }
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return 'image/jpeg';
  }
  if (buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x38) {
    return 'image/gif';
  }
  if (
    buffer[0] === 0x52 && buffer[1] === 0x49 && buffer[2] === 0x46 && buffer[3] === 0x46
    && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50
  ) {
    return 'image/webp';
  }
  return null;
}

function buildRelsMap(relsXml) {
  const map = new Map();
  if (!relsXml) return map;
  const $ = parseXml(relsXml);
  $('Relationship').each((_, el) => {
    const id = $(el).attr('Id');
    const target = $(el).attr('Target');
    const type = $(el).attr('Type') || '';
    if (id && target) {
      map.set(id, { target: target.replace(/^\/+/, ''), type });
    }
  });
  return map;
}

export function extractSafeMediaMap(archive, relsMap) {
  const mediaByRelId = new Map();
  const dataUrlByEntry = new Map();
  let totalBytes = 0;

  for (const [relId, rel] of relsMap.entries()) {
    if (!/\/image$/i.test(rel.type)) continue;
    const entryName = rel.target.startsWith('word/') ? rel.target : `word/${rel.target.replace(/^\.\//, '')}`;
    if (dataUrlByEntry.has(entryName)) {
      mediaByRelId.set(relId, dataUrlByEntry.get(entryName));
      continue;
    }
    const entry = archive.getEntry(entryName);
    if (!entry) continue;
    const buf = entry.getData();
    const mime = detectSafeRasterMime(buf);
    if (!mime) {
      const unsupported = { src: null, placeholder: true, reason: 'unsupported_format', entryName };
      dataUrlByEntry.set(entryName, unsupported);
      mediaByRelId.set(relId, unsupported);
      continue;
    }
    if (buf.length > MAX_IMAGE_BYTES || totalBytes + buf.length > MAX_TOTAL_MEDIA_BYTES) {
      const oversized = { src: null, placeholder: true, reason: 'size_cap', entryName };
      dataUrlByEntry.set(entryName, oversized);
      mediaByRelId.set(relId, oversized);
      continue;
    }
    totalBytes += buf.length;
    const item = {
      src: `data:${mime};base64,${buf.toString('base64')}`,
      mime,
      bytes: buf.length,
      placeholder: false
    };
    dataUrlByEntry.set(entryName, item);
    mediaByRelId.set(relId, item);
  }
  return mediaByRelId;
}

function buildStyleResolver(archive) {
  const raw = archive.getEntry('word/styles.xml') ? archive.readAsText('word/styles.xml') : '';
  const $ = parseXml(raw);
  const styles = new Map();

  let defaultSizePt = 13;
  const docRPr = $(tag('docDefaults')).find(tag('rPr')).first();
  if (docRPr.length) {
    const sz = Number(val(docRPr, 'sz'));
    if (Number.isFinite(sz) && sz > 0) defaultSizePt = sz / 2;
  }

  $(tag('style')).each((_, el) => {
    const s = $(el);
    const id = s.attr('w:styleId');
    if (!id) return;
    styles.set(id, {
      id,
      basedOn: val(s, 'basedOn') || null,
      pPr: child(s, 'pPr').first(),
      rPr: child(s, 'rPr').first()
    });
  });

  const cache = new Map();

  function resolve(styleId, seen = new Set()) {
    if (!styleId || !styles.has(styleId) || seen.has(styleId)) {
      return {
        fontSizePt: defaultSizePt,
        bold: false,
        italic: false,
        underline: false,
        uppercase: false,
        align: 'left',
        beforePt: 0,
        afterPt: 0,
        lineMultiple: 1.2,
        lineExactPt: null,
        leftCm: 0,
        rightCm: 0,
        hangingCm: 0,
        firstLineCm: 0,
        keepNext: false,
        pageBreakBefore: false,
        outlineLvl: 9
      };
    }
    if (cache.has(styleId)) return cache.get(styleId);
    seen.add(styleId);
    const def = styles.get(styleId);
    const base = { ...resolve(def.basedOn, seen) };
    applyPPrToLayout($, def.pPr, base);
    applyRPrToLayout($, def.rPr, base);
    cache.set(styleId, base);
    return base;
  }

  return { resolve, $ };
}

function applyPPrToLayout($, pPr, target) {
  if (!pPr || !pPr.length) return target;
  const jc = val(pPr, 'jc');
  if (jc) {
    target.align = jc === 'both' || jc === 'distribute' ? 'justify' : jc === 'end' ? 'right' : jc === 'start' ? 'left' : jc;
  }
  const spacing = child(pPr, 'spacing').first();
  if (spacing.length) {
    if (spacing.attr('w:before') !== undefined) target.beforePt = dxaToPt(spacing.attr('w:before'), target.beforePt);
    if (spacing.attr('w:after') !== undefined) target.afterPt = dxaToPt(spacing.attr('w:after'), target.afterPt);
    if (spacing.attr('w:line') !== undefined) {
      const lineVal = Number(spacing.attr('w:line'));
      const rule = spacing.attr('w:lineRule') || 'auto';
      if (Number.isFinite(lineVal) && lineVal > 0) {
        if (rule === 'exact' || rule === 'atLeast') {
          target.lineExactPt = lineVal / 20;
        } else {
          target.lineMultiple = +(lineVal / 240).toFixed(3);
          target.lineExactPt = null;
        }
      }
    }
  }
  const ind = child(pPr, 'ind').first();
  if (ind.length) {
    if (ind.attr('w:left') !== undefined) target.leftCm = dxaToCm(ind.attr('w:left'), 0);
    if (ind.attr('w:right') !== undefined) target.rightCm = dxaToCm(ind.attr('w:right'), 0);
    if (ind.attr('w:hanging') !== undefined) {
      target.hangingCm = dxaToCm(ind.attr('w:hanging'), 0);
      target.firstLineCm = 0;
    } else if (ind.attr('w:firstLine') !== undefined) {
      target.firstLineCm = dxaToCm(ind.attr('w:firstLine'), 0);
      target.hangingCm = 0;
    }
  }
  const kn = isBoolOn($, child(pPr, 'keepNext').first());
  if (kn !== undefined) target.keepNext = kn;
  const pbb = isBoolOn($, child(pPr, 'pageBreakBefore').first());
  if (pbb !== undefined) target.pageBreakBefore = pbb;
  const ol = val(pPr, 'outlineLvl');
  if (ol !== undefined) target.outlineLvl = Number(ol);
  return target;
}

function applyRPrToLayout($, rPr, target) {
  if (!rPr || !rPr.length) return target;
  const sz = Number(val(rPr, 'sz'));
  if (Number.isFinite(sz) && sz > 0) target.fontSizePt = sz / 2;
  const b = isBoolOn($, child(rPr, 'b').first());
  if (b !== undefined) target.bold = b;
  const i = isBoolOn($, child(rPr, 'i').first());
  if (i !== undefined) target.italic = i;
  const caps = isBoolOn($, child(rPr, 'caps').first());
  if (caps !== undefined) target.uppercase = caps;
  const uNode = child(rPr, 'u').first();
  if (uNode.length) {
    const uVal = uNode.attr('w:val');
    target.underline = Boolean(uVal && uVal !== 'none');
  }
  return target;
}

function createNumberingTracker(archive) {
  const raw = archive.getEntry('word/numbering.xml') ? archive.readAsText('word/numbering.xml') : '';
  const $ = parseXml(raw);
  const nums = new Map();
  const abstracts = new Map();
  const counters = new Map();

  $(tag('abstractNum')).each((_, el) => {
    const a = $(el);
    const id = a.attr('w:abstractNumId');
    const levels = new Map();
    a.children(tag('lvl')).each((__, lvlEl) => {
      const l = $(lvlEl);
      const ilvl = Number(l.attr('w:ilvl') || 0);
      levels.set(ilvl, {
        start: Number(val(l, 'start') || 1),
        numFmt: val(l, 'numFmt') || 'decimal',
        lvlText: val(l, 'lvlText') ?? '%1.'
      });
    });
    abstracts.set(id, levels);
  });

  $(tag('num')).each((_, el) => {
    const n = $(el);
    const numId = n.attr('w:numId');
    const absId = val(n, 'abstractNumId');
    nums.set(numId, absId);
  });

  function formatCounter(value, fmt) {
    if (fmt === 'lowerRoman') return toRomanLower(value);
    if (fmt === 'upperRoman') return toRomanLower(value).toUpperCase();
    if (fmt === 'lowerLetter') return String.fromCharCode(96 + (((value - 1) % 26) + 1));
    if (fmt === 'upperLetter') return String.fromCharCode(64 + (((value - 1) % 26) + 1));
    return String(value);
  }

  return function nextMarker($doc, p) {
    const numPr = child(child(p, 'pPr').first(), 'numPr').first();
    if (!numPr.length) return '';
    const numId = val(numPr, 'numId');
    if (!numId || numId === '0' || !nums.has(numId)) return '';
    const ilvl = Number(val(numPr, 'ilvl') || 0);
    const abs = abstracts.get(nums.get(numId));
    const lvl = abs?.get(ilvl);
    if (!lvl) return '';
    if (lvl.numFmt === 'bullet') {
      const cleanBullet = (lvl.lvlText || '').trim();
      if (cleanBullet === '-' || cleanBullet === '+') return cleanBullet;
      return ilvl === 0 ? '-' : '+';
    }
    for (const key of counters.keys()) {
      const [id, depth] = key.split(':');
      if (id === numId && Number(depth) > ilvl) counters.delete(key);
    }
    const key = `${numId}:${ilvl}`;
    const next = (counters.get(key) ?? (lvl.start - 1)) + 1;
    counters.set(key, next);
    return (lvl.lvlText || `%${ilvl + 1}.`).replace(/%(\d+)/g, (_, g) => {
      const d = Number(g) - 1;
      const dLvl = abs.get(d);
      const count = counters.get(`${numId}:${d}`) ?? dLvl?.start ?? 1;
      return formatCounter(count, dLvl?.numFmt || 'decimal');
    });
  };
}

/**
 * Converts an OOXML `<m:oMath>` or `<m:oMathPara>` Cheerio node into a safe JSON Math AST.
 */
export function ommlToMathAst($, mathNode) {
  function childrenAst(container) {
    if (!container || !container.length) return [];
    const items = [];
    container.contents().each((_, el) => {
      if (el.type !== 'tag') return;
      const parsed = convertNode(el);
      if (parsed) {
        if (Array.isArray(parsed)) items.push(...parsed);
        else items.push(parsed);
      }
    });
    return items;
  }

  function wrapRow(items) {
    if (!items || !items.length) return { type: 'tok', kind: 'mtext', text: '' };
    if (items.length === 1) return items[0];
    return { type: 'row', items };
  }

  function tokenizeRunText(raw, isNormal) {
    if (isNormal) return [{ type: 'tok', kind: 'mtext', text: raw, normal: true }];
    const tokens = [];
    const re = /(\d+(?:[.,]\d+)?)|([A-Za-z\u0370-\u03FF\u1F00-\u1FFF]+)|(\s+)|(.)/gu;
    let match;
    while ((match = re.exec(raw)) !== null) {
      if (match[3]) continue;
      if (match[1]) tokens.push({ type: 'tok', kind: 'mn', text: match[1] });
      else if (match[2]) tokens.push({ type: 'tok', kind: 'mi', text: match[2], upright: match[2].length > 1 });
      else if (match[4]) tokens.push({ type: 'tok', kind: 'mo', text: match[4] });
    }
    return tokens;
  }

  function convertNode(el) {
    const name = (el.name || '').replace(/^m:/, '');
    const n = $(el);
    switch (name) {
      case 'oMathPara':
      case 'oMath':
      case 'e':
        return childrenAst(n);
      case 'oMathParaPr':
      case 'rPr':
      case 'ctrlPr':
      case 'fPr':
      case 'radPr':
      case 'naryPr':
      case 'sSubPr':
      case 'sSupPr':
      case 'sSubSupPr':
      case 'accPr':
      case 'dPr':
      case 'mPr':
      case 'limLowPr':
      case 'limUppPr':
      case 'funcPr':
        return null;
      case 'r': {
        const raw = n.find(mTag('t')).text();
        if (!raw) return null;
        const isNormal = n.find(mTag('nor')).length > 0;
        const sty = n.find(mTag('sty')).attr('m:val');
        const tokens = tokenizeRunText(raw, isNormal);
        if (sty === 'p') tokens.forEach((t) => { t.upright = true; });
        return tokens;
      }
      case 'f':
        return {
          type: 'frac',
          num: wrapRow(childrenAst(n.children(mTag('num')).first())),
          den: wrapRow(childrenAst(n.children(mTag('den')).first()))
        };
      case 'rad': {
        const degHide = n.find(mTag('degHide')).attr('m:val');
        const degItems = childrenAst(n.children(mTag('deg')).first());
        return {
          type: 'rad',
          deg: (degHide === '1' || degHide === 'on' || !degItems.length) ? null : wrapRow(degItems),
          body: wrapRow(childrenAst(n.children(mTag('e')).first()))
        };
      }
      case 'nary': {
        const chr = n.find(mTag('chr')).attr('m:val') || '∑';
        const subHide = n.find(mTag('subHide')).attr('m:val');
        const supHide = n.find(mTag('supHide')).attr('m:val');
        const subItems = childrenAst(n.children(mTag('sub')).first());
        const supItems = childrenAst(n.children(mTag('sup')).first());
        return {
          type: 'nary',
          chr,
          sub: (subHide === '1' || !subItems.length) ? null : wrapRow(subItems),
          sup: (supHide === '1' || !supItems.length) ? null : wrapRow(supItems),
          body: wrapRow(childrenAst(n.children(mTag('e')).first()))
        };
      }
      case 'sSub':
        return {
          type: 'sub',
          base: wrapRow(childrenAst(n.children(mTag('e')).first())),
          sub: wrapRow(childrenAst(n.children(mTag('sub')).first()))
        };
      case 'sSup':
        return {
          type: 'sup',
          base: wrapRow(childrenAst(n.children(mTag('e')).first())),
          sup: wrapRow(childrenAst(n.children(mTag('sup')).first()))
        };
      case 'sSubSup':
        return {
          type: 'subsup',
          base: wrapRow(childrenAst(n.children(mTag('e')).first())),
          sub: wrapRow(childrenAst(n.children(mTag('sub')).first())),
          sup: wrapRow(childrenAst(n.children(mTag('sup')).first()))
        };
      case 'acc': {
        const chr = n.find(mTag('chr')).attr('m:val') || '\u0302';
        const accentGlyphMap = {
          '\u0302': '^', '\u0303': '~', '\u0304': '¯', '\u0305': '¯',
          '\u0307': '˙', '\u0308': '¨', '\u20D7': '→'
        };
        return {
          type: 'acc',
          chr: accentGlyphMap[chr] || chr,
          body: wrapRow(childrenAst(n.children(mTag('e')).first()))
        };
      }
      case 'limLow':
        return {
          type: 'limLow',
          base: wrapRow(childrenAst(n.children(mTag('e')).first())),
          lim: wrapRow(childrenAst(n.children(mTag('lim')).first()))
        };
      case 'limUpp':
        return {
          type: 'limUpp',
          base: wrapRow(childrenAst(n.children(mTag('e')).first())),
          lim: wrapRow(childrenAst(n.children(mTag('lim')).first()))
        };
      case 'func':
        return {
          type: 'row',
          items: [
            wrapRow(childrenAst(n.children(mTag('fName')).first())),
            wrapRow(childrenAst(n.children(mTag('e')).first()))
          ]
        };
      case 'd': {
        const dPr = n.children(mTag('dPr')).first();
        const open = dPr.find(mTag('begChr')).attr('m:val') ?? '(';
        const close = dPr.find(mTag('endChr')).attr('m:val') ?? ')';
        const sep = dPr.find(mTag('sepChr')).attr('m:val') ?? ',';
        const args = n.children(mTag('e')).toArray().map((argEl) => wrapRow(childrenAst($(argEl))));
        return { type: 'delim', open, close, sep, args };
      }
      case 'm': {
        const rows = n.children(mTag('mr')).toArray().map((mrEl) =>
          $(mrEl).children(mTag('e')).toArray().map((cellEl) => wrapRow(childrenAst($(cellEl))))
        );
        return { type: 'matrix', rows };
      }
      default:
        return childrenAst(n);
    }
  }

  return wrapRow(childrenAst($(mathNode)));
}

function readCommentsMap(archive) {
  const map = new Map();
  if (!archive.getEntry('word/comments.xml')) return map;
  const $ = parseXml(archive.readAsText('word/comments.xml'));
  $(tag('comment')).each((_, el) => {
    const c = $(el);
    const id = c.attr('w:id');
    const author = c.attr('w:author') || 'BDU WordFmt';
    const date = c.attr('w:date') || '';
    const text = c.find(tag('p')).toArray().map((pEl) => $(pEl).find(tag('t')).text()).join('\n').trim();
    if (id !== undefined && text) {
      map.set(String(id), { id: String(id), author, date, text });
    }
  });
  return map;
}

function parseHeaderFooterPart(archive, relsMap, relId, kind) {
  if (!relId || !relsMap.has(relId)) return null;
  const target = relsMap.get(relId).target;
  const entryName = target.startsWith('word/') ? target : `word/${target.replace(/^\.\//, '')}`;
  if (!archive.getEntry(entryName)) return null;
  const $ = parseXml(archive.readAsText(entryName));
  const tbl = $(tag('tbl')).first();
  if (!tbl.length) {
    const txt = $(tag('t')).text().trim();
    if (!txt) return null;
    return { kind, columns: [{ text: txt, align: 'center', sizePt: 13 }], hasBorder: false };
  }
  const cells = tbl.find(tag('tc')).toArray();
  const columns = cells.map((tcEl) => {
    const tc = $(tcEl);
    const p = tc.find(tag('p')).first();
    const jc = val(child(p, 'pPr').first(), 'jc') || 'left';
    const sz = Number(val(tc.find(tag('rPr')).first(), 'sz'));
    const hasPageField = /\bPAGE\b/i.test(tc.find(tag('instrText')).text()) || /\bPAGE\b/i.test(tc.find(tag('fldSimple')).attr('w:instr') || '');
    const text = hasPageField ? '{PAGE}' : tc.find(tag('t')).text().replace(/\s+/g, ' ').trim();
    return {
      text,
      hasPageField,
      align: jc === 'end' ? 'right' : jc === 'start' ? 'left' : jc,
      sizePt: Number.isFinite(sz) && sz > 0 ? sz / 2 : 13
    };
  });
  const hasVisibleContent = columns.some((c) => c.text || c.hasPageField);
  if (!hasVisibleContent) return null;
  const borders = tbl.find(tag('tblBorders')).first();
  const hasBorder = Boolean(
    borders.find(`${tag('top')}[w\\:val!="nil"][w\\:val!="none"],${tag('bottom')}[w\\:val!="nil"][w\\:val!="none"]`).length
  );
  return { kind, columns, hasBorder };
}

function extractDrawingBlock($, drawingNode, mediaMap) {
  const d = $(drawingNode);
  const blip = d.find('a\\:blip').first();
  const embedId = blip.attr('r:embed') || blip.attr('embed') || '';
  // Decorative Word shapes (e.g. folded-corner Acknowledgement frame <wps:wsp>)
  // have no raster `a:blip` relationship and should not render as broken image boxes.
  if (!embedId) return null;
  const extent = d.find('wp\\:extent').first();
  const widthCm = emuToCm(extent.attr('cx'), 3.5);
  const heightCm = emuToCm(extent.attr('cy'), 3.5);
  const descr = d.find('wp\\:docPr').first().attr('descr') || '';
  const media = mediaMap.get(embedId);
  return {
    kind: 'image',
    widthCm,
    heightCm,
    heightPt: emuToPt(extent.attr('cy'), 99),
    alt: descr,
    src: media?.src || null,
    placeholder: !media?.src,
    isCoverLogo: /logo/i.test(descr) || (Math.abs(widthCm - 3.5) < 0.3 && Math.abs(heightCm - 3.5) < 0.3)
  };
}

function parseParagraphNode($, pEl, ctx) {
  const p = $(pEl);
  const pPr = child(p, 'pPr').first();
  const styleId = val(pPr, 'pStyle') || 'Normal';
  const layout = { ...ctx.styleResolver.resolve(styleId) };
  applyPPrToLayout($, pPr, layout);
  applyRPrToLayout($, child(pPr, 'rPr').first(), layout);

  // Extract bookmarks (source index + forced role) & comment anchors
  let sourceIndex = null;
  let forcedRole = null;
  const commentIds = [];

  p.find(tag('bookmarkStart')).each((_, bEl) => {
    const bName = $(bEl).attr('w:name') || '';
    if (bName.startsWith(SRC_BOOKMARK_PREFIX)) {
      const rawKey = bName.slice(SRC_BOOKMARK_PREFIX.length);
      if (/^\d+$/.test(rawKey)) {
        sourceIndex = Number(rawKey);
      } else if (/^ins_[a-zA-Z0-9_-]{1,32}$/.test(rawKey)) {
        sourceIndex = rawKey;
      }
    } else if (bName.startsWith(ROLE_BOOKMARK_PREFIX)) {
      forcedRole = bName.slice(ROLE_BOOKMARK_PREFIX.length);
    }
  });

  p.find(`${tag('commentRangeStart')},${tag('commentReference')}`).each((_, cEl) => {
    const cid = $(cEl).attr('w:id');
    if (cid !== undefined && !commentIds.includes(String(cid))) commentIds.push(String(cid));
  });

  // Check for TOC / Figure / Table index field
  const fldSimpleInstr = p.find(tag('fldSimple')).attr('w:instr') || '';
  const instrText = p.find(tag('instrText')).text() || '';
  const combinedInstr = decodeXmlEntities(`${fldSimpleInstr} ${instrText}`).trim();
  if (/^\s*TOC\b/i.test(combinedInstr)) {
    const isFig = /\\c\s*["']?(?:Hinh|Hình|Figure)["']?/iu.test(combinedInstr)
      || /\\t\s*["'][^"']*(?:WFFigureCaption|HÌNH|HINH|HNH|FIGURE)/iu.test(combinedInstr);
    const isTab = /\\c\s*["']?(?:Bang|Bảng|Table)["']?/iu.test(combinedInstr)
      || /\\t\s*["'][^"']*(?:WFTableCaption|BẢNG|BANG|BNG|TABLE)/iu.test(combinedInstr);
    return {
      kind: 'toc',
      tocType: isFig ? 'figures' : isTab ? 'tables' : 'main',
      entries: [],
      heightPt: 140
    };
  }

  // Check for Wingdings cover ornament (<w:sym w:font="Wingdings" w:char="F097|F026|F096"/>)
  const syms = p.find(tag('sym')).toArray();
  if (syms.length && syms.some((s) => /Wingdings/i.test($(s).attr('w:font') || ''))) {
    return {
      kind: 'ornament',
      beforePt: layout.beforePt || 6,
      afterPt: layout.afterPt || 8,
      heightPt: (layout.beforePt || 6) + 18 + (layout.afterPt || 8)
    };
  }

  // Check for standalone dotted tab-leader line (Nhận xét giảng viên)
  const tabsDef = child(pPr, 'tabs').find(tag('tab')).toArray();
  const dotTab = tabsDef.find((t) => $(t).attr('w:leader') === 'dot');
  const rawTextAll = p.find(tag('t')).text();
  if (dotTab && !rawTextAll.trim() && p.find(tag('tab')).length > 0) {
    const exactPt = layout.lineExactPt || 23;
    return {
      kind: 'dotted_line',
      heightPt: exactPt
    };
  }

  // Check for hard page break inside runs
  const hasHardPageBreak = p.find(`${tag('br')}[w\\:type="page"]`).length > 0;

  // Check for standalone OMML equation
  const mathPara = p.children(mTag('oMathPara')).first();
  const mathInline = p.children(mTag('oMath')).first();
  if ((mathPara.length || mathInline.length) && !rawTextAll.trim()) {
    const ast = ommlToMathAst($, mathPara.length ? mathPara : mathInline);
    const rawMathText = p.find(mTag('t')).text().trim();
    return attachMeta({
      kind: 'equation',
      mathAst: ast,
      text: rawMathText || '[Công thức toán học]',
      beforePt: layout.beforePt || 8,
      afterPt: layout.afterPt || 8,
      heightPt: (layout.beforePt || 8) + 32 + (layout.afterPt || 8),
      pageBreakBefore: layout.pageBreakBefore || hasHardPageBreak
    }, sourceIndex, forcedRole, commentIds, styleId, ctx);
  }

  // Check for standalone drawing(s) when paragraph has no prose text
  const drawings = p.find(tag('drawing')).toArray();
  if (drawings.length && !rawTextAll.trim()) {
    const img = extractDrawingBlock($, drawings[0], ctx.mediaMap);
    if (!img) return null;
    return attachMeta({
      ...img,
      align: layout.align || 'center',
      beforePt: layout.beforePt,
      afterPt: layout.afterPt,
      heightPt: layout.beforePt + img.heightPt + layout.afterPt + 8,
      pageBreakBefore: layout.pageBreakBefore || hasHardPageBreak
    }, sourceIndex, forcedRole, commentIds, styleId, ctx);
  }

  // Parse inline runs, tabs, inline math & inline images
  const marker = rawTextAll.trim() ? ctx.nextMarker($, p) : '';
  const runs = [];
  let sawTabSplit = false;
  const beforeTabRuns = [];
  const afterTabRuns = [];

  function pushRunItem(item) {
    runs.push(item);
    if (item.type === 'tab') {
      sawTabSplit = true;
    } else if (!sawTabSplit) {
      beforeTabRuns.push(item);
    } else {
      afterTabRuns.push(item);
    }
  }

  function walkRunNodes(container, inheritedRPr = null) {
    container.contents().each((_, childNode) => {
      if (childNode.type !== 'tag') return;
      const nName = childNode.name;
      if (nName === 'w:pPr' || nName === 'w:bookmarkStart' || nName === 'w:bookmarkEnd'
          || nName === 'w:commentRangeStart' || nName === 'w:commentRangeEnd') return;
      if (nName === 'm:oMath' || nName === 'm:oMathPara') {
        pushRunItem({ type: 'math', mathAst: ommlToMathAst($, $(childNode)) });
        return;
      }
      if (nName === 'w:hyperlink' || nName === 'w:smartTag' || nName === 'w:sdt' || nName === 'w:sdtContent') {
        walkRunNodes($(childNode), inheritedRPr);
        return;
      }
      if (nName === 'w:r') {
        const r = $(childNode);
        const rPr = child(r, 'rPr').first();
        const runStyle = {
          bold: layout.bold,
          italic: layout.italic,
          underline: layout.underline,
          fontSizePt: layout.fontSizePt,
          vertAlign: null
        };
        if (rPr.length) {
          const b = isBoolOn($, child(rPr, 'b').first());
          if (b !== undefined) runStyle.bold = b;
          const i = isBoolOn($, child(rPr, 'i').first());
          if (i !== undefined) runStyle.italic = i;
          const uNode = child(rPr, 'u').first();
          if (uNode.length) runStyle.underline = Boolean(uNode.attr('w:val') && uNode.attr('w:val') !== 'none');
          const sz = Number(val(rPr, 'sz'));
          if (Number.isFinite(sz) && sz > 0) runStyle.fontSizePt = sz / 2;
          const va = val(rPr, 'vertAlign');
          if (va === 'subscript' || va === 'superscript') runStyle.vertAlign = va;
        }
        r.contents().each((__, leaf) => {
          if (leaf.type !== 'tag' || leaf.name === 'w:rPr') return;
          if (leaf.name === 'w:t') {
            let txt = $(leaf).text();
            if (layout.uppercase) txt = txt.toLocaleUpperCase('vi-VN');
            if (txt) pushRunItem({ type: 'text', text: txt, ...runStyle });
          } else if (leaf.name === 'w:tab') {
            pushRunItem({ type: 'tab' });
          } else if (leaf.name === 'w:br' && ($(leaf).attr('w:type') || 'textWrapping') !== 'page') {
            pushRunItem({ type: 'br' });
          } else if (leaf.name === 'w:drawing') {
            const parsedImg = extractDrawingBlock($, leaf, ctx.mediaMap);
            if (parsedImg) pushRunItem({ type: 'image', ...parsedImg });
          }
        });
      }
    });
  }

  walkRunNodes(p);

  const plainText = [
    marker ? `${marker} ` : '',
    runs.map((r) => (r.type === 'text' ? r.text : r.type === 'tab' ? '\t' : '')).join('')
  ].join('').replace(/\t+/g, ' ').replace(/\s+/g, ' ').trim();

  if (!plainText && !runs.some((r) => r.type === 'math' || r.type === 'image')) {
    if (hasHardPageBreak) return { kind: 'page_break', heightPt: 0 };
    // Empty spacer paragraph: preserve tiny vertical breath only if explicit exact/before spacing
    const spacerPt = (layout.lineExactPt && layout.lineExactPt <= 4) ? layout.lineExactPt : 0;
    return spacerPt > 0 ? { kind: 'spacer', heightPt: spacerPt } : null;
  }

  // Detect tab-aligned 2-column cover metadata line (e.g. Giảng viên hướng dẫn: \t ThS. A)
  const leftTabDef = tabsDef.find((t) => ($(t).attr('w:val') || 'left') === 'left' && Number($(t).attr('w:pos')) > 0);
  if (sawTabSplit && leftTabDef && beforeTabRuns.length && afterTabRuns.length) {
    const tabPosCm = dxaToCm($(leftTabDef).attr('w:pos'), 4.8);
    const startCm = Math.max(0, +(layout.leftCm - layout.hangingCm).toFixed(3));
    return attachMeta({
      kind: 'tab_pair',
      startCm,
      tabPosCm,
      fontSizePt: layout.fontSizePt,
      beforePt: layout.beforePt,
      afterPt: layout.afterPt,
      labelRuns: beforeTabRuns,
      valueRuns: afterTabRuns,
      text: plainText,
      heightPt: layout.beforePt + (layout.fontSizePt * 1.45) + layout.afterPt
    }, sourceIndex, forcedRole, commentIds, styleId, ctx);
  }

  // Estimate visual line count and height in points on A4 printable width
  const effectiveWidthCm = Math.max(6, ctx.printableWidthCm - layout.leftCm - layout.rightCm);
  const charsPerLine = Math.max(22, Math.floor((effectiveWidthCm * 28.35) / (layout.fontSizePt * 0.48)));
  const estimatedLines = Math.max(1, Math.ceil(Math.max(1, plainText.length) / charsPerLine));
  const singleLinePt = layout.lineExactPt || (layout.fontSizePt * (layout.lineMultiple || 1.2));
  const heightPt = layout.beforePt + (estimatedLines * singleLinePt) + layout.afterPt;

  const outlineLevel = resolveOutlineLevel(styleId, layout.outlineLvl);

  return attachMeta({
    kind: 'p',
    styleId,
    text: plainText,
    marker,
    runs,
    align: layout.align,
    fontSizePt: layout.fontSizePt,
    bold: layout.bold,
    italic: layout.italic,
    beforePt: layout.beforePt,
    afterPt: layout.afterPt,
    lineMultiple: layout.lineMultiple,
    lineExactPt: layout.lineExactPt,
    leftCm: layout.leftCm,
    rightCm: layout.rightCm,
    hangingCm: layout.hangingCm,
    firstLineCm: layout.firstLineCm,
    keepNext: layout.keepNext,
    pageBreakBefore: layout.pageBreakBefore || hasHardPageBreak,
    outlineLevel,
    heightPt
  }, sourceIndex, forcedRole, commentIds, styleId, ctx);
}

function resolveOutlineLevel(styleId, rawOutlineLvl) {
  const m = String(styleId || '').match(/^(?:WF)?Heading([1-4])$/i);
  if (m) return Number(m[1]);
  if (['WFMajorTitle', 'WFIntroTitle', 'WFPartTitle'].includes(styleId)) return 1;
  if (styleId === 'WFIntroHeading') return 2;
  if (Number.isInteger(rawOutlineLvl) && rawOutlineLvl >= 0 && rawOutlineLvl <= 3) return rawOutlineLvl + 1;
  return null;
}

function inferRoleFromStyle(styleId, fallbackRole = 'body') {
  const map = {
    WFHeading1: 'chapter',
    Heading1: 'chapter',
    WFHeading2: 'heading2',
    Heading2: 'heading2',
    WFHeading3: 'heading3',
    Heading3: 'heading3',
    WFHeading4: 'heading4',
    Heading4: 'heading4',
    WFMajorTitle: 'major_title',
    WFFrontTitle: 'front_title',
    WFIntroTitle: 'intro_title',
    WFIntroHeading: 'intro_heading',
    WFPartTitle: 'part_title',
    WFEquation: 'equation',
    WFSignature: 'signature',
    WFFigureCaption: 'figure_caption',
    WFTableCaption: 'table_caption',
    WFCoverStart: 'cover',
    WFGraduationCover: 'cover'
  };
  return map[styleId] || fallbackRole;
}

function attachMeta(block, sourceIndex, forcedRole, commentIds, styleId, ctx) {
  const keyStr = sourceIndex !== null && sourceIndex !== undefined ? String(sourceIndex) : null;
  const sourceItem = keyStr !== null ? ctx.sourceItemByIndex.get(keyStr) : null;
  const role = forcedRole
    || (keyStr !== null && ctx.overrides?.[keyStr] && ctx.overrides[keyStr] !== 'auto'
      ? ctx.overrides[keyStr]
      : null)
    || inferRoleFromStyle(styleId, sourceItem?.role || (block.kind === 'equation' ? 'equation' : 'body'));

  block.role = role;
  if (sourceIndex !== null && sourceIndex !== undefined) {
    block.sourceIndex = sourceIndex;
    if (sourceItem?.suspect) block.suspect = sourceItem.suspect;
    if (sourceItem?.suggest) block.suggest = sourceItem.suggest;
    if (sourceItem?.forced || forcedRole) block.forced = true;
  }

  const noteFromUser = keyStr !== null ? (ctx.notes?.[keyStr] ?? ctx.notes?.[sourceIndex]) : null;
  const embeddedComments = commentIds.map((id) => ctx.commentsMap.get(id)).filter(Boolean);
  if (noteFromUser) {
    block.note = String(noteFromUser).trim();
  } else if (embeddedComments.length) {
    block.note = embeddedComments.map((c) => c.text).join('\n');
    block.comments = embeddedComments;
  }
  return block;
}

function hasVisibleBorder($, bordersNode) {
  if (!bordersNode || !bordersNode.length) return false;
  return ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].some((side) => {
    const b = child(bordersNode, side).first();
    if (!b.length) return false;
    const v = b.attr('w:val');
    return Boolean(v && v !== 'nil' && v !== 'none');
  });
}

function parseTableNode($, tblEl, ctx) {
  const tbl = $(tblEl);
  const tblPr = child(tbl, 'tblPr').first();
  const borders = child(tblPr, 'tblBorders').first();
  const tblStyle = val(tblPr, 'tblStyle') || '';
  const bordered = hasVisibleBorder($, borders) || /TableGrid/i.test(tblStyle);
  const tblJc = val(tblPr, 'jc') || 'center';
  const tblW = child(tblPr, 'tblW').first();
  const totalDxa = Number(tblW.attr('w:w')) || 9071;
  const widthCm = tblW.attr('w:type') === 'pct'
    ? ctx.printableWidthCm
    : Math.min(ctx.printableWidthCm, dxaToCm(totalDxa, ctx.printableWidthCm));

  const gridCols = child(tbl, 'tblGrid').children(tag('gridCol')).toArray()
    .map((col) => Number($(col).attr('w:w')) || 0);
  const gridSum = gridCols.reduce((a, b) => a + b, 0);
  const colWidthsPct = gridSum > 0
    ? gridCols.map((w) => +((w / gridSum) * 100).toFixed(2))
    : [];

  const rawRows = child(tbl, 'tr').toArray();
  const rows = [];
  // Track open vertical merges per grid column for rowspan calculation
  const openVMerges = new Map();

  for (const trEl of rawRows) {
    const tr = $(trEl);
    const trPr = child(tr, 'trPr').first();
    const isHeader = child(trPr, 'tblHeader').length > 0;
    const trHeightDxa = Number(child(trPr, 'trHeight').first().attr('w:val')) || 0;
    const cells = [];
    let colCursor = 0;
    let maxCellHeightPt = trHeightDxa > 0 ? dxaToPt(trHeightDxa, 22) : 22;

    for (const tcEl of child(tr, 'tc').toArray()) {
      const tc = $(tcEl);
      const tcPr = child(tc, 'tcPr').first();
      const colspan = Math.max(1, Number(val(tcPr, 'gridSpan')) || 1);
      const vMergeNode = child(tcPr, 'vMerge').first();
      const isVMergeRestart = vMergeNode.length > 0 && vMergeNode.attr('w:val') === 'restart';
      const isVMergeContinue = vMergeNode.length > 0 && vMergeNode.attr('w:val') !== 'restart';

      if (isVMergeContinue) {
        const master = openVMerges.get(colCursor);
        if (master) master.rowspan += 1;
        colCursor += colspan;
        continue;
      }

      const vAlign = val(tcPr, 'vAlign') || 'top';
      const shdFill = child(tcPr, 'shd').first().attr('w:fill');
      const shading = shdFill && shdFill !== 'auto' && shdFill.toUpperCase() !== 'FFFFFF' ? `#${shdFill}` : null;
      const colShareCm = Math.max(2.5, (widthCm * colspan) / Math.max(1, colWidthsPct.length || child(tr, 'tc').length));
      const cellCtx = { ...ctx, printableWidthCm: colShareCm };
      const cellBlocks = [];

      tc.children().each((_, cellChild) => {
        if (cellChild.name === 'w:p') {
          const parsedP = parseParagraphNode($, cellChild, cellCtx);
          if (parsedP) cellBlocks.push(parsedP);
        }
      });

      const cellContentPt = cellBlocks.reduce((sum, b) => sum + (b.heightPt || 16), 0) + 10;
      if (cellContentPt > maxCellHeightPt) maxCellHeightPt = cellContentPt;

      const cellObj = {
        colspan,
        rowspan: 1,
        vAlign,
        shading,
        blocks: cellBlocks
      };

      if (isVMergeRestart) {
        openVMerges.set(colCursor, cellObj);
      } else {
        openVMerges.delete(colCursor);
      }

      cells.push(cellObj);
      colCursor += colspan;
    }

    rows.push({
      isHeader,
      heightPt: maxCellHeightPt,
      cells
    });
  }

  const totalHeightPt = rows.reduce((sum, r) => sum + r.heightPt, 0) + 12;
  let firstTableSourceIndex = null;
  for (const row of rows) {
    for (const cell of row.cells) {
      const found = cell.blocks.find((b) => b.sourceIndex !== undefined && b.sourceIndex !== null);
      if (found) {
        firstTableSourceIndex = found.sourceIndex;
        break;
      }
    }
    if (firstTableSourceIndex !== null) break;
  }

  return {
    kind: 'table',
    bordered,
    align: tblJc === 'right' || tblJc === 'end' ? 'right' : tblJc === 'left' || tblJc === 'start' ? 'left' : 'center',
    widthCm,
    colWidthsPct,
    rows,
    sourceIndex: firstTableSourceIndex,
    heightPt: totalHeightPt
  };
}

function splitBodyIntoSections($, body) {
  const sections = [];
  let currentNodes = [];

  function unwrapNodes(nodes) {
    const flat = [];
    for (const node of nodes) {
      if (node.type !== 'tag') continue;
      if (node.name === 'w:sdt') {
        const sdt = $(node);
        const instr = `${sdt.find(tag('fldSimple')).attr('w:instr') || ''} ${sdt.find(tag('instrText')).text()}`.trim();
        if (/^\s*TOC\b/i.test(instr)) {
          // Keep synthetic TOC paragraph representation
          const firstP = sdt.find(tag('p')).first();
          if (firstP.length) flat.push(firstP[0]);
          continue;
        }
        const sdtContent = child(sdt, 'sdtContent').first();
        if (sdtContent.length) {
          flat.push(...unwrapNodes(sdtContent.children().toArray()));
        }
        continue;
      }
      flat.push(node);
    }
    return flat;
  }

  for (const el of unwrapNodes(body.children().toArray())) {
    if (el.name === 'w:sectPr') {
      sections.push({ nodes: currentNodes, sectPr: $(el) });
      currentNodes = [];
      continue;
    }
    if (el.name === 'w:p') {
      const pSect = child(child($(el), 'pPr').first(), 'sectPr').first();
      if (pSect.length) {
        // Keep paragraph itself only if it carries visible content before the section break
        const hasVisible = Boolean(
          $(el).find(tag('t')).text().trim()
          || $(el).find(`${mTag('oMath')},${tag('drawing')},${tag('tab')},${tag('sym')}`).length
        );
        if (hasVisible) currentNodes.push(el);
        sections.push({ nodes: currentNodes, sectPr: pSect });
        currentNodes = [];
        continue;
      }
    }
    currentNodes.push(el);
  }

  if (currentNodes.length) {
    sections.push({ nodes: currentNodes, sectPr: $() });
  }
  return sections;
}

function parseSectionConfig($, sectPr, archive, relsMap) {
  const pgSz = child(sectPr, 'pgSz').first();
  const pgMar = child(sectPr, 'pgMar').first();
  const pgBorders = child(sectPr, 'pgBorders').first();
  const pgNumType = child(sectPr, 'pgNumType').first();

  const widthCm = dxaToCm(pgSz.attr('w:w'), 21);
  const heightCm = dxaToCm(pgSz.attr('w:h'), 29.7);
  const marginsCm = {
    top: dxaToCm(pgMar.attr('w:top'), 2),
    bottom: dxaToCm(pgMar.attr('w:bottom'), 2),
    left: dxaToCm(pgMar.attr('w:left'), 3),
    right: dxaToCm(pgMar.attr('w:right'), 2)
  };

  let borderStyle = null;
  if (pgBorders.length) {
    const topB = child(pgBorders, 'top').first();
    const bVal = topB.attr('w:val');
    if (bVal && bVal !== 'none' && bVal !== 'nil') {
      borderStyle = bVal === 'twistedLines1' ? 'twistedLines1' : 'single';
    }
  }

  const headerRelId = sectPr.children(`${tag('headerReference')}[w\\:type="default"]`).first().attr('r:id')
    || sectPr.children(tag('headerReference')).first().attr('r:id');
  const footerRelId = sectPr.children(`${tag('footerReference')}[w\\:type="default"]`).first().attr('r:id')
    || sectPr.children(tag('footerReference')).first().attr('r:id');

  const header = parseHeaderFooterPart(archive, relsMap, headerRelId, 'header');
  const footer = parseHeaderFooterPart(archive, relsMap, footerRelId, 'footer');

  const numFmt = pgNumType.attr('w:fmt') || 'decimal';
  const numStartRaw = pgNumType.attr('w:start');
  const numStart = numStartRaw !== undefined ? Number(numStartRaw) : null;
  const isTitlePg = child(sectPr, 'titlePg').length > 0 || Boolean(borderStyle);

  return {
    widthCm,
    heightCm,
    marginsCm,
    borderStyle,
    header,
    footer,
    numFmt,
    numStart,
    isCover: isTitlePg && Boolean(borderStyle)
  };
}

function paginateSectionBlocks(blocks, sectionCfg, sectionIndex) {
  const pageHeightPt = (sectionCfg.heightCm * 72) / 2.54; // ~841.9pt for A4
  const topPt = (sectionCfg.marginsCm.top * 72) / 2.54;
  const bottomPt = (sectionCfg.marginsCm.bottom * 72) / 2.54;
  const hfReservePt = (sectionCfg.header ? 22 : 0) + (sectionCfg.footer ? 22 : 0);
  const maxContentPt = sectionCfg.isCover
    ? 9999 // BDU covers are dynamically auto-fitted to 1 page by docx-graduation-cover
    : Math.max(320, pageHeightPt - topPt - bottomPt - hfReservePt);

  const pages = [];
  let currentBlocks = [];
  let usedPt = 0;

  const flushPage = () => {
    pages.push({
      sectionIndex,
      widthCm: sectionCfg.widthCm,
      heightCm: sectionCfg.heightCm,
      marginsCm: sectionCfg.marginsCm,
      borderStyle: sectionCfg.borderStyle,
      isCover: sectionCfg.isCover,
      header: sectionCfg.header,
      footer: sectionCfg.footer,
      blocks: currentBlocks
    });
    currentBlocks = [];
    usedPt = 0;
  };

  for (let idx = 0; idx < blocks.length; idx++) {
    const block = blocks[idx];
    if (block.kind === 'page_break') {
      if (currentBlocks.length) flushPage();
      continue;
    }
    if (block.pageBreakBefore && currentBlocks.length > 0) {
      flushPage();
    }

    const blockHeight = block.heightPt || 20;

    // Split tall multi-row bordered data tables cleanly across pages, repeating header rows
    if (
      block.kind === 'table'
      && block.bordered
      && block.rows.length > 2
      && !block.rows.some((r) => r.cells.some((c) => c.rowspan > 1))
      && usedPt + blockHeight > maxContentPt
    ) {
      const headerRows = block.rows.filter((r) => r.isHeader);
      const headerPt = headerRows.reduce((s, r) => s + r.heightPt, 0);
      const dataRows = block.rows.filter((r) => !r.isHeader);

      let sliceRows = [];
      let slicePt = headerRows.length ? headerPt : 0;

      // If not enough room even for header + 1st data row on current page, start fresh page first
      const firstRowPt = (dataRows[0]?.heightPt || 24) + slicePt;
      if (currentBlocks.length > 0 && usedPt + firstRowPt > maxContentPt) {
        flushPage();
      }

      for (const row of dataRows) {
        if (sliceRows.length > 0 && usedPt + slicePt + row.heightPt > maxContentPt) {
          currentBlocks.push({
            ...block,
            rows: [...headerRows, ...sliceRows],
            heightPt: slicePt + 8,
            splitPart: true
          });
          flushPage();
          sliceRows = [row];
          slicePt = headerPt + row.heightPt;
        } else {
          sliceRows.push(row);
          slicePt += row.heightPt;
        }
      }
      if (sliceRows.length > 0) {
        currentBlocks.push({
          ...block,
          rows: [...headerRows, ...sliceRows],
          heightPt: slicePt + 8
        });
        usedPt += slicePt + 8;
      }
      continue;
    }

    // Heading keepNext: avoid stranding a heading alone at the very bottom of a page
    const nextBlock = blocks[idx + 1];
    const keepWithNextPt = (block.keepNext && nextBlock && nextBlock.kind !== 'page_break')
      ? Math.min(48, nextBlock.heightPt || 24)
      : 0;

    if (currentBlocks.length > 0 && usedPt + blockHeight + keepWithNextPt > maxContentPt) {
      flushPage();
    }

    currentBlocks.push(block);
    usedPt += blockHeight;
  }

  if (currentBlocks.length > 0 || pages.length === 0) {
    flushPage();
  }

  return pages;
}

/**
 * Builds the complete paginated A4 preview model from a formatted DOCX archive.
 */
export function buildRenderedDocxPreview(archive, {
  sourcePreview = null,
  overrides = {},
  notes = {}
} = {}) {
  const docXml = archive.readAsText('word/document.xml');
  const relsXml = archive.getEntry('word/_rels/document.xml.rels')
    ? archive.readAsText('word/_rels/document.xml.rels')
    : '';
  const $ = parseXml(docXml);
  const body = $(tag('body'));
  if (!body.length) throw new Error('DOCX không có phần thân tài liệu hợp lệ.');

  const relsMap = buildRelsMap(relsXml);
  const mediaMap = extractSafeMediaMap(archive, relsMap);
  const styleResolver = buildStyleResolver(archive);
  const nextMarker = createNumberingTracker(archive);
  const commentsMap = readCommentsMap(archive);

  const sourceItemByIndex = new Map(
    (sourcePreview?.items || []).map((item) => [String(item.i), item])
  );

  const rawSections = splitBodyIntoSections($, body);
  const allPages = [];
  let runningPageCounter = 1;
  let numberedStarted = false;

  for (let sIdx = 0; sIdx < rawSections.length; sIdx++) {
    const rawSec = rawSections[sIdx];
    const cfg = parseSectionConfig($, rawSec.sectPr, archive, relsMap);
    const printableWidthCm = Math.max(8, cfg.widthCm - cfg.marginsCm.left - cfg.marginsCm.right);
    const ctx = {
      styleResolver,
      nextMarker,
      mediaMap,
      commentsMap,
      sourceItemByIndex,
      overrides,
      notes,
      printableWidthCm
    };

    const blocks = [];
    for (const node of rawSec.nodes) {
      if (node.name === 'w:p') {
        const parsed = parseParagraphNode($, node, ctx);
        if (parsed) blocks.push(parsed);
      } else if (node.name === 'w:tbl') {
        blocks.push(parseTableNode($, node, ctx));
      }
    }

    const sectionPages = paginateSectionBlocks(blocks, cfg, sIdx);
    const isBlankCoverSheet = !numberedStarted
      && blocks.length === 0
      && !cfg.header
      && !cfg.footer
      && !cfg.borderStyle
      && cfg.numStart === null;
    const isUnnumbered = cfg.isCover || isBlankCoverSheet;

    if (cfg.numStart !== null && Number.isFinite(cfg.numStart) && cfg.numStart > 0) {
      runningPageCounter = cfg.numStart;
    }

    for (const page of sectionPages) {
      const pageIndex = allPages.length;
      const pageLabel = isUnnumbered ? '' : formatPageNumber(runningPageCounter, cfg.numFmt);
      page.pageIndex = pageIndex;
      page.pageNumber = pageIndex + 1;
      page.pageLabel = pageLabel;
      page.numFmt = cfg.numFmt;
      if (isBlankCoverSheet) page.isBlankSheet = true;
      allPages.push(page);
      if (!isUnnumbered) {
        numberedStarted = true;
        runningPageCounter += 1;
      }
    }
  }

  // Pass 2: Collect Outline, Figure/Table captions, and Source-Index locations, then fill TOC blocks
  const outline = [];
  const tocEntries = [];
  const figureEntries = [];
  const tableEntries = [];
  const blockLocationBySourceIndex = new Map();

  for (const page of allPages) {
    if (page.isCover) {
      const coverTitleBlock = page.blocks.find((b) => b.kind === 'p' && /^(?:TIỂU LUẬN|ĐỒ ÁN|KHÓA LUẬN|BÁO CÁO)/iu.test(b.text));
      outline.push({
        id: `cover-${page.pageIndex}`,
        title: `Trang bìa${page.pageIndex > 0 ? ` (${page.pageIndex + 1})` : ''}`,
        level: 1,
        kind: 'cover',
        pageIndex: page.pageIndex,
        pageNumber: page.pageNumber,
        pageLabel: 'Bìa',
        sourceIndex: coverTitleBlock?.sourceIndex ?? null
      });
      continue;
    }

    for (let bIdx = 0; bIdx < page.blocks.length; bIdx++) {
      const block = page.blocks[bIdx];
      block.blockId = `wf-doc-p${page.pageIndex}-b${bIdx}`;

      if (block.sourceIndex !== undefined && block.sourceIndex !== null && !blockLocationBySourceIndex.has(block.sourceIndex)) {
        blockLocationBySourceIndex.set(block.sourceIndex, {
          blockId: block.blockId,
          pageIndex: page.pageIndex,
          pageNumber: page.pageNumber,
          pageLabel: page.pageLabel || String(page.pageNumber)
        });
      }

      if (block.kind === 'p' && block.text) {
        if (block.role === 'front_title' || block.role === 'proposal_title') {
          outline.push({
            id: block.blockId,
            title: block.text,
            level: 1,
            kind: 'front',
            pageIndex: page.pageIndex,
            pageNumber: page.pageNumber,
            pageLabel: page.pageLabel || String(page.pageNumber),
            sourceIndex: block.sourceIndex ?? null
          });
        } else if (block.outlineLevel && block.outlineLevel >= 1 && block.outlineLevel <= 4) {
          const entry = {
            id: block.blockId,
            title: block.text,
            level: block.outlineLevel,
            kind: 'heading',
            pageIndex: page.pageIndex,
            pageNumber: page.pageNumber,
            pageLabel: page.pageLabel || String(page.pageNumber),
            sourceIndex: block.sourceIndex ?? null
          };
          outline.push(entry);
          tocEntries.push(entry);
        } else {
          const isFigureCaption = block.role === 'figure_caption'
            || block.styleId === 'WFFigureCaption'
            || (block.role !== 'body' && block.styleId !== 'WFBody' && /^Hình\s+\d+(?:[.\-]\d+)*\s*[:.]\s+\S/iu.test(block.text));
          const isTableCaption = block.role === 'table_caption'
            || block.styleId === 'WFTableCaption'
            || (block.role !== 'body' && block.styleId !== 'WFBody' && /^Bảng\s+\d+(?:[.\-]\d+)*\s*[:.]\s+\S/iu.test(block.text));
          if (isFigureCaption) {
            figureEntries.push({
              id: block.blockId,
              title: block.text,
              level: 1,
              pageIndex: page.pageIndex,
              pageNumber: page.pageNumber,
              pageLabel: page.pageLabel || String(page.pageNumber),
              sourceIndex: block.sourceIndex ?? null
            });
          } else if (isTableCaption) {
            tableEntries.push({
              id: block.blockId,
              title: block.text,
              level: 1,
              pageIndex: page.pageIndex,
              pageNumber: page.pageNumber,
              pageLabel: page.pageLabel || String(page.pageNumber),
              sourceIndex: block.sourceIndex ?? null
            });
          }
        }
      }
    }
  }

  // Populate TOC / List of Figures / List of Tables blocks with live page numbers
  for (const page of allPages) {
    const pageFrontTitle = normalizeKey(
      page.blocks.find((b) => b.kind === 'p' && b.role === 'front_title')?.text || ''
    );
    const pageSuggestsFigures = /^(?:DANH MUC|MUC LUC)\s+(?:CAC\s+)?(?:HINH|HINH ANH|HINH VE)\b/.test(pageFrontTitle);
    const pageSuggestsTables = /^(?:DANH MUC|MUC LUC)\s+(?:CAC\s+)?(?:BANG|BANG BIEU)\b/.test(pageFrontTitle);
    for (const block of page.blocks) {
      if (block.kind !== 'toc') continue;
      if (block.tocType === 'figures' || (block.tocType === 'main' && pageSuggestsFigures)) {
        block.tocType = 'figures';
        block.entries = figureEntries;
      } else if (block.tocType === 'tables' || (block.tocType === 'main' && pageSuggestsTables)) {
        block.tocType = 'tables';
        block.entries = tableEntries;
      } else {
        block.entries = tocEntries;
      }
    }
  }

  return {
    pageCount: allPages.length,
    pages: allPages,
    outline,
    locations: Object.fromEntries(blockLocationBySourceIndex.entries())
  };
}
