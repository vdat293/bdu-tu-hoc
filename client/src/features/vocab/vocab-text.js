/**
 * Nghĩa tiếng Việt trong dữ liệu crawl đôi khi kèm gợi ý tiếng Anh trong ngoặc,
 * ví dụ "Xin chào(Hi, there)". Ở chế độ kiểm tra, phần gợi ý này làm lộ đáp án
 * nên cần bỏ đi trước khi hiển thị.
 *
 * Chỉ bỏ phần trong ngoặc có chứa từ/cụm từ đang hỏi; các chú thích tiếng Việt
 * như "thanh (kim loại)" vẫn được giữ nguyên.
 */
export function stripTermHints(meaning, term) {
  const value = String(meaning ?? '');
  const tokens = String(term ?? '').toLowerCase().match(/[a-z0-9]+/g) || [];
  if (!value || tokens.length === 0) return value;

  const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const looksLikeHint = (content) => {
    const lower = content.toLowerCase();
    return escaped.some((token) => (
      token.length >= 3
        ? lower.includes(token)
        : new RegExp(`\\b${token}\\b`, 'i').test(lower)
    ));
  };

  const cleaned = value
    .replace(/\s*\(([^()]*)\)/g, (full, inner) => (looksLikeHint(inner) ? '' : full))
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([,;.!?])/g, '$1')
    .trim();

  return cleaned || value;
}
