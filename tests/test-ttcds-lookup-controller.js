import assert from 'node:assert/strict';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { PermissionService } from '../src/services/permission.service.js';
import { TtcdsStudentService } from '../src/services/ttcds-student.service.js';
import { TtcdsController } from '../src/modules/ttcds/ttcds.controller.js';

const originalResolve = BduIdentityService.resolveVerifiedMssv;
const originalCan = PermissionService.can;
const originalIsSystemOwner = PermissionService.isSystemOwner;
const originalSearch = TtcdsStudentService.searchStudents;
const originalGetStudent = TtcdsStudentService.getStudent;
const originalGetAttendance = TtcdsStudentService.getAttendance;

function mockReq({ token = 'tok', params = {}, queryParams = {} } = {}) {
  return {
    headers: { authorization: `Bearer ${token}` },
    params,
    query: queryParams
  };
}

function mockRes() {
  const captured = { statusCode: 200, payload: null };
  const res = {
    status(code) {
      captured.statusCode = code;
      return res;
    },
    json(payload) {
      captured.payload = payload;
      return res;
    }
  };
  return { res, captured };
}

try {
  let hasTtcdsTag = true;
  let ownerStatus = false;
  const calls = { search: [], student: [], attendance: [] };

  BduIdentityService.resolveVerifiedMssv = async () => '22050006';
  PermissionService.can = async (_mssv, cap) => (cap === 'ttcds:access' ? hasTtcdsTag : false);
  PermissionService.isSystemOwner = async () => ownerStatus;

  TtcdsStudentService.searchStudents = async (q, opts) => {
    calls.search.push({ q, opts });
    return { ket_qua: [{ mssv: '24050999', ten_day_du: 'Sinh viên ngoài nhóm' }] };
  };
  TtcdsStudentService.getStudent = async (mssv) => {
    calls.student.push(mssv);
    return { tim_thay: true, ho_so: { mssv } };
  };
  TtcdsStudentService.getAttendance = async (mssv, filters) => {
    calls.attendance.push({ mssv, filters });
    return { tong_so_buoi: 1, so_buoi_vang: 0, nhat_ky: [] };
  };

  // 1. Non-owner #TTCDS user can search with and without ?all=1, with no owner/scope args
  {
    const resNoAll = mockRes();
    await TtcdsController.searchStudents(
      mockReq({ queryParams: { q: 'nguyen', limit: '20' } }),
      resNoAll.res
    );
    assert.equal(resNoAll.captured.statusCode, 200);
    assert.equal(resNoAll.captured.payload.result, true);

    const resWithAll = mockRes();
    await TtcdsController.searchStudents(
      mockReq({ queryParams: { q: 'nguyen', limit: '20', all: '1' } }),
      resWithAll.res
    );
    assert.equal(resWithAll.captured.statusCode, 200);
    assert.equal(resWithAll.captured.payload.result, true);

    assert.equal(calls.search.length, 2);
    for (const call of calls.search) {
      assert.equal(call.q, 'nguyen');
      assert.deepEqual(call.opts, { limit: '20' });
      assert.equal('ownerMssv' in call.opts, false);
      assert.equal('bypassScope' in call.opts, false);
    }
  }

  // 2. Non-owner #TTCDS user can fetch any student profile & attendance without group membership or ?all=1
  {
    const resStudent = mockRes();
    await TtcdsController.getStudent(
      mockReq({ params: { mssv: ' 24050999 ' } }),
      resStudent.res
    );
    assert.equal(resStudent.captured.statusCode, 200);
    assert.equal(resStudent.captured.payload.data?.ho_so?.mssv, '24050999');

    const resAtt = mockRes();
    await TtcdsController.getAttendance(
      mockReq({ params: { mssv: '24050999' }, queryParams: { nkhk: '25262' } }),
      resAtt.res
    );
    assert.equal(resAtt.captured.statusCode, 200);
    assert.equal(calls.student[0], '24050999');
    assert.deepEqual(calls.attendance[0], {
      mssv: '24050999',
      filters: { ma_mon_hoc: undefined, ma_nhom: undefined, nkhk: '25262' }
    });
  }

  // 3. User without #TTCDS tag gets 403 on all 3 endpoints and no service calls are made
  {
    hasTtcdsTag = false;
    const prevCounts = {
      search: calls.search.length,
      student: calls.student.length,
      attendance: calls.attendance.length
    };

    const resSearch = mockRes();
    await TtcdsController.searchStudents(mockReq({ queryParams: { q: 'nguyen' } }), resSearch.res);
    assert.equal(resSearch.captured.statusCode, 403);
    assert.equal(resSearch.captured.payload.result, false);

    const resStudent = mockRes();
    await TtcdsController.getStudent(mockReq({ params: { mssv: '24050999' } }), resStudent.res);
    assert.equal(resStudent.captured.statusCode, 403);
    assert.equal(resStudent.captured.payload.result, false);

    const resAtt = mockRes();
    await TtcdsController.getAttendance(mockReq({ params: { mssv: '24050999' } }), resAtt.res);
    assert.equal(resAtt.captured.statusCode, 403);
    assert.equal(resAtt.captured.payload.result, false);

    assert.equal(calls.search.length, prevCounts.search);
    assert.equal(calls.student.length, prevCounts.student);
    assert.equal(calls.attendance.length, prevCounts.attendance);
  }

  // 4. #TTCDS user searching with q < 2 chars gets 400
  {
    hasTtcdsTag = true;
    const resShort = mockRes();
    await TtcdsController.searchStudents(mockReq({ queryParams: { q: 'a' } }), resShort.res);
    assert.equal(resShort.captured.statusCode, 400);
    assert.equal(resShort.captured.payload.result, false);
  }

  console.log('✅ TTCDS lookup controller allows all #TTCDS users and blocks non-#TTCDS users.');
} finally {
  BduIdentityService.resolveVerifiedMssv = originalResolve;
  PermissionService.can = originalCan;
  PermissionService.isSystemOwner = originalIsSystemOwner;
  TtcdsStudentService.searchStudents = originalSearch;
  TtcdsStudentService.getStudent = originalGetStudent;
  TtcdsStudentService.getAttendance = originalGetAttendance;
}
