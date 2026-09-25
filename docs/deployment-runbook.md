# Runbook deploy — BDU Tự Học

Tài liệu này dành cho người trực hệ thống (vận hành VPS) và người deploy code.
Mọi lệnh trong tài liệu chạy **trên VPS**, trong thư mục app (mặc định `/opt/bdu-tu-hoc`).

## 1. Bức tranh tổng thể

| Cách deploy | Khi nào dùng | Ai chạy |
| --- | --- | --- |
| `deploy/deploy.sh` (thủ công) | VPS lỗi, Actions hỏng, cần kiểm tra lỗi nhanh | SSH vào VPS, tự gõ lệnh |
| GitHub Actions (tự động) | Bình thường: push lên `main` | Actions, qua SSH |

Cả hai đường đều chạy **cùng một script** là `deploy/deploy.sh`, nên không có
"deploy kiểu cũ" và "deploy kiểu mới" cho hai kết quả khác nhau.

### Migration không tự chạy khi restart nữa

Trước đây `docker-compose.yml` đặt:

```yaml
command: ["sh", "-c", "npm run db:migrate && npm start"]
```

Nghĩa là **mỗi lần** container khởi động lại (kể cả do crash, do reboot máy,
do người vận hành gõ `docker compose restart`) đều chạy migration. Giờ
`bdu-hub` chỉ còn `command: ["npm", "start"]`; migration chỉ chạy đúng **một
lần có kiểm soát** ở bước 3 của `deploy/deploy.sh`, **sau khi** backup DB đã
thành công. Nếu migration lỗi, app cũ vẫn chạy nguyên, không bị restart.

## 2. Cảnh báo: deploy là downtime vài giây

App chỉ chạy **đúng 1 replica** (`bdu-hub`), vì WebSocket và broadcast nằm
trong cùng một process Node. `docker compose up -d --build` dừng container cũ
rồi mới bật container mới, nên có một khoảng **vài giây không phục vụ**:

- Trang web: người dùng F5 hoặc chờ là lại.
- WebSocket: client báo mất kết nối rồi tự reconnect (có backoff).

Muốn zero-downtime thì phải tách WebSocket ra service riêng + thêm shared
pub/sub adapter (ví dụ Redis). Việc đó **chưa** làm, và nằm ngoài phạm vi
tài liệu này. Hãy báo người dùng trước giờ bảo trì nếu deploy vào giờ cao
điểm. `stop_grace_period: 40s` giúp Node đóng server và ngắt WebSocket cho
gọn thay vì bị Docker `SIGKILL` sau 10 giây.

## 3. Deploy thủ công bằng `deploy.sh`

```bash
ssh <user>@<vps-host>
cd /opt/bdu-tu-hoc

# 1) xem trạng thái hiện tại (nên làm trước mỗi lần deploy)
git log -1 --oneline
docker compose ps

# 2) chạy deploy (mặc định lấy HEAD hiện tại trên VPS)
bash deploy/deploy.sh

# nếu muốn deploy một commit cụ thể mà VPS chưa có:
git fetch --prune origin
git checkout <short-sha>          # hoặc để script tự fetch: xem DEPLOY_SHA
DEPLOY_SHA=<full-sha> bash deploy/deploy.sh
```

Script tự làm theo đúng thứ tự này:

1. **preflight** — `docker compose version` OK, có file `.env`, PostgreSQL
   phản hồi (`pg_isready`), git không có file đã sửa cục bộ.
2. **backup DB (bắt buộc)** — `npm run db:backup` với nhãn `pre-deploy`.
   **Backup lỗi → dừng ngay, không migrate, không restart app.**
3. **migrate (đúng 1 lần)** — `docker compose run --rm --no-deps bdu-hub npm run db:migrate`.
   **Lỗi → dừng, app cũ vẫn chạy, không restart.**
4. **up** — `BUILD_ID=<short-sha> docker compose up -d --build --remove-orphans`.
5. **healthcheck** — poll `http://127.0.0.1:3000/api/health` tối đa 90 giây,
   mỗi 3 giây. Lỗi → in hướng dẫn rollback rồi exit 1.
6. **in hướng dẫn rollback** kèm lệnh cụ thể (xem mục 5).

Mọi dòng log đều có timestamp UTC, ví dụ:

```
[2026-09-25T09:14:02Z] [deploy] Bước 2/5: backup DB (bắt buộc trước khi migrate)
[2026-09-25T09:14:31Z] [deploy]   Backup xong. File mới nhất: data/backup-20260925T091402Z.sql
[2026-09-25T09:14:32Z] [deploy] Bước 3/5: migrate (1 lần duy nhất, sau khi backup thành công)
[2026-09-25T09:14:40Z] [deploy]   Migration xong.
[2026-09-25T09:14:41Z] [deploy] Bước 4/5: docker compose up -d --build (BUILD_ID=4662e44570ce)
[2026-09-25T16:15:20Z] [deploy]   App healthy sau 3 lần poll. Deploy hoàn tất.
```

