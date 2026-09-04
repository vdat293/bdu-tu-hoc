import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';

const HEADING_STYLE_IDS = new Set([
  'WFHeading1',
  'WFHeading2',
  'WFHeading3',
  'WFHeading4'
]);

const BODY_STYLE_IDS = new Set(['WFBody']);

const TEXT_PART_PATTERN = /^word\/(?:document|styles|numbering|footnotes|endnotes|comments|[^/]*header[^/]*|[^/]*footer[^/]*)\.xml$/i;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function replaceProperty(xml, propertyName, replacement) {
  const propertyPattern = new RegExp(
    `<w:${propertyName}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/w:${propertyName}>)`,
    'g'
  );
  return xml.replace(propertyPattern, '').replace(/<w:rPr\b([^>]*)>/, `<w:rPr$1>${replacement}`);
}

function ensureRunProperties(containerXml, propertiesXml, closingTag) {
  if (/<w:rPr\b[^>]*>/.test(containerXml)) {
    return propertiesXml.reduce(
      (xml, property) => replaceProperty(xml, property.name, property.xml),
      containerXml
    );
  }

  return containerXml.replace(closingTag, `<w:rPr>${propertiesXml.map(property => property.xml).join('')}</w:rPr>${closingTag}`);
}

function replaceParagraphProperty(xml, propertyName, replacement) {
  const propertyPattern = new RegExp(
    `<w:${propertyName}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/w:${propertyName}>)`,
    'g'
  );
  return xml.replace(propertyPattern, '').replace(/<w:pPr\b([^>]*)>/, `<w:pPr$1>${replacement}`);
}

function ensureParagraphProperties(containerXml, propertiesXml, closingTag) {
  if (/<w:pPr\b[^>]*>/.test(containerXml)) {
    return propertiesXml.reduce(
      (xml, property) => replaceParagraphProperty(xml, property.name, property.xml),
      containerXml
    );
  }

  const paragraphProperties = `<w:pPr>${propertiesXml.map(property => property.xml).join('')}</w:pPr>`;
  if (/<w:rPr\b/.test(containerXml)) {
    return containerXml.replace(/<w:rPr\b/, `${paragraphProperties}<w:rPr`);
  }
  return containerXml.replace(closingTag, `${paragraphProperties}${closingTag}`);
}

function patchRun(runXml, {
  black = false,
  bold = false,
  fontName = null,
  italic = false,
  notBold = false,
  notItalic = false,
  sizeHalfPoints = null,
  underline = false
}) {
  const properties = [];
  if (fontName) {
    properties.push({
      name: 'rFonts',
      xml: `<w:rFonts w:ascii="${fontName}" w:hAnsi="${fontName}" w:eastAsia="${fontName}" w:cs="${fontName}"/>`
    });
  }
  if (black) properties.push({ name: 'color', xml: '<w:color w:val="000000"/>' });
  if (bold) {
    properties.push({ name: 'b', xml: '<w:b w:val="1"/>' });
    properties.push({ name: 'bCs', xml: '<w:bCs w:val="1"/>' });
  } else if (notBold) {
    properties.push({ name: 'b', xml: '<w:b w:val="0"/>' });
    properties.push({ name: 'bCs', xml: '<w:bCs w:val="0"/>' });
  }
  if (notItalic) {
    properties.push({ name: 'i', xml: '<w:i w:val="0"/>' });
    properties.push({ name: 'iCs', xml: '<w:iCs w:val="0"/>' });
  }
  if (italic) {
    properties.push({ name: 'i', xml: '<w:i w:val="1"/>' });
    properties.push({ name: 'iCs', xml: '<w:iCs w:val="1"/>' });
  }
  if (underline) properties.push({ name: 'u', xml: '<w:u w:val="single"/>' });
  if (sizeHalfPoints) {
    properties.push({ name: 'sz', xml: `<w:sz w:val="${sizeHalfPoints}"/>` });
    properties.push({ name: 'szCs', xml: `<w:szCs w:val="${sizeHalfPoints}"/>` });
  }

  if (!properties.length) return runXml;

  if (/<w:rPr\b[^>]*>/.test(runXml)) {
    return properties.reduce(
      (xml, property) => replaceProperty(xml, property.name, property.xml),
      runXml
    );
  }

  return runXml.replace(/^(<w:r\b[^>]*>)/, `$1<w:rPr>${properties.map(property => property.xml).join('')}</w:rPr>`);
}

function getParagraphStyleId(paragraphXml) {
  return paragraphXml.match(/<w:pStyle\b[^>]*w:val="([^"]+)"[^>]*\/?\s*>/)?.[1] || '';
}

function getNumberingReference(xml) {
  const numPr = xml.match(/<w:numPr\b[^>]*>[\s\S]*?<\/w:numPr>/)?.[0];
  if (!numPr) return null;

  const numId = numPr.match(/<w:numId\b[^>]*w:val="(\d+)"[^>]*\/?\s*>/)?.[1];
  if (!numId || numId === '0') return null;

  const level = Number(numPr.match(/<w:ilvl\b[^>]*w:val="(\d+)"[^>]*\/?\s*>/)?.[1] || 0);
  return { numId, level };
}

function getFirstTextValue(paragraphXml) {
  return paragraphXml.match(/<(?:w|a|m):t\b[^>]*>([\s\S]*?)<\/(?:w|a|m):t>/)?.[1] || '';
}

function getParagraphText(paragraphXml) {
  return [...paragraphXml.matchAll(/<(?:w|a|m):t\b[^>]*>([\s\S]*?)<\/(?:w|a|m):t>/g)]
    .map(match => match[1])
    .join('')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeLookupText(value) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

function setParagraphStyle(paragraphXml, styleId) {
  if (/<w:pPr\b[^>]*>/.test(paragraphXml)) {
    if (/<w:pStyle\b[^>]*\/?\s*>/.test(paragraphXml)) {
      return paragraphXml.replace(/<w:pStyle\b[^>]*\/?\s*>/, `<w:pStyle w:val="${styleId}"/>`);
    }
    return paragraphXml.replace(/<w:pPr\b([^>]*)>/, `<w:pPr$1><w:pStyle w:val="${styleId}"/>`);
  }

  return paragraphXml.replace(/^(<w:p\b[^>]*>)/, `$1<w:pPr><w:pStyle w:val="${styleId}"/></w:pPr>`);
}

function setParagraphAlignment(paragraphXml, alignment) {
  if (/<w:jc\b[^>]*\/?\s*>/.test(paragraphXml)) {
    return paragraphXml.replace(/<w:jc\b[^>]*\/?\s*>/, `<w:jc w:val="${alignment}"/>`);
  }
  return paragraphXml.replace(/<w:pPr\b([^>]*)>/, `<w:pPr$1><w:jc w:val="${alignment}"/>`);
}

function replaceFirstTextValue(paragraphXml, marker) {
  return paragraphXml.replace(
    /<((?:w|a|m):t)\b([^>]*)>([\s\S]*?)<\/\1>/,
    (fullMatch, tagName, attributes, text) => {
      const cleanText = text
        .replace(/^\s*(?:[•◦▪‣●○■◆◇]|[-+]|\d+[.)])\s*/u, '')
        .replace(/^\s+/, '');
      return `<${tagName}${attributes}>${marker} ${cleanText}</${tagName}>`;
    }
  );
}

function stripListParagraphFormatting(paragraphXml) {
  return paragraphXml
    .replace(/<w:numPr\b[^>]*>[\s\S]*?<\/w:numPr>/g, '')
    .replace(/<w:tabs\b[^>]*>[\s\S]*?<\/w:tabs>/g, '')
    .replace(/<w:ind\b[^>]*\/?\s*>/g, '')
    .replace(/<w:tab\b[^>]*\/?\s*>/g, '')
    .replace(/(<(?:w|a|m):t\b[^>]*>)([\s\S]*?)(<\/(?:w|a|m):t>)/g, (fullMatch, open, text, close) => (
      `${open}${text.replace(/\t+/g, ' ')}${close}`
    ));
}

