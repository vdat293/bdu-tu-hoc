# 🎓 BDU Tự Học (BDU Smart Student Hub)

Cổng tiện ích học tập & tự động hóa **"All-in-One"** dành riêng cho sinh viên **Trường Đại học Bình Dương (BDU)**.

---

## Frontend Showcase

Giao diện sử dụng progressive enhancement: các chức năng cốt lõi vẫn hoạt động khi trình duyệt không hỗ trợ API mới, còn trình duyệt hiện đại được bổ sung:

- Màn hình đăng nhập có cảnh 3D three.js nạp động (nhân vật CC0 của KayKit đã đổi màu theo BDU, xem `scripts/import-student-model.mjs` và `public/assets/models/LICENSE-KayKit.txt`), bấm được vào ba lô / bàn ghế, tự rơi về blob CSS khi thiếu WebGL, màn hình hẹp hoặc bật giảm chuyển động.
- Art-directed dashboard với nhiều lớp parallax phản hồi theo con trỏ và vị trí cuộn.
- View Transitions khi chuyển khu vực trong dashboard.
- Command palette bằng `Ctrl/Cmd + K`, hỗ trợ tìm kiếm tiếng Việt không dấu và từ khóa ngữ nghĩa.
- Điều hướng sidebar bằng phím mũi tên, focus ring và course row có thể thao tác bằng bàn phím.
- Intersection Observer choreography, pointer spotlight, card perspective và button ripple có capability gating.
- Animated counters, skeleton state, sticky data headers, scroll progress và live network status.
- WordFmt processing scene có document scan, stage timeline và thời gian hiển thị tối thiểu 3 giây.
- Container queries, responsive sidebar có focus-safe backdrop, `prefers-reduced-motion` và forced-colors support.

Lớp enhancement được tách riêng tại `public/css/showcase.css` và `public/js/interactions.js` để không trộn hiệu ứng trình bày với logic nghiệp vụ.

---

## 🌟 Tính Năng Cốt Lõi

1. **Cổng Thông Tin Sinh Viên:**
   * 📊 **Bảng Điểm, GPA & Xếp Hạng:** Tra cứu điểm chi tiết trực tiếp từ `sv.bdu.edu.vn`, xem thành tích cá nhân nổi bật nhất và bảng xếp hạng theo lớp/khoa/viện/toàn trường; hỗ trợ chọn khóa, so sánh GPA hoặc tín chỉ, xuất CSV và in bảng điểm PDF.
   * 👤 **Lý Lịch Sinh Viên:** Xem hồ sơ sinh viên, thông tin lớp học, khoa, ngành đào tạo và cố vấn học tập.
    * 📅 **Thời Khóa Biểu Trực Tuyến:** Đồng bộ 100% dữ liệu lịch học thực tế theo tuần từ cổng BDU (`/public/api/sch/w-locdstkbtuanusertheohocky`), hỗ trợ chuyển đổi linh hoạt giữa các học kỳ (2026-2027, 2025-2026,...), hiển thị phòng học, tiết học, giảng viên và trạng thái đồng bộ thời gian thực.

2. **Bộ Công Cụ Tự Động Hóa (Integrated Tools):**
   * 📄 **Chuẩn Hóa Word BDU (`WordFmt`):** Kéo thả file `.docx` để chuẩn hóa A4 dọc, lề trên 2 cm, trái 3 cm, dưới 2 cm, phải 2 cm, Times New Roman 13, Heading H1–H4, mục lục/danh mục tự động, caption theo chương và Header/Footer theo từng section. Tool giữ header trên trang mở đầu chương theo hình mẫu BDU, bảo toàn bold/italic và loại danh sách, đổi en dash/em dash thành `-`, đồng thời gỡ tính click của hyperlink trong phần Tài liệu tham khảo nhưng giữ chữ hiển thị. Form hỗ trợ tùy chỉnh thông tin bìa và chọn bản số hoặc bản phục vụ đóng quyển.
   * 🤖 **Auto Đánh Giá Khảo Sát:** Tự động hoàn thành toàn bộ phiếu đánh giá giảng viên & môn học trên cổng BDU siêu tốc kèm cửa sổ Live Terminal Log trực tiếp trên web.
   * 🇬🇧 **Auto Bài Tập Tiếng Anh Moodle:** Đăng nhập `bdu.vn247.org`, quét quiz theo Course ID, tự điền từ ngân hàng đáp án cục bộ, live log, dừng tiến trình, tùy chọn tự nộp có xác nhận và tự học đáp án từ trang review. Mật khẩu Moodle chỉ tồn tại trong bộ nhớ phiên; nội dung câu hỏi không được gửi sang dịch vụ AI bên ngoài.
   * 🎯 **Auto Đăng Ký Môn Học (Sắp ra mắt):** Hẹn giờ và tự động gửi request săn lớp học phần theo danh sách ưu tiên.

