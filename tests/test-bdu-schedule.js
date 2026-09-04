import assert from 'node:assert/strict';
import { BduService } from '../src/services/bdu.service.js';

const originalFetch = globalThis.fetch;
const capturedRequests = [];

try {
  globalThis.fetch = async (url, options) => {
    capturedRequests.push({ url, options });

    // Mock endpoint 1: w-locdshockytkbuser
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

    // Mock endpoint 2: w-locdstkbtuanusertheohocky
    if (url.includes('/sch/w-locdstkbtuanusertheohocky')) {
      const body = JSON.parse(options.body);
      return {
        async json() {
          return {
            result: true,
            code: 200,
            data: {
              ds_tuan_tkb: [
                {
                  tuan_hoc_ky: 1,
                  ds_thoi_khoa_bieu: [
                    {
                      thu_kieu_so: 2,
                      tiet_bat_dau: 1,
                      so_tiet: 5,
                      ma_mon: 'INF1203',
                      ten_mon: 'Hệ thống thông minh',
                      so_tin_chi: '3',
                      ma_nhom: '03',
                      ten_giang_vien: 'Dương Anh Tuấn',
                      ma_phong: 'BII.9-Tầng 2 - Tòa nhà B (cơ sở 1)'
                    },
                    {
                      thu_kieu_so: 3,
                      tiet_bat_dau: 6,
                      so_tiet: 5,
                      ma_mon: 'INF0983',
                      ten_mon: 'Nhập môn khoa học dữ liệu',
                      so_tin_chi: '3',
                      ma_nhom: '03',
                      ten_giang_vien: 'Huỳnh Quang Đức',
                      ma_phong: 'C4.0.2'
                    }
                  ]
                },
                {
                  tuan_hoc_ky: 2,
                  ds_thoi_khoa_bieu: [
                    // Same session recurring next week
                    {
                      thu_kieu_so: 2,
                      tiet_bat_dau: 1,
                      so_tiet: 5,
                      ma_mon: 'INF1203',
                      ten_mon: 'Hệ thống thông minh',
                      so_tin_chi: '3',
                      ma_nhom: '03',
                      ten_giang_vien: 'Dương Anh Tuấn',
                      ma_phong: 'BII.9-Tầng 2 - Tòa nhà B (cơ sở 1)'
                    }
                  ]
                }
              ]
            }
          };
        }
      };
    }

    throw new Error(`Unexpected fetch call to: ${url}`);
  };

  const schedule = await BduService.getSchedule('mock-token', null);

  // 1. Verify requests made
  assert.equal(capturedRequests.length, 2, 'Phải gọi 2 endpoint: lấy danh sách học kỳ và chi tiết TKB');
  assert.match(capturedRequests[0].url, /\/sch\/w-locdshockytkbuser$/);
  assert.equal(capturedRequests[0].options.headers.idpc, '0');
  assert.equal(capturedRequests[0].options.headers.Authorization, 'Bearer mock-token');

  assert.match(capturedRequests[1].url, /\/sch\/w-locdstkbtuanusertheohocky$/);
  const sentFilter = JSON.parse(capturedRequests[1].options.body);
  assert.equal(sentFilter.filter.hoc_ky, 20261);

  // 2. Verify returned schedule object
  assert.equal(schedule.isRealData, true);
  assert.equal(schedule.selectedHocKy, 20261);
  assert.equal(schedule.semesters.length, 2);
  assert.equal(schedule.semesters[0].hoc_ky, 20261);

  // 3. Verify deduplication and item fields
  assert.equal(schedule.items.length, 2, 'Lịch học phải được deduplicate môn theo thứ và tiết');
  assert.equal(schedule.items[0].courseCode, 'INF1203');
  assert.equal(schedule.items[0].day, 'Thứ 2');
  assert.equal(schedule.items[0].room, 'BII.9-Tầng 2 - Tòa nhà B (cơ sở 1)');
  assert.equal(schedule.items[0].lecturer, 'Dương Anh Tuấn');
  assert.equal(schedule.items[0].credits, 3);
  assert.equal(schedule.items[0].group, '03');

  assert.equal(schedule.items[1].courseCode, 'INF0983');
  assert.equal(schedule.items[1].day, 'Thứ 3');

  console.log('✓ BDU Schedule Service successfully requests w-locdshockytkbuser and w-locdstkbtuanusertheohocky and extracts items');
} finally {
  globalThis.fetch = originalFetch;
}
