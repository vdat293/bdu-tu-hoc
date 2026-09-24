import assert from 'node:assert/strict';
import fs from 'node:fs';

// Kiểm tra các mảnh ghép của tính năng media Confession:
// upload ảnh bài viết + ảnh/GIF bình luận lưu trên Cloudflare R2, avatar tự
// upload, và admin-tool không còn thao tác upload thay người dùng.

const communityService = fs.readFileSync('src/services/community.service.js', 'utf8');
const routes = fs.readFileSync('src/routes/api.routes.js', 'utf8');
const controller = fs.readFileSync('src/controllers/api.controller.js', 'utf8');
const migration = fs.readFileSync('migrations/051_community_comment_media.sql', 'utf8');
const confession = fs.readFileSync('client/src/features/confession/ConfessionPage.jsx', 'utf8');
const composer = fs.readFileSync('client/src/features/confession/ImageComposer.jsx', 'utf8');
const serverJs = fs.readFileSync('server.js', 'utf8');
const adminHtml = fs.readFileSync('public/admin-tool.html', 'utf8');
const adminJs = fs.readFileSync('public/js/admin-tool.js', 'utf8');
const avatarService = fs.readFileSync('src/services/avatar-override.service.js', 'utf8');
const identityApi = fs.readFileSync('client/src/api/identity.js', 'utf8');
const communityApi = fs.readFileSync('client/src/api/community.js', 'utf8');
const gpaPage = fs.readFileSync('client/src/features/gpa/GpaPage.jsx', 'utf8');
const avatarHook = fs.readFileSync('client/src/components/identity/useAvatarUpload.js', 'utf8');
const cropDialog = fs.readFileSync('client/src/components/identity/AvatarCropDialog.jsx', 'utf8');
const managerDialog = fs.readFileSync('client/src/components/identity/AvatarManagerDialog.jsx', 'utf8');
const envExample = fs.readFileSync('.env.example', 'utf8');
const compose = fs.readFileSync('docker-compose.yml', 'utf8');

// 1. Schema bình luận có cột attachments.
assert.match(migration, /community_post_comments/, 'Migration 051 phải đụng bảng bình luận');
assert.match(migration, /ADD COLUMN IF NOT EXISTS attachments JSONB/, 'Bình luận phải có cột attachments JSONB');

// 2. Service chấp nhận ảnh R2 cho bài viết/bình luận với giới hạn số lượng.
assert.match(communityService, /parsePostAttachments/, 'Bài viết phải có bộ chuẩn hoá attachments ảnh');
assert.match(communityService, /parseCommentAttachments/, 'Bình luận phải có bộ chuẩn hoá attachments ảnh');
assert.match(communityService, /MAX_POST_IMAGES/, 'Bài viết phải giới hạn số ảnh');
assert.match(communityService, /MAX_COMMENT_IMAGES/, 'Bình luận phải giới hạn số ảnh');
assert.match(communityService, /deleteRemovedImageObjects/, 'Phải dọn object R2 khi gỡ ảnh khỏi nội dung');
assert.match(communityService, /attachments: isDeleted \? \[\]/, 'Bình luận đã xoá không trả attachments');

