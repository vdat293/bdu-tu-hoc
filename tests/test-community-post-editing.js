import assert from 'node:assert/strict';
import fs from 'node:fs';

const routes = fs.readFileSync(new URL('../src/routes/api.routes.js', import.meta.url), 'utf8');
const controller = fs.readFileSync(new URL('../src/controllers/api.controller.js', import.meta.url), 'utf8');
const communityService = fs.readFileSync(new URL('../src/services/community.service.js', import.meta.url), 'utf8');
const permissionService = fs.readFileSync(new URL('../src/services/permission.service.js', import.meta.url), 'utf8');
const realtime = fs.readFileSync(new URL('../src/services/community-realtime.service.js', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../migrations/030_community_post_editing.sql', import.meta.url), 'utf8');
const clientApi = fs.readFileSync(new URL('../client/src/api/community.js', import.meta.url), 'utf8');
const confessionPage = fs.readFileSync(new URL('../client/src/features/confession/ConfessionPage.jsx', import.meta.url), 'utf8');

// Route + controller: PATCH /community/posts/:id
assert.match(routes, /router\.patch\('\/community\/posts\/:id', ApiController\.updateCommunityPost\)/);
assert.match(controller, /async updateCommunityPost\(req, res\)/);
assert.match(controller, /CommunityService\.updatePost\(\{/);
assert.match(controller, /CommunityRealtime\.publishPostUpdated\(data\)/);

// Service: quyền sửa/xoá toàn hệ thống trả về cho client
assert.match(communityService, /async updatePost\(\{ postId, requesterMssv, title, content, isAnonymous, attachments \}\)/);
assert.match(communityService, /community:post_update_any/);
assert.match(communityService, /PermissionService\.canAll\(cleanViewerMssv, \['community:post_update_any', 'community:post_delete_any'\]\)/);
assert.match(communityService, /canEdit = isAuthor \|\| \(await PermissionService\.can\(cleanRequester, 'community:post_update_any'\)\)/);
assert.match(communityService, /can_edit: Boolean\(isAuthor \|\| canEditAny\)/);
assert.match(communityService, /can_delete: canDelete/);
assert.match(communityService, /edited_at = NOW\(\)/);
assert.match(communityService, /edited_at: row\.edited_at \|\| null/);
assert.match(permissionService, /async canAll\(mssv, capabilities = \[\]\)/);

// Realtime: bài được sửa phải phát sự kiện để feed làm mới
assert.match(realtime, /publishPostUpdated\(post\)/);
assert.match(realtime, /'community\.post\.updated'/);

// Migration lưu dấu vết chỉnh sửa
assert.match(migration, /ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ/);

// Client: API + UI sửa/xoá cho quản trị viên
assert.match(clientApi, /export async function updateCommunityPost\(token, postId, changes\)/);
assert.match(confessionPage, /Chỉnh sửa bài viết/);
assert.match(confessionPage, /Lưu thay đổi/);
assert.match(confessionPage, /Đã chỉnh sửa/);
assert.match(confessionPage, /post\.is_mine \|\| post\.can_edit/);
assert.match(confessionPage, /post\.is_mine \|\| post\.can_delete/);

console.log('✓ Quản trị viên (SYSTEM_OWNER_MSSV) sửa/xoá mọi bài Confession đã được nối route → service → realtime → UI.');
