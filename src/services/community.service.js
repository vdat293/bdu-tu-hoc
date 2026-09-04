import { isDatabaseConfigured, query, transaction } from '../db/database.js';
import { IdentityPresentationService } from './identity-presentation.service.js';
import { PermissionService } from './permission.service.js';

function normalizeMssv(mssv) {
  return String(mssv || '').trim().toUpperCase();
}

const POST_SCOPES = new Set(['school', 'institute', 'faculty', 'clan']);
const POST_CATEGORIES = new Set(['discussion', 'announcement', 'material', 'question', 'confession', 'poll']);
const MAX_ATTACHMENTS = 5;
const MAX_TITLE_LENGTH = 180;
const MAX_CONTENT_LENGTH = 10000;
const MAX_COMMENT_LENGTH = 2000;

export function detectSupportedResourceSource(urlStr) {
  let hostname = '';
  try {
    const parsedUrl = new URL(String(urlStr || '').trim());
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
    hostname = parsedUrl.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }

  if (hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com')) {
    return 'youtube';
  }
  if (hostname === 'drive.google.com') return 'drive';
  if (hostname === 'github.com' || hostname.endsWith('.github.com') || hostname === 'raw.githubusercontent.com') {
    return 'github';
  }
  return null;
}

function httpError(message, status = 400) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function normalizePostId(postId) {
  const value = String(postId ?? '').trim();
  if (!/^\d+$/.test(value) || value === '0') return null;
  try {
    return BigInt(value) <= 9223372036854775807n ? value : null;
  } catch {
    return null;
  }
}

function normalizeBoolean(value) {
  return value === true || value === 1 || value === 'true' || value === '1';
}

async function canAccessPost(post, viewerMssv, client = null) {
  if (!post) return false;
  if (post.scope !== 'clan') return true;
  const cleanViewer = normalizeMssv(viewerMssv);
  if (!cleanViewer || !post.scope_id || !/^\d+$/.test(String(post.scope_id))) return false;
  const runner = client || { query };
  const result = await runner.query(
    'SELECT 1 FROM student_clans WHERE clan_id = $1 AND mssv = $2 LIMIT 1',
    [String(post.scope_id), cleanViewer]
  );
  return result.rowCount > 0;
}

function mapCommentRow(row, viewerMssv = null, permissions = {}) {
  const cleanViewer = viewerMssv ? normalizeMssv(viewerMssv) : null;
  const isAuthor = Boolean(cleanViewer && cleanViewer === row.raw_author_mssv);
  const maskIdentity = row.is_anonymous && !isAuthor;
  const isDeleted = Boolean(row.deleted_at);
  return {
    id: row.id,
    post_id: row.post_id,
    parent_id: row.parent_id,
    content: isDeleted ? 'Bình luận đã bị xoá.' : row.content,
    created_at: row.created_at,
    updated_at: row.updated_at,
    edited_at: row.edited_at || null,
    deleted_at: row.deleted_at || null,
    is_deleted: isDeleted,
    is_anonymous: row.is_anonymous,
    is_mine: isAuthor,
    can_edit: isAuthor && !isDeleted,
    can_delete: Boolean(permissions.canModerate || (isAuthor && !isDeleted)),
    author: {
      mssv: maskIdentity ? null : row.raw_author_mssv,
      name: maskIdentity ? 'Sinh viên giấu tên' : (row.raw_author_name || row.raw_author_mssv),
      is_anonymous: row.is_anonymous
    }
  };
}

async function enrichCommunityIdentities(records) {
  const presentations = await IdentityPresentationService.getPresentations(
    records.map((record) => record.author?.mssv)
  );
  return records.map((record) => {
    const presentation = presentations.get(record.author?.mssv);
    if (!presentation || record.author?.is_anonymous) return record;
    return {
      ...record,
      author: {
        ...record.author,
        photo_url: presentation.avatar_url,
        avatar_source: presentation.avatar_source,
        titles: presentation.selected_titles,
        equipped_frame_id: presentation.equipped_frame_id || null
      }
    };
  });
}

/**
 * Nạp chi tiết bình chọn (Poll options, tỷ lệ %, trạng thái đã vote) cho danh sách bài viết
 */
async function attachPollsToPosts(posts, viewerMssv = null) {
  if (!Array.isArray(posts) || posts.length === 0 || !isDatabaseConfigured()) return posts;
  const pollPostIds = posts.map((p) => p.id).filter(Boolean);
  if (pollPostIds.length === 0) return posts;

  const cleanViewerMssv = viewerMssv ? normalizeMssv(viewerMssv) : null;

  const sql = `
    SELECT 
      p.id AS poll_id,
      p.post_id,
      p.question,
      p.is_multiple_choice,
      o.id AS option_id,
      o.option_text,
      o.vote_count,
      CASE WHEN v.mssv IS NOT NULL THEN true ELSE false END AS is_voted_by_viewer
    FROM community_polls p
    JOIN community_poll_options o ON p.id = o.poll_id
    LEFT JOIN community_poll_votes v 
      ON o.id = v.option_id AND v.mssv = $2::text
    WHERE p.post_id = ANY($1::bigint[])
    ORDER BY o.id ASC;
  `;
  try {
    const result = await query(sql, [pollPostIds, cleanViewerMssv]);

    const pollMap = new Map();
    result.rows.forEach((row) => {
      const pId = String(row.post_id);
      if (!pollMap.has(pId)) {
        pollMap.set(pId, {
          id: String(row.poll_id),
          post_id: pId,
          question: row.question,
          is_multiple_choice: row.is_multiple_choice,
          options: [],
          total_votes: 0,
          my_voted_option_id: null
        });
      }
      const pollObj = pollMap.get(pId);
      const optId = String(row.option_id);
      const voteCount = Number(row.vote_count || 0);
      const isVoted = Boolean(row.is_voted_by_viewer);
      if (isVoted) {
        pollObj.my_voted_option_id = optId;
      }
      pollObj.options.push({
        id: optId,
        text: row.option_text,
        vote_count: voteCount,
        is_voted: isVoted
      });
      pollObj.total_votes += voteCount;
    });

    pollMap.forEach((pollObj) => {
      const total = pollObj.total_votes;
      pollObj.options.forEach((opt) => {
        opt.percentage = total > 0 ? Math.round((opt.vote_count / total) * 100) : 0;
      });
    });

    posts.forEach((p) => {
      p.poll = pollMap.get(String(p.id)) || null;
    });
  } catch (err) {
    console.error('Lỗi nạp poll cho bài viết:', err.message);
  }

  return posts;
}

