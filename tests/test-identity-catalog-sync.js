import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import '../src/config/load-env.js';
import { closeDatabase, isDatabaseConfigured, query } from '../src/db/database.js';
import { IdentityAdminService } from '../src/services/identity-admin.service.js';

// 1. Kiểm tra tầng mã nguồn: sync phải gom cả catalog vào MỘT câu INSERT ...
//    SELECT (jsonb_to_recordset) thay vì một INSERT cho mỗi item.
const source = fs.readFileSync('src/services/identity-admin.service.js', 'utf8');
const syncStart = source.indexOf('async syncCatalogFromJson');
assert.ok(syncStart > 0, 'Không tìm thấy syncCatalogFromJson');
const syncBody = source.slice(syncStart, source.indexOf('\n  async ', syncStart));
assert.match(syncBody, /jsonb_to_recordset/, 'Sync phải dùng một câu INSERT ... SELECT cho cả catalog');
assert.equal(
  (syncBody.match(/INSERT INTO identity_items/g) || []).length,
  1,
  'Cả catalog phải đi qua đúng MỘT câu INSERT (không còn 1 INSERT mỗi item)'
);
assert.doesNotMatch(syncBody, /VALUES \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9/, 'Không còn INSERT VALUES theo từng item');
assert.match(syncBody, /identity_items\.metadata \|\| EXCLUDED\.metadata/, 'Giữ nguyên merge metadata khi conflict');
assert.match(syncBody, /!= 'admin_ui'/, 'Giữ nguyên bảo vệ metadata source=admin_ui');
assert.match(syncBody, /ON CONFLICT \(id\) DO UPDATE/, 'Giữ nguyên luật conflict theo id');

// 2. Integration thật với PostgreSQL (disposable test DB).
if (!isDatabaseConfigured() || !process.env.BDU_TEST_MODE) {
  console.log('Skipping integration: cần disposable test DB (BDU_TEST_DATABASE_URL + BDU_TEST_MODE).');
  process.exit(0);
}

const RUN = Date.now().toString(36);
const ID_A = `frame:sync-a-${RUN}`;
const ID_B = `capability:sync-b-${RUN}`;
const ID_ADMIN = `title:sync-admin-${RUN}`;
const IDS = [ID_A, ID_B, ID_ADMIN];

const fixture = [
  {
    id: ID_A,
    item_type: 'frame',
    label: 'Sync A (JSON)',
    rarity: 'legendary',
    asset_key: 'sync-a',
    sort_order: 7,
    metadata: { source: 'config' }
  },
  {
    id: ID_B,
    item_type: 'capability',
    label: 'Sync B (JSON)',
    metadata: { source: 'config', extra: 'from-json' }
  },
  {
    id: ID_ADMIN,
    item_type: 'title',
    label: 'KHÔNG ĐƯỢC GHI ĐÈ (admin_ui)',
    metadata: { source: 'config' }
  },
  { item_type: 'frame', label: 'Thiếu id nên bị bỏ qua' },
  { id: `frame:sync-missing-label-${RUN}`, item_type: 'frame' }
];

const fixturePath = path.join(os.tmpdir(), `bdu-identity-sync-${RUN}.json`);
const snapshot = async () => (await query(`
  SELECT id, item_type, label, description, rarity, asset_key, display_policy,
         metadata, is_active, sort_order, created_at, updated_at
  FROM identity_items
  WHERE id = ANY($1::text[])
  ORDER BY id;
`, [IDS])).rows;

// updated_at đổi mỗi lần ghi; "trạng thái DB giống nhau" so sánh mọi cột còn lại.
const stripVolatile = (rows) => rows.map((row) => {
  const copy = { ...row };
  delete copy.updated_at;
  return copy;
});