3. **Kho Tự Học Số (E-Learning Hub):**
   * 📚 **Không Gian Theo Môn:** Đồng bộ mã và tên học phần trực tiếp từ bảng điểm BDU; hiển thị cả môn đã có điểm lẫn môn chưa có điểm và map ổn định theo mã môn.
   * 🤝 **Hỏi & Chia Sẻ:** Sinh viên từng học cùng mã môn có thể hỏi tài liệu hoặc chia sẻ link Google Drive, YouTube và website. Hệ thống không seed môn học hay tài liệu mẫu.

---

## 🚀 Hướng Dẫn Chạy Cục Bộ (Local Development)

### Frontend JSX và routing

Frontend sinh viên mới nằm trong `client/`, build bằng Vite vào `dist/client/` và
được Express phục vụ cùng origin. `public/admin-tool.html` vẫn là trang quản trị
độc lập; các tài nguyên legacy được giữ để rollback/coexistence trong giai đoạn
chuyển đổi.

```bash
npm run dev:server   # Express/API tại http://localhost:3000
npm run dev:client   # Vite tại http://localhost:5173, proxy API/media/WS
npm run build:client # production artifact dist/client
npm test             # safe Node + frontend suite; không đọc .env/DB/R2
npm run test:node    # chỉ safe Node test
npm run test:frontend
npm run lint:frontend
```

Route sinh viên canonical gồm `/gpa`, `/info`, `/schedule`, `/leaderboard`,
`/wordfmt`, `/survey`, `/english`, `/enrollment`, `/learning`, `/vocab`,
`/grammar`, `/clans` và `/confession`, cùng các route động tương ứng. Bộ lọc
được giữ trong query string để deep link, refresh và Back/Forward phục hồi
đúng trạng thái. Xem [baseline và hợp đồng hành vi](docs/frontend-migration-baseline.md).

### Yêu cầu môi trường:
* **Node.js**: Phiên bản 22.12+ (hoặc 20.19+ nếu môi trường chưa nâng được lên Node 22)
* **.NET SDK / Runtime 10.0+**: Cho module WordFmt
* **PostgreSQL 16+**: Lưu snapshot GPA và xếp hạng học tập

### Các bước khởi chạy:

1. Di chuyển vào thư mục dự án:
```bash
cd bdu-tu-hoc
```

2. Cài đặt dependencies:
```bash
npm ci
```

3. Sao chép `.env.example` thành `.env`, cấu hình `DATABASE_URL`, `CDS_USER`,
   `CDS_PASSWORD` và nhóm `R2_*` (xem mục "Ảnh & Cloudflare R2"), sau đó chạy migration:

```bash
npm run db:setup:dev # Chỉ dùng khi DATABASE_URL trỏ tới PostgreSQL localhost
npm run db:migrate

# Nếu database test đã có schema nhưng chưa có ledger, chỉ baseline trong
# maintenance disposable; baseline không chạy SQL migration:
# NODE_ENV=test BDU_TEST_MODE=1 BDU_TEST_CONFIRM_DESTRUCTIVE=1 \\
# BDU_TEST_DATABASE_URL=... BDU_MIGRATION_BASELINE_CONFIRM=1 \\
# BDU_MIGRATION_BASELINE_THROUGH_VERSION=10 \\
# BDU_MIGRATION_BASELINE_CONFIRM_DATABASE=bdu_test_local \\
# BDU_MIGRATION_BASELINE_CONFIRM_TARGET=127.0.0.1:55432/bdu_test_local \\
# Lấy fingerprint read-only trước baseline:
# MIGRATION_DATABASE_URL=... npm run db:migration:fingerprint
# BDU_MIGRATION_BASELINE_CONFIRM_FINGERPRINT=<schema-fingerprint-sha256> \\
# npm run db:migrate:baseline -- --yes

# Xuất backup (ghi atomic, file quyền 0600):
npm run db:dump -- data/backup.sql

# Restore chỉ mặc định cho database local bdu_test_*; cần xác nhận tường minh:
NODE_ENV=test \\
BDU_TEST_MODE=1 \\
BDU_TEST_DATABASE_URL=postgresql://bdu_test:secret@127.0.0.1:55432/bdu_test_restore \\
BDU_MAINTENANCE_CONFIRM_DESTRUCTIVE=1 \\
BDU_MAINTENANCE_CONFIRM_DATABASE=bdu_test_restore \\
npm run db:restore -- data/backup.sql --yes

# Dump tạo cặp file backup.sql + backup.sql.manifest.json (SHA-256).
# Restore từ chối file không có manifest hoặc checksum không khớp.
# Dump/restore không ghi mật khẩu vào argv. Production restore còn cần
# --allow-production và BDU_MAINTENANCE_ALLOW_PRODUCTION=1, cần thao tác vận hành riêng.
```

