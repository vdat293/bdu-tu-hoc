/**
 * Facebook Import Service
 *
 * Kéo bài viết từ nhóm Facebook (mặc định: nhóm BDU Confessions) về bảng tin
 * Confession bằng Playwright persistent context.
 *
 * Vì sao không gọi API bằng cookie tay:
 * - Facebook đã khai tử Groups API nên không còn đường chính thức.
 * - Feed được render qua GraphQL với doc_id đổi định kỳ; gọi HTTP trần sẽ vỡ
 *   ngay khi Facebook đổi build. Ở đây ta mở trình duyệt thật, để Facebook tự
 *   gọi GraphQL rồi bắt lại response — cấu trúc payload bền hơn nhiều so với
 *   đọc DOM.
 *
 * Toàn bộ hàm thuần (chuẩn hoá story, bút danh, chọn ảnh) được export riêng để
 * test không cần trình duyệt.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { isDatabaseConfigured, query, transaction, withAdvisoryLock } from '../db/database.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..', '..');

const IMPORT_LOCK_ID = 2_030_036_029;
const MAX_CONTENT_LENGTH = 10000;
const MAX_TITLE_LENGTH = 180;
const MAX_IMAGES_PER_POST = 6;
const MAX_ATTACHMENTS_PER_POST = 8;
const MIN_IMAGE_EDGE = 200;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const GRAPHQL_URL_MARKER = '/api/graphql';
const DEFAULT_GROUP_URL = 'https://www.facebook.com/groups/bdu.confessions';
const FALLBACK_AUTHOR_MSSV = 'FACEBOOK_USER_GUEST';
const PSEUDONYM_PREFIX = 'facebook_user_';

const IMAGE_FIELD_NAMES = [
  'viewer_image',
  'image',
  'photo_image',
  'thumbnail_image',
  'preview_image',
  'large_shared_image',
  'image_hd'
];

let scheduler = null;
let initialTimer = null;
let starting = false;
let running = false;
let activeContext = null;
let lastRun = null;

function boolEnv(name, fallback = false) {
  const value = process.env[name];
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

function httpError(message, status = 500) {
  const error = new Error(message);
  error.status = status;
  return error;
}

export function importConfig() {
  const groupUrl = String(process.env.FB_IMPORT_GROUP_URL || DEFAULT_GROUP_URL).trim();
  return {
    enabled: boolEnv('FB_IMPORT_ENABLED', false),
    groupUrl,
    groupSlug: groupSlugFromUrl(groupUrl),
    intervalMinutes: intEnv('FB_IMPORT_INTERVAL_MINUTES', 20, 5, 1440),
    initialDelaySeconds: intEnv('FB_IMPORT_INITIAL_DELAY_SECONDS', 20, 0, 3600),
    maxScrolls: intEnv('FB_IMPORT_MAX_SCROLLS', 6, 1, 30),
    maxPostsPerRun: intEnv('FB_IMPORT_MAX_POSTS_PER_RUN', 10, 1, 100),
    scrollDelayMs: intEnv('FB_IMPORT_SCROLL_DELAY_MS', 3500, 500, 30000),
    settleDelayMs: intEnv('FB_IMPORT_SETTLE_DELAY_MS', 4000, 500, 30000),
    maxDuplicatesInRow: intEnv('FB_IMPORT_MAX_DUPLICATES', 5, 1, 50),
    maxPostAgeDays: intEnv('FB_IMPORT_MAX_POST_AGE_DAYS', 30, 1, 3650),
    downloadMedia: boolEnv('FB_IMPORT_DOWNLOAD_MEDIA', true),
    hashSalt: String(process.env.FB_IMPORT_HASH_SALT || 'bdu-confessions'),
    profileDir: path.resolve(ROOT_DIR, process.env.FB_IMPORT_PROFILE_DIR || 'data/fb-profile'),
    mediaDir: path.resolve(ROOT_DIR, process.env.FB_IMPORT_MEDIA_DIR || 'data/fb-import'),
    mediaUrlBase: String(process.env.FB_IMPORT_MEDIA_URL_BASE || '/media/fb-import').replace(/\/+$/, ''),
    browserChannel: String(process.env.FB_IMPORT_BROWSER_CHANNEL || 'chrome').trim(),
    executablePath: String(process.env.FB_IMPORT_EXECUTABLE_PATH || '').trim() || null,
    headless: boolEnv('FB_IMPORT_HEADLESS', true),
    facebookUsername: String(process.env.FB_IMPORT_USERNAME || '').trim(),
    facebookPassword: String(process.env.FB_IMPORT_PASSWORD || ''),
    autoRelogin: boolEnv('FB_IMPORT_AUTO_RELOGIN', true),
    reloginMaxAttempts: intEnv('FB_IMPORT_RELOGIN_MAX_ATTEMPTS', 2, 1, 5),
    reloginCooldownMinutes: intEnv('FB_IMPORT_RELOGIN_COOLDOWN_MINUTES', 360, 15, 10080)
  };
}

export function groupSlugFromUrl(url) {
  try {
    const parsed = new URL(String(url || '').trim());
    const match = parsed.pathname.match(/\/groups\/([^/]+)/i);
    return match ? decodeURIComponent(match[1]) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Chuẩn hoá dữ liệu (hàm thuần, test được không cần trình duyệt)      */
