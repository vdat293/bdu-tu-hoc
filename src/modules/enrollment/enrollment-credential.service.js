/**
 * Mã hoá mật khẩu BDU cho từng lượt auto đăng ký.
 *
 * - AES-256-GCM, IV ngẫu nhiên 12 bytes.
 * - Key dẫn xuất từ NOTIFICATION_ENCRYPTION_KEY bằng HKDF-SHA256, tách miền
 *   với token vault (không dùng chung key trực tiếp).
 * - AAD gắn với run_id để ciphertext của lượt này không thể ghép sang lượt khác.
 * - Không log/không trả plaintext ra ngoài service này.
 */
import crypto from 'node:crypto';

const HKDF_INFO = 'enrollment-run-credential-v1';
const HKDF_SALT = Buffer.from('bdu-enrollment-credential');
const AAD_PREFIX = 'enrollment-run:';

function credentialError(message, code) {
  return Object.assign(new Error(message), { status: 503, code });
}

function getMasterKey() {
  const raw = String(process.env.NOTIFICATION_ENCRYPTION_KEY || '').trim();
  if (!raw) {
    throw credentialError(
      'Chưa cấu hình NOTIFICATION_ENCRYPTION_KEY để mã hoá mật khẩu auto đăng ký.',
      'CREDENTIAL_KEY_MISSING'
    );
  }
  try {
    const b64 = Buffer.from(raw, 'base64');
    if (b64.length === 32) return b64;
  } catch {
    /* fall through to utf8 */
  }
  const utf8 = Buffer.from(raw, 'utf8');
  if (utf8.length === 32) return utf8;
  throw credentialError(
    'NOTIFICATION_ENCRYPTION_KEY phải là 32 bytes (openssl rand -base64 32).',
    'CREDENTIAL_KEY_INVALID'
  );
}

function deriveKey() {
  const master = getMasterKey();
  return Buffer.from(crypto.hkdfSync('sha256', master, HKDF_SALT, HKDF_INFO, 32));
}

export function isCredentialKeyConfigured() {
  try {
    deriveKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptPassword(runId, password) {
  const key = deriveKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`${AAD_PREFIX}${runId}`));
  const encrypted = Buffer.concat([cipher.update(String(password), 'utf8'), cipher.final()]);
  return {
    enc_password: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    auth_tag: cipher.getAuthTag().toString('base64')
  };
}

export function decryptPassword(runId, row) {
  if (!row?.enc_password || !row?.iv || !row?.auth_tag) {
    throw credentialError('Thiếu dữ liệu mật khẩu đã mã hoá cho lượt chạy.', 'CREDENTIAL_INVALID');
  }
  const key = deriveKey();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(String(row.iv), 'base64'));
  decipher.setAAD(Buffer.from(`${AAD_PREFIX}${runId}`));
  decipher.setAuthTag(Buffer.from(String(row.auth_tag), 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(String(row.enc_password), 'base64')),
    decipher.final()
  ]);
  return decrypted.toString('utf8');
}