4. Có thể chạy đồng bộ thủ công lần đầu để giao diện có dữ liệu ngay:

```bash
npm run rankings:sync
```

Các lần sau backend tự đồng bộ lúc **03:00 sáng mỗi ngày theo múi giờ
Asia/Ho_Chi_Minh**. PostgreSQL advisory lock bảo đảm chỉ một container thực hiện
job khi hệ thống chạy nhiều instance.

5. Chạy test an toàn:
```bash
npm test
npm run test:node
npm run test:frontend
```

`npm test` chỉ chạy các suite không DB/network. Không chạy trực tiếp
`node tests/test-*.js`; runner sẽ chặn direct execution để tránh đọc `.env`
hoặc chạm dữ liệu thật.

Test tích hợp chỉ chạy trên database tạm có tên bắt buộc `bdu_test_*`:

```bash
NODE_ENV=test \
BDU_TEST_MODE=1 \
BDU_TEST_CONFIRM_DESTRUCTIVE=1 \
BDU_TEST_DATABASE_URL=postgresql://tester:secret@127.0.0.1:5432/bdu_test_local \
npm run test:ranking-integration
```

Test R2 còn yêu cầu `BDU_TEST_R2_BUCKET` prefix `bdu-test-`, endpoint local/test
và credential riêng. Tuyệt đối không dùng `DATABASE_URL` production, R2 bucket
production hoặc `.env` production cho các lệnh này.

6. Khởi chạy Server ở chế độ dev:
```bash
npm run dev
```

7. Mở trình duyệt tại: `http://localhost:3000`

---

## 🐳 Đóng Gói & Triển Khai Production (Docker Deployment)

Dockerfile đóng gói server Node.js, .NET runtime và binary WordFmt có sẵn
trong repository thành một container nguyên khối:

### Cách 1: Sử dụng Docker Compose (Khuyên dùng)

Trên máy chủ (VPS) cần cài Docker Engine và Docker Compose plugin trước. Sau đó:

```bash
cp .env.example .env
# Sửa .env: POSTGRES_PASSWORD, CDS_USER và CDS_PASSWORD
mkdir -p temp
docker compose up -d --build
docker compose logs -f bdu-hub
```

Compose tự khởi động PostgreSQL, chạy migration trước khi chạy app và lưu dữ
liệu database trong volume `bdu-postgres-data`. **Không deploy bằng lệnh này
lên production trước khi migration ledger, backup/restore drill và DB role
separation đã được xác minh.** Không cần mở port PostgreSQL ra Internet; chỉ
expose port ứng dụng `3000`.

Khi đặt Nginx/Caddy/Cloudflare ở phía trước container, proxy phải chuyển tiếp
WebSocket Upgrade và host công khai trong `X-Forwarded-Host` (hoặc `Forwarded`).
Vì Compose chỉ bind cổng ứng dụng vào `127.0.0.1`, nó mặc định tin các header này
(`WS_TRUST_PROXY=true` khi biến để trống). Không đặt giá trị đó cho một Node server
nhận kết nối trực tiếp. Nếu frontend dùng origin khác, khai báo origin HTTPS chính
xác trong `WS_ALLOWED_ORIGINS`, cách nhau bằng dấu phẩy.

### CDN/WAF và WebSocket (bắt buộc `no-transform`)

Nếu site nằm sau CDN/WAF có nén response (ví dụ proxy trả header `x-osh-dp`,
cookie `__osh_v`), tầng đó có thể brotli/gzip-nén cả luồng WebSocket khi trình
duyệt gửi `Accept-Encoding: br, gzip`. Frame WebSocket sau đó không còn hợp lệ:
Chrome báo `Invalid frame header`, socket mở nhưng không nhận `hello`/`auth.ok`,
và UI realtime rơi về polling dự phòng nên trông như "phản hồi rất chậm" so với
môi trường local. Ứng dụng Node đã tự gắn `Cache-Control: no-transform` và
`X-Accel-Buffering: no` vào response 101 của `/ws/community`; cấu hình proxy
(Caddy/Nginx) cũng nên lặp lại hai header này cho request Upgrade để fix không
phụ thuộc một tầng.

