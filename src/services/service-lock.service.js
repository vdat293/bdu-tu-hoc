import { FEATURE_GROUPS } from '../config/feature-groups.js';
import { SystemSettingsService } from './system-settings.service.js';

/**
 * "Nguồn sự thật" cho công tắc khóa dịch vụ bảo trì theo nhóm tính năng.
 *
 * Trạng thái nằm trong bảng system_settings (key service_lock) dạng
 * `{ groups: { <id>: { locked, title, message } } }` nên không thêm migration
 * và tắt/mở có hiệu lực tức thời (SystemSettingsService xoá cache mỗi lần
 * ghi). Service này là nơi DUY NHẤT biết shape, giá trị mặc định và chính sách
 * fail-open; middleware chặn request và API admin chỉ gọi lại các method ở đây.
 *
 * Vì sao fail-open: lỗi DB (hoặc chưa cấu hình DATABASE_URL) không được biến
 * thành sự cố toàn site. Nếu bảng setting tạm thời hỏng, ta coi như KHÔNG khóa
 * và để site phục vụ bình thường, thay vì trả 500 hàng loạt hoặc tự khóa oan.
 *
 * Vì sao giới hạn độ dài: title/message sẽ được trả nguyên văn ở endpoint công
 * khai `/api/status` (và cả trong phản hồi 503 cho mọi request bị chặn), nên chỉ
 * admin mới ghi được và nội dung phải bị chặn ở đây để không bơm chuỗi khổng lồ
 * ra ngoài.
 *
 * Vì sao giữ tương thích bản ghi cũ: trước đây value là `{ locked, title,
 * message }` phẳng (khóa toàn site). Nếu đọc shape đó mà coi như "mở" thì một
 * site đang bảo trì sẽ tự mở oan sau deploy. Vì vậy bản ghi cũ không có `groups`
 * mà đang `locked:true` được coi như cả 10 nhóm lockable cùng khóa với cùng
 * title/message.
 */

export const SERVICE_LOCK_SETTING_KEY = 'service_lock';

// Dùng khi chưa từng có bản ghi, và khi admin bật khóa mà không nhập nội dung.
export const DEFAULT_TITLE = 'Dịch vụ đang tạm khóa để bảo trì';
export const DEFAULT_MESSAGE = 'Hệ thống đang bảo trì, vui lòng quay lại sau.';

export const MAX_TITLE_LENGTH = 120;
export const MAX_MESSAGE_LENGTH = 500;

// Danh mục nhóm được phép khóa, suy ra từ taxonomy dùng chung để chỉ có MỘT
// nơi định nghĩa nhóm (bật/tắt `lockable` một mục là danh mục này tự khớp).
// Chỉ giữ `id` + `label` vì service khóa không cần biết tiền tố route.
export const LOCKABLE_GROUPS = FEATURE_GROUPS
  .filter((group) => group.lockable)
  .map((group) => ({ id: group.id, label: group.label }));

// Tra cứu nhanh group hợp lệ khi validate đầu vào ghi.
const LOCKABLE_GROUP_IDS = new Set(LOCKABLE_GROUPS.map((group) => group.id));

// Lỗi validate phải mang status = 400 để controller admin trả đúng mã.
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

// Chuẩn hoá một mục nhóm khi ĐỌC: khoan dung (sai kiểu/thiếu thì default) vì
// dữ liệu đọc có thể do tay người sửa trực tiếp trong DB, không được làm sập
// request chỉ vì một nhóm ghi sai shape.
function normalizeEntry(entry) {
  const record = entry && typeof entry === 'object' ? entry : {};
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

// Chuẩn hoá value thô trong DB thành map đủ 10 nhóm. Xử lý cả shape mới
// `{ groups: {...} }` (thiếu nhóm nào thì nhóm đó default mở) lẫn bản ghi
// legacy `{ locked, title, message }` không có `groups`.
function normalizeStatusMap(raw) {
  const groups = {};
  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (raw.groups === undefined || raw.groups === null) &&
    raw.locked === true
  ) {
    // Bản ghi legacy đang khóa toàn site: giữ tình trạng bảo trì bằng cách coi
    // như cả 10 nhóm cùng khóa với cùng title/message, tránh tự mở oan.
    const legacy = normalizeEntry(raw);
    for (const { id } of LOCKABLE_GROUPS) {
      groups[id] = { ...legacy };
    }
    return groups;
  }
  const stored =
    raw && typeof raw === 'object' && raw.groups && typeof raw.groups === 'object'
      ? raw.groups
      : {};
  for (const { id } of LOCKABLE_GROUPS) {
    groups[id] = normalizeEntry(stored[id]);
  }
  return groups;
}

