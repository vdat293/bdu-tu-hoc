import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  buildPseudonym,
  buildTitle,
  classifyLoginOutcome,
  collectStoryNodes,
  facebookPermalink,
  facebookPostId,
  groupSlugFromUrl,
  loginConfigReady,
  normalizeStory,
  parseGraphqlStream,
  storyImageUrls,
  storyMessageText,
  storyPostedAt,
  splitTitleAndBody
} from '../src/services/facebook-import.service.js';

/* ------------------------------------------------------------------ */
/* Payload GraphQL giả lập theo cấu trúc comet feed của Facebook       */
/* ------------------------------------------------------------------ */

const GROUP_SLUG = 'bdu.confessions';

function imageMedia(uri, width = 720, height = 960, typename = 'Photo') {
  return { __typename: typename, viewer_image: { uri, width, height } };
}

function storyNode({
  id = '111222333444555',
  message = 'Confession thứ Hai: mình mất ví ở căn tin khu B.',
  creationTime = 1_756_000_000,
  authorId = '100001234567890',
  authorName = 'Nguyễn Văn A',
  attachments = null,
  permalink = null
} = {}) {
  return {
    __typename: 'Story',
    post_id: `99887766_${id}`,
    creation_time: creationTime,
    actors: [{ id: authorId, name: authorName }],
    message: { text: message },
    permalink_url: permalink,
    attachments
  };
}

// Story nằm sâu trong nhiều tầng comet_sections như payload thật.
const nestedPayload = {
  data: {
    node: {
      group_feed: {
        edges: [
          { node: { comet_sections: { content: { story: storyNode({ id: '123456789012345' }) } } } },
          {
            node: {
              // Bản sao cùng post_id ở nhánh khác: phải bị khử trùng lặp.
              comet_sections: { content: { story: storyNode({ id: '123456789012345' }) } }
            }
          },
          {
            node: {
              comet_sections: {
                content: {
                  story: storyNode({
                    id: '999888777666555',
                    message: 'Tìm chủ nhân chiếc AirPods ở thư viện tầng 3.',
                    attachments: [
                      { styles: { attachment: { media: imageMedia('https://scontent-hcm.xx.fbcdn.net/v/t39/a.jpg?oh=aaa&oe=1') } } }
                    ]
                  })
                }
              }
            }
          }
        ]
      }
    }
  }
};

/* 1. Quét story tổng quát */
const stories = collectStoryNodes(nestedPayload);
assert.equal(stories.length, 2, 'Phải tìm thấy đúng 2 story, khử trùng lặp theo post_id.');
assert.equal(facebookPostId(stories[0]), '123456789012345');
assert.equal(storyMessageText(stories[1]).startsWith('Tìm chủ nhân'), true);

/* 2. Story không có chữ lẫn ảnh thì bị bỏ */
assert.equal(
  collectStoryNodes({ a: { b: { post_id: '99887766_555444333222111', creation_time: 1_756_000_000, message: { text: '' } } } }).length,
  0,
  'Story rỗng (chỉ sticker/reaction) không được coi là bài viết.'
);

/* 3. post_id và permalink */
assert.equal(facebookPostId({ post_id: '99887766_123456789012345' }), '123456789012345');
assert.equal(facebookPostId({ id: 'not-a-number' }), null);
assert.equal(facebookPostId({ post_id: '99887766_12' }), null, 'ID quá ngắn không phải bài viết.');
assert.equal(
  facebookPermalink({ post_id: '99887766_123456789012345' }, GROUP_SLUG),
  'https://www.facebook.com/groups/bdu.confessions/posts/123456789012345/'
);
assert.equal(
  facebookPermalink({ permalink_url: 'https://www.facebook.com/groups/bdu.confessions/posts/1/' }, GROUP_SLUG),
  'https://www.facebook.com/groups/bdu.confessions/posts/1/'
);
assert.equal(groupSlugFromUrl('https://www.facebook.com/groups/bdu.confessions/'), 'bdu.confessions');
assert.equal(groupSlugFromUrl('https://example.com/groups/x'), 'x');

