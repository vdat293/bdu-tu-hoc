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

const xmlOf = ($, node) => $.xml(node);

function hasVisibleText($, node) {
  return $(node).find(tag('t')).toArray().some(textNode => $(textNode).text().trim());
}

function inlineTabCount($, paragraph) {
  return $(paragraph).children().toArray()
    .filter(node => node.name !== 'w:pPr')
    .reduce((count, node) => count + (node.name === 'w:tab'
      ? 1
      : $(node).find(tag('tab')).length), 0);
}

function cloneTableCellParagraphProperties($, paragraph) {
  const source = $(paragraph).children(tag('pPr')).first();
  if (!source.length) return '<w:pPr/>';
  const copy = $(`<w:pPr>${source.html() || ''}</w:pPr>`);
  // Table repair owns these properties. In particular, source tab stops and
  // paragraph-level bold must not leak back into a converted cell.
  for (const name of ['rPr', 'tabs', 'numPr', 'ind', 'jc']) children(copy, name).remove();
  return xmlOf($, copy[0]);
}

function splitTabbedParagraph($, paragraph) {
  const cells = [[]];
  let sawTab = false;
  let supported = true;

  const startCell = () => {
    cells.push([]);
    sawTab = true;
  };

  const appendRunParts = run => {
    const r = $(run);
    const sourceXml = xmlOf($, run);
    const opening = sourceXml.match(/^<w:r\b[^>]*>/)?.[0] || '<w:r>';
    const closing = '</w:r>';
    const rPr = r.children(tag('rPr')).first();
    const rPrXml = rPr.length ? xmlOf($, rPr[0]) : '';
    let content = [];
    const flush = () => {
      if (content.length) {
        cells.at(-1).push(`${opening}${rPrXml}${content.join('')}${closing}`);
        content = [];
      }
    };

    for (const node of r.contents().toArray()) {
      if (node.name === 'w:rPr') continue;
      if (node.name === 'w:tab') {
        flush();
        startCell();
      } else {
        content.push(xmlOf($, node));
      }
    }
    flush();
  };

  for (const node of $(paragraph).contents().toArray()) {
    if (node.name === 'w:pPr') continue;
    if (node.name === 'w:r') {
      appendRunParts(node);
    } else if (node.name === 'w:tab') {
      startCell();
    } else if ($(node).find(tag('tab')).length) {
      // Hyperlinks/content controls with embedded tabs need a richer tree
      // split; leave them untouched instead of corrupting their XML.
      supported = false;
    } else {
      cells.at(-1).push(xmlOf($, node));
    }
  }

  return { cells, sawTab, supported };
}

function cellText($, cellParts) {
  return $(cellParts.join('')).find(tag('t')).text().replace(/\s+/g, ' ').trim();
}

function rowHasUnsafeContent($, paragraph) {
  const p = $(paragraph);
  return p.find(`${tag('fldChar')},${tag('instrText')},${tag('fldSimple')},${tag('drawing')},${tag('pict')},${tag('object')},m\\:oMath,m\\:oMathPara`).length > 0;
}

function isLikelyTabbedTable($, rows, previous, next) {
  if (rows.length < 3) return false;
  const firstCount = rows[0].cells.length;
  if (firstCount < 2 || rows.some(row => !row.supported || !row.sawTab || row.cells.length !== firstCount)) return false;
  if (rows.some(row => row.unsafe)) return false;

  const values = rows.map(row => row.cells.map(parts => cellText($, parts)));
  const header = values[0];
  if (header.some(value => !value)) return false;
  const dataRows = values.slice(1).filter(row => row.some(value => value));
  if (dataRows.length < 2) return false;

  const captionAdjacent = [previous, next].some(node => node?.name === 'w:p'
    && /^Bảng(?:\s|:|$)/iu.test($(node).find(tag('t')).text().trim()));
  const headerWords = /^(?:stt|mã|ma|id|nhóm|nhom|nội dung|noi dung|vai trò|vai tro|mục tiêu|muc tieu|yêu cầu|yeu cau|bước|buoc|tuần|tuan|thành phần|thanh phan|ưu tiên|uu tien|tình huống|tinh huong|mã kiểm thử|ma kiem thu|nội dung cần ghi|pham vi|phạm vi)$/iu;
  const knownHeader = header.some(value => headerWords.test(value.trim()));
  const compactHeader = header.every(value => value.length <= 80);
  // A stable multi-row block with a compact first row is table-like even if
  // the LLM did not add a "Bảng" caption or Markdown separator.
  return captionAdjacent || knownHeader || compactHeader;
}

