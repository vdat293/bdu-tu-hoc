/**
 * Unified API Routes
 */

import express from 'express';
import multer from 'multer';
import path from 'path';
import { ApiController } from '../controllers/api.controller.js';
import { AdminDashboardController } from '../controllers/admin-dashboard.controller.js';
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

const avatarUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Math.max(1, Math.min(10, Number(process.env.AVATAR_MAX_SIZE_MB) || 3)) * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) return cb(null, true);
    cb(new Error('Chỉ chấp nhận ảnh JPG, PNG hoặc WebP.'));
  }
});

// 1. Auth & Portal
router.post('/login', ApiController.login);
router.post('/grades', ApiController.getGrades);
router.get('/rankings/me', ApiController.getMyAcademicRanking);
router.get('/rankings/leaderboard', ApiController.getAcademicLeaderboard);
router.get('/rankings/status', ApiController.getAcademicRankingStatus);
router.post('/profile', ApiController.getProfile);
router.get('/schedule', ApiController.getSchedule);
router.post('/schedule', ApiController.getSchedule);

// 2. Word Formatting Tool
router.post('/wordfmt/format', upload.single('document'), ApiController.formatDocx);
router.get('/wordfmt/download/:filename', ApiController.downloadFormattedDocx);

// 3. Survey Automation Tool (Server-Sent Events)
router.get('/survey/forms', ApiController.getSurveyForms);
router.post('/survey/runs', ApiController.startSurveyRun);
router.get('/survey/runs/:runId', ApiController.getSurveyRun);
// Keep the SSE path neutral so browser content filters do not mistake it for
// an external tracking/survey endpoint. It only observes an existing run.
router.get('/tool-runs/:runId/events', ApiController.streamSurveyRun);
// Legacy static portal compatibility. The React portal uses the run API above.
router.get('/survey/stream', ApiController.streamSurvey);

// 4. Moodle English Exercise Automation
router.get('/english/answers', ApiController.getEnglishAnswers);
router.post('/english/answers', ApiController.addEnglishAnswer);
router.delete('/english/answers/:id', ApiController.deleteEnglishAnswer);
router.post('/english/login', ApiController.loginEnglish);
router.get('/english/:sessionId/courses', ApiController.getEnglishCourses);
router.get('/english/:sessionId/activities', ApiController.getEnglishActivities);
router.post('/english/:sessionId/start', ApiController.startEnglishExercise);
router.post('/english/:sessionId/finish-course', ApiController.startEnglishCourseFinish);
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
router.put('/students/me/cosmetics/frame', ApiController.updateMyEquippedFrame);
router.get('/students/search', ApiController.searchActiveStudents);
router.get('/students/:mssv/profile', ApiController.getStudentProfile);

// Thông báo tag/reply confession
router.get('/notifications', ApiController.getNotifications);
router.get('/notifications/unread-count', ApiController.getUnreadNotificationCount);
router.post('/notifications/read-all', ApiController.markAllNotificationsRead);
router.post('/notifications/:id/read', ApiController.markNotificationRead);

// Nhắc lịch học opt-in (Email/Discord)
router.get('/reminders/prefs', ApiController.getReminderPrefs);
router.post('/reminders/consent', ApiController.consentReminders);
router.delete('/reminders/revoke', ApiController.revokeReminders);
router.post('/reminders/discord/code', ApiController.createDiscordLinkCode);
router.post('/reminders/discord/oauth-url', ApiController.createDiscordOAuthUrl);
router.post('/reminders/discord/oauth-complete', ApiController.completeDiscordOAuth);
router.post('/reminders/discord/test', ApiController.sendDiscordTest);
router.delete('/reminders/discord/link', ApiController.unlinkDiscordLink);

// Identity entitlement administration (server-side role checked)
router.get('/admin/identity/items', ApiController.getAdminIdentityItems);
router.post('/admin/identity/items', ApiController.createAdminIdentityItem);
router.put('/admin/identity/items/:id', ApiController.updateAdminIdentityItem);
router.delete('/admin/identity/items/:id', ApiController.deleteAdminIdentityItem);
router.get('/admin/identity/students/:mssv/grants', ApiController.getAdminIdentityGrants);
router.post('/admin/identity/grants', ApiController.createAdminIdentityGrant);
router.delete('/admin/identity/grants/:grantId', ApiController.revokeAdminIdentityGrant);
router.get('/admin/identity/audit', ApiController.getAdminIdentityAudit);
router.post('/admin/system-roles', ApiController.grantAdminSystemRole);
router.delete('/admin/system-roles/:mssv/:role', ApiController.revokeAdminSystemRole);

// Kéo bài viết từ nhóm Facebook về Confession (kiểm duyệt viên)
router.get('/admin/facebook-import/status', ApiController.requireCommunityModerator, ApiController.getFacebookImportStatus);
router.post('/admin/facebook-import/run', ApiController.requireCommunityModerator, ApiController.runFacebookImport);

