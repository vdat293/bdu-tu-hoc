import { isDatabaseConfigured, query } from '../db/database.js';

const MAX_DISPLAYED_TITLES = 4;
const RANK_LIMIT = 10;

function normalizeMssv(value) {
  return String(value || '').trim().toUpperCase();
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizeAvatarUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:') || raw.startsWith('/9j/') || raw.startsWith('iVBOR') || raw.startsWith('UklGR') || raw.length > 2048) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:/i.test(raw)) return null;
  const absolute = raw.startsWith('//')
    ? `https:${raw}`
    : raw.startsWith('http')
      ? raw
      : `${raw.startsWith('/') ? 'https://sv.bdu.edu.vn' : 'https://sv.bdu.edu.vn/'}${raw}`;
  try {
    const parsed = new URL(absolute);
    return ['http:', 'https:'].includes(parsed.protocol) && absolute.length <= 2048 ? absolute : null;
  } catch {
    return null;
  }
}

function extractProfileIdentity(payload) {
  const root = payload?.data ?? payload ?? {};
  const profile = Array.isArray(root) ? (root[0] || {}) : root;
  const name = String(
    profile.ho_ten
    || profile.ho_va_ten
    || profile.ten_day_du
    || profile.ten_sinh_vien
    || profile.name
    || ''
  ).trim().slice(0, 500);
  const avatarUrl = [
    payload?.student_image,
    profile.student_image,
    profile.hinh_anh,
    profile.url_hinh_anh,
    profile.image,
    profile.anh_the,
    profile.avatar
  ].map(normalizeAvatarUrl).find(Boolean) || null;
  return { name, avatarUrl };
}

function extractProfileAcademicInfo(payload, mssv) {
  const root = payload?.data ?? payload ?? {};
  const profile = Array.isArray(root) ? (root[0] || {}) : root;
  const classCode = String(profile.lop || profile.ma_lop || profile.class_code || '').trim() || null;
  const rawFaculty = String(profile.khoa || profile.ma_khoa || profile.ten_khoa || '').trim();
  let facultyCode = null;
  if (/^TH$/i.test(profile.ma_khoa) || /tin học|cntt|công nghệ thông tin/i.test(rawFaculty)) {
    facultyCode = 'TH';
  } else if (/^DT$/i.test(profile.ma_khoa) || /điện tử/i.test(rawFaculty)) {
    facultyCode = 'DT';
  } else if (classCode && /\d{2}TH/i.test(classCode)) {
    facultyCode = 'TH';
  } else if (classCode && /\d{2}DT/i.test(classCode)) {
    facultyCode = 'DT';
  } else if (/^(\d{2})05\d{4}$/.test(String(mssv || ''))) {
    facultyCode = 'TH';
  } else if (profile.ma_khoa) {
    facultyCode = String(profile.ma_khoa).trim().toUpperCase();
  }

  let cohort = null;
  if (classCode) {
    const classMatch = classCode.match(/^(\d{2})/);
    if (classMatch) cohort = Number(classMatch[1]);
  }
  if (!cohort && mssv) {
    const mssvMatch = String(mssv).match(/^(\d{2})/);
    if (mssvMatch) cohort = Number(mssvMatch[1]) + 3;
  }
  return { classCode, facultyCode, cohort };
}

