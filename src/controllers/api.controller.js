/**
 * Barrel gom các controller theo domain.
 *
 * File này CHỈ re-export, không chứa logic. Mỗi method đã được tách nguyên vẹn
 * sang `src/modules/<domain>/<domain>.controller.js`; từ đây trở đi mã mới
 * nên import thẳng từ file domain để đọc được dependency thật, và chỉ dùng
 * barrel này khi cần gom nhiều domain (ví dụ `api.routes.js` mount toàn bộ
 * route theo tên `ApiController.<method>`).
 *
 * Ở cuối file, 17 controller được hợp nhất bằng object spread để giữ đúng tên
 * `ApiController.<method>` mà `api.routes.js` đang dùng. Spread tạo snapshot
 * tại thời điểm spread, nên `ApiController` KHÔNG phải view động của các
 * controller con: đổi tên một method trong controller con sau khi barrel đã
 * nạp sẽ không phản ánh. Ở đây điều đó vô hại vì không mã nào mutate controller
 * và không controller nào dùng `this.` — nhưng đừng dựa vào nó để patch runtime.
 *
 * Không controller con nào được import từ barrel này — nếu không sẽ tạo
 * circular import. Mỗi controller con chỉ import service của chính nó.
 */
export { AuthController } from '../modules/auth/auth.controller.js';
export { AcademicsController } from '../modules/academics/academics.controller.js';
export { IdentityController } from '../modules/identity/identity.controller.js';
export { MediaController } from '../modules/media/media.controller.js';
export { MetaController } from '../modules/meta/meta.controller.js';
export { LearningController } from '../modules/learning/learning.controller.js';
export { GamesController } from '../modules/games/games.controller.js';
export { WordFmtController } from '../modules/wordfmt/wordfmt.controller.js';
export { SurveyController } from '../modules/survey/survey.controller.js';
export { EnglishController } from '../modules/english/english.controller.js';
export { CommunityController } from '../modules/community/community.controller.js';
export { NotificationsController } from '../modules/notifications/notifications.controller.js';
export { BroadcastController } from '../modules/broadcast/broadcast.controller.js';
export { ClubsController } from '../modules/clubs/clubs.controller.js';
export { VocabController } from '../modules/vocab/vocab.controller.js';
export { GrammarController } from '../modules/grammar/grammar.controller.js';
export { TrainingController } from '../modules/training/training.controller.js';

import { AuthController } from '../modules/auth/auth.controller.js';
import { AcademicsController } from '../modules/academics/academics.controller.js';
import { IdentityController } from '../modules/identity/identity.controller.js';
import { MediaController } from '../modules/media/media.controller.js';
import { MetaController } from '../modules/meta/meta.controller.js';
import { LearningController } from '../modules/learning/learning.controller.js';
import { GamesController } from '../modules/games/games.controller.js';
import { WordFmtController } from '../modules/wordfmt/wordfmt.controller.js';
import { SurveyController } from '../modules/survey/survey.controller.js';
import { EnglishController } from '../modules/english/english.controller.js';
import { CommunityController } from '../modules/community/community.controller.js';
import { NotificationsController } from '../modules/notifications/notifications.controller.js';
import { BroadcastController } from '../modules/broadcast/broadcast.controller.js';
import { ClubsController } from '../modules/clubs/clubs.controller.js';
import { VocabController } from '../modules/vocab/vocab.controller.js';
import { GrammarController } from '../modules/grammar/grammar.controller.js';
import { TrainingController } from '../modules/training/training.controller.js';

// Gom theo tên method để `ApiController.<method>` trong api.routes.js giữ
// nguyên như trước khi tách. Object này chỉ để tương thích route layer; mỗi
// method vẫn là function của đúng controller domain.
export const ApiController = {
  ...AuthController,
  ...AcademicsController,
  ...IdentityController,
  ...MediaController,
  ...MetaController,
  ...LearningController,
  ...GamesController,
  ...WordFmtController,
  ...SurveyController,
  ...EnglishController,
  ...CommunityController,
  ...NotificationsController,
  ...BroadcastController,
  ...ClubsController,
  ...VocabController,
  ...GrammarController,
  ...TrainingController
};