function buildTabbedTable($, rows, width = 9071) {
  const columnCount = rows[0].cells.length;
  const columns = Array.from({ length: columnCount }, () => Math.floor(width / columnCount));
  columns[columnCount - 1] += width - columns.reduce((sum, value) => sum + value, 0);
  const grid = columns.map(value => `<w:gridCol w:w="${value}"/>`).join('');
  const rowXml = rows.map(row => {
    const cells = row.cells.map((parts, index) => {
      const body = parts.length ? parts.join('') : '';
      const pPr = cloneTableCellParagraphProperties($, row.paragraph);
      return `<w:tc><w:tcPr><w:tcW w:w="${columns[index]}" w:type="dxa"/></w:tcPr><w:p>${pPr}${body}</w:p></w:tc>`;
    }).join('');
    return `<w:tr>${cells}</w:tr>`;
  }).join('');
  return $(`<w:tbl><w:tblPr><w:tblW w:w="${width}" w:type="dxa"/><w:tblLayout w:type="fixed"/></w:tblPr><w:tblGrid>${grid}</w:tblGrid>${rowXml}</w:tbl>`)[0];
}

/**
 * Convert LLM-pasted tabular prose into native Word tables.
 *
 * This is intentionally conservative: only contiguous blocks of at least
 * three paragraphs with a stable two-or-more-column shape are converted.
 * Paragraphs containing fields, drawings, equations, lists, or unsupported
 * nested tab content remain untouched. Native w:tbl trees are never rebuilt.
 */
export function convertTabbedTableBlocks($, body, options = {}) {
  const width = options.width || 9071;
  const childrenList = $(body).children().toArray();
  const blocks = [];
  let current = [];

  const flush = () => {
    if (current.length) blocks.push(current);
    current = [];
  };

  for (const node of childrenList) {
    if (node.name !== 'w:p' || inlineTabCount($, node) === 0 || !hasVisibleText($, node)) {
      flush();
      continue;
    }
    const split = splitTabbedParagraph($, node);
    current.push({
      paragraph: node,
      cells: split.cells,
      sawTab: split.sawTab,
      supported: split.supported,
      unsafe: rowHasUnsafeContent($, node)
    });
  }
  flush();

  let tablesConverted = 0;
  let rowsConverted = 0;
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    const first = block[0].paragraph;
    const previous = $(first).prev()[0];
    const last = block.at(-1).paragraph;
    const next = $(last).next()[0];
    if (typeof options.shouldConvert === 'function' && !options.shouldConvert(first, block)) continue;
    if (!isLikelyTabbedTable($, block, previous, next)) continue;
    const table = buildTabbedTable($, block);
    $(first).before(table);
    block.forEach(row => $(row.paragraph).remove());
    tablesConverted += 1;
    rowsConverted += block.length;
  }

  return { tablesConverted, rowsConverted };
}