function resolveStudentAcademicContext(row) {
  const mssv = String(row?.mssv || '').trim().toUpperCase();
  const classCode = String(row?.ranking_class_code || row?.student_class_code || row?.class_code || '').trim().toUpperCase();
  const facultyCode = String(row?.ranking_faculty_code || row?.student_faculty_code || row?.faculty_code || '').trim().toUpperCase();
  let cohort = Number(row?.ranking_cohort ?? row?.student_cohort ?? row?.cohort);
  if (!Number.isInteger(cohort) || cohort <= 0) {
    if (classCode) {
      const classMatch = classCode.match(/^(\d{2})/);
      if (classMatch) cohort = Number(classMatch[1]);
    }
  }
  if (!Number.isInteger(cohort) || cohort <= 0) {
    const mssvMatch = mssv.match(/^(\d{2})/);
    if (mssvMatch) cohort = Number(mssvMatch[1]) + 3;
  }

  let admissionYear = null;
  const mssvMatch = mssv.match(/^(\d{2})/);
  if (mssvMatch) {
    admissionYear = 2000 + Number(mssvMatch[1]);
  } else if (cohort && cohort >= 20) {
    admissionYear = 2000 + (cohort - 3);
  }

  const now = new Date();
  const currentCalendarYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  const academicYear = currentMonth >= 8 ? currentCalendarYear : currentCalendarYear - 1;

  let studentYear = null;
  if (admissionYear) {
    studentYear = Math.max(1, academicYear - admissionYear + 1);
  }

  const isFacultyTh = facultyCode === 'TH'
    || classCode.includes('TH')
    || /^(\d{2})05\d{4}$/.test(mssv);

  return {
    mssv,
    classCode,
    facultyCode,
    cohort,
    admissionYear,
    academicYear,
    studentYear,
    isFacultyTh
  };
}