export function buildListContext(numberingXml = '', stylesXml = '') {
  const abstractLevels = new Map();
  const numberingDefinitions = new Map();
  const styleReferences = new Map();

  for (const match of numberingXml.matchAll(/<w:abstractNum\b[^>]*w:abstractNumId="(\d+)"[^>]*>([\s\S]*?)<\/w:abstractNum>/g)) {
    const levels = new Map();
    for (const levelMatch of match[2].matchAll(/<w:lvl\b[^>]*w:ilvl="(\d+)"[^>]*>([\s\S]*?)<\/w:lvl>/g)) {
      const format = levelMatch[2].match(/<w:numFmt\b[^>]*w:val="([^"]+)"[^>]*\/?\s*>/)?.[1] || '';
      levels.set(Number(levelMatch[1]), format);
    }
    abstractLevels.set(match[1], levels);
  }

  for (const match of numberingXml.matchAll(/<w:num\b[^>]*w:numId="(\d+)"[^>]*>([\s\S]*?)<\/w:num>/g)) {
    const abstractId = match[2].match(/<w:abstractNumId\b[^>]*w:val="(\d+)"[^>]*\/?\s*>/)?.[1];
    if (abstractId) numberingDefinitions.set(match[1], abstractLevels.get(abstractId) || new Map());
  }

  for (const match of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const reference = getNumberingReference(match[2]);
    if (reference) styleReferences.set(match[1], reference);
  }

  return { numberingDefinitions, styleReferences };
}

export function normalizeAcademicLists(documentXml, listContext) {
  // Academic lists carry meaning and hierarchy. Preserve their numbering,
  // indentation and manually typed markers instead of flattening everything
  // into a synthetic 1), 2), 3) sequence.
  void listContext;
  return {
    xml: documentXml,
    stats: {
      listParagraphsConverted: 0,
      automaticListsConverted: 0,
      manualListsConverted: 0,
      listsPreserved: true
    }
  };
}

/**
 * The closed-source formatter replaces list paragraph styles and drops their
 * numbering metadata. Materialize only automatic markers on the disposable
 * working copy so bullets/numbers remain visible in the formatted output.
 * Manual markers are left byte-for-byte unchanged.
 */
export function materializeAutomaticLists(documentXml, listContext) {
  const stats = {
    automaticListsMaterialized: 0,
    bulletListsMaterialized: 0,
    numberedListsMaterialized: 0
  };
  const counters = new Map();
  let previousKey = '';

  const xml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    const directReference = getNumberingReference(paragraphXml);
    const paragraphStyleId = getParagraphStyleId(paragraphXml);
    const styleReference = listContext.styleReferences.get(paragraphStyleId);
    const reference = directReference || styleReference;
    const text = getFirstTextValue(paragraphXml);
    const headingLike = HEADING_STYLE_IDS.has(paragraphStyleId)
      || /^Heading\d+$/i.test(paragraphStyleId)
      || /^\s*\d+(?:\.\d+)+\.?\s+/.test(text)
      || /^\s*CHƯƠNG\s+\d+/i.test(text);
    const manualMarker = /^\s*(?:[•◦▪‣●○■◆◇]|[-+]|\d+[.)])\s+/u.test(text);
    const format = reference
      ? listContext.numberingDefinitions.get(reference.numId)?.get(reference.level)
      : '';

    if (!reference || !format || format === 'none' || headingLike || manualMarker) {
      previousKey = '';
      return paragraphXml;
    }

    const key = `${reference.numId}:${reference.level}:${format}`;
    if (key !== previousKey) counters.set(key, 0);
    const next = (counters.get(key) || 0) + 1;
    counters.set(key, next);
    previousKey = key;

    const isBullet = format === 'bullet';
    const marker = isBullet ? (reference.level > 0 ? '+' : '-') : `${next}.`;
    let normalized = setParagraphStyle(paragraphXml, 'WFBody');
    normalized = normalized.replace(/<w:numPr\b[^>]*>[\s\S]*?<\/w:numPr>/g, '');
    normalized = normalized.replace(/<w:tab\b[^>]*\/>/g, '');
    normalized = replaceFirstTextValue(normalized, marker);

    stats.automaticListsMaterialized += 1;
    if (isBullet) stats.bulletListsMaterialized += 1;
    else stats.numberedListsMaterialized += 1;
    return normalized;
  });

  return { xml, stats };
}

function replaceReferenceMarker(paragraphXml, referenceNumber) {
  return paragraphXml.replace(
    /<((?:w|a|m):t)\b([^>]*)>([\s\S]*?)<\/\1>/,
    (fullMatch, tagName, attributes, text) => {
      const cleanText = text
        .replace(/^\s*(?:\[\d+\]|\d+[.)])\s*/u, '')
        .replace(/^\s+/, '');
      return `<${tagName}${attributes}>[${referenceNumber}] ${cleanText}</${tagName}>`;
    }
  );
}

function patchParagraphRuns(paragraphXml, options) {
  return paragraphXml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, runXml => patchRun(runXml, options));
}

export function normalizeReferenceSection(documentXml) {
  const stats = {
    referenceHeadingsNormalized: 0,
    referenceEntriesNormalized: 0,
    referenceContinuationParagraphsNormalized: 0
  };
  let insideReferences = false;

  const xml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    const text = getParagraphText(paragraphXml);
    const lookupText = normalizeLookupText(text).replace(/[.:]+$/, '');
    const styleId = getParagraphStyleId(paragraphXml);
    const isReferenceHeading = lookupText === 'TAI LIEU THAM KHAO' || lookupText === 'REFERENCES';

    if (isReferenceHeading) {
      insideReferences = true;

      let normalized = stripListParagraphFormatting(paragraphXml);
      normalized = setParagraphStyle(normalized, 'WFHeading1');
      normalized = setParagraphAlignment(normalized, 'center');
      normalized = patchParagraphRuns(normalized, {
        black: true,
        bold: true,
        fontName: 'Times New Roman',
        notItalic: true,
        sizeHalfPoints: 36
      });
      stats.referenceHeadingsNormalized += 1;
      return normalized;
    }

    if (!insideReferences) return paragraphXml;

    const isNextMajorSection = lookupText === 'PHU LUC'
      || lookupText === 'APPENDIX'
      || (HEADING_STYLE_IDS.has(styleId) && Boolean(lookupText));
    if (isNextMajorSection) {
      insideReferences = false;
      return paragraphXml;
    }

    if (!text.trim()) return paragraphXml;

    let normalized = paragraphXml;
    normalized = setParagraphStyle(normalized, 'WFBody');
    normalized = setParagraphAlignment(normalized, 'left');
    if (/^\s*(?:\[\d+\]|\d+[.)])\s*/.test(text)) stats.referenceEntriesNormalized += 1;
    else stats.referenceContinuationParagraphsNormalized += 1;

    return normalized;
  });

  return { xml, stats };
}

export function normalizeMajorSectionHeadings(documentXml) {
  let majorSectionHeadingsNormalized = 0;
  const xml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    const lookupText = normalizeLookupText(getParagraphText(paragraphXml)).replace(/[.:]+$/, '');
    if (!['PHU LUC', 'APPENDIX', 'KET LUAN'].includes(lookupText)) return paragraphXml;
    majorSectionHeadingsNormalized += 1;
    let normalized = setParagraphStyle(paragraphXml, 'WFHeading1');
    normalized = setParagraphAlignment(normalized, 'center');
    return normalized;
  });
  return { xml, stats: { majorSectionHeadingsNormalized } };
}

