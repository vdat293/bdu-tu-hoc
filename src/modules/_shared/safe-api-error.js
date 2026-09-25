/**
 * Sanitize message lỗi trả về cho client.
 *
 * Đây là hàng rào chống rò rỉ thông tin: message từ lỗi hạ tầng hoặc thư viện
 * có thể chứa URL nội bộ, `sesskey` (Moodle), header `authorization`, cookie,
 * mật khẩu, token hoặc stack trace. Trả về client bất kỳ thứ nào trong số đó
 * là lộ cấu hình production.
 *
 * Hàm thuần, không import gì — có thể dùng ở mọi domain mà không tạo
 * phụ thuộc vòng.
 */
export function safeApiErrorMessage(error, fallback = 'Thao tác không thành công.') {
  const message = String(error?.message || '').trim();
  if (!message || message.length > 240) return fallback;
  if (/https?:\/\/|sesskey|authorization|cookie|password|access[_-]?token|refresh[_-]?token|stack trace/i.test(message)) {
    return fallback;
  }
  return message;
}
