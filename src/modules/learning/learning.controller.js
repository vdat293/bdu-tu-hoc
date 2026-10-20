import { BduService } from '../../services/bdu.service.js';
import { BduIdentityService } from '../../services/bdu-identity.service.js';
import { LearningService } from '../../services/learning.service.js';
import { CommunityRealtime } from '../../services/community-realtime.service.js';
import { allowRequest } from '../../utils/request-rate-limit.js';

function sendLearningError(res, err, fallbackMessage) {
  const status = err.status || 500;
  const body = { result: false, message: err.message || fallbackMessage };
  if (err.code) body.code = err.code;
  if (err.errors) body.errors = err.errors;
  return res.status(status).json(body);
}

export const LearningController = {
  // 9. Learning Hub: Catalog
  async getLearningResources(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      const authHeader = req.headers.authorization;
      const mssv = await BduIdentityService.resolveVerifiedMssv(authHeader);
      let data = await LearningService.getStudentCourses(mssv);

      // Hỗ trợ truy cập thẳng vào tab kho học tập sau khi server vừa khởi động:
      // nếu chưa từng đồng bộ, lấy lại dữ liệu thật từ BDU thay vì trả môn mẫu.
      if (!data.synced_at) {
        const grades = await BduService.getGrades(authHeader);
        await LearningService.syncStudentCourses(mssv, grades);
        data = await LearningService.getStudentCourses(mssv);
      }
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải kho học tập theo môn.'
      });
    }
  },

  async getCourseLearningPosts(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.getCoursePosts(mssv, req.params.courseCode);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải không gian môn học.'
      });
    }
  },

  async getCourseQuiz(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.getCourseQuiz(
        mssv,
        req.params.courseCode,
        req.params.postId
      );
      return res.json({ result: true, data });
    } catch (err) {
      return sendLearningError(res, err, 'Không thể tải bài trắc nghiệm.');
    }
  },

  async createCourseLearningPost(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const body = req.body || {};
      if (String(body.kind || '').trim().toLowerCase() === 'quiz'
        && !allowRequest(`course-quiz-create:${mssv}`, { limit: 20, windowMs: 60 * 60 * 1000 })) {
        return res.status(429).json({
          result: false,
          code: 'RATE_LIMITED',
          message: 'Bạn thao tác quá nhanh, vui lòng thử lại sau.'
        });
      }
      const post = await LearningService.createCoursePost(
        mssv,
        req.params.courseCode,
        body
      );
      CommunityRealtime.publishCoursePostCreated({
        postId: post.id,
        courseCode: req.params.courseCode,
        category: post.kind || 'request'
      });
      return res.status(201).json({ result: true, data: post });
    } catch (err) {
      return sendLearningError(res, err, 'Không thể đăng nội dung cho môn học.');
    }
  },

  async deleteCourseLearningPost(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.deleteCoursePost(mssv, req.params.courseCode, req.params.postId);
      CommunityRealtime.publishCoursePostDeleted({
        postId: req.params.postId,
        courseCode: req.params.courseCode
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể xóa bài viết.'
      });
    }
  },

  async toggleCourseLearningPostLike(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.toggleCoursePostLike(mssv, req.params.courseCode, req.params.postId);
      CommunityRealtime.publishCoursePostLikeChanged({
        postId: req.params.postId,
        courseCode: req.params.courseCode,
        likeCount: data.like_count
      });
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể cập nhật lượt thích.'
      });
    }
  },

  async getCourseLearningPostComments(req, res) {
    try {
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Vary', 'Authorization');
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.getCoursePostComments(mssv, req.params.courseCode, req.params.postId);
      return res.json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể tải bình luận.'
      });
    }
  },

  async addCourseLearningPostComment(req, res) {
    try {
      const mssv = await BduIdentityService.resolveVerifiedMssv(req.headers.authorization);
      const data = await LearningService.addCoursePostComment(
        mssv,
        req.params.courseCode,
        req.params.postId,
        req.body || {}
      );
      const metadata = await LearningService.getCoursePostRealtimeMetadata(
        mssv,
        req.params.courseCode,
        req.params.postId
      );
      CommunityRealtime.publishCourseCommentChanged({
        type: 'created',
        postId: metadata.postId,
        commentId: data?.id,
        parentId: data?.parent_id,
        commentCount: metadata.commentCount,
        courseCode: metadata.courseCode
      });
      return res.status(201).json({ result: true, data });
    } catch (err) {
      return res.status(err.status || 500).json({
        result: false,
        message: err.message || 'Không thể gửi bình luận.'
      });
    }
  },
};
