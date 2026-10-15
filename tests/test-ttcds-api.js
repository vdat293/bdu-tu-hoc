import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { BduIdentityService } from '../src/services/bdu-identity.service.js';
import { PermissionService } from '../src/services/permission.service.js';
import { TtcdsService } from '../src/services/ttcds.service.js';
import { DashboardProxy } from '../src/services/dashboard-proxy.service.js';
import { TtcdsController } from '../src/modules/ttcds/ttcds.controller.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test: DATABASE_URL not configured.');
  process.exit(0);
}

const VIEW_MSSV = 'TEST_TTCDS_APIVIEW';
const CREATE_MSSV = 'TEST_TTCDS_APICREATE';
const OTHER_MSSV = 'TEST_TTCDS_APIOTHER';
const SYS_MSSV = 'TEST_TTCDS_APISYS';
const MEMBER_MSSV = 'TEST_TTCDS_APISV1';
const OUTSIDER_MSSV = 'TEST_TTCDS_APISV9';

const TOKENS = {
  view: 'ttcds-api-view-token',
  create: 'ttcds-api-create-token',
  other: 'ttcds-api-other-token',
  sys: 'ttcds-api-sys-token'
};

const STUDENT_FIXTURE = {
  tim_thay: true,
  ho_so: { mssv: MEMBER_MSSV, ho_ten: 'SV Test API' },
  gpa_hoc_ky: [],
  diem_danh: [],
  bang_diem: [],
  diem_danh_mon: [],
  thoi_khoa_bieu: [],
  ren_luyen: [{ nkhk: '20251', diem_ren_luyen: 88, xep_loai: 'Tot' }],
  su_kien: []
};

const originalCan = PermissionService.can;
const originalIsSystemOwner = PermissionService.isSystemOwner;
const originalSearch = DashboardProxy.searchStudents;
const originalGetStudent = DashboardProxy.getStudent;
const originalGetAttendance = DashboardProxy.getAttendance;

function mockReq({ token, params = {}, queryParams = {}, body = null } = {}) {
  return {
    headers: { authorization: `Bearer ${token}` },
    params,
    query: queryParams,
    body
  };
}

function mockRes() {
  const captured = { statusCode: 200, payload: null, headers: {} };
  const res = {
    status(code) {
      captured.statusCode = code;
      return res;
    },
    json(payload) {
      captured.payload = payload;
      return res;
    },
    setHeader(name, value) {
      captured.headers[name] = value;
    }
  };
  return { res, captured };
}

async function cleanupTestData() {
  await query("DELETE FROM ttcds_groups WHERE owner_mssv LIKE 'TEST_TTCDS_API%'");
  await query("DELETE FROM ttcds_permissions WHERE mssv LIKE 'TEST_TTCDS_API%'");
  await query("DELETE FROM ttcds_audit_logs WHERE actor_mssv LIKE 'TEST_TTCDS_API%' OR target_mssv LIKE 'TEST_TTCDS_API%'");
  await query("DELETE FROM identity_entitlement_grants WHERE mssv LIKE 'TEST_TTCDS_API%'");
  await query("DELETE FROM students WHERE mssv LIKE 'TEST_TTCDS_API%'");
}