function buildTitleCatalog(row) {
  const titles = [{
    id: 'member:bdu',
    label: 'Sinh viên BDU',
    detail: 'Thành viên cộng đồng Đại học Bình Dương',
    tone: 'member',
    priority: 900
  }];
  const manualTitleIds = new Set(
    (Array.isArray(row.manual_entitlements) ? row.manual_entitlements : [])
      .filter((item) => item.item_type === 'title')
      .map((item) => item.id)
  );

  const academic = resolveStudentAcademicContext(row);

  // #Đại ca: dành cho sinh viên năm 4
  if (academic.studentYear !== null && academic.studentYear >= 4 && !manualTitleIds.has('title:dai-ca')) {
    titles.push({
      id: 'title:dai-ca',
      label: '#Đại ca',
      detail: 'Dành cho sinh viên năm 4 BDU',
      tone: 'gold',
      rarity: 'epic',
      asset_key: 'dai-ca',
      category: 'academic',
      priority: 250
    });
  }

  // #Tiền bối: dành cho sinh viên năm 2 trở đi
  if (academic.studentYear !== null && academic.studentYear >= 2 && !manualTitleIds.has('title:tien-boi')) {
    titles.push({
      id: 'title:tien-boi',
      label: '#Tiền bối',
      detail: 'Dành cho sinh viên từ năm 2 trở đi',
      tone: 'blue',
      rarity: 'rare',
      asset_key: 'tien-boi',
      category: 'academic',
      priority: 280
    });
  }

  // #Dev: dành cho những ai học khoa TH
  if (academic.isFacultyTh && !manualTitleIds.has('title:dev')) {
    titles.push({
      id: 'title:dev',
      label: '#Dev',
      detail: 'Dành cho sinh viên Khoa Tin học (TH)',
      tone: 'emerald',
      rarity: 'epic',
      asset_key: 'dev',
      category: 'academic',
      priority: 260
    });
  }

  const rankings = row.rankings && typeof row.rankings === 'object' ? row.rankings : {};

  // #Không đối thủ: dành cho top 1 toàn trường
  const isTop1Truong = ['tong_hop', 'gpa_tich_luy', 'tin_chi_tich_luy'].some((metric) => {
    const rank = Number(rankings?.[metric]?.truong?.hang);
    return Number.isInteger(rank) && rank === 1;
  });
  if (isTop1Truong && !manualTitleIds.has('title:khong-doi-thu')) {
    titles.push({
      id: 'title:khong-doi-thu',
      label: '#Không đối thủ',
      detail: 'Top 1 toàn trường BDU',
      tone: 'gold',
      rarity: 'legendary',
      asset_key: 'khong-doi-thu',
      category: 'academic',
      priority: 15
    });
  }

  // #Học tài thi phận: dành cho sinh viên có môn học bị rớt
  if (Boolean(row.has_failed_course) && !manualTitleIds.has('title:hoc-tai-thi-phan')) {
    titles.push({
      id: 'title:hoc-tai-thi-phan',
      label: '#Học tài thi phận',
      detail: 'Dành cho sinh viên có môn học bị rớt',
      tone: 'bronze',
      rarity: 'rare',
      asset_key: 'hoc-tai-thi-phan',
      category: 'academic',
      priority: 290
    });
  }

  const cumulativeGpa = Number(
    row.cumulative_gpa_4
    ?? row.rankings?.gpa_tich_luy?.truong?.gpa_4
    ?? row.rankings?.gpa_tich_luy?.diem
    ?? 0
  );
  const earnedCredits = Number(
    row.cumulative_earned_credits
    ?? row.rankings?.tin_chi_tich_luy?.truong?.tin_chi
    ?? 0
  );
  const unlockedAchievementIds = new Set(
    (Array.isArray(row.achievements) ? row.achievements : []).map((a) => a?.id).filter(Boolean)
  );

  // #Học thần: dành cho GPA tích luỹ từ 3.6 trở lên
  if (cumulativeGpa >= 3.6 && !manualTitleIds.has('title:hoc-than')) {
    titles.push({
      id: 'title:hoc-than',
      label: '#Học thần',
      detail: 'GPA tích lũy từ 3.60 trở lên (Xuất sắc)',
      tone: 'gold',
      rarity: 'legendary',
      asset_key: 'hoc-than',
      category: 'academic',
      priority: 120
    });
  }

  // #Tinh hoa BDU: dành cho GPA tích luỹ từ 3.2 trở lên
  if (cumulativeGpa >= 3.2 && !manualTitleIds.has('title:tinh-hoa-bdu')) {
    titles.push({
      id: 'title:tinh-hoa-bdu',
      label: '#Tinh hoa BDU',
      detail: 'GPA tích lũy từ 3.20 trở lên (Giỏi)',
      tone: 'emerald',
      rarity: 'epic',
      asset_key: 'tinh-hoa-bdu',
      category: 'academic',
      priority: 140
    });
  }

  // #Bất bại môn phái: >= 50 tín chỉ và chưa từng rớt môn
  if (earnedCredits >= 50 && !row.has_failed_course && !manualTitleIds.has('title:bat-bai-mon-phai')) {
    titles.push({
      id: 'title:bat-bai-mon-phai',
      label: '#Bất bại môn phái',
      detail: 'Tích lũy từ 50 tín chỉ trở lên và chưa từng rớt môn',
      tone: 'gold',
      rarity: 'epic',
      asset_key: 'bat-bai-mon-phai',
      category: 'achievement',
      priority: 150
    });
  }

  // #Con nhà người ta: Đạt GPA 4.00 trong một học kỳ
  const hasPerfectSemester = Boolean(row.has_perfect_semester) || unlockedAchievementIds.has('perfect_semester');
  if (hasPerfectSemester && !manualTitleIds.has('title:con-nha-nguoi-ta')) {
    titles.push({
      id: 'title:con-nha-nguoi-ta',
      label: '#Con nhà người ta',
      detail: 'Đạt GPA tuyệt đối 4.00 trong một học kỳ',
      tone: 'violet',
      rarity: 'legendary',
      asset_key: 'con-nha-nguoi-ta',
      category: 'achievement',
      priority: 110
    });
  }

  // #Thợ săn tín chỉ: Tích lũy từ 80 tín chỉ trở lên toàn khóa
  if (earnedCredits >= 80 && !manualTitleIds.has('title:tho-san-tin-chi')) {
    titles.push({
      id: 'title:tho-san-tin-chi',
      label: '#Thợ săn tín chỉ',
      detail: 'Tích lũy từ 80 tín chỉ trở lên toàn khóa',
      tone: 'blue',
      rarity: 'epic',
      asset_key: 'tho-san-tin-chi',
      category: 'achievement',
      priority: 160
    });
  }

  // #Cú đêm luyện thi: Hoàn thành từ 18 tín chỉ một kỳ với GPA từ 3.00
  const hasHeavySemester = Boolean(row.has_heavy_semester) || unlockedAchievementIds.has('credit_warrior');
  if (hasHeavySemester && !manualTitleIds.has('title:cu-dem-luyen-thi')) {
    titles.push({
      id: 'title:cu-dem-luyen-thi',
      label: '#Cú đêm luyện thi',
      detail: 'Hoàn thành từ 18 tín chỉ một kỳ với GPA từ 3.00',
      tone: 'violet',
      rarity: 'rare',
      asset_key: 'cu-dem-luyen-thi',
      category: 'achievement',
      priority: 250
    });
  }

  // #Tay to gánh team: Thành viên tích cực Clan hoặc chia sẻ tài liệu
  const hasClanOrCommunity = (Array.isArray(row.clans) && row.clans.length > 0) || Boolean(row.has_community_contribution);
  if (hasClanOrCommunity && !manualTitleIds.has('title:tay-to-ganh-team')) {
    titles.push({
      id: 'title:tay-to-ganh-team',
      label: '#Tay to gánh team',
      detail: 'Thành viên tích cực gánh team và chia sẻ tài liệu',
      tone: 'blue',
      rarity: 'rare',
      asset_key: 'tay-to-ganh-team',
      category: 'community',
      priority: 270
    });
  }

  const classification = String(row.cumulative_classification || '').trim();
  if (classification && !['Yếu', 'Trung bình'].includes(classification)) {
    titles.push({
      id: `classification:${classification.toLocaleLowerCase('vi')}`,
      label: `Học lực ${classification}`,
      detail: 'Theo kết quả tích lũy gần nhất',
      tone: classification === 'Xuất sắc' ? 'gold' : classification === 'Giỏi' ? 'emerald' : 'blue',
      priority: 400
    });
  }

  const metrics = {
    tong_hop: 'Toàn diện',
    gpa_tich_luy: 'GPA',
    tin_chi_tich_luy: 'Tín chỉ'
  };
  const scopes = {
    truong: { label: 'Toàn trường', weight: 4 },
    vien: { label: 'Viện', weight: 3 },
    khoa: { label: 'Khoa', weight: 2 },
    lop: { label: 'Lớp', weight: 1 }
  };
  Object.entries(metrics).forEach(([metric, metricLabel]) => {
    Object.entries(scopes).forEach(([scope, scopeInfo]) => {
      const ranking = rankings?.[metric]?.[scope];
      const rank = Number(ranking?.hang);
      if (!Number.isInteger(rank) || rank < 1 || rank > RANK_LIMIT) return;
      titles.push({
        id: `rank:${metric}:${scope}`,
        label: `#${rank} ${scopeInfo.label} · ${metricLabel}`,
        detail: `Top ${rank}/${Number(ranking.tong_sinh_vien || 0) || '?'} sinh viên`,
        tone: rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'blue',
        priority: rank * 10 - scopeInfo.weight
      });
    });
  });

  const roleLabels = {
    leader: 'Bang Chủ',
    vice_leader: 'Phó Bang',
    elder: 'Trưởng Lão',
    member: 'Thành viên',
    recruit: 'Tân binh'
  };
  (Array.isArray(row.clans) ? row.clans : []).forEach((clan) => {
    const roleLabel = roleLabels[clan.role] || 'Thành viên';
    const clanName = String(clan.tag || clan.name || 'CLB').trim();
    titles.push({
      id: `clan:${clan.id}:${clan.role}`,
      label: `${roleLabel} · ${clanName}`,
      detail: String(clan.name || clanName),
      tone: clan.role === 'leader' ? 'gold' : clan.role === 'vice_leader' ? 'violet' : 'emerald',
      priority: clan.role === 'leader' ? 300 : clan.role === 'vice_leader' ? 320 : 350
    });
  });

  (Array.isArray(row.achievements) ? row.achievements : []).forEach((achievement) => {
    if (manualTitleIds.has(`title:${achievement.id}`)) return;
    titles.push({
      id: `achievement:${achievement.id}`,
      label: achievement.label,
      detail: achievement.description,
      tone: achievement.tone || 'blue',
      rarity: achievement.rarity || 'common',
      category: 'achievement',
      unlocked_at: achievement.unlocked_at,
      evidence: achievement.evidence || {},
      priority: Number(achievement.sort_order || 100)
    });
  });

  // Manual titles are catalog data, not frontend allow-lists. Keep them in
  // the same selection surface as achievement titles while preserving their
  // grant metadata for audit/debugging.
  (Array.isArray(row.manual_entitlements) ? row.manual_entitlements : [])
    .filter((item) => item.item_type === 'title')
    .forEach((item) => {
      titles.push({
        id: item.id,
        label: item.label,
        detail: item.description || 'Danh hiệu được cấp bởi quản trị viên.',
        tone: item.metadata?.tone || (item.asset_key === 'chatgpt' ? 'chatgpt' : item.asset_key === 'pho-bi-thu-doan' ? 'youth' : 'violet'),
        rarity: item.rarity || 'common',
        asset_key: item.asset_key,
        category: 'manual',
        grant_id: item.grant_id,
        priority: item.display_policy === 'mandatory' ? 1 : 6
      });
    });

  return titles.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, 'vi'));
}

