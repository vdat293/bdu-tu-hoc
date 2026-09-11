import assert from 'node:assert/strict';
import { BduService } from '../src/services/bdu.service.js';

const originalFetch = globalThis.fetch;
const capturedRequests = [];

function session({ day, period, count, code, name, room, lecturer = 'GV BDU' }) {
  return {
    thu_kieu_so: day,
    tiet_bat_dau: period,
    so_tiet: count,
    ma_mon: code,
    ten_mon: name,
    so_tin_chi: '3',
    ma_nhom: '03',
    ten_giang_vien: lecturer,
    ma_phong: room
  };
}

let detailPayload = {
  ds_tuan_tkb: [
    {
      tuan_hoc_ky: 1,
      ngay_bat_dau: '07/09/2026',
      ngay_ket_thuc: '13/09/2026',
      ds_thoi_khoa_bieu: [
        session({ day: 2, period: 1, count: 5, code: 'INF1203', name: 'Hệ thống thông minh', room: 'BII.9-Tầng 2' }),
        // An exact upstream duplicate must not create another card.
        session({ day: 2, period: 1, count: 5, code: 'INF1203', name: 'Hệ thống thông minh', room: 'BII.9-Tầng 2' }),
        // A different room is a distinct occurrence and must not be removed by
        // the old subject/day/period-only dedupe rule.
        session({ day: 2, period: 1, count: 5, code: 'INF1203', name: 'Hệ thống thông minh', room: 'C4.0.2' }),
        session({ day: 3, period: 6, count: 5, code: 'INF0983', name: 'Nhập môn khoa học dữ liệu', room: 'C4.0.2' }),
        session({ day: 6, period: 1, count: 5, code: 'INF0103', name: 'Nhập môn Trí tuệ nhân tạo', room: 'AVI.1.G-AVI.1.G' }),
        session({ day: 6, period: 6, count: 5, code: 'INF1003', name: 'Điện toán đám mây', room: 'SMARTLAB' }),
        session({ day: 7, period: 1, count: 4, code: 'ENG1654', name: 'Tiếng Anh 5', room: 'BIII.14A' })
      ]
    },
    {
      tuan_hoc_ky: 2,
      ngay_bat_dau: '2026-09-14',
      ngay_ket_thuc: '2026-09-20',
      ds_thoi_khoa_bieu: [
        session({ day: 2, period: 1, count: 5, code: 'INF1203', name: 'Hệ thống thông minh', room: 'BII.9-Tầng 2' }),
        session({ day: 2, period: 11, count: 1, code: 'INF2001', name: 'Lớp tối', room: 'C4.0.2' })
      ]
    }
  ]
};

