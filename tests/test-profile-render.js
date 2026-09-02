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

[
  'p-fullname', 'p-mssv', 'p-status', 'p-class', 'p-major', 'p-faculty',
  'p-education-level', 'p-cohort-years', 'p-advisor-id', 'p-advisor-name',
  'btn-mail-advisor'
].forEach(createElement);

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
    ten_day_du: 'Sinh viên',
    ma_sv: '24050126',
    ngay_sinh: '02/09/2003',
    gioi_tinh: 'Nam',
    hien_dien_sv: 'Đang học',
    lop: '27TH03',
    nganh: 'Công nghệ thông tin',
    khoa: 'Khoa Tin học',
    bac_he_dao_tao: 'Chính quy',
    nien_khoa: '2024 - 2028',
    ma_cvht: '91044',
    ho_ten_cvht: 'Cố vấn BDU',
    email_cvht: 'advisor@bdu.edu.vn'
  }
})`, sandbox);

assert.equal(elements.get('p-fullname').textContent, 'Sinh viên');
assert.equal(elements.get('p-mssv').textContent, '24050126');
assert.equal(elements.get('p-status').textContent, 'Đang học');
assert.equal(elements.get('p-class').textContent, '27TH03');
assert.equal(elements.get('p-major').textContent, 'Công nghệ thông tin');
assert.equal(elements.get('p-faculty').textContent, 'Khoa Tin học');
assert.equal(elements.get('p-education-level').textContent, 'Chính quy');
assert.equal(elements.get('p-cohort-years').textContent, '2024 - 2028');
assert.equal(elements.get('p-advisor-id').textContent, '91044');
assert.equal(elements.get('p-advisor-name').textContent, 'Cố vấn BDU');
assert.equal(elements.get('btn-mail-advisor').href, 'mailto:advisor@bdu.edu.vn');

console.log('✓ Profile renderer resolves advisor fields without ReferenceError');
