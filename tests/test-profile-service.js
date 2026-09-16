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

  const fallbackUrls = [];
  globalThis.fetch = async (url) => {
    fallbackUrls.push(url);
    if (url.includes('w-locdsthongtinhhscanhan')) {
      return {
        status: 200,
        async json() {
          return { result: true, code: 200, data: { ho_ten: 'Sinh viên kiểm thử', ma_sv: '24050126' } };
        }
      };
    }
    if (url.includes('w-locthongtinimagesinhvien')) return { ok: false, status: 503 };
    return {
      status: 200,
      async json() {
        return {
          result: true,
          code: 200,
          data: { lop: '27TH03', nganh: 'Công nghệ thông tin', khoa: 'Khoa Tin học' }
        };
      }
    };
  };

  const repaired = await BduService.getProfile('test-token', '-123456789', '24050126');
  assert.ok(fallbackUrls.some(url => url.includes('/dkmh/w-locsinhvieninfo')));
  assert.equal(repaired.data.lop, '27TH03');
  assert.equal(repaired.data.khoa, 'Khoa Tin học');
  assert.equal(repaired.data.ma_sv, '24050126');
  console.log('✓ Partial IDSV profile is repaired from the current-user endpoint');
} finally {
  globalThis.fetch = originalFetch;
}
