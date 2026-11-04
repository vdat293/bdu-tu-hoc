import { describe, expect, it } from 'vitest';
import { parseTkb, sessionOf, tkbMatchesDay, tkbMatchesSession, tkbBadges } from '../../client/src/features/enrollment/tkb.js';

const TKB = 'Thứ 3,tiết 1->3,Ph AI.2,GV QT050,29/12/26 đến 26/01/27<hr>Thứ 5,tiết 6->10,Ph B.1,GV QT001,01/03/27';

describe('parseTkb', () => {
  it('tách đúng thứ + tiết cho từng đoạn <hr>', () => {
    const segs = parseTkb(TKB);
    expect(segs).toEqual([
      { thu: 3, startPeriod: 1, endPeriod: 3 },
      { thu: 5, startPeriod: 6, endPeriod: 10 }
    ]);
  });

  it('nhận Chủ nhật là thứ 8', () => {
    expect(parseTkb('Chủ nhật,tiết 1->5,Ph X,01/01/27')).toEqual([{ thu: 8, startPeriod: 1, endPeriod: 5 }]);
  });

  it('chuỗi rác trả về []', () => {
    expect(parseTkb('')).toEqual([]);
    expect(parseTkb(null)).toEqual([]);
    expect(parseTkb('không có lịch')).toEqual([]);
  });
});

describe('buổi', () => {
  it('tiết 1–5 là sáng, 6–10 là chiều, 11+ là tối', () => {
    expect(sessionOf({ startPeriod: 1 })).toBe('morning');
    expect(sessionOf({ startPeriod: 5 })).toBe('morning');
    expect(sessionOf({ startPeriod: 6 })).toBe('afternoon');
    expect(sessionOf({ startPeriod: 10 })).toBe('afternoon');
    expect(sessionOf({ startPeriod: 11 })).toBe('evening');
  });

  it('lọc theo buổi đúng khi một môn có nhiều đoạn', () => {
    expect(tkbMatchesSession(TKB, 'morning')).toBe(true);
    expect(tkbMatchesSession(TKB, 'afternoon')).toBe(true);
    expect(tkbMatchesSession(TKB, 'evening')).toBe(false);
    expect(tkbMatchesSession(TKB, 'all')).toBe(true);
  });
});

describe('lọc theo thứ', () => {
  it('khớp nếu bất kỳ đoạn nào rơi vào thứ được chọn', () => {
    expect(tkbMatchesDay(TKB, 3)).toBe(true);
    expect(tkbMatchesDay(TKB, 5)).toBe(true);
    expect(tkbMatchesDay(TKB, 4)).toBe(false);
    expect(tkbMatchesDay(TKB, 0)).toBe(true);
  });

  it('môn không đọc được lịch không khớp bộ lọc thứ cụ thể', () => {
    expect(tkbMatchesDay('không có lịch', 3)).toBe(false);
    expect(tkbMatchesDay('không có lịch', 0)).toBe(true);
  });
});

describe('tkbBadges', () => {
  it('hiển thị nhãn ngắn và khử trùng lặp', () => {
    expect(tkbBadges(TKB)).toEqual(['T3 · 1–3', 'T5 · 6–10']);
    expect(tkbBadges(`${TKB}<hr>Thứ 3,tiết 1->3,Ph AI.2,GV QT050,23/02/27`)).toEqual(['T3 · 1–3', 'T5 · 6–10']);
    expect(tkbBadges('')).toEqual([]);
  });
});
