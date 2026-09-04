# Kế hoạch nền tảng cộng đồng BDU Tự Học

## 1. Mục tiêu

Xây dựng lớp dữ liệu riêng cho BDU Tự Học, ánh xạ mỗi tài khoản nội bộ với
MSSV đã được API BDU xác minh và làm nền cho ba nhóm tính năng:

1. Kho học tập số dạng bài viết text và liên kết ngoài.
2. CLB/nhóm vận hành theo mô hình guild.
3. Bảng xếp hạng học tập tự nguyện dựa trên dữ liệu đã xác minh.

Hệ thống không lưu mật khẩu BDU và không nhận GPA/MSSV do frontend tự khai để
ghi vào dữ liệu tin cậy.

## 2. Quyết định kỹ thuật

- Database: PostgreSQL.
- Production database: Supabase PostgreSQL; chỉ backend Express giữ connection
  string và truy cập database trong giai đoạn đầu.
- Local database: PostgreSQL chạy bằng Docker Compose.
- ORM và migration: Drizzle ORM + `pg`.
- Validation: Zod tại biên API.
- Xác thực ứng dụng: opaque session token trong cookie `HttpOnly`, `Secure`,
  `SameSite=Lax`; database chỉ lưu hash của session token.
- ID nội bộ: UUID. MSSV có unique constraint nhưng không làm khóa ngoại chung.
- Tìm kiếm ban đầu: PostgreSQL Full Text Search; chưa dùng Elasticsearch.
- File học tập: không upload lên server, chỉ lưu link Drive/YouTube/website.

## 3. Kiến trúc xác thực

```text
Browser -> POST /api/auth/login -> Express -> API BDU
                                      |
                                      +-> xác minh MSSV
                                      +-> upsert students
                                      +-> tạo local session
                                      +-> Set-Cookie session

Browser -> API cộng đồng -> session middleware -> PostgreSQL
Browser -> API điểm/lịch -> session middleware -> BDU token ngắn hạn -> API BDU
```

Quy tắc:

- Mật khẩu BDU chỉ tồn tại trong request đăng nhập.
- BDU access token chỉ cache phía server đến khi hết hạn; không lưu lâu dài.
- Local session và phiên BDU tách biệt. Sinh viên vẫn có thể dùng phần cộng đồng
  khi token BDU hết hạn, nhưng phải xác thực lại để đồng bộ điểm/lịch.
- Các API ghi dữ liệu lấy `student_id` từ session, không lấy chủ sở hữu từ body.
- Chuẩn hóa MSSV bằng trim + uppercase trước khi tạo unique key.

## 4. Mô hình dữ liệu phiên bản đầu

### 4.1. Tài khoản và phiên

- `students`: id, mssv, display_name, email, faculty, major, cohort,
  avatar_url, profile_visibility, verified_at, created_at, updated_at.
- `sessions`: id, student_id, token_hash, expires_at, last_used_at,
  user_agent_hash, revoked_at.
- `academic_snapshots`: student_id, semester_code, gpa_4, gpa_10,
  accumulated_credits, passed_courses, source_fetched_at.
- Unique: `(student_id, semester_code)`.

### 4.2. Kho học tập số

- `posts`: author_id, guild_id nullable, type, title, body, visibility, status,
  created_at, updated_at, deleted_at.
- `post_links`: post_id, url, provider, title, is_accessible, checked_at.
- `tags`, `post_tags`.
- `comments`: post_id, author_id, parent_id nullable, body, status.
- `reactions`: student_id, target_type, target_id, reaction_type.
- `bookmarks`: student_id, post_id.
- `reports`: reporter_id, target_type, target_id, reason, status.
- `moderation_actions`: moderator_id, report_id, action, note, created_at.
- Realtime: REST là nguồn ghi dữ liệu; WebSocket chỉ phát event tối giản sau khi
  transaction commit. Room gồm `forum`, `post:{id}` và `clan:{id}`.

### 4.3. Entitlement khung và name tag

- `identity_items`: catalog frame, title và capability.
- `identity_entitlement_grants`: cấp/thu hồi quyền theo MSSV, thời hạn, lý do
  và người thực hiện.
- `identity_entitlement_audit`: audit grant, revoke, equip và chọn title.
- `system_roles`: owner, identity_admin và moderator.
- `SYSTEM_OWNER_MSSV` là bootstrap owner ở server; không đưa MSSV quản trị vào
  frontend hoặc migration dữ liệu nghiệp vụ.
- `students.equipped_frame_id`: khung đang trang bị phía server; `displayed_title_ids`
  tiếp tục giới hạn tối đa 3 name tag.
- `student_avatar_overrides`: ảnh avatar do admin tải lên VPS. Resolver luôn ưu
  tiên override, sau đó mới dùng `students.avatar_url` từ API BDU.