// 6b. Thông báo cập nhật website qua Discord DM (Admin Tool)
router.get('/admin/broadcast', ApiController.requireIdentityAdmin, ApiController.getAdminBroadcast);
router.post('/admin/broadcast', ApiController.requireIdentityAdmin, ApiController.sendAdminBroadcast);
router.get('/admin/avatars', ApiController.getAdminAvatars);
router.get('/admin/avatars/:mssv', ApiController.getAdminAvatar);
router.post('/admin/avatars/:mssv', ApiController.requireIdentityAdmin, avatarUpload.single('avatar'), ApiController.uploadAdminAvatar);
router.delete('/admin/avatars/:mssv', ApiController.requireIdentityAdmin, ApiController.deleteAdminAvatar);

// Admin Traffic & Logs Dashboard
router.post('/admin/dashboard/login', AdminDashboardController.login);
router.use('/admin/dashboard', AdminDashboardController.requireAdmin);
router.get('/admin/dashboard/overview', AdminDashboardController.getOverview);
router.get('/admin/dashboard/timeline', AdminDashboardController.getTimeline);
router.get('/admin/dashboard/endpoints', AdminDashboardController.getEndpoints);
router.get('/admin/dashboard/users', AdminDashboardController.getUsers);
router.get('/admin/dashboard/visited-students', AdminDashboardController.getVisitedStudents);
router.get('/admin/dashboard/devices', AdminDashboardController.getDevices);
router.get('/admin/dashboard/logs', AdminDashboardController.getLogs);
router.get('/admin/dashboard/system', AdminDashboardController.getSystem);
router.post('/admin/dashboard/purge', AdminDashboardController.purgeLogs);

// 6. Góc Tự Học Số (Community Study Hub & Clans)
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

// 7. CLB & Nhóm Học Tập (Clans/Guilds)
router.get('/community/clans', ApiController.getClans);
router.post('/community/clans', ApiController.createClan);
router.patch('/community/clans/:id', ApiController.updateClan);
router.delete('/community/clans/:id', ApiController.disbandClan);
router.post('/community/clans/:id/join', ApiController.joinClan);
router.delete('/community/clans/:id/join-requests', ApiController.cancelClanJoinRequest);
router.get('/community/clans/:id/join-requests', ApiController.getClanJoinRequests);
router.post('/community/clans/:id/join-requests/:requestId/review', ApiController.reviewClanJoinRequest);
router.post('/community/clans/:id/leave', ApiController.leaveClan);
router.get('/community/clans/:id/members', ApiController.getClanMembers);
router.patch('/community/clans/:id/members/:mssv/role', ApiController.updateClanMemberRole);
router.delete('/community/clans/:id/members/:mssv', ApiController.kickClanMember);
router.get('/community/clans/:id/documents', ApiController.getClanDocuments);
router.get('/community/clans/:id/roles', ApiController.getClanRoles);
router.put('/community/clans/:id/roles', ApiController.updateClanRoles);
router.get('/community/clans/:id/quiz', ApiController.getClanQuiz);
router.put('/community/clans/:id/quiz', ApiController.updateClanQuiz);
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
router.get('/version', ApiController.getVersion);

// 8. Luyện từ vựng (clone luyentu, trừ Listening/Đặc biệt)
router.get('/vocab/themes', ApiController.listVocabThemes);
router.get('/vocab/themes/:slug', ApiController.getVocabTheme);
router.get('/vocab/themes/:slug/sets', ApiController.listVocabSets);
router.get('/vocab/sets/:setId', ApiController.getVocabSet);
router.get('/vocab/sets/:setId/words', ApiController.listVocabWords);
router.post('/vocab/progress', ApiController.saveVocabProgress);
router.get('/vocab/review/summary', ApiController.getVocabReviewSummary);
router.get('/vocab/review/words', ApiController.listVocabReviewWords);
router.post('/vocab/review', ApiController.reviewVocabWord);

// 8b. Luyện ngữ pháp (clone luyennguphap: lý thuyết + bài tập + đọc hiểu)
router.get('/grammar/groups', ApiController.listGrammarGroups);
router.get('/grammar/paths/:pathId', ApiController.getGrammarPath);
router.get('/grammar/lessons/:lessonId', ApiController.getGrammarLesson);
router.post('/grammar/progress', ApiController.saveGrammarProgress);

// 9. Giải trí: online game rooms, challenges and move history
router.get('/entertainment/games', ApiController.getEntertainmentGames);
router.get('/entertainment/rooms', ApiController.listEntertainmentRooms);
router.post('/entertainment/rooms', ApiController.createEntertainmentRoom);
router.get('/entertainment/rooms/:roomRef', ApiController.getEntertainmentRoom);
router.post('/entertainment/rooms/:roomRef/join', ApiController.joinEntertainmentRoom);
router.post('/entertainment/rooms/:roomRef/leave', ApiController.leaveEntertainmentRoom);
router.post('/entertainment/rooms/:roomRef/rematch', ApiController.rematchEntertainmentRoom);
router.get('/entertainment/rooms/:roomRef/moves', ApiController.listEntertainmentMoves);
router.post('/entertainment/rooms/:roomRef/moves', ApiController.makeEntertainmentMove);
router.post('/entertainment/rooms/:roomRef/challenges', ApiController.createEntertainmentChallenge);
router.get('/entertainment/challenges/:challengeId', ApiController.getEntertainmentChallenge);
router.post('/entertainment/challenges/:challengeId/accept', ApiController.acceptEntertainmentChallenge);

export default router;