/* ------------------------------------------------------------------ */

function firstString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function pickObject(node, keys) {
  if (!node || typeof node !== 'object') return null;
  for (const key of keys) {
    const value = node[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return null;
}

export function storyMessageText(node) {
  if (!node || typeof node !== 'object') return '';
  if (typeof node.message === 'string') return node.message;

  const cometStory = pickObject(pickObject(node, ['comet_sections']), ['content']);
  const nestedStory = pickObject(cometStory, ['story']);
  const message =
    pickObject(node, ['message', 'message_preferred_body']) ||
    pickObject(nestedStory, ['message', 'message_preferred_body']);

  return firstString(
    message?.text,
    message?.text_with_truncation,
    typeof message?.text_with_entities === 'string' ? message.text_with_entities : ''
  );
}

function actorList(node) {
  const actors = node?.actors;
  if (Array.isArray(actors)) return actors;
  if (actors && typeof actors === 'object') {
    if (Array.isArray(actors.nodes)) return actors.nodes;
    if (actors.id || actors.name) return [actors];
  }
  return [];
}

export function storyAuthor(node) {
  const actors = actorList(node);
  const actor = actors.find((item) => item && typeof item === 'object') || {};
  const id = firstString(actor.id, actor.user_id, actor.profile_id, node?.actor_id);
  const name = firstString(actor.name, actor.short_name);
  return { id, name };
}

/**
 * Bút danh ổn định: cùng một người luôn ra cùng một `facebook_user_<8 hex>`,
 * nhưng không thể suy ngược ra id Facebook khi không có salt.
 */
export function buildPseudonym(authorKey, salt) {
  const seed = String(authorKey || '').trim() || 'guest';
  const digest = crypto
    .createHash('sha256')
    .update(`${salt}:${seed}`)
    .digest('hex')
    .slice(0, 8);
  return `${PSEUDONYM_PREFIX}${digest}`;
}

/** post_id dạng "<group>_<post>" hoặc id trần; chỉ giữ phần id bài viết. */
export function facebookPostId(node) {
  const raw = firstString(node?.post_id, node?.id, node?.story_id, node?.feedback?.id);
  if (!raw) return null;
  const parts = raw.split('_');
  const candidate = parts.length > 1 ? parts[parts.length - 1] : parts[0];
  return /^\d{5,32}$/.test(candidate) ? candidate : null;
}

export function facebookPermalink(node, groupSlug) {
  const direct = firstString(node?.permalink_url, node?.url, node?.wwwURL, node?.story_permalink);
  if (/^https?:\/\/(www\.)?facebook\.com\//i.test(direct)) return direct;
  if (/^\/groups\//i.test(direct)) return `https://www.facebook.com${direct}`;
  const postId = facebookPostId(node);
  if (!postId) return null;
  const slug = groupSlug || 'bdu.confessions';
  return `https://www.facebook.com/groups/${slug}/posts/${postId}/`;
}

function imageUrlFromMedia(media) {
  for (const field of IMAGE_FIELD_NAMES) {
    const candidate = media?.[field];
    if (typeof candidate === 'string' && candidate) return candidate;
    if (candidate && typeof candidate === 'object') {
      const uri = firstString(candidate.uri, candidate.src, candidate.url);
      if (uri) return uri;
    }
  }
  return firstString(media?.uri, media?.src);
}

function imageDimensions(media) {
  for (const field of IMAGE_FIELD_NAMES) {
    const candidate = media?.[field];
    if (candidate && typeof candidate === 'object') {
      const width = Number(candidate.width || candidate.width_px || 0);
      const height = Number(candidate.height || candidate.height_px || 0);
      if (width || height) return { width, height };
    }
  }
  return { width: 0, height: 0 };
}

function isUsableImage(media) {
  if (!media || typeof media !== 'object') return false;
  const typename = firstString(media.__typename, media.type);
  if (/sticker|emoji/i.test(typename)) return false;
  const { width, height } = imageDimensions(media);
  if (Math.max(width, height) > 0 && Math.max(width, height) < MIN_IMAGE_EDGE) return false;
  return true;
}

/** Thu thập URL ảnh từ attachments (kể cả all_subattachments), khử trùng lặp. */
export function storyImageUrls(node, limit = MAX_IMAGES_PER_POST) {
  const urls = [];
  const seen = new Set();

  const push = (media) => {
    if (urls.length >= limit || !isUsableImage(media)) return;
    const url = imageUrlFromMedia(media);
    if (!url || !/^https?:\/\//i.test(url)) return;
    const signature = url.split('?')[1] || '';
    const key = `${url.split('?')[0]}?${signature.slice(0, 40)}`;
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(url);
  };

  const walk = (value, depth) => {
    if (!value || typeof value !== 'object' || depth > 8 || urls.length >= limit) return;
    if (Array.isArray(value)) {
      value.forEach((item) => walk(item, depth + 1));
      return;
    }
    if (value.media) {
      if (Array.isArray(value.media)) value.media.forEach(push);
      else if (!value.media.all_subattachments) push(value.media);
    }
    const subNodes = value.all_subattachments?.nodes;
    if (Array.isArray(subNodes)) {
      subNodes.forEach((sub) => {
        if (Array.isArray(sub?.media)) sub.media.forEach(push);
        else push(sub?.media);
      });
    }
    for (const key of ['attachments', 'styles', 'attachment', 'subattachments']) {
      if (value[key]) walk(value[key], depth + 1);
    }
  };

  walk(node?.attachments, 0);
  return urls;
}

export function storyPostedAt(node) {
  const raw = node?.creation_time ?? node?.created_time ?? node?.publish_time;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds > 1_000_000_000) return new Date(seconds * 1000);
  if (typeof raw === 'string') {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

/**
 * Bắt các object "trông giống story" trong payload GraphQL.
 * Facebook bọc story trong nhiều tầng comet_sections khác nhau và đổi tên khóa
 * liên tục, nên quét tổng quát theo dấu hiệu (có id bài viết + có nội dung/ảnh)
 * bền hơn khoan đúng một đường dẫn cố định.
 */
export function collectStoryNodes(payload, { maxNodes = 200_000, maxDepth = 30 } = {}) {
  const stories = [];
  const seenIds = new Set();
  const queue = [{ value: payload, depth: 0 }];
  let visited = 0;

  while (queue.length) {
    const { value, depth } = queue.shift();
    if (!value || typeof value !== 'object' || depth > maxDepth) continue;
    if (visited >= maxNodes) break;
    visited += 1;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') queue.push({ value: item, depth: depth + 1 });
      }
      continue;
    }

    const postId = facebookPostId(value);
    if (postId && !seenIds.has(postId)) {
      const hasBody = Boolean(storyMessageText(value)) || storyImageUrls(value, 1).length > 0;
      const looksLikeStory = Boolean(value.creation_time || value.attachments || value.comet_sections);
      if (hasBody && looksLikeStory) {
        seenIds.add(postId);
        stories.push(value);
        continue;
      }
    }

    for (const key of Object.keys(value)) {
      const child = value[key];
      if (child && typeof child === 'object') queue.push({ value: child, depth: depth + 1 });
    }
  }

  return stories;
}

function collapseWhitespace(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Facebook trả feed GraphQL dưới dạng NHIỀU JSON document nối tiếp trong một
 * response (stream). `JSON.parse` trên cả body sẽ lỗi "Unexpected non-whitespace
 * character after JSON", nên phải tách theo dấu ngoặc có nhận biết chuỗi.
 */
export function splitJsonDocuments(text) {
  const docs = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === '{' || char === '[') {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === '}' || char === ']') {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        docs.push(text.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return docs;
}

/** Parse toàn bộ document trong một response GraphQL, bỏ qua chunk lỗi. */
export function parseGraphqlStream(text) {
  const payloads = [];
  for (const doc of splitJsonDocuments(String(text || ''))) {
    try {
      payloads.push(JSON.parse(doc));
    } catch {
      /* Chunk bị cắt hoặc không phải JSON — bỏ qua. */
    }
  }
  return payloads;
}

export function buildTitle(message) {
  const clean = collapseWhitespace(message);
  if (!clean) return 'BDU Confession';
  const firstLine = clean.split('\n').find((line) => line.trim()) || clean;
  if (firstLine.length <= MAX_TITLE_LENGTH) return firstLine;
  return `${firstLine.slice(0, MAX_TITLE_LENGTH - 1).trimEnd()}…`;
}

/**
 * Bài Confession hiển thị cả tiêu đề lẫn nội dung, nên nếu lấy dòng đầu làm
 * tiêu đề thì phải cắt nó khỏi nội dung, tránh lặp chữ. Bài một dòng giữ
 * tiêu đề mặc định cho khỏi lặp.
 */
export function splitTitleAndBody(message) {
  const clean = collapseWhitespace(message);
  if (!clean) return { title: 'BDU Confession', content: '' };

  const lines = clean.split('\n');
  const firstLine = (lines.find((line) => line.trim()) || '').trim();
  const canPromote = lines.length > 1 && firstLine.length <= MAX_TITLE_LENGTH;
  if (!canPromote) return { title: 'BDU Confession', content: clean };

  const rest = lines.slice(lines.indexOf(firstLine) + 1).join('\n').trim();
  if (!rest) return { title: 'BDU Confession', content: clean };
  return { title: firstLine, content: rest };
}

/**
 * Chuyển một node story thô thành bản ghi nhập được. Trả null nếu bài không có
 * nội dung chữ lẫn ảnh (ví dụ story chỉ có reaction/sticker).
 */
export function normalizeStory(node, { groupSlug, hashSalt, now = Date.now(), maxAgeDays = null } = {}) {
  const fbPostId = facebookPostId(node);
  if (!fbPostId) return null;

  const content = collapseWhitespace(storyMessageText(node));
  const imageUrls = storyImageUrls(node);
  if (!content && imageUrls.length === 0) return null;

  const author = storyAuthor(node);
  const authorKey = author.id || author.name || '';
  const postedAt = storyPostedAt(node);
  const { title, content: body } = splitTitleAndBody(content);

  if (maxAgeDays && postedAt) {
    const ageDays = (now - postedAt.getTime()) / 86_400_000;
    if (ageDays > maxAgeDays) return null;
  }

  return {
    fbPostId,
    fbAuthorKey: authorKey ? String(authorKey).slice(0, 128) : null,
    fbAuthorName: author.name || null,
    authorMssv: (authorKey
      ? buildPseudonym(authorKey, hashSalt)
      : FALLBACK_AUTHOR_MSSV).toUpperCase(),
    permalink: facebookPermalink(node, groupSlug),
    content: body.slice(0, MAX_CONTENT_LENGTH),
    title,
    postedAt,
    imageUrls
  };
}

/* ------------------------------------------------------------------ */
/* Nhập vào database                                                   */
/* ------------------------------------------------------------------ */

function extFromContentType(contentType, url) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('png')) return '.png';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  const match = String(url || '').split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i);
  return match ? `.${match[1].toLowerCase().replace('jpeg', 'jpg')}` : '.jpg';
}

async function ensureAuthor(client, mssv, displayName) {
  await client.query(`
    INSERT INTO students (mssv, full_name, is_active)
    VALUES ($1, $2, FALSE)
    ON CONFLICT (mssv) DO NOTHING;
  `, [mssv, displayName]);
}

async function isAlreadyImported(fbPostId) {
  const result = await query(
    'SELECT 1 FROM facebook_import_posts WHERE fb_post_id = $1 LIMIT 1',
    [fbPostId]
  );
  return result.rowCount > 0;
}

export async function downloadStoryImages(request, story, config) {
  if (!config.downloadMedia || story.imageUrls.length === 0) return [];
  const dir = path.join(config.mediaDir, story.fbPostId);

  const stored = [];
  for (let index = 0; index < story.imageUrls.length; index += 1) {
    const url = story.imageUrls[index];
    try {
      const response = await request.get(url, {
        headers: { referer: 'https://www.facebook.com/' },
        timeout: 20_000
      });
      if (!response.ok()) {
        console.warn(`[fb-import] Ảnh ${index} của bài ${story.fbPostId}: HTTP ${response.status()}.`);
        continue;
      }
      const buffer = await response.body();
      if (!buffer?.length || buffer.length > MAX_IMAGE_BYTES) {
        console.warn(`[fb-import] Bỏ ảnh ${index} của bài ${story.fbPostId} (dung lượng bất thường).`);
        continue;
      }
      const ext = extFromContentType(response.headers()['content-type'], url);
      const filename = `${index}${ext}`;
      await fsp.mkdir(dir, { recursive: true });
      await fsp.writeFile(path.join(dir, filename), buffer);
      const publicUrl = `${config.mediaUrlBase}/${story.fbPostId}/${filename}`;
      stored.push({
        type: 'image',
        url: publicUrl,
        direct_url: publicUrl,
        title: 'Ảnh từ bài viết Facebook'
      });
    } catch (error) {
      console.warn(`[fb-import] Không tải được ảnh ${index} của bài ${story.fbPostId}: ${error.message}`);
    }
  }
  return stored;
}

export function buildAttachments(story, imageAttachments) {
  const attachments = [...imageAttachments];
  if (story.permalink) {
    attachments.push({
      type: 'link',
      id: null,
      url: story.permalink,
      embed_url: null,
      direct_url: story.permalink,
      title: 'Bài gốc trên Facebook'
    });
  }
  return attachments.slice(0, MAX_ATTACHMENTS_PER_POST);
}

export async function importStory(context, story, config) {
  if (await isAlreadyImported(story.fbPostId)) {
    return { imported: false, reason: 'duplicate' };
  }

  const imageAttachments = await downloadStoryImages(context.request, story, config);
  const attachments = buildAttachments(story, imageAttachments);
  const displayName = story.authorMssv === FALLBACK_AUTHOR_MSSV
    ? 'facebook_user_guest'
    : story.authorMssv.toLowerCase();

  const outcome = await transaction(async (client) => {
    const claimed = await client.query(`
      INSERT INTO facebook_import_posts (fb_post_id, fb_group_id, fb_author_key, permalink, posted_at)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (fb_post_id) DO NOTHING
      RETURNING id;
    `, [
      story.fbPostId,
      config.groupSlug,
      story.fbAuthorKey,
      story.permalink,
      story.postedAt
    ]);
    if (!claimed.rowCount) return { imported: false, reason: 'duplicate' };

    await ensureAuthor(client, story.authorMssv, displayName);

    const inserted = await client.query(`
      INSERT INTO community_posts (
        author_mssv, title, content, scope, scope_id, is_anonymous,
        attachments, category, is_pinned, source, created_at, updated_at
      )
      VALUES ($1, $2, $3, 'school', NULL, FALSE, $4::jsonb, 'confession', FALSE, 'facebook', $5, NOW())
      RETURNING id;
    `, [
      story.authorMssv,
      story.title,
      story.content || '(Bài viết chỉ có ảnh)',
      JSON.stringify(attachments),
      story.postedAt || new Date()
    ]);
    const postId = inserted.rows[0].id;

    await client.query(`
      UPDATE facebook_import_posts
      SET post_id = $2,
          fb_author_name = $3,
          media = $4::jsonb
      WHERE fb_post_id = $1;
    `, [
      story.fbPostId,
      postId,
      story.fbAuthorName,
      JSON.stringify(imageAttachments.map((item) => item.url))
    ]);

    return { imported: true, postId, images: imageAttachments.length };
  });

  return outcome;
}

/* ------------------------------------------------------------------ */
/* Tự đăng nhập lại khi cookie hết hạn                                 */
/* ------------------------------------------------------------------ */

const LOGIN_URL = 'https://www.facebook.com/login';
const RELOGIN_STATE_FILE = 'relogin-state.json';
const LOGIN_TIMEOUT_MS = 25_000;

function reloginStatePath(config) {
  return path.join(config.profileDir, RELOGIN_STATE_FILE);
}

function readReloginState(config) {
  try {
    const state = JSON.parse(fs.readFileSync(reloginStatePath(config), 'utf8'));
    return {
      failures: Number(state.failures) || 0,
      cooldownUntil: Number(state.cooldownUntil) || 0,
      lastAttemptAt: state.lastAttemptAt || null,
      lastResult: state.lastResult || null
    };
  } catch {
    return { failures: 0, cooldownUntil: 0, lastAttemptAt: null, lastResult: null };
  }
}

function writeReloginState(config, state) {
  fs.mkdirSync(config.profileDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(reloginStatePath(config), JSON.stringify(state, null, 2), { mode: 0o600 });
}

export function loginConfigReady(config) {
  return Boolean(config?.autoRelogin && config?.facebookUsername && config?.facebookPassword);
}

/**
 * Phân loại kết quả sau khi bấm đăng nhập. Tách riêng để test không cần trình duyệt.
 * Facebook trả về nhiều kiểu chặn khác nhau; chỉ 'success' mới đáng để thử lại,
 * còn checkpoint/2FA thì phải xử lý thủ công nếu không muốn bị khoá tài khoản.
 */
export function classifyLoginOutcome({ url = '', hasSession = false, hasTwoFactorPrompt = false, errorText = '' }) {
  if (hasSession) return 'success';
  if (/\/(checkpoint|two_step|two_factor|login\/device|recover)/i.test(url)) return 'checkpoint';
  if (hasTwoFactorPrompt) return 'two_factor';
  const clean = String(errorText || '').replace(/\s+/g, ' ').trim();
  if (clean && /mật khẩu|password|không hợp lệ|không chính xác|không đúng|invalid|incorrect/i.test(clean)) {
    return 'bad_credentials';
  }
  return 'pending';
}

function describeLoginFailure(reason, config) {
  const cooldown = Math.round(config.reloginCooldownMinutes / 60);
  switch (reason) {
    case 'no_credentials':
      return 'Chưa có phiên đăng nhập Facebook và chưa cấu hình FB_IMPORT_USERNAME/FB_IMPORT_PASSWORD. '
        + 'Chạy `npm run fb:login` để đăng nhập một lần.';
    case 'two_factor':
      return 'Facebook yêu cầu mã xác minh 2FA khi đăng nhập tự động. '
        + 'Chạy `npm run fb:login` để xác minh thủ công rồi thử lại.';
    case 'checkpoint':
      return 'Facebook chặn đăng nhập tự động (checkpoint/unusual activity). '
        + 'Chạy `npm run fb:login` để xử lý thủ công.';
    case 'bad_credentials':
      return 'FB_IMPORT_USERNAME hoặc FB_IMPORT_PASSWORD không đúng.';
    case 'login_form_not_found':
      return 'Không tìm thấy form đăng nhập Facebook (Facebook đổi giao diện?). '
        + 'Dùng `npm run fb:login` để đăng nhập thủ công.';
    case 'cooldown':
      return `Đang tạm ngưng thử đăng nhập tự động sau nhiều lần thất bại `
        + `(tránh bị Facebook khoá). Thử lại sau ${cooldown} giờ hoặc chạy \`npm run fb:login\`.`;
    default:
      return 'Không xác định được kết quả đăng nhập Facebook (quá thời gian chờ). '
        + 'Kiểm tra thủ công bằng `npm run fb:login`.';
  }
}

async function dismissConsentBanner(page) {
  const selectors = [
    'button[data-cookiebanner="accept_button"]',
    'button[data-testid="cookie-policy-manage-dialog-accept-button"]',
    '[aria-label="Cho phép tất cả cookie"]',
    '[aria-label="Allow all cookies"]'
  ];
  for (const selector of selectors) {
    const button = page.locator(selector).first();
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 3000 }).catch(() => {});
      return;
    }
  }
}

const LOGIN_SUBMIT_SELECTORS = [
  'button[name="login"]',
  '#loginbutton',
  'button[type="submit"]',
  'form#login_form input[type="submit"]',
  'input[type="submit"]'
];

async function fillFirstAvailable(page, selectors, value) {
  for (const selector of selectors) {
    const field = page.locator(selector).first();
    if (!(await field.count().catch(() => 0))) continue;
    if (!(await field.isVisible().catch(() => false))) continue;
    await field.fill('', { timeout: 5000 }).catch(() => {});
    await field.fill(value, { timeout: 5000 });
    return true;
  }
  return false;
}

/**
 * Facebook render nút đăng nhập dưới dạng <button> không có name/type, còn
 * <input type="submit"> trong form lại bị ẩn — nên phải thử lần lượt và bỏ qua
 * phần tử không hiển thị, cuối cùng mới tới fallback theo accessible name.
 */
async function clickFirstAvailable(page, selectors, roleName) {
  const attempt = async (target) => {
    if (!(await target.count().catch(() => 0))) return false;
    if (!(await target.isVisible().catch(() => false))) return false;
    try {
      await target.click({ timeout: 8000 });
      return true;
    } catch {
      return false;
    }
  };

  for (const selector of selectors) {
    if (await attempt(page.locator(selector).first())) return true;
  }
  if (roleName && await attempt(page.getByRole('button', { name: roleName }).first())) return true;
  return false;
}

/**
 * Đăng nhập bằng tài khoản trong .env. Trả { ok, reason }.
 * Không bao giờ ghi mật khẩu ra log.
 */
export async function attemptFacebookLogin(page, config) {
  if (!loginConfigReady(config)) return { ok: false, reason: 'no_credentials' };

  const context = page.context();
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  await dismissConsentBanner(page);

  const filledEmail = await fillFirstAvailable(page, ['#email', 'input[name="email"]', 'input[type="text"][name="email"]'], config.facebookUsername);
  const filledPassword = await fillFirstAvailable(page, ['#pass', 'input[name="pass"]', 'input[type="password"]'], config.facebookPassword);
  if (!filledEmail || !filledPassword) {
    return { ok: false, reason: 'login_form_not_found' };
  }

  const submitted = await clickFirstAvailable(page, LOGIN_SUBMIT_SELECTORS, /đăng nhập|log ?in/i);
  if (!submitted) return { ok: false, reason: 'login_form_not_found' };

  const deadline = Date.now() + LOGIN_TIMEOUT_MS;
  const startedAt = Date.now();
  let outcome = 'pending';
  let retriedWithEnter = false;

  while (Date.now() < deadline) {
    const cookies = await context.cookies('https://www.facebook.com').catch(() => []);
    const errorText = await page
      .locator('#error_box, [data-testid="error-message"], div[role="alert"]')
      .first()
      .innerText({ timeout: 1000 })
      .catch(() => '');

    outcome = classifyLoginOutcome({
      url: page.url(),
      hasSession: cookies.some((cookie) => cookie.name === 'c_user' && cookie.value),
      hasTwoFactorPrompt: Boolean(await page.locator('input[name="approvals_code"], #approvals_code, #two_factor_code').count().catch(() => 0)),
      errorText
    });

    if (outcome !== 'pending') break;

    // Nút submit của Facebook đôi khi chỉ hoạt động khi form nhận phím Enter.
    if (!retriedWithEnter && Date.now() - startedAt > 5000) {
      retriedWithEnter = true;
      await page.locator('input[name="pass"], #pass').first().press('Enter', { timeout: 5000 }).catch(() => {});
    }
    await page.waitForTimeout(1000);
  }

  return { ok: outcome === 'success', reason: outcome };
}

/**
 * Đảm bảo có phiên Facebook: dùng cookie sẵn có, nếu hết hạn thì thử đăng nhập
 * lại bằng tài khoản trong .env. Có cooldown để không thử mãi khi bị checkpoint.
 */
export async function ensureFacebookSession(context, page, config) {
  if (await hasFacebookSession(context)) {
    const state = readReloginState(config);
    if (state.failures) writeReloginState(config, { failures: 0, cooldownUntil: 0, lastAttemptAt: state.lastAttemptAt, lastResult: 'success' });
    return { ok: true, method: 'existing' };
  }

  if (!loginConfigReady(config)) return { ok: false, reason: 'no_credentials' };

  const state = readReloginState(config);
  const now = Date.now();
  if (state.cooldownUntil > now) return { ok: false, reason: 'cooldown' };

  console.log('[fb-import] Phiên Facebook hết hạn — thử đăng nhập lại bằng FB_IMPORT_USERNAME.');
  const attempt = await attemptFacebookLogin(page, config);

  if (attempt.ok) {
    writeReloginState(config, {
      failures: 0,
      cooldownUntil: 0,
      lastAttemptAt: new Date().toISOString(),
      lastResult: 'success'
    });
    console.log('[fb-import] Đăng nhập lại thành công, tiếp tục lấy feed.');
    return { ok: true, method: 'relogin' };
  }

  const failures = (state.failures || 0) + 1;
  const cooldownUntil = failures >= config.reloginMaxAttempts
    ? now + config.reloginCooldownMinutes * 60_000
    : 0;
  writeReloginState(config, {
    failures,
    cooldownUntil,
    lastAttemptAt: new Date().toISOString(),
    lastResult: attempt.reason
  });

  console.warn(
    `[fb-import] Đăng nhập lại thất bại (${attempt.reason}, lần ${failures}/${config.reloginMaxAttempts})`
    + (cooldownUntil ? ` — tạm ngưng tới ${new Date(cooldownUntil).toISOString()}.` : '.')
  );
  return { ok: false, reason: attempt.reason, failures, cooldownUntil };
}

/* ------------------------------------------------------------------ */
/* Thu thập feed bằng trình duyệt                                      */
/* ------------------------------------------------------------------ */

async function launchBrowser(config) {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    throw httpError('Chưa cài playwright-core. Chạy: npm install playwright-core', 503);
  }

  fs.mkdirSync(config.profileDir, { recursive: true, mode: 0o700 });
  const options = {
    headless: config.headless,
    viewport: { width: 1366, height: 900 },
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
    args: ['--disable-blink-features=AutomationControlled', '--no-first-run']
  };
  if (config.executablePath) options.executablePath = config.executablePath;
  else if (config.browserChannel) options.channel = config.browserChannel;

  const context = await chromium.launchPersistentContext(config.profileDir, options);
  context.setDefaultTimeout(30_000);
  return context;
}

