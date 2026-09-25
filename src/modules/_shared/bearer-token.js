/**
 * Lấy token từ header `Authorization`.
 *
 * Trước khi tách controller, logic này tồn tại ở 4 bản sao trong
 * `api.controller.js` (getProfile, getSchedule, getSurveyForms, startSurveyRun)
 * cộng thêm một bản `getBearerToken()` không ai gọi. Hai trong số bốn bản sao
 * thiếu `.trim()`, nên token có khoảng trắng thừa sẽ fail xác thực một cách
 * khó chẩn đoán ở tầng BDU/Moodle thay vì báo lỗi ngay tại đây.
 *
 * Hàm thuần, không import gì.
 */
export function bearerToken(req) {
  const value = String(req?.headers?.authorization || '').trim();
  return value.startsWith('Bearer ') ? value.slice(7).trim() : value;
}
