import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const elements = new Map();
const createElement = id => {
  const node = {
    id,
    textContent: '',
    value: '',
    href: '',
    classList: { add() {}, remove() {} },
    removeAttribute(name) { delete this[name]; },
    setAttribute(name, value) { this[name] = value; }
  };
  elements.set(id, node);
};

['p-advisor-id', 'p-advisor-name', 'btn-mail-advisor'].forEach(createElement);

const sandbox = {
  console,
  document: {
    addEventListener() {},
    getElementById(id) { return elements.get(id) || null; }
  },
  window: {},
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  setTimeout,
  clearTimeout,
  setInterval() {},
  clearInterval() {},
  EventSource: class {},
  CustomEvent: class {},
  URL,
  Blob
};

vm.createContext(sandbox);
vm.runInContext(fs.readFileSync('public/js/app.js', 'utf8'), sandbox);
vm.runInContext(`renderProfile({
  data: {
    ho_ten: 'Sinh viên',
    ma_sinh_vien: '24050126',
    ma_cvht: '91044',
    ho_ten_cvht: 'Cố vấn BDU',
    email_cvht: 'advisor@bdu.edu.vn'
  }
})`, sandbox);

assert.equal(elements.get('p-advisor-id').textContent, '91044');
assert.equal(elements.get('p-advisor-name').textContent, 'Cố vấn BDU');
assert.equal(elements.get('btn-mail-advisor').href, 'mailto:advisor@bdu.edu.vn');

console.log('✓ Profile renderer resolves advisor fields without ReferenceError');