async function runTtcdsApiTest() {
  console.log('Bat dau kiem thu /api/ttcds (controller + DB that, proxy stub)...');

  BduIdentityService.register(TOKENS.view, VIEW_MSSV, { expiresIn: 600 });
  BduIdentityService.register(TOKENS.create, CREATE_MSSV, { expiresIn: 600 });
  BduIdentityService.register(TOKENS.other, OTHER_MSSV, { expiresIn: 600 });
  BduIdentityService.register(TOKENS.sys, SYS_MSSV, { expiresIn: 600 });

  // Moi TEST user deu co nametag #TTCDS; chi SYS la system owner.
  PermissionService.can = async () => true;
  PermissionService.isSystemOwner = async (mssv) =>
    String(mssv || '').trim().toUpperCase() === SYS_MSSV;

  // Stub proxy: khong goi Dashboard that.
  DashboardProxy.searchStudents = async () => ({ ket_qua: [] });
  DashboardProxy.getStudent = async (mssv) => {
    if (String(mssv).toUpperCase() === MEMBER_MSSV) return STUDENT_FIXTURE;
    const err = new Error('Ban khong co quyen xem sinh vien nay');
    err.status = 403;
    throw err;
  };
  DashboardProxy.getAttendance = async () => ({ tong_so_buoi: 0, so_buoi_vang: 0, nhat_ky: [] });

  try {
    await cleanupTestData();
    await TtcdsService.setLevel({ mssv: VIEW_MSSV, level: 'view', grantedBy: SYS_MSSV });
    await TtcdsService.setLevel({ mssv: CREATE_MSSV, level: 'create', grantedBy: SYS_MSSV });
    await TtcdsService.setLevel({ mssv: OTHER_MSSV, level: 'create', grantedBy: SYS_MSSV });

    console.log('--- [Test 1] user view POST group -> 403 ---');
    {
      const { res, captured } = mockRes();
      await TtcdsController.createGroup(
        mockReq({ token: TOKENS.view, body: { name: 'Nhom K29', nien_khoa: 'K29' } }),
        res
      );
      assert.equal(captured.statusCode, 403);
      assert.equal(captured.payload.result, false);
    }
    console.log('PASSED: view khong duoc tao group.');

    console.log('--- [Test 2] user create POST group K29 -> 201 + audit ---');
    let groupId;
    {
      const { res, captured } = mockRes();
      await TtcdsController.createGroup(
        mockReq({ token: TOKENS.create, body: { name: 'Nhom K29', nien_khoa: 'K29' } }),
        res
      );
      assert.equal(captured.statusCode, 201);
      assert.equal(captured.payload.result, true);
      assert.ok(captured.payload.data?.id, 'POST group phai tra ve group co id');
      groupId = captured.payload.data.id;
      const audit = await query(
        "SELECT action FROM ttcds_audit_logs WHERE actor_mssv = $1 AND target_group_id = $2 AND action = 'group.create'",
        [CREATE_MSSV, groupId]
      );
      assert.equal(audit.rowCount, 1, 'createGroup phai ghi audit group.create');
    }
    console.log('PASSED: create tao group 201 + audit.');

    console.log('--- [Test 3] owner khac GET members -> 403; chu group GET -> 200 + cache headers ---');
    {
      const forbidden = mockRes();
      await TtcdsController.listMembers(
        mockReq({ token: TOKENS.other, params: { id: groupId } }),
        forbidden.res
      );
      assert.equal(forbidden.captured.statusCode, 403);
      assert.equal(forbidden.captured.payload.result, false);

      const allowed = mockRes();
      await TtcdsController.listMembers(
        mockReq({ token: TOKENS.create, params: { id: groupId } }),
        allowed.res
      );
      assert.equal(allowed.captured.statusCode, 200);
      assert.equal(allowed.captured.payload.result, true);
      assert.equal(allowed.captured.headers['Cache-Control'], 'private, no-store');
      assert.equal(allowed.captured.headers.Vary, 'Authorization');
    }
    console.log('PASSED: members chi chu group (hoac system owner) duoc xem.');

    console.log('--- [Test 4] GET students/:mssv la thanh vien -> 200 giu ren_luyen ---');
    {
      const add = mockRes();
      await TtcdsController.addMember(
        mockReq({ token: TOKENS.create, params: { id: groupId }, body: { mssv: MEMBER_MSSV } }),
        add.res
      );
      assert.equal(add.captured.statusCode, 200);
      assert.equal(add.captured.payload.result, true);

      const detail = mockRes();
      await TtcdsController.getStudent(
        mockReq({ token: TOKENS.create, params: { mssv: MEMBER_MSSV } }),
        detail.res
      );
      assert.equal(detail.captured.statusCode, 200);
      assert.ok(Array.isArray(detail.captured.payload.data?.ren_luyen), 'detail phai giu field ren_luyen');
    }
    console.log('PASSED: thanh vien trong group xem duoc detail + ren_luyen.');

    console.log('--- [Test 5] GET students/:mssv ngoai group -> 403 ---');
    {
      const { res, captured } = mockRes();
      await TtcdsController.getStudent(
        mockReq({ token: TOKENS.create, params: { mssv: OUTSIDER_MSSV } }),
        res
      );
      assert.equal(captured.statusCode, 403);
      assert.equal(captured.payload.result, false);
    }
    console.log('PASSED: SV ngoai pham vi phu trach bi 403.');

    console.log('--- [Test 6] PUT permissions level sai -> 400 ---');
    {
      const { res, captured } = mockRes();
      await TtcdsController.setPermission(
        mockReq({ token: TOKENS.sys, body: { mssv: VIEW_MSSV, level: 'admin' } }),
        res
      );
      assert.equal(captured.statusCode, 400);
      assert.equal(captured.payload.result, false);
    }
    console.log('PASSED: level khong hop le bi 400.');

    console.log('--- [Test 7] PUT permissions nguoi thuong -> 403 ---');
    {
      const { res, captured } = mockRes();
      await TtcdsController.setPermission(
        mockReq({ token: TOKENS.view, body: { mssv: VIEW_MSSV, level: 'view' } }),
        res
      );
      assert.equal(captured.statusCode, 403);
      assert.equal(captured.payload.result, false);
    }
    console.log('PASSED: chi system owner duoc cap quyen.');

    console.log('--- [Test 8] search q < 2 ky tu -> 400 ---');
    {
      const { res, captured } = mockRes();
      await TtcdsController.searchStudents(
        mockReq({ token: TOKENS.create, queryParams: { q: 'a' } }),
        res
      );
      assert.equal(captured.statusCode, 400);
      assert.equal(captured.payload.result, false);
    }
    console.log('PASSED: search ngan bi 400.');

    console.log('--- [Test 9] chu group bi ha view DELETE -> 403; system owner DELETE -> ok ---');
    {
      const created = mockRes();
      await TtcdsController.createGroup(
        mockReq({ token: TOKENS.create, body: { name: 'Nhom xoa test', nien_khoa: 'K29' } }),
        created.res
      );
      assert.equal(created.captured.statusCode, 201);
      const doomedId = created.captured.payload.data.id;

      await TtcdsService.setLevel({ mssv: CREATE_MSSV, level: 'view', grantedBy: SYS_MSSV });
      const demoted = mockRes();
      await TtcdsController.deleteGroup(
        mockReq({ token: TOKENS.create, params: { id: doomedId } }),
        demoted.res
      );
      assert.equal(demoted.captured.statusCode, 403);
      assert.equal(demoted.captured.payload.result, false);

      const sysDel = mockRes();
      await TtcdsController.deleteGroup(
        mockReq({ token: TOKENS.sys, params: { id: doomedId } }),
        sysDel.res
      );
      assert.equal(sysDel.captured.statusCode, 200);
      assert.equal(sysDel.captured.payload.deleted, true);
      const gone = await query('SELECT id FROM ttcds_groups WHERE id = $1', [doomedId]);
      assert.equal(gone.rowCount, 0, 'system owner phai xoa duoc group');

      await TtcdsService.setLevel({ mssv: CREATE_MSSV, level: 'create', grantedBy: SYS_MSSV });
    }
    console.log('PASSED: chu group muc view khong duoc xoa; system owner xoa duoc.');

    await cleanupTestData();
    console.log('TAT CA BAI KIEM THU TTCDS API DA DAT!');
  } finally {
    PermissionService.can = originalCan;
    PermissionService.isSystemOwner = originalIsSystemOwner;
    DashboardProxy.searchStudents = originalSearch;
    DashboardProxy.getStudent = originalGetStudent;
    DashboardProxy.getAttendance = originalGetAttendance;
    await closeDatabase();
  }
}

await runTtcdsApiTest();
