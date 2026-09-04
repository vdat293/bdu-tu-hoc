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
    classList: {
      _classes: new Set(),
      add(c) { this._classes.add(c); },
      remove(c) { this._classes.delete(c); },
      contains(c) { return this._classes.has(c); }
    },
    removeAttribute(name) { delete this[name]; },
    setAttribute(name, value) { this[name] = value; }
  };
  elements.set(id, node);
};

[
  'p-fullname', 'p-mssv', 'p-status', 'p-class', 'p-major', 'p-faculty',
  'p-education-level', 'p-cohort-years', 'p-advisor-id', 'p-advisor-name',
  'btn-mail-advisor', 'profile-student-photo', 'card-avatar', 'user-avatar',
  'hero-avatar', 'cfs-hero-avatar', 'cfs-composer-avatar', 'widget-user-avatar',
  'widget-user-name', 'widget-user-mssv', 'cfs-hero-username', 'cfs-hero-sub',
  'clan-quick-composer-avatar', 'clan-modal-author-avatar'
].forEach(createElement);

const sandbox = {
  console,
  document: {
    addEventListener() {},
    getElementById(id) { return elements.get(id) || null; },
    querySelector(sel) { return null; },
    querySelectorAll(sel) { return []; }
  },
  window: {},
  localStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  },
  sessionStorage: {
    _data: {},
    getItem(k) { return this._data[k] || null; },
    setItem(k, v) { this._data[k] = String(v); },
    removeItem(k) { delete this._data[k]; }
  },
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

const sampleBase64 = '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAQABADASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABQf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCqAAB//9k=';

vm.runInContext(`renderProfile({
  student_image: '${sampleBase64}',
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

// Test avatar rendering: student photo src must be valid data URI, not relative path
const photoEl = elements.get('profile-student-photo');
assert.ok(photoEl.src.startsWith('data:image/jpeg;base64,/9j/'), 'Profile photo must be data URI');

// Test presentation fallback: when presentation has no override, live BDU photo is preserved
vm.runInContext(`applyResolvedAvatarToCurrentUser({
  mssv: '24050126',
  name: 'Sinh viên',
  avatar_url: null,
  avatar_source: 'initials'
})`, sandbox);
assert.ok(elements.get('profile-student-photo').src.startsWith('data:image/jpeg;base64,/9j/'), 'BDU photo must remain when no override');

// Test presentation override: when override exists, it takes precedence
vm.runInContext(`applyResolvedAvatarToCurrentUser({
  mssv: '24050126',
  name: 'Sinh viên',
  avatar_url: '/media/avatars/24050126-custom.webp',
  avatar_source: 'override'
})`, sandbox);
assert.equal(elements.get('profile-student-photo').src, '/media/avatars/24050126-custom.webp', 'Override photo takes precedence');
assert.ok(elements.get('hero-avatar').innerHTML.includes('/media/avatars/24050126-custom.webp'), 'hero-avatar must be synced with override');
assert.ok(elements.get('user-avatar').innerHTML.includes('/media/avatars/24050126-custom.webp'), 'user-avatar must be synced with override');
assert.ok(elements.get('cfs-hero-avatar').innerHTML.includes('/media/avatars/24050126-custom.webp'), 'cfs-hero-avatar must be synced with override');
assert.ok(elements.get('cfs-composer-avatar').innerHTML.includes('/media/avatars/24050126-custom.webp'), 'cfs-composer-avatar must be synced with override');
assert.ok(elements.get('widget-user-avatar').innerHTML.includes('/media/avatars/24050126-custom.webp'), 'widget-user-avatar must be synced with override');
assert.ok(elements.get('clan-quick-composer-avatar').innerHTML.includes('/media/avatars/24050126-custom.webp'), 'clan-quick-composer-avatar must be synced with override');
assert.ok(elements.get('clan-modal-author-avatar').innerHTML.includes('/media/avatars/24050126-custom.webp'), 'clan-modal-author-avatar must be synced with override');

console.log('✓ Profile renderer resolves advisor fields and avatar fallback without ReferenceError');
