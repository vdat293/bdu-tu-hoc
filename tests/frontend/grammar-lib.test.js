import { describe, expect, it } from 'vitest';

import {
  acceptedAnswers,
  arrangePromptText,
  decodeHtmlEntities,
  formatCorrectAnswer,
  isAnswerCorrect,
  normalizeAnswer,
  parseArrangeWords,
  plainText
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

  it('arrange_words: chip dấu câu tách rời vẫn khớp đáp án', () => {
    expect(isAnswerCorrect('arrange_words', ['Can', 'you', 'help', 'me', '?'], 'Can you help me?')).toBe(true);
    expect(isAnswerCorrect('arrange_words', ['I', 'get', 'up', 'at', '6:30', '.'], 'I get up at 6:30.')).toBe(true);
    expect(isAnswerCorrect('arrange_words', ['Can', 'help', 'you', 'me', '?'], 'Can you help me?')).toBe(false);
  });

  it('arrange_words: bỏ qua dấu câu giữa câu trong đáp án', () => {
    expect(isAnswerCorrect(
      'arrange_words',
      ['Having', 'finished', 'the', 'training', 'she', 'received', 'a', 'certificate'],
      'Having finished the training, she received a certificate.'
    )).toBe(true);
    expect(isAnswerCorrect(
      'arrange_words',
      ['Having', 'finished', 'the', 'certificate', 'she', 'received', 'a', 'training'],
      'Having finished the training, she received a certificate.'
    )).toBe(false);
    expect(isAnswerCorrect(
      'arrange_words',
      ['Did', 'you', 'buy', 'that jacket?', 'in England'],
      'Did you buy that jacket in England?'
    )).toBe(true);
  });

  it('fill_blank vẫn giữ nguyên dấu câu giữa câu', () => {
    expect(isAnswerCorrect('fill_blank', 'When did you get married Diana', 'When did you get married, Diana')).toBe(false);
    expect(isAnswerCorrect('fill_blank', 'When did you get married, Diana', 'When did you get married, Diana')).toBe(true);
  });

  it('parseArrangeWords bỏ chú thích dịch trong ngoặc ở cuối câu hỏi', () => {
    const question = 'Sắp xếp các từ thành câu hoàn chỉnh: not / going / are / we / to / move / . (Chúng tôi sẽ không chuyển nhà.)';
    expect(parseArrangeWords(question, '')).toEqual(['not', 'going', 'are', 'we', 'to', 'move', '.']);
    expect(parseArrangeWords('Sắp xếp: a / I / am / student', 'a / I / am / student')).toEqual(['a', 'I', 'am', 'student']);
  });

  it('normalizeAnswer bỏ dấu cuối câu kèm khoảng trắng đứng trước', () => {
    expect(normalizeAnswer('Can you help me ?')).toBe('can you help me');
  });

  it('giải mã entity HTML khi hiển thị text thuần', () => {
    expect(decodeHtmlEntities('Điền: 5 -&gt; 6')).toBe('Điền: 5 -> 6');
    expect(decodeHtmlEntities('A &amp; B')).toBe('A & B');
    expect(plainText('<p>5 -&gt; 6</p>')).toBe('5 -> 6');
  });

  it('arrangePromptText ẩn danh sách từ lộ thứ tự đáp án, giữ chú thích dịch', () => {
    expect(arrangePromptText('Sắp xếp: staff / must / become / familiar')).toBe('Sắp xếp:');
    expect(arrangePromptText('Sắp xếp các từ thành câu hoàn chỉnh:<br>going / to / I / am / study / . (Tôi sẽ học ở thư viện.)'))
      .toBe('Sắp xếp các từ thành câu hoàn chỉnh: (Tôi sẽ học ở thư viện.)');
    expect(arrangePromptText('Sắp xếp các từ thành câu đúng: at / I / get up / 6:30 / .')).toBe('Sắp xếp các từ thành câu đúng:');
    expect(arrangePromptText(
      'Sắp xếp các tính từ theo đúng thứ tự. Oh, what a/an ... sculpture! (African, gorgeous, little)',
      'African / gorgeous / little'
    )).toBe('Sắp xếp các tính từ theo đúng thứ tự. Oh, what a/an ... sculpture!');
  });

  it('parseArrangeWords tách đúng khi trong từ có dấu hai chấm (6:30)', () => {
    expect(parseArrangeWords('Sắp xếp các từ thành câu đúng: at / I / get up / 6:30 / .', ''))
      .toEqual(['at', 'I', 'get up', '6:30', '.']);
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

  it('formatCorrectAnswer gộp biến thể trùng nhau sau chuẩn hoá', () => {
    expect(formatCorrectAnswer('Have you got an umbrella? | Have you got an umbrella'))
      .toBe('Have you got an umbrella?');
  });
});
