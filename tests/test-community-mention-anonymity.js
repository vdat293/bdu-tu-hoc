import assert from 'node:assert/strict';
import { closeDatabase, query } from '../src/db/database.js';
import { MentionService } from '../src/services/mention.service.js';
import { NotificationService } from '../src/services/notification.service.js';

if (!process.env.DATABASE_URL) {
  console.log('Skipping test-community-mention-anonymity: DATABASE_URL not configured.');
  process.exit(0);
}

const ACTOR = 'TEST_MENTION_ANON_ACTOR';
const RECIPIENT = 'TEST_MENTION_ANON_RECIPIENT';
const TARGET = 'TEST_MENTION_ANON_TARGET';
const TABLE_MISSING = new Set(['42P01']);

let failures = 0;
function check(label, condition, extra = '') {
  console.log(`${condition ? '✅' : '❌'} ${label}${condition ? '' : ` — ${extra}`}`);
  if (!condition) failures += 1;
}

async function cleanup() {
  await query('DELETE FROM notifications WHERE recipient_mssv = ANY($1) OR actor_mssv = ANY($1)', [[ACTOR, RECIPIENT, TARGET]]);
  await query('DELETE FROM confession_mentions WHERE mentioned_mssv = $1 OR mentioned_by = $1', [TARGET]);
  await query('DELETE FROM community_post_comments WHERE author_mssv = ANY($1)', [[ACTOR, RECIPIENT]]);
  await query('DELETE FROM community_posts WHERE author_mssv = ANY($1)', [[ACTOR, RECIPIENT]]);
  await query('DELETE FROM students WHERE mssv = ANY($1)', [[ACTOR, RECIPIENT, TARGET]]);
}

async function notificationFor(recipient, where) {
  const list = await NotificationService.listNotifications(recipient, { limit: 50 });
  return list.items.find(where) || null;
}

try {
  console.log('🧪 Kiểm thử ẩn danh cho tag/mention và thông báo...');
  await cleanup();
  await query(
    `INSERT INTO students (mssv, full_name, is_active)
     VALUES ($1, 'Người Tag Thử', TRUE), ($2, 'Người Nhận Thử', TRUE), ($3, 'Người Được Tag Thử', TRUE)`,
    [ACTOR, RECIPIENT, TARGET]
  );

  // 1. Bài confession ẩn danh: người được tag không được biết ai tag mình.
  const anonPost = await query(
    `INSERT INTO community_posts (author_mssv, title, content, scope, is_anonymous, category)
     VALUES ($1, 'Ẩn danh', 'nội dung', 'school', TRUE, 'confession') RETURNING id`,
    [ACTOR]
  );
  const anonCreated = await MentionService.syncPostMentions(null, {
    postId: anonPost.rows[0].id,
    content: `chào @${TARGET} nhé`,
    actorMssv: ACTOR,
    isAnonymous: true
  });
  assert.equal(anonCreated.length, 1);
  check('Post ẩn danh: payload realtime che actor_mssv/actor_name', anonCreated[0].actor_mssv === null && anonCreated[0].actor_name === null);
  check('Post ẩn danh: payload realtime đánh dấu actor_is_anonymous', anonCreated[0].actor_is_anonymous === true);

  const anonNotif = await notificationFor(TARGET, (n) => n.post_id === String(anonPost.rows[0].id));
  check('Post ẩn danh: API danh sách thông báo che actor', Boolean(anonNotif) && anonNotif.actor_mssv === null && anonNotif.actor_name === null);
  check('Post ẩn danh: API danh sách báo actor_is_anonymous', anonNotif?.actor_is_anonymous === true);

  // 2. Bài confession công khai: vẫn hiện đúng tên người tag.
  const publicPost = await query(
    `INSERT INTO community_posts (author_mssv, title, content, scope, is_anonymous, category)
     VALUES ($1, 'Công khai', 'nội dung', 'school', FALSE, 'confession') RETURNING id`,
    [ACTOR]
  );
  const publicCreated = await MentionService.syncPostMentions(null, {
    postId: publicPost.rows[0].id,
    content: `chào @${TARGET} nhé`,
    actorMssv: ACTOR,
    isAnonymous: false
  });
  check('Post công khai: hiện tên người tag', publicCreated[0]?.actor_name === 'Người Tag Thử');
  const publicNotif = await notificationFor(TARGET, (n) => n.post_id === String(publicPost.rows[0].id));
  check('Post công khai: API danh sách hiện tên người tag', publicNotif?.actor_name === 'Người Tag Thử' && publicNotif?.actor_mssv === ACTOR);

  // 3. Bình luận ẩn danh trên bài công khai: vẫn phải che người tag.
  const anonComment = await query(
    `INSERT INTO community_post_comments (post_id, author_mssv, content, is_anonymous)
     VALUES ($1, $2, 'bình luận', TRUE) RETURNING id`,
    [publicPost.rows[0].id, ACTOR]
  );
  const commentCreated = await MentionService.syncCommentMentions(null, {
    postId: publicPost.rows[0].id,
    commentId: anonComment.rows[0].id,
    content: `chào @${TARGET}`,
    actorMssv: ACTOR,
    isAnonymous: true
  });
  check('Bình luận ẩn danh: payload realtime che actor', commentCreated[0]?.actor_mssv === null && commentCreated[0]?.actor_name === null);
  const commentNotif = await notificationFor(TARGET, (n) => n.comment_id === String(anonComment.rows[0].id));
  check('Bình luận ẩn danh: API danh sách che actor', commentNotif?.actor_name === null && commentNotif?.actor_is_anonymous === true);

  // 4. Reply ẩn danh: người nhận thông báo cũng không thấy danh tính người trả lời.
  const parent = await query(
    `INSERT INTO community_post_comments (post_id, author_mssv, content, is_anonymous)
     VALUES ($1, $2, 'bình luận gốc', FALSE) RETURNING id`,
    [publicPost.rows[0].id, RECIPIENT]
  );
  const anonReply = await query(
    `INSERT INTO community_post_comments (post_id, author_mssv, parent_id, content, is_anonymous)
     VALUES ($1, $2, $3, 'trả lời', TRUE) RETURNING id`,
    [publicPost.rows[0].id, ACTOR, parent.rows[0].id]
  );
  const replyNotif = await MentionService.createReplyNotification(null, {
    postId: publicPost.rows[0].id,
    commentId: anonReply.rows[0].id,
    parentId: parent.rows[0].id,
    actorMssv: ACTOR,
    isAnonymous: true
  });
  check('Reply ẩn danh: payload realtime che actor', replyNotif?.actor_mssv === null && replyNotif?.actor_name === null && replyNotif?.actor_is_anonymous === true);
  const replyListed = await notificationFor(RECIPIENT, (n) => n.comment_id === String(anonReply.rows[0].id));
  check('Reply ẩn danh: API danh sách che actor', replyListed?.actor_name === null && replyListed?.actor_is_anonymous === true);
} catch (error) {
  if (TABLE_MISSING.has(error?.code)) {
    console.log('Skipping test-community-mention-anonymity: chưa chạy migration 031.');
  } else {
    failures += 1;
    console.error('❌ Lỗi kiểm thử:', error);
  }
} finally {
  try {
    await cleanup();
  } catch {}
  await closeDatabase();
}

if (failures) {
  console.error(`\n❌ ${failures} kiểm tra thất bại.`);
  process.exit(1);
}
console.log('\n✅ PASSED: Ẩn danh không lộ danh tính người tag trong thông báo.');