- Ảnh được chuẩn hóa WebP 512x512, lưu trong volume `data/avatars` và phục vụ
  qua `/media/avatars`; không ghi file runtime vào `src` hoặc Docker image.

### 4.4. Guild/CLB

- `guilds`: owner_id, name, slug, description, visibility, status.
- `guild_members`: guild_id, student_id, role, contribution_points, joined_at.
- `guild_join_requests`: guild_id, student_id, message, status.
- `guild_invitations`: guild_id, inviter_id, invitee_id, status, expires_at.
- `guild_events`: guild_id, creator_id, title, description, starts_at, ends_at.
- Unique: `(guild_id, student_id)` và unique `guilds.slug`.
- Vai trò: `owner`, `admin`, `moderator`, `member`.

### 4.5. Bảng xếp hạng

Không lưu một cột `rank` chỉnh sửa trực tiếp. Thứ hạng được tạo từ
`academic_snapshots` bằng query/window function; khi dữ liệu lớn sẽ chuyển sang
materialized view và refresh theo lịch.

Mặc định:

- Chỉ sinh viên opt-in mới xuất hiện.
- Hỗ trợ biệt danh thay cho tên thật.
- Xem theo học kỳ, khóa, ngành hoặc khoa.
- Không công khai bảng điểm chi tiết.
- Có thêm bảng "tiến bộ" và "đóng góp cộng đồng" để tránh chỉ gamify GPA.

## 5. API dự kiến

### Auth và hồ sơ

- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `PATCH /api/me/profile`
- `PATCH /api/me/privacy`
- `POST /api/me/academic-sync`

### Bài viết

- `GET/POST /api/posts`
- `GET/PATCH/DELETE /api/posts/:id`
- `POST /api/posts/:id/comments`
- `POST/DELETE /api/posts/:id/reactions`
- `POST/DELETE /api/posts/:id/bookmark`
- `POST /api/reports`

### Guild

- `GET/POST /api/guilds`
- `GET/PATCH /api/guilds/:slug`
- `POST /api/guilds/:id/join-requests`
- `PATCH /api/guilds/:id/members/:studentId`
- `POST /api/guilds/:id/events`

### Xếp hạng

- `GET /api/leaderboards/academic`
- `GET /api/leaderboards/improvement`
- `GET /api/leaderboards/community`
- `PATCH /api/me/leaderboard-visibility`

## 6. Các giai đoạn triển khai

### Giai đoạn 0 - Chốt contract và bảo mật

- [ ] Chuẩn hóa response/error format cho API mới.
- [ ] Định nghĩa quyền public, member, moderator và admin.
- [ ] Thêm biến môi trường mẫu; không commit connection string/secret.
- [ ] Thiết lập CORS, cookie, proxy trust và HTTPS production.
- [ ] Thêm rate limit cho login và API ghi dữ liệu.

Điều kiện hoàn thành: có tài liệu quyền truy cập và threat checklist được review.

### Giai đoạn 1 - PostgreSQL và local session

- [ ] Thêm PostgreSQL service vào `docker-compose.yml`.
- [ ] Cài Drizzle, `pg`, Zod và công cụ migration.
- [ ] Tạo schema `students`, `sessions`, `academic_snapshots`.
- [ ] Tạo database client, health check và migration command.
- [ ] Sau BDU login thành công, upsert student theo MSSV đã xác minh.
- [ ] Phát hành/revoke session cookie và thêm auth middleware.
- [ ] Chuyển API profile/điểm/lịch sang nhận danh tính từ session.
- [ ] Thêm cleanup session hết hạn.

Điều kiện hoàn thành: đăng nhập BDU tạo đúng một student, cookie không đọc được
bằng JavaScript, logout thu hồi session và không thể giả MSSV qua request body.

### Giai đoạn 2 - Kho học tập số MVP

- [ ] Tạo schema post, link, tag, comment, bookmark và reaction.
- [ ] CRUD bài viết text với validation và phân trang cursor.
- [ ] Chỉ chấp nhận URL thuộc danh sách protocol an toàn.
- [ ] Lấy metadata link phía server với timeout và chống SSRF.
- [ ] Tìm kiếm có hỗ trợ tiếng Việt/không dấu ở mức phù hợp.
- [ ] Giao diện feed, tạo bài, chi tiết bài và bài đã lưu.

Điều kiện hoàn thành: sinh viên đã xác minh có thể đăng/sửa/xóa bài của mình,
đọc feed phân trang và chia sẻ link Drive mà không upload file.

### Giai đoạn 3 - Guild/CLB MVP