### Reverse proxy + TLS/WSS

Reverse proxy (Caddy/Nginx) là điểm vào duy nhất: nhận 80/443, trình chứng chỉ
TLS (ví dụ Cloudflare Origin) và `reverse_proxy` toàn bộ về `bdu-hub:3000`;
client khi đó tự dùng `wss://sv.bdu.io.vn/ws/community`.

Giữ `WS_TRUST_PROXY=true` chỉ vì Compose bind Node tại `127.0.0.1`; không expose
port 3000 ra Internet. Caddy tự chuyển tiếp HTTP/1.1 Upgrade và các header public
host/proto. Nếu frontend nằm ở một origin khác, đặt
`WS_ALLOWED_ORIGINS=https://frontend.example.edu.vn`; không dùng `*`.

Sau deploy, xác nhận WSS qua proxy (thay token thật, không lưu token vào shell history):

```bash
npx wscat -c wss://sv.bdu.io.vn/ws/community -H 'Origin: https://sv.bdu.io.vn'
# rồi gửi: {"type":"auth","token":"<token>"}
```

Giữ phiên mở hơn 90 giây để kiểm tra heartbeat, sau đó `docker compose restart
bdu-hub`: trình duyệt phải reconnect theo jitter, nhận `auth.ok`, và refetch các
query React đang mở. `AUTH_UNAVAILABLE`/close 1013 nghĩa là BDU tạm thời không
trả lời (quá `BDU_PROFILE_TIMEOUT_MS`, mặc định 20 giây) và sẽ retry; chỉ
`AUTH_INVALID` mới đăng xuất phiên.

Kết quả xác minh của một token opaque khôi phục sau restart chỉ được cache
`BDU_RESTORED_TOKEN_TTL_MS` (mặc định 5 phút); đăng nhập mới luôn giữ hạn
`expires_in` do BDU cấp.

### Cache trình duyệt/CDN và phát hiện bản mới

Portal React được phục vụ với chiến lược cache phân tầng, không cần người dùng
tự xóa cache sau deploy:

* Document SPA (`/` và deep link) trả `Cache-Control: no-store`.
* `/app-assets/*` có hash trong tên nên `immutable, max-age=1y` an toàn.
* JS/CSS/HTML legacy trong `public/` không có hash nên trả `no-cache,
  must-revalidate` (browser/CDN nhận 304 qua ETag, file đổi được phục vụ ngay).
* `/media/r2/*` stream ảnh từ Cloudflare R2 khi chưa gắn custom domain/r2.dev
  (cache `immutable, max-age=1y`); khi có `R2_PUBLIC_BASE_URL` ảnh mới trỏ
  thẳng CDN, URL cũ vẫn hoạt động qua proxy. (`/media/fb-import` đã gỡ cùng
  fb-import runtime — xem mục VPS đơn chạy trực tiếp.)

`npm run build:client` sinh `dist/client/build.json` và tự stamp `?v=<BUILD_ID>`
cho CSS legacy cùng `<meta name="bdu-build">`; runtime trả `GET /api/version`
cùng id đó. Tab đang mở phát hiện id khác khi quay lại tab sẽ hiện banner "có
bản cập nhật mới" (không tự reload để không mất nội dung đang gõ). Nếu tab còn
giữ chunk cũ đã bị xóa, client tự reload một lần có guard 30 giây; trường hợp
tầng cache vẫn trả HTML cũ thì ErrorBoundary hiện nút "Tải lại trang".

Chunk cũ của các bản build trước được giữ trong `data/client-assets` (volume
Docker) nên HTML còn cache tải được chunk cũ thay vì 404. Mặc định giữ 30 ngày,
chỉnh bằng `CLIENT_ASSET_HISTORY_DAYS`, đặt `CLIENT_ASSET_HISTORY_ENABLED=false`
để tắt. Vì vậy **không cần purge CDN thủ công**: nếu bạn có panel CDN thì nên
cấu hình HTML/`/api/version` không cache, còn nếu site nằm sau WAF của nhà cung
cấp hosting (không có panel) thì cơ chế trên vẫn hoạt động. Xác nhận sau deploy:

```bash
curl -fsSI https://hub.example.edu.vn/ | grep -i cache-control   # no-store
curl -fsS  https://hub.example.edu.vn/api/version                # {"result":true,"build_id":"..."}
```

Nếu WAF phía trước vẫn cache HTML bất chấp `no-store`, hãy gửi yêu cầu nhà cung
cấp loại trừ HTML và `/api/version` khỏi cache — đó là thứ duy nhất cần họ hỗ trợ.

