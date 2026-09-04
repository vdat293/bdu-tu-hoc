import assert from 'node:assert/strict';
import fs from 'node:fs';
import { IdentityAdminService } from '../src/services/identity-admin.service.js';
import { closeDatabase, query } from '../src/db/database.js';

const routes = fs.readFileSync('src/routes/api.routes.js', 'utf8');
const adminHtml = fs.readFileSync('public/admin-tool.html', 'utf8');
const adminJs = fs.readFileSync('public/js/admin-tool.js', 'utf8');
const apiJs = fs.readFileSync('public/js/api.js', 'utf8');
const configJson = JSON.parse(fs.readFileSync('src/config/identity-items.json', 'utf8'));

// 1. Kiểm tra cấu trúc code & routing
assert.match(routes, /post\('\/admin\/identity\/items'/);
assert.match(routes, /put\('\/admin\/identity\/items\/:id'/);
assert.match(routes, /delete\('\/admin\/identity\/items\/:id'/);

assert.match(adminHtml, /btn-open-create-item/);
assert.match(adminHtml, /item-editor-form/);

assert.match(adminJs, /createAdminIdentityItem/);
assert.match(adminJs, /updateAdminIdentityItem/);
assert.match(adminJs, /deleteAdminIdentityItem/);

assert.match(apiJs, /createAdminIdentityItem/);
assert.match(apiJs, /updateAdminIdentityItem/);
assert.match(apiJs, /deleteAdminIdentityItem/);

assert.ok(Array.isArray(configJson) && configJson.length > 0, 'Config JSON phải chứa danh sách item');

// 2. Kiểm tra database runtime
try {
  // Test 2.1: Đồng bộ từ JSON
  const syncResult = await IdentityAdminService.syncCatalogFromJson();
  assert.ok(typeof syncResult.synced === 'number', 'Kết quả đồng bộ phải có số lượng synced');

  // Đảm bảo có tài khoản owner/admin để test
  const testActor = '24050126';
  await query(`
    INSERT INTO students (mssv, full_name, is_active)
    VALUES ($1, 'Admin Test', TRUE)
    ON CONFLICT (mssv) DO NOTHING;
  `, [testActor]);
  await query(`
    INSERT INTO system_roles (mssv, role, is_active)
    VALUES ($1, 'identity_admin', TRUE)
    ON CONFLICT (mssv, role) DO UPDATE SET is_active = TRUE;
  `, [testActor]);

  // Test 2.2: Tạo item mới
  const testItemId = `frame:test-sukuna-${Date.now()}`;
  const created = await IdentityAdminService.createItem({
    id: testItemId,
    itemType: 'frame',
    label: 'Khung Thử Nghiệm Sukuna',
    description: 'Khung tạo tự động để test CRUD',
    rarity: 'legendary',
    assetKey: 'anime-sukuna',
    actorMssv: testActor
  });
  assert.equal(created.id, testItemId);
  assert.equal(created.label, 'Khung Thử Nghiệm Sukuna');

  // Test 2.3: Sửa item
  const updated = await IdentityAdminService.updateItem({
    id: testItemId,
    label: 'Khung Sukuna Đã Sửa',
    rarity: 'vip',
    actorMssv: testActor
  });
  assert.equal(updated.label, 'Khung Sukuna Đã Sửa');
  assert.equal(updated.rarity, 'vip');

  // Test 2.4: Xóa item (chưa có grant -> hard delete hoặc soft delete an toàn)
  const deleted = await IdentityAdminService.deleteItem({
    id: testItemId,
    actorMssv: testActor,
    reason: 'Test hoàn thành'
  });
  assert.equal(deleted.id, testItemId);
  assert.equal(deleted.deleted, true);

  console.log('✓ Hoàn tất kiểm thử Quản lý Catalog (Code-as-Config JSON + Web Admin CRUD)!');
} catch (error) {
  console.error('Lỗi kiểm thử Catalog CRUD:', error);
  throw error;
} finally {
  await closeDatabase();
}
