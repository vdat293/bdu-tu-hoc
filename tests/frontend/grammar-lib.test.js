import { describe, expect, it } from 'vitest';

import {
  acceptedAnswers,
  formatCorrectAnswer,
  isAnswerCorrect,
  normalizeAnswer
} from '../../client/src/features/grammar/grammar-lib.js';

describe('grammar answer checking', () => {
  it('chấp nhận mọi đáp án ngăn cách bởi dấu |', () => {
    const correct = 'do|finish|complete';
    expect(isAnswerCorrect('fill_blank', 'do', correct)).toBe(true);
    expect(isAnswerCorrect('fill_blank', 'finish', correct)).toBe(true);
    expect(isAnswerCorrect('fill_blank', 'complete', correct)).toBe(true);
    expect(isAnswerCorrect('fill_blank', 'doing', correct)).toBe(false);
  });

  it('bỏ qua hoa thường, khoảng trắng, nháy cong và dấu câu cuối', () => {
    expect(isAnswerCorrect('fill_blank', '  Do  ', 'do|finish')).toBe(true);
    expect(isAnswerCorrect('fill_blank', "It’s", "It's")).toBe(true);
    expect(isAnswerCorrect('fill_blank', 'finish.', 'finish')).toBe(true);
  });

  it('đáp án hai chỗ trống dạng "A / B" vẫn khớp nguyên chuỗi', () => {
    expect(isAnswerCorrect('fill_blank', 'His / his', 'His / his')).toBe(true);
    expect(isAnswerCorrect('fill_blank', 'His', 'His / his')).toBe(false);
  });

  it('kết hợp | và / thì từng biến thể vẫn được chấp nhận', () => {
    const correct = 'Nobody / anyone | No-one / anybody';
    expect(isAnswerCorrect('fill_blank', 'Nobody / anyone', correct)).toBe(true);
    expect(isAnswerCorrect('fill_blank', 'no-one / anybody', correct)).toBe(true);
    expect(isAnswerCorrect('fill_blank', 'Nobody / anybody', correct)).toBe(false);
  });

  it('arrange_words ghép mảng thành câu trước khi so khớp', () => {
    expect(isAnswerCorrect('arrange_words', ['I', 'am', 'a', 'student'], 'I am a student')).toBe(true);
    expect(isAnswerCorrect('arrange_words', ['I', 'am', 'student'], 'I am a student')).toBe(false);
  });

  it('arrange_words cũng chấp nhận mọi phương án sắp xếp hợp lệ', () => {
    const correct = 'I like bread and milk|I like milk and bread';
    expect(isAnswerCorrect('arrange_words', ['I', 'like', 'bread', 'and', 'milk'], correct)).toBe(true);
    expect(isAnswerCorrect('arrange_words', ['I', 'like', 'milk', 'and', 'bread'], correct)).toBe(true);
    expect(isAnswerCorrect('arrange_words', ['I', 'like', 'and', 'bread', 'milk'], correct)).toBe(false);
  });

  it('không chấm đúng khi bỏ trống câu trả lời', () => {
    expect(isAnswerCorrect('fill_blank', '', '')).toBe(false);
    expect(isAnswerCorrect('fill_blank', '   ', 'do|finish')).toBe(false);
  });

  it('acceptedAnswers / formatCorrectAnswer xử lý dữ liệu bẩn', () => {
    expect(acceptedAnswers(' do | finish | ')).toEqual(['do', 'finish']);
    expect(acceptedAnswers('')).toEqual([]);
    expect(formatCorrectAnswer('do|finish|complete')).toBe('do / finish / complete');
    expect(formatCorrectAnswer('is')).toBe('is');
    expect(normalizeAnswer('  DON\'T  ')).toBe("don't");
  });
});