Muốn build id cố định/đọc được thay vì timestamp, truyền lúc build:
`BUILD_ID=$(date +%Y%m%d%H%M%S) docker compose up -d --build`.

### Ảnh & Cloudflare R2

Toàn bộ ảnh người dùng (avatar, ảnh bài viết, ảnh/GIF bình luận Confession) được
lưu trên Cloudflare R2; server **không ghi file ảnh runtime xuống máy chủ** và
database chỉ giữ URL/object key.

Cấu hình trong `.env` (xem đầy đủ ở `.env.example`):

```env
R2_ACCOUNT_ID=<account id>
R2_ACCESS_KEY_ID=<Access Key ID>
R2_SECRET_ACCESS_KEY=<Secret Access Key>
R2_BUCKET=bdu-webapp
R2_ENDPOINT=                  # bỏ trống để tự suy ra từ R2_ACCOUNT_ID
R2_PUBLIC_BASE_URL=           # bỏ trống -> phục vụ qua /media/r2/<key>
```

* Tạo token tại **Cloudflare Dashboard → R2 → API → Manage API Tokens** với
  quyền **Object Read & Write** đúng bucket.
* Chưa gắn custom domain: ảnh trả về `/media/r2/<key>` và được server stream từ
  R2 kèm cache 1 năm. Khi gắn custom domain (hoặc bật R2.dev subdomain), điền
  `R2_PUBLIC_BASE_URL` để ảnh mới trỏ thẳng CDN — URL cũ trong DB vẫn chạy qua
  proxy nên không cần migrate lại.
* Giới hạn tải lên: `AVATAR_MAX_SIZE_MB` (avatar), `MEDIA_IMAGE_MAX_MB`,
  `MEDIA_GIF_MAX_MB`, `MEDIA_IMAGE_MAX_PIXELS`, `MEDIA_GIF_MAX_FRAMES`,
  `MEDIA_UPLOAD_RATE_LIMIT_PER_HOUR`; ảnh tĩnh được resize tối đa 1600px và
  chuyển WebP, GIF giữ nguyên animation.
* Ảnh đại diện có popup căn chỉnh/cắt vuông (kéo + zoom) trước khi upload, dùng
  chung cho Confession và GPA.
* Bài viết bị xoá (soft delete) vẫn giữ ảnh thêm `MEDIA_POST_DELETE_RETENTION_DAYS`
  ngày (mặc định 7) rồi `MediaCleanupService` tự dọn khỏi R2 theo chu kỳ
  `MEDIA_CLEANUP_INTERVAL_MINUTES`.
* Avatar do sinh viên tự upload ở trang Confession hoặc ngay tại hero trang GPA
  (hai kênh dùng chung một API và đồng bộ với nhau); admin-tool chỉ còn tra cứu
  và gỡ ảnh vi phạm. Ảnh cũ trong `data/avatars` migrate bằng:

```bash
node scripts/migrate-avatars-to-r2.js          # xem trước
node scripts/migrate-avatars-to-r2.js --apply  # upload + cập nhật DB
```

Sau khi migrate xong và kiểm tra ảnh hiển thị đúng, có thể xoá volume
`data/avatars` cũ.

### Site Giải trí độc lập

`/games` (BDU Game Hub) là một site static độc lập với portal React: portal chỉ có
shortcut trong khối `TIỆN ÍCH`, không đưa Game Hub vào sidebar hay layout học tập.
Site có hai theme sáng/tối (dùng chung key `bdu_theme` với portal) và các URL
`/games/<game>`, `/games/room/<mã-phòng>` đều được server fallback về
`public/games/index.html` để refresh/deep-link không bị 404.

**Cách chơi duy nhất — chơi với bạn qua link:** chọn game → "Chơi với một người
bạn" → copy link gửi bạn. Người mở link đầu tiên chiếm ghế trống và thành đối thủ;
người vào sau tự động ở chế độ khán giả (không cần `?role=`). 7 game hiển thị:
Battleship, Tic Tac Toe, Connect 4, Cờ caro (đánh trên giao điểm), Cờ vua, Cờ đam
(English draughts 8×8) và Backgammon.

