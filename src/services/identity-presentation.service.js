import { isDatabaseConfigured, query } from '../db/database.js';

const MAX_DISPLAYED_TITLES = 3;
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
  if (!raw || raw.startsWith('data:')) return null;
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
  const avatarUrl = normalizeAvatarUrl(
    payload?.student_image
    || profile.student_image
    || profile.hinh_anh
    || profile.url_hinh_anh
    || profile.image
    || profile.anh_the
    || profile.avatar
  );
  return { name, avatarUrl };
}

function buildTitleCatalog(row) {
  const titles = [{
    id: 'member:bdu',
    label: 'Sinh viên BDU',
    detail: 'Thành viên cộng đồng Đại học Bình Dương',
    tone: 'member',
    priority: 900
  }];

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
  const rankings = row.rankings && typeof row.rankings === 'object' ? row.rankings : {};
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

  return titles.sort((a, b) => a.priority - b.priority || a.label.localeCompare(b.label, 'vi'));
}

function mapPresentationRow(row) {
  const availableTitles = buildTitleCatalog(row);
  const availableById = new Map(availableTitles.map((title) => [title.id, title]));
  const unlockedAchievements = new Map(
    (Array.isArray(row.achievements) ? row.achievements : []).map((item) => [item.id, item])
  );
  const achievementCatalog = (Array.isArray(row.achievement_catalog) ? row.achievement_catalog : [])
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
  return {
    mssv: row.mssv,
    name: row.full_name || row.mssv,
    avatar_url: row.avatar_url || null,
    max_titles: MAX_DISPLAYED_TITLES,
    available_titles: availableTitles.map(({ priority, ...title }) => title),
    achievement_catalog: achievementCatalog,
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
        rankings.cumulative_classification
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
    )
    SELECT
      students.mssv,
      students.full_name,
      students.avatar_url,
      students.displayed_title_ids,
      latest_rankings.rankings,
      latest_rankings.cumulative_classification,
      COALESCE(clan_memberships.clans, '[]'::jsonb) AS clans,
      COALESCE(unlocked_achievements.achievements, '[]'::jsonb) AS achievements,
      COALESCE(
        (SELECT definitions FROM active_achievement_catalog),
        '[]'::jsonb
      ) AS achievement_catalog
    FROM students
    LEFT JOIN latest_rankings ON latest_rankings.mssv = students.mssv
    LEFT JOIN clan_memberships ON clan_memberships.mssv = students.mssv
    LEFT JOIN unlocked_achievements ON unlocked_achievements.mssv = students.mssv
    WHERE students.mssv = ANY($1::text[]);
  `, [normalized]);
  return result.rows;
}

export const IdentityPresentationService = {
  async recordProfile(mssv, profilePayload) {
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanMssv || !isDatabaseConfigured()) return null;
    const identity = extractProfileIdentity(profilePayload);
    const result = await query(`
      INSERT INTO students (mssv, full_name, avatar_url, is_active, updated_at)
      VALUES ($1, $2, $3, TRUE, NOW())
      ON CONFLICT (mssv) DO UPDATE SET
        full_name = COALESCE(NULLIF($2, ''), students.full_name),
        avatar_url = COALESCE($3, students.avatar_url),
        updated_at = NOW()
      RETURNING mssv, full_name, avatar_url;
    `, [cleanMssv, identity.name || null, identity.avatarUrl]);
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
    return this.getPresentation(cleanMssv);
  }
};

export const IdentityPresentationInternals = {
  MAX_DISPLAYED_TITLES,
  buildTitleCatalog,
  extractProfileIdentity,
  normalizeAvatarUrl
};