/* 4. Bút danh ổn định, khác nhau giữa các tác giả */
const salt = 'test-salt';
const pseudonymA = buildPseudonym('100001234567890', salt);
assert.equal(pseudonymA, buildPseudonym('100001234567890', salt), 'Cùng tác giả phải ra cùng bút danh.');
assert.notEqual(pseudonymA, buildPseudonym('100001234567891', salt), 'Tác giả khác phải ra bút danh khác.');
assert.match(pseudonymA, /^facebook_user_[0-9a-f]{8}$/);
assert.ok(!pseudonymA.includes('100001234567890'), 'Bút danh không được chứa id Facebook.');

/* 5. Chuẩn hoá story */
const normalized = normalizeStory(storyNode({ id: '123123123123123' }), { groupSlug: GROUP_SLUG, hashSalt: salt });
assert.equal(normalized.authorMssv, buildPseudonym('100001234567890', salt).toUpperCase());
assert.equal(normalized.permalink, 'https://www.facebook.com/groups/bdu.confessions/posts/123123123123123/');
assert.equal(normalized.title, 'BDU Confession', 'Bài một dòng giữ tiêu đề mặc định để không lặp chữ.');
assert.equal(normalized.content, 'Confession thứ Hai: mình mất ví ở căn tin khu B.');
assert.equal(normalized.postedAt.getTime(), 1_756_000_000_000);

// Bài nhiều dòng: dòng đầu thành tiêu đề và bị cắt khỏi nội dung.
const multiLine = normalizeStory(
  storyNode({ id: '123123123123124', message: 'Tìm ny\nMọi người hay nhắn gì khi mới quen vậy ạ' }),
  { groupSlug: GROUP_SLUG, hashSalt: salt }
);
assert.equal(multiLine.title, 'Tìm ny');
assert.equal(multiLine.content, 'Mọi người hay nhắn gì khi mới quen vậy ạ');

assert.deepEqual(splitTitleAndBody('một dòng'), { title: 'BDU Confession', content: 'một dòng' });
assert.deepEqual(splitTitleAndBody('Tiêu đề\n\nThân bài\nDòng nữa'), { title: 'Tiêu đề', content: 'Thân bài\nDòng nữa' });
assert.deepEqual(splitTitleAndBody(''), { title: 'BDU Confession', content: '' });
assert.equal(splitTitleAndBody(`${'x'.repeat(300)}\nthân bài`).title, 'BDU Confession', 'Dòng đầu quá dài thì không tách.');
assert.equal(splitTitleAndBody('Chỉ có tiêu đề\n').content, 'Chỉ có tiêu đề\n'.trim(), 'Tách xong mà rỗng thì giữ nguyên.');

// Bài cũ hơn ngưỡng bị loại.
assert.equal(
  normalizeStory(storyNode(), { groupSlug: GROUP_SLUG, hashSalt: salt, now: 1_756_000_000_000 + 40 * 86_400_000, maxAgeDays: 30 }),
  null,
  'Bài cũ hơn maxAgeDays phải bị loại.'
);

// Bài chỉ có ảnh vẫn nhập được, nhưng tiêu đề mặc định.
const imageOnly = normalizeStory(
  storyNode({
    message: '',
    attachments: [{ styles: { attachment: { media: imageMedia('https://scontent-hcm.xx.fbcdn.net/v/t39/only.jpg?oh=b') } } }]
  }),
  { groupSlug: GROUP_SLUG, hashSalt: salt }
);
assert.equal(imageOnly.title, 'BDU Confession');
assert.equal(imageOnly.content, '');
assert.equal(imageOnly.imageUrls.length, 1);