Phòng, nước đi và thống kê thắng/thua nằm trong PostgreSQL (migration 026, 044,
045); WebSocket dùng `/ws/community` với room `game:<room_code>`. State được máy
chủ kiểm tra bằng transaction + row lock + `clientMoveId` idempotency; mỗi người
chỉ nhận state đã che theo ghế (Battleship giấu toạ độ tàu chưa chìm với cả người
chơi lẫn khán giả). Cài đặt phòng: thời gian mỗi nước (mặc định 1 phút, có thể
"Không giới hạn"), cho phép khán giả, bật/tắt chat — chat và emoji chỉ chạy qua
WebSocket (rate-limit 700ms, không lưu DB). Hết giờ bị xử thua, rời phòng giữa ván
bị xử thua (forfeit), phòng đã kết thúc giữ 3 phút cho "Chơi lại" rồi tự đóng.
Cờ vua dùng `chess.js` (phong cấp, chiếu hết, hòa lặp thế 3 lần, luật 50 nước);
Backgammon có luật dùng tối đa xúc xắc; Cờ đam có luật hòa 40 nước không tiến triển
và lặp thế.

Khung avatar + danh hiệu của từng người chơi được đồng bộ từ Góc Tự Học Số
(`GET /api/identity/frames` + presentation khi lấy phòng). Khi đối thủ vào phòng
hoặc khi thắng ván, site phát hiệu ứng cinematic theo khung; danh hiệu Game Hub
(Vua trò chơi khi thắng trên 100 trận, Đối mềm khi đấu từ 100 trận và thắng dưới
50) có hiệu ứng riêng — thêm danh hiệu mới chỉ cần khai báo ở
`src/config/game-titles.js` và `public/games/js/identity.js`.

Khi chạy production trên VPS:

1. Đặt `PUBLIC_APP_URL` là origin public đang map tới site games (ví dụ
   `https://hub.example.edu.vn` khi dùng `/games`, hoặc
   `https://games.example.edu.vn` nếu reverse proxy map `/games` vào root của
   hostname đó; để trống sẽ tạo link tương đối).
2. Proxy `/games`, `/api/entertainment/*`, `/api/identity/frames` và
   `/ws/community` về cùng app Node; dùng cấu hình Upgrade HTTP/1.1 trong file
   Nginx mẫu.
3. Giữ đúng một replica Node cho đến khi bổ sung pub/sub dùng chung; PostgreSQL
   là nguồn dữ liệu bền vững, còn membership/broadcast WebSocket hiện nằm trong
   process đang chạy.

Kiểm tra nhanh sau deploy:

```bash
curl -fsS https://games.example.edu.vn/api/entertainment/games
curl -fsS https://games.example.edu.vn/api/entertainment/rooms
```

Nếu cần nhiều replica, phải thay gateway in-memory bằng adapter pub/sub (Redis
hoặc PostgreSQL NOTIFY) trước khi scale ngang.

### Giới hạn topology WebSocket

Gateway WebSocket hiện giữ membership room và broadcast trong bộ nhớ của một
Node process. Vì vậy Compose này **phải chạy đúng một `bdu-hub` replica**;
không dùng `docker compose up --scale bdu-hub=...` hay nhiều worker Node cho đến
khi có shared pub/sub adapter. Compose đã đặt `deploy.replicas: 1` và
`container_name` để phản ánh ràng buộc đó. Sau deploy, kiểm tra chỉ có một app
container bằng `docker compose ps`; `/api/queue-status` cũng trả diagnostics
không nhạy cảm `communityRealtime` (topology, socket clients, active rooms).

### VPS đơn chạy app trực tiếp (PM2, không Docker)

Nếu không dùng Docker Compose mà chạy app trực tiếp trên VPS, dùng
`ecosystem.config.cjs`:

```bash
npm ci
npm run build:client
npx pm2 start ecosystem.config.cjs   # lần đầu
npx pm2 reload bdu-tu-hoc            # deploy lại
npx pm2 save && npx pm2 startup
```

Mặc định **đúng 1 worker** (`exec_mode: fork`) vì ràng buộc WebSocket nêu
trên. Chỉ nâng lên 2 worker (`WEB_CONCURRENCY=2`) khi đã chấp nhận realtime trễ
tới nhịp polling hoặc sau khi bổ sung pub/sub liên tiến trình; khi đó job nền
vẫn chỉ chạy ở worker 0 (`NODE_APP_INSTANCE`, xem `server.js`).

Một số điều chỉnh cho VPS đơn 2 vCPU / 4GB:

- **Pool DB**: `DATABASE_POOL_MAX` mặc định 20 (mỗi tiến trình); tổng = giá trị
  × số worker, giữ Postgres `max_connections` ≥ tổng + vài kết nối phụ trợ.
- **Rate limit**: `/api` có giới hạn chung, siết chặt hơn ở `/api/login`
  (chống dò mật khẩu) và các endpoint nặng (`/api/rankings`, `/api/odp`,
  `/api/vocab`) — xem `src/utils/rate-limit.js`.
