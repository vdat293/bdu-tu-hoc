/**
 * Lịch đăng ký môn học theo kỳ — SET CỨNG tại đây, cập nhật mỗi kì khi trường
 * công bố lịch mới. Khóa = 2 số đầu MSSV (24xxxxxx → khóa 2024).
 *
 * Quy ước: mỗi kì có các "đợt" (round), mỗi đợt có các "cửa sổ" (window):
 *  - date: mở trong đúng ngày đó, từ hours.open đến hours.close
 *  - from/to: mở nhiều ngày (đợt bổ sung), mỗi ngày cùng khung giờ
 * Cửa sổ có `year` khớp đúng khóa; `toYear` nghĩa là "khóa <= toYear";
 * `all: true` là cửa sổ chung cho mọi khóa.
 */

export const DEFAULT_SEMESTER_KEY = '20262';

const SEMESTER_SCHEDULES = {
  '20262': {
    key: '20262',
    label: 'Học kỳ 2 - Năm học 2026 - 2027',
    hours: { open: '09:00', close: '20:00' },
    rounds: [
      {
        id: 'dot1',
        label: 'Đợt 1',
        windows: [
          { toYear: 2024, date: '2026-11-05', label: 'Khóa 2024 trở về trước' },
          { year: 2025, date: '2026-11-06', label: 'Khóa 2025' },
          { year: 2026, date: '2026-11-07', label: 'Khóa 2026' },
          { all: true, date: '2026-11-10', label: 'Các khóa đăng ký chung' }
        ]
      },
      {
        id: 'bo_sung',
        label: 'Đợt bổ sung',
        windows: [
          { all: true, from: '2026-11-30', to: '2026-12-01', label: 'Các khóa đăng ký chung' }
        ]
      }
    ]
  }
};

export function cohortYearFromMssv(mssv) {
  const digits = String(mssv || '').trim();
  if (!/^\d{8,}$/.test(digits)) return null;
  const yy = Number.parseInt(digits.slice(0, 2), 10);
  if (!Number.isInteger(yy)) return null;
  return 2000 + yy;
}

function toSlot(window, hours) {
  if (!window) return null;
  const first = window.date || window.from;
  const last = window.date || window.to;
  return {
    label: window.label || '',
    date: window.date || null,
    from: window.from || null,
    to: window.to || null,
    opensAt: `${first}T${hours.open}`,
    closesAt: `${last}T${hours.close}`
  };
}

export function getSemesterOptions() {
  return Object.values(SEMESTER_SCHEDULES).map((semester) => ({ key: semester.key, label: semester.label }));
}

export function resolveSchedule(mssv, semesterKey = DEFAULT_SEMESTER_KEY) {
  const semester = SEMESTER_SCHEDULES[semesterKey] || SEMESTER_SCHEDULES[DEFAULT_SEMESTER_KEY];
  const cohortYear = cohortYearFromMssv(mssv);
  const hours = semester.hours;
  const dot1 = semester.rounds.find((round) => round.id === 'dot1');
  const boSung = semester.rounds.find((round) => round.id === 'bo_sung');

  let primaryWindow = null;
  if (cohortYear != null) {
    primaryWindow = dot1.windows.find((window) => window.year === cohortYear) || null;
    if (!primaryWindow) primaryWindow = dot1.windows.find((window) => window.toYear != null && cohortYear <= window.toYear) || null;
  }
  if (!primaryWindow) primaryWindow = dot1.windows.find((window) => window.all) || null;

  const supplementaryWindow = boSung?.windows?.find((window) => window.all) || boSung?.windows?.[0] || null;

  return {
    semesterKey: semester.key,
    semesterLabel: semester.label,
    hours,
    cohortYear,
    primary: primaryWindow ? { roundId: 'dot1', roundLabel: dot1.label, ...toSlot(primaryWindow, hours) } : null,
    supplementary: supplementaryWindow ? { roundId: 'bo_sung', roundLabel: boSung.label, ...toSlot(supplementaryWindow, hours) } : null
  };
}
