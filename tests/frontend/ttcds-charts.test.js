import { describe, expect, it } from 'vitest';
import {
  attendanceRate,
  gioBatDau,
  gioKetThuc,
  gpaSeries,
  groupJournalByWeek,
  isoDow,
  latestJournalTerm,
  mondayKey,
  parseDay,
  shortGroupLabel,
  weekRangeLabel
} from '../../client/src/features/ttcds/ttcdsCharts.js';

describe('ttcdsCharts helpers', () => {
  it('parses days and finds monday keys', () => {
    expect(parseDay('2026-09-01')).not.toBeNull();
    expect(parseDay('not-a-date')).toBeNull();
    // 2026-09-01 là Thứ 3 → Thứ 2 đầu tuần là 2026-08-31.
    expect(mondayKey(parseDay('2026-09-01'))).toBe('2026-08-31');
    expect(mondayKey(parseDay('2026-09-07'))).toBe('2026-09-07');
    expect(weekRangeLabel('2026-08-31')).toBe('31/08–06/09');
  });

  it('picks the latest term that has journal rows', () => {
    expect(latestJournalTerm(null)).toBeNull();
    expect(latestJournalTerm([])).toBeNull();
    expect(latestJournalTerm([{ nkhk: 24251 }, { nkhk: 24252 }, {}])).toBe(24252);
  });

  it('groups journal by week, skipping ungraded sessions and bad dates', () => {
    const weeks = groupJournalByWeek([
      { ngay: '2026-09-01', diem_danh: 'Có mặt', co_mat: true },
      { ngay: '2026-09-03', diem_danh: 'Có mặt', co_mat: true },
      { ngay: '2026-09-08', diem_danh: 'Có mặt', co_mat: true },
      { ngay: '2026-09-10', diem_danh: 'Vắng', co_mat: false },
      { ngay: '2026-09-10', diem_danh: null, co_mat: false },
      { ngay: 'not-a-date', diem_danh: 'Có mặt', co_mat: true }
    ]);
    expect(weeks.length).toBe(2);
    expect(weeks[0]).toMatchObject({ key: '2026-08-31', total: 2, present: 2, rate: 100 });
    // Buổi null không tính vào mẫu: 2 đã chấm, 1 có mặt → 50%.
    expect(weeks[1]).toMatchObject({ key: '2026-09-07', total: 2, present: 1, rate: 50 });
  });

  it('keeps an ungraded-only week as a null-rate stub', () => {
    const weeks = groupJournalByWeek([{ ngay: '2026-09-08', diem_danh: null, co_mat: false }]);
    expect(weeks.length).toBe(1);
    expect(weeks[0].rate).toBeNull();
  });

  it('prefers he10 gpa scale and falls back to he4 without mixing', () => {
    expect(gpaSeries([
      { dtb_tich_luy_he_10: 7.5, dtb_tich_luy_he_4: 3.0 },
      { dtb_hk_he_10: 8.0 }
    ])).toEqual({ values: [7.5, 8.0], scale: 'thang 10' });
    expect(gpaSeries([{ dtb_tich_luy_he_4: 3.2 }])).toEqual({ values: [3.2], scale: 'thang 4' });
    expect(gpaSeries([])).toEqual({ values: [], scale: 'thang 4' });
  });

  it('computes attendance rates and period clocks', () => {
    expect(attendanceRate({ di_hoc: 18, vang: 2 })).toBe(90);
    expect(attendanceRate({ di_hoc: 0, vang: 0 })).toBeNull();
    expect(gioBatDau(1)).toBe('07:00');
    expect(gioBatDau(6)).toBe('13:00');
    expect(gioBatDau(99)).toBe('');
    // Qua khe trưa: tiết 6 + 5 tiết → cuối tiết 10 (16:00) + 45' = 16:45.
    expect(gioKetThuc(6, 5)).toBe('16:45');
    expect(gioKetThuc(1, 1)).toBe('07:45');
  });

  it('maps weekdays and short group labels', () => {
    expect(isoDow({ thu_kieu_so: 2 })).toBe(1);
    expect(isoDow({ thu_kieu_so: 8 })).toBe(7);
    expect(isoDow({ thu: 'Thứ 5' })).toBe(4);
    expect(isoDow({ thu: 'Chủ nhật' })).toBe(7);
    expect(isoDow({})).toBeNull();
    expect(shortGroupLabel('INF1063_24252_01')).toBe('01');
    expect(shortGroupLabel('03')).toBe('03');
  });
});