async function hasFacebookSession(context) {
  const cookies = await context.cookies('https://www.facebook.com');
  return cookies.some((cookie) => cookie.name === 'c_user' && cookie.value);
}

/**
 * Mở trình duyệt thật (có giao diện) để người dùng đăng nhập Facebook một lần.
 * Phiên lưu vào profileDir nên các lần chạy headless sau dùng lại được.
 */
export async function openLoginSession() {
  const config = { ...importConfig(), headless: false };
  const context = await launchBrowser(config);
  const page = context.pages()[0] || (await context.newPage());
  await page.goto(config.groupUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 }).catch(() => {});
  return { context, page, config, isLoggedIn: () => hasFacebookSession(context) };
}

/**
 * Mở trình duyệt, cuộn feed, và gọi `onStory(story, context)` cho từng bài mới
 * ngay trong lúc context còn sống (ảnh cần cookie phiên để tải).
 */
export async function withGroupSession(config, handler) {
  const context = await launchBrowser(config);
  activeContext = context;
  const payloads = [];

  try {
    const page = context.pages()[0] || (await context.newPage());
    page.on('response', async (response) => {
      if (!response.url().includes(GRAPHQL_URL_MARKER)) return;
      const text = await response.text().catch(() => '');
      if (!text) return;
      payloads.push(...parseGraphqlStream(text));
    });

    await page.goto(config.groupUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });

    const session = await ensureFacebookSession(context, page, config);
    if (!session.ok) {
      throw httpError(describeLoginFailure(session.reason, config), 401);
    }

    // Vừa đăng nhập lại thì trang đang ở /login hoặc news feed, phải quay về nhóm.
    if (session.method === 'relogin') {
      await page.goto(config.groupUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    }

    const seen = new Set();
    let collected = 0;

    const drain = async () => {
      while (payloads.length) {
        const payload = payloads.shift();
        for (const node of collectStoryNodes(payload)) {
          const story = normalizeStory(node, {
            groupSlug: config.groupSlug,
            hashSalt: config.hashSalt,
            maxAgeDays: config.maxPostAgeDays
          });
          if (!story || seen.has(story.fbPostId)) continue;
          seen.add(story.fbPostId);
          collected += 1;
          const stop = await handler(story, context);
          if (stop === true) return true;
        }
      }
      return false;
    };

    for (let scroll = 0; scroll < config.maxScrolls; scroll += 1) {
      for (let step = 0; step < 3; step += 1) {
        await page.mouse.wheel(0, 1200).catch(() => {});
        await page.waitForTimeout(200);
      }
      // Feed chỉ được tải sau khi trang cuộn; chờ cho response kịp về.
      await page.waitForTimeout(config.scrollDelayMs);

      if (await drain()) return collected;
      if (collected >= config.maxPostsPerRun) break;
    }

    // Vét nốt các response về muộn sau lần cuộn cuối.
    await page.waitForTimeout(config.settleDelayMs);
    await drain();

    return collected;
  } finally {
    activeContext = null;
    await context.close().catch(() => {});
  }
}