/**
 * Trình phân tích URL thông minh: Google Drive File / Folder / Video & YouTube
 */
export function parseDriveOrMediaUrl(urlStr, label = '', forceType = null) {
  const url = String(urlStr || '').trim();
  if (!url || url.length > 2048) return null;
  const cleanLabel = String(label || '').trim().slice(0, MAX_TITLE_LENGTH);

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) return null;
  const hostname = parsedUrl.hostname.toLowerCase();

  // 1. YouTube Video
  const isYouTubeHost = hostname === 'youtu.be' || hostname === 'youtube.com' || hostname.endsWith('.youtube.com');
  let youtubeVideoId = '';
  if (isYouTubeHost) {
    if (hostname === 'youtu.be') {
      youtubeVideoId = parsedUrl.pathname.split('/').filter(Boolean)[0] || '';
    } else {
      youtubeVideoId = parsedUrl.searchParams.get('v') || '';
      if (!youtubeVideoId) {
        const pathMatch = parsedUrl.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/i);
        youtubeVideoId = pathMatch?.[1] || '';
      }
    }
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(youtubeVideoId)) {
    const videoId = youtubeVideoId;
    return {
      type: 'youtube',
      id: videoId,
      url,
      embed_url: `https://www.youtube.com/embed/${videoId}`,
      direct_url: `https://www.youtube.com/watch?v=${videoId}`,
      title: cleanLabel || 'Video YouTube'
    };
  }

  // 2. Google Drive Folder
  const isDriveHost = hostname === 'drive.google.com';
  const folderMatch = isDriveHost ? url.match(/\/folders\/([a-zA-Z0-9_-]+)/i) : null;
  if (folderMatch) {
    const folderId = folderMatch[1];
    return {
      type: 'drive_folder',
      id: folderId,
      url,
      embed_url: `https://drive.google.com/embeddedfolderview?id=${folderId}#grid`,
      direct_url: `https://drive.google.com/drive/folders/${folderId}`,
      title: cleanLabel || 'Thư mục tài liệu Google Drive'
    };
  }

  // 3. Google Drive File (PDF, Docx, Slide, Video...)
  const fileMatch = isDriveHost
    ? (url.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i) || url.match(/[?&]id=([a-zA-Z0-9_-]+)/i))
    : null;
  if (fileMatch) {
    const fileId = fileMatch[1];
    const isVideo = forceType === 'video' || /video|mp4|mkv/i.test(cleanLabel) || /video|mp4/i.test(url);
    const resolvedType = isVideo ? 'drive_video' : 'drive_file';

    return {
      type: resolvedType,
      id: fileId,
      url,
      embed_url: `https://drive.google.com/file/d/${fileId}/preview`,
      direct_url: `https://drive.google.com/file/d/${fileId}/view`,
      download_url: `https://drive.google.com/uc?export=download&id=${fileId}`,
      title: cleanLabel || (isVideo ? 'Video bài giảng Drive' : 'Tài liệu Google Drive')
    };
  }

  // 4. Đường link thông thường khác
  return {
    type: 'link',
    id: null,
    url,
    embed_url: null,
    direct_url: url,
    title: cleanLabel || 'Liên kết tham khảo'
  };
}

