/**
 * Unified API Routes
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import { ApiController } from '../controllers/api.controller.js';
import { WordFmtService } from '../services/wordfmt.service.js';

const router = express.Router();

// Multer upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'temp/');
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'upload-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30MB
  fileFilter: (req, file, cb) => {
    if (file.originalname.match(/\.(docx)$/i)) {
      return cb(null, true);
    }
    cb(new Error('Chỉ chấp nhận file định dạng Word (.docx).'));
  }
});

// 1. Auth & Portal
router.post('/login', ApiController.login);
router.post('/grades', ApiController.getGrades);
router.get('/rankings/me', ApiController.getMyAcademicRanking);
router.get('/rankings/leaderboard', ApiController.getAcademicLeaderboard);
router.post('/profile', ApiController.getProfile);
router.get('/schedule', ApiController.getSchedule);
router.post('/schedule', ApiController.getSchedule);

// 2. Word Formatting Tool
router.post('/wordfmt/format', upload.single('document'), ApiController.formatDocx);
router.get('/wordfmt/download/:filename', ApiController.downloadFormattedDocx);

// 3. Survey Automation Tool (Server-Sent Events)
router.get('/survey/stream', ApiController.streamSurvey);

// 4. Moodle English Exercise Automation
router.get('/english/answers', ApiController.getEnglishAnswers);
router.post('/english/answers', ApiController.addEnglishAnswer);
router.delete('/english/answers/:id', ApiController.deleteEnglishAnswer);
router.post('/english/login', ApiController.loginEnglish);
router.get('/english/:sessionId/activities', ApiController.getEnglishActivities);
router.post('/english/:sessionId/start', ApiController.startEnglishExercise);
router.post('/english/:sessionId/stop', ApiController.stopEnglishExercise);
router.delete('/english/:sessionId', ApiController.closeEnglishSession);
router.get('/english/:sessionId/stream', ApiController.streamEnglishExercise);

// 5. Learning Hub Resources
router.get('/learning/resources', ApiController.getLearningResources);
router.get('/learning/courses/:courseCode/posts', ApiController.getCourseLearningPosts);
router.post('/learning/courses/:courseCode/posts', ApiController.createCourseLearningPost);
router.delete('/learning/courses/:courseCode/posts/:postId', ApiController.deleteCourseLearningPost);
router.post('/learning/courses/:courseCode/posts/:postId/like', ApiController.toggleCourseLearningPostLike);
router.get('/learning/courses/:courseCode/posts/:postId/comments', ApiController.getCourseLearningPostComments);
router.post('/learning/courses/:courseCode/posts/:postId/comments', ApiController.addCourseLearningPostComment);

router.get('/students/me/presentation', ApiController.getMyIdentityPresentation);
router.put('/students/me/presentation', ApiController.updateMyIdentityPresentation);

// 6. Góc Tự Học Số (Community Study Hub & Clans)
router.get('/community/posts', ApiController.getCommunityPosts);
router.post('/community/posts', ApiController.createCommunityPost);
router.get('/community/posts/:id', ApiController.getCommunityPost);
router.delete('/community/posts/:id', ApiController.deleteCommunityPost);
router.post('/community/posts/:id/pin', ApiController.toggleClanPostPin);
router.post('/community/posts/:id/like', ApiController.toggleCommunityPostLike);
router.get('/community/posts/:id/comments', ApiController.getCommunityPostComments);
router.post('/community/posts/:id/comments', ApiController.addCommunityPostComment);

// 7. CLB & Nhóm Học Tập (Clans/Guilds)
router.get('/community/clans', ApiController.getClans);
router.post('/community/clans', ApiController.createClan);
router.patch('/community/clans/:id', ApiController.updateClan);
router.delete('/community/clans/:id', ApiController.disbandClan);
router.post('/community/clans/:id/join', ApiController.joinClan);
router.post('/community/clans/:id/leave', ApiController.leaveClan);
router.get('/community/clans/:id/members', ApiController.getClanMembers);
router.patch('/community/clans/:id/members/:mssv/role', ApiController.updateClanMemberRole);
router.delete('/community/clans/:id/members/:mssv', ApiController.kickClanMember);
router.get('/community/clans/:id/documents', ApiController.getClanDocuments);
router.post('/community/polls/:pollId/vote', ApiController.voteClanPoll);

// Health & Metrics check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    queue: WordFmtService.getQueueStats()
  });
});
router.get('/queue-status', ApiController.getQueueStatus);

export default router;
