import { createHash, randomBytes } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { query, transaction } from '../../db/database.js';
import { findAccessibleCourse } from '../../services/learning.service.js';

const SECRET_PATTERN = /^[a-f0-9]{64}$/;
const SCRIPT_ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILENAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const DEFAULT_SCRIPTS = [{ id: 'thi-gk', label: 'Thi giữa kỳ' }];
const MAX_SCRIPT_BYTES = 16 * 1024 * 1024;
const MANIFEST = 'manifest.json';
const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const WEB_DIRECTORIES = ['public', 'dist/client', 'data/client-assets'].map((name) => path.join(REPO_ROOT, name));

function deployError(status, message) {
  return Object.assign(new Error(message), { status });
}

export function createDeploySecret() {
  return randomBytes(32).toString('hex');
}

export function hashDeploySecret(secret) {
  if (typeof secret !== 'string' || !SECRET_PATTERN.test(secret)) return null;
  return createHash('sha256').update(secret).digest('hex');
}

function insideDirectory(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

async function readPrivateFile(root, filename, maxBytes) {
  const resolved = await realpath(path.join(root, filename));
  if (!insideDirectory(root, resolved)) throw new Error('File nằm ngoài kho script.');
  const file = await open(resolved, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > maxBytes) throw new Error('Kích thước file không hợp lệ.');
    const buffer = await file.readFile();
    if (!buffer.length || buffer.length > maxBytes) throw new Error('Kích thước file không hợp lệ.');
    return buffer;
  } finally {
    await file.close();
  }
}

export async function loadScriptCatalog(directory = process.env.INF1003_SCRIPT_DIR) {
  if (!directory?.trim()) return { root: null, scripts: DEFAULT_SCRIPTS };
  try {
    if (!path.isAbsolute(directory)) throw new Error('Cần đường dẫn tuyệt đối.');
    const root = await realpath(directory);
    for (const webDirectory of WEB_DIRECTORIES) {
      const resolved = await realpath(webDirectory).catch((error) => {
        if (error.code === 'ENOENT') return webDirectory;
        throw error;
      });
      if (insideDirectory(resolved, root)) throw new Error('Kho script phải nằm ngoài thư mục phục vụ web.');
    }
    const scripts = JSON.parse((await readPrivateFile(root, MANIFEST, 32 * 1024)).toString('utf8'));
    if (!Array.isArray(scripts) || !scripts.length || scripts.length > 50) throw new Error('Danh sách script không hợp lệ.');
    const ids = new Set();
    for (const script of scripts) {
      if (typeof script?.id !== 'string' || !SCRIPT_ID_PATTERN.test(script.id) || ids.has(script.id)
          || typeof script.label !== 'string' || !script.label.trim() || script.label.length > 120
          || typeof script.file !== 'string' || !FILENAME_PATTERN.test(script.file)
          || script.file.toLowerCase() === MANIFEST) {
        throw new Error('Mục script không hợp lệ.');
      }
      ids.add(script.id);
    }
    return { root, scripts };
  } catch {
    throw deployError(503, 'Cấu hình kho script chưa hợp lệ. Vui lòng báo quản trị viên.');
  }
}

async function requireLessonEnabled(db = { query }) {
  const enabled = await db.query(
    "SELECT 1 FROM course_guide_configs WHERE course_code = 'INF1003' AND lesson_id = 'bai-2' AND enabled = TRUE"
  );
  if (!enabled.rowCount) throw deployError(404, 'Bài 2 chưa mở.');
}

export async function getDeployLesson(mssv) {
  await findAccessibleCourse(mssv, 'INF1003');
  await requireLessonEnabled();
  const { root, scripts } = await loadScriptCatalog();
  return { deliveryConfigured: Boolean(root), scripts: scripts.map(({ id, label }) => ({ id, label })) };
}

export async function issueDeployKey(mssv, requestedScriptId) {
  const key = createDeploySecret();
  const issued = await transaction(async (db) => {
    await findAccessibleCourse(mssv, 'INF1003', db);
    await requireLessonEnabled(db);
    const { scripts } = await loadScriptCatalog();
    const scriptId = requestedScriptId ?? scripts[0].id;
    if (!scripts.some(({ id }) => id === scriptId)) throw deployError(400, 'Script đã chọn không có trong Bài 2.');
    const result = await db.query(`INSERT INTO inf1003_deploy_keys (mssv, key_hash, script_id, expires_at)
      VALUES ($1, $2, $3, NOW() + INTERVAL '10 minutes')
      ON CONFLICT (mssv) DO UPDATE SET key_hash = EXCLUDED.key_hash, script_id = EXCLUDED.script_id,
        expires_at = EXCLUDED.expires_at, used_at = NULL, region = NULL, bucket = NULL
      RETURNING expires_at`, [mssv, hashDeploySecret(key), scriptId]);
    return { scriptId, expiresAt: result.rows[0].expires_at };
  });
  return { key, ...issued };
}

function invalidKey() {
  return deployError(400, 'Key không hợp lệ, đã dùng hoặc đã hết hạn.');
}

export async function redeemDeployKey(key) {
  const keyHash = hashDeploySecret(key);
  if (!keyHash) throw invalidKey();
  const selected = await query(`SELECT mssv, script_id FROM inf1003_deploy_keys
    WHERE key_hash = $1 AND script_id IS NOT NULL AND used_at IS NULL AND expires_at > clock_timestamp()`, [keyHash]);
  const issued = selected.rows[0];
  if (!issued) throw invalidKey();
  await requireLessonEnabled();
  await findAccessibleCourse(issued.mssv, 'INF1003');
  const { root, scripts } = await loadScriptCatalog();
  if (!root) throw deployError(503, 'Máy chủ chưa cấu hình kho script cho Bài 2.');
  const script = scripts.find(({ id }) => id === issued.script_id);
  if (!script) throw deployError(503, 'Script của key này hiện không có trong kho.');

  let content;
  try {
    content = await readPrivateFile(root, script.file, MAX_SCRIPT_BYTES);
  } catch {
    throw deployError(503, 'Máy chủ chưa đọc được script của key này.');
  }
  await transaction(async (db) => {
    await requireLessonEnabled(db);
    await findAccessibleCourse(issued.mssv, 'INF1003', db);
    const claimed = await db.query(`UPDATE inf1003_deploy_keys SET used_at = clock_timestamp()
      WHERE key_hash = $1 AND script_id = $2 AND used_at IS NULL AND expires_at > clock_timestamp()`,
    [keyHash, script.id]);
    if (!claimed.rowCount) throw invalidKey();
  });
  return { id: script.id, filename: script.file, content };
}
