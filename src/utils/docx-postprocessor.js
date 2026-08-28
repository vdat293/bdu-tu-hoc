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

function patchRun(runXml, {
  black = false,
  bold = false,
  notBold = false,
  notItalic = false,
  sizeHalfPoints = null
}) {
  const properties = [];
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
  const stats = {
    listParagraphsConverted: 0,
    automaticListsConverted: 0,
    manualListsConverted: 0
  };
  let sequenceNumber = 0;
  let previousWasList = false;

  const xml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    const directReference = getNumberingReference(paragraphXml);
    const paragraphStyleId = getParagraphStyleId(paragraphXml);
    const styleReference = listContext.styleReferences.get(paragraphStyleId);
    const reference = directReference || styleReference;
    const text = getFirstTextValue(paragraphXml);
    const manualMarker = text.match(/^\s*(?:[•◦▪‣●○■◆◇]|[-+]|(\d+)[.)])\s+/u);
    const format = reference
      ? listContext.numberingDefinitions.get(reference.numId)?.get(reference.level)
      : '';
    const headingLike = HEADING_STYLE_IDS.has(paragraphStyleId)
      || /^Heading\d+$/i.test(paragraphStyleId)
      || /^\s*\d+(?:\.\d+)+\.?\s+/.test(text)
      || /^\s*CHƯƠNG\s+\d+/i.test(text);
    const automaticList = Boolean(reference && format && format !== 'none');
    const isList = !headingLike && Boolean(text) && (automaticList || manualMarker);

    if (!isList) {
      previousWasList = false;
      sequenceNumber = 0;
      return paragraphXml;
    }

    const manualNumber = Number(manualMarker?.[1] || 0);
    if (!previousWasList) sequenceNumber = manualNumber || 1;
    else sequenceNumber = manualNumber || sequenceNumber + 1;

    const marker = `${sequenceNumber})`;
    let normalized = stripListParagraphFormatting(paragraphXml);
    normalized = replaceFirstTextValue(normalized, marker);

    stats.listParagraphsConverted += 1;
    if (automaticList) stats.automaticListsConverted += 1;
    else stats.manualListsConverted += 1;
    previousWasList = true;
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
  let referenceNumber = 0;
  let hasReferenceEntry = false;

  const xml = documentXml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, paragraphXml => {
    const text = getParagraphText(paragraphXml);
    const lookupText = normalizeLookupText(text).replace(/[.:]+$/, '');
    const styleId = getParagraphStyleId(paragraphXml);
    const isReferenceHeading = lookupText === 'TAI LIEU THAM KHAO' || lookupText === 'REFERENCES';

    if (isReferenceHeading) {
      insideReferences = true;
      referenceNumber = 0;
      hasReferenceEntry = false;

      let normalized = stripListParagraphFormatting(paragraphXml);
      normalized = setParagraphStyle(normalized, 'WFHeading1');
      normalized = setParagraphAlignment(normalized, 'center');
      normalized = patchParagraphRuns(normalized, {
        black: true,
        bold: true,
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

    const hasReferenceMarker = /^\s*(?:\[\d+\]|\d+[.)])\s*/.test(text);
    const startsNewEntry = hasReferenceMarker || !hasReferenceEntry;
    let normalized = stripListParagraphFormatting(paragraphXml);
    normalized = setParagraphStyle(normalized, 'WFBody');
    normalized = setParagraphAlignment(normalized, 'left');

    if (startsNewEntry) {
      referenceNumber += 1;
      normalized = replaceReferenceMarker(normalized, referenceNumber);
      hasReferenceEntry = true;
      stats.referenceEntriesNormalized += 1;
    } else {
      stats.referenceContinuationParagraphsNormalized += 1;
    }

    return patchParagraphRuns(normalized, {
      black: true,
      notBold: true,
      sizeHalfPoints: 26
    });
  });

  return { xml, stats };
}

export function normalizeReferenceHeader(headerXml) {
  const text = getParagraphText(headerXml);
  const lookupText = normalizeLookupText(text);
  if (!lookupText.includes('TAI LIEU THAM KHAO') && !lookupText.includes('REFERENCES')) {
    return { xml: headerXml, cleared: false };
  }

  return {
    xml: headerXml.replace(/(<w:hdr\b[^>]*>)[\s\S]*?(<\/w:hdr>)/, '$1<w:p/>$2'),
    cleared: true
  };
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
  const listResult = normalizeAcademicLists(documentEntry.getData().toString('utf8'), listContext);
  const referenceResult = normalizeReferenceSection(listResult.xml);
  archive.updateFile('word/document.xml', Buffer.from(referenceResult.xml, 'utf8'));
  writeArchiveAtomically(archive, outputPath);
  return { ...listResult.stats, ...referenceResult.stats };
}