try {
  globalThis.fetch = async (url, options) => {
    capturedRequests.push({ url, options });

    if (url.includes('/sch/w-locdshockytkbuser')) {
      return {
        async json() {
          return {
            result: true,
            code: 200,
            data: {
              ds_hoc_ky: [
                { hoc_ky: 20261, ten_hoc_ky: 'Học kỳ 1 - Năm học 2026 - 2027' },
                { hoc_ky: 20253, ten_hoc_ky: 'Học kỳ 3 - Năm học 2025 - 2026' }
              ]
            }
          };
        }
      };
    }

    if (url.includes('/sch/w-locdstkbtuanusertheohocky')) {
      return {
        async json() {
          return { result: true, code: 200, data: detailPayload };
        }
      };
    }

    throw new Error(`Unexpected fetch call to: ${url}`);
  };

  const atFridayMorning = new Date('2026-09-11T02:49:00.000Z'); // 09:49 at Asia/Ho_Chi_Minh
  const schedule = await BduService.getSchedule('mock-token', null, { now: atFridayMorning });

  // The same two upstream endpoints and filter remain intact.
  assert.equal(capturedRequests.length, 2, 'Phải gọi 2 endpoint: lấy danh sách học kỳ và chi tiết TKB');
  assert.match(capturedRequests[0].url, /\/sch\/w-locdshockytkbuser$/);
  assert.equal(capturedRequests[0].options.headers.idpc, '0');
  assert.equal(capturedRequests[0].options.headers.Authorization, 'Bearer mock-token');
  assert.match(capturedRequests[1].url, /\/sch\/w-locdstkbtuanusertheohocky$/);
  assert.equal(JSON.parse(capturedRequests[1].options.body).filter.hoc_ky, 20261);

  assert.equal(schedule.isRealData, true);
  assert.equal(schedule.isLiveSchedule, true);
  assert.equal(schedule.isCurrentWeek, true);
  assert.equal(schedule.scheduleStatus, 'ongoing');
  assert.equal(schedule.selectedHocKy, 20261);
  assert.equal(schedule.semesters.length, 2);
  assert.deepEqual(schedule.week, {
    number: 1,
    startDate: '2026-09-07',
    endDate: '2026-09-13',
    startLabel: '07/09',
    endLabel: '13/09',
    label: 'Tuần 1'
  });

  // Friday 09:49 HCM: show only the in-progress class, later Friday and
  // Saturday. Monday/Tuesday and week 2 must never leak into this view.
  assert.deepEqual(schedule.items.map((item) => item.courseCode), ['INF0103', 'INF1003', 'ENG1654']);
  assert.equal(schedule.items[0].date, '2026-09-11');
  assert.equal(schedule.items[0].startAt, '2026-09-11T07:00:00+07:00');
  assert.equal(schedule.items[0].endAt, '2026-09-11T10:45:00+07:00');
  assert.equal(schedule.items[0].status, 'ongoing');
  assert.equal(schedule.items[0].room, 'AVI.1.G', 'Mã phòng bị lặp phải được hiển thị gọn một lần.');
  assert.equal(schedule.items[1].status, 'upcoming');
  assert.equal(schedule.items[2].day, 'Thứ 7');
  assert.equal(schedule.items[2].displayDate, '12/09');
  assert.equal(schedule.nextOccurrence.courseCode, 'INF0103');
  assert.equal(schedule.upcomingOccurrence.courseCode, 'INF1003', 'Khi đang học, môn kế tiếp phải là buổi chưa bắt đầu.');

  // The date is deliberately injected as UTC to prove that the normaliser uses
  // the Vietnam calendar, not the host's timezone.
  assert.equal(schedule.items.every((item) => item.date >= '2026-09-11'), true);

  const afterWeekOne = await BduService.getSchedule('mock-token', null, {
    now: new Date('2026-09-13T18:00:00+07:00')
  });
  assert.equal(afterWeekOne.isCurrentWeek, false);
  assert.equal(afterWeekOne.week.number, 2);
  assert.deepEqual(afterWeekOne.items.map((item) => item.courseCode), ['INF1203', 'INF2001']);
  assert.equal(afterWeekOne.items[0].date, '2026-09-14');
  assert.equal(afterWeekOne.items[1].startAt, '2026-09-14T17:45:00+07:00');
  assert.equal(afterWeekOne.items[1].endAt, '2026-09-14T18:30:00+07:00');

  const beforeMonday = await BduService.getSchedule('mock-token', null, {
    now: new Date('2026-09-07T06:00:00+07:00')
  });
  assert.equal(beforeMonday.items.filter((item) => item.date === '2026-09-07').length, 2,
    'Chỉ bản ghi giống hệt mới được dedupe; đổi phòng là một buổi học riêng.');

  detailPayload = {
    ds_tuan_tkb: [{
      tuan_hoc_ky: 1,
      ds_thoi_khoa_bieu: [session({ day: 6, period: 1, count: 5, code: 'INF0103', name: 'AI', room: 'AVI.1.G' })]
    }]
  };
  const unknownWeek = await BduService.getSchedule('mock-token', null, { now: atFridayMorning });
  assert.equal(unknownWeek.scheduleStatus, 'date_range_unavailable');
  assert.equal(unknownWeek.isLiveSchedule, false);
  assert.deepEqual(unknownWeek.items, []);

  console.log('✓ BDU Schedule Service selects only real upcoming occurrences in the current/next dated week');
} finally {
  globalThis.fetch = originalFetch;
}
