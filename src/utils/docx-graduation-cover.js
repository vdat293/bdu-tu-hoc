import fs from 'node:fs';
import {load} from 'cheerio';

const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const tag=n=>`w\\:${n}`;
const esc=s=>String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const key=s=>s.normalize('NFD').replace(/\p{M}/gu,'').replace(/[đĐ]/g,'D').toUpperCase().replace(/\s+/g,' ').trim();
const text=($,e)=>$(e).find(tag('t')).text().replace(/\s+/g,' ').trim();
const run=(s,size,bold=false,italic=false)=>{
  const halfPts = Math.round(size * 2);
  return `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:b w:val="${+bold}"/><w:i w:val="${+italic}"/><w:color w:val="000000"/><w:sz w:val="${halfPts}"/><w:szCs w:val="${halfPts}"/></w:rPr><w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;
};
const paragraph=(content,{size=14,bold=false,italic=false,before=0,after=0,align='center',indentDxa=0,first=false,raw=false}={})=>`<w:p><w:pPr><w:pStyle w:val="${first?'WFCoverStart':'WFGraduationCover'}"/><w:keepNext w:val="0"/><w:keepLines/><w:pageBreakBefore w:val="0"/><w:spacing w:before="${Math.round(before*20)}" w:after="${Math.round(after*20)}" w:line="240" w:lineRule="auto"/><w:ind w:left="${indentDxa}" w:right="${indentDxa}" w:firstLine="0"/><w:jc w:val="${align}"/></w:pPr>${raw?content:run(content,size,bold,italic)}</w:p>`;

const BOLD_UPPER_EM = {
  I: 0.389, J: 0.500, F: 0.611, L: 0.667, P: 0.611, S: 0.556,
  B: 0.667, E: 0.667, T: 0.667, Z: 0.667,
  A: 0.722, C: 0.722, D: 0.722, N: 0.722, R: 0.722, U: 0.722, V: 0.722, X: 0.722, Y: 0.722,
  G: 0.778, H: 0.778, K: 0.778, O: 0.778, Q: 0.778,
  M: 0.944, W: 1.000,
  ' ': 0.250, ',': 0.250, '.': 0.250, ':': 0.333, ';': 0.333,
  '-': 0.333, '/': 0.278, '(': 0.333, ')': 0.333, '&': 0.833
};

export function estimateBoldUpperWidthPt(textStr, sizePt) {
  const base = String(textStr || '').normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'D').toUpperCase();
  let em = 0;
  for (const ch of base) {
    em += BOLD_UPPER_EM[ch] ?? (/\d/.test(ch) ? 0.500 : 0.722);
  }
  return em * sizePt;
}

function wrapGreedyUpperBold(words, sizePt, limitPt) {
  const spacePt = 0.25 * sizePt;
  const lines = [];
  let curWords = [];
  let curWidth = 0;
  for (const word of words) {
    const wPt = estimateBoldUpperWidthPt(word, sizePt);
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

/**
 * Prevent an ugly 1-word orphan ("chỉ 1 chữ nhảy xuống hàng") on centered
 * multi-line titles without mutating text characters: narrows symmetric
 * left/right paragraph indents just enough to pull companion words onto the
 * final line while keeping the same total line count and exact center axis.
 */
export function computeBalancedCenteredWrap(textStr, sizePt, printableWidthDxa) {
  const words = String(textStr || '').trim().split(/\s+/).filter(Boolean);
  const fullWidthPt = printableWidthDxa / 20;
  const effectiveMaxPt = Math.max(180, fullWidthPt - 10);
  if (words.length < 4) {
    const baseLines = wrapGreedyUpperBold(words, sizePt, effectiveMaxPt);
    return { indentDxa: 0, lineCount: Math.max(1, baseLines.length) };
  }
  const initialLines = wrapGreedyUpperBold(words, sizePt, effectiveMaxPt);
  if (initialLines.length <= 1) {
    return { indentDxa: 0, lineCount: 1 };
  }
  const lastLine = initialLines.at(-1);
  const prevLine = initialLines.at(-2);
  const isSingleWordOrphan = lastLine.words.length === 1;
  const isTinyTwoWordOrphan = lastLine.words.length === 2
    && words.length >= 7
    && lastLine.widthPt < effectiveMaxPt * 0.22
    && prevLine.widthPt > effectiveMaxPt * 0.78;
  if (!isSingleWordOrphan && !isTinyTwoWordOrphan) {
    return { indentDxa: 0, lineCount: initialLines.length };
  }

  const minTargetWords = words.length >= 6 ? 3 : 2;
  let fallbackIndent = 0;
  for (let limitPt = Math.floor(effectiveMaxPt - 8); limitPt >= Math.floor(effectiveMaxPt * 0.56); limitPt -= 4) {
    const candidate = wrapGreedyUpperBold(words, sizePt, limitPt);
    if (candidate.length > initialLines.length) break;
    const candLast = candidate.at(-1);
    if (candLast.words.length >= 2 && !fallbackIndent) {
      fallbackIndent = Math.max(0, Math.round(((fullWidthPt - limitPt) / 2) * 20));
    }
    if (candLast.words.length >= minTargetWords || candLast.widthPt >= limitPt * 0.30) {
      return {
        indentDxa: Math.max(0, Math.round(((fullWidthPt - limitPt) / 2) * 20)),
        lineCount: candidate.length
      };
    }
  }
  return { indentDxa: fallbackIndent, lineCount: initialLines.length };
}

function fitCoverOrgLine(textStr, printableWidthDxa, baseSizePt = 15) {
  const safeOneLinePt = (printableWidthDxa / 20) - 26;
  const candidates = [baseSizePt, 14.5, 14, 13.5, 13, 12.5, 12].filter(sz => sz <= baseSizePt);
  for (const sz of candidates) {
    if (estimateBoldUpperWidthPt(textStr, sz) <= safeOneLinePt) {
      return { size: sz, indentDxa: 0, lineCount: 1 };
    }
  }
  const fallbackSize = 12;
  const balanced = computeBalancedCenteredWrap(textStr, fallbackSize, printableWidthDxa);
  return { size: fallbackSize, indentDxa: balanced.indentDxa, lineCount: balanced.lineCount };
}

export function getCurrentMonthYear(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Ho_Chi_Minh',
      month: 'numeric',
      year: 'numeric'
    }).formatToParts(now);
    const month = parts.find(p => p.type === 'month')?.value;
    const year = parts.find(p => p.type === 'year')?.value;
    if (month && year) return { month: String(Number(month)), year };
  } catch { /* fallback to system clock */ }
  return {
    month: String(now.getMonth() + 1),
    year: String(now.getFullYear())
  };
}

export function readCoverMetadata(source) {
  const labels=/(?:GVHD|NGƯỜI HƯỚNG DẪN|GIẢNG VIÊN HƯỚNG DẪN|SVTH|SINH VIÊN THỰC HIỆN|MSSV|MÃ SỐ SINH VIÊN|LỚP(?: SINH HOẠT)?)\s*:/giu;
  const matches=[...source.matchAll(labels)], result={};
  for(let i=0;i<matches.length;i++) {
    const m=matches[i], value=source.slice(m.index+m[0].length,matches[i+1]?.index ?? source.length).trim();
    const label=key(m[0]);
    if(/GVHD|HUONG DAN/.test(label))result.instructor=value;
    else if(/SVTH|SINH VIEN THUC HIEN/.test(label)) {
      const parts=value.split(/\s*[–—]\s*|\s+-\s+/u);
      result.student=parts[0]?.trim() || '';
      if(parts.length >= 3) {
        result.studentId = parts[1]?.trim() || '';
        result.className = parts.slice(2).join(' - ').trim();
      } else if(parts.length === 2) {
        if (/^\d+$/.test(parts[1].trim())) result.studentId = parts[1].trim();
        else result.className = parts[1].trim();
      }
    } else if(/MSSV|MA SO/.test(label))result.studentId=value.trim();
    else if(/LOP/.test(label))result.className=value.trim();
  }
  return result;
}

function defaultLogo(archive,id) {
  const rels=load(archive.readAsText('word/_rels/document.xml.rels'),{xml:true});
  let relId='wfGraduationLogo';
  let existing=rels('Relationship').filter((_,e)=>rels(e).attr('Target')==='media/wf-bdu-cover-logo.png');
  if(existing.length)relId=existing.attr('Id');
  else {
    let n=0;while(rels('Relationship').toArray().some(e=>rels(e).attr('Id')===relId))relId=`wfGraduationLogo${++n}`;
    rels('Relationships').append(`<Relationship Id="${relId}" Type="${R}/image" Target="media/wf-bdu-cover-logo.png"/>`);
    archive.updateFile('word/_rels/document.xml.rels',Buffer.from(rels.xml()));
    let logoBuf;
    try {
      logoBuf = fs.readFileSync(new URL('../../public/assets/images/logo-hao-quang-transparent.png', import.meta.url));
    } catch {
      logoBuf = fs.readFileSync(new URL('../../assets/wordfmt/bdu-cover-logo.png', import.meta.url));
    }
    archive.addFile('word/media/wf-bdu-cover-logo.png', logoBuf);
  }
  const types=load(archive.readAsText('[Content_Types].xml'),{xml:true});
  if(!types('Default').toArray().some(e=>types(e).attr('Extension')==='png')) {
    types('Types').append('<Default Extension="png" ContentType="image/png"/>');
    archive.updateFile('[Content_Types].xml',Buffer.from(types.xml()));
  }
  return `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1260000" cy="1260000"/><wp:docPr id="${id}" name="Logo Đại học Bình Dương"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Logo BDU"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="${R}" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1260000" cy="1260000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function formatInstructor(raw) {
  if (!raw) return '……………………';
  let clean = String(raw).split(/[\r\n]+/)[0].replace(/^(?:GVHD|NGƯỜI HƯỚNG DẪN|GIẢNG VIÊN HƯỚNG DẪN)\s*:\s*/i, '').trim();
  const m = clean.match(/^((?:PGS\.|GS\.|TS\.|ThS\.|Th\.S\.|ThS|TS|CN\.|KTS\.|Thạc sĩ|Tiến sĩ)\s*)+(.*)$/i);
  if (m) {
    const prefix = m[1].trim();
    const name = m[2].trim().toUpperCase();
    return `${prefix} ${name}`;
  }
  return clean.toUpperCase();
}

function formatStudentName(raw) {
  if (!raw) return '……………………';
  return String(raw).split(/[\r\n]+/)[0].replace(/^(?:SVTH|SINH VIÊN THỰC HIỆN)\s*:\s*/i, '').trim().toUpperCase();
}

function formatStudentId(raw) {
  if (!raw) return '……………………';
  return String(raw).split(/[\r\n]+/)[0].replace(/^(?:MSSV|MÃ SỐ SINH VIÊN|MÃ SỐ SV)\s*:\s*/i, '').trim();
}

function formatClassName(raw) {
  if (!raw) return '……………………';
  let clean = String(raw).split(/[\r\n]+/)[0].replace(/^(?:LỚP|LỚP SINH HOẠT)\s*:\s*/i, '').trim();
  clean = clean.replace(/\s*(?:[-–—]\s*)?(?:THÀNH PHỐ|TP\.?|THÁNG\b|NĂM\b).*$/iu, '').trim();
  return (clean || '……………………').toUpperCase();
}

export function formatGraduationCovers(analysis,covers,boundary,options) {
  const {$,body,archive}=analysis;
  let id=Math.max(0,...$('wp\\:docPr').toArray().map(e=>Number($(e).attr('id'))||0));
  const children=body.children().toArray();
  const groups=covers.map((e,i)=>children.slice(children.indexOf(e),i+1<covers.length?children.indexOf(covers[i+1]):boundary?children.indexOf(boundary):children.length-1));
  for(const nodes of groups) {
    const paras=nodes.flatMap(e=>e.name==='w:p'?[e]:$(e).find(tag('p')).toArray());
    const lines=nodes.filter(e=>e.name==='w:p').map(e=>text($,e)).filter(Boolean);
    const institution=(lines.find(s=>/^TRUONG\b/.test(key(s))) || options.institution || options.profile?.cover?.institution || 'TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG').trim();
    let institute=(lines.find(s=>/^VIEN\b/.test(key(s))) || options.institute || options.profile?.cover?.institute || '').trim();
    const faculty=(lines.find(s=>/^KHOA\b/.test(key(s))) || options.faculty || options.profile?.cover?.faculty || 'KHOA CÔNG NGHỆ THÔNG TIN, ROBOT VÀ TRÍ TUỆ NHÂN TẠO').replace(/---oOo---|---o0o---/gi,'').trim();
    if (!institute && /BINH DUONG/.test(key(institution)) && /CONG NGHE THONG TIN|ROBOT|TRI TUE NHAN TAO/.test(key(faculty))) {
      institute = 'VIỆN TRÍ TUỆ NHÂN TẠO VÀ CHUYỂN ĐỔI SỐ';
    }
    const titleIndex=lines.findIndex(s=>/^(DO AN|TIEU LUAN|KHOA LUAN|BAO CAO)\b/.test(key(s)));
    const metadataLines=lines.filter(s=>/^(GVHD|SVTH|NGUOI HUONG DAN|GIANG VIEN HUONG DAN|SINH VIEN THUC HIEN|MSSV|MA SO SINH VIEN|LOP(?: SINH HOAT)?)\s*:/.test(key(s)));
    const tableRows=nodes.filter(e=>e.name==='w:tbl').flatMap(e=>$(e).children(tag('tr')).toArray()).map(e=>text($,e));
    const source=readCoverMetadata([...metadataLines,...tableRows].join('\n'));

    const instructorRaw=(options.instructor || source.instructor || '').trim();
    const studentRaw=(options.student || source.student || '').trim();
    const studentIdRaw=(options.studentId || source.studentId || '').trim();
    const classNameRaw=(options.className || source.className || '').trim();

    let sName = studentRaw;
    let sId = studentIdRaw;
    let sClass = classNameRaw;
    if (!sId || !sClass) {
      const parts = studentRaw.split(/\s*[–—]\s*|\s+-\s+/u);
      if (parts.length >= 3) {
        sName = parts[0];
        if (!sId) sId = parts[1];
        if (!sClass) sClass = parts.slice(2).join(' - ');
      } else if (parts.length === 2) {
        sName = parts[0];
        if (!sId && /^\d+$/.test(parts[1].trim())) sId = parts[1];
        else if (!sClass) sClass = parts[1];
      }
    }

    const metadataRows = [
      { label: 'Giảng viên hướng dẫn:', value: formatInstructor(instructorRaw) },
      { label: 'Sinh viên thực hiện:', value: formatStudentName(sName) },
      { label: 'Mã số sinh viên:', value: formatStudentId(sId) },
      { label: 'Lớp:', value: formatClassName(sClass) }
    ];

    const date=lines.find(s=>/THANG/.test(key(s)) && /NAM|\/20\d{2}/.test(key(s)) && !metadataLines.includes(s));
    const topicLines=lines.slice(titleIndex+1).filter(s=>!metadataLines.includes(s) && s!==date && !/^TEN (DE TAI|TIEU LUAN)/.test(key(s)));
    const topic=(options.topic || topicLines.join(' ') || 'TÊN ĐỀ TÀI').trim();

    const drawings = [];
    if (/BINH DUONG/.test(key(institution))) {
      drawings.push(defaultLogo(archive, ++id));
    } else {
      const existing = paras.flatMap(e=>$(e).find(`${tag('drawing')},${tag('pict')}`).toArray()).map(e=>$.xml(e));
      if (existing.length) drawings.push(...existing);
      else drawings.push(defaultLogo(archive, ++id));
    }

    const coverMargins = options.profile?.cover?.margins_cm
      || options.profile?.page?.margins_cm
      || (options.documentType === 'do_an_tot_nghiep' ? { left: 2, right: 2 } : { left: 3, right: 2 });
    const printableWidth = Math.round((21 - (coverMargins.left ?? 3) - (coverMargins.right ?? 2)) * 1440 / 2.54);

    const org = [institution, ...(institute ? [institute] : []), faculty];
    const orgLayouts = org.map(lineText => fitCoverOrgLine(lineText, printableWidth, 15));
    const orgTotalLines = orgLayouts.reduce((sum, item) => sum + item.lineCount, 0);

    const topicWordsCount = topic.trim().split(/\s+/).filter(Boolean).length;
    const topicSize = topicWordsCount > 12 ? 17 : 20;
    const topicWrap = computeBalancedCenteredWrap(topic, topicSize, printableWidth);
    const topicLinesCount = Math.max(topicWrap.lineCount, Math.ceil(topicWordsCount / 9));

    const ornament=`<w:p><w:pPr><w:pStyle w:val="WFGraduationCover"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:spacing w:before="120" w:after="160"/><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr><w:sym w:font="Wingdings" w:char="F097"/></w:r><w:r><w:rPr><w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr><w:sym w:font="Wingdings" w:char="F026"/></w:r><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr><w:sym w:font="Wingdings" w:char="F096"/></w:r></w:p>`;
    const logoXml=drawings.map(d=>paragraph(`<w:r>${d}</w:r>`,{raw:true,before:0,after:6})).join('');
    const defaultDocType = options.documentType === 'do_an_tot_nghiep' ? 'ĐỒ ÁN TỐT NGHIỆP' : 'TIỂU LUẬN MÔN HỌC';
    const docType = (options.documentTitle || options.profile?.cover?.document_type || defaultDocType).trim().toUpperCase();
    const docTypeWrap = computeBalancedCenteredWrap(docType, 16, printableWidth);
    const docTypeTitle=paragraph(docType,{size:16,bold:true,before:12,after:6,indentDxa:docTypeWrap.indentDxa});
    const topicBeforePt = Math.max(12, 20 - Math.max(0, topicLinesCount - 2) * 3);
    const topicXml=paragraph(topic,{size:topicSize,bold:true,before:topicBeforePt,after:0,indentDxa:topicWrap.indentDxa});

    // 1. Dynamic horizontal layout for metadata block
    const maxValLength = Math.max(
      ...metadataRows.map(r => String(r.value || '').length)
    );
    const approxValueWidth = Math.round(maxValLength * 130);
    const labelWidth = 2760; // dxa for "Giảng viên hướng dẫn:" (~2590 dxa at 14pt) + clean gap
    const totalBlockWidth = labelWidth + approxValueWidth;

    const metaLeftIndent = Math.max(1200, Math.min(3100, Math.round((printableWidth - totalBlockWidth) / 2)));
    const metaTabPos = metaLeftIndent + labelWidth;
    const metaHanging = metaTabPos - metaLeftIndent;

    // 2. Dynamic vertical gaps for cover page
    const orgHeightPt = orgTotalLines * 23;
    const topicHeightPt = topicLinesCount * (topicSize + 3) + topicBeforePt;
    const fixedContentPt = orgHeightPt + 28 + 105 + 37 + 65 + 16; // org, ornament, logo, docTitle, metadata, date
    const targetCoverHeightPt = 665; // Anchors date cleanly near bottom border, safely within printable height (728.5pt)
    const availableGapsPt = Math.max(70, targetCoverHeightPt - (fixedContentPt + topicHeightPt));

    const metaGap = options.metaGap ?? Math.min(118, Math.max(30, Math.round(availableGapsPt * 0.365)));
    const dateGap = options.dateGap ?? Math.max(50, availableGapsPt - metaGap);

    const metadataXml = metadataRows.map((row, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === metadataRows.length - 1;
      const beforePt = isFirst ? metaGap : 3;
      return `<w:p><w:pPr>`
        + `<w:pStyle w:val="WFGraduationCover"/>`
        + `${isLast ? '' : '<w:keepNext w:val="1"/>'}<w:keepLines/>`
        + `<w:spacing w:before="${Math.round(beforePt * 20)}" w:after="0" w:line="280" w:lineRule="auto"/>`
        + `<w:ind w:left="${metaTabPos}" w:hanging="${metaHanging}" w:firstLine="0"/><w:jc w:val="left"/>`
        + `<w:tabs><w:tab w:val="left" w:pos="${metaTabPos}"/></w:tabs>`
        + `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>`
        + `</w:pPr>`
        + `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>${esc(row.label)}</w:t></w:r>`
        + `<w:r><w:tab/></w:r>`
        + `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>${esc(row.value)}</w:t></w:r>`
        + `</w:p>`;
    }).join('');

    const { month: currentMonth, year: currentYear } = getCurrentMonthYear();
    const resolvedMonth = String(options.month || '').trim() || currentMonth;
    const resolvedYear = String(options.year || '').trim() || currentYear;
    const loc = (options.location || options.profile?.cover?.location || 'Thành phố Hồ Chí Minh').trim();
    const dateText = `${loc}, tháng ${resolvedMonth} năm ${resolvedYear}`;
    const dateXml=`<w:p><w:pPr><w:pStyle w:val="WFGraduationCover"/><w:spacing w:before="${Math.round(dateGap * 20)}" w:after="0"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:eastAsia="Times New Roman" w:cs="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>${esc(dateText)}</w:t></w:r></w:p>`;

    const xml=org.map((s,i)=>paragraph(s,{size:orgLayouts[i].size,bold:true,after:6,indentDxa:orgLayouts[i].indentDxa,first:i===0})).join('')
      + ornament
      + logoXml
      + docTypeTitle
      + topicXml
      + metadataXml
      + dateXml;

    $(nodes[0]).before(xml);
    for(const e of nodes)$(e).remove();
  }
}