export function normalizeReferenceHeader(headerXml) {
  return { xml: headerXml, cleared: false };
}

/**
 * Remove click targets from hyperlinks inside the reference section while
 * retaining every visible run and character. Hyperlinks elsewhere remain
 * untouched.
 */
export function stripReferenceHyperlinks(documentXml) {
  const removedRelationshipIds = new Set();
  let insideReferences = false;
  let hyperlinksRemoved = 0;
  let simpleFieldsRemoved = 0;

  const xml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    const text = getParagraphText(paragraphXml);
    const lookupText = normalizeLookupText(text).replace(/[.:]+$/, '');
    const styleId = getParagraphStyleId(paragraphXml);
    const isReferenceHeading = lookupText === 'TAI LIEU THAM KHAO' || lookupText === 'REFERENCES';

    if (isReferenceHeading) {
      insideReferences = true;
      return paragraphXml;
    }

    if (insideReferences && HEADING_STYLE_IDS.has(styleId) && lookupText) {
      insideReferences = false;
    }
    if (!insideReferences) return paragraphXml;

    let normalized = paragraphXml.replace(
      /<w:hyperlink\b([^>]*)>([\s\S]*?)<\/w:hyperlink>/g,
      (fullMatch, attributes, contents) => {
        const relationshipId = attributes.match(/\br:id="([^"]+)"/)?.[1];
        if (relationshipId) removedRelationshipIds.add(relationshipId);
        hyperlinksRemoved += 1;
        return contents.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, runXml => runXml
          .replace(/<w:rStyle\b[^>]*w:val="Hyperlink"[^>]*\/>/gi, '')
          .replace(/<w:u\b[^>]*\/>/g, '')
          .replace(/<w:color\b[^>]*\/>/g, ''));
      }
    );

    normalized = normalized.replace(
      /<w:fldSimple\b([^>]*)>([\s\S]*?)<\/w:fldSimple>/g,
      (fullMatch, attributes, contents) => {
        if (!/\bHYPERLINK\b/i.test(attributes)) return fullMatch;
        simpleFieldsRemoved += 1;
        return contents;
      }
    );

    normalized = normalized.replace(
      /(<w:r\b[^>]*>[\s\S]*?<w:fldChar\b[^>]*w:fldCharType="begin"[^>]*\/>[\s\S]*?<\/w:r>)([\s\S]*?)(<w:r\b[^>]*>[\s\S]*?<w:fldChar\b[^>]*w:fldCharType="end"[^>]*\/>[\s\S]*?<\/w:r>)/g,
      (fullMatch, beginRun, middleRuns) => {
        if (!/<w:instrText\b[^>]*>[\s\S]*?\bHYPERLINK\b[\s\S]*?<\/w:instrText>/i.test(middleRuns)) {
          return fullMatch;
        }
        const separator = /<w:r\b[^>]*>[\s\S]*?<w:fldChar\b[^>]*w:fldCharType="separate"[^>]*\/>[\s\S]*?<\/w:r>/g;
        const separatorMatch = separator.exec(middleRuns);
        simpleFieldsRemoved += 1;
        if (!separatorMatch) return '';
        return middleRuns.slice(separatorMatch.index + separatorMatch[0].length)
          .replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, runXml => runXml
            .replace(/<w:rStyle\b[^>]*w:val="Hyperlink"[^>]*\/>/gi, '')
            .replace(/<w:u\b[^>]*\/>/g, '')
            .replace(/<w:color\b[^>]*\/>/g, ''));
      }
    );

    return normalized;
  });

  return {
    xml,
    removedRelationshipIds: [...removedRelationshipIds],
    stats: { hyperlinksRemoved, hyperlinkFieldsRemoved: simpleFieldsRemoved }
  };
}

export function removeUnusedHyperlinkRelationships(relationshipsXml, relationshipIds, documentXml) {
  const idSet = new Set(relationshipIds);
  let relationshipsRemoved = 0;
  if (!idSet.size || !relationshipsXml) {
    return { xml: relationshipsXml, relationshipsRemoved };
  }

  const xml = relationshipsXml.replace(/<Relationship\b[^>]*\/>/g, relationshipXml => {
    const id = relationshipXml.match(/\bId="([^"]+)"/)?.[1];
    const isHyperlink = /relationships\/hyperlink/i.test(relationshipXml);
    const stillReferenced = id && new RegExp(`\\br:id="${escapeRegExp(id)}"`).test(documentXml);
    if (id && idSet.has(id) && isHyperlink && !stillReferenced) {
      relationshipsRemoved += 1;
      return '';
    }
    return relationshipXml;
  });

  return { xml, relationshipsRemoved };
}