### Biến môi trường của `deploy.sh`

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `DEPLOY_SHA` | `HEAD` hiện tại | Commit muốn deploy (bắt buộc là SHA hex) |
| `DEPLOY_SYNC` | `1` | `1` = fetch + checkout về `DEPLOY_SHA`; `0` = dùng code đang có trên đĩa |
| `BACKUP_ARGS` | tự dò | Đè cờ truyền cho `npm run db:backup`, ví dụ `"--reason pre-deploy"` |
| `VPS_APP_DIR` | `/opt/bdu-tu-hoc` | Thư mục app trên VPS |
| `HEALTH_URL` | `http://127.0.0.1:3000/api/health` | Endpoint kiểm tra sức khoẻ |
| `HEALTH_TIMEOUT_SECONDS` | `90` | Tổng thời gian chờ app healthy |
| `HEALTH_INTERVAL_SECONDS` | `3` | Nhịp giữa hai lần poll |

### Cờ truyền cho `npm run db:backup`

Deploy cần backup bắt buộc trước mỗi lần migrate. `deploy.sh` gọi
`npm run db:backup -- --pre-deploy`; nếu `scripts/db-backup.js` bản đang chạy
lại hỗ trợ dạng `--reason <nhãn>` (hiện tại `db-backup.js` yêu cầu `--reason`),
script tự dò qua `--help` và dùng đúng dạng được hỗ trợ, đồng thời in ra dòng
`Cờ backup: ...` để bạn thấy nó gọi gì. Muốn chỉ định tay:

```bash
BACKUP_ARGS="--reason pre-deploy" bash deploy/deploy.sh
```

Script backup hiện tại yêu cầu:

| Cần | Vì sao |
| --- | --- |
| `BACKUP_DATABASE_URL` trong `.env` | Role backup **chỉ đọc**, không fallback về `DATABASE_URL` |
| `BACKUP_R2_BUCKET` trong `.env` | Bucket R2 riêng cho backup, upload + verify trước khi coi là thành công |
| `pg_dump` **trong image** | Backup chạy trong container `bdu-hub`, nên image phải có `postgresql-client` |

> **Lưu ý trước khi bật deploy tự động:** `Dockerfile` hiện **không** cài
> `postgresql-client`, nên container `bdu-hub` chưa có `pg_dump` và bước 2 sẽ
> fail (dừng an toàn, app không bị restart). Cần cài `pg_dump` vào image, hoặc
> đổi bước 2 sang chạy backup từ ngoài container (ví dụ trong container
> `postgres`, hoặc từ cron trên host). `deploy.sh` cố ý **fail ở bước 2** thay vì
> bỏ qua backup rồi migrate.

Script **không bao giờ in `DATABASE_URL` hay mật khẩu**. Các thao tác DB đều
chạy bên trong container, nên credential chỉ nằm trong env của container.

### Script chặn deploy khi nào

| Tình huống | Hành vi |
| --- | --- |
| Không có `docker compose` v2 | Dừng ở bước 1 |
| Thiếu `.env` | Dừng ở bước 1 |
| PostgreSQL không phản hồi | Dừng ở bước 1 |
| Có file tracked bị sửa tay trên VPS | Dừng ở bước 1 (tránh build nhầm code ngoài git) |
| Backup lỗi | Dừng ở bước 2, **không** migrate |
| Migration lỗi | Dừng ở bước 3, app cũ vẫn chạy |
| Healthcheck lỗi | In hướng dẫn rollback, exit 1 |

## 4. Deploy qua GitHub Actions

Push lên `main` là workflow `.github/workflows/deploy.yml` tự chạy:

1. Job **build** — build thử image (`push: false`, `load: false`,
   `cache-from/to: type=gha`) để bắt lỗi Dockerfile trước khi đụng VPS.
2. Job **deploy** — SSH vào VPS, chạy `bash deploy/deploy.sh` với
   `DEPLOY_SHA=<commit vừa push>`.

Job deploy **chỉ chạy khi ref là `main`**. Không `needs` CI khác để tránh vòng
phụ thuộc; muốn bắt buộc CI phải xanh thì dùng `workflow_run`.

Deploy thủ công: tab **Actions → Deploy VPS → Run workflow**, chọn nhánh `main`,
và (tuỳ chọn) điền input `ref` với một commit cụ thể đã nằm trong `main`. Nếu
điền ref không thuộc lịch sử `main`, workflow fail với thông báo rõ ràng.

### Secrets cần thiết

Settings → Secrets and variables → Actions (repository hoặc environment):

| Secret | Ví dụ | Bắt buộc |
| --- | --- | --- |
| `VPS_HOST` | `203.0.113.10` | Có |
| `VPS_USER` | `deploy` (user riêng, không nên là `root`) | Có |
| `VPS_SSH_PRIVATE_KEY` | private key (deploy key) | Có |
| `VPS_APP_DIR` | `/opt/bdu-tu-hoc` | Có |
| `VPS_SSH_PORT` | `22` | Không (mặc định 22) |

**`.env` production không nằm trong secrets.** Nó nằm trên VPS và chỉ được đọc
tại chỗ bởi `deploy.sh` + `docker compose`. Secrets ở đây chỉ là thông tin SSH.

