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
            ma_sv: '24050126',
            lop: '27TH03',
            khoa: 'Công nghệ thông tin',
            nganh: 'Công nghệ thông tin'
          }
        };
      }
    };
  };

  const result = await BduService.getProfile('test-token', '-123456789');

  assert.match(capturedRequest.url, /\/sms\/w-locdsthongtinhhscanhan\?IDSV=-123456789$/);
  assert.equal(capturedRequest.options.method, 'GET');
  assert.equal(capturedRequest.options.headers.Authorization, 'Bearer test-token');
  assert.equal(capturedRequest.options.headers.idpc, '0');
  assert.equal(capturedRequest.options.body, undefined);
  assert.equal(result.data.lop, '27TH03');

  console.log('✓ Profile request uses the official IDSV endpoint and preserves returned data');
} finally {
  globalThis.fetch = originalFetch;
}
