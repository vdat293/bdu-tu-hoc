import assert from 'node:assert/strict';
import { ApiController } from '../src/controllers/api.controller.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { StudentService } from '../src/services/student.service.js';
import { PermissionService } from '../src/services/permission.service.js';

const originalResolve = BduIdentityService.resolveVerifiedMssv;
const originalIsMember = StudentService.isClanMember;
const originalGetMembers = StudentService.getClanMembers;
const originalCan = PermissionService.can;
const calls = [];

function response() {
  return {
    statusCode: 200,
    body: null,
    headers: {},
    setHeader(name, value) { this.headers[name] = value; },
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
  };
}

try {
  BduIdentityService.resolveVerifiedMssv = async () => 'VIEWER001';
  PermissionService.can = async () => false;
  StudentService.getClanMembers = async (...args) => {
    calls.push(args);
    return [{ mssv: 'MEMBER001' }];
  };

  StudentService.isClanMember = async () => false;
  const forbidden = response();
  await ApiController.getClanMembers({ headers: {}, params: { id: '42' } }, forbidden);
  assert.equal(forbidden.statusCode, 403);
  assert.equal(calls.length, 0);

  StudentService.isClanMember = async () => true;
  const allowed = response();
  await ApiController.getClanMembers({ headers: {}, params: { id: '42' } }, allowed);
  assert.equal(allowed.statusCode, 200);
  assert.deepEqual(calls[0], ['42']);
  assert.equal(allowed.headers['Cache-Control'], 'private, no-store');
  assert.equal(allowed.headers.Vary, 'Authorization');

  console.log('✅ Clan member roster requires a verified member or moderator.');
} finally {
  BduIdentityService.resolveVerifiedMssv = originalResolve;
  StudentService.isClanMember = originalIsMember;
  StudentService.getClanMembers = originalGetMembers;
  PermissionService.can = originalCan;
}
