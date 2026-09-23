import { transaction } from '../db/database.js';

function error(message, status = 400) {
  const result = new Error(message);
  result.status = status;
  return result;
}

async function grantFrameWithClient(client, input) {
  const mssv = String(input.mssv || '').trim().toUpperCase();
  const itemId = String(input.itemId || '').trim();
  const source = String(input.source || '').trim();
  const sourceRef = String(input.sourceRef || '').trim();
  const actorMssv = input.actorMssv ? String(input.actorMssv).trim().toUpperCase() : null;
  const evidence = input.evidence && typeof input.evidence === 'object' && !Array.isArray(input.evidence) ? input.evidence : {};
  if (!/^[A-Z0-9]{6,32}$/.test(mssv) || !/^frame:[a-z0-9_-]{2,64}$/.test(itemId)) throw error('Khung hoặc MSSV không hợp lệ.');
  if (!['manual', 'quest'].includes(source)) throw error('Nguồn cấp khung không hợp lệ.');
  if (source === 'quest' && !/^[a-z0-9:_-]{1,128}$/.test(sourceRef)) throw error('Phần thưởng nhiệm vụ cần mã nhiệm vụ hợp lệ.');
  if (source === 'manual' && !actorMssv) throw error('Thiếu người cấp quyền.');

  const item = await client.query(
    "SELECT id FROM identity_items WHERE id = $1 AND item_type = 'frame' AND is_active = TRUE",
    [itemId]
  );
  if (!item.rowCount) throw error('Không tìm thấy khung đang hoạt động.', 404);

  await client.query(`
    INSERT INTO students (mssv, full_name, is_active)
    VALUES ($1, '', FALSE)
    ON CONFLICT (mssv) DO NOTHING;
  `, [mssv]);

  // A revoked quest reward remains a historical decision; a repeated quest
  // event must never silently grant it again.
  if (source === 'quest') {
    const previous = await client.query(`
      SELECT * FROM identity_entitlement_grants
      WHERE mssv = $1 AND item_id = $2 AND source = 'quest' AND source_ref = $3
      ORDER BY id DESC LIMIT 1
    `, [mssv, itemId, sourceRef]);
    if (previous.rows[0]?.revoked_at) return { grant: previous.rows[0], awarded: false };
  }

  const startsAt = source === 'quest' ? new Date().toISOString() : (input.startsAt || new Date().toISOString());
  const expiresAt = source === 'quest' ? null : (input.expiresAt || null);
  const params = [mssv, itemId, source, sourceRef, actorMssv, input.reason || null, startsAt, expiresAt, JSON.stringify(evidence)];
  const sql = source === 'quest' ? `
    INSERT INTO identity_entitlement_grants
      (mssv, item_id, source, source_ref, granted_by_mssv, reason, starts_at, expires_at, evidence)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    ON CONFLICT (mssv, item_id, source, source_ref) WHERE revoked_at IS NULL DO NOTHING
    RETURNING *;
  ` : `
    INSERT INTO identity_entitlement_grants
      (mssv, item_id, source, source_ref, granted_by_mssv, reason, starts_at, expires_at, evidence)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
    ON CONFLICT (mssv, item_id, source, source_ref) WHERE revoked_at IS NULL
    DO UPDATE SET granted_by_mssv = EXCLUDED.granted_by_mssv,
      reason = EXCLUDED.reason, starts_at = EXCLUDED.starts_at,
      expires_at = EXCLUDED.expires_at, evidence = EXCLUDED.evidence, updated_at = NOW()
    RETURNING *;
  `;
  const result = await client.query(sql, params);
  const awarded = Boolean(result.rowCount);
  const grant = result.rows[0] || (await client.query(`
    SELECT * FROM identity_entitlement_grants
    WHERE mssv = $1 AND item_id = $2 AND source = $3 AND source_ref = $4 AND revoked_at IS NULL
    ORDER BY id DESC LIMIT 1
  `, [mssv, itemId, source, sourceRef])).rows[0];
  if (!grant) throw error('Không thể xác nhận quyền sở hữu khung.', 500);

  if (awarded) {
    await client.query(`
      INSERT INTO identity_entitlement_audit
        (grant_id, mssv, item_id, action, actor_mssv, reason, metadata)
      VALUES ($1, $2, $3, 'grant', $4, $5, $6::jsonb)
    `, [grant.id, mssv, itemId, actorMssv, input.reason || null, JSON.stringify({ source, source_ref: sourceRef, evidence })]);
  }
  return { grant, awarded };
}

export const IdentityRewardService = {
  // Future quest evaluators call this with source='quest', a stable sourceRef
  // (quest id), and evidence. The same frame can also have a manual grant.
  grantFrame(input, client = null) {
    return client
      ? grantFrameWithClient(client, input)
      : transaction((db) => grantFrameWithClient(db, input));
  }
};
