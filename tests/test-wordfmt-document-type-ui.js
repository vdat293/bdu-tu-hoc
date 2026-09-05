import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {load} from 'cheerio';

const html=load(fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8'));
const js=fs.readFileSync(new URL('../public/js/app.js',import.meta.url),'utf8');
const ids=['wf-document-type','wf-doc-title','wf-include-cover','wf-include-comments','wf-cover-label','wf-comments-label','wf-document-type-hint','wf-document-mode','wf-binding-hint'];
const elements=new Map(ids.map(id=>{
  assert.equal(html('#'+id).length,1,`control ${id} exists once`);
  return [id,{value:html('#'+id).attr('value') || '',checked:true,disabled:false,readOnly:false,textContent:'',
    addEventListener(event,fn){this[event]=fn;},querySelector(){return this.option ||= {};}}];
}));
elements.get('wf-document-type').value='tieu_luan';
elements.get('wf-doc-title').value='TIỂU LUẬN MÔN HỌC';
elements.get('wf-include-comments').checked=false;
const start=js.indexOf('  const documentTypeSelect =');
const end=js.indexOf('  function createProgressSession()',start);
assert.ok(start>0 && end>start);
vm.runInNewContext(js.slice(start,end),{document:{getElementById:id=>elements.get(id)}});
const type=elements.get('wf-document-type');
type.value='do_an_tot_nghiep';type.change();
assert.equal(elements.get('wf-doc-title').value,'ĐỒ ÁN TỐT NGHIỆP');
assert.equal(elements.get('wf-doc-title').readOnly,true);
assert.equal(elements.get('wf-include-comments').checked,true);
assert.equal(elements.get('wf-include-comments').disabled,true);
assert.match(elements.get('wf-comments-label').textContent,/phản biện/);
assert.match(elements.get('wf-document-mode').option.textContent,/giữ hai trang bìa/);
type.value='tieu_luan';type.change();
assert.equal(elements.get('wf-doc-title').value,'TIỂU LUẬN MÔN HỌC');
assert.equal(elements.get('wf-doc-title').readOnly,false);
assert.equal(elements.get('wf-include-comments').checked,false,'returning to coursework preserves the previous choice');
assert.equal(elements.get('wf-include-comments').disabled,false);
assert.match(js,/formData\.append\('documentType', documentTypeSelect\?\.value \|\| 'tieu_luan'\)/);
console.log('✅ WordFmt document type UI: graduation controls, request value and restored coursework choices.');