/* ------------------------------------------------------------------ */
/* Điều phối                                                           */
/* ------------------------------------------------------------------ */

async function recordRunStart() {
  const result = await query('INSERT INTO facebook_import_runs DEFAULT VALUES RETURNING id');
  return result.rows[0].id;
}

async function recordRunFinish(runId, patch) {
  await query(`
    UPDATE facebook_import_runs
    SET finished_at = NOW(), status = $2, stories_seen = $3, imported_count = $4,
        skipped_count = $5, error_message = $6
    WHERE id = $1;
  `, [
    runId,
    patch.status,
    patch.storiesSeen || 0,
    patch.importedCount || 0,
    patch.skippedCount || 0,
    patch.errorMessage || null
  ]);
}

export async function runOnce({ trigger = 'manual' } = {}) {
  if (!isDatabaseConfigured()) throw httpError('Chưa cấu hình database.', 503);
  if (running) return { skipped: true, reason: 'already_running' };

  running = true;
  try {
    const locked = await withAdvisoryLock(IMPORT_LOCK_ID, async () => {
      const config = importConfig();
      const runId = await recordRunStart();
      const counters = { seen: 0, imported: 0, duplicates: 0, failed: 0, duplicatesInRow: 0 };

      try {
        await withGroupSession(config, async (story, context) => {
          counters.seen += 1;
          try {
            const outcome = await importStory(context, story, config);
            if (outcome.imported) {
              counters.imported += 1;
              counters.duplicatesInRow = 0;
            } else {
              counters.duplicates += 1;
              counters.duplicatesInRow += 1;
            }
          } catch (error) {
            counters.failed += 1;
            counters.duplicatesInRow += 1;
            console.warn(`[fb-import] Bài ${story.fbPostId} lỗi: ${error.message}`);
          }

          // Dừng khi đã đủ chỉ tiêu, hoặc khi gặp một dãy bài cũ liên tiếp
          // (nghĩa là đã tới vùng đã nhập ở các lượt trước, cuộn thêm là vô ích).
          return counters.imported >= config.maxPostsPerRun
            || counters.duplicatesInRow >= config.maxDuplicatesInRow;
        });

        await recordRunFinish(runId, {
          status: counters.failed ? 'partial' : 'success',
          storiesSeen: counters.seen,
          importedCount: counters.imported,
          skippedCount: counters.duplicates + counters.failed
        });
        return { skipped: false, runId, trigger, ...counters };
      } catch (error) {
        await recordRunFinish(runId, {
          status: 'failed',
          storiesSeen: counters.seen,
          importedCount: counters.imported,
          skippedCount: counters.duplicates + counters.failed,
          errorMessage: error.message
        }).catch(() => {});
        throw error;
      }
    });

    if (!locked.acquired) return { skipped: true, reason: 'locked_elsewhere' };

    lastRun = { at: new Date().toISOString(), trigger, ...locked.value };
    return locked.value;
  } finally {
    running = false;
  }
}