- **Cache**: `SystemSettingsService` cache 5s (per-process); token BDU cache
  theo LRU có trần (`BDU_IDENTITY_CACHE_MAX`, mặc định 20000).
- **fb-import**: đã gỡ khỏi runtime (không còn scheduler/route/static). Service
  và script vẫn giữ ở dạng dormant, chỉ chạy tay khi cần (`npm run fb:login`,
  `npm run fb:import`).

Sau khi app lên, chạy đồng bộ bảng xếp hạng lần đầu:

```bash
docker compose exec bdu-hub npm run rankings:sync
```

Các lần sau scheduler tự chạy theo `RANKING_SYNC_HOUR` (mặc định 03:00,
Asia/Ho_Chi_Minh).

Công tắc đồng bộ nằm trong `/admin` → tab **System** → "Đồng Bộ Xếp Hạng Học
Tập". Thực tế chỉ cần bật quanh đợt công bố điểm/kết thúc kỳ nên có thể tắt
trong các tháng còn lại: bật/tắt **không kích hoạt chạy ngay**, chỉ ảnh hưởng
lần chạy 03:00 kế tiếp; khi tắt, sinh viên vẫn xem được snapshot gần nhất.
`RANKING_SYNC_ENABLED=false` trong `.env` là khoá cứng cấp deploy, luôn thắng
công tắc trong `/admin`. Mỗi lần đồng bộ thành công chỉ giữ lại
`RANKING_SNAPSHOT_RETENTION_RUNS` (mặc định 3) snapshot gần nhất để database
không phình; các run bỏ dở quá 6 giờ được tự đánh dấu thất bại.

Import dữ liệu ngữ pháp lên máy chủ (giống luyện từ vựng: local export SQL upsert
rồi nạp thẳng vào PostgreSQL prod, không copy dữ liệu crawl lên máy chủ):

```bash
# Trên máy local, sau khi đã crawl. grammar:import nạp cả dữ liệu crawl và
# các bộ luyện thêm trong data/grammar-practice-extra/ vào bảng riêng.
npm run db:migrate
npm run grammar:import
npm run grammar:export
scp data/grammar-export.sql deploy@<host>:/opt/bdu-tu-hoc/data/

# Trên máy chủ
cd ~/bdu-tu-hoc
cat data/grammar-export.sql | docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

### Cách 2: Sử dụng Docker CLI thuần
```bash
docker build -t bdu-tu-hoc:latest .
docker run -d -p 3000:3000 --name bdu-app bdu-tu-hoc:latest
```

---

## 🚦 CI (GitHub Actions)

Workflow nằm trong `.github/workflows/`:

| Workflow | Khi nào chạy | Việc làm |
| :--- | :--- | :--- |
| `ci.yml` | push hoặc PR lên `main` | Job `verify`: `npm run lint:frontend` → `npm run test:frontend` → `npm run test:node` → `npm run build:client`, rồi upload `dist/client` làm artifact (giữ 3 ngày). Job `docker`: build Docker image (`push: false`, `load: false`, cache GHA) để bắt lỗi Dockerfile trước khi triển khai. |

Chạy lại đúng chuỗi CI ở máy local:

```bash
npm run ci   # = lint:frontend && test:frontend && test:node && build:client
```

Lưu ý: `scripts/run-command.mjs` cố ý **fail-closed trên Windows** (chỉ hỗ trợ POSIX process-group cleanup), nên CI chạy trên `ubuntu-latest`. Nếu muốn chạy `scripts/verify-controller-split.mjs` hoặc `scripts/verify-route-order.mjs` thì hai script này chạy được ở mọi OS.

CI **không** deploy. Deploy thực hiện thủ công trên VPS (xem mục dưới).

---

## 🚀 Triển khai Production (VPS đơn)

Pipeline tự động cũ (GitHub Actions → GHCR → SSH EC2 qua `deploy/deploy.sh`) đã
được gỡ cùng thư mục `aws/`, `deploy/` và `docker-compose.aws.yml`. Production
giờ chạy trên **một VPS** bằng Docker Compose hoặc PM2 (xem mục “Đóng Gói &
Triển Khai Production” phía trên).

Deploy thủ công trên VPS, đúng thứ tự và dừng ngay khi một bước fail:

1. **preflight** — đã có `.env`, PostgreSQL phản hồi, working tree sạch.
2. **backup DB (bắt buộc)** — `npm run db:backup -- --pre-deploy`. Fail ⇒ **dừng, không migrate**.
3. **migrate** — đúng 1 lần. Fail ⇒ dừng, app cũ vẫn chạy, chưa restart.
4. **restart app** — `docker compose up -d` hoặc `npx pm2 reload bdu-tu-hoc`.
5. **healthcheck** — poll `/api/health` tới khi 200; fail thì rollback về image/bản build trước.

Migration **không** nằm trong `command` của container nữa, nên restart do sự cố hay reboot không vô tình chạy migration.

---

## 💾 Sao lưu & khôi phục Database

Production có **hai lớp** backup, cùng dựa trên `pg_dump --format=custom` rồi đẩy lên Cloudflare R2:

| Lớp | Chạy ở đâu | Khi nào |
| :--- | :--- | :--- |
| **Trước mỗi deploy** | Thủ công (`npm run db:backup -- --pre-deploy`) | Bắt buộc; backup fail thì dừng, không migrate |
| **Định kỳ** | Service Docker `bdu-db-backup` (`scripts/db-backup-scheduler.js`) | Hằng ngày theo `BACKUP_CRON` (mặc định `03:17` giờ máy) |

```bash
# Bật service backup định kỳ
docker compose up -d bdu-db-backup
docker compose logs -f bdu-db-backup

