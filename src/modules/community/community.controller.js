/**
 * Module: Community Hub & CLB
 */

import { CommunityService } from '../../services/community.service.js';
import { CommunityRealtime } from '../../services/community-realtime.service.js';
import { MentionService } from './mention.service.js';
import { ReminderDigestService } from '../../services/reminder-digest.service.js';
import { BduIdentityService } from '../../services/bdu-identity.service.js';

function publishMentionNotifications(created) {
  if (!Array.isArray(created)) return;
  for (const item of created) {
    try {
      const isAnonymous = Boolean(item?.actor_is_anonymous);
      CommunityRealtime.publishNotification(item?.recipient_mssv, {
        id: item?.id,
        type: item?.type,
        actor_mssv: isAnonymous ? null : item?.actor_mssv,
        actor_name: isAnonymous ? null : (item?.actor_name || item?.actor_mssv),
        actor_is_anonymous: isAnonymous,
        post_id: item?.post_id != null ? String(item.post_id) : null,
        comment_id: item?.comment_id != null ? String(item.comment_id) : null,
        created_at: item?.created_at
      });
    } catch (error) {
      console.warn('[notifications] Không thể publish realtime:', error.message);
    }
    // Push tag/reply qua Discord DM ngay (fire-and-forget, chỉ khi user đã link).
    try {
      ReminderDigestService.pushMention({
        recipient_mssv: item?.recipient_mssv,
        actor_name: item?.actor_is_anonymous ? null : (item?.actor_name || item?.actor_mssv),
        type: item?.type === 'reply' ? 'reply' : 'mention',
        post_id: item?.post_id != null ? String(item.post_id) : null,
        comment_id: item?.comment_id != null ? String(item.comment_id) : null
      }).catch(() => {});
    } catch {}
  }
}

