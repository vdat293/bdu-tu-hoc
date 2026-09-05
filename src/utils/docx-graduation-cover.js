import fs from 'node:fs';
import {load} from 'cheerio';

const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const tag=n=>`w\\:${n}`;
const esc=s=>String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const key=s=>s.normalize('NFD').replace(/\p{M}/gu,'').replace(/[đĐ]/g,'D').toUpperCase().replace(/\s+/g,' ').trim();
const text=($,e)=>$(e).find(tag('t')).text().replace(/\s+/g,' ').trim();
const run=(s,size,bold=false,italic=false)=>`<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b w:val="${+bold}"/><w:i w:val="${+italic}"/><w:color w:val="000000"/><w:sz w:val="${size*2}"/><w:szCs w:val="${size*2}"/></w:rPr><w:t xml:space="preserve">${esc(s)}</w:t></w:r>`;
const paragraph=(content,{size=14,bold=false,italic=false,before=0,after=0,align='center',first=false,raw=false}={})=>`<w:p><w:pPr><w:pStyle w:val="${first?'WFCoverStart':'WFGraduationCover'}"/><w:keepNext w:val="0"/><w:keepLines/><w:pageBreakBefore w:val="0"/><w:spacing w:before="${Math.round(before*20)}" w:after="${Math.round(after*20)}" w:line="240" w:lineRule="auto"/><w:ind w:left="0" w:right="0" w:firstLine="0"/><w:jc w:val="${align}"/></w:pPr>${raw?content:run(content,size,bold,italic)}</w:p>`;

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
    archive.addFile('word/media/wf-bdu-cover-logo.png',fs.readFileSync(new URL('../../assets/wordfmt/bdu-cover-logo.png',import.meta.url)));
  }
  const types=load(archive.readAsText('[Content_Types].xml'),{xml:true});
  if(!types('Default').toArray().some(e=>types(e).attr('Extension')==='png')) {
    types('Types').append('<Default Extension="png" ContentType="image/png"/>');
    archive.updateFile('[Content_Types].xml',Buffer.from(types.xml()));
  }
  return `<w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1482495" cy="1440000"/><wp:docPr id="${id}" name="Logo Đại học Bình Dương"/><wp:cNvGraphicFramePr/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="Logo BDU"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="${R}" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1482495" cy="1440000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing>`;
}

function formatInstructor(raw) {
  if (!raw) return '……………………';
  let clean = raw.replace(/^(?:GVHD|NGƯỜI HƯỚNG DẪN|GIẢNG VIÊN HƯỚNG DẪN)\s*:\s*/i, '').trim();
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
  return raw.replace(/^(?:SVTH|SINH VIÊN THỰC HIỆN)\s*:\s*/i, '').trim().toUpperCase();
}

function formatStudentId(raw) {
  if (!raw) return '……………………';
  return raw.replace(/^(?:MSSV|MÃ SỐ SINH VIÊN|MÃ SỐ SV)\s*:\s*/i, '').trim();
}