// Không có tác giả thì dùng bút danh khách, không lộ danh tính.
const unknownAuthor = normalizeStory(
  { post_id: '99887766_321321321321321', creation_time: 1_756_000_000, message: { text: 'Ẩn danh' } },
  { groupSlug: GROUP_SLUG, hashSalt: salt }
);
assert.equal(unknownAuthor.authorMssv, 'FACEBOOK_USER_GUEST');

/* 6. Chọn ảnh */
const richMedia = {
  attachments: [
    {
      styles: {
        attachment: {
          media: imageMedia('https://scontent-hcm.xx.fbcdn.net/v/t39/1.jpg?oh=1')
        }
      }
    },
    {
      styles: {
        attachment: {
          all_subattachments: {
            nodes: [
              { media: imageMedia('https://scontent-hcm.xx.fbcdn.net/v/t39/2.jpg?oh=2') },
              { media: imageMedia('https://scontent-hcm.xx.fbcdn.net/v/t39/2.jpg?oh=2') },
              { media: imageMedia('https://scontent-hcm.xx.fbcdn.net/v/t39/sticker.png?oh=3', 64, 64, 'Sticker') }
            ]
          }
        }
      }
    }
  ]
};
const urls = storyImageUrls(richMedia);
assert.deepEqual(urls, [
  'https://scontent-hcm.xx.fbcdn.net/v/t39/1.jpg?oh=1',
  'https://scontent-hcm.xx.fbcdn.net/v/t39/2.jpg?oh=2'
], 'Phải lấy ảnh, khử trùng lặp và bỏ sticker nhỏ.');
assert.equal(storyImageUrls(richMedia).length, 2);
assert.equal(storyImageUrls({}).length, 0);

/* 7. Tiêu đề dài bị cắt */
const longTitle = buildTitle('x'.repeat(400));
assert.equal(longTitle.length, 180);
assert.ok(longTitle.endsWith('…'));

/* 8. Thời gian tạo */
assert.equal(storyPostedAt({ creation_time: 1_756_000_000 }).getTime(), 1_756_000_000_000);
assert.equal(storyPostedAt({}), null);

/* 9. Tự đăng nhập lại: phân loại kết quả và điều kiện bật */
assert.equal(classifyLoginOutcome({ hasSession: true }), 'success');
assert.equal(
  classifyLoginOutcome({ url: 'https://www.facebook.com/checkpoint/1501092823525282/' }),
  'checkpoint'
);
assert.equal(
  classifyLoginOutcome({ url: 'https://www.facebook.com/login/two_step_verification/' }),
  'checkpoint'
);
assert.equal(classifyLoginOutcome({ hasTwoFactorPrompt: true }), 'two_factor');
assert.equal(
  classifyLoginOutcome({ url: 'https://www.facebook.com/login', errorText: 'Mật khẩu bạn đã nhập không chính xác' }),
  'bad_credentials'
);
assert.equal(
  classifyLoginOutcome({ url: 'https://www.facebook.com/login', errorText: 'Giá trị nhập là Email hoặc số di động không hợp lệ.' }),
  'bad_credentials',
  'Facebook báo định danh không hợp lệ cũng là lỗi thông tin đăng nhập.'
);
assert.equal(
  classifyLoginOutcome({ url: 'https://www.facebook.com/login', errorText: 'Khám phá những điều bạn yêu thích' }),
  'pending',
  'Text không phải thông báo lỗi thì không được coi là sai thông tin đăng nhập.'
);
assert.equal(classifyLoginOutcome({ url: 'https://www.facebook.com/login' }), 'pending');

const baseConfig = { autoRelogin: true, facebookUsername: 'a@b.c', facebookPassword: 'x' };
assert.equal(loginConfigReady(baseConfig), true);
assert.equal(loginConfigReady({ ...baseConfig, facebookPassword: '' }), false, 'Thiếu mật khẩu thì không thử đăng nhập.');
assert.equal(loginConfigReady({ ...baseConfig, autoRelogin: false }), false, 'Tắt auto relogin thì không thử.');
assert.equal(loginConfigReady(null), false);