function writeArchiveAtomically(archive, outputPath) {
  const tempPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}.normalized.tmp`
  );

  try {
    archive.writeZip(tempPath);
    fs.renameSync(tempPath, outputPath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

/**
 * Normalize lists on a working copy before the C# formatter replaces source
 * paragraph styles and numbering metadata.
 */
export function normalizeSourceLists(inputPath, outputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`Không tìm thấy DOCX đầu vào để chuẩn hóa danh sách: ${inputPath}`);
  }

  const archive = new AdmZip(inputPath);
  const documentEntry = archive.getEntry('word/document.xml');
  if (!documentEntry) throw new Error('DOCX không có word/document.xml.');

  const numberingXml = archive.getEntry('word/numbering.xml')?.getData().toString('utf8') || '';
  const stylesXml = archive.getEntry('word/styles.xml')?.getData().toString('utf8') || '';
  const listContext = buildListContext(numberingXml, stylesXml);
  const listResult = materializeAutomaticLists(documentEntry.getData().toString('utf8'), listContext);
  const referenceResult = normalizeReferenceSection(listResult.xml);
  archive.updateFile('word/document.xml', Buffer.from(referenceResult.xml, 'utf8'));
  writeArchiveAtomically(archive, outputPath);
  return { ...listResult.stats, ...referenceResult.stats };
}

export function replaceEnDashes(xml) {
  const matches = xml.match(/[–—]/g);
  return {
    xml: xml.replace(/[–—]/g, '-'),
    replacements: matches?.length || 0
  };
}

function lastVisibleCharacter(value) {
  const normalized = value
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&[a-zA-Z]+;|&#x?[0-9a-fA-F]+;/g, 'x');
  return normalized.at(-1) || '';
}

function firstVisibleCharacter(value) {
  const normalized = value
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/&[a-zA-Z]+;|&#x?[0-9a-fA-F]+;/g, 'x');
  return normalized.at(0) || '';
}

function smartenTextNode(text, state) {
  let output = '';
  let cursor = 0;
  let replacements = 0;
  const quotePattern = /"|&quot;/g;
  let match;

  while ((match = quotePattern.exec(text)) !== null) {
    const before = text.slice(cursor, match.index);
    output += before;
    const beforeLast = lastVisibleCharacter(before);
    if (beforeLast) state.previousCharacter = beforeLast;

    const nextCharacter = firstVisibleCharacter(text.slice(match.index + match[0].length));
    const opensAfterBoundary = !state.previousCharacter || /[\s([{<\-]/.test(state.previousCharacter);
    const closesBeforeBoundary = !nextCharacter || /[\s.,;:!?)}\]>]/.test(nextCharacter);

    let isOpening;
    if (opensAfterBoundary && !state.insideQuote) {
      isOpening = true;
    } else if (closesBeforeBoundary && state.insideQuote) {
      isOpening = false;
    } else {
      isOpening = !state.insideQuote;
    }

    const smartQuote = isOpening ? '“' : '”';
    output += smartQuote;
    state.insideQuote = isOpening;
    state.previousCharacter = smartQuote;
    replacements += 1;
    cursor = match.index + match[0].length;
  }

  const remainder = text.slice(cursor);
  output += remainder;
  const remainderLast = lastVisibleCharacter(remainder);
  if (remainderLast) state.previousCharacter = remainderLast;

  return { text: output, replacements };
}

/**
 * Convert straight double quotes only inside visible OOXML text nodes. Quote
 * state is shared across runs in the same paragraph so a pair split by Word's
 * run formatting still becomes an opening and a closing quotation mark.
 */
export function replaceStraightDoubleQuotes(xml) {
  let replacements = 0;
  const textNodePattern = /<((?:w|a|m):t)\b([^>]*)>([\s\S]*?)<\/\1>/g;

  const processParagraph = paragraphXml => {
    const state = { insideQuote: false, previousCharacter: '' };
    return paragraphXml.replace(textNodePattern, (fullMatch, tagName, attributes, text) => {
      const result = smartenTextNode(text, state);
      replacements += result.replacements;
      return `<${tagName}${attributes}>${result.text}</${tagName}>`;
    });
  };

  const processedRanges = [];
  let output = '';
  let cursor = 0;
  const paragraphPattern = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let paragraphMatch;

  while ((paragraphMatch = paragraphPattern.exec(xml)) !== null) {
    output += xml.slice(cursor, paragraphMatch.index);
    output += processParagraph(paragraphMatch[0]);
    processedRanges.push([paragraphMatch.index, paragraphPattern.lastIndex]);
    cursor = paragraphPattern.lastIndex;
  }
  output += xml.slice(cursor);

  if (!processedRanges.length) {
    output = processParagraph(xml);
  }

  return { xml: output, replacements };
}

export function processDocumentXml(documentXml) {
  const stats = {
    headingParagraphs: 0,
    headingRuns: 0,
    bodyParagraphs: 0,
    bodyRunsNormalized: 0
  };

  const xml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    const styleId = getParagraphStyleId(paragraphXml);
    const isHeading = HEADING_STYLE_IDS.has(styleId);
    const isBody = BODY_STYLE_IDS.has(styleId);
    const isCaption = styleId === 'WFCaption';

    if (!isHeading && !isBody && !isCaption) return paragraphXml;

    if (isHeading) stats.headingParagraphs += 1;
    if (isBody) stats.bodyParagraphs += 1;

    return paragraphXml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, runXml => {
      if (isHeading) stats.headingRuns += 1;
      if (isBody) stats.bodyRunsNormalized += 1;
      return patchRun(runXml, {
        black: isHeading || isCaption,
        bold: isCaption,
        italic: isCaption,
        fontName: 'Times New Roman',
        sizeHalfPoints: isCaption ? 26 : null
      });
    });
  });

  return { xml, stats };
}

function normalizeTextForMatching(value) {
  return value.replace(/[–—]/g, '-').replace(/\s+/g, ' ').trim();
}

export function collectInlineEmphasis(docxPath) {
  if (!docxPath || !fs.existsSync(docxPath)) return [];
  const archive = new AdmZip(docxPath);
  const documentXml = archive.getEntry('word/document.xml')?.getData().toString('utf8') || '';
  const records = [];

  for (const paragraphMatch of documentXml.matchAll(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g)) {
    const paragraphXml = paragraphMatch[0];
    const paragraphText = normalizeTextForMatching(getParagraphText(paragraphXml));
    if (!paragraphText) continue;
    const hyperlinkRuns = new Set();
    for (const hyperlinkMatch of paragraphXml.matchAll(/<w:hyperlink\b[^>]*>[\s\S]*?<\/w:hyperlink>/g)) {
      for (const linkedRun of hyperlinkMatch[0].matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)) {
        hyperlinkRuns.add(linkedRun[0]);
      }
    }
    const runs = [];
    for (const runMatch of paragraphXml.matchAll(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g)) {
      const runXml = runMatch[0];
      const text = normalizeTextForMatching(getParagraphText(runXml));
      if (!text) continue;
      const bold = /<w:b\b(?![^>]*w:val="(?:0|false|off)")[^>]*\/?\s*>/.test(runXml);
      const italic = /<w:i\b(?![^>]*w:val="(?:0|false|off)")[^>]*\/?\s*>/.test(runXml);
      const underline = !hyperlinkRuns.has(runXml)
        && /<w:u\b(?![^>]*w:val="(?:none|0|false|off)")[^>]*\/?\s*>/.test(runXml);
      if (bold || italic || underline) runs.push({ text, bold, italic, underline });
    }
    if (runs.length) records.push({ paragraphText, runs });
  }

  return records;
}

export function restoreInlineEmphasis(documentXml, records = []) {
  const recordsByParagraph = new Map();
  for (const record of records) {
    const queue = recordsByParagraph.get(record.paragraphText) || [];
    queue.push(record);
    recordsByParagraph.set(record.paragraphText, queue);
  }
  let runsRestored = 0;

  const xml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    const paragraphText = normalizeTextForMatching(getParagraphText(paragraphXml));
    const queue = recordsByParagraph.get(paragraphText);
    if (!queue?.length) return paragraphXml;
    const record = queue.shift();

    return paragraphXml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, runXml => {
      const runText = normalizeTextForMatching(getParagraphText(runXml));
      const emphasis = record.runs.find(item => item.text === runText);
      if (!emphasis) return runXml;
      runsRestored += 1;
      return patchRun(runXml, emphasis);
    });
  });

  return { xml, stats: { inlineEmphasisRunsRestored: runsRestored } };
}

function patchStyle(stylesXml, styleId, runProperties, paragraphProperties = []) {
  const stylePattern = new RegExp(
    `<w:style\\b(?=[^>]*\\bw:styleId="${escapeRegExp(styleId)}")[^>]*>[\\s\\S]*?<\\/w:style>`,
    'g'
  );

  let patched = false;
  const xml = stylesXml.replace(stylePattern, styleXml => {
    patched = true;
    let normalized = styleXml;
    if (paragraphProperties.length) {
      normalized = ensureParagraphProperties(normalized, paragraphProperties, '</w:style>');
    }
    if (runProperties.length) {
      normalized = ensureRunProperties(normalized, runProperties, '</w:style>');
    }
    return normalized;
  });

  return { xml, patched };
}

export function processStylesXml(stylesXml) {
  let xml = stylesXml;
  let headingStyles = 0;
  let bodyStyles = 0;
  let supportingStyles = 0;
  const font = { name: 'rFonts', xml: '<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/>' };
  const black = { name: 'color', xml: '<w:color w:val="000000"/>' };

  const styleRules = {
    Normal: { run: [font, black, { name: 'sz', xml: '<w:sz w:val="26"/>' }, { name: 'szCs', xml: '<w:szCs w:val="26"/>' }], paragraph: [] },
    WFBody: {
      run: [font, { name: 'sz', xml: '<w:sz w:val="26"/>' }, { name: 'szCs', xml: '<w:szCs w:val="26"/>' }, { name: 'b', xml: '<w:b w:val="0"/>' }, { name: 'bCs', xml: '<w:bCs w:val="0"/>' }],
      paragraph: [
        { name: 'spacing', xml: '<w:spacing w:before="120" w:after="0" w:line="288" w:lineRule="auto"/>' },
        { name: 'jc', xml: '<w:jc w:val="both"/>' },
        { name: 'ind', xml: '<w:ind w:firstLine="0"/>' }
      ]
    },
    WFHeading1: {
      run: [font, black, { name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }, { name: 'i', xml: '<w:i w:val="0"/>' }, { name: 'iCs', xml: '<w:iCs w:val="0"/>' }, { name: 'sz', xml: '<w:sz w:val="36"/>' }, { name: 'szCs', xml: '<w:szCs w:val="36"/>' }],
      paragraph: [{ name: 'pageBreakBefore', xml: '<w:pageBreakBefore/>' }, { name: 'spacing', xml: '<w:spacing w:before="240" w:after="480"/>' }, { name: 'jc', xml: '<w:jc w:val="center"/>' }]
    },
    WFHeading2: {
      run: [font, black, { name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }, { name: 'i', xml: '<w:i w:val="0"/>' }, { name: 'iCs', xml: '<w:iCs w:val="0"/>' }, { name: 'sz', xml: '<w:sz w:val="32"/>' }, { name: 'szCs', xml: '<w:szCs w:val="32"/>' }],
      paragraph: [{ name: 'spacing', xml: '<w:spacing w:before="120" w:after="120"/>' }, { name: 'jc', xml: '<w:jc w:val="left"/>' }]
    },
    WFHeading3: {
      run: [font, black, { name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }, { name: 'i', xml: '<w:i/>' }, { name: 'iCs', xml: '<w:iCs/>' }, { name: 'sz', xml: '<w:sz w:val="28"/>' }, { name: 'szCs', xml: '<w:szCs w:val="28"/>' }],
      paragraph: [{ name: 'spacing', xml: '<w:spacing w:before="160" w:after="80"/>' }, { name: 'jc', xml: '<w:jc w:val="left"/>' }]
    },
    WFHeading4: {
      run: [font, black, { name: 'b', xml: '<w:b w:val="0"/>' }, { name: 'bCs', xml: '<w:bCs w:val="0"/>' }, { name: 'i', xml: '<w:i/>' }, { name: 'iCs', xml: '<w:iCs/>' }, { name: 'sz', xml: '<w:sz w:val="26"/>' }, { name: 'szCs', xml: '<w:szCs w:val="26"/>' }],
      paragraph: [{ name: 'spacing', xml: '<w:spacing w:before="80" w:after="40"/>' }, { name: 'jc', xml: '<w:jc w:val="left"/>' }]
    },
    WFCaption: {
      run: [font, black, { name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }, { name: 'i', xml: '<w:i/>' }, { name: 'iCs', xml: '<w:iCs/>' }, { name: 'sz', xml: '<w:sz w:val="26"/>' }, { name: 'szCs', xml: '<w:szCs w:val="26"/>' }],
      paragraph: [{ name: 'spacing', xml: '<w:spacing w:before="0" w:after="120" w:line="288" w:lineRule="auto"/>' }, { name: 'jc', xml: '<w:jc w:val="center"/>' }]
    },
    WFCoverInstitution: { run: [font, { name: 'sz', xml: '<w:sz w:val="30"/>' }, { name: 'szCs', xml: '<w:szCs w:val="30"/>' }], paragraph: [{ name: 'jc', xml: '<w:jc w:val="center"/>' }] },
    WFCoverSeparator: { run: [font, { name: 'sz', xml: '<w:sz w:val="30"/>' }, { name: 'szCs', xml: '<w:szCs w:val="30"/>' }], paragraph: [{ name: 'jc', xml: '<w:jc w:val="center"/>' }] },
    WFCoverDocumentType: { run: [font, { name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }, { name: 'sz', xml: '<w:sz w:val="48"/>' }, { name: 'szCs', xml: '<w:szCs w:val="48"/>' }], paragraph: [{ name: 'jc', xml: '<w:jc w:val="center"/>' }] },
    WFCoverCourse: { run: [font, { name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }, { name: 'sz', xml: '<w:sz w:val="28"/>' }, { name: 'szCs', xml: '<w:szCs w:val="28"/>' }], paragraph: [{ name: 'jc', xml: '<w:jc w:val="center"/>' }] },
    WFCoverLabel: { run: [font, { name: 'b', xml: '<w:b w:val="0"/>' }, { name: 'bCs', xml: '<w:bCs w:val="0"/>' }, { name: 'i', xml: '<w:i/>' }, { name: 'iCs', xml: '<w:iCs/>' }, { name: 'sz', xml: '<w:sz w:val="32"/>' }, { name: 'szCs', xml: '<w:szCs w:val="32"/>' }] },
    WFCoverTopic: { run: [font, { name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }, { name: 'sz', xml: '<w:sz w:val="40"/>' }, { name: 'szCs', xml: '<w:szCs w:val="40"/>' }], paragraph: [{ name: 'jc', xml: '<w:jc w:val="center"/>' }] },
    WFCoverMeta: { run: [font, { name: 'sz', xml: '<w:sz w:val="28"/>' }, { name: 'szCs', xml: '<w:szCs w:val="28"/>' }] },
    WFCoverDate: { run: [font, { name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }, { name: 'sz', xml: '<w:sz w:val="28"/>' }, { name: 'szCs', xml: '<w:szCs w:val="28"/>' }], paragraph: [{ name: 'jc', xml: '<w:jc w:val="center"/>' }] },
    WFFrontMatterTitle: { run: [font, black, { name: 'b', xml: '<w:b/>' }, { name: 'bCs', xml: '<w:bCs/>' }, { name: 'sz', xml: '<w:sz w:val="36"/>' }, { name: 'szCs', xml: '<w:szCs w:val="36"/>' }], paragraph: [{ name: 'pageBreakBefore', xml: '<w:pageBreakBefore/>' }, { name: 'jc', xml: '<w:jc w:val="center"/>' }] },
    TableofFigures: { run: [font, black, { name: 'sz', xml: '<w:sz w:val="26"/>' }, { name: 'szCs', xml: '<w:szCs w:val="26"/>' }], paragraph: [] },
    TOC1: { run: [font, black, { name: 'sz', xml: '<w:sz w:val="26"/>' }, { name: 'szCs', xml: '<w:szCs w:val="26"/>' }], paragraph: [] },
    TOC2: { run: [font, black, { name: 'sz', xml: '<w:sz w:val="26"/>' }, { name: 'szCs', xml: '<w:szCs w:val="26"/>' }], paragraph: [] },
    TOC3: { run: [font, black, { name: 'sz', xml: '<w:sz w:val="26"/>' }, { name: 'szCs', xml: '<w:szCs w:val="26"/>' }], paragraph: [] },
    TOC4: { run: [font, black, { name: 'sz', xml: '<w:sz w:val="26"/>' }, { name: 'szCs', xml: '<w:szCs w:val="26"/>' }], paragraph: [] }
  };

  for (const [styleId, rule] of Object.entries(styleRules)) {
    const result = patchStyle(xml, styleId, rule.run, rule.paragraph);
    xml = result.xml;
    if (!result.patched) continue;
    if (styleId === 'WFBody') bodyStyles += 1;
    else if (HEADING_STYLE_IDS.has(styleId)) headingStyles += 1;
    else supportingStyles += 1;
  }

  return { xml, stats: { headingStyles, bodyStyles, supportingStyles } };
}

function escapeXmlText(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function sentenceCaseHeading(value) {
  const normalized = value.trim().toLocaleLowerCase('vi-VN');
  if (!normalized) return normalized;
  return (normalized.charAt(0).toLocaleUpperCase('vi-VN') + normalized.slice(1))
    .replace(/([.!?]\s+)(\p{L})/gu, (fullMatch, prefix, letter) => `${prefix}${letter.toLocaleUpperCase('vi-VN')}`);
}

function setParagraphSpacing(paragraphXml, spacingXml) {
  return ensureParagraphProperties(
    paragraphXml,
    [{ name: 'spacing', xml: spacingXml }],
    '</w:p>'
  );
}

function replaceRunText(runXml, value) {
  return runXml.replace(
    /<w:t\b([^>]*)>[\s\S]*?<\/w:t>/,
    `<w:t$1>${escapeXmlText(value)}</w:t>`
  );
}

function boldCoverMetadataValue(paragraphXml) {
  const text = getParagraphText(paragraphXml);
  const colonIndex = text.indexOf(':');
  const runMatch = paragraphXml.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/);
  if (colonIndex < 0 || !runMatch) return paragraphXml;

  const label = text.slice(0, colonIndex + 1);
  const value = text.slice(colonIndex + 1);
  const labelRun = replaceRunText(runMatch[0], label);
  const valueRun = patchRun(replaceRunText(runMatch[0], value), { bold: true });
  return paragraphXml.replace(runMatch[0], `${labelRun}${valueRun}`);
}

export function normalizeCoverParagraphs(documentXml, options = {}) {
  let firstMetadata = true;
  let labelsRenamed = 0;
  let metadataValuesBolded = 0;

  const xml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    const styleId = getParagraphStyleId(paragraphXml);
    let normalized = paragraphXml;

    if (styleId === 'WFCoverCourse' && options.removeCoverCourse) return '';

    if (styleId === 'WFCoverLabel' && /Tên đề tài:/i.test(getParagraphText(paragraphXml))) {
      normalized = normalized.replace(/Tên đề tài:/gi, 'Tên tiểu luận:');
      labelsRenamed += 1;
    }

    if (styleId === 'WFCoverMeta' && /Sinh viên\/nhóm thực hiện:/i.test(getParagraphText(paragraphXml))) {
      normalized = normalized.replace(/Sinh viên\/nhóm thực hiện:/gi, 'Sinh viên thực hiện:');
    }

    if (styleId === 'WFCoverMeta') {
      if (firstMetadata && !/<w:framePr\b/.test(normalized)) {
        normalized = setParagraphSpacing(normalized, '<w:spacing w:before="2200" w:after="0"/>');
      }
      firstMetadata = false;
      const bolded = boldCoverMetadataValue(normalized);
      if (bolded !== normalized) metadataValuesBolded += 1;
      normalized = bolded;
    }

    if (styleId === 'WFCoverDate') {
      const location = options.location?.trim() || 'Thành phố Hồ Chí Minh';
      const month = options.month?.trim() || '.....';
      const year = options.year?.trim() || '........';
      const runMatch = normalized.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/);
      if (runMatch) normalized = normalized.replace(runMatch[0], replaceRunText(runMatch[0], `${location}, tháng ${month} năm ${year}`));
      if (!/<w:framePr\b/.test(normalized)) {
        normalized = setParagraphSpacing(normalized, '<w:spacing w:before="2600" w:after="0"/>');
      }
    }

    return normalized;
  });

  return { xml, stats: { coverLabelsRenamed: labelsRenamed, coverMetadataValuesBolded: metadataValuesBolded } };
}

function splitTopLevelElements(xml) {
  const elements = [];
  const tagPattern = /<\/?[A-Za-z_][\w:.-]*\b[^>]*>/g;
  let depth = 0;
  let start = -1;
  let match;

  while ((match = tagPattern.exec(xml)) !== null) {
    const tag = match[0];
    const closing = /^<\//.test(tag);
    const selfClosing = /\/>$/.test(tag);

    if (!closing && depth === 0) start = match.index;
    if (closing) depth -= 1;
    else if (!selfClosing) depth += 1;

    if (depth === 0 && start >= 0) {
      elements.push(xml.slice(start, tagPattern.lastIndex));
      start = -1;
    }
  }

  return elements;
}

function rewriteBodyChildren(documentXml, transform) {
  const bodyMatch = documentXml.match(/(<w:body\b[^>]*>)([\s\S]*)(<\/w:body>)/);
  if (!bodyMatch) return { xml: documentXml, stats: {} };
  const children = splitTopLevelElements(bodyMatch[2]);
  const result = transform(children);
  return {
    xml: documentXml.replace(bodyMatch[0], `${bodyMatch[1]}${result.children.join('')}${bodyMatch[3]}`),
    stats: result.stats || {}
  };
}

function frontMatterKey(childXml) {
  if (getParagraphStyleId(childXml) !== 'WFFrontMatterTitle') return '';
  const title = normalizeLookupText(getParagraphText(childXml));
  if (title === 'LOI CAM ON') return 'thanks';
  if (title === 'MUC LUC') return 'toc';
  if (/^DANH MUC (?:CAC )?(?:HINH|HINH ANH|HINH VE)/.test(title)) return 'figures';
  if (/^DANH MUC (?:CAC )?BANG/.test(title)) return 'tables';
  if (/^DANH MUC (?:CAC )?(?:KY HIEU|CHU VIET TAT)/.test(title)) return 'abbreviations';
  return '';
}

function blankSectionFromBoundary(boundaryXml) {
  const sectionProperties = boundaryXml.match(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/)?.[0];
  if (!sectionProperties) return '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';
  const withoutBorder = sectionProperties.replace(/<w:pgBorders\b[^>]*>[\s\S]*?<\/w:pgBorders>/g, '');
  return `<w:p><w:pPr>${withoutBorder}</w:pPr></w:p>`;
}

export function normalizeFrontMatter(documentXml, documentMode = 'digital_document') {
  return rewriteBodyChildren(documentXml, children => {
    let frontMatterReordered = false;
    let bindingPagesInserted = 0;
    let decorativeDrawingsRemoved = 0;
    for (let index = 0; index < children.length; index += 1) {
      if (frontMatterKey(children[index]) !== 'thanks' || !/<w:drawing\b/.test(children[index])) continue;
      children[index] = children[index].replace(/<w:r\b[^>]*>[\s\S]*?<w:drawing\b[\s\S]*?<\/w:drawing>[\s\S]*?<\/w:r>/g, '');
      decorativeDrawingsRemoved += 1;
    }
    const headingIndex = children.findIndex(child => getParagraphStyleId(child) === 'WFHeading1');
    const searchEnd = headingIndex >= 0 ? headingIndex : children.length;
    const starts = [];

    for (let index = 0; index < searchEnd; index += 1) {
      const key = frontMatterKey(children[index]);
      if (key) starts.push({ index, key });
    }

    if (starts.length > 1) {
      const regionStart = starts[0].index;
      const blocks = new Map();
      const boundaries = [];
      for (let blockIndex = 0; blockIndex < starts.length; blockIndex += 1) {
        const start = starts[blockIndex].index;
        const end = starts[blockIndex + 1]?.index ?? searchEnd;
        const block = [];
        for (const child of children.slice(start, end)) {
          if (/<w:sectPr\b/.test(child)) boundaries.push(child);
          else block.push(child);
        }
        blocks.set(starts[blockIndex].key, block);
      }

      const order = ['thanks', 'toc', 'figures', 'tables', 'abbreviations'];
      const reordered = order.flatMap(key => blocks.get(key) || []);
      for (const { key } of starts) {
        if (!order.includes(key)) reordered.push(...(blocks.get(key) || []));
      }
      children.splice(regionStart, searchEnd - regionStart, ...reordered, ...boundaries);
      frontMatterReordered = true;
    }

    if (documentMode === 'binding_package') {
      const coverBoundaryIndex = children.findIndex(child => /<w:sectPr\b/.test(child));
      if (coverBoundaryIndex >= 0) {
        const coverNodes = children.slice(0, coverBoundaryIndex + 1);
        const boundary = coverNodes.at(-1);
        children.splice(coverBoundaryIndex + 1, 0, blankSectionFromBoundary(boundary), ...coverNodes);
        bindingPagesInserted = 2;
      }
    }

    return { children, stats: { frontMatterReordered, bindingPagesInserted, decorativeDrawingsRemoved } };
  });
}

function normalizeSectionProperty(sectionXml, propertyName, replacement) {
  const pattern = new RegExp(`<w:${propertyName}\\b[^>]*(?:\\/>|>[\\s\\S]*?<\\/w:${propertyName}>)`, 'g');
  if (pattern.test(sectionXml)) return sectionXml.replace(pattern, replacement);
  return sectionXml.replace('</w:sectPr>', `${replacement}</w:sectPr>`);
}

export function normalizeSectionProperties(documentXml, documentMode = 'digital_document') {
  let sectionIndex = 0;
  let sectionsNormalized = 0;
  const coverSectionIndexes = documentMode === 'binding_package' ? new Set([0, 2]) : new Set([0]);

  const xml = documentXml.replace(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g, sectionXml => {
    let normalized = normalizeSectionProperty(
      sectionXml,
      'pgSz',
      '<w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>'
    );
    normalized = normalizeSectionProperty(
      normalized,
      'pgMar',
      '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701" w:header="720" w:footer="720" w:gutter="0"/>'
    );
    normalized = normalized.replace(/<w:pgBorders\b[^>]*>[\s\S]*?<\/w:pgBorders>/g, '');
    if (coverSectionIndexes.has(sectionIndex)) {
      const pageBorder = '<w:pgBorders w:offsetFrom="page"><w:top w:val="single" w:sz="8" w:space="18" w:color="000000"/><w:left w:val="single" w:sz="8" w:space="18" w:color="000000"/><w:bottom w:val="single" w:sz="8" w:space="18" w:color="000000"/><w:right w:val="single" w:sz="8" w:space="18" w:color="000000"/></w:pgBorders>';
      normalized = normalized.replace(/(<w:pgMar\b[^>]*\/>)/, `$1${pageBorder}`);
    }
    sectionIndex += 1;
    sectionsNormalized += 1;
    return normalized;
  });

  return { xml, stats: { sectionsNormalized } };
}

function centerTable(tableXml) {
  const alignment = '<w:jc w:val="center"/>';
  if (/<w:tblPr\b[^>]*>/.test(tableXml)) {
    if (/<w:jc\b[^>]*\/>/.test(tableXml)) return tableXml.replace(/<w:jc\b[^>]*\/>/, alignment);
    return tableXml.replace(/<w:tblPr\b([^>]*)>/, `<w:tblPr$1>${alignment}`);
  }
  return tableXml.replace(/^(<w:tbl\b[^>]*>)/, `$1<w:tblPr>${alignment}</w:tblPr>`);
}

export function normalizeTablesAndDrawings(documentXml) {
  let tablesCentered = 0;
  let wideTablesDetected = 0;
  let drawingParagraphsCentered = 0;
  let anchoredImagesWrapped = 0;
  let xml = documentXml.replace(/<w:tbl\b[^>]*>[\s\S]*?<\/w:tbl>/g, tableXml => {
    const gridWidth = [...tableXml.matchAll(/<w:gridCol\b[^>]*w:w="(\d+)"[^>]*\/>/g)]
      .reduce((total, match) => total + Number(match[1]), 0);
    if (gridWidth > 9071) wideTablesDetected += 1;
    tablesCentered += 1;
    return centerTable(tableXml);
  });

  xml = xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    if (!/<w:drawing\b/.test(paragraphXml)) return paragraphXml;
    drawingParagraphsCentered += 1;
    let normalized = setParagraphAlignment(paragraphXml, 'center');
    normalized = normalized.replace(/<wp:anchor\b[^>]*>[\s\S]*?<\/wp:anchor>/g, anchorXml => {
      const withoutWrap = anchorXml.replace(/<wp:wrap(?:None|Square|Tight|Through|TopAndBottom)\b[^>]*(?:\/>|>[\s\S]*?<\/wp:wrap(?:None|Square|Tight|Through|TopAndBottom)>)/g, '');
      anchoredImagesWrapped += 1;
      return withoutWrap.replace(/(<wp:positionV\b[^>]*>[\s\S]*?<\/wp:positionV>)/, '$1<wp:wrapTopAndBottom/>');
    });
    return normalized;
  });

  return { xml, stats: { tablesCentered, wideTablesDetected, drawingParagraphsCentered, anchoredImagesWrapped } };
}

export function normalizeCaptionPositions(documentXml) {
  return rewriteBodyChildren(documentXml, children => {
    let tableCaptionsMoved = 0;
    let figureCaptionsMoved = 0;
    for (let index = 0; index < children.length; index += 1) {
      if (getParagraphStyleId(children[index]) !== 'WFCaption') continue;
      const text = normalizeLookupText(getParagraphText(children[index]));
      if (text.startsWith('BANG ') && /<w:tbl\b/.test(children[index - 1] || '') && !/<w:tbl\b/.test(children[index + 1] || '')) {
        [children[index - 1], children[index]] = [children[index], children[index - 1]];
        tableCaptionsMoved += 1;
      } else if (text.startsWith('HINH ') && /<w:drawing\b/.test(children[index + 1] || '') && !/<w:drawing\b/.test(children[index - 1] || '')) {
        [children[index], children[index + 1]] = [children[index + 1], children[index]];
        figureCaptionsMoved += 1;
        index += 1;
      }
    }
    return { children, stats: { tableCaptionsMoved, figureCaptionsMoved } };
  });
}

function relationshipTargets(relationshipsXml) {
  const targets = new Map();
  for (const match of relationshipsXml.matchAll(/<Relationship\b([^>]*)\/>/g)) {
    const id = match[1].match(/\bId="([^"]+)"/)?.[1];
    const target = match[1].match(/\bTarget="([^"]+)"/)?.[1];
    if (id && target) targets.set(id, target.startsWith('word/') ? target : `word/${target}`);
  }
  return targets;
}

export function mapHeadersToSectionTitles(documentXml, relationshipsXml) {
  const targets = relationshipTargets(relationshipsXml);
  const mappings = new Map();
  let currentHeading = '';
  const bodyMatch = documentXml.match(/<w:body\b[^>]*>([\s\S]*)<\/w:body>/);
  if (!bodyMatch) return mappings;

  for (const child of splitTopLevelElements(bodyMatch[1])) {
    if (getParagraphStyleId(child) === 'WFHeading1') currentHeading = getParagraphText(child);
    if (!/<w:sectPr\b/.test(child) || !currentHeading) continue;
    for (const reference of child.matchAll(/<w:headerReference\b[^>]*r:id="([^"]+)"[^>]*\/>/g)) {
      const target = targets.get(reference[1]);
      if (target) mappings.set(target, currentHeading);
    }
  }
  return mappings;
}

function replaceHeaderText(headerXml, documentTitle, sectionTitle) {
  const values = [documentTitle, sentenceCaseHeading(sectionTitle)];
  let index = 0;
  return headerXml.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/g, (fullMatch, open, close) => {
    if (index >= values.length) return fullMatch;
    const value = values[index];
    index += 1;
    return `${open}${escapeXmlText(value)}${close}`;
  });
}

export function normalizeAcademicHeader(headerXml, templateXml, documentTitle, sectionTitle) {
  let normalized = headerXml;
  if ((normalized.match(/<w:t\b/g) || []).length < 2 && templateXml) normalized = templateXml;
  normalized = replaceHeaderText(normalized, documentTitle, sectionTitle);
  normalized = normalized.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, runXml => patchRun(runXml, {
    fontName: 'Times New Roman',
    sizeHalfPoints: 20
  }));
  return normalized;
}

function auditCompliance(documentXml, stylesXml, stats) {
  const sections = documentXml.match(/<w:sectPr\b[^>]*>[\s\S]*?<\/w:sectPr>/g) || [];
  const a4Portrait = sections.every(section => /<w:pgSz\b[^>]*w:w="11906"[^>]*w:h="16838"[^>]*w:orient="portrait"/.test(section));
  const margins = sections.every(section => /<w:pgMar\b[^>]*w:top="1134"[^>]*w:right="1134"[^>]*w:bottom="1134"[^>]*w:left="1701"/.test(section));
  const bodyStyle = stylesXml.match(/<w:style\b(?=[^>]*w:styleId="WFBody")[^>]*>[\s\S]*?<\/w:style>/)?.[0] || '';
  const bodySpacing = /<w:spacing\b[^>]*w:before="120"[^>]*w:after="0"[^>]*w:line="288"/.test(bodyStyle);
  return {
    a4Portrait,
    margins,
    bodySpacing,
    listsPreserved: stats.listParagraphsConverted === 0,
    referenceHyperlinksRemoved: stats.hyperlinksRemoved >= 0 && stats.remainingReferenceHyperlinks === 0,
    smartQuotesPreserved: stats.straightQuotesReplaced === 0,
    longDashesNormalized: !/[–—]/.test(documentXml),
    wideTablesFitPortrait: stats.wideTablesDetected === 0
  };
}

/**
 * Enforce output-only rules that must not depend on the source document's
 * direct formatting or on Word theme defaults.
 */
export function normalizeFormattedDocx(docxPath, options = {}) {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`Không tìm thấy DOCX để hậu xử lý: ${docxPath}`);
  }

  const archive = new AdmZip(docxPath);
  const numberingXml = archive.getEntry('word/numbering.xml')?.getData().toString('utf8') || '';
  let sourceStylesXml = archive.getEntry('word/styles.xml')?.getData().toString('utf8') || '';
  let documentXml = archive.getEntry('word/document.xml')?.getData().toString('utf8') || '';
  let relationshipsXml = archive.getEntry('word/_rels/document.xml.rels')?.getData().toString('utf8') || '';
  const inlineEmphasis = collectInlineEmphasis(options.sourcePath);
  const listContext = buildListContext(numberingXml, sourceStylesXml);
  const documentTitle = options.documentTitle?.trim() || 'TIỂU LUẬN MÔN HỌC';
  const documentMode = options.documentMode === 'binding_package' ? 'binding_package' : 'digital_document';
  const stats = {
    enDashesReplaced: 0,
    straightQuotesReplaced: 0,
    headingStyles: 0,
    headingParagraphs: 0,
    headingRuns: 0,
    bodyStyles: 0,
    bodyParagraphs: 0,
    bodyRunsNormalized: 0,
    listParagraphsConverted: 0,
    automaticListsConverted: 0,
    manualListsConverted: 0,
    listsPreserved: true,
    referenceHeadingsNormalized: 0,
    referenceEntriesNormalized: 0,
    referenceContinuationParagraphsNormalized: 0,
    referenceHeadersCleared: 0,
    hyperlinksRemoved: 0,
    hyperlinkFieldsRemoved: 0,
    hyperlinkRelationshipsRemoved: 0,
    remainingReferenceHyperlinks: 0,
    headersNormalized: 0,
    frontMatterReordered: false,
    bindingPagesInserted: 0,
    sectionsNormalized: 0,
    tablesCentered: 0,
    drawingParagraphsCentered: 0,
    anchoredImagesWrapped: 0,
    tableCaptionsMoved: 0,
    figureCaptionsMoved: 0,
    coverLabelsRenamed: 0,
    coverMetadataValuesBolded: 0,
    supportingStyles: 0
  };

  if (!documentXml) throw new Error('DOCX không có word/document.xml.');

  const documentDashResult = replaceEnDashes(documentXml);
  documentXml = documentDashResult.xml;
  stats.enDashesReplaced += documentDashResult.replacements;

  const emphasisResult = restoreInlineEmphasis(documentXml, inlineEmphasis);
  documentXml = emphasisResult.xml;
  Object.assign(stats, emphasisResult.stats);

  const listResult = normalizeAcademicLists(documentXml, listContext);
  documentXml = listResult.xml;
  Object.assign(stats, listResult.stats);

  const referenceResult = normalizeReferenceSection(documentXml);
  documentXml = referenceResult.xml;
  Object.assign(stats, referenceResult.stats);

  const majorHeadingResult = normalizeMajorSectionHeadings(documentXml);
  documentXml = majorHeadingResult.xml;
  Object.assign(stats, majorHeadingResult.stats);

  const hyperlinkResult = stripReferenceHyperlinks(documentXml);
  documentXml = hyperlinkResult.xml;
  Object.assign(stats, hyperlinkResult.stats);

  const documentResult = processDocumentXml(documentXml);
  documentXml = documentResult.xml;
  Object.assign(stats, documentResult.stats);

  const coverResult = normalizeCoverParagraphs(documentXml, {
    removeCoverCourse: Boolean(options.removeCoverCourse),
    location: options.location,
    month: options.month,
    year: options.year
  });
  documentXml = coverResult.xml;
  Object.assign(stats, coverResult.stats);

  const frontMatterResult = normalizeFrontMatter(documentXml, documentMode);
  documentXml = frontMatterResult.xml;
  Object.assign(stats, frontMatterResult.stats);

  const captionResult = normalizeCaptionPositions(documentXml);
  documentXml = captionResult.xml;
  Object.assign(stats, captionResult.stats);

  const objectResult = normalizeTablesAndDrawings(documentXml);
  documentXml = objectResult.xml;
  Object.assign(stats, objectResult.stats);

  const sectionResult = normalizeSectionProperties(documentXml, documentMode);
  documentXml = sectionResult.xml;
  Object.assign(stats, sectionResult.stats);

  const relationshipResult = removeUnusedHyperlinkRelationships(
    relationshipsXml,
    hyperlinkResult.removedRelationshipIds,
    documentXml
  );
  relationshipsXml = relationshipResult.xml;
  stats.hyperlinkRelationshipsRemoved = relationshipResult.relationshipsRemoved;
  stats.remainingReferenceHyperlinks = stripReferenceHyperlinks(documentXml).stats.hyperlinksRemoved;

  const stylesResult = processStylesXml(sourceStylesXml);
  sourceStylesXml = stylesResult.xml;
  Object.assign(stats, stylesResult.stats);

  archive.updateFile('word/document.xml', Buffer.from(documentXml, 'utf8'));
  archive.updateFile('word/styles.xml', Buffer.from(sourceStylesXml, 'utf8'));
  if (relationshipsXml) {
    archive.updateFile('word/_rels/document.xml.rels', Buffer.from(relationshipsXml, 'utf8'));
  }

  const headerMappings = mapHeadersToSectionTitles(documentXml, relationshipsXml);
  const headerEntries = archive.getEntries().filter(entry => /^word\/[^/]*header[^/]*\.xml$/i.test(entry.entryName));
  const defaultTemplate = headerEntries.find(entry => /Default\.xml$/i.test(entry.entryName) && (entry.getData().toString('utf8').match(/<w:t\b/g) || []).length >= 2)?.getData().toString('utf8') || '';
  const evenTemplate = headerEntries.find(entry => /Even\.xml$/i.test(entry.entryName) && (entry.getData().toString('utf8').match(/<w:t\b/g) || []).length >= 2)?.getData().toString('utf8') || defaultTemplate;

  for (const entry of archive.getEntries()) {
    if (entry.isDirectory || !TEXT_PART_PATTERN.test(entry.entryName)) continue;
    if (entry.entryName === 'word/document.xml' || entry.entryName === 'word/styles.xml') continue;

    let xml = entry.getData().toString('utf8');
    const dashResult = replaceEnDashes(xml);
    xml = dashResult.xml;
    stats.enDashesReplaced += dashResult.replacements;

    if (/^word\/[^/]*header[^/]*\.xml$/i.test(entry.entryName)) {
      const sectionTitle = headerMappings.get(entry.entryName);
      if (sectionTitle) {
        const template = /Even\.xml$/i.test(entry.entryName) ? evenTemplate : defaultTemplate;
        xml = normalizeAcademicHeader(xml, template, documentTitle, sectionTitle);
        stats.headersNormalized += 1;
      }
    }

    archive.updateFile(entry.entryName, Buffer.from(xml, 'utf8'));
  }

  stats.compliance = auditCompliance(documentXml, sourceStylesXml, stats);

  writeArchiveAtomically(archive, docxPath);

  return stats;
}