export const ServiceLockService = {
  async getStatus() {
    try {
      const raw = await SystemSettingsService.get(SERVICE_LOCK_SETTING_KEY);
      return { groups: normalizeStatusMap(raw) };
    } catch {
      // Fail-open: coi như không khóa, tuyệt đối không ném lỗi ra request.
      return { groups: normalizeStatusMap(null) };
    }
  },

  /**
   * Trạng thái đầy đủ cho /admin: như getStatus() nhưng kèm danh mục nhóm
   * (`catalog`) để UI dựng danh sách công tắc, và metadata "ai ghi sau"
   * (updated_at/updated_by).
   *
   * Vì sao đọc record một lần thay vì ghép getStatus + getRecord: getStatus() đi
   * qua cache 30 giây còn getRecord đọc thẳng bảng, ghép lại có thể lệch thời
   * điểm (bản ghi vừa đổi). Đọc một lần record để map nhóm và metadata cùng một
   * nguồn.
   *
   * Fail-open giống getStatus(): lỗi DB không được biến thành sự cố màn hình
   * admin, chỉ trả giá trị mặc định với metadata null.
   */
  async getAdminStatus() {
    try {
      const record = await SystemSettingsService.getRecord(SERVICE_LOCK_SETTING_KEY);
      return {
        groups: normalizeStatusMap(record ? record.value : null),
        catalog: LOCKABLE_GROUPS.map((group) => ({ ...group })),
        updated_at: record && record.updated_at != null ? record.updated_at : null,
        updated_by: record && record.updated_by != null ? record.updated_by : null
      };
    } catch {
      return {
        groups: normalizeStatusMap(null),
        catalog: LOCKABLE_GROUPS.map((group) => ({ ...group })),
        updated_at: null,
        updated_by: null
      };
    }
  },

  /**
   * Bật/tắt khóa của ĐÚNG một nhóm. Đọc value hiện tại rồi merge nhóm đó (giữ
   * nguyên các nhóm khác) thay vì ghi đè toàn bộ, vì mỗi lần admin chỉ thao tác
   * một công tắc trên UI.
   */
  async setGroupStatus(payload, updatedBy) {
    const body = payload && typeof payload === 'object' ? payload : {};
    if (typeof body.group !== 'string' || !LOCKABLE_GROUP_IDS.has(body.group)) {
      throw validationError('Nhóm tính năng không hợp lệ hoặc không được phép khóa.');
    }
    if (typeof body.locked !== 'boolean') {
      throw validationError('Trường locked phải là boolean.');
    }

    const entry = {
      locked: body.locked,
      title: normalizeText(body.title, 'title', MAX_TITLE_LENGTH, DEFAULT_TITLE),
      message: normalizeText(body.message, 'message', MAX_MESSAGE_LENGTH, DEFAULT_MESSAGE)
    };

    const current = await SystemSettingsService.get(SERVICE_LOCK_SETTING_KEY);
    // Giữ nguyên các nhóm khác ở dạng thô đã lưu (chỉ chuẩn hoá khi đọc), để
    // lần ghi này không vô tình "sửa" dữ liệu nhóm không liên quan. Riêng bản
    // ghi legacy đang khóa toàn site thì bung thành đủ 10 nhóm trước khi merge,
    // nếu không các nhóm còn lại sẽ bị mở oan chỉ vì admin thao tác một nhóm.
    let stored;
    if (
      current &&
      typeof current === 'object' &&
      current.groups &&
      typeof current.groups === 'object'
    ) {
      stored = { ...current.groups };
    } else if (current && typeof current === 'object' && current.locked === true) {
      stored = normalizeStatusMap(current);
    } else {
      stored = {};
    }
    stored[body.group] = entry;
    const value = { groups: stored };

    const record = await SystemSettingsService.set(
      SERVICE_LOCK_SETTING_KEY,
      value,
      updatedBy
    );

    // Trả map đã chuẩn hoá đủ 10 nhóm để controller dùng ngay, không lộ cột key/value thô.
    return {
      groups: normalizeStatusMap(value),
      updated_at: record && record.updated_at != null ? record.updated_at : null,
      updated_by: record && record.updated_by != null ? record.updated_by : null
    };
  }
};
