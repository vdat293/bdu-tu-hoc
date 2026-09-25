/**
 * Góc Tự Học Số — Community posts, comments và media upload.
 *
 * Upload media nằm chung khối này vì trong file gốc nó là dòng 187, ngay
 * trước `/community/posts` (dòng 188) — giữ liền để giữ nguyên thứ tự.
 *
 * @param {import('express').IRouter} router Shared router. Registration order matters.
 */
import { ApiController, mediaUpload, requireVerifiedMssv } from './_shared/http-deps.js';

export function registerCommunityRoutes(router) {
  router.post('/community/media', requireVerifiedMssv, mediaUpload.single('file'), ApiController.uploadCommunityMedia);
  router.get('/community/posts', ApiController.getCommunityPosts);
  router.post('/community/posts', ApiController.createCommunityPost);
  router.get('/community/posts/:id', ApiController.getCommunityPost);
  router.patch('/community/posts/:id', ApiController.updateCommunityPost);
  router.delete('/community/posts/:id', ApiController.deleteCommunityPost);
  router.post('/community/posts/:id/pin', ApiController.toggleClanPostPin);
  router.post('/community/posts/:id/like', ApiController.toggleCommunityPostLike);
  router.get('/community/posts/:id/comments', ApiController.getCommunityPostComments);
  router.post('/community/posts/:id/comments', ApiController.addCommunityPostComment);
  router.patch('/community/posts/:id/comments/:commentId', ApiController.editCommunityPostComment);
  router.delete('/community/posts/:id/comments/:commentId', ApiController.deleteCommunityPostComment);
}