/* 10. Payload GraphQL dạng stream nhiều document */
const streamPayload = [
  '{"data":{"viewer":{"id":"1"}}}',
  '{"data":{"node":{"group_feed":{"edges":[{"node":{"__typename":"Story","post_id":"99887766_777666555444333","creation_time":1756000000,"message":{"text":"Bài trong stream"},"actors":[{"id":"9","name":"X"}],"comet_sections":{}}}]}}}}',
  JSON.stringify({ data: { xfb_ohai_configurations: { note: 'dấu { } và \\" trong chuỗi' } } })
].join('\u001e');

const parsedDocs = parseGraphqlStream(streamPayload);
assert.equal(parsedDocs.length, 3, 'Phải tách được 3 document, kể cả khi có ký tự \\u001e phân cách.');
assert.equal(parsedDocs[0].data.viewer.id, '1');
assert.equal(collectStoryNodes(parsedDocs[1]).length, 1, 'Story trong stream phải được nhận diện.');
assert.match(parsedDocs[2].data.xfb_ohai_configurations.note, /dấu \{ \} và \\" trong chuỗi/);

// Chuỗi chứa ngoặc nhọn không được làm lệch bộ đếm.
const tricky = parseGraphqlStream('{"a":"}}}","b":{"c":"{\\"}"}}trim rác{"d":1}');
assert.equal(tricky.length, 2);
assert.equal(tricky[0].a, '}}}');
assert.equal(tricky[1].d, 1);

// Body cụt (stream bị cắt) thì bỏ qua phần dở, không ném lỗi.
assert.equal(parseGraphqlStream('{"a":1}{"b":').length, 1);
assert.equal(parseGraphqlStream('').length, 0);
assert.equal(parseGraphqlStream('không phải json').length, 0);

/* 11. Nối dây hệ thống: migration, route, scheduler, static media, RBAC */
const migration = fs.readFileSync(new URL('../migrations/029_facebook_import.sql', import.meta.url), 'utf8');
const routes = fs.readFileSync(new URL('../src/routes/api.routes.js', import.meta.url), 'utf8');
const serverJs = fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8');
const communityService = fs.readFileSync(new URL('../src/services/community.service.js', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('../src/controllers/api.controller.js', import.meta.url), 'utf8');
const service = fs.readFileSync(new URL('../src/services/facebook-import.service.js', import.meta.url), 'utf8');

assert.match(migration, /CREATE TABLE IF NOT EXISTS facebook_import_posts/);
assert.match(migration, /facebook_import_posts_fb_post_id_unique/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS source/);
assert.match(routes, /admin\/facebook-import\/run.*requireCommunityModerator/);
assert.match(controller, /community:mod_access/);
assert.match(serverJs, /FacebookImportService\.start\(\)/);
assert.match(serverJs, /FacebookImportService\.stop\(\)/);
assert.match(serverJs, /'\/media\/fb-import'/);
assert.match(communityService, /community:post_delete_any/);
assert.match(service, /FB_IMPORT_PASSWORD/);
assert.match(service, /RELOGIN_STATE_FILE/);
assert.match(service, /parseGraphqlStream\(text\)/, 'Feed phải đọc bằng text() rồi tách document, không dùng response.json().');
assert.doesNotMatch(service, /response\.json\(\)/, 'response.json() bị lỗi với stream nhiều document của Facebook.');
assert.match(service, /maxDuplicatesInRow/, 'Phải dừng cuộn khi gặp dãy bài đã nhập.');
assert.doesNotMatch(service, /console\.(log|warn|error)\([^)]*facebookPassword/, 'Không được ghi mật khẩu ra log.');

console.log('✓ Facebook import: parser stream, bút danh ẩn danh, dedupe, auto relogin và RBAC kiểm duyệt đã nối.');
