import assert from 'node:assert/strict';
import fs from 'node:fs';
import sharp from 'sharp';
import { IdentityPresentationInternals, IdentityPresentationService } from '../src/services/identity-presentation.service.js';
import { IdentityRewardService } from '../src/services/identity-reward.service.js';
import { GamesApi } from '../public/games/js/api.js';
import { frameInfo, loadFrameCatalog, titleBadgesHtml } from '../public/games/js/identity.js';

const items = JSON.parse(fs.readFileSync('src/config/identity-items.json', 'utf8'));
const sourceMigration = fs.readFileSync('migrations/048_identity_reward_sources.sql', 'utf8');
const legacyMigration = fs.readFileSync('migrations/016_community_identity_entitlements.sql', 'utf8');
const titleMigration = fs.readFileSync('migrations/050_merge_nametags_into_titles.sql', 'utf8');
assert.match(sourceMigration, /source_ref/);
assert.match(sourceMigration, /source\s+IN\s*\([^)]*'quest'/s);
assert.match(sourceMigration, /UNIQUE INDEX[^;]*\(mssv, item_id, source, source_ref\)/s);
assert.match(legacyMigration, /to_regclass\('identity_entitlement_source_unique_idx'\)/);
assert.match(titleMigration, /title:ngoc-luc-bao/);
assert.match(titleMigration, /gem_asset/);
const frames = items.filter((item) => /^frame:(violet|relic)-[1-5]$/.test(item.id));
const gemTitles = items.filter((item) => /^title:(ngoc-luc-bao|lam-tinh|ho-phach|kim-quang|hong-ngoc|tu-tinh)$/.test(item.id));
assert.equal(frames.length, 10);
assert.equal(gemTitles.length, 6);
assert.equal(new Set(frames.map((item) => item.id)).size, 10);
const configuredDatabaseUrl = process.env.DATABASE_URL;
process.env.DATABASE_URL = '';
const publicCatalog = await IdentityPresentationService.listFrameCatalog();
if (configuredDatabaseUrl === undefined) delete process.env.DATABASE_URL;
else process.env.DATABASE_URL = configuredDatabaseUrl;
assert.equal(publicCatalog.filter((item) => /^(violet|relic)-[1-5]$/.test(item.key)).length, 10);
assert.ok(gemTitles.every((item) => item.item_type === 'title' && item.metadata.gem_asset));

for (const item of frames) {
  assert.equal(item.metadata.manual_grantable, true);
  assert.deepEqual(item.metadata.reward_sources, ['manual', 'quest']);
  const asset = `public${item.metadata.asset_url}`;
  assert.ok(fs.existsSync(asset), `${asset} must exist`);
  const { data, info } = await sharp(asset).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(info.channels, 4);
  assert.equal(data[3], 0, `${asset} must have transparent corners`);
  assert.equal(data[(Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * 4 + 3], 0, `${asset} must leave the avatar aperture transparent`);
}

for (const color of ['green', 'blue', 'orange', 'gold', 'pink', 'purple']) {
  const asset = `public/assets/title-tags/${color}.webp`;
  assert.ok(fs.existsSync(asset));
  const { data } = await sharp(asset).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, `${asset} must have transparent corners`);
}

GamesApi.frames = async () => ({ frames: frames.map((item) => ({
  key: item.asset_key,
  label: item.label,
  rarity: item.rarity,
  collection: item.metadata.collection,
  asset_url: item.metadata.asset_url
})) });
await loadFrameCatalog();
assert.equal(frameInfo('frame:relic-3')?.asset, '/assets/frames/relic-3.webp');
assert.equal(frameInfo('frame:relic-3')?.tier, 'fantasy');
assert.doesNotMatch(titleBadgesHtml([{ label: 'Học thần', tone: 'gold' }]), /has-title-gem/);
assert.match(titleBadgesHtml([{ id: 'title:ngoc-luc-bao', label: '#Ngọc Lục Bảo', tone: 'emerald', gem_asset: 'green' }]), /has-title-gem gem-green/);