function buildFrameAccess(row) {
  const keys = new Set();
  let all = false;
  const entitlements = Array.isArray(row.manual_entitlements) ? row.manual_entitlements : [];
  entitlements.forEach((item) => {
    if (item.item_type === 'capability' && item.id === 'capability:frame-preview-all') all = true;
    if (item.item_type === 'frame') {
      const key = String(item.asset_key || item.id || '').replace(/^frame:/, '').trim();
      if (key) keys.add(key);
    }
  });

  // Ranking-earned frames are also server-authorized. The frontend may still
  // render the visual collection, but it no longer decides special access.
  const rankings = row.rankings && typeof row.rankings === 'object' ? row.rankings : {};
  const metrics = ['tong_hop', 'gpa_tich_luy', 'tin_chi_tich_luy', 'overall', 'gpa', 'credits'];
  const scopes = ['truong', 'vien', 'khoa', 'lop'];
  const addRankKey = (scope, rank) => {
    const numeric = Number(rank);
    if (!Number.isInteger(numeric) || numeric < 1 || numeric > 10) return;
    if (scope === 'truong' && numeric <= 3) keys.add(`truong-${numeric}`);
    else if (scope === 'truong') keys.add('truong-top');
    else if (scope === 'vien' && numeric === 1) keys.add('vien-1');
    else if (scope === 'vien') keys.add('vien-top');
    else if (scope === 'khoa' && numeric === 1) keys.add('khoa-1');
    else if (scope === 'khoa' && numeric === 2) keys.add('khoa-2');
    else if (scope === 'khoa' && numeric === 3) keys.add('khoa-3');
    else if (scope === 'khoa') keys.add('khoa-top');
    else if (scope === 'lop' && numeric === 1) keys.add('lop-1');
    else if (scope === 'lop') keys.add('lop-top');
  };
  metrics.forEach((metric) => {
    scopes.forEach((scope) => {
      const rank = rankings?.[metric]?.[scope]?.hang ?? rankings?.[metric]?.[scope]?.rank;
      addRankKey(scope, rank);
    });
  });

  return { all, keys: [...keys] };
}