export function repairDataTable($, table, width = 9071) {
  const t = $(table), rows = children(t, 'tr'), grid = children(t, 'tblGrid');
  const columns = children(grid, 'gridCol');
  // LLM-generated tables often omit tblGrid or use gridSpan/gridBefore. The
  // physical cell count alone then underestimates the logical column count.
  const rowWidth = row => {
    const r = $(row), rp = children(r, 'trPr');
    const before = Number(children(rp, 'gridBefore').attr('w:val') || 0);
    const after = Number(children(rp, 'gridAfter').attr('w:val') || 0);
    const cells = children(r, 'tc').toArray().reduce((total, cell) => {
      const cp = children($(cell), 'tcPr');
      return total + Math.max(1, Number(children(cp, 'gridSpan').attr('w:val') || 1));
    }, 0);
    return before + cells + after;
  };
  const count = Math.max(columns.length, ...rows.toArray().map(rowWidth), 0);
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
        // Every normalized data-table run uses 13 pt. Code tables retain their
        // source font family/tabs but still follow the requested table size.
        p.find(tag('r')).each((_,run)=>{
          const rpr=properties($(run),'rPr');
          set(rpr,'sz','<w:sz w:val="26"/>');
          set(rpr,'szCs','<w:szCs w:val="26"/>');
        });
        if(code)return; // Preserve monospaced code, tabs, and intentional spaces.
        set(pp,'jc',`<w:jc w:val="${hasHeader&&rowIndex===0?'center':'left'}"/>`);
        set(pp,'ind','<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
        p.find(tag('r')).each((_,run)=>{
          const rpr=properties($(run),'rPr');
          set(rpr,'rFonts','<w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/>');
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
    const p=$(rec.element), rawText=text(p);
    const match=rawText.match(/^(\s*)(Hình|Bảng)(?:\s+(\d+(?:[.\-]\d+)*)[.:–—-]\s*|\s*[:.\-–—-]\s*|\s+(\d+(?:[.\-]\d+)*)\s*$|\s*$)/iu);
    if(!match)continue;
    const kind=rec.role==='figure_caption'?'Hình':'Bảng', key=`${kind}:${rec.chapter}`;
    const ordinal=(counters.get(key)||0)+1;counters.set(key,ordinal);
    const label=`${kind} ${rec.chapter}-${ordinal}`;
    const oldNumber=match[3]||match[4];
    if(oldNumber) {
      const old=`${kind} ${oldNumber}`;
      if(!mappings.has(old))mappings.set(old,[]);
      mappings.get(old).push({chapter:rec.chapter,label});
    }
    // Caption labels are regenerated; description runs and bookmarks survive.
    // Remove old number fields before replacing the cached visible prefix.
    p.find(`${tag('fldChar')},${tag('instrText')}`).remove();
    p.find(tag('fldSimple')).each((_,e)=>$(e).replaceWith($(e).contents()));
    replaceVisibleRange($,p,0,match[0].length,'');
    const placeholder = kind === 'Bảng' ? '[Nhập tên bảng]' : '[Nhập tên hình]';
    if (!text(p).trim()) {
      p.append(`<w:r><w:rPr><w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman"/><w:sz w:val="26"/><w:szCs w:val="26"/><w:b w:val="0"/><w:i/><w:color w:val="000000"/></w:rPr><w:t>${placeholder}</w:t></w:r>`);
    }
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
    set(pp,'pStyle',`<w:pStyle w:val="${kind==='Bảng'?'WFTableCaption':'WFFigureCaption'}"/>`);
    set(pp,'ind','<w:ind w:left="0" w:right="0" w:firstLine="0"/>');
    set(pp,'jc','<w:jc w:val="center"/>');
    set(pp,'keepLines','<w:keepLines/>');
    set(pp,'keepNext',`<w:keepNext w:val="${kind==='Bảng'?1:0}"/>`);
    rec.displayText = `${kind} ${rec.chapter}-${ordinal}: ${text(p).trim()}`;
    rec.text = rec.displayText;
    const adjacent=direction=>{let n=p[direction]();while(n[0]?.name==='w:p'&&!text(n).trim()&&!n.find('w\\:drawing,w\\:pict').length)n=n[direction]();return n;};
    const isTbl=n=>n[0]?.name==='w:tbl';
    const isFig=n=>n.find('w\\:drawing,w\\:pict').length>0;
    const prev=adjacent('prev'),next=adjacent('next');
    if(kind==='Bảng'&&!isTbl(next)&&isTbl(prev)){prev.before(p);moved++;}
    if(kind==='Hình'&&!isFig(prev)&&isFig(next)){next.after(p);moved++;}
    if(kind==='Hình'){
      const obj=adjacent('prev');
      if(obj[0]?.name==='w:p'&&isFig(obj))set(properties(obj,'pPr'),'keepNext','<w:keepNext/>');
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