function formatClassName(raw) {
  if (!raw) return '……………………';
  return raw.replace(/^(?:LỚP|LỚP SINH HOẠT)\s*:\s*/i, '').trim().toUpperCase();
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
      { label: 'Người hướng dẫn:', value: formatInstructor(instructorRaw) },
      { label: 'Sinh viên thực hiện:', value: formatStudentName(sName) },
      { label: 'Mã số sinh viên:', value: formatStudentId(sId) },
      { label: 'Lớp:', value: formatClassName(sClass) }
    ];

    const date=lines.find(s=>/THANG/.test(key(s)) && /NAM|\/20\d{2}/.test(key(s)) && !metadataLines.includes(s));
    const topicLines=lines.slice(titleIndex+1).filter(s=>!metadataLines.includes(s) && s!==date && !/^TEN (DE TAI|TIEU LUAN)/.test(key(s)));
    const topic=(options.topic || topicLines.join(' ') || 'TÊN ĐỀ TÀI').trim();

    const drawings=paras.flatMap(e=>$(e).find(`${tag('drawing')},${tag('pict')}`).toArray()).map(e=>$.xml(e));
    if(!drawings.length && /BINH DUONG/.test(key(institution)))drawings.push(defaultLogo(archive,++id));

    const org=[institution,...(institute?[institute]:[]),faculty];

    const linesAt=(s,size,width)=>Math.max(1,Math.ceil(s.length*size*0.53/width));
    const topicLinesCount=linesAt(topic,20,482);

    const ornament=`<w:p><w:pPr><w:pStyle w:val="WFGraduationCover"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:spacing w:before="240" w:after="320"/><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr><w:sym w:font="Wingdings" w:char="F097"/></w:r><w:r><w:rPr><w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr><w:sym w:font="Wingdings" w:char="F026"/></w:r><w:r><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="32"/></w:rPr><w:sym w:font="Wingdings" w:char="F096"/></w:r></w:p>`;
    const logoXml=drawings.map(d=>paragraph(`<w:r>${d}</w:r>`,{raw:true,before:0,after:6})).join('');
    const defaultDocType = options.documentType === 'do_an_tot_nghiep' ? 'ĐỒ ÁN TỐT NGHIỆP' : 'TIỂU LUẬN MÔN HỌC';
    const docType = (options.documentTitle || options.profile?.cover?.document_type || defaultDocType).trim().toUpperCase();
    const docTypeTitle=paragraph(docType,{size:16,bold:true,before:16,after:6});
    const topicXml=paragraph(topic,{size:20,bold:true,before:24,after:0});

    const extraTopicLines = Math.max(0, topicLinesCount - 3);
    const metaGap = Math.max(50, (options.metaGap ?? 90) - extraTopicLines * 10);
    const dateGap = Math.max(100, (options.dateGap ?? 160) - extraTopicLines * 16);

    const metadataXml = metadataRows.map((row, idx) => {
      const isFirst = idx === 0;
      const beforePt = isFirst ? metaGap : 3;
      return `<w:p><w:pPr>`
        + `<w:pStyle w:val="WFGraduationCover"/>`
        + `<w:keepNext w:val="1"/><w:keepLines/>`
        + `<w:spacing w:before="${Math.round(beforePt * 20)}" w:after="0" w:line="280" w:lineRule="auto"/>`
        + `<w:ind w:left="3800" w:firstLine="0"/><w:jc w:val="left"/>`
        + `<w:tabs><w:tab w:val="left" w:pos="6500"/></w:tabs>`
        + `<w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>`
        + `</w:pPr>`
        + `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>${esc(row.label)}</w:t></w:r>`
        + `<w:r><w:tab/></w:r>`
        + `<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>${esc(row.value)}</w:t></w:r>`
        + `</w:p>`;
    }).join('');

    let dateText;
    if (options.month || options.year) {
      const loc = options.location || options.profile?.cover?.location || 'Thành phố Hồ Chí Minh';
      dateText = `${loc}, tháng ${options.month || '…'} năm ${options.year || '……'}`;
    } else if (date) {
      dateText = date.replace(/^THÀNH PHỐ HỒ CHÍ MINH/i, 'Thành phố Hồ Chí Minh')
                     .replace(/\bTHÁNG\b/i, 'tháng')
                     .replace(/\bNĂM\b/i, 'năm');
    } else {
      const loc = options.location || options.profile?.cover?.location || 'Thành phố Hồ Chí Minh';
      dateText = `${loc}, tháng … năm ……`;
    }
    const dateXml=`<w:p><w:pPr><w:pStyle w:val="WFGraduationCover"/><w:spacing w:before="${Math.round(dateGap * 20)}" w:after="0"/><w:ind w:firstLine="0"/><w:jc w:val="center"/><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr></w:pPr><w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:b/><w:bCs/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr><w:t>${esc(dateText)}</w:t></w:r></w:p>`;

    const xml=org.map((s,i)=>paragraph(s,{size:15,bold:true,after:6,first:i===0})).join('')
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