function mapPresentationRow(row) {
  const availableTitles = buildTitleCatalog(row);
  const frameAccess = buildFrameAccess(row);
  const storedFrameKey = String(row.equipped_frame_id || '').replace(/^frame:/, '').trim();
  const equippedFrameId = storedFrameKey
    && (frameAccess.all || frameAccess.keys.includes(storedFrameKey))
    ? `frame:${storedFrameKey}`
    : null;
  const availableById = new Map(availableTitles.map((title) => [title.id, title]));
  const unlockedAchievements = new Map(
    (Array.isArray(row.achievements) ? row.achievements : []).map((item) => [item.id, item])
  );
  const achievementCatalog = (Array.isArray(row.achievement_catalog) ? row.achievement_catalog : [])
    .filter((definition) => !availableById.has(`title:${definition.id}`))
    .map((definition) => {
      const unlocked = unlockedAchievements.get(definition.id);
      return {
        id: `achievement:${definition.id}`,
        label: definition.label,
        detail: definition.description,
        tone: definition.tone || 'blue',
        rarity: definition.rarity || 'common',
        is_unlocked: Boolean(unlocked),
        unlocked_at: unlocked?.unlocked_at || null,
        evidence: unlocked?.evidence || null
      };
    });
  const storedIds = Array.isArray(row.displayed_title_ids) ? row.displayed_title_ids : null;
  const selectedIds = storedIds === null
    ? [availableTitles[0]?.id || 'member:bdu']
    : [...new Set(storedIds.map(String))].filter((id) => availableById.has(id)).slice(0, MAX_DISPLAYED_TITLES);
  const hasTtcds = availableTitles.some((t) => t.id === 'title:ttcds' || t.id === 'achievement:ttcds' || String(t.label || '').toUpperCase().includes('TTCDS'))
    || (process.env.SYSTEM_OWNER_MSSV && normalizeMssv(row.mssv) === normalizeMssv(process.env.SYSTEM_OWNER_MSSV));

  return {
    mssv: row.mssv,
    name: row.full_name || row.mssv,
    avatar_url: row.avatar_override_url || row.bdu_avatar_url || null,
    avatar_source: row.avatar_override_url ? 'override' : (row.bdu_avatar_url ? 'bdu' : 'initials'),
    avatar_updated_at: row.avatar_override_updated_at || null,
    max_titles: MAX_DISPLAYED_TITLES,
    can_create_clan: Boolean(hasTtcds),
    available_titles: availableTitles.map(({ priority, ...title }) => title),
    achievement_catalog: achievementCatalog,
    frame_access: frameAccess,
    equipped_frame_id: equippedFrameId,
    selected_title_ids: selectedIds,
    selected_titles: selectedIds.map((id) => availableById.get(id)).filter(Boolean).map(({ priority, ...title }) => title)
  };
}

