import assert from 'node:assert/strict';
import fs from 'node:fs';
import { IdentityPresentationInternals } from '../src/services/identity-presentation.service.js';

const catalog = IdentityPresentationInternals.buildTitleCatalog({
  cumulative_classification: 'Xuất sắc',
  rankings: {
    tong_hop: {
      truong: { hang: 11, tong_sinh_vien: 1800 },
      vien: { hang: 2, tong_sinh_vien: 450 }
    },
    gpa_tich_luy: {
      lop: { hang: 1, tong_sinh_vien: 40 }
    }
  },
  clans: [{ id: 7, name: 'CLB Công nghệ', tag: 'TECH', role: 'leader' }],
  achievements: [{
    id: 'scholar',
    label: '#Học bá',
    description: 'Đạt loại Xuất sắc trong ít nhất 3 học kỳ.',
    tone: 'gold',
    rarity: 'legendary',
    sort_order: 20,
    unlocked_at: '2026-09-04T00:00:00.000Z',
    evidence: { qualifying_count: 3 }
  }]
});

assert.ok(catalog.some((title) => title.id === 'member:bdu'));
assert.ok(catalog.some((title) => title.id === 'rank:tong_hop:vien'));
assert.ok(catalog.some((title) => title.id === 'rank:gpa_tich_luy:lop'));
assert.ok(catalog.some((title) => title.id === 'clan:7:leader'));
assert.ok(catalog.some((title) => title.id === 'achievement:scholar'));
assert.equal(catalog.find((title) => title.id === 'achievement:scholar').evidence.qualifying_count, 3);
assert.equal(catalog.find((title) => title.id === 'achievement:scholar').rarity, 'legendary');
assert.ok(catalog.some((title) => title.label === 'Học lực Xuất sắc'));
assert.equal(catalog.some((title) => title.id === 'rank:tong_hop:truong'), false, 'Hạng ngoài Top 10 không phải danh hiệu');
assert.equal(IdentityPresentationInternals.MAX_DISPLAYED_TITLES, 4);

assert.equal(
  IdentityPresentationInternals.normalizeAvatarUrl('/images/student.jpg'),
  'https://sv.bdu.edu.vn/images/student.jpg'
);
assert.equal(IdentityPresentationInternals.normalizeAvatarUrl('javascript:alert(1)'), null);
assert.equal(IdentityPresentationInternals.normalizeAvatarUrl('data:image/png;base64,AAAA'), null);

const migration = fs.readFileSync('migrations/006_student_identity_presentation.sql', 'utf8');
assert.match(migration, /avatar_url/);
assert.match(migration, /displayed_title_ids/);

console.log('✓ Danh hiệu hiển thị chỉ lấy từ quyền sở hữu thật và giới hạn tối đa 4.');
