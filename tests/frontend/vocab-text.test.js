import { describe, expect, it } from 'vitest';
import { stripTermHints } from '../../client/src/features/vocab/vocab-text.js';

describe('vocab-text stripTermHints', () => {
  it('bỏ gợi ý chứa nguyên cụm từ', () => {
    expect(stripTermHints('Xin chào(Hi, there)', 'Hi there')).toBe('Xin chào');
  });

  it('bỏ gợi ý chứa một từ của cụm từ', () => {
    expect(stripTermHints('Xin chào(Hi)', 'Hi there')).toBe('Xin chào');
  });

  it('giữ chú thích tiếng Việt không chứa từ cần hỏi', () => {
    expect(stripTermHints('quán bar, thanh (kim loại), rào chắn', 'bar'))
      .toBe('quán bar, thanh (kim loại), rào chắn');
  });

  it('giữ nguyên nghĩa không có ngoặc', () => {
    expect(stripTermHints('quả táo', 'apple')).toBe('quả táo');
  });

  it('không trả về chuỗi rỗng nếu bỏ hết nội dung', () => {
    expect(stripTermHints('(hi)', 'hi')).toBe('(hi)');
  });

  it('dọn khoảng trắng và dấu câu sau khi bỏ ngoặc', () => {
    expect(stripTermHints('ngân hàng (bank) , chi nhánh', 'bank')).toBe('ngân hàng, chi nhánh');
  });
});