const access = IdentityPresentationInternals.buildFrameAccess({ manual_entitlements: [
  { id: 'frame:violet-1', item_type: 'frame', asset_key: 'violet-1', source: 'manual' },
  { id: 'frame:violet-1', item_type: 'frame', asset_key: 'violet-1', source: 'quest' }
] });
assert.deepEqual(access.keys, ['violet-1'], 'independent grants must resolve to one owned frame');

const presentation = IdentityPresentationInternals.mapPresentationRow({
  mssv: 'TEST0001', full_name: 'Người kiểm thử',
  displayed_title_ids: ['member:bdu'],
  manual_entitlements: [{ id: 'title:ngoc-luc-bao', item_type: 'title', label: '#Ngọc Lục Bảo', asset_key: 'ngoc-luc-bao', rarity: 'rare', metadata: { tone: 'emerald', gem_asset: 'green' } }]
});
assert.equal(presentation.selected_titles[0].id, 'member:bdu', 'old title selection remains independent');
assert.equal(presentation.available_titles.find((item) => item.id === 'title:ngoc-luc-bao').gem_asset, 'green');

const grants = [];
const audits = [];
let nextId = 1;
const client = {
  async query(sql, params = []) {
    if (sql.includes("SELECT id FROM identity_items WHERE id = $1 AND item_type = 'frame'")) {
      return { rowCount: 1, rows: [{ id: params[0] }] };
    }
    if (sql.includes('INSERT INTO students')) return { rowCount: 1, rows: [] };
    if (sql.includes('SELECT * FROM identity_entitlement_grants')) {
      const [mssv, itemId, source, sourceRef] = sql.includes("source = 'quest'")
        ? [params[0], params[1], 'quest', params[2]] : params;
      const matching = grants.filter((grant) => grant.mssv === mssv && grant.item_id === itemId && grant.source === source && grant.source_ref === sourceRef && (!sql.includes('revoked_at IS NULL') || !grant.revoked_at));
      const row = matching.at(-1);
      return { rowCount: row ? 1 : 0, rows: row ? [row] : [] };
    }
    if (sql.includes('INSERT INTO identity_entitlement_grants')) {
      const [mssv, item_id, source, source_ref] = params;
      const active = grants.find((grant) => grant.mssv === mssv && grant.item_id === item_id && grant.source === source && grant.source_ref === source_ref && !grant.revoked_at);
      if (active && sql.includes('DO NOTHING')) return { rowCount: 0, rows: [] };
      if (active) return { rowCount: 1, rows: [active] };
      const row = { id: nextId++, mssv, item_id, source, source_ref, expires_at: params[7], revoked_at: null };
      grants.push(row);
      return { rowCount: 1, rows: [row] };
    }
    if (sql.includes('INSERT INTO identity_entitlement_audit')) {
      audits.push(params);
      return { rowCount: 1, rows: [] };
    }
    throw new Error(`Unexpected query: ${sql.slice(0, 80)}`);
  }
};

const reward = { mssv: 'TEST0001', itemId: 'frame:violet-1', source: 'quest', sourceRef: 'future-quest', evidence: { completed: true } };
assert.equal((await IdentityRewardService.grantFrame(reward, client)).awarded, true);
assert.equal((await IdentityRewardService.grantFrame(reward, client)).awarded, false);
assert.equal((await IdentityRewardService.grantFrame({ ...reward, source: 'manual', sourceRef: '', actorMssv: 'ADMIN001' }, client)).awarded, true);
assert.equal(grants.length, 2, 'manual and quest ownership coexist');
assert.equal(grants.find((grant) => grant.source === 'quest').expires_at, null, 'quest reward is permanent');
assert.equal(audits.length, 2, 'repeat quest delivery creates no duplicate audit');

grants.find((grant) => grant.source === 'manual').revoked_at = new Date().toISOString();
assert.equal(grants.filter((grant) => !grant.revoked_at).length, 1, 'revoking the manual source leaves quest ownership');

console.log('✓ Fantasy assets, catalog, and independent reward sources are valid.');