- [ ] Tạo guild, tham gia/rời guild và duyệt yêu cầu tham gia.
- [ ] Thực thi role owner/admin/moderator/member ở service layer.
- [ ] Bảng tin theo guild sử dụng lại `posts.guild_id`.
- [ ] Sự kiện và lịch hoạt động đơn giản.
- [ ] Audit log cho đổi vai trò, kick/ban và chuyển owner.

Điều kiện hoàn thành: không có đường API nào cho member thường thực hiện thao
tác moderator; guild private không lộ bài cho người ngoài.

### Giai đoạn 4 - Xếp hạng opt-in

- [ ] Đồng bộ snapshot chỉ từ dữ liệu BDU do backend lấy.
- [ ] Viết test tính GPA và xử lý học lại/cải thiện điểm.
- [ ] Query xếp hạng bằng `dense_rank()` theo từng cohort/major/semester.
- [ ] Thêm lựa chọn tên thật, biệt danh hoặc ẩn hoàn toàn.
- [ ] Thêm bảng tiến bộ và đóng góp cộng đồng.
- [ ] Cache kết quả và chống đồng bộ quá thường xuyên.

Điều kiện hoàn thành: frontend không thể tự gửi GPA; người opt-out không xuất
hiện và không suy ra được điểm chi tiết từ API.

### Giai đoạn 5 - Moderation và production hardening

- [ ] Report queue, soft delete, moderation action và audit trail.
- [ ] Chính sách nội dung cho bài chia sẻ trải nghiệm giảng viên.
- [ ] Chống spam, duplicate post và reaction farming.
- [ ] Backup/restore drill và migration rollback procedure.
- [ ] Log bảo mật không chứa token, cookie, mật khẩu hoặc điểm chi tiết.
- [ ] Index/EXPLAIN các query feed, guild và leaderboard.
- [ ] Load test và kiểm tra quyền truy cập theo ma trận role.

Điều kiện hoàn thành: có thể khôi phục backup, audit được hành động quản trị và
các endpoint quan trọng vượt qua authorization/integration tests.

## 7. Thứ tự migration dự kiến

1. `students`, `sessions`.
2. `academic_snapshots` và privacy preferences.
3. `guilds`, `guild_members`, join request/invitation.
4. `posts`, `post_links`, `tags`, `comments`.
5. `reactions`, `bookmarks`.
6. `reports`, `moderation_actions`, audit logs.
7. Index tìm kiếm và leaderboard materialized view khi cần.

Mỗi migration phải có forward migration, kiểm tra dữ liệu và hướng dẫn rollback;
không chỉnh schema production thủ công qua dashboard.

## 8. Kiểm thử tối thiểu

- Unit: chuẩn hóa MSSV, hash session, validation URL, GPA và permission rules.
- Integration: login/upsert, session expiry/revoke, post ownership, guild roles,
  leaderboard opt-in.
- Security: giả MSSV, IDOR, CSRF, SSRF qua link preview, SQL injection, spam login.
- Load: feed phân trang, leaderboard theo cohort và nhiều reaction đồng thời.
- Migration: chạy từ database rỗng và nâng cấp từ schema liền trước.

## 9. Trạng thái triển khai hiện tại

- [x] Reply một cấp, sửa/xóa comment, soft delete và đồng bộ comment counter.
- [x] WebSocket community với auth message, room authorization, reconnect và
  event tối giản không làm lộ confession ẩn danh.
- [x] Entitlement server cho khung/name tag, cấp/thu hồi qua API quản trị và
  lưu khung đang trang bị.
- [x] Backfill quyền hiện tại, gồm `24050126` với `#TTCDS` và capability preview
  toàn bộ khung.
- [x] Admin upload/gỡ avatar override; Confession, comment, profile và Learning
  Hub dùng cùng resolver, đồng bộ qua WebSocket.
- [ ] Redis/PostgreSQL pub-sub adapter khi chạy nhiều app instance.
- [ ] Report queue và moderation dashboard đầy đủ.

## 10. Phạm vi MVP nên giữ lại

MVP gồm local account/session, bài viết text + link, bình luận/reply, realtime
community, bookmark, report, entitlement khung/name tag, guild cơ bản và
leaderboard opt-in. Chưa làm chat hai chiều, upload file, thuật toán gợi ý AI,
cấp độ guild phức tạp hoặc app mobile cho đến khi có dữ liệu sử dụng.

### Vận hành entitlement

Đặt `SYSTEM_OWNER_MSSV` ở environment server để bootstrap owner. Sau khi
migrate, owner/identity-admin dùng các endpoint `/api/admin/identity/*` hoặc
panel Quản trị hiển thị trong tab Confession để cấp/thu hồi item. Không sửa
`public/js/app.js` hoặc chèn MSSV mới vào migration cho các lần cấp sau.