export const CommunityService = {
  /**
   * Tạo bài viết mới
   */
  async createPost({
    authorMssv,
    title,
    content,
    scope = 'school',
    scopeId = null,
    isAnonymous = false,
    attachments = [],
    category = 'discussion',
    isPinned = false,
    poll = null
  }) {
    if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');
    const cleanMssv = normalizeMssv(authorMssv);
    const cleanTitle = String(title || '').trim();
    const cleanContent = String(content || '').trim();
    const cleanScope = String(scope || 'school').trim().toLowerCase();
    const cleanScopeId = cleanScope === 'school' ? null : (scopeId ? String(scopeId).trim() : null);
    let cleanCategory = POST_CATEGORIES.has(String(category || '').trim().toLowerCase())
      ? String(category).trim().toLowerCase()
      : 'discussion';

    if (!cleanMssv) throw httpError('MSSV của tác giả là bắt buộc.');
    if (!POST_SCOPES.has(cleanScope)) throw httpError('Phạm vi bài viết không hợp lệ.');
    if (cleanScope === 'clan' && !cleanScopeId) throw httpError('Bài viết CLB phải xác định CLB nhận bài.');
    if (!cleanTitle || !cleanContent) throw httpError('Tiêu đề và nội dung bài viết không được để trống.');
    if (cleanTitle.length > MAX_TITLE_LENGTH) throw httpError(`Tiêu đề không được vượt quá ${MAX_TITLE_LENGTH} ký tự.`);
    if (cleanContent.length > MAX_CONTENT_LENGTH) throw httpError(`Nội dung không được vượt quá ${MAX_CONTENT_LENGTH} ký tự.`);
    if (!Array.isArray(attachments)) throw httpError('Danh sách tệp đính kèm không hợp lệ.');
    if (attachments.length > MAX_ATTACHMENTS) throw httpError(`Mỗi bài viết chỉ được đính kèm tối đa ${MAX_ATTACHMENTS} liên kết.`);
    if (cleanCategory === 'material' && attachments.some((item) => {
      const itemUrl = typeof item === 'string' ? item : item?.url;
      return !detectSupportedResourceSource(itemUrl);
    })) {
      throw httpError('Kho tài liệu chỉ hỗ trợ liên kết YouTube, Google Drive hoặc GitHub.');
    }

    // Xử lý dữ liệu Poll nếu có
    let cleanPoll = null;
    if (cleanCategory === 'poll' || poll) {
      cleanCategory = 'poll';
      const pollQuestion = String(poll?.question || cleanTitle).trim();
      const rawOptions = Array.isArray(poll?.options) ? poll.options : [];
      const cleanOptions = rawOptions
        .map((opt) => String(opt || '').trim())
        .filter(Boolean);
      if (cleanOptions.length < 2) {
        throw httpError('Cuộc bình chọn phải có ít nhất 2 phương án lựa chọn.');
      }
      if (cleanOptions.length > 10) {
        throw httpError('Cuộc bình chọn tối đa 10 phương án lựa chọn.');
      }
      cleanPoll = {
        question: pollQuestion,
        options: cleanOptions,
        isMultipleChoice: Boolean(poll?.isMultipleChoice)
      };
    }

    // Chuẩn hóa danh sách đính kèm (Drive File, Folder, Video...)
    const parsedAttachments = attachments.map((item) => {
      if (typeof item === 'string') return parseDriveOrMediaUrl(item);
      if (item && typeof item === 'object' && item.url) {
        return parseDriveOrMediaUrl(item.url, item.title, item.type);
      }
      return null;
    });
    if (parsedAttachments.some((item) => !item)) {
      throw httpError('Liên kết đính kèm không hợp lệ. Chỉ chấp nhận URL http hoặc https.');
    }

    const createdPost = await transaction(async (client) => {
      // Đảm bảo tác giả tồn tại trong bảng students
      await client.query(`
        INSERT INTO students (mssv, full_name, is_active)
        VALUES ($1, '', FALSE)
        ON CONFLICT (mssv) DO NOTHING;
      `, [cleanMssv]);

      let finalPinned = normalizeBoolean(isPinned);

      // Nếu là bài viết trong CLB: Kiểm tra quyền thành viên
      if (cleanScope === 'clan') {
        if (!/^\d+$/.test(cleanScopeId)) throw httpError('ID CLB không hợp lệ.');
        const canPost = await PermissionService.canInClan(cleanMssv, cleanScopeId, 'clan:post_create');
        if (!canPost) {
          throw httpError('Bạn cần tham gia CLB này trước khi đăng bài.', 403);
        }

        const [canAnnounce, canPin] = await Promise.all([
          PermissionService.canInClan(cleanMssv, cleanScopeId, 'clan:announcement_create'),
          PermissionService.canInClan(cleanMssv, cleanScopeId, 'clan:post_pin')
        ]);

        // Chỉ Bang Chủ hoặc Phó Bang mới được gán nhãn thông báo chính thức hoặc ghim bài
        if (cleanCategory === 'announcement' && !canAnnounce) {
          throw httpError('Chỉ Bang Chủ hoặc Phó Bang mới có quyền đăng bài Thông Báo của CLB.', 403);
        }
        if (finalPinned && !canPin) {
          finalPinned = false;
        }
      } else {
        finalPinned = false;
      }

      const sql = `
        INSERT INTO community_posts (
          author_mssv, title, content, scope, scope_id, is_anonymous, attachments, category, is_pinned
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        RETURNING *;
      `;
      const result = await client.query(sql, [
        cleanMssv,
        cleanTitle,
        cleanContent,
        cleanScope,
        cleanScopeId,
        normalizeBoolean(isAnonymous),
        JSON.stringify(parsedAttachments),
        cleanCategory,
        finalPinned
      ]);

      const postRow = result.rows[0];

      // Nếu có bình chọn, lưu vào community_polls và community_poll_options
      if (cleanPoll) {
        const pollRes = await client.query(`
          INSERT INTO community_polls (post_id, question, is_multiple_choice)
          VALUES ($1, $2, $3)
          RETURNING id;
        `, [postRow.id, cleanPoll.question, cleanPoll.isMultipleChoice]);
        const pollId = pollRes.rows[0].id;

        for (const optText of cleanPoll.options) {
          await client.query(`
            INSERT INTO community_poll_options (poll_id, option_text, vote_count)
            VALUES ($1, $2, 0);
          `, [pollId, optText]);
        }
      }

      return postRow;
    });

    return this.getPostById(createdPost.id, cleanMssv);
  },

  /**
   * Lấy danh sách bài viết theo phạm vi (Toàn trường, Viện, Khoa, Clan)
   */
  async getPosts({
    scope = null,
    scopeId = null,
    viewerMssv = null,
    authorMssv = null,
    isAnonymous = null,
    category = null,
    hasAttachments = null,
    isPinned = null,
    limit = 20,
    offset = 0
  } = {}) {
    if (!isDatabaseConfigured()) return { total: 0, posts: [] };

    const cleanViewerMssv = viewerMssv ? normalizeMssv(viewerMssv) : null;
    const safeLimit = Math.trunc(Math.max(1, Math.min(100, Number(limit) || 20)));
    const safeOffset = Math.trunc(Math.max(0, Number(offset) || 0));

    const conditions = [];
    const params = [];

    // Deleted posts remain as tombstones for moderation/audit, but never
    // appear in public feeds.
    conditions.push('p.deleted_at IS NULL');

    if (scope) {
      if (scope === 'forum') {
        conditions.push(`p.scope IN ('school', 'institute', 'faculty')`);
      } else {
        if (!POST_SCOPES.has(scope)) throw httpError('Phạm vi bài viết không hợp lệ.');
        params.push(scope);
        conditions.push(`p.scope = $${params.length}`);
      }
    }
    if (scopeId) {
      params.push(String(scopeId).trim());
      conditions.push(`p.scope_id = $${params.length}`);
    }
    if (authorMssv) {
      params.push(normalizeMssv(authorMssv));
      conditions.push(`p.author_mssv = $${params.length}`);
    }
    if (isAnonymous !== null && isAnonymous !== undefined) {
      params.push(normalizeBoolean(isAnonymous));
      conditions.push(`p.is_anonymous = $${params.length}`);
    }
    if (category && POST_CATEGORIES.has(String(category).trim().toLowerCase())) {
      params.push(String(category).trim().toLowerCase());
      conditions.push(`p.category = $${params.length}`);
    }
    if (hasAttachments === true) {
      conditions.push(`jsonb_array_length(p.attachments) > 0`);
    }
    if (isPinned !== null && isPinned !== undefined) {
      params.push(normalizeBoolean(isPinned));
      conditions.push(`p.is_pinned = $${params.length}`);
    }

    if (scope === 'clan' && viewerMssv) {
      const member = await query(
        'SELECT 1 FROM student_clans WHERE clan_id = $1 AND mssv = $2 LIMIT 1',
        [String(scopeId || '').trim(), cleanViewerMssv]
      );
      if (!member.rowCount) throw httpError('Bạn cần tham gia CLB để xem bài viết.', 403);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countSql = `SELECT COUNT(*) AS total FROM community_posts p ${whereClause};`;
    const countResult = await query(countSql, params);
    const total = Number(countResult.rows[0]?.total || 0);

    params.push(cleanViewerMssv);
    const viewerParamIndex = params.length;
    params.push(safeLimit);
    const limitIndex = params.length;
    params.push(safeOffset);
    const offsetIndex = params.length;

    const listSql = `
      SELECT 
        p.id,
        p.title,
        p.content,
        p.scope,
        p.scope_id,
        p.is_anonymous,
        p.attachments,
        p.like_count,
        p.comment_count,
        COALESCE(p.category, 'discussion') AS category,
        COALESCE(p.is_pinned, false) AS is_pinned,
        p.created_at,
        p.updated_at,
        s.full_name AS raw_author_name,
        p.author_mssv AS raw_author_mssv,
        sc.role AS author_clan_role,
        CASE 
          WHEN $${viewerParamIndex}::text IS NOT NULL AND l.post_id IS NOT NULL THEN true 
          ELSE false 
        END AS is_liked_by_viewer
      FROM community_posts p
      JOIN students s ON p.author_mssv = s.mssv
      LEFT JOIN student_clans sc 
        ON p.scope = 'clan' AND p.scope_id ~ '^[0-9]+$' AND sc.clan_id = p.scope_id::bigint AND sc.mssv = p.author_mssv
      LEFT JOIN community_post_likes l 
        ON p.id = l.post_id AND l.mssv = $${viewerParamIndex}::text
      ${whereClause}
      ORDER BY 
        CASE WHEN p.scope = 'clan' THEN COALESCE(p.is_pinned, false) ELSE false END DESC,
        p.created_at DESC
      LIMIT $${limitIndex} OFFSET $${offsetIndex};
    `;

    const listResult = await query(listSql, params);

    const posts = listResult.rows.map((row) => {
      const isAuthor = cleanViewerMssv && cleanViewerMssv === row.raw_author_mssv;
      const maskIdentity = row.is_anonymous && !isAuthor;

      return {
        id: row.id,
        title: row.title,
        content: row.content,
        scope: row.scope,
        scope_id: row.scope_id,
        category: row.category,
        is_pinned: row.is_pinned,
        is_anonymous: row.is_anonymous,
        attachments: row.attachments || [],
        like_count: row.like_count,
        comment_count: row.comment_count,
        created_at: row.created_at,
        updated_at: row.updated_at,
        is_liked: row.is_liked_by_viewer,
        is_mine: Boolean(isAuthor),
        author: {
          mssv: maskIdentity ? null : row.raw_author_mssv,
          name: maskIdentity ? 'Sinh viên giấu tên' : (row.raw_author_name || row.raw_author_mssv),
          clan_role: maskIdentity ? null : row.author_clan_role,
          is_anonymous: row.is_anonymous
        }
      };
    });

    const enriched = await enrichCommunityIdentities(posts);
    const withPolls = await attachPollsToPosts(enriched, cleanViewerMssv);

    return {
      total,
      posts: withPolls,
      limit: safeLimit,
      offset: safeOffset
    };
  },

  /**
   * Lấy chi tiết bài viết theo ID
   */
  async getPostById(postId, viewerMssv = null) {
    const cleanPostId = normalizePostId(postId);
    if (!cleanPostId || !isDatabaseConfigured()) return null;
    const cleanViewerMssv = viewerMssv ? normalizeMssv(viewerMssv) : null;

    const sql = `
      SELECT 
        p.id,
        p.title,
        p.content,
        p.scope,
        p.scope_id,
        p.is_anonymous,
        p.attachments,
        p.like_count,
        p.comment_count,
        COALESCE(p.category, 'discussion') AS category,
        COALESCE(p.is_pinned, false) AS is_pinned,
        p.created_at,
        p.updated_at,
        s.full_name AS raw_author_name,
        p.author_mssv AS raw_author_mssv,
        sc.role AS author_clan_role,
        CASE 
          WHEN $2::text IS NOT NULL AND l.post_id IS NOT NULL THEN true 
          ELSE false 
        END AS is_liked_by_viewer
      FROM community_posts p
      JOIN students s ON p.author_mssv = s.mssv
      LEFT JOIN student_clans sc 
        ON p.scope = 'clan' AND p.scope_id ~ '^[0-9]+$' AND sc.clan_id = p.scope_id::bigint AND sc.mssv = p.author_mssv
      LEFT JOIN community_post_likes l 
        ON p.id = l.post_id AND l.mssv = $2::text
      WHERE p.id = $1 AND p.deleted_at IS NULL;
    `;
    const result = await query(sql, [cleanPostId, cleanViewerMssv]);
    if (!result.rows.length) return null;

    const row = result.rows[0];
    if (!(await canAccessPost(row, cleanViewerMssv))) return null;
    const isAuthor = cleanViewerMssv && cleanViewerMssv === row.raw_author_mssv;
    const maskIdentity = row.is_anonymous && !isAuthor;

    const post = {
      id: row.id,
      title: row.title,
      content: row.content,
      scope: row.scope,
      scope_id: row.scope_id,
      category: row.category,
      is_pinned: row.is_pinned,
      is_anonymous: row.is_anonymous,
      attachments: row.attachments || [],
      like_count: row.like_count,
      comment_count: row.comment_count,
      created_at: row.created_at,
      updated_at: row.updated_at,
      is_liked: row.is_liked_by_viewer,
      is_mine: Boolean(isAuthor),
      author: {
        mssv: maskIdentity ? null : row.raw_author_mssv,
        name: maskIdentity ? 'Sinh viên giấu tên' : (row.raw_author_name || row.raw_author_mssv),
        clan_role: maskIdentity ? null : row.author_clan_role,
        is_anonymous: row.is_anonymous
      }
    };
    const enriched = await enrichCommunityIdentities([post]);
    const withPolls = await attachPollsToPosts(enriched, cleanViewerMssv);
    return withPolls[0] || null;
  },

  /**
   * Xóa bài viết.
   * - Tác giả bài viết có quyền xóa bài của mình.
   * - Bang Chủ hoặc Phó Bang có quyền xóa bất kỳ bài viết nào trong CLB của mình (Kiểm duyệt nội bộ).
   */
  async deletePost(postId, requesterMssv) {
    if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');
    const cleanPostId = normalizePostId(postId);
    const cleanRequester = normalizeMssv(requesterMssv);
    if (!cleanPostId || !cleanRequester) throw httpError('Post ID và người yêu cầu là bắt buộc.');

    return transaction(async (client) => {
      const postResult = await client.query(
        'SELECT id, author_mssv, scope, scope_id, deleted_at FROM community_posts WHERE id = $1 FOR UPDATE',
        [cleanPostId]
      );
      if (!postResult.rowCount) throw httpError('Không tìm thấy bài viết.', 404);
      const postRow = postResult.rows[0];

      let canDelete = postRow.author_mssv === cleanRequester;
      if (!canDelete && postRow.scope === 'clan' && postRow.scope_id && /^\d+$/.test(postRow.scope_id)) {
        canDelete = await PermissionService.canInClan(cleanRequester, postRow.scope_id, 'clan:post_delete_any');
      }

      if (!canDelete) {
        throw httpError('Bạn không có quyền xóa bài viết này.', 403);
      }

      if (!postRow.deleted_at) {
        await client.query(`
          UPDATE community_posts
          SET deleted_at = NOW(), deleted_by_mssv = $2, delete_reason = $3, updated_at = NOW()
          WHERE id = $1;
        `, [cleanPostId, cleanRequester, 'user_request']);
      }
      return {
        deleted: true,
        id: cleanPostId,
        scope: postRow.scope,
        scope_id: postRow.scope_id
      };
    });
  },

  /**
   * Ghim hoặc Hủy ghim bài viết trong CLB (Chỉ Bang Chủ hoặc Phó Bang)
   */
  async togglePinPost(postId, requesterMssv) {
    if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');
    const cleanPostId = normalizePostId(postId);
    const cleanRequester = normalizeMssv(requesterMssv);
    if (!cleanPostId || !cleanRequester) throw httpError('Post ID và MSSV là bắt buộc.');

    return transaction(async (client) => {
      const postResult = await client.query(
        'SELECT id, scope, scope_id, is_pinned FROM community_posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [cleanPostId]
      );
      if (!postResult.rowCount) throw httpError('Không tìm thấy bài viết.', 404);
      const post = postResult.rows[0];
      if (post.scope !== 'clan' || !post.scope_id || !/^\d+$/.test(post.scope_id)) {
        throw httpError('Chỉ có thể ghim bài viết trong CLB / Nhóm.', 400);
      }

      const canPin = await PermissionService.canInClan(cleanRequester, post.scope_id, 'clan:post_pin');
      if (!canPin) {
        throw httpError('Chỉ Bang Chủ hoặc Phó Bang mới có quyền ghim bài viết trong CLB.', 403);
      }

      const nextPinned = !Boolean(post.is_pinned);
      await client.query(
        'UPDATE community_posts SET is_pinned = $1, updated_at = NOW() WHERE id = $2',
        [nextPinned, cleanPostId]
      );
      return { id: cleanPostId, is_pinned: nextPinned };
    });
  },

  /**
   * Bỏ phiếu bình chọn trong cuộc thăm dò ý kiến CLB
   */
  async voteClanPoll(pollId, optionId, requesterMssv) {
    if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');
    const cleanPollId = String(pollId || '').trim();
    const cleanOptionId = String(optionId || '').trim();
    const cleanMssv = normalizeMssv(requesterMssv);
    if (!cleanPollId || !cleanOptionId || !cleanMssv) {
      throw httpError('Thông tin bình chọn không hợp lệ.');
    }

    return transaction(async (client) => {
      // 1. Kiểm tra poll và bài viết
      const pollRes = await client.query(`
        SELECT p.id, p.post_id, cp.scope, cp.scope_id 
        FROM community_polls p
        JOIN community_posts cp ON p.post_id = cp.id
        WHERE p.id = $1;
      `, [cleanPollId]);
      if (pollRes.rowCount === 0) throw httpError('Không tìm thấy cuộc bình chọn.', 404);
      const poll = pollRes.rows[0];

      // 2. Nếu trong CLB: Kiểm tra quyền thành viên
      if (poll.scope === 'clan') {
        const memberCheck = await client.query(`
          SELECT role FROM student_clans WHERE clan_id = $1 AND mssv = $2;
        `, [poll.scope_id, cleanMssv]);
        if (memberCheck.rowCount === 0) {
          throw httpError('Chỉ thành viên của CLB mới có quyền tham gia bình chọn.', 403);
        }
      }

      // 3. Kiểm tra optionId thuộc pollId này
      const optRes = await client.query(`
        SELECT id FROM community_poll_options WHERE id = $1 AND poll_id = $2;
      `, [cleanOptionId, cleanPollId]);
      if (optRes.rowCount === 0) throw httpError('Phương án bình chọn không tồn tại.');

      // 4. Upsert vote: Mỗi sinh viên 1 phiếu cho 1 poll
      await client.query(`
        INSERT INTO community_poll_votes (poll_id, option_id, mssv)
        VALUES ($1, $2, $3)
        ON CONFLICT (poll_id, mssv)
        DO UPDATE SET option_id = EXCLUDED.option_id, created_at = NOW();
      `, [cleanPollId, cleanOptionId, cleanMssv]);

      // 5. Đồng bộ lại vote_count cho toàn bộ options của poll này
      await client.query(`
        UPDATE community_poll_options o
        SET vote_count = (
          SELECT COUNT(*)::int FROM community_poll_votes v WHERE v.option_id = o.id
        )
        WHERE o.poll_id = $1;
      `, [cleanPollId]);

      // 6. Trả về chi tiết poll đã cập nhật
      const updatedOptions = await client.query(`
        SELECT 
          o.id,
          o.option_text AS text,
          o.vote_count,
          (v.option_id IS NOT NULL) AS is_voted
        FROM community_poll_options o
        LEFT JOIN community_poll_votes v ON o.id = v.option_id AND v.mssv = $2::text
        WHERE o.poll_id = $1
        ORDER BY o.id ASC;
      `, [cleanPollId, cleanMssv]);

      const totalVotes = updatedOptions.rows.reduce((sum, o) => sum + Number(o.vote_count || 0), 0);
      const optionsWithPercent = updatedOptions.rows.map((o) => ({
        id: String(o.id),
        text: o.text,
        vote_count: Number(o.vote_count || 0),
        percentage: totalVotes > 0 ? Math.round((Number(o.vote_count || 0) / totalVotes) * 100) : 0,
        is_voted: Boolean(o.is_voted)
      }));

      return {
        id: cleanPollId,
        total_votes: totalVotes,
        my_voted_option_id: cleanOptionId,
        options: optionsWithPercent
      };
    });
  },

  /**
   * Lấy Kho Tài Liệu CLB: Tự động trích xuất mọi tệp đính kèm (Drive File/Folder, Video, Link)
   * từ các bài viết trong CLB kèm thông tin bài viết gốc.
   */
  async getClanDocuments(clanId, { type = null, search = null, limit = 50, offset = 0, viewerMssv = null } = {}) {
    if (!isDatabaseConfigured() || !clanId) return { total: 0, documents: [], stats: { total_files: 0, folders: 0, files: 0, videos: 0, links: 0 } };
    const cleanClanId = String(clanId).trim();
    if (!/^\d+$/.test(cleanClanId)) throw httpError('ID CLB không hợp lệ.');
    if (viewerMssv) {
      const member = await query('SELECT 1 FROM student_clans WHERE clan_id = $1 AND mssv = $2 LIMIT 1', [cleanClanId, normalizeMssv(viewerMssv)]);
      if (!member.rowCount) throw httpError('Bạn cần tham gia CLB để xem kho tài liệu.', 403);
    }
    const safeLimit = Math.trunc(Math.max(1, Math.min(100, Number(limit) || 50)));
    const safeOffset = Math.trunc(Math.max(0, Number(offset) || 0));

    const sql = `
      SELECT 
        p.id AS post_id,
        p.title AS post_title,
        p.category,
        p.created_at AS post_created_at,
        p.is_anonymous,
        p.attachments,
        s.full_name AS author_name,
        p.author_mssv,
        sc.role AS author_clan_role
      FROM community_posts p
      JOIN students s ON p.author_mssv = s.mssv
      LEFT JOIN student_clans sc ON sc.clan_id = p.scope_id::bigint AND sc.mssv = p.author_mssv
      WHERE p.scope = 'clan' 
        AND p.scope_id = $1 
        AND p.deleted_at IS NULL
        AND jsonb_array_length(p.attachments) > 0
      ORDER BY 
        CASE WHEN p.scope = 'clan' THEN COALESCE(p.is_pinned, false) ELSE false END DESC,
        p.created_at DESC;
    `;
    const result = await query(sql, [cleanClanId]);

    let docs = [];
    result.rows.forEach((row) => {
      const isAnon = Boolean(row.is_anonymous);
      const authorDisplay = isAnon ? 'Sinh viên giấu tên' : (row.author_name || row.author_mssv);
      const attachments = Array.isArray(row.attachments) ? row.attachments : [];
      attachments.forEach((att, idx) => {
        if (!att || !att.url) return;
        docs.push({
          id: `${row.post_id}_${idx}`,
          post_id: row.post_id,
          post_title: row.post_title,
          category: row.category,
          type: att.type || 'link',
          title: att.title || 'Tài liệu học tập',
          url: att.url,
          embed_url: att.embed_url || null,
          direct_url: att.direct_url || att.url,
          download_url: att.download_url || null,
          author_name: authorDisplay,
          author_mssv: isAnon ? null : row.author_mssv,
          author_clan_role: isAnon ? null : row.author_clan_role,
          created_at: row.post_created_at
        });
      });
    });

    const stats = {
      total_files: docs.length,
      folders: docs.filter(d => d.type === 'drive_folder').length,
      files: docs.filter(d => d.type === 'drive_file').length,
      videos: docs.filter(d => d.type === 'drive_video' || d.type === 'youtube').length,
      links: docs.filter(d => d.type === 'link').length
    };

    if (type && type !== 'all') {
      if (type === 'video') {
        docs = docs.filter((d) => d.type === 'drive_video' || d.type === 'youtube');
      } else {
        docs = docs.filter((d) => d.type === type);
      }
    }

    if (search && String(search).trim()) {
      const q = String(search).trim().toLowerCase();
      docs = docs.filter((d) => 
        d.title.toLowerCase().includes(q) || 
        d.post_title.toLowerCase().includes(q) || 
        d.author_name.toLowerCase().includes(q)
      );
    }

    const total = docs.length;
    const paginated = docs.slice(safeOffset, safeOffset + safeLimit);

    return {
      total,
      documents: paginated,
      stats
    };
  },

  /**
   * Thả tim (Like) hoặc Hủy thả tim (Unlike) bài viết - Cơ chế Toggle Like
   */
  async toggleLike(postId, mssv) {
    if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');
    const cleanPostId = normalizePostId(postId);
    const cleanMssv = normalizeMssv(mssv);
    if (!cleanPostId || !cleanMssv) throw httpError('Post ID và MSSV là bắt buộc.');

    return transaction(async (client) => {
      // Khóa bài viết để hai thao tác like đồng thời không làm lệch bộ đếm.
      const postResult = await client.query(
        'SELECT like_count, scope, scope_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [cleanPostId]
      );
      if (!postResult.rowCount) throw httpError('Không tìm thấy bài viết.', 404);

      if (!(await canAccessPost(postResult.rows[0], cleanMssv, client))) {
        throw httpError('Bạn không có quyền tương tác với bài viết này.', 403);
      }

      // Đảm bảo sinh viên tồn tại
      await client.query(`
        INSERT INTO students (mssv, full_name, is_active)
        VALUES ($1, '', FALSE)
        ON CONFLICT (mssv) DO NOTHING;
      `, [cleanMssv]);

      // Kiểm tra đã like chưa
      const checkLike = await client.query(
        'SELECT 1 FROM community_post_likes WHERE post_id = $1 AND mssv = $2',
        [cleanPostId, cleanMssv]
      );

      let liked = false;
      if (checkLike.rowCount > 0) {
        // Đã like -> Hủy like (Unlike)
        await client.query(
          'DELETE FROM community_post_likes WHERE post_id = $1 AND mssv = $2',
          [cleanPostId, cleanMssv]
        );
        await client.query(
          'UPDATE community_posts SET like_count = GREATEST(0, like_count - 1), updated_at = NOW() WHERE id = $1',
          [cleanPostId]
        );
        liked = false;
      } else {
        // Chưa like -> Like
        await client.query(
          'INSERT INTO community_post_likes (post_id, mssv) VALUES ($1, $2)',
          [cleanPostId, cleanMssv]
        );
        await client.query(
          'UPDATE community_posts SET like_count = like_count + 1, updated_at = NOW() WHERE id = $1',
          [cleanPostId]
        );
        liked = true;
      }

      const postRow = await client.query('SELECT like_count FROM community_posts WHERE id = $1', [cleanPostId]);
      return {
        liked,
        like_count: Number(postRow.rows[0]?.like_count || 0)
      };
    });
  },

  /**
   * Thêm bình luận vào bài viết (Hỗ trợ trả lời lồng nhau)
   */
  async addComment({ postId, authorMssv, content, parentId = null, isAnonymous = false }) {
    if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');
    const cleanPostId = normalizePostId(postId);
    const cleanParentId = parentId ? normalizePostId(parentId) : null;
    const cleanMssv = normalizeMssv(authorMssv);
    const cleanContent = String(content || '').trim();

    if (!cleanPostId || !cleanMssv) throw httpError('Post ID và tác giả là bắt buộc.');
    if (parentId && !cleanParentId) throw httpError('Bình luận cha không hợp lệ.');
    if (!cleanContent) throw httpError('Nội dung bình luận không được để trống.');
    if (cleanContent.length > MAX_COMMENT_LENGTH) throw httpError(`Bình luận không được vượt quá ${MAX_COMMENT_LENGTH} ký tự.`);

    const createdComment = await transaction(async (client) => {
      const postResult = await client.query(
        'SELECT id, scope, scope_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL FOR UPDATE',
        [cleanPostId]
      );
      if (!postResult.rowCount) throw httpError('Không tìm thấy bài viết.', 404);

      if (!(await canAccessPost(postResult.rows[0], cleanMssv, client))) {
        throw httpError('Bạn không có quyền bình luận bài viết này.', 403);
      }

      if (cleanParentId) {
        const parentResult = await client.query(
          'SELECT parent_id, deleted_at FROM community_post_comments WHERE id = $1 AND post_id = $2',
          [cleanParentId, cleanPostId]
        );
        if (!parentResult.rowCount) {
          throw httpError('Bình luận cha không tồn tại trong bài viết này.');
        }
        if (parentResult.rows[0].deleted_at) {
          throw httpError('Không thể trả lời bình luận đã bị xoá.');
        }
        if (parentResult.rows[0].parent_id) {
          throw httpError('Chỉ hỗ trợ trả lời tối đa một cấp.');
        }
      }

      // Đảm bảo sinh viên tồn tại
      await client.query(`
        INSERT INTO students (mssv, full_name, is_active)
        VALUES ($1, '', FALSE)
        ON CONFLICT (mssv) DO NOTHING;
      `, [cleanMssv]);

      const insertSql = `
        INSERT INTO community_post_comments (post_id, author_mssv, parent_id, content, is_anonymous)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING *;
      `;
      const result = await client.query(insertSql, [
        cleanPostId,
        cleanMssv,
        cleanParentId,
        cleanContent,
        normalizeBoolean(isAnonymous)
      ]);

      await client.query(
        'UPDATE community_posts SET comment_count = comment_count + 1, updated_at = NOW() WHERE id = $1',
        [cleanPostId]
      );

      return result.rows[0];
    });
    const safeComment = await this.getCommentById(createdComment.id, cleanMssv);
    const countResult = await query('SELECT comment_count FROM community_posts WHERE id = $1', [cleanPostId]);
    return {
      ...safeComment,
      comment_count: Number(countResult.rows[0]?.comment_count || 0)
    };
  },

  async editComment({ postId, commentId, requesterMssv, content }) {
    if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');
    const cleanPostId = normalizePostId(postId);
    const cleanCommentId = normalizePostId(commentId);
    const cleanRequester = normalizeMssv(requesterMssv);
    const cleanContent = String(content || '').trim();
    if (!cleanPostId || !cleanCommentId || !cleanRequester) throw httpError('Thông tin bình luận không hợp lệ.');
    if (!cleanContent) throw httpError('Nội dung bình luận không được để trống.');
    if (cleanContent.length > MAX_COMMENT_LENGTH) throw httpError(`Bình luận không được vượt quá ${MAX_COMMENT_LENGTH} ký tự.`);

    const post = await query(
      'SELECT scope, scope_id FROM community_posts WHERE id = $1 AND deleted_at IS NULL',
      [cleanPostId]
    );
    if (!post.rowCount) throw httpError('Không tìm thấy bài viết.', 404);
    if (!(await canAccessPost(post.rows[0], cleanRequester))) {
      throw httpError('Bạn không có quyền sửa bình luận trong bài viết này.', 403);
    }

    const result = await query(`
      UPDATE community_post_comments
      SET content = $3, edited_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND post_id = $2 AND author_mssv = $4 AND deleted_at IS NULL
      RETURNING id;
    `, [cleanCommentId, cleanPostId, cleanContent, cleanRequester]);
    if (!result.rowCount) throw httpError('Không tìm thấy bình luận hoặc bạn không có quyền sửa.', 403);
    return this.getCommentById(cleanCommentId, cleanRequester);
  },

  async deleteComment({ postId, commentId, requesterMssv, reason = 'user_request' }) {
    if (!isDatabaseConfigured()) throw new Error('Database chưa được cấu hình.');
    const cleanPostId = normalizePostId(postId);
    const cleanCommentId = normalizePostId(commentId);
    const cleanRequester = normalizeMssv(requesterMssv);
    if (!cleanPostId || !cleanCommentId || !cleanRequester) throw httpError('Thông tin xóa bình luận không hợp lệ.');

    return transaction(async (client) => {
      const result = await client.query(`
        SELECT c.id, c.author_mssv, c.deleted_at,
               p.author_mssv AS post_author_mssv, p.scope, p.scope_id,
               p.comment_count
        FROM community_post_comments c
        JOIN community_posts p ON p.id = c.post_id
        WHERE c.id = $1 AND c.post_id = $2 AND p.deleted_at IS NULL
        FOR UPDATE;
      `, [cleanCommentId, cleanPostId]);
      if (!result.rowCount) throw httpError('Không tìm thấy bình luận.', 404);
      const row = result.rows[0];
      if (!(await canAccessPost(row, cleanRequester, client))) {
        throw httpError('Bạn không có quyền thao tác bình luận trong bài viết này.', 403);
      }

      let canDelete = row.author_mssv === cleanRequester || row.post_author_mssv === cleanRequester;
      if (!canDelete && row.scope === 'clan' && /^\d+$/.test(String(row.scope_id || ''))) {
        canDelete = await PermissionService.canInClan(cleanRequester, row.scope_id, 'clan:comment_delete_any');
      }
      if (!canDelete) throw httpError('Bạn không có quyền xóa bình luận này.', 403);

      if (!row.deleted_at) {
        await client.query(`
          UPDATE community_post_comments
          SET deleted_at = NOW(), deleted_by_mssv = $3, delete_reason = $4, updated_at = NOW()
          WHERE id = $1 AND post_id = $2;
        `, [cleanCommentId, cleanPostId, cleanRequester, String(reason || 'user_request').slice(0, 200)]);
        await client.query(`
          UPDATE community_posts
          SET comment_count = GREATEST(0, comment_count - 1), updated_at = NOW()
          WHERE id = $1;
        `, [cleanPostId]);
      }
      const count = await client.query('SELECT comment_count FROM community_posts WHERE id = $1', [cleanPostId]);
      return {
        deleted: true,
        id: cleanCommentId,
        post_id: cleanPostId,
        comment_count: Number(count.rows[0]?.comment_count || 0)
      };
    });
  },

  async getCommentById(commentId, viewerMssv = null) {
    const cleanCommentId = normalizePostId(commentId);
    if (!cleanCommentId || !isDatabaseConfigured()) return null;
    const result = await query(`
      SELECT c.id, c.post_id, c.parent_id, c.content, c.is_anonymous,
             c.created_at, c.updated_at, c.deleted_at, c.edited_at,
             c.author_mssv AS raw_author_mssv, s.full_name AS raw_author_name,
             p.scope, p.scope_id, p.author_mssv AS post_author_mssv
      FROM community_post_comments c
      JOIN students s ON s.mssv = c.author_mssv
      JOIN community_posts p ON p.id = c.post_id
      WHERE c.id = $1 AND p.deleted_at IS NULL;
    `, [cleanCommentId]);
    if (!result.rowCount) return null;
    const row = result.rows[0];
    const cleanViewer = viewerMssv ? normalizeMssv(viewerMssv) : null;
    if (!(await canAccessPost(row, cleanViewer))) return null;
    let canModerate = cleanViewer && row.post_author_mssv === cleanViewer;
    if (!canModerate && cleanViewer && row.scope === 'clan') {
      canModerate = await PermissionService.canInClan(cleanViewer, row.scope_id, 'clan:comment_delete_any');
    }
    return mapCommentRow(row, cleanViewer, { canModerate });
  },

  /**
   * Lấy danh sách bình luận của bài viết
   */
  async getComments(postId, viewerMssv = null) {
    const cleanPostId = normalizePostId(postId);
    if (!cleanPostId || !isDatabaseConfigured()) return [];
    const cleanViewerMssv = viewerMssv ? normalizeMssv(viewerMssv) : null;

    const sql = `
      SELECT 
        c.id,
        c.post_id,
        c.parent_id,
        c.content,
        c.is_anonymous,
        c.created_at,
        c.updated_at,
        c.deleted_at,
        c.edited_at,
        s.full_name AS raw_author_name,
        c.author_mssv AS raw_author_mssv,
        p.scope,
        p.scope_id,
        p.author_mssv AS post_author_mssv
      FROM community_post_comments c
      JOIN students s ON c.author_mssv = s.mssv
      JOIN community_posts p ON p.id = c.post_id
      WHERE c.post_id = $1 AND p.deleted_at IS NULL
      ORDER BY c.created_at ASC;
    `;
    const result = await query(sql, [cleanPostId]);

    if (!result.rows.length) return [];
    if (!(await canAccessPost(result.rows[0], cleanViewerMssv))) return [];
    let canModerate = Boolean(cleanViewerMssv && result.rows[0].post_author_mssv === cleanViewerMssv);
    if (!canModerate && cleanViewerMssv && result.rows[0].scope === 'clan') {
      canModerate = await PermissionService.canInClan(cleanViewerMssv, result.rows[0].scope_id, 'clan:comment_delete_any');
    }
    const comments = result.rows.map((row) => mapCommentRow(row, cleanViewerMssv, { canModerate }));
    return enrichCommunityIdentities(comments);
  }
};