/**
 * Lượt chạy đầu sau khi khởi động: nếu vừa chạy xong trong vòng một chu kỳ thì
 * chờ cho đủ chu kỳ thay vì kéo ngay. Tránh việc restart/deploy (hoặc
 * `node --watch` khi đang code) biến thành mỗi lần restart một request Facebook.
 */
async function resolveFirstDelayMs(config) {
  const intervalMs = config.intervalMinutes * 60_000;
  const fallbackMs = config.initialDelaySeconds * 1000;
  try {
    const result = await query('SELECT started_at FROM facebook_import_runs ORDER BY id DESC LIMIT 1');
    const lastStartedAt = result.rows[0]?.started_at ? new Date(result.rows[0].started_at).getTime() : null;
    if (!lastStartedAt) return fallbackMs;
    const elapsed = Date.now() - lastStartedAt;
    return elapsed >= intervalMs ? fallbackMs : intervalMs - elapsed;
  } catch {
    return fallbackMs;
  }
}

export const FacebookImportService = {
  runOnce,

  getStatus() {
    const config = importConfig();
    const relogin = readReloginState(config);
    return {
      enabled: config.enabled,
      running,
      scheduled: Boolean(scheduler || initialTimer),
      group_url: config.groupUrl,
      interval_minutes: config.intervalMinutes,
      max_posts_per_run: config.maxPostsPerRun,
      download_media: config.downloadMedia,
      profile_ready: fs.existsSync(config.profileDir),
      auto_relogin: loginConfigReady(config),
      relogin_state: {
        failures: relogin.failures,
        cooldown_until: relogin.cooldownUntil ? new Date(relogin.cooldownUntil).toISOString() : null,
        last_attempt_at: relogin.lastAttemptAt,
        last_result: relogin.lastResult
      },
      last_run: lastRun
    };
  },

  start() {
    const config = importConfig();
    if (!config.enabled) {
      console.log('[fb-import] Đang tắt (FB_IMPORT_ENABLED=false).');
      return false;
    }
    if (!isDatabaseConfigured()) {
      console.warn('[fb-import] Chưa cấu hình database; scheduler không chạy.');
      return false;
    }
    if (scheduler || starting) return false;
    starting = true;

    const dispatch = async () => {
      try {
        const result = await runOnce({ trigger: 'scheduler' });
        if (result.skipped) {
          console.log(`[fb-import] Bỏ qua lượt chạy: ${result.reason}.`);
        } else {
          console.log(`[fb-import] Xong: ${result.imported}/${result.seen} bài mới.`);
        }
      } catch (error) {
        console.error('[fb-import] Lỗi:', error.message);
      }
    };

    resolveFirstDelayMs(config).then((delayMs) => {
      if (!starting) return;
      const nextAt = new Date(Date.now() + delayMs);
      console.log(
        `[fb-import] Bật: mỗi ${config.intervalMinutes} phút, nhóm ${config.groupUrl}`
        + ` — lượt tới ${nextAt.toISOString()}`
      );
      initialTimer = setTimeout(dispatch, delayMs);
      initialTimer.unref?.();
      scheduler = setInterval(dispatch, config.intervalMinutes * 60_000);
      scheduler.unref?.();
    });

    return true;
  },

  async stop() {
    starting = false;
    if (initialTimer) clearTimeout(initialTimer);
    if (scheduler) clearInterval(scheduler);
    initialTimer = null;
    scheduler = null;
    const context = activeContext;
    activeContext = null;
    if (context) await context.close().catch(() => {});
  }
};

export { MIN_IMAGE_EDGE, FALLBACK_AUTHOR_MSSV, DEFAULT_GROUP_URL };
