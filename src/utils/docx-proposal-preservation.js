// Keep the proposal as one contiguous OOXML block, including internal blanks,
// nested tables, drawings, fields and breaks. Only its masthead is editable.
export function captureProposalBlock({$,body,records}) {
  const title=records.find(r=>r.role==='proposal_title');
  if(!title)return null;
  const top=e=>{while(e.parent && e.parent!==body[0])e=e.parent;return e;};
  const nodes=body.children().toArray(), first=top(title.element), start=nodes.indexOf(first);
  const next=records.find(r=>r.index>title.index && r.region!=='proposal' && !r.insideTable && !r.inIndex);
  let end=next?nodes.indexOf(top(next.element)):nodes.length-1;
  // The blank separator before the next review belongs to pagination, not to
  // proposal content. All interior blank paragraphs are preserved verbatim.
  while(end>start+1) {
    const n=$(nodes[end-1]);
    if(n[0].name!=='w:p' || n.find('w\\:t').text().trim() || n.find('w\\:drawing,w\\:pict,w\\:object').length)break;
    end--;
  }
  const block=nodes.slice(start,end), xml=block.map(e=>$.xml(e)).join('').replace(/&#x([0-9a-f]+);/gi,(m,n)=>Number.parseInt(n,16)>127?String.fromCodePoint(Number.parseInt(n,16)):m);
  let effective=null;
  for(const n of nodes.slice(end-1)) {
    const sec=n.name==='w:sectPr'?$(n):$(n).find('w\\:sectPr').first();
    if(sec.length){effective=sec;break;}
  }
  let sectionXml='';
  if(effective) {
    const clone=effective.clone(), inherited=new Map();
    for(const sec of body.find('w\\:sectPr').toArray()) {
      $(sec).children('w\\:headerReference,w\\:footerReference').each((_,e)=>inherited.set(e.name+$(e).attr('w:type'),$.xml(e)));
      if(sec===effective[0])break;
    }
    clone.children('w\\:headerReference,w\\:footerReference').remove();
    clone.prepend([...inherited.values()].join(''));
    // Joining the preserved source block to newly generated covers needs its
    // own page boundary. A source continuous section must not merge into a cover.
    clone.children('w\\:type').remove();
    clone.append('<w:type w:val="nextPage"/>');
    if(!clone.children('w\\:pgBorders').length)clone.append('<w:pgBorders>'+['top','left','bottom','right'].map(n=>`<w:${n} w:val="nil"/>`).join('')+'</w:pgBorders>');
    sectionXml=$.xml(clone);
  }
  return {first,last:block.at(-1),xml,sectionXml};
}

export function markProposalBlock(analysis,block) {
  analysis.$(block.first).before('<!--WF_PROPOSAL_START-->');
  analysis.$(block.last).after('<!--WF_PROPOSAL_END-->');
}

export function restoreProposalBlock(xml,block) {
  if(!block)return xml;
  const pattern=/<!--WF_PROPOSAL_START-->[\s\S]*?<!--WF_PROPOSAL_END-->/;
  if(!pattern.test(xml))throw new Error('Không thể xác minh vùng đề cương được giữ nguyên.');
  return xml.replace(pattern,()=>block.xml);
}
