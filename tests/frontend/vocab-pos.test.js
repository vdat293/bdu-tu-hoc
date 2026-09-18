import { describe, expect, it } from 'vitest';
import {
  FUNCTION_WORD_POS,
  POS_CANONICAL,
  POS_CATEGORY,
  inferPos,
  normalizePos,
  normalizePosList,
  resolvePos
} from '../../src/utils/vocab-pos.js';

describe('vocab-pos normalizePos', () => {
  it('chuẩn hóa nhãn tiếng Việt sang canonical', () => {
    expect(normalizePos('Danh từ; Động từ')).toBe('noun, verb');
  });

  it('map alias viết tắt', () => {
    expect(normalizePos('n phr')).toBe('noun phrase');
    expect(normalizePos('phr v')).toBe('phrasal verb');
    expect(normalizePos('v, n')).toBe('verb, noun');
  });

  it('bỏ ngoặc đơn và giữ nhãn còn lại', () => {
    expect(normalizePos('Tính từ; Động từ (dạng quá khứ/phân từ II)')).toBe('adjective, verb');
  });

  it('dedupe nhãn trùng', () => {
    expect(normalizePos('Giới từ; Phó từ; Trạng từ')).toBe('preposition, adverb');
  });

  it('báo token không nhận diện được', () => {
    const result = normalizePosList('noun; đáng kể"');
    expect(result.list).toEqual(['noun']);
    expect(result.unknown).toEqual(['đáng kể']);
  });
});

describe('vocab-pos resolvePos', () => {
  it('sửa function word sai pos', () => {
    expect(resolvePos('at', 'noun').pos).toBe('preposition');
    expect(resolvePos('we', '').pos).toBe('pronoun');
    expect(resolvePos('every', 'adjective').pos).toBe('determiner');
  });

  it('giữ nhãn hợp lệ trong allowed-list', () => {
    expect(resolvePos('till', 'n').pos).toBe('noun');
    expect(resolvePos('may', 'Danh từ').pos).toBe('noun');
    expect(resolvePos('below', 'adjective').pos).toBe('adjective');
    expect(resolvePos('can', 'noun').pos).toBe('noun');
    expect(resolvePos('well', 'adjective').pos).toBe('adjective');
  });

  it('điền pos cho từ rỗng', () => {
    expect(resolvePos('what', '').pos).toBe('pronoun');
    expect(resolvePos('because', '').pos).toBe('conjunction');
    expect(resolvePos('should', '').pos).toBe('modal verb');
  });

  it('không suy diễn bừa cho từ không có trong từ điển', () => {
    expect(resolvePos('nonexistentword', '').pos).toBe('');
    expect(resolvePos('nonexistentword', '').source).toBe('empty');
  });

  it('gán category phrase cho cụm nhiều từ không có pos', () => {
    expect(resolvePos('come with someone', '').pos).toBe('phrase');
    expect(resolvePos('come with someone', '').source).toBe('category');
  });

  it('giữ nhãn đã chuẩn hóa của từ thường', () => {
    expect(resolvePos('destination', 'Danh từ').pos).toBe('noun');
  });

  it('không override các từ viết hoa không phải đại từ I', () => {
    expect(resolvePos('IT', 'n').pos).toBe('noun');
    expect(resolvePos('I', '').pos).toBe('pronoun');
  });
});

describe('vocab-pos từ điển', () => {
  it('phủ đủ danh sách canonical/category', () => {
    expect(POS_CANONICAL).toContain('modal verb');
    expect(POS_CANONICAL).toContain('auxiliary verb');
    expect(POS_CATEGORY).toContain('noun phrase');
    expect(POS_CATEGORY).toContain('structure');
  });

  it('inferPos trả pos chính', () => {
    expect(inferPos('at')).toBe('preposition');
    expect(inferPos('can')).toBe('modal verb');
    expect(inferPos('nonexistentword')).toBeNull();
  });

  it('phủ 113 function word từng rỗng', () => {
    const emptyWords = 'a about across after all along another any anybody around as back be before behind below beneath besides between beyond both but by can could despite down each either enough even except far few first for half he hello here how however I if in inside it just little many may mine more most much must near neither no none nothing now off on once one only or other ought out outside over past second several she should since so some something still such that the then there this though through till to today toward under unlike up very well what whatever when where whether which while why will within without yes yet'.split(' ');
    for (const word of emptyWords) {
      expect(FUNCTION_WORD_POS[word.toLowerCase()], `Thiếu ${word}`).toBeDefined();
    }
  });

  it('phủ 17 function word sai pos', () => {
    for (const word of 'at anything can during every everybody everyone into nobody nor okay per shall themselves they we would'.split(' ')) {
      expect(FUNCTION_WORD_POS[word], `Thiếu ${word}`).toBeDefined();
    }
  });

  it('giữ allowed-list cho từ đa nghĩa', () => {
    expect(FUNCTION_WORD_POS.till).toEqual(['preposition', 'conjunction', 'noun', 'verb']);
    expect(FUNCTION_WORD_POS.may).toEqual(['modal verb', 'noun']);
    expect(FUNCTION_WORD_POS.below).toEqual(['preposition', 'adverb', 'adjective']);
    expect(FUNCTION_WORD_POS.outside).toEqual(['preposition', 'adverb', 'noun', 'adjective']);
    expect(FUNCTION_WORD_POS.will).toEqual(['modal verb', 'noun', 'verb']);
    expect(FUNCTION_WORD_POS.back).toEqual(['adverb', 'noun', 'verb', 'adjective']);
    expect(FUNCTION_WORD_POS.one).toEqual(['number', 'determiner', 'pronoun']);
    expect(FUNCTION_WORD_POS.first).toEqual(['number', 'adjective', 'adverb']);
    expect(FUNCTION_WORD_POS.second).toEqual(['number', 'adjective', 'noun', 'adverb']);
  });
});
