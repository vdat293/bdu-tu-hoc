import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { analyzeDocxStructure, formatStructuredDocx } from '../src/utils/docx-structure.js';
import { WordFmtService } from '../src/services/wordfmt.service.js';
import { readCoverMetadata } from '../src/utils/docx-graduation-cover.js';
import {captureProposalBlock} from '../src/utils/docx-proposal-preservation.js';

const temp=fs.mkdtempSync(path.join(os.tmpdir(),'wordfmt-graduation-'));
const W='http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const p=t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;
const tbl=t=>`<w:tbl><w:tblPr><w:tblW w:w="9071" w:type="dxa"/></w:tblPr><w:tblGrid><w:gridCol w:w="9071"/></w:tblGrid><w:tr><w:tc>${p(t)}</w:tc></w:tr></w:tbl>`;
const cover=p('TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG')+p('KHOA CNTT')+p('ĐỒ ÁN TỐT NGHIỆP')+p('Tên đề tài')+p('ĐỀ TÀI THỬ NGHIỆM')+p('Sinh viên thực hiện: Sinh viên');
const masthead=tbl('TRƯỜNG ĐẠI HỌC BÌNH DƯƠNG CỘNG HÒA XÃ HỘI CHỦ NGHĨA VIỆT NAM');
const proposalTable=`<w:tbl><w:tblPr><w:tblW w:w="8899" w:type="dxa"/><w:tblBorders><w:top w:val="double" w:sz="12"/></w:tblBorders></w:tblPr><w:tblGrid><w:gridCol w:w="4000"/><w:gridCol w:w="4899"/></w:tblGrid><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:pPr><w:ind w:left="357"/></w:pPr><w:r><w:rPr><w:sz w:val="23"/><w:i/></w:rPr><w:t>TÊN ĐỀ TÀI: A — B; Thời gian thực hiện: tháng 1 – tháng 2</w:t></w:r><w:hyperlink r:id="rLink"><w:r><w:t>Link đề cương</w:t></w:r></w:hyperlink></w:p></w:tc></w:tr></w:tbl>`;
const proposal=masthead+p('ĐỀ CƯƠNG ĐỒ ÁN TỐT NGHIỆP')+p('Nội dung ngoài khung — cũng giữ lại.')+proposalTable+tbl('VIỆN TRƯỞNG (Ký tên và ghi rõ họ tên)');
const rest=p('LỜI CẢM ƠN')+p('Nội dung cảm ơn.')+p('CHƯƠNG 1. NỘI DUNG')+p('1.1. Mục đầu')+p('Nội dung thân bài.')+p('CHƯƠNG 2. KẾT QUẢ');
const profile=JSON.parse(fs.readFileSync(new URL('../profiles/do_an_tot_nghiep.json',import.meta.url)));
const options={documentType:'do_an_tot_nghiep',profile,instructor:'GVHD',student:'Sinh viên',frontMatter:'cover,comments,thanks'};
function fixture(name,body) {
  const z=new AdmZip();
  z.addFile('word/document.xml',Buffer.from(`<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1701"/></w:sectPr></w:body></w:document>`));
  z.addFile('word/styles.xml',Buffer.from(`<w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="24"/></w:rPr></w:style></w:styles>`));
  z.addFile('word/_rels/document.xml.rels',Buffer.from(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rLink" Type="${R}/hyperlink" Target="https://example.com/proposal" TargetMode="External"/></Relationships>`));
  z.addFile('[Content_Types].xml',Buffer.from('<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'));
  const file=path.join(temp,name+'.docx');z.writeZip(file);return file;
}
function format(source,name,extra={}) {
  const file=path.join(temp,name+'.docx');
  const result=formatStructuredDocx(source,file,{...options,...extra});
  const a=analyzeDocxStructure(file);
  return {file,result,a,z:new AdmZip(file)};
}
function verify(out) {
  const {a,z}=out;
  assert.equal(a.records.filter(r=>r.styleId==='WFCoverStart').length,2);
  assert.equal(a.records.filter(r=>r.role==='cover' && r.text==='ĐỒ ÁN TỐT NGHIỆP').length,2);
  assert.deepEqual(a.records.filter(r=>r.role==='front_title' && r.text.startsWith('NHẬN XÉT')).map(r=>r.text),[
    'NHẬN XÉT CỦA GIẢNG VIÊN HƯỚNG DẪN','NHẬN XÉT CỦA GIẢNG VIÊN PHẢN BIỆN'
  ]);
  assert.equal(a.records.filter(r=>r.text==='(Ký và ghi rõ họ tên)').length,2);
  assert.deepEqual(a.chapters.map(r=>r.number),['1','2']);
  assert.ok(z.readAsText('word/document.xml').includes(proposalTable),'complete table XML, formatting and hyperlinks survive');
  assert.ok(z.readAsText('word/_rels/document.xml.rels').includes('rLink'),'protected hyperlink relationship survives');
  assert.ok(a.records.some(r=>r.text==='Nội dung ngoài khung — cũng giữ lại.'));
  assert.equal(a.$('w\\:pgNumType[w\\:start="1"][w\\:fmt="decimal"]').length,1);
  assert.equal(out.result.report.outputNormalization.compliance.proposalTablesPreserved,true);
}
try {
  assert.deepEqual(readCoverMetadata('GVHD: ThS. Dương Anh Tuấn\nSVTH: Trần Đăng Trị – 21050049 – 24TH01'),{
    instructor:'ThS. Dương Anh Tuấn',student:'Trần Đăng Trị',studentId:'21050049',className:'24TH01'
  });
  assert.equal(readCoverMetadata('Sinh viên thực hiện: Nguyễn Văn A\nMã số sinh viên: 22050101\nLớp sinh hoạt: 24TH01').className,'24TH01');
  const source=fixture('one-cover',cover+proposal+rest);
  const boxed=proposalTable.replace('TÊN ĐỀ TÀI: A — B;', 'TÊN ĐỀ TÀI: A — B; Cán bộ hướng dẫn (CBHD): GVHD;');
  const proseCopy=p('Tên đề tài: A — B')+p('Cán bộ hướng dẫn (CBHD): GVHD')+p('Thời gian thực hiện: tháng 1 – tháng 2')+p('1. Lý do chọn đề tài')+p('Bản trình bày rời không được xuất trước khung.');
  const framed=format(fixture('prose-before-frame',cover+masthead+p('ĐỀ CƯƠNG ĐỒ ÁN TỐT NGHIỆP')+proseCopy+boxed+rest),'framed');
  const proposalTitle=framed.a.records.find(r=>r.role==='proposal_title');
  assert.equal(framed.a.$(proposalTitle.element).next()[0].name,'w:tbl','boxed proposal immediately follows its title');
  assert.ok(framed.z.readAsText('word/document.xml').includes(boxed),'original boxed XML remains intact');
  assert.ok(!framed.a.records.some(r=>r.text.includes('Bản trình bày rời')),'no unboxed prose copy precedes the table');
  assert.equal(framed.result.report.structure.unboxedProposalParagraphsRemoved,5);
  assert.equal(format(framed.file,'framed-again').result.report.structure.unboxedProposalParagraphsRemoved,0);
  const out=format(source,'out');verify(out);
  assert.equal(out.result.report.structure.proposalSignaturesFormatted,1,'proposal signatures are formatted');
  const propSigTable = out.a.$('w\\:tbl').filter((_,e) => out.a.$(e).text().includes('VIỆN TRƯỞNG'));
  assert.equal(propSigTable.length,1,'proposal signature table exists');
  assert.equal(propSigTable.find('w\\:tblW').attr('w:w'),'9071','signature table has margin width 9071');
  assert.equal(propSigTable.find('w\\:gridCol').eq(0).attr('w:w'),'4050');
  assert.equal(propSigTable.find('w\\:gridCol').eq(1).attr('w:w'),'5021');
  assert.ok(propSigTable.text().includes('GV HƯỚNG DẪN'));
  assert.ok(propSigTable.text().includes('(Ký tên và ghi rõ họ tên)'));
  assert.equal(out.a.$('w\\:tab[w\\:leader="dot"]').length,40,'each blank review has 20 writing lines');
  assert.equal(out.a.$('w\\:pgBorders w\\:top[w\\:val="twistedLines1"]').length,2,'both covers use the approved Word art border twistedLines1');
  const coverBorders = out.a.$('w\\:pgBorders');
  assert.equal(coverBorders.eq(0).attr('w:offsetFrom'), 'page', 'Cover 1 uses offsetFrom page');
  assert.equal(coverBorders.eq(0).find('w\\:top').attr('w:space'), '31', 'Cover 1 uses space 31');
  assert.equal(coverBorders.eq(1).attr('w:offsetFrom'), 'page', 'Cover 2 uses offsetFrom page');
  assert.equal(coverBorders.eq(1).find('w\\:top').attr('w:space'), '31', 'Cover 2 uses space 31');
  assert.equal(out.a.$('w\\:sym[w\\:font="Wingdings"][w\\:char="F026"]').length,2,'both covers include the Wingdings decorative separator');
  assert.equal(out.a.$('w\\:drawing').length,3,'two cover logos and the existing thanks decoration');
  assert.ok(out.z.getEntry('word/media/wf-bdu-cover-logo.png'),'BDU logo is embedded, with no Downloads dependency');
  const instructorParas = out.a.body.children('w\\:p').filter((_,e)=>out.a.$(e).text().includes('Người hướng dẫn:'));
  const studentParas = out.a.body.children('w\\:p').filter((_,e)=>out.a.$(e).text().includes('Sinh viên thực hiện:'));
  const studentIdParas = out.a.body.children('w\\:p').filter((_,e)=>out.a.$(e).text().includes('Mã số sinh viên:'));
  const classParas = out.a.body.children('w\\:p').filter((_,e)=>out.a.$(e).text().includes('Lớp:'));
  assert.equal(instructorParas.length, 2, 'both covers have Người hướng dẫn');
  assert.equal(studentParas.length, 2, 'both covers have Sinh viên thực hiện');
  assert.equal(studentIdParas.length, 2, 'both covers have Mã số sinh viên');
  assert.equal(classParas.length, 2, 'both covers have Lớp');
  assert.equal(instructorParas.eq(0).find('w\\:ind').attr('w:left'), '3800', 'metadata is aligned with 3800 left indent');
  assert.equal(instructorParas.eq(0).find('w\\:tab').attr('w:pos'), '6500', 'metadata uses tab stop at 6500');
  assert.equal(instructorParas.eq(0).find('w\\:spacing').attr('w:before'), '1800', 'instructor has before 90pt (1800 dxa)');
  const docTypeParas = out.a.body.children('w\\:p').filter((_,e)=>out.a.$(e).text() === 'ĐỒ ÁN TỐT NGHIỆP');
  assert.equal(docTypeParas.eq(0).find('w\\:spacing').attr('w:before'), '320', 'docType has before 16pt (320 dxa)');
  assert.equal(docTypeParas.eq(0).find('w\\:spacing').attr('w:after'), '120', 'docType has after 6pt (120 dxa)');
  const ornamentParas = out.a.body.children('w\\:p').filter((_,e)=>out.a.$(e).find('w\\:sym[w\\:font="Wingdings"]').length > 0);
  assert.equal(ornamentParas.eq(0).find('w\\:spacing').attr('w:before'), '240', 'ornament has before 12pt (240 dxa)');
  assert.equal(ornamentParas.eq(0).find('w\\:spacing').attr('w:after'), '320', 'ornament has after 16pt (320 dxa)');
  const dateCoverParas = out.a.body.children('w\\:p').filter((_,e)=>out.a.$(e).text().includes('Thành phố Hồ Chí Minh, tháng'));
  assert.equal(dateCoverParas.eq(0).find('w\\:spacing').attr('w:before'), '3200', 'cover date line has before 160pt (3200 dxa)');
  assert.equal(out.result.report.structure.coversAdded,1);
  assert.equal(out.result.report.structure.reviewPagesAdded,2);
  const again=format(out.file,'again',{documentMode:'binding_package'});verify(again);
  assert.equal(captureProposalBlock(again.a).xml,captureProposalBlock(out.a).xml,'full proposal survives repeated processing');
  assert.equal(again.result.report.structure.coversAdded,0);
  assert.equal(again.result.report.structure.reviewPagesAdded,0);
  assert.equal(again.result.report.structure.signaturesAdded,0);
  assert.equal(again.result.report.structure.proposalSignaturesFormatted,0);


  assert.equal(again.a.$('w\\:drawing').length,out.a.$('w\\:drawing').length,'logos are not duplicated on repeat runs');
  assert.equal(again.a.$('w\\:sectPr').length,out.a.$('w\\:sectPr').length,'second run does not add pages/sections');
  const knownReview=p('NHẬN XÉT CỦA GIẢNG VIÊN HƯỚNG DẪN')+p('Đề tài đã hoàn thành tốt yêu cầu.')
    +tbl('GIẢNG VIÊN HƯỚNG DẪN')+p('NHẬN XÉT CỦA GIẢNG VIÊN PHẢN BIỆN')+p('…………………………………………')
    +p('Thành phố Hồ Chí Minh, ngày 12 tháng 05 năm 2026')+p('GIẢNG VIÊN PHẢN BIỆN')+p('(Ký và ghi rõ họ tên)')+p('Nguyễn Văn A');
  const two=format(fixture('two-covers',cover+cover+proposal+knownReview+rest),'two');verify(two);
  assert.equal(two.result.report.structure.coversAdded,0);
  assert.ok(two.a.records.some(r=>r.text==='Đề tài đã hoàn thành tốt yêu cầu.'));
  assert.ok(two.a.records.some(r=>r.text==='Nguyễn Văn A'),'existing signature name survives');
  assert.ok(two.a.records.some(r=>r.text==='Thành phố Hồ Chí Minh, ngày 12 tháng 05 năm 2026'),'date is retained, not replaced by current date');
  assert.equal(two.a.records.filter(r=>r.text==='GIẢNG VIÊN PHẢN BIỆN').length,1,'plain signature is not duplicated');
  const missing=format(fixture('missing-advisor',cover+proposal+p('NHẬN XÉT CỦA GIẢNG VIÊN PHẢN BIỆN')+tbl('GIẢNG VIÊN PHẢN BIỆN')+rest),'missing');verify(missing);
  assert.equal(missing.result.report.structure.reviewPagesAdded,1);
  const combined=cover.replace(p('Sinh viên thực hiện: Sinh viên'),p('GVHD: ThS. Dương Anh Tuấn SVTH: Trần Đăng Trị – 21050049 – 24TH01'));
  const separated=format(fixture('combined-metadata',combined+proposal+rest),'separated',{instructor:'ThS. Dương Anh Tuấn',student:'Trần Đăng Trị'});
  for(const item of [separated,format(separated.file,'separated-again',{instructor:'ThS. Dương Anh Tuấn',student:'Trần Đăng Trị'})]) {
    assert.equal(item.a.records.filter(r=>r.text.includes('21050049')).length,2,'MSSV is inferred and survives another formatting pass');
    assert.equal(item.a.records.filter(r=>r.text.includes('24TH01')).length,2,'class is separated and retained');
  }
  const styledSource=fixture('shared-style',cover+proposal.replace('<w:ind w:left="357"/>','<w:pStyle w:val="WFBody"/><w:ind w:left="357"/>')+rest);
  const styleZip=new AdmZip(styledSource);
  styleZip.updateFile('word/styles.xml',Buffer.from(styleZip.readAsText('word/styles.xml').replace('</w:styles>','<w:style w:type="paragraph" w:styleId="WFBody"><w:name w:val="Old body"/><w:rPr><w:sz w:val="18"/></w:rPr></w:style></w:styles>')));
  styleZip.writeZip(styledSource);
  const isolated=format(styledSource,'isolated');
  assert.equal(isolated.result.report.structure.proposalStylesIsolated,1);
  const sourceStyle=isolated.a.$('w\\:tbl').filter((_,e)=>isolated.a.$(e).find('w\\:t').text().includes('TÊN ĐỀ TÀI: A')).find('w\\:pStyle').attr('w:val');
  assert.match(sourceStyle,/^WFProposalSource/);
  assert.ok(isolated.z.readAsText('word/styles.xml').match(new RegExp(`w:styleId="${sourceStyle}"[\\s\\S]*?<w:sz w:val="18"`)),'protected style retains source size');
  assert.equal(format(isolated.file,'isolated-again').result.report.structure.proposalStylesIsolated,0,'isolated styles are reused');
  const simple=fixture('body-only',p('CHƯƠNG 1. NỘI DUNG')+p('Nội dung.'));
  const routed=await WordFmtService.formatDocx({inputPath:simple,instructor:'GVHD',student:'SV',documentType:'do_an_tot_nghiep',frontMatter:''});
  assert.equal(routed.report.appliedProfile.profileId,'do_an_tot_nghiep');
  assert.equal(routed.report.structure.coversAdded,2);
  assert.equal(routed.report.structure.reviewPagesAdded,2);
  assert.ok(routed.report.structure.warnings.some(s=>s.includes('chưa có đề cương')));
  fs.unlinkSync(routed.outputPath);
  await assert.rejects(WordFmtService.formatDocx({inputPath:simple,instructor:'A',student:'B',documentType:'invalid'}),/Loại tài liệu/);
  assert.throws(()=>format(fixture('ambiguous',cover+cover+cover+proposal+rest),'ambiguous-out'),/hơn hai bìa/);
  console.log('✅ Graduation: two covers, separate reviews, signatures/dates, protected proposal XML/links, repeat runs, routing and ambiguity checks.');
} finally { fs.rmSync(temp,{recursive:true,force:true}); }
