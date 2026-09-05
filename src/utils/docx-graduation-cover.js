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
      result.student=parts[0].trim();
      if(parts[1] && /^\d{6,12}$/.test(parts[1]))result.studentId=parts[1];
      if(parts[2])result.className=parts.slice(2).join(' - ');
    } else if(/MSSV|MA SO/.test(label))result.studentId=value;
    else result.className=value;
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

export function formatGraduationCovers(analysis,covers,boundary,options) {
  const {$,body,archive}=analysis;
  let id=Math.max(0,...$('wp\\:docPr').toArray().map(e=>Number($(e).attr('id'))||0));
  const children=body.children().toArray();
  const groups=covers.map((e,i)=>children.slice(children.indexOf(e),i+1<covers.length?children.indexOf(covers[i+1]):boundary?children.indexOf(boundary):children.length-1));
  for(const nodes of groups) {
    const paras=nodes.flatMap(e=>e.name==='w:p'?[e]:$(e).find(tag('p')).toArray());
    const lines=nodes.filter(e=>e.name==='w:p').map(e=>text($,e)).filter(Boolean);
    const institution=lines.find(s=>/^TRUONG\b/.test(key(s))) || options.institution || options.profile.cover.institution;
    const institute=lines.find(s=>/^VIEN\b/.test(key(s)));
    const faculty=lines.find(s=>/^KHOA\b/.test(key(s))) || options.faculty || options.profile.cover.faculty;
    const titleIndex=lines.findIndex(s=>/^(DO AN|TIEU LUAN|KHOA LUAN|BAO CAO)\b/.test(key(s)));
    const metadataLines=lines.filter(s=>/^(GVHD|SVTH|NGUOI HUONG DAN|GIANG VIEN HUONG DAN|SINH VIEN THUC HIEN|MSSV|MA SO SINH VIEN|LOP(?: SINH HOAT)?)\s*:/.test(key(s)));
    const tableRows=nodes.filter(e=>e.name==='w:tbl').flatMap(e=>$(e).children(tag('tr')).toArray()).map(e=>text($,e));
    const source=readCoverMetadata([...metadataLines,...tableRows].join('\n'));
    const values=['instructor','student','studentId','className'].map(n=>(options[n] || source[n] || '……………………').trim());
    const date=lines.find(s=>/THANG/.test(key(s)) && /NAM|\/20\d{2}/.test(key(s)) && !metadataLines.includes(s));
    const topicLines=lines.slice(titleIndex+1).filter(s=>!metadataLines.includes(s) && s!==date && !/^TEN (DE TAI|TIEU LUAN)/.test(key(s)));
    const topic=options.topic || topicLines.join(' ') || 'TÊN ĐỀ TÀI';
    const drawings=paras.flatMap(e=>$(e).find(`${tag('drawing')},${tag('pict')}`).toArray()).map(e=>$.xml(e));
    if(!drawings.length && /BINH DUONG/.test(key(institution)))drawings.push(defaultLogo(archive,++id));
    // Estimate wrapped lines to retain the requested 110/130pt spaces when they
    // fit, reducing whitespace for long topics without shrinking the text.
    const linesAt=(s,size,width)=>Math.max(1,Math.ceil(s.length*size*0.53/width));
    const org=[institution,...(institute?[institute]:[]),faculty.replace(/---oOo---/gi,'').trim()];
    const fixed=org.reduce((h,s)=>h+linesAt(s,15,482)*18+3,0)+18+drawings.length*120+35+25+linesAt(topic,20,482)*24+values.reduce((h,s)=>h+linesAt(s,14,222)*17+3,0)+24+24;
    const available=Math.max(24,710-fixed), ratio=Math.min(1,available/240);
    const metaGap=Math.round(110*ratio), dateGap=Math.round(130*ratio);
    let xml=org.map((s,i)=>paragraph(s,{size:15,bold:true,after:3,first:i===0})).join('')
      +paragraph('---oOo---',{size:14,bold:true,after:6})
      +drawings.map(d=>paragraph(`<w:r>${d}</w:r>`,{raw:true,after:6})).join('')
      +paragraph('ĐỒ ÁN TỐT NGHIỆP',{size:24,bold:true,after:12})
      +paragraph('Tên đề tài:',{size:16,italic:true,after:6})
      +paragraph(topic,{size:20,bold:true});
    // A dedicated spacer prevents empty paragraph height depending on Normal.
    xml+=`<w:p><w:pPr><w:pStyle w:val="WFGraduationCover"/><w:spacing w:before="0" w:after="0" w:line="${metaGap*20}" w:lineRule="exact"/></w:pPr></w:p>`;
    const labels=['Người hướng dẫn:','Sinh viên thực hiện:','Mã số sinh viên:','Lớp:'];
    const cell=(s,w,bold)=>`<w:tc><w:tcPr><w:tcW w:w="${w}" w:type="dxa"/><w:vAlign w:val="top"/></w:tcPr>${paragraph(s,{size:14,bold,align:'left',after:3})}</w:tc>`;
    xml+=`<w:tbl><w:tblPr><w:tblW w:w="7200" w:type="dxa"/><w:jc w:val="right"/><w:tblBorders>${['top','left','bottom','right','insideH','insideV'].map(n=>`<w:${n} w:val="nil"/>`).join('')}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:left w:w="0" w:type="dxa"/><w:right w:w="60" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid><w:gridCol w:w="2700"/><w:gridCol w:w="4500"/></w:tblGrid>${labels.map((s,i)=>`<w:tr><w:trPr><w:cantSplit/></w:trPr>${cell(s,2700,false)}${cell(values[i],4500,true)}</w:tr>`).join('')}</w:tbl>`;
    const dateText=options.month || options.year ? `${options.location || options.profile.cover.location}, tháng ${options.month || '…'} năm ${options.year || '…'}` : date || `${options.location || options.profile.cover.location}, tháng … năm …`;
    xml+=paragraph(dateText,{size:14,bold:true,before:dateGap});
    $(nodes[0]).before(xml);
    for(const e of nodes)$(e).remove();
  }
}
