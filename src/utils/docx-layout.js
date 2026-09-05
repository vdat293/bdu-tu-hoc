// Presentation rules shared by the structure-aware formatter. Never rebuild
// rows/cells: grid spans, vertical merges, nested tables and drawings are data.
const tag = n => `w\\:${n}`;
const children = (n, name) => n.children(tag(name));
const text = n => n.find(tag('t')).text();
function properties(n, name) {
  let p = children(n, name);
  if (!p.length) { n.prepend(`<w:${name}/>`); p = children(n, name); }
  return p;
}
function set(p, name, xml) { children(p, name).remove(); p.append(xml); }
export function repairDataTable($, table, width = 9071) {
  const t = $(table), rows = children(t, 'tr'), grid = children(t, 'tblGrid');
  const columns = children(grid, 'gridCol');
  const count = columns.length || Math.max(...rows.toArray().map(r => children($(r), 'tc').length));
  if (!count) return;
  const code = rows.length === 1 && children(rows.first(), 'tc').length === 1;
  const tp = properties(t, 'tblPr');
  for (const name of ['tblpPr','tblInd','tblStyle','tblLook','tblCellSpacing','tblOverlap']) children(tp, name).remove();
  set(tp,'tblStyle','<w:tblStyle w:val="TableGrid"/>');
  set(tp,'tblW',`<w:tblW w:w="${width}" w:type="dxa"/>`);
  set(tp,'jc','<w:jc w:val="center"/>');
  set(tp,'tblBorders','<w:tblBorders>'+['top','left','bottom','right','insideH','insideV'].map(s=>`<w:${s} w:val="single" w:sz="4" w:space="0" w:color="auto"/>`).join('')+'</w:tblBorders>');
  set(tp,'tblLayout','<w:tblLayout w:type="fixed"/>');
  set(tp,'tblCellMar','<w:tblCellMar>'+['top','bottom','left','right'].map(s=>`<w:${s} w:w="${s==='top'||s==='bottom'?90:120}" w:type="dxa"/>`).join('')+'</w:tblCellMar>');
  // Two-column use-case forms contain field/value pairs, not a header row.
  const first = children(rows.first(),'tc').toArray().map(c=>text($(c)).trim());
  const form = count===2 && (/^(?:Actor|Tác nhân|Mã use case|Tên use case|Use case|Mục tiêu|Sản phẩm ứng dụng)\b/iu.test(first[0] || '')
    || ((first[0]?.length || 0)<80 && (first[1]?.length || 0)>120));
  const hasHeader = !code && !form && rows.length>1;
  // Allocate column width from typical content length, with a lower bound so
  // narrow headers remain readable. Existing grids are retained for merged data.
  const merged = t.find(`${tag('gridSpan')},${tag('vMerge')},${tag('gridBefore')},${tag('gridAfter')}`).length>0;
  let weights = columns.toArray().map(c=>Number($(c).attr('w:w')) || 1);
  if (!merged && !code) {
    const lengths = Array.from({length:count},()=>[]);
    rows.each((_,r)=>children($(r),'tc').each((i,c)=>lengths[i]?.push(Math.min(100,text($(c)).trim().length))));
    weights = lengths.map(values=>Math.max(9, Math.sqrt(values.reduce((a,b)=>a+b,0)/Math.max(1,values.length))*4));
  }
  if (weights.length!==count) weights=Array(count).fill(1);
  const total=weights.reduce((a,b)=>a+b,0);let used=0;
  const widths=weights.map((v,i)=>{const n=i===count-1?width-used:Math.round(width*v/total);used+=n;return n;});
  if(!grid.length)t.children(tag('tblPr')).after('<w:tblGrid/>');
  children(t,'tblGrid').html(widths.map(w=>`<w:gridCol w:w="${w}"/>`).join(''));
  rows.each((rowIndex,row)=>{
    const r=$(row), rp=properties(r,'trPr');
    children(rp,'tblCellSpacing').remove();
    const rpex = children(r,'tblPrEx');
    if (rpex.length) {
      children(rpex,'tblCellSpacing').remove();
      children(rpex,'tblBorders').remove();
      children(rpex,'tblCellMar').remove();
    }
    children(rp,'trHeight').filter('[w\\:hRule="exact"]').attr('w:hRule','atLeast');
    // A large code cell must be allowed to flow over a page.
    set(rp,'cantSplit',`<w:cantSplit w:val="${code?0:1}"/>`);
    children(rp,'tblHeader').remove();
    if(hasHeader && rowIndex===0)set(rp,'tblHeader','<w:tblHeader/>');
    let col=Number(children(rp,'gridBefore').attr('w:val')||0);
    children(r,'tc').each((cellIndex,cell)=>{
      const c=$(cell), cp=properties(c,'tcPr'), span=Number(children(cp,'gridSpan').attr('w:val')||1);
      const cellWidth=widths.slice(col,col+span).reduce((a,b)=>a+b,0);col+=span;
      set(cp,'tcW',`<w:tcW w:w="${cellWidth}" w:type="dxa"/>`);
      children(cp,'noWrap').remove();
      children(cp,'tcBorders').remove();
      children(cp,'tcMar').remove();
      children(cp,'tcFitText').remove();
      set(cp,'vAlign',`<w:vAlign w:val="${code?'top':'center'}"/>`);
      if(!code) set(cp,'shd','<w:shd w:val="clear" w:fill="auto"/>');
      children(c,'p').each((_,el)=>{
        const p=$(el), pp=properties(p,'pPr');
        children(pp,'pBdr').remove();
        set(pp,'spacing','<w:spacing w:before="0" w:after="0" w:line="240" w:lineRule="auto"/>');
        set(pp,'keepNext',`<w:keepNext w:val="${hasHeader&&rowIndex===0?1:0}"/>`);
        if(code)return; // Preserve monospaced code, tabs, and intentional spaces.
        set(pp,'jc',`<w:jc w:val="${hasHeader&&rowIndex===0?'center':'left'}"/>`);
        set(pp,'ind','<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
        p.find(tag('r')).each((_,run)=>{
          const rpr=properties($(run),'rPr');
          set(rpr,'rFonts','<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>');
          set(rpr,'sz','<w:sz w:val="22"/>');set(rpr,'szCs','<w:szCs w:val="22"/>');
          if(hasHeader&&rowIndex===0)set(rpr,'b','<w:b/>');
        });
      });
    });
  });
}

// Replace a visible range across runs without discarding bookmarks or drawing
// nodes. Work from right to left for multiple replacements in one paragraph.
export function replaceVisibleRange($, p, start, end, replacement) {
  let offset=0, inserted=false;
  p.find(tag('t')).each((_,e)=>{
    const n=$(e), s=n.text(), from=offset, to=offset+s.length;offset=to;
    if(to<=start || from>=end)return;
    n.text(s.slice(0,Math.max(0,start-from))+(inserted?'':replacement)+s.slice(Math.max(0,end-from)));
    n.attr('xml:space','preserve');inserted=true;
  });
}

export function ensureAcknowledgementFrame($, paragraph) {
  const p=$(paragraph);
  if(p.find('w\\:drawing,w\\:pict').length)return false;
  const id=Math.max(930000,...$('wp\\:docPr').toArray().map(e=>Number($(e).attr('id'))||0))+1;
  p.append(`<w:r><w:drawing xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="251659264" behindDoc="1" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/><wp:positionH relativeFrom="page"><wp:posOffset>317500</wp:posOffset></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>-53340</wp:posOffset></wp:positionV><wp:extent cx="6921500" cy="8077200"/><wp:effectExtent l="0" t="0" r="58420" b="19050"/><wp:wrapNone/><wp:docPr id="${id}" name="WordFmt Acknowledgement Frame"/><wp:cNvGraphicFramePr/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:cNvSpPr/><wps:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="6921500" cy="8077200"/></a:xfrm><a:prstGeom prst="foldedCorner"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="19050"><a:solidFill><a:srgbClr val="030E13"/></a:solidFill><a:miter lim="800000"/></a:ln></wps:spPr><wps:bodyPr rot="0" vertOverflow="overflow" horzOverflow="overflow" vert="horz" wrap="square" lIns="91440" tIns="45720" rIns="91440" bIns="45720" numCol="1" anchor="ctr"/></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></w:r>`);
  return true;
}

export function normalizeStructuredCaptions($, records, warnings) {
  const counters=new Map(), mappings=new Map();let changed=0,moved=0;
  const captions=records.filter(r=>/_caption$/.test(r.role) && r.chapter!=null);
  for(const rec of captions) {
    const p=$(rec.element), match=text(p).match(/^(\s*)(Hình|Bảng)\s+(\d+(?:[.\-]\d+)*)\s*[.:]?\s*/iu);
    if(!match)continue;
    const kind=rec.role==='figure_caption'?'Hình':'Bảng', key=`${kind}:${rec.chapter}`;
    const ordinal=(counters.get(key)||0)+1;counters.set(key,ordinal);
    const label=`${kind} ${rec.chapter}-${ordinal}`;
    const old=`${kind} ${match[3]}`;
    if(!mappings.has(old))mappings.set(old,[]);
    mappings.get(old).push({chapter:rec.chapter,label});
    // Caption labels are regenerated; description runs and bookmarks survive.
    // Remove old number fields before replacing the cached visible prefix.
    p.find(`${tag('fldChar')},${tag('instrText')}`).remove();
    p.find(tag('fldSimple')).each((_,e)=>$(e).replaceWith($(e).contents()));
    replaceVisibleRange($,p,0,match[0].length,'');
    const labelXml=`<w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>${kind} ${rec.chapter}-</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> SEQ ${kind==='Hình'?'Hinh':'Bang'} ${ordinal===1?'\\r 1':'\\n'} \\* ARABIC </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t>${ordinal}</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:rPr><w:b/><w:i/></w:rPr><w:t xml:space="preserve">: </w:t></w:r>`;
    p.find(tag('r')).each((_,e)=>{
      const rp=properties($(e),'rPr');
      for(const name of ['rStyle','rFonts','sz','szCs','b','bCs','i','iCs','color'])children(rp,name).remove();
      rp.append('<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="26"/><w:szCs w:val="26"/><w:b w:val="0"/><w:i/><w:color w:val="000000"/>');
    });
    // Insert after leading bookmark starts so REF fields include the new label.
    let anchor=children(p,'pPr');
    while(anchor.next()[0]?.name==='w:bookmarkStart')anchor=anchor.next();
    anchor.after(labelXml);
    const pp=properties(p,'pPr');
    set(pp,'ind','<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
    set(pp,'jc','<w:jc w:val="center"/>');
    set(pp,'keepLines','<w:keepLines/>');
    set(pp,'keepNext',`<w:keepNext w:val="${kind==='Bảng'?1:0}"/>`);
    const adjacent=direction=>{let n=p[direction]();while(n[0]?.name==='w:p'&&!text(n).trim()&&!n.find('w\\:drawing,w\\:pict').length)n=n[direction]();return n;};
    const prev=adjacent('prev'),next=adjacent('next');
    const object=n=>n[0]?.name==='w:tbl'||n.find('w\\:drawing,w\\:pict').length>0;
    if(kind==='Bảng'&&next[0]?.name!=='w:tbl'&&prev[0]?.name==='w:tbl'){prev.before(p);moved++;}
    if(kind==='Hình'&&!object(prev)&&object(next)){next.after(p);moved++;}
    if(kind==='Hình'){
      const obj=adjacent('prev');
      if(obj[0]?.name==='w:p'&&object(obj))set(properties(obj,'pPr'),'keepNext','<w:keepNext/>');
      if(obj[0]?.name==='w:tbl')children(obj,'tr').last().find(tag('p')).each((_,e)=>set(properties($(e),'pPr'),'keepNext','<w:keepNext/>'));
    }
    changed++;
  }
  let referencesUpdated=0;
  for(const rec of records) {
    if(rec.inIndex||rec.region==='proposal'||rec.region==='cover'||/_caption$/.test(rec.role))continue;
    const p=$(rec.element), s=text(p), replacements=[];
    const targetFor=(kind,number)=>{
      const candidates=mappings.get(`${kind} ${number}`)||[];
      const local=candidates.filter(c=>c.chapter===rec.chapter);
      const targets=local.length===1?local:candidates;
      return targets.length===1?targets[0].label:null;
    };
    const ranges=[];
    for(const m of s.matchAll(/\b(Hình|Bảng)\s+(\d+\.\d+)\s*[-–—]\s*(\d+\.\d+)/gu)) {
      ranges.push([m.index,m.index+m[0].length]);
      const first=targetFor(m[1],m[2]), last=targetFor(m[1],m[3]);
      if(first&&last)replacements.push({start:m.index,end:m.index+m[0].length,label:`${first} – ${last.slice(m[1].length+1)}`});
    }
    for(const m of s.matchAll(/\b(Hình|Bảng)\s+(\d+(?:[.\-]\d+)*)/gu)) {
      if(ranges.some(([start,end])=>m.index>=start&&m.index<end))continue;
      const candidates=mappings.get(`${m[1]} ${m[2]}`)||[];
      const local=candidates.filter(c=>c.chapter===rec.chapter);
      const targets=local.length===1?local:candidates;
      if(targets.length===1&&m[0]!==targets[0].label)replacements.push({start:m.index,end:m.index+m[0].length,label:targets[0].label});
      else if(targets.length>1)warnings.push(`Tham chiếu ${m[0]} có nhiều đích; giữ nguyên để kiểm tra.`);
    }
    for(const r of replacements.sort((a,b)=>b.start-a.start)){replaceVisibleRange($,p,r.start,r.end,r.label);referencesUpdated++;}
  }
  return {captionsRenumbered:changed,captionPositionsCorrected:moved,captionReferencesUpdated:referencesUpdated};
}