export const CommunityController = {

  // 11. Góc Tự Học Số (Community Hub) & CLB
  async getCommunityPosts(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      let viewerMssv = null;
      const filter = String(req.query.filter || 'all').trim().toLowerCase();
      const validFilters = ['all', 'mine', 'anon', 'pinned', 'announcement', 'material', 'poll', 'discussion'];
      if (!validFilters.includes(filter)) {
        return res.status(400).json({ result: false, message: 'Bộ lọc bài viết không hợp lệ.' });
      }
      if (filter === 'mine') {
        viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      } else if (req.headers.authorization) {
        try {
          viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
        } catch {}
      }
      const { scope, scopeId, limit, offset, category, hasAttachments, isPinned, source } = req.query;
      if (scope === 'clan' && !viewerMssv) {
        return res.status(401).json({ result: false, message: 'Vui lòng đăng nhập để xem bài viết CLB.' });
      }
      const rawSource = String(source || 'all').trim().toLowerCase();
      let cleanSource = null;
      if (['web', 'portal'].includes(rawSource)) cleanSource = 'portal';
      else if (['facebook', 'fb'].includes(rawSource)) cleanSource = 'facebook';
      else if (['all', ''].includes(rawSource)) cleanSource = null;
      else {
        return res.status(400).json({ result: false, message: 'Nguồn bài viết không hợp lệ.' });
      }
      const data = await CommunityService.getPosts({
        scope,
        scopeId,
        viewerMssv,
        authorMssv: filter === 'mine' ? viewerMssv : null,
        isAnonymous: filter === 'anon' ? true : null,
        category: filter === 'announcement' ? 'announcement' : (filter === 'poll' ? 'poll' : (filter === 'discussion' ? 'discussion' : (category || null))),
        hasAttachments: filter === 'material' ? true : (hasAttachments === 'true' ? true : null),
        isPinned: filter === 'pinned' ? true : (isPinned !== undefined ? isPinned : null),
        source: cleanSource,
        limit,
        offset
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Get community posts error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải danh sách bài viết.'
      });
    }
  },

  async getCommunityPost(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      let viewerMssv = null;
      if (req.headers.authorization) {
        try {
          viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
        } catch {}
      }
      const post = await CommunityService.getPostById(req.params.id, viewerMssv);
      if (!post) {
        return res.status(404).json({ result: false, message: 'Không tìm thấy bài viết.' });
      }
      if (post.scope === 'clan' && !viewerMssv) {
        return res.status(401).json({ result: false, message: 'Vui lòng đăng nhập để xem bài viết CLB.' });
      }
      return res.json({ result: true, data: post });
    } catch (err) {
      console.error('Get community post error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải bài viết.'
      });
    }
  },

  async createCommunityPost(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { title, content, scope, scopeId, isAnonymous, attachments, category, isPinned, poll } = req.body || {};
      const post = await CommunityService.createPost({
        authorMssv: mssv,
        title,
        content,
        scope,
        scopeId,
        isAnonymous,
        attachments,
        category,
        isPinned,
        poll
      });
      CommunityRealtime.publishPostCreated(post);
      if (post?.category === 'confession') {
        try {
          const created = await MentionService.syncPostMentions(null, {
            postId: post.id,
            content: `${title || ''}\n${content || ''}`,
            actorMssv: mssv,
            isAnonymous: Boolean(post?.is_anonymous)
          });
          publishMentionNotifications(created);
        } catch (mentionError) {
          console.warn('[mentions] Bỏ qua đồng bộ tag confession:', mentionError.message);
        }
      }
      return res.status(201).json({ result: true, data: post });
    } catch (err) {
      console.error('Create community post error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tạo bài viết.'
      });
    }
  },

  async deleteCommunityPost(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await CommunityService.deletePost(req.params.id, mssv);
      CommunityRealtime.publishPostDeleted(data);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete community post error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể xóa bài viết.'
      });
    }
  },

  async updateCommunityPost(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const { title, content, isAnonymous, attachments } = req.body || {};
      const data = await CommunityService.updatePost({
        postId: req.params.id,
        requesterMssv: mssv,
        title,
        content,
        isAnonymous,
        attachments
      });
      CommunityRealtime.publishPostUpdated(data);
      if (data?.category === 'confession' && (title !== undefined || content !== undefined)
        && typeof data?.content === 'string') {
        try {
          const created = await MentionService.syncPostMentions(null, {
            postId: data.id,
            content: `${data.title || ''}\n${data.content || ''}`,
            actorMssv: mssv,
            isAnonymous: Boolean(data?.is_anonymous)
          });
          publishMentionNotifications(created);
        } catch (mentionError) {
          console.warn('[mentions] Bỏ qua đồng bộ tag confession:', mentionError.message);
        }
      }
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Update community post error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể chỉnh sửa bài viết.'
      });
    }
  },

  async toggleClanPostPin(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await CommunityService.togglePinPost(req.params.id, mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Toggle clan post pin error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể ghim bài viết.'
      });
    }
  },

  async getClanDocuments(req, res) {
    try {
      const viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      res.setHeader('Cache-Control', 'private, no-store');
      const { type, search, limit, offset } = req.query;
      const data = await CommunityService.getClanDocuments(req.params.id, {
        type,
        search,
        limit,
        offset,
        viewerMssv
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Get clan documents error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải kho tài liệu CLB.'
      });
    }
  },

  async voteClanPoll(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { pollId } = req.params;
      const { optionId } = req.body || {};
      const data = await CommunityService.voteClanPoll(pollId, optionId, mssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Vote clan poll error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể thực hiện bình chọn.'
      });
    }
  },

  async toggleCommunityPostLike(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const data = await CommunityService.toggleLike(req.params.id, mssv);
      const post = await CommunityService.getPostById(req.params.id, mssv);
      CommunityRealtime.publishPostLikeChanged({
        postId: req.params.id,
        likeCount: data.like_count,
        scope: post?.scope,
        scopeId: post?.scope_id
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Toggle like error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tương tác like.'
      });
    }
  },

  async getCommunityPostComments(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      let viewerMssv = null;
      if (req.headers.authorization) {
        try {
          viewerMssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
        } catch {}
      }
      const data = await CommunityService.getComments(req.params.id, viewerMssv);
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Get comments error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải bình luận.'
      });
    }
  },

  async addCommunityPostComment(req, res) {
    try {
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      const { content, parentId, isAnonymous, attachments } = req.body || {};
      const comment = await CommunityService.addComment({
        postId: req.params.id,
        authorMssv: mssv,
        content,
        parentId,
        isAnonymous,
        attachments
      });
      const post = await CommunityService.getPostById(req.params.id, mssv);
      CommunityRealtime.publishCommentChanged({
        type: 'created',
        postId: req.params.id,
        commentId: comment?.id,
        parentId: comment?.parent_id,
        commentCount: comment?.comment_count,
        scope: post?.scope,
        scopeId: post?.scope_id
      });
      if (post?.category === 'confession') {
        try {
          const created = await MentionService.syncCommentMentions(null, {
            postId: req.params.id,
            commentId: comment?.id,
            content,
            actorMssv: mssv,
            isAnonymous: Boolean(comment?.is_anonymous)
          });
          const reply = await MentionService.createReplyNotification(null, {
            postId: req.params.id,
            commentId: comment?.id,
            parentId: comment?.parent_id,
            actorMssv: mssv,
            isAnonymous: Boolean(comment?.is_anonymous)
          });
          publishMentionNotifications([...created, ...(reply ? [reply] : [])]);
        } catch (mentionError) {
          console.warn('[mentions] Bỏ qua đồng bộ tag confession:', mentionError.message);
        }
      }
      return res.status(201).json({ result: true, data: comment });
    } catch (err) {
      console.error('Add comment error:', err.message);
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể thêm bình luận.'
      });
    }
  },

  async editCommunityPostComment(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const comment = await CommunityService.editComment({
        postId: req.params.id,
        commentId: req.params.commentId,
        requesterMssv: mssv,
        content: req.body?.content,
        attachments: req.body?.attachments
      });
      const post = await CommunityService.getPostById(req.params.id, mssv);
      CommunityRealtime.publishCommentChanged({
        type: 'updated',
        postId: req.params.id,
        commentId: comment?.id,
        parentId: comment?.parent_id,
        scope: post?.scope,
        scopeId: post?.scope_id
      });
      if (post?.category === 'confession') {
        try {
          const created = await MentionService.syncCommentMentions(null, {
            postId: req.params.id,
            commentId: comment?.id,
            content: req.body?.content,
            actorMssv: mssv,
            isAnonymous: Boolean(comment?.is_anonymous)
          });
          publishMentionNotifications(created);
        } catch (mentionError) {
          console.warn('[mentions] Bỏ qua đồng bộ tag confession:', mentionError.message);
        }
      }
      return res.json({ result: true, data: comment });
    } catch (err) {
      console.error('Edit comment error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể sửa bình luận.' });
    }
  },

  async deleteCommunityPostComment(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await CommunityService.deleteComment({
        postId: req.params.id,
        commentId: req.params.commentId,
        requesterMssv: mssv,
        reason: req.body?.reason
      });
      const post = await CommunityService.getPostById(req.params.id, mssv);
      CommunityRealtime.publishCommentChanged({
        type: 'deleted',
        postId: req.params.id,
        commentId: req.params.commentId,
        commentCount: data.comment_count,
        scope: post?.scope,
        scopeId: post?.scope_id
      });
      return res.json({ result: true, data });
    } catch (err) {
      console.error('Delete comment error:', err.message);
      return res.status(err.status || 500).json({ result: false, message: err.message || 'Không thể xóa bình luận.' });
    }
  },
};

