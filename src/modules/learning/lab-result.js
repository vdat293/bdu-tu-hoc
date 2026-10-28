/**
 * Parser dòng kết quả lab BDU-LAB-V1:.
 *
 * Port faithful từ `C:/BDU/Năm 3/Cloud computing/aws-web-tut/assets/core.js`
 * (hàm parseLabResult): cùng regex một dòng duy nhất, cùng thứ tự kiểm tra và
 * cùng message lỗi tiếng Việt từng trường hợp. Khác duy nhất: giải base64 bằng
 * Buffer (Node) thay vì atob (browser), kèm kiểm tra round-trip vì
 * Buffer.from base64 khoan dung hơn atob.
 *
 * Chỉ đọc dữ liệu; tuyệt đối không thực thi nội dung người học dán vào.
 */

const LAB_TOKEN_PATTERN = /(?:^|\s)BDU-LAB-V1:([A-Za-z0-9+/]+={0,2})(?=\s|$)/g;
const LAB_FIELD_NAMES = ['STATUS', 'REGION', 'FE_IP', 'BE_IP', 'DB_ENDPOINT', 'FE_KEY_PATH', 'BE_KEY_PATH'];
const MAX_TEXT_LENGTH = 100000;
const MAX_TOKEN_LENGTH = 8192;

function fail(message) {
  throw new Error(message);
}

function isValidIpv4(value) {
  if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return false;
  return value.split('.').every((part) => Number(part) <= 255);
}

function decodeToken(captured) {
  const normalized = captured.replace(/\s+/g, '');
  if (normalized.length % 4 === 1) {
    fail('Dòng kết quả bị thiếu hoặc hỏng. Hãy copy lại toàn bộ dòng, không sửa nội dung.');
  }
  let decoded;
  try {
    decoded = Buffer.from(normalized, 'base64');
  } catch (err) {
    fail('Dòng kết quả bị thiếu hoặc hỏng. Hãy copy lại toàn bộ dòng, không sửa nội dung.');
  }
  const roundTrip = decoded.toString('base64');
  const canonical = (input) => input.replace(/=+$/, '');
  if (canonical(roundTrip) !== canonical(normalized)) {
    fail('Dòng kết quả bị thiếu hoặc hỏng. Hãy copy lại toàn bộ dòng, không sửa nội dung.');
  }
  return decoded.toString('utf8');
}

export function parseLabResult(text) {
  if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH) {
    fail('Kết quả quá dài hoặc không hợp lệ. Chỉ dán dòng bắt đầu bằng BDU-LAB-V1:.');
  }
  if (/PRIVATE KEY|BDU-RESTORE-BEGIN/.test(text)) {
    fail('Đây là nội dung key hoặc khối restore cũ. Hãy dán dòng BDU-LAB-V1: từ script mới.');
  }
  const matches = [...text.matchAll(LAB_TOKEN_PATTERN)];
  if (matches.length !== 1 || matches[0][1].length > MAX_TOKEN_LENGTH) {
    fail('Chưa tìm thấy một dòng kết quả đầy đủ. Copy nguyên dòng BDU-LAB-V1: ở cuối script mới rồi dán lại.');
  }
  const decoded = decodeToken(matches[0][1]);
  const fields = Object.create(null);
  decoded.trimEnd().split('\n').forEach((line) => {
    const at = line.indexOf('=');
    const key = line.slice(0, at);
    if (at < 1 || LAB_FIELD_NAMES.indexOf(key) === -1 || Object.prototype.hasOwnProperty.call(fields, key)) {
      fail('Khối kết quả có trường lạ hoặc trùng lặp. Hãy dùng kết quả từ script mới của bài học.');
    }
    fields[key] = line.slice(at + 1);
  });
  if (LAB_FIELD_NAMES.some((key) => !fields[key]) || fields.STATUS !== 'READY') {
    fail('Kết quả chưa đủ thông tin hoặc hạ tầng chưa tạo xong. Chờ script báo hoàn tất rồi copy lại.');
  }
  if (
    !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(fields.REGION) ||
    !isValidIpv4(fields.FE_IP) ||
    !isValidIpv4(fields.BE_IP) ||
    !/^[a-z0-9](?:[a-z0-9.-]{0,240})\.rds\.amazonaws\.com(?:\.cn)?$/.test(fields.DB_ENDPOINT)
  ) {
    fail('Địa chỉ kết nối trong kết quả không hợp lệ. Copy lại dòng kết quả từ CloudShell.');
  }
  ['FE', 'BE'].forEach((host) => {
    const path = fields[`${host}_KEY_PATH`];
    if (
      path.length > 512 ||
      !/^\/[a-zA-Z0-9_./ -]+$/.test(path) ||
      path.split('/').some((part) => part === '..' || part === '.') ||
      !path.endsWith(`/bdu-key-${host.toLowerCase()}.pem`)
    ) {
      fail('Đường dẫn key không hợp lệ. Hãy dùng nguyên dòng kết quả do script tạo ra.');
    }
  });
  return { ...fields, token: `BDU-LAB-V1:${matches[0][1]}` };
}