### Nếu muốn deploy phải được duyệt tay

Thêm `environment: production` vào job `deploy`, rồi trong
Settings → Environments tạo environment `production` với required reviewers.
Việc này không bắt buộc nhưng nên làm khi deploy có thể ảnh hưởng dữ liệu.

## 5. Rollback

Deploy fail ở bước 1–3 thì **app cũ vẫn đang chạy** — chưa cần làm gì thêm,
chỉ sửa nguyên nhân rồi chạy lại `deploy.sh`.

Chỉ khi bước 4 đã lên code mới mà app không khoẻ (bước 5 fail) thì cần
rollback. Trường hợp này script đã in sẵn đúng lệnh cần chạy, với `<sha-cu>` và
`<duong-dan-file-backup>` đã điền sẵn:

```bash
# 1) Quay code về bản đang chạy tốt
cd /opt/bdu-tu-hoc
git fetch --prune origin
git checkout --detach <sha-cu>

# 2) Dựng lại app (KHÔNG migrate)
docker compose up -d --build --remove-orphans
docker compose logs --tail=100 bdu-hub

# 3) CHỈ khi migration đã chạy và dữ liệu sai, mới khôi phục DB
#    Bản backup bền của lần deploy vừa rồi nằm ở bucket BACKUP_R2_BUCKET,
#    object có reason=pre-deploy. Tải object đó về VPS trước (file .dump),
#    hoặc dùng file local nếu deploy.sh báo còn trên đĩa.
ls -1t data/backups/*.dump data/*.dump backups/*.dump 2>/dev/null | head -n 10
docker compose run --rm -e BDU_MAINTENANCE_ALLOW_PRODUCTION=1 bdu-hub \
  npm run db:restore -- <duong-dan-file-backup> --allow-production --yes
```

Cần chạy lại healthcheck sau khi rollback:

```bash
curl -i http://127.0.0.1:3000/api/health
```

### Rollback nhanh: chỉ lỗi code, không đụng DB

Nếu migration chạy xong nhưng app mới lỗi code (không phải lỗi schema), chỉ cần
bước 1 + bước 2 ở trên. **Không** restore DB: schema đã được migrate thì để
mở nó, code cũ thường vẫn chạy được.

### Rollback có mất dữ liệu người dùng không?

Có. Nếu đã restore DB thì mọi ghi từ lúc backup tạo đến lúc restore đều mất.
Vì vậy hãy restore **càng sớm càng tốt** và chỉ khi thật sự cần.

## 6. Đọc log

```bash
# Log app (không theo dõi)
docker compose logs --tail=200 bdu-hub

# Theo dõi trực tiếp
docker compose logs -f bdu-hub

# Chỉ log của lần restart gần nhất
docker compose logs --since=10m bdu-hub

# Log của service khác
docker compose logs --tail=100 postgres
docker compose logs --tail=100 bdu-notifier-bot
```

Cách đọc nhanh:

- **Deploy fail ở đâu** — dòng cuối cùng của log script cho biết bước; ví dụ
  `LỖI: Backup DB thất bại...` = hỏng bước 2.
- **App không healthy** — luôn xem `docker compose logs --tail=200 bdu-hub`
  trước khi quyết định rollback. Thường là thiếu biến môi trường trong `.env`.
- **WebSocket rớt liên tục** — kiểm tra `WS_ALLOWED_ORIGINS` (origin phải khớp
  chính xác) và `WS_TRUST_PROXY`.
- **Có biết đang chạy bản nào không** — `curl -s http://127.0.0.1:3000/api/version`
  trả về build id (12 ký tự đầu của commit) của bản đang chạy.
- **Xem cả container có khoẻ không** — `docker compose ps`. Cột `STATUS` phải
  là `healthy` sau khoảng 60 giây (đó là `start_period` của healthcheck).

## 7. Bảo trì định kỳ

- Xem các bản backup trên VPS và copy ra nơi khác (R2 nếu đã bật
  `BACKUP_R2_BUCKET`; nếu không thì copy file `.sql` ra máy khác theo tay).
- Nên bật `BACKUP_ENABLED=true` trên production để có backup định kỳ, không
  phụ thuộc vào lần deploy.
- `docker image prune -f` + `docker system df` khi VPS sắp đầy đĩa.
- Kiểm tra `git fetch --dry-run` định kỳ để chắc deploy key của user deploy
  vẫn có quyền đọc repo private.

## 8. File liên quan

| File | Vai trò |
| --- | --- |
| `deploy/deploy.sh` | Script deploy chạy trên VPS (thủ công và qua Actions đều dùng) |
| `.github/workflows/deploy.yml` | Workflow build thử + deploy qua SSH |
| `.github/workflows/ci.yml` | Lint/test/build image (không deploy) |
| `docker-compose.yml` | `bdu-hub`: `command: ["npm","start"]`, `stop_grace_period`, `healthcheck` |
| `.env.example` | Danh sách biến môi trường, gồm nhóm biến backup |
| `deploy/caddy`, `deploy/nginx` | Ví dụ cấu hình reverse proxy (chỉ là file mẫu) |