async function readPresentationRows(mssvs) {
  const normalized = [...new Set(mssvs.map(normalizeMssv).filter(Boolean))];
  if (!normalized.length || !isDatabaseConfigured()) return [];
  const result = await query(`
    WITH latest_rankings AS (
      SELECT DISTINCT ON (rankings.mssv)
        rankings.mssv,
        rankings.rankings,
        rankings.cumulative_classification,
        rankings.cumulative_gpa_4,
        rankings.cumulative_earned_credits,
        rankings.class_code,
        rankings.faculty_code,
        rankings.cohort
      FROM academic_rankings rankings
      JOIN academic_ranking_sync_runs runs ON runs.id = rankings.sync_run_id
      WHERE rankings.mssv = ANY($1::text[]) AND runs.status = 'succeeded'
      ORDER BY rankings.mssv, runs.completed_at DESC
    ), clan_memberships AS (
      SELECT memberships.mssv, JSONB_AGG(JSONB_BUILD_OBJECT(
        'id', clans.id,
        'name', clans.name,
        'tag', clans.tag,
        'role', memberships.role
      ) ORDER BY memberships.joined_at ASC) AS clans
      FROM student_clans memberships
      JOIN clans ON clans.id = memberships.clan_id
      WHERE memberships.mssv = ANY($1::text[])
      GROUP BY memberships.mssv
    ), manual_entitlements AS (
      SELECT grants.mssv, JSONB_AGG(JSONB_BUILD_OBJECT(
        'grant_id', grants.id,
        'id', items.id,
        'item_type', items.item_type,
        'label', items.label,
        'description', items.description,
        'rarity', items.rarity,
        'asset_key', items.asset_key,
        'display_policy', items.display_policy,
        'metadata', items.metadata,
        'expires_at', grants.expires_at
      ) ORDER BY items.sort_order, items.id) AS entitlements
      FROM identity_entitlement_grants grants
      JOIN identity_items items
        ON items.id = grants.item_id AND items.is_active = TRUE
      WHERE grants.mssv = ANY($1::text[])
        AND grants.revoked_at IS NULL
        AND grants.starts_at <= NOW()
        AND (grants.expires_at IS NULL OR grants.expires_at > NOW())
      GROUP BY grants.mssv
    ), unlocked_achievements AS (
      SELECT unlocks.mssv, JSONB_AGG(JSONB_BUILD_OBJECT(
        'id', definitions.id,
        'label', definitions.label,
        'description', definitions.description,
        'tone', definitions.tone,
        'rarity', definitions.rarity,
        'sort_order', definitions.sort_order,
        'unlocked_at', unlocks.unlocked_at,
        'evidence', unlocks.evidence
      ) ORDER BY definitions.sort_order, unlocks.unlocked_at) AS achievements
      FROM student_achievement_unlocks unlocks
      JOIN achievement_definitions definitions
        ON definitions.id = unlocks.achievement_id AND definitions.is_active = TRUE
      JOIN students active_students
        ON active_students.mssv = unlocks.mssv AND active_students.is_active = TRUE
      WHERE unlocks.mssv = ANY($1::text[])
      GROUP BY unlocks.mssv
    ), active_achievement_catalog AS (
      SELECT JSONB_AGG(JSONB_BUILD_OBJECT(
        'id', id,
        'label', label,
        'description', description,
        'tone', tone,
        'rarity', rarity
      ) ORDER BY sort_order, id) AS definitions
      FROM achievement_definitions
      WHERE is_active = TRUE
    ), semester_highlights AS (
      SELECT
        sr.mssv,
        BOOL_OR(sr.semester_gpa_4 >= 4.0) AS has_perfect_semester,
        BOOL_OR(sr.earned_credits >= 18 AND sr.semester_gpa_4 >= 3.0) AS has_heavy_semester
      FROM student_semester_results sr
      WHERE sr.mssv = ANY($1::text[])
      GROUP BY sr.mssv
    ), community_contributions AS (
      SELECT
        posts.author_mssv AS mssv,
        TRUE AS has_community_contribution
      FROM course_posts posts
      WHERE posts.author_mssv = ANY($1::text[])
      GROUP BY posts.author_mssv
    )
    SELECT
      students.mssv,
      students.full_name,
      students.avatar_url AS bdu_avatar_url,
      avatar_overrides.url_img AS avatar_override_url,
      avatar_overrides.updated_at AS avatar_override_updated_at,
      students.displayed_title_ids,
      students.equipped_frame_id,
      students.class_code AS student_class_code,
      students.faculty_code AS student_faculty_code,
      students.cohort AS student_cohort,
      students.has_failed_course,
      latest_rankings.rankings,
      latest_rankings.cumulative_classification,
      latest_rankings.cumulative_gpa_4,
      latest_rankings.cumulative_earned_credits,
      COALESCE(semester_highlights.has_perfect_semester, FALSE) AS has_perfect_semester,
      COALESCE(semester_highlights.has_heavy_semester, FALSE) AS has_heavy_semester,
      COALESCE(community_contributions.has_community_contribution, FALSE) AS has_community_contribution,
      latest_rankings.class_code AS ranking_class_code,
      latest_rankings.faculty_code AS ranking_faculty_code,
      latest_rankings.cohort AS ranking_cohort,
      COALESCE(clan_memberships.clans, '[]'::jsonb) AS clans,
      COALESCE(unlocked_achievements.achievements, '[]'::jsonb) AS achievements,
      COALESCE(manual_entitlements.entitlements, '[]'::jsonb) AS manual_entitlements,
      COALESCE(
        (SELECT definitions FROM active_achievement_catalog),
        '[]'::jsonb
      ) AS achievement_catalog
    FROM students
    LEFT JOIN latest_rankings ON latest_rankings.mssv = students.mssv
    LEFT JOIN clan_memberships ON clan_memberships.mssv = students.mssv
    LEFT JOIN unlocked_achievements ON unlocked_achievements.mssv = students.mssv
    LEFT JOIN manual_entitlements ON manual_entitlements.mssv = students.mssv
    LEFT JOIN semester_highlights ON semester_highlights.mssv = students.mssv
    LEFT JOIN community_contributions ON community_contributions.mssv = students.mssv
    LEFT JOIN student_avatar_overrides avatar_overrides
      ON avatar_overrides.mssv = students.mssv
     AND avatar_overrides.deleted_at IS NULL
     AND NULLIF(avatar_overrides.url_img, '') IS NOT NULL
    WHERE students.mssv = ANY($1::text[]);
  `, [normalized]);
  return result.rows;
}

