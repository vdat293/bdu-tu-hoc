import assert from 'node:assert/strict';
import { BduService } from '../src/services/bdu.service.js';

const originalFetch = globalThis.fetch;
let capturedRequest;

try {
  globalThis.fetch = async (url, options) => {
    capturedRequest = { url, options };
    return {
      async json() {
        return {
          result: true,
          code: 200,
          data: {
            ds_diem_hocky: [{
              hoc_ky: '20253',
              ds_diem_mon_hoc: [
                { ma_mon: 'ENG1644', ten_mon: 'Tiếng Anh 4' },
                { ma_mon: 'INF0303', ten_mon: 'Lập trình trên thiết bị di động' }
              ]
            }]
          }
        };
      }
    };
  };

  const result = await BduService.getGrades('test-token');

  assert.match(capturedRequest.url, /hien_thi_mon_theo_hkdk=false$/);
  assert.equal(capturedRequest.options.method, 'POST');
  assert.equal(capturedRequest.options.headers.Authorization, 'Bearer test-token');
  assert.equal(capturedRequest.options.headers.idpc, '0');
  assert.equal(capturedRequest.options.headers.Accept, 'application/json, text\/plain, *\/*');
  assert.equal(capturedRequest.options.headers['Content-Type'], 'text/plain');
  assert.equal(capturedRequest.options.body, '');
  assert.equal(result.data.ds_diem_hocky[0].ds_diem_mon_hoc.length, 2);
  assert.equal(result.data.ds_diem_hocky[0].ds_diem_mon_hoc[0].ma_mon, 'ENG1644');

  console.log('✓ BDU grades request matches the official portal and preserves every returned course');
} finally {
  globalThis.fetch = originalFetch;
}