export function replaceEnDashes(xml) {
  const matches = xml.match(/–/g);
  return {
    xml: xml.replaceAll('–', '-'),
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

    if (!isHeading && !isBody) return paragraphXml;

    if (isHeading) stats.headingParagraphs += 1;
    if (isBody) stats.bodyParagraphs += 1;

    return paragraphXml.replace(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/g, runXml => {
      if (isHeading) stats.headingRuns += 1;
      if (isBody) stats.bodyRunsNormalized += 1;
      return patchRun(runXml, { black: isHeading, notBold: isBody });
    });
  });

  return { xml, stats };
}

function patchStyle(stylesXml, styleId, properties) {
  const stylePattern = new RegExp(
    `<w:style\\b(?=[^>]*\\bw:styleId="${escapeRegExp(styleId)}")[^>]*>[\\s\\S]*?<\\/w:style>`,
    'g'
  );

  let patched = false;
  const xml = stylesXml.replace(stylePattern, styleXml => {
    patched = true;
    return ensureRunProperties(styleXml, properties, '</w:style>');
  });

  return { xml, patched };
}

export function processStylesXml(stylesXml) {
  let xml = stylesXml;
  let headingStyles = 0;
  let bodyStyles = 0;

  for (const styleId of HEADING_STYLE_IDS) {
    const result = patchStyle(xml, styleId, [
      { name: 'color', xml: '<w:color w:val="000000"/>' }
    ]);
    xml = result.xml;
    if (result.patched) headingStyles += 1;
  }

  for (const styleId of BODY_STYLE_IDS) {
    const result = patchStyle(xml, styleId, [
      { name: 'b', xml: '<w:b w:val="0"/>' },
      { name: 'bCs', xml: '<w:bCs w:val="0"/>' }
    ]);
    xml = result.xml;
    if (result.patched) bodyStyles += 1;
  }

  return { xml, stats: { headingStyles, bodyStyles } };
}

/**
 * Enforce output-only rules that must not depend on the source document's
 * direct formatting or on Word theme defaults.
 */
export function normalizeFormattedDocx(docxPath) {
  if (!fs.existsSync(docxPath)) {
    throw new Error(`Không tìm thấy DOCX để hậu xử lý: ${docxPath}`);
  }

  const archive = new AdmZip(docxPath);
  const numberingXml = archive.getEntry('word/numbering.xml')?.getData().toString('utf8') || '';
  const sourceStylesXml = archive.getEntry('word/styles.xml')?.getData().toString('utf8') || '';
  const listContext = buildListContext(numberingXml, sourceStylesXml);
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
    referenceHeadingsNormalized: 0,
    referenceEntriesNormalized: 0,
    referenceContinuationParagraphsNormalized: 0,
    referenceHeadersCleared: 0
  };

  for (const entry of archive.getEntries()) {
    if (entry.isDirectory || !TEXT_PART_PATTERN.test(entry.entryName)) continue;

    let xml = entry.getData().toString('utf8');
    const dashResult = replaceEnDashes(xml);
    xml = dashResult.xml;
    stats.enDashesReplaced += dashResult.replacements;

    const quoteResult = replaceStraightDoubleQuotes(xml);
    xml = quoteResult.xml;
    stats.straightQuotesReplaced += quoteResult.replacements;

    if (entry.entryName === 'word/document.xml') {
      const listResult = normalizeAcademicLists(xml, listContext);
      xml = listResult.xml;
      Object.assign(stats, listResult.stats);

      const referenceResult = normalizeReferenceSection(xml);
      xml = referenceResult.xml;
      Object.assign(stats, referenceResult.stats);

      const documentResult = processDocumentXml(xml);
      xml = documentResult.xml;
      Object.assign(stats, {
        headingParagraphs: documentResult.stats.headingParagraphs,
        headingRuns: documentResult.stats.headingRuns,
        bodyParagraphs: documentResult.stats.bodyParagraphs,
        bodyRunsNormalized: documentResult.stats.bodyRunsNormalized
      });
    } else if (entry.entryName === 'word/styles.xml') {
      const stylesResult = processStylesXml(xml);
      xml = stylesResult.xml;
      stats.headingStyles = stylesResult.stats.headingStyles;
      stats.bodyStyles = stylesResult.stats.bodyStyles;
    } else if (/^word\/[^/]*header[^/]*\.xml$/i.test(entry.entryName)) {
      const headerResult = normalizeReferenceHeader(xml);
      xml = headerResult.xml;
      if (headerResult.cleared) stats.referenceHeadersCleared += 1;
    }

    archive.updateFile(entry.entryName, Buffer.from(xml, 'utf8'));
  }

  writeArchiveAtomically(archive, docxPath);

  return stats;
}