try {
  fs.writeFileSync(fixturePath, JSON.stringify(fixture), 'utf8');
  await query('DELETE FROM identity_items WHERE id = ANY($1::text[])', [IDS]);

  // Có sẵn 2 bản ghi: một bản config cũ (để kiểm tra merge + quyền ghi đè) và
  // một bản do Admin Tool tạo (metadata source=admin_ui, phải bất khả xâm phạm).
  await query(`
    INSERT INTO identity_items (id, item_type, label, rarity, sort_order, metadata, is_active, updated_at)
    VALUES ($1, 'frame', 'STALE', 'common', 1, $2::jsonb, FALSE, NOW());
  `, [ID_A, JSON.stringify({ source: 'config', legacy: 'keep' })]);
  const adminBefore = (await query(`
    INSERT INTO identity_items (id, item_type, label, metadata, is_active, updated_at)
    VALUES ($1, 'title', 'ADMIN UI LABEL', $2::jsonb, TRUE, NOW())
    RETURNING updated_at;
  `, [ID_ADMIN, JSON.stringify({ source: 'admin_ui', manual_grantable: false })])).rows[0];

  const first = await IdentityAdminService.syncCatalogFromJson(fixturePath);
  assert.equal(first.synced, 3, 'Chỉ đếm item hợp lệ (có id + item_type + label)');

  const rawFirst = await snapshot();
  const afterFirst = stripVolatile(rawFirst);
  assert.equal(afterFirst.length, 3, 'Cả 3 item hợp lệ phải có trong DB');

  const a = afterFirst.find((row) => row.id === ID_A);
  assert.equal(a.label, 'Sync A (JSON)', 'Item đã tồn tại phải được cập nhật từ JSON');
  assert.equal(a.rarity, 'legendary');
  assert.equal(a.asset_key, 'sync-a');
  assert.equal(a.sort_order, 7);
  assert.deepEqual(
    a.metadata,
    { source: 'config', legacy: 'keep' },
    'metadata phải merge (giữ khóa cũ, JSON bổ sung khóa mới)'
  );
  assert.equal(a.is_active, false, 'DO UPDATE giữ nguyên is_active như hành vi cũ (chỉ INSERT đặt TRUE)');

  const b = afterFirst.find((row) => row.id === ID_B);
  assert.equal(b.item_type, 'capability');
  assert.equal(b.description, '', 'description mặc định rỗng');
  assert.equal(b.rarity, 'common', 'rarity mặc định common');
  assert.equal(b.asset_key, null);
  assert.equal(b.display_policy, 'optional', 'display_policy mặc định optional');
  assert.equal(b.sort_order, 100, 'sort_order mặc định 100');
  assert.equal(b.is_active, true, 'Item mới phải active');
  assert.deepEqual(b.metadata, { source: 'config', extra: 'from-json' });

  const admin = rawFirst.find((row) => row.id === ID_ADMIN);
  assert.equal(admin.label, 'ADMIN UI LABEL', 'Item source=admin_ui không được ghi đè');
  assert.deepEqual(admin.metadata, { source: 'admin_ui', manual_grantable: false });
  assert.equal(
    new Date(admin.updated_at).getTime(),
    new Date(adminBefore.updated_at).getTime(),
    'Item source=admin_ui không được chạm updated_at'
  );

  // 2b. Idempotent: chạy lần hai cho ra đúng trạng thái DB như lần đầu.
  const second = await IdentityAdminService.syncCatalogFromJson(fixturePath);
  assert.equal(second.synced, 3);
  const afterSecond = stripVolatile(await snapshot());
  assert.deepEqual(afterSecond, afterFirst, 'Chạy lại sync phải cho trạng thái DB y hệt (idempotent)');

  const adminAfterSecond = afterSecond.find((row) => row.id === ID_ADMIN);
  assert.equal(adminAfterSecond.label, 'ADMIN UI LABEL');

  console.log('✓ Identity catalog sync: một câu INSERT ... SELECT cho cả catalog, giữ nguyên merge/metadata admin_ui, idempotent.');
} finally {
  fs.rmSync(fixturePath, { force: true });
  await query('DELETE FROM identity_items WHERE id = ANY($1::text[])', [IDS]).catch(() => {});
  await closeDatabase().catch(() => {});
}
