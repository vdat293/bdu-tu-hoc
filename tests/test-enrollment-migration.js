import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const file = path.join(root, 'migrations', '069_enrollment.sql');

let sql;
try {
  sql = readFileSync(file, 'utf8');
} catch (error) {
  console.error('Không đọc được migrations/069_enrollment.sql — migration chưa tồn tại?');
  process.exit(1);
}

assert.match(sql, /CREATE TABLE IF NOT EXISTS enrollment_priorities/i, 'Thiếu CREATE TABLE IF NOT EXISTS enrollment_priorities');
assert.match(sql, /CREATE TABLE IF NOT EXISTS enrollment_runs/i, 'Thiếu CREATE TABLE IF NOT EXISTS enrollment_runs');
assert.match(sql, /PRIMARY KEY\s*\(\s*mssv\s*,\s*id_to_hoc\s*\)/i, 'Thiếu PRIMARY KEY (mssv, id_to_hoc)');
assert.match(sql, /ON DELETE CASCADE/i, 'Thiếu ON DELETE CASCADE');
assert.match(sql, /loai[\s\S]*?IN\s*\(\s*'chinh'\s*,\s*'du_phong'\s*\)/i, 'Thiếu CHECK loai IN (chinh, du_phong)');
assert.match(sql, /status[\s\S]*?IN\s*\(\s*'scheduled'\s*,\s*'running'\s*,\s*'done'\s*,\s*'failed'\s*,\s*'stopped'\s*\)/i, 'Thiếu CHECK status');
assert.doesNotMatch(sql, /DROP\s+TABLE/i, 'Migration không được chứa DROP TABLE');
assert.match(sql, /CREATE INDEX IF NOT EXISTS enrollment_priorities_mssv_idx/i, 'Thiếu index priorities');
assert.match(sql, /CREATE INDEX IF NOT EXISTS enrollment_runs_mssv_idx/i, 'Thiếu index runs');

// Migration 070 chỉnh CHECK type của notification_outbox để nhận enrollment_alert.
const outboxSql = readFileSync(path.join(root, 'migrations', '070_enrollment_alert_outbox.sql'), 'utf8');
assert.match(outboxSql, /notification_outbox/i, 'Migration 070 phải nhắm notification_outbox');
assert.match(outboxSql, /enrollment_alert/i, 'Migration 070 phải thêm enrollment_alert');
assert.doesNotMatch(outboxSql, /DROP\s+TABLE/i, 'Migration 070 không được chứa DROP TABLE');

console.log('Migration 069: priorities + runs schema hợp lệ (idempotent, không DROP).');
