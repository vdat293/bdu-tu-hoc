// Graduation front matter is prepared separately from the shared body formatter.
import {load} from 'cheerio';
import {formatGraduationCovers} from './docx-graduation-cover.js';
const tag = n => `w\\:${n}`;
const key = s => s.normalize('NFD').replace(/\p{M}/gu, '').replace(/[đĐ]/g, 'D').toUpperCase().replace(/\s+/g, ' ').trim();
const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const text = ($, e) => $(e).find(tag('t')).text();
const p = (s, {size=13, bold=false, italic=false, underline=false, before=0, after=6, style='WFGraduationForm'}={}) => `<w:p><w:pPr><w:pStyle w:val="${style}"/><w:keepNext w:val="0"/><w:keepLines/><w:pageBreakBefore w:val="0"/><w:spacing w:before="${before*20}" w:after="${after*20}" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b w:val="${+bold}"/><w:i w:val="${+italic}"/><w:color w:val="000000"/><w:sz w:val="${size*2}"/><w:szCs w:val="${size*2}"/>${underline?'<w:u w:val="single"/>':''}</w:rPr><w:t xml:space="preserve">${esc(s)}</w:t></w:r></w:p>`;
const cell = (content, width) => `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${content}</w:tc>`;
const table = (cells, widths, right=false) => `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a,b)=>a+b,0)}" w:type="dxa"/><w:jc w:val="${right?'right':'center'}"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(n=>`<w:${n} w:val="nil"/>`).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${widths.map(w=>`<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid><w:tr>${cells.map((c,i)=>cell(c,widths[i])).join('')}</w:tr></w:tbl>`;

// A protected table may inherit a formatter-owned style from an earlier export.
// Isolate only styles that the shared formatter will replace, including source
// styles derived from them. Otherwise unchanged table XML can still reflow.
export function isolateProposalStyles({$, records, archive}) {
  const styles=load(archive.readAsText('word/styles.xml'),{xml:true});
  const definitions=new Map(styles(tag('style')).toArray().map(e=>[styles(e).attr('w:styleId'),e]));
  const replaced=new Set(['WFBody','WFCaption','WFIntroTitle','WFPartTitle','WFMajorTitle','WFIntroHeading','WFFrontTitle','WFFigureCaption','WFTableCaption','WFGraduationForm','WFCoverStart','TableofFigures',...[1,2,3,4].flatMap(n=>[`WFHeading${n}`,`TOC${n}`])]);
  for(const [id,e] of definitions)if(/^(toc [1-4]|table of figures)$/i.test(styles(e).children(tag('name')).attr('w:val') || ''))replaced.add(id);
  const affected=(id,seen=new Set())=>{
    if(seen.has(id) || !definitions.has(id))return false;
    if(replaced.has(id))return true;
    seen.add(id);
    return styles(definitions.get(id)).find(`${tag('basedOn')},${tag('link')}`).toArray().some(e=>affected(styles(e).attr('w:val'),seen));
  };
  const copies=new Map();let serial=0;
  const clone=id=>{
    if(!affected(id))return id;
    if(copies.has(id))return copies.get(id);
    let newId;do{newId=`WFProposalSource${++serial}`;}while(definitions.has(newId));
    copies.set(id,newId);
    const copy=styles(styles.xml(definitions.get(id)));copy.attr('w:styleId',newId);
    copy.children(tag('name')).attr('w:val',newId);
    copy.find(`${tag('basedOn')},${tag('link')},${tag('next')}`).each((_,e)=>styles(e).attr('w:val',clone(styles(e).attr('w:val'))));
    styles(tag('styles')).append(copy);return newId;
  };
  for(const r of records.filter(r=>r.region==='proposal' && r.role!=='proposal_title')) {
    $(r.element).find(`${tag('pStyle')},${tag('rStyle')}`).each((_,e)=>$(e).attr('w:val',clone($(e).attr('w:val'))));
    $(r.element).parents(tag('tbl')).children(tag('tblPr')).children(tag('tblStyle')).each((_,e)=>$(e).attr('w:val',clone($(e).attr('w:val'))));
  }
  if(copies.size)archive.updateFile('word/styles.xml',Buffer.from(styles.xml()));
  return copies.size;
}

export function formatProposalSignatures(analysis, options = {}, {from, end} = {}) {
  const {$, body} = analysis;
  const location = options.location || options.profile?.cover?.location || 'Thành phố Hồ Chí Minh';
  const children = body.children().toArray();
  const candidates = (from !== undefined && end !== undefined) ? children.slice(from, end) : children;

  const sigTable = candidates.find(e => {
    if (e.name !== 'w:tbl') return false;
    const t = key(text($, e));
    const isMainProposal = /TEN DE TAI/.test(t) && /THOI GIAN THUC HIEN/.test(t);
    if (isMainProposal) return false;
    const hasRole = /VIEN TRUONG|TRUONG KHOA|TRUONG BO MON|CAN BO HUONG DAN|GV HUONG DAN|GIANG VIEN HUONG DAN|CBHD|NGUOI HUONG DAN/.test(t);
    const hasInstruction = /KY.*HO TEN/.test(t);
    return hasRole || hasInstruction;
  });

  let sigParagraphs = [];
  if (!sigTable) {
    const pCandidates = candidates.filter(e => e.name === 'w:p');
    const sigIndex = pCandidates.findIndex(e => {
      const t = key(text($, e));
      return /VIEN TRUONG|TRUONG KHOA|TRUONG BO MON/.test(t) || ((/HUONG DAN/.test(t)) && /KY.*HO TEN/.test(t));
    });
    if (sigIndex !== -1) {
      sigParagraphs = pCandidates.slice(sigIndex);
    }
  }

  if (!sigTable && !sigParagraphs.length) return 0;

  if (sigTable && $(sigTable).find(tag('tr')).length === 3
      && $(sigTable).find(tag('tblW')).attr('w:w') === '9071'
      && $(sigTable).find(tag('gridCol')).eq(0).attr('w:w') === '4050'
      && $(sigTable).find(tag('gridCol')).eq(1).attr('w:w') === '5021') {
    return 0;
  }

  function parseCell(tc) {
    let date = '';
    let role = '';
    let instruction = '';
    let name = '';
    const drawings = [];

    const paras = $(tc).find(tag('p')).toArray();
    for (const pNode of paras) {
      const hasDrawing = $(pNode).find(`${tag('drawing')},${tag('pict')},${tag('object')}`).length > 0;
      if (hasDrawing) {
        drawings.push($.xml(pNode));
        continue;
      }
      const raw = $(pNode).text().trim();
      if (!raw) continue;
      const k = key(raw);
      if (/^(?:.*,\s*)?NGAY[\s\S]*THANG[\s\S]*NAM/i.test(k) || /^(?:THANH PHO|TINH|TP\b|BINH DUONG|HA NOI|HO CHI MINH)/i.test(k)) {
        date = raw;
      } else if (/^(?:VIEN TRUONG|TRUONG KHOA|TRUONG BO MON|PHONG DAO TAO|BAN GIAM HIEU|(?:GIANG VIEN|GV|CAN BO|CBHD|NGUOI) HUONG DAN|(?:GIANG VIEN|GV) PHAN BIEN|SINH VIEN THUC HIEN|SVTH)$/i.test(k)) {
        role = raw;
      } else if (/KY.*HO TEN/i.test(k)) {
        if (!role && /(?:VIEN TRUONG|TRUONG KHOA|TRUONG BO MON|(?:GIANG VIEN|GV|CAN BO|CBHD|NGUOI) HUONG DAN)/i.test(k)) {
          const parts = raw.split(/\s*\(|\s*\[/);
          role = parts[0].trim();
          instruction = '(' + (parts[1] || 'Ký tên và ghi rõ họ tên').replace(/\)[\s\S]*$/, ')').trim();
        } else {
          instruction = raw;
        }
      } else if (!name && !/^[.\s…_\-]+$/.test(raw)) {
        name = raw;
      }
    }
    return { date, role, instruction, name, drawings };
  }

  let left = { date: '', role: '', instruction: '', name: '', drawings: [] };
  let right = { date: '', role: '', instruction: '', name: '', drawings: [] };

  if (sigTable) {
    const rows = $(sigTable).find(tag('tr')).toArray();
    if (rows.length === 1) {
      const rowCells = $(rows[0]).find(tag('tc')).toArray();
      if (rowCells.length === 1) {
        left = parseCell(rowCells[0]);
      } else {
        left = parseCell(rowCells[0]);
        right = parseCell(rowCells[1]);
      }
    } else {
      for (const tr of rows) {
        const rowCells = $(tr).find(tag('tc')).toArray();
        if (rowCells[0]) {
          const c0 = parseCell(rowCells[0]);
          if (c0.date && !left.date) left.date = c0.date;
          if (c0.role && !left.role) left.role = c0.role;
          if (c0.instruction && !left.instruction) left.instruction = c0.instruction;
          if (c0.name && !left.name) left.name = c0.name;
          if (c0.drawings.length) left.drawings.push(...c0.drawings);
        }
        if (rowCells[1]) {
          const c1 = parseCell(rowCells[1]);
          if (c1.date && !right.date) right.date = c1.date;
          if (c1.role && !right.role) right.role = c1.role;
          if (c1.instruction && !right.instruction) right.instruction = c1.instruction;
          if (c1.name && !right.name) right.name = c1.name;
          if (c1.drawings.length) right.drawings.push(...c1.drawings);
        }
      }
    }
  } else if (sigParagraphs.length) {
    for (const pNode of sigParagraphs) {
      const raw = $(pNode).text().trim();
      if (!raw) continue;
      const k = key(raw);
      if (/^(?:.*,\s*)?NGAY[\s\S]*THANG[\s\S]*NAM/i.test(k) || /^(?:THANH PHO|TINH|TP\b|BINH DUONG|HA NOI|HO CHI MINH)/i.test(k)) {
        right.date = raw;
      } else if (/VIEN TRUONG|TRUONG KHOA|TRUONG BO MON/.test(k) && /HUONG DAN/.test(k)) {
        const parts = raw.split(/\t|\s{4,}/);
        if (parts[0]) left.role = parts[0].trim();
        if (parts[1]) right.role = parts[1].trim();
      } else if (/VIEN TRUONG|TRUONG KHOA|TRUONG BO MON/.test(k)) {
        left.role = raw;
      } else if (/HUONG DAN/.test(k)) {
        right.role = raw;
      } else if (/KY.*HO TEN/.test(k)) {
        left.instruction = raw;
        right.instruction = raw;
      } else if (!left.name) {
        const parts = raw.split(/\t|\s{4,}/);
        left.name = parts[0]?.trim() || '';
        if (parts[1]) right.name = parts[1].trim();
      } else if (!right.name) {
        right.name = raw;
      }
    }
  }

  if (left && right && (left.date || /HUONG DAN/.test(key(left.role))) && /VIEN TRUONG|TRUONG KHOA|TRUONG BO MON/.test(key(right.role))) {
    const tmp = left; left = right; right = tmp;
  }

  let dateText = right.date || left.date || `${location}, ngày … tháng … năm …`;
  if (/ng[aà]y[\s._…-]+th[aá]ng[\s._…-]+n[aă]m/i.test(dateText)) {
    const cityMatch = dateText.match(/^([^,]+),/);
    const city = cityMatch ? cityMatch[1].trim() : location;
    dateText = `${city}, ngày … tháng … năm …`;
  }

  const leftRole = (left.role || 'VIỆN TRƯỞNG').toUpperCase();
  const rightRole = (right.role || 'GV HƯỚNG DẪN').toUpperCase();
  const leftInstruction = '(Ký tên và ghi rõ họ tên)';
  const rightInstruction = '(Ký tên và ghi rõ họ tên)';
  const leftName = (left.name || '').toUpperCase();
  let rightName = (right.name || '').toUpperCase();
  if (!rightName && options.instructor) {
    rightName = options.instructor.replace(/^(?:ThS|TS|PGS|GS|Ths|Ts)\.?\s*/i, '').toUpperCase();
  }

  const dateCell = `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="0" w:after="80" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:i/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr><w:t xml:space="preserve">${esc(dateText)}</w:t></w:r></w:p>`;
  const blankCell = `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>`;
  const roleP = title => `<w:p><w:pPr><w:jc w:val="center"/><w:keepNext/><w:spacing w:before="60" w:after="40" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t>${esc(title)}</w:t></w:r></w:p>`;
  const subP = sub => `<w:p><w:pPr><w:jc w:val="center"/><w:keepNext/><w:spacing w:before="0" w:after="100" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:i/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr><w:t>${esc(sub)}</w:t></w:r></w:p>`;
  const sigSpace = drawings => drawings.length > 0
    ? drawings.join('')
    : `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="800" w:lineRule="exact"/></w:pPr></w:p>`;
  const nameP = name => name
    ? `<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="100" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr><w:t>${esc(name)}</w:t></w:r></w:p>`
    : `<w:p><w:pPr><w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:p>`;

  const formattedTable = $(`<w:tbl>`
    + `<w:tblPr>`
      + `<w:tblW w:w="9071" w:type="dxa"/>`
      + `<w:jc w:val="center"/>`
      + `<w:tblBorders>`
        + ['top','left','bottom','right','insideH','insideV'].map(n => `<w:${n} w:val="nil"/>`).join('')
      + `</w:tblBorders>`
      + `<w:tblLayout w:type="fixed"/>`
    + `</w:tblPr>`
    + `<w:tblGrid>`
      + `<w:gridCol w:w="4050"/>`
      + `<w:gridCol w:w="5021"/>`
    + `</w:tblGrid>`
    + `<w:tr>`
      + `<w:tc><w:tcPr><w:tcW w:w="4050" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${blankCell}</w:tc>`
      + `<w:tc><w:tcPr><w:tcW w:w="5021" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${dateCell}</w:tc>`
    + `</w:tr>`
    + `<w:tr>`
      + `<w:tc><w:tcPr><w:tcW w:w="4050" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${roleP(leftRole)}${subP(leftInstruction)}${sigSpace(left.drawings)}</w:tc>`
      + `<w:tc><w:tcPr><w:tcW w:w="5021" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${roleP(rightRole)}${subP(rightInstruction)}${sigSpace(right.drawings)}</w:tc>`
    + `</w:tr>`
    + `<w:tr>`
      + `<w:tc><w:tcPr><w:tcW w:w="4050" w:type="dxa"/><w:vAlign w:val="bottom"/></w:tcPr>${nameP(leftName)}</w:tc>`
      + `<w:tc><w:tcPr><w:tcW w:w="5021" w:type="dxa"/><w:vAlign w:val="bottom"/></w:tcPr>${nameP(rightName)}</w:tc>`
    + `</w:tr>`
    + `</w:tbl>`);


  if (sigTable) {
    $(sigTable).replaceWith(formattedTable);
  } else if (sigParagraphs.length) {
    $(sigParagraphs[0]).replaceWith(formattedTable);
    for (let i = 1; i < sigParagraphs.length; i++) $(sigParagraphs[i]).remove();
  }

  const prevNodes = formattedTable.prevAll().toArray();
  let blankCount = 0;
  for (const prev of prevNodes) {
    if (prev.name === 'w:tbl') break;
    if (prev.name === 'w:p') {
      const pText = $(prev).text().trim();
      const hasDrawing = $(prev).find(`${tag('drawing')},${tag('pict')},${tag('object')}`).length > 0;
      if (!pText && !hasDrawing) {
        blankCount++;
        if (blankCount > 1) $(prev).remove();
        else {
          $(prev).html('<w:pPr><w:spacing w:before="120" w:after="120" w:line="240" w:lineRule="auto"/></w:pPr>');
        }
      } else {
        break;
      }
    }
  }

  return 1;
}

export function prepareGraduation(analysis, options) {
  const {$, body, records, archive} = analysis;
  const institution = options.institution || options.profile?.cover?.institution || 'TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG';
  const faculty = options.faculty || options.profile?.cover?.faculty || '';
  const location = options.location || options.profile?.cover?.location || 'Thành phố Hồ Chí Minh';
  const report = {templateRevision:'graduation-2026-09-05-v7',coversAdded:0, reviewPagesAdded:0, signaturesAdded:0, proposalMastheadsFormatted:0, proposalSignaturesFormatted:0, unboxedProposalParagraphsRemoved:0};
  const top = e => {while(e.parent && e.parent!==body[0])e=e.parent;return e;};
  const firstContent = records.find(r=>['proposal_title','front_title','intro_title','part_title','chapter','major_title'].includes(r.role));
  const boundary = firstContent && (firstContent.startElement || top(firstContent.element));
  const coverRecords = records.filter(r=>r.region==='cover' && !r.insideTable && r.text);
  // Repeated school heading identifies a second existing cover. A masthead in
  // a table is explicitly excluded, even when it precedes the proposal title.
  let covers = coverRecords.filter(r=>/^TRUONG\b/.test(key(r.text))).map(r=>top(r.element));
  if (!covers.length && coverRecords.length) covers = [top(coverRecords[0].element)];
  covers = [...new Set(covers)];
  if(covers.length>2) throw new Error('Phát hiện hơn hai bìa đồ án; cần kiểm tra các bìa trước khi định dạng.');
  if(!covers.length) {
    const cover = $(p(institution,{size:15,bold:true,style:'WFCoverStart'})+p(faculty,{size:15,bold:true})
      +p('ĐỒ ÁN TỐT NGHIỆP',{size:16,bold:true,before:60})
      +p((options.topic || 'TÊN ĐỀ TÀI').toUpperCase(),{size:20,bold:true})
      +p(`GVHD: ${options.instructor}`,{before:60})+p(`SVTH: ${options.student}${(options.studentId?' – '+options.studentId:'')}${(options.className?' – '+options.className:'')}`)
      +p(`${location}, tháng ${options.month || '…'} năm ${options.year || '…'}`,{before:70,bold:true}));
    body.prepend(cover);covers=[cover[0]];report.coversAdded++;
  }
  if(covers.length===1) {
    const nodes=body.children().toArray(), from=nodes.indexOf(covers[0]), end=boundary?nodes.indexOf(boundary):nodes.length-1;
    const copy=$(nodes.slice(from,end).map(e=>$.xml(e)).join(''));
    copy.find(`${tag('sectPr')},${tag('bookmarkStart')},${tag('bookmarkEnd')}`).remove();
    copy.find(tag('p')).addBack(tag('p')).removeAttr('w14:paraId').removeAttr('w14:textId');
    let id=Math.max(0,...$('wp\\:docPr').toArray().map(e=>Number($(e).attr('id'))||0));
    copy.find('wp\\:docPr').each((_,e)=>$(e).attr('id',String(++id)));
    if(boundary)$(boundary).before(copy);else body.children().last().before(copy);
    covers.push(copy[0]);report.coversAdded++;
  }
  formatGraduationCovers(analysis,covers,boundary,options);
  if (!options.skipProposal) {
    for(const r of records.filter(r=>r.role==='proposal_title')) {
      const masthead=$(table([
        p(institution,{size:12})+p(faculty,{size:12,bold:true,underline:true}),
        p('CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM',{size:12})+p('Độc lập - Tự do - Hạnh phúc',{size:12,underline:true})
      ],[4050,5021]));
      if(r.startElement)$(r.startElement).replaceWith(masthead);else $(r.element).before(masthead);
      // The user's authoritative proposal is the boxed form immediately below
      // the title. Some uploads also contain a prose copy before that form.
      // Remove that redundant prefix; never extract or rebuild the boxed content.
      const children=body.children().toArray(), from=children.indexOf(top(r.element))+1;
      const next=records.find(n=>n.index>r.index && n.role==='front_title');
      const end=next?children.indexOf(top(next.element)):children.length;
      const candidates=children.slice(from,end);
      const frameIndex=candidates.findIndex(e=>e.name==='w:tbl' && /TEN DE TAI/.test(key(text($,e)))
        && /THOI GIAN THUC HIEN/.test(key(text($,e))) && /CAN BO HUONG DAN|CBHD/.test(key(text($,e))));
      if(frameIndex>0) {
        const prefix=candidates.slice(0,frameIndex), combined=key(prefix.map(e=>text($,e)).join(' '));
        const duplicate=/^TEN DE TAI/.test(combined) && /CAN BO HUONG DAN|CBHD/.test(combined)
          && /THOI GIAN THUC HIEN/.test(combined);
        if(duplicate && prefix.every(e=>e.name==='w:p' && !$(e).find('w\\:drawing,w\\:pict,w\\:object,w\\:sectPr').length)) {
          for(const e of prefix)$(e).remove();
          report.unboxedProposalParagraphsRemoved+=prefix.length;
        }
      }
      report.proposalMastheadsFormatted++;
      report.proposalSignaturesFormatted += formatProposalSignatures(analysis, { ...options, location }, { from, end });
    }
  }

  if(!analysis.hasProposal) analysis.warnings.push('Tài liệu chưa có đề cương; không tự tạo nội dung đề cương.');

  const titles=records.filter(r=>r.role==='front_title' && /^NHAN XET/.test(key(r.text)));
  const roles=['GIẢNG VIÊN HƯỚNG DẪN','GIẢNG VIÊN PHẢN BIỆN'];
  const reviewBlocks=[];
  for(let i=0;i<2;i++) {
    const matches=titles.filter(r=>i===1?/PHAN BIEN/.test(key(r.text)):! /PHAN BIEN/.test(key(r.text)));
    if(matches.length>1) throw new Error('Có nhiều trang nhận xét cùng loại; cần kiểm tra trước khi định dạng.');
    const r=matches[0];
    let nodes=[];
    if(r) {
      const children=body.children().toArray(), start=children.indexOf(top(r.element));
      const next=records.find(n=>n.index>r.index && ['front_title','intro_title','part_title','chapter','major_title'].includes(n.role));
      const end=next?children.indexOf(top(next.element)):children.length-1;
      nodes=children.slice(start+1,end);
      $(r.element).remove();
    } else report.reviewPagesAdded++;
    const kept=[];let signature=null;
    const isRole = s => /^(?:GIANG VIEN|CAN BO|GV) (?:HUONG DAN|PHAN BIEN)$/.test(key(s));
    // Plain-paragraph signature blocks also occur in imported Word templates.
    const roleIndex=nodes.findIndex(e=>e.name==='w:p' && isRole(text($,e)));
    const signatureNodes=new Set();
    if(roleIndex>=0) {
      const from=roleIndex>0 && /NGAY/.test(key(text($,nodes[roleIndex-1])))?roleIndex-1:roleIndex;
      for(const e of nodes.slice(from))signatureNodes.add(e);
      signature=$(table([nodes.slice(from).map(e=>$.xml(e)).join('')],[5400],true))[0];
    }
    for(const e of nodes) {
      const t=text($,e).trim();
      const artwork=$(e).find(`${tag('drawing')},${tag('pict')},${tag('object')}`).length;
      if(signatureNodes.has(e)) {$(e).remove();continue;}
      if(e.name==='w:tbl' && $(e).find(tag('p')).toArray().some(q=>isRole(text($,q)))) signature=e;
      else if((t && !/^[.\s…_\-]+$/.test(t)) || artwork) kept.push(e);
      $(e).remove();
    }
    const block=$(p(`NHẬN XÉT CỦA ${roles[i]}`,{size:16,bold:true,after:24,style:'WFGraduationForm'})).toArray();
    // Existing written reviews and signature artwork remain intact. Blank forms
    // get a bounded writing area so the signature stays on the same page.
    if(kept.length) for(const e of kept)block.push(e);
    {
      const line='<w:p><w:pPr><w:pStyle w:val="WFGraduationForm"/><w:spacing w:before="0" w:after="0" w:line="460" w:lineRule="exact"/><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9071"/></w:tabs></w:pPr><w:r><w:tab/></w:r></w:p>';
      for(const e of $(line.repeat(kept.length?4:20)).toArray())block.push(e);
    }
    if(signature) {
      const sig=$(signature), paragraphs=sig.find(tag('p'));
      let roleP=paragraphs.filter((_,e)=>/^(?:GIANG VIEN|CAN BO|GV) (?:HUONG DAN|PHAN BIEN)$/.test(key(text($,e)))).first();
      if(roleP.length) {
        if(roleP.find(`${tag('drawing')},${tag('pict')},${tag('object')}`).length) {
          const texts=roleP.find(tag('t'));texts.first().text(roles[i]);texts.slice(1).text('');
        } else {
          const updated=$(p(roles[i],{bold:true}));roleP.replaceWith(updated);roleP=updated;
        }
        if(!/NGAY/i.test(key(text($,signature))))roleP.before(p(`${location}, ngày … tháng … năm …`,{size:11,before:12}));
        else sig.find(tag('p')).filter((_,e)=>/NGAY/.test(key(text($,e)))).each((_,e)=>{
          if(!$(e).find(`${tag('drawing')},${tag('pict')}`).length)$(e).replaceWith(p(text($,e),{size:11,before:12}));
        });
        if(!/KY.*HO TEN/.test(key(text($,signature)))){roleP.after(p('(Ký và ghi rõ họ tên)',{italic:true,size:12}));report.signaturesAdded++;}
        else sig.find(tag('p')).filter((_,e)=>/KY.*HO TEN/.test(key(text($,e)))).each((_,e)=>{
          if(!$(e).find(`${tag('drawing')},${tag('pict')}`).length)$(e).replaceWith(p('(Ký và ghi rõ họ tên)',{italic:true,size:12}));
        });
      }
      // Many source forms position the signature with an empty left cell.
      // Remove only empty layout cells, keeping the full occupied cell intact.
      const cells=sig.find(tag('tc'));
      const occupied=cells.filter((_,e)=>text($,e).trim() || $(e).find(`${tag('drawing')},${tag('pict')},${tag('object')}`).length);
      if(occupied.length===1 && cells.length>1) {
        cells.not(occupied).remove();
        sig.find(tag('tr')).filter((_,e)=>!$(e).children(tag('tc')).length).remove();
        sig.children(tag('tblGrid')).html('<w:gridCol w:w="5400"/>');
        occupied.children(tag('tcPr')).children(`${tag('gridSpan')},${tag('hMerge')},${tag('vMerge')}`).remove();
      }
      const tp=sig.children(tag('tblPr'));
      if(!tp.length)sig.prepend('<w:tblPr/>');
      const props=sig.children(tag('tblPr'));
      props.children(`${tag('jc')},${tag('tblBorders')},${tag('tblInd')},${tag('tblpPr')}`).remove();
      if(sig.find(tag('tc')).length===1){props.children(tag('tblW')).remove();props.append('<w:tblW w:w="5400" w:type="dxa"/>');}
      props.append('<w:jc w:val="right"/><w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(n=>`<w:${n} w:val="nil"/>`).join('')+'</w:tblBorders>');
      // Single-cell signature blocks may safely be sized; complex source
      // signature layouts retain their grid and all handwritten content.
      if(sig.find(tag('tc')).length===1){sig.find(tag('gridCol')).attr('w:w','5400');sig.find(tag('tcW')).attr('w:w','5400');}
      sig.find(tag('p')).each((_,e)=>{
        const q=$(e);if(!q.children(tag('pPr')).length)q.prepend('<w:pPr/>');
        const pp=q.children(tag('pPr'));pp.children(`${tag('jc')},${tag('keepNext')}`).remove();pp.append('<w:jc w:val="center"/><w:keepNext/>');
      });
      block.push(signature);
    } else {
      for(const e of $(table([p(`${location}, ngày … tháng … năm …`,{size:11,before:12})+p(roles[i],{bold:true})+p('(Ký và ghi rõ họ tên)',{italic:true,size:12})+p('',{after:48})],[5400],true)).toArray())block.push(e);
      report.signaturesAdded++;
    }
    reviewBlocks.push(block);
  }
  // Place both reviews after the entire proposal (including approval blocks).
  const next=records.find(r=>!titles.includes(r) && ['front_title','intro_title','part_title','chapter','major_title'].includes(r.role));
  const anchor=next?top(next.element):body.children().last()[0];
  for(const block of reviewBlocks)$(anchor).before(block);
  archive.updateFile('word/document.xml',Buffer.from($.xml()));
  return report;
}

export function prepareCourseworkCover(analysis, options) {
  const { $, body, records, archive } = analysis;
  const requested = new Set((options.frontMatter ?? 'cover').split(',').map(s => s.trim()));
  const coverRecords = records.filter(r => r.region === 'cover' && !r.insideTable && r.text);

  let covers = coverRecords.filter(r => /^TRUONG\b/.test(key(r.text))).map(r => top(r.element));
  covers = [...new Set(covers)];

  if (!covers.length) {
    if (!requested.has('cover')) return 0;
  }

  const institution = options.institution || options.profile?.cover?.institution || 'TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG';
  const faculty = options.faculty || options.profile?.cover?.faculty || '';
  const location = options.location || options.profile?.cover?.location || 'Thành phố Hồ Chí Minh';
  const defaultDocType = 'TIỂU LUẬN MÔN HỌC';
  const docType = (options.documentTitle || options.profile?.cover?.document_type || defaultDocType).trim().toUpperCase();
  const top = e => { while (e.parent && e.parent !== body[0]) e = e.parent; return e; };
  const firstContent = records.find(r => ['proposal_title', 'front_title', 'intro_title', 'part_title', 'chapter', 'major_title'].includes(r.role));
  const boundary = firstContent && (firstContent.startElement || top(firstContent.element));

  let coversAdded = 0;
  if (!covers.length) {
    const cover = $(p(institution, { size: 15, bold: true, style: 'WFCoverStart' }) + p(faculty, { size: 15, bold: true })
      + p(docType, { size: 16, bold: true, before: 60 })
      + p((options.topic || 'TÊN ĐỀ TÀI'), { size: 20, bold: true })
      + p(`GVHD: ${options.instructor}`, { before: 60 }) + p(`SVTH: ${options.student}${(options.studentId ? ' – ' + options.studentId : '')}${(options.className ? ' – ' + options.className : '')}`)
      + p(`${location}, tháng ${options.month || '…'} năm ${options.year || '…'}`, { before: 70, bold: true }));
    body.prepend(cover);
    covers = [cover[0]];
    coversAdded = 1;
  } else if (covers.length > 1) {
    const children = body.children().toArray();
    const c1Index = children.indexOf(covers[1]);
    const bIndex = boundary ? children.indexOf(boundary) : children.length;
    if (c1Index >= 0 && c1Index < bIndex) {
      children.slice(c1Index, bIndex).forEach(node => $(node).remove());
    }
    covers = [covers[0]];
  }

  formatGraduationCovers(analysis, covers, boundary, options);
  archive.updateFile('word/document.xml', Buffer.from($.xml()));
  return coversAdded;
}
