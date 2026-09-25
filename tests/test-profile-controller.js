import assert from 'node:assert/strict';
import { ApiController } from '../src/controllers/api.controller.js';
import { BduService } from '../src/services/bdu.service.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { IdentityPresentationService } from '../src/services/identity-presentation.service.js';

const originalResolve = BduIdentityService.resolveVerifiedMssv;
const originalGetProfile = BduService.getProfile;
const originalRecordProfile = IdentityPresentationService.recordProfile;
const calls = { getProfile: [], recordProfile: [] };

function response() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    }
  };
}

try {
  BduIdentityService.resolveVerifiedMssv = async () => 'OWNER001';
  BduService.getProfile = async (...args) => {
    calls.getProfile.push(args);
    return { result: true, data: { mssv: 'OWNER001' } };
  };
  IdentityPresentationService.recordProfile = async (...args) => {
    calls.recordProfile.push(args);
  };

  const tokenMismatchRes = response();
  await ApiController.getProfile({
    headers: { authorization: 'Bearer owner-token' },
    query: {},
    body: { token: 'different-token' }
  }, tokenMismatchRes);
  assert.equal(tokenMismatchRes.statusCode, 400);
  assert.equal(tokenMismatchRes.body.code, 'PROFILE_TOKEN_MISMATCH');
  assert.equal(calls.getProfile.length, 0);

  const mismatchRes = response();
  await ApiController.getProfile({
    headers: { authorization: 'Bearer owner-token' },
    query: { MaSV: 'OTHER999', idsv: 'OTHER-IDSV' },
    body: {}
  }, mismatchRes);
  assert.equal(mismatchRes.statusCode, 403);
  assert.equal(mismatchRes.body.code, 'PROFILE_OWNER_MISMATCH');
  assert.equal(calls.getProfile.length, 0);

  const successRes = response();
  await ApiController.getProfile({
    headers: { authorization: 'Bearer owner-token' },
    query: { MaSV: 'owner001', idsv: 'client-controlled' },
    body: {}
  }, successRes);
  assert.equal(successRes.statusCode, 200);
  assert.deepEqual(calls.getProfile[0], ['owner-token', '', 'OWNER001']);
  assert.deepEqual(calls.recordProfile[0], ['OWNER001', { result: true, data: { mssv: 'OWNER001' } }]);

  console.log('✅ Profile controller derives the owner from the verified token.');
} finally {
  BduIdentityService.resolveVerifiedMssv = originalResolve;
  BduService.getProfile = originalGetProfile;
  IdentityPresentationService.recordProfile = originalRecordProfile;
}
