import { SystemSettingsService } from './system-settings.service.js';

/**
 * "Nguồn sự thật" cho công tắc khóa dịch vụ bảo trì.
 *
 * Trạng thái nằm trong bảng system_settings (key service_lock) nên không thêm
 * migration và tắt/mở có hiệu lực tức thời (SystemSettingsService xoá cache mỗi
 * lần ghi). Service này là nơi DUY NHẤT biết shape, giá trị mặc định và chính
 * sách fail-open; middleware chặn request và API admin chỉ gọi lại hai method ở
 * đây.
 *
 * Vì sao fail-open: lỗi DB (hoặc chưa cấu hình DATABASE_URL) không được biến
 * thành sự cố toàn site. Nếu bảng setting tạm thời hỏng, ta coi như KHÔNG khóa
 * và để site phục vụ bình thường, thay vì trả 500 hàng loạt hoặc tự khóa oan.
 *
 * Vì sao giới hạn độ dài: title/message sẽ được trả nguyên văn ở endpoint công
 * khai `/api/status` (và cả trong phản hồi 503 cho mọi request bị chặn), nên chỉ
 * admin mới ghi được và nội dung phải bị chặn ở đây để không bơm chuỗi khổng lồ
 * ra ngoài.
 */

export const SERVICE_LOCK_SETTING_KEY = 'service_lock';

// Dùng khi chưa từng có bản ghi, và khi admin bật khóa mà không nhập nội dung.
export const DEFAULT_TITLE = 'Dịch vụ đang tạm khóa để bảo trì';
export const DEFAULT_MESSAGE = 'Hệ thống đang bảo trì, vui lòng quay lại sau.';

export const MAX_TITLE_LENGTH = 120;
export const MAX_MESSAGE_LENGTH = 500;

// Lỗi validate phải mang status = 400 để controller admin (Task 5) trả đúng mã.
function validationError(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

// Chuẩn hoá một trường nội dung: bỏ trống thì dùng default, sai kiểu hoặc quá dài thì 400.
function normalizeText(value, field, maxLength, fallback) {
  if (value === undefined) return fallback;
  if (value === null) {
    throw validationError(`${field} không được là null.`);
  }
  if (typeof value !== 'string') {
    throw validationError(`${field} phải là chuỗi.`);
  }
  const trimmed = value.trim();
  if (trimmed.length > maxLength) {
    throw validationError(`${field} tối đa ${maxLength} ký tự.`);
  }
  return trimmed.length ? trimmed : fallback;
}

function normalizeStatus(raw) {
  const record = raw && typeof raw === 'object' ? raw : {};
  return {
    locked: record.locked === true,
    title:
      typeof record.title === 'string' && record.title.trim()
        ? record.title.trim()
        : DEFAULT_TITLE,
    message:
      typeof record.message === 'string' && record.message.trim()
        ? record.message.trim()
        : DEFAULT_MESSAGE
  };
}

export const ServiceLockService = {
  async getStatus() {
    try {
      const raw = await SystemSettingsService.get(SERVICE_LOCK_SETTING_KEY);
      return normalizeStatus(raw);
    } catch {
      // Fail-open: coi như không khóa, tuyệt đối không ném lỗi ra request.
      return { locked: false, title: DEFAULT_TITLE, message: DEFAULT_MESSAGE };
    }
  },

  async setStatus(payload, updatedBy) {
    const body = payload && typeof payload === 'object' ? payload : {};
    if (typeof body.locked !== 'boolean') {
      throw validationError('Trường locked phải là boolean.');
    }

    const value = {
      locked: body.locked,
      title: normalizeText(body.title, 'title', MAX_TITLE_LENGTH, DEFAULT_TITLE),
      message: normalizeText(body.message, 'message', MAX_MESSAGE_LENGTH, DEFAULT_MESSAGE)
    };

    const record = await SystemSettingsService.set(
      SERVICE_LOCK_SETTING_KEY,
      value,
      updatedBy
    );

    // Trả shape phẳng mà controller admin tiêu thụ, không lộ cột key/value thô.
    return {
      locked: value.locked,
      title: value.title,
      message: value.message,
      updated_at: record && record.updated_at != null ? record.updated_at : null,
      updated_by: record && record.updated_by != null ? record.updated_by : null
    };
  }
};
