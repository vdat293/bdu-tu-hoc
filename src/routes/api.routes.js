/**
 * Unified API Routes — assembler.
 *
 * File này KHÔNG còn chứa định nghĩa route. Mỗi nhóm route đã tách sang
 * `src/routes/<domain>.routes.js` dưới dạng hàm `register*(router)`.
 *
 * Vì sao dùng hàm nhận `router` chứ không phải `express.Router()` riêng cho mỗi
 * domain: Express khớp route THEO THỨ TỰ đăng ký. Nếu mỗi domain là một router
 * riêng rồi `app.use()` lần lượt, thứ tự sẽ bị đảo. Truyền chung một `router` và
 * gọi các hàm register theo đúng thứ tự dòng của file gốc cũ giữ nguyên hành vi
 * khớp route, kể cả `router.use('/admin/dashboard', requireAdmin)` vốn là
 * prefix-match và phải chạy sau route login.
 *
 * Vì vậy các domain bị xen kẽ trong file gốc được tách thành nhiều hàm register
 * riêng (identity có 4 hàm, notifications có 2 hàm) để tái tạo đúng thứ tự.
 * Đổi thứ tự gọi ở đây là thay đổi hành vi routing — hãy coi là thay đổi API.
 */

import express from 'express';
import { WordFmtService } from '../services/wordfmt.service.js';

import { registerAuthRoutes } from './auth.routes.js';
import { registerWordFmtRoutes } from './wordfmt.routes.js';
import { registerSurveyRoutes } from './survey.routes.js';
import { registerTrainingRoutes } from './training.routes.js';
import { registerEnglishRoutes } from './english.routes.js';
import { registerLearningRoutes } from './learning.routes.js';
import {
  registerIdentityPortalRoutes,
  registerIdentityAdminRoutes,
  registerFacebookImportRoutes,
  registerIdentityAvatarRoutes
} from './identity.routes.js';
import { registerNotificationRoutes, registerReminderRoutes } from './notifications.routes.js';
import { registerBroadcastRoutes } from './broadcast.routes.js';
import { registerAdminRoutes } from './admin.routes.js';
import { registerCommunityRoutes } from './community.routes.js';
import { registerClubsRoutes } from './clubs.routes.js';
import { registerMetaRoutes } from './meta.routes.js';
import { registerVocabRoutes } from './vocab.routes.js';
import { registerGrammarRoutes } from './grammar.routes.js';
import { registerGamesRoutes } from './games.routes.js';

const router = express.Router();

// Thứ tự bên dưới là THỨ TỰ DÒNG của file gốc trước khi tách. Giữ nguyên.
registerAuthRoutes(router);            // 1. Auth & Portal
registerWordFmtRoutes(router);         // 2. Word Formatting Tool
registerSurveyRoutes(router);          // 3. Survey Automation Tool
registerTrainingRoutes(router);        // 3b. Training Score (điểm rèn luyện)
registerEnglishRoutes(router);         // 4. Moodle English Exercise Automation
registerLearningRoutes(router);        // 5. Learning Hub Resources
registerIdentityPortalRoutes(router);  // 5b. Identity presentation + student directory
registerNotificationRoutes(router);    // 6. Thông báo tag/reply confession
registerReminderRoutes(router);        // 6a. Nhắc lịch học opt-in
registerIdentityAdminRoutes(router);   // 6b. Quản trị identity entitlement
registerFacebookImportRoutes(router);  // 6c. Kéo bài Facebook về Confession
registerBroadcastRoutes(router);       // 6d. Broadcast + admin avatars
registerIdentityAvatarRoutes(router);  // 6e. Avatar tự upload
registerAdminRoutes(router);           // 6f. Admin Traffic & Logs Dashboard
registerCommunityRoutes(router);       // 7. Góc Tự Học Số (Community)
registerClubsRoutes(router);           // 8. CLB & Nhóm Học Tập
registerMetaRoutes(router);            // 9. Health, queue status, version
registerVocabRoutes(router);           // 10. Luyện từ vựng
registerGrammarRoutes(router);         // 11. Luyện ngữ pháp
registerGamesRoutes(router);           // 12. Giải trí: online game rooms

export default router;