export const IdentityPresentationService = {
  async recordProfile(mssv, profilePayload) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !isDatabaseConfigured()) return null;
    const identity = extractProfileIdentity(profilePayload);
    const academic = extractProfileAcademicInfo(profilePayload, cleanMssv);
    const result = await query(`
      INSERT INTO students (mssv, full_name, avatar_url, class_code, faculty_code, cohort, is_active, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, NOW())
      ON CONFLICT (mssv) DO UPDATE SET
        full_name = COALESCE(NULLIF($2, ''), students.full_name),
        avatar_url = COALESCE($3, students.avatar_url),
        class_code = COALESCE($4, students.class_code),
        faculty_code = COALESCE($5, students.faculty_code),
        cohort = COALESCE($6, students.cohort),
        updated_at = NOW()
      RETURNING mssv, full_name, avatar_url, class_code, faculty_code, cohort;
    `, [cleanMssv, identity.name || null, identity.avatarUrl, academic.classCode, academic.facultyCode, academic.cohort]);
    return result.rows[0] || null;
  },

  async getPresentations(mssvs) {
    const rows = await readPresentationRows(mssvs);
    return new Map(rows.map((row) => [row.mssv, mapPresentationRow(row)]));
  },

  async getPresentation(mssv) {
    const cleanMssv = normalizeMssv(mssv);
    const rows = await readPresentationRows([cleanMssv]);
    if (!rows.length) throw httpError('Không tìm thấy hồ sơ sinh viên.', 404);
    return mapPresentationRow(rows[0]);
  },

  async updateSelectedTitles(mssv, selectedTitleIds) {
    const cleanMssv = normalizeMssv(mssv);
    if (!Array.isArray(selectedTitleIds)) throw httpError('Danh sách danh hiệu không hợp lệ.');
    const ids = [...new Set(selectedTitleIds.map(String).map((id) => id.trim()).filter(Boolean))];
    if (ids.length > MAX_DISPLAYED_TITLES) {
      throw httpError(`Chỉ được hiển thị tối đa ${MAX_DISPLAYED_TITLES} danh hiệu.`);
    }
    const current = await this.getPresentation(cleanMssv);
    const allowed = new Set(current.available_titles.map((title) => title.id));
    if (ids.some((id) => !allowed.has(id))) {
      throw httpError('Bạn chỉ có thể chọn danh hiệu mình đang sở hữu.', 403);
    }
    await query(`
      UPDATE students
      SET displayed_title_ids = $2::jsonb, updated_at = NOW()
      WHERE mssv = $1;
    `, [cleanMssv, JSON.stringify(ids)]);
    for (const id of ids) {
      await query(`
        INSERT INTO identity_entitlement_audit (mssv, item_id, action, actor_mssv, metadata)
        VALUES ($1, $2, 'select_title', $1, $3::jsonb);
      `, [cleanMssv, id, JSON.stringify({ selected_title_ids: ids })]);
    }
    return this.getPresentation(cleanMssv);
  },

  async updateEquippedFrame(mssv, frameId) {
    const cleanMssv = normalizeMssv(mssv);
    const requested = String(frameId || 'real').trim().replace(/^frame:/, '');
    if (!cleanMssv || !requested) throw httpError('Khung hiển thị không hợp lệ.');

    const current = await this.getPresentation(cleanMssv);
    const allowed = current.frame_access?.all || current.frame_access?.keys?.includes(requested);
    if (requested !== 'real' && !allowed) {
      throw httpError('Bạn chưa được cấp quyền sử dụng khung này.', 403);
    }

    await query(`
      UPDATE students
      SET equipped_frame_id = $2, cosmetic_updated_at = NOW(), updated_at = NOW()
      WHERE mssv = $1;
    `, [cleanMssv, requested === 'real' ? null : `frame:${requested}`]);

    await query(`
      INSERT INTO identity_entitlement_audit (mssv, item_id, action, actor_mssv, metadata)
      VALUES ($1, $2, 'equip', $1, $3::jsonb);
    `, [cleanMssv, requested === 'real' ? 'frame:auto' : `frame:${requested}`, JSON.stringify({ frame_id: requested })]);
    return this.getPresentation(cleanMssv);
  }
};

export const IdentityPresentationInternals = {
  MAX_DISPLAYED_TITLES,
  buildTitleCatalog,
  buildFrameAccess,
  extractProfileIdentity,
  extractProfileAcademicInfo,
  resolveStudentAcademicContext,
  normalizeAvatarUrl
};