# Chạy thử một chu kỳ ngay
docker compose run --rm bdu-db-backup node scripts/db-backup-scheduler.js --once

# Backup thủ công
docker compose run --rm bdu-hub npm run db:backup -- --reason manual

# Xem trước retention 3 tầng (daily/weekly/monthly) rồi mới xoá
docker compose run --rm bdu-db-backup node scripts/db-backup-rotate.js --dry-run

# Restore drill: tải bản mới nhất từ R2 → restore vào database tạm → đếm bản ghi → xoá
docker compose run --rm \
  -e DRILL_DATABASE_URL='postgresql://bdu_admin:secret@postgres:5432/postgres' \
  bdu-hub npm run db:backup:verify
```

Biến cấu hình: `BACKUP_DATABASE_URL` (role chỉ đọc), `BACKUP_R2_BUCKET` (phải **khác** `R2_BUCKET`), `BACKUP_ENABLED=1`, `BACKUP_CRON`, `BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY`, `DRILL_DATABASE_URL` (role có `CREATEDB`). Chi tiết ở `.env.example` phần "Sao lưu PostgreSQL".

⚠️ **Restore drill quan trọng hơn việc "có file backup"**: một file `.dump` tồn tại trên R2 không chứng minh được bạn sẽ khôi phục được. Drill tải bản backup thật về, kiểm SHA-256, `createdb` → `pg_restore --exit-on-error` → `SELECT count(*)` trên 3 bảng cốt lõi → `dropdb`. Script **chặn cứng** không bao giờ restore vào production: tên database drill bắt buộc kết thúc bằng `_drill`, host phải nằm trong allowlist local (trừ khi có `ALLOW_REMOTE_DRILL=1`), và tên drill không được trùng `DATABASE_URL` của app lẫn `manifest.database`.

Image production đã có sẵn `postgresql-client` (cài trong `Dockerfile`) nên `pg_dump`/`pg_restore`/`createdb`/`dropdb` chạy được trong container.

Runbook đầy đủ: [`docs/backup-restore-runbook.md`](docs/backup-restore-runbook.md).

---

## 🗺️ Bản đồ kiến trúc

Tài liệu mô tả cấu trúc thật của repo và **quy tắc bất di bất dịch** khi sửa `src/`:

| Tài liệu | Nội dung |
| :--- | :--- |
| [`READFORME.md`](READFORME.md) | Bản đồ kiến trúc tổng thể: tầng, cấu trúc thư mục FE/BE, luồng dữ liệu. |
| [`docs/architecture.md`](docs/architecture.md) | Luồng `client → src/app.js → routes → controllers → services → db`, bảng 16 domain, 5 quy tắc bất di bất dịch, nợ kỹ thuật còn lại. |

---

## 🔒 Bảo Mật & Lưu Ý
* Hệ thống **không lưu trữ mật khẩu** sinh viên trên máy chủ.
* Phiên đăng nhập sử dụng **Bearer Token ngắn hạn** trao đổi trực tiếp với hệ thống máy chủ `sv.bdu.edu.vn`.
* API xếp hạng không nhận MSSV tự khai từ trình duyệt. MSSV được xác minh từ
  phiên BDU và API chỉ trả snapshot của chính sinh viên đang đăng nhập.
* Tài khoản CDS phục vụ job đồng bộ chỉ nằm trong biến môi trường; không commit
  vào Git. Snapshot toàn trường nằm trong PostgreSQL, không được public dưới
  dạng file JSON.
* Toàn bộ file tạm (upload/output) của công cụ Word được tự động dọn dẹp định kỳ.