// 3. API mới.
assert.match(routes, /router\.post\('\/community\/media'/, 'Phải có endpoint upload media community');
assert.doesNotMatch(routes, /router\.post\('\/admin\/avatars/, 'Không còn admin upload avatar thay người dùng');
assert.match(routes, /router\.post\('\/me\/avatar'/, 'Phải có endpoint tự upload avatar');
assert.match(routes, /router\.delete\('\/me\/avatar'/, 'Phải có endpoint tự gỡ avatar');
assert.match(controller, /uploadCommunityMedia/, 'Controller phải xử lý upload media');
assert.match(controller, /uploadMyAvatar/, 'Controller phải xử lý upload avatar cá nhân');
assert.doesNotMatch(controller, /uploadAdminAvatar/, 'Controller không còn upload avatar admin');

// 4. Avatar chỉ lưu trên R2, không ghi file runtime xuống VPS.
assert.match(avatarService, /MediaStorageService\.putObject/, 'Avatar phải upload lên R2');
assert.doesNotMatch(avatarService, /fs\.writeFile|AVATAR_STORAGE_DIR/, 'Avatar không được ghi file xuống ổ đĩa');
assert.doesNotMatch(serverJs, /'\/media\/avatars'/, 'Không còn mount ảnh avatar local');
assert.match(serverJs, /'\/media\/r2\/\*'/, 'Phải có route stream ảnh R2 qua proxy');

// 5. Client: composer chọn ảnh, bình luận có ảnh/GIF, GPA hiện avatar.
assert.match(confession, /MediaFileInput/, 'Composer Confession phải có input ảnh');
assert.match(confession, /CommentMedia/, 'Bình luận phải render ảnh/GIF');
assert.match(confession, /uploadDraftImages/, 'Phải upload ảnh trước khi tạo bài/bình luận');
assert.match(composer, /MAX_POST_IMAGES = 5/, 'Bài viết tối đa 5 ảnh');
assert.match(composer, /MAX_COMMENT_IMAGES = 3/, 'Bình luận tối đa 3 ảnh');
assert.match(composer, /image\/gif/, 'Phải chấp nhận GIF');
assert.match(identityApi, /\/api\/me\/avatar/, 'API client phải gọi endpoint avatar cá nhân');
assert.match(communityApi, /\/api\/community\/media/, 'API client phải gọi endpoint upload media');
assert.match(gpaPage, /getMyIdentityPresentation/, 'Trang GPA phải nạp presentation để hiện avatar');
assert.match(gpaPage, /AvatarContent/, 'Hero GPA phải hiển thị ảnh đại diện');
assert.match(gpaPage, /Thay ảnh/, 'Hero GPA phải có nút/nhãn "Thay ảnh"');
assert.match(confession, /useAvatarUpload/, 'Confession dùng chung hook avatar');
assert.match(gpaPage, /useAvatarUpload/, 'GPA dùng chung hook avatar');
assert.match(avatarHook, /uploadMyAvatar/, 'Hook avatar phải gọi API /api/me/avatar');
assert.match(avatarHook, /identity-presentation/, 'Upload avatar phải invalidate presentation để đồng bộ 2 kênh');
assert.match(avatarHook, /startCrop/, 'Chọn ảnh phải mở popup căn chỉnh trước khi upload');
assert.match(cropDialog, /Chọn ảnh này/, 'Popup crop phải có nút xác nhận ảnh');
assert.match(cropDialog, /avatar-crop-stage/, 'Popup crop phải có khung kéo/zoom ảnh');
assert.match(managerDialog, /Tải ảnh từ máy/, 'Popup ảnh đại diện phải có lựa chọn tải ảnh từ file');
assert.match(managerDialog, /Gỡ ảnh hiện tại/, 'Popup ảnh đại diện phải có lựa chọn gỡ ảnh hiện tại');

// 6. Admin-tool chỉ còn xem/gỡ ảnh.
assert.doesNotMatch(adminHtml, /avatar-form|avatar-upload|avatar-file/, 'Admin tool không còn form upload avatar');
assert.match(adminHtml, /avatar-remove/, 'Admin tool vẫn có nút gỡ ảnh');
assert.doesNotMatch(adminJs, /uploadAdminAvatar/, 'Admin tool không gọi API upload');
assert.match(adminJs, /deleteAdminAvatar/, 'Admin tool vẫn gọi API gỡ ảnh');

// 7. Cấu hình R2 có mặt ở mẫu .env và docker-compose, bỏ biến lưu local.
assert.match(envExample, /R2_BUCKET=/, '.env.example phải có R2_BUCKET');
assert.match(envExample, /R2_PUBLIC_BASE_URL=/, '.env.example phải có R2_PUBLIC_BASE_URL');
assert.doesNotMatch(envExample, /AVATAR_STORAGE_DIR/, '.env.example không còn AVATAR_STORAGE_DIR');
assert.match(compose, /R2_ACCESS_KEY_ID/, 'docker-compose phải truyền credentials R2');
assert.doesNotMatch(compose, /AVATAR_STORAGE_DIR|data\/avatars/, 'docker-compose không còn volume avatar local');

console.log('✓ Community media: bài viết có ảnh, bình luận có ảnh/GIF, avatar R2 và admin-tool chỉ kiểm duyệt.');
