# Runbook deploy — BDU Tự Học (AWS EC2)

Tài liệu này dành cho người trực hệ thống và người deploy code. Mọi lệnh chạy
**trên EC2**, trong thư mục app (mặc định `/opt/bdu-tu-hoc`).

Hạ tầng do `aws/infra.sh` dựng (xem `aws/README.md`). Thiết kế đầy đủ ở
[`docs/superpowers/specs/2026-10-13-dung-server-aws-design.md`](superpowers/specs/2026-10-13-dung-server-aws-design.md).

## 1. Bức tranh tổng thể

| Cách deploy | Khi nào dùng | Ai chạy |
| --- | --- | --- |
| `deploy/deploy.sh` (thủ công) | EC2 lỗi, Actions hỏng, cần kiểm tra nhanh | SSH vào EC2, tự gõ lệnh |
| GitHub Actions (tự động) | Bình thường: push lên `main` | Actions: build image → GHCR → SSH vào EC2 |

Điểm khác biệt so với mô hình cũ: **EC2 không build image**. GitHub Actions
build rồi đẩy lên GHCR với tag = 12 ký tự đầu của commit; EC2 chỉ `pull` theo
`IMAGE_TAG`. Lý do: máy `t3a.small` (2 GB RAM) sẽ OOM khi build image có
Chromium + .NET. Vì vậy **mọi lệnh `docker compose up` trên EC2 phải kèm
`--no-build`**, và commit muốn deploy phải tồn tại image trên GHCR.

### Migration không tự chạy khi restart

`bdu-hub` chỉ có `command: ["npm", "start"]`; migration chạy đúng **một lần có
kiểm soát** ở bước 3 của `deploy/deploy.sh`, **sau khi** backup DB thành công.
Nếu migration lỗi, app cũ vẫn chạy nguyên, không bị restart.

## 2. Cảnh báo: deploy là downtime vài giây

App chạy **đúng 1 replica** (`bdu-hub`), vì WebSocket và broadcast nằm trong
cùng một process Node. `docker compose up -d` dừng container cũ rồi mới bật
container mới nên có vài giây không phục vụ: trang web cần F5, WebSocket tự
reconnect (có backoff). `stop_grace_period: 40s` giúp Node đóng server gọn gàng.

Muốn zero-downtime thì phải tách WebSocket ra service riêng + shared pub/sub
(Redis) — **chưa** làm, ngoài phạm vi tài liệu này.

## 3. Bootstrap lần đầu (chỉ chạy một lần)

Máy mới (sau `aws/infra.sh deploy`) chưa có code, `.env` hay dữ liệu. Chạy
`deploy/bootstrap-server.sh` **một lần** trên EC2; script này:

1. Kiểm tra swap, Docker, Compose; từ chối chạy lại nếu DB đã có ledger.
2. `git clone` repo vào `APP_DIR`, checkout đúng SHA.
3. Kiểm `.env` có đủ nhóm biến bắt buộc (không in giá trị).
4. `docker compose up -d postgres` rồi nạp dump `data/vps_sync_20260919.sql`
   bằng `psql` trong container `postgres`.
5. Chốt mốc migration bằng **fingerprint**: so `fingerprint(bdu_hub)` với
   `fingerprint(bdu_fresh)` (DB rác migrate 001→056); dừng nếu lệch.
6. `docker compose up -d --no-build` và kiểm `/api/health`.

Mốc `BDU_MIGRATION_BASELINE_THROUGH_VERSION` thực tế đã dùng được ghi ở
`aws/README.md`. Nguyên tắc: **chỉ migrate khi hai fingerprint trùng khít.**

## 4. Deploy thủ công bằng `deploy.sh`

```bash
ssh -i aws/bdu-tu-hoc-deploy.pem deploy@<EIP>
cd /opt/bdu-tu-hoc

# 1) xem trạng thái hiện tại (nên làm trước mỗi lần deploy)
git log -1 --oneline
docker compose ps

# 2) chạy deploy (mặc định lấy HEAD hiện tại trên EC2)
bash deploy/deploy.sh

# deploy một commit cụ thể (image của commit đó phải đã có trên GHCR)
DEPLOY_SHA=<full-sha> bash deploy/deploy.sh
```

Script làm theo đúng thứ tự:

1. **preflight** — `docker compose` OK, có `.env`, PostgreSQL phản hồi, git sạch.
2. **kéo image** cho `DEPLOY_SHORT_SHA` từ GHCR (fail ⇒ dừng).
3. **backup DB (bắt buộc)** — `npm run db:backup -- --pre-deploy`.
   Fail ⇒ dừng ngay, không migrate, không restart app.
4. **migrate (đúng 1 lần)**. Fail ⇒ dừng, app cũ vẫn chạy.
5. **pull + up** — `docker compose pull` rồi `up -d --no-build`.
6. **healthcheck** — poll `http://127.0.0.1:3000/api/health` tối đa 90 giây,
   mỗi 3 giây. Fail ⇒ in hướng dẫn rollback rồi exit 1.

### Biến môi trường của `deploy.sh`

| Biến | Mặc định | Ý nghĩa |
| --- | --- | --- |
| `DEPLOY_SHA` | `HEAD` hiện tại | Commit muốn deploy (bắt buộc là SHA hex) |
| `DEPLOY_SYNC` | `1` | `1` = fetch + checkout về `DEPLOY_SHA`; `0` = dùng code trên đĩa |
| `BACKUP_ARGS` | tự dò | Đè cờ truyền cho `npm run db:backup` |
| `APP_DIR` | `/opt/bdu-tu-hoc` | Thư mục app trên EC2 |
| `HEALTH_URL` | `http://127.0.0.1:3000/api/health` | Endpoint kiểm tra sức khoẻ |
| `HEALTH_TIMEOUT_SECONDS` | `90` | Tổng thời gian chờ app healthy |
| `HEALTH_INTERVAL_SECONDS` | `3` | Nhịp giữa hai lần poll |

### Script chặn deploy khi nào

| Tình huống | Hành vi |
| --- | --- |
| Không có `docker compose` v2 / thiếu `.env` / PostgreSQL không phản hồi | Dừng ở bước 1 |
| Có file tracked bị sửa tay trên EC2 | Dừng ở bước 1 |
| Không kéo được image của SHA | Dừng ở bước 2 |
| Backup lỗi | Dừng ở bước 3, **không** migrate |
| Migration lỗi | Dừng ở bước 4, app cũ vẫn chạy |
| Healthcheck lỗi | In hướng dẫn rollback, exit 1 |

## 5. Deploy qua GitHub Actions

Push lên `main` là `.github/workflows/deploy.yml` tự chạy:

1. Job **build** — build image, đăng nhập GHCR và **đẩy** tag
   `ghcr.io/vdat293/bdu-tu-hoc:<12 ký tự SHA>`.
2. Job **deploy** — SSH vào EC2 chạy `deploy/deploy.sh` với
   `DEPLOY_SHA=<commit vừa push>`.

Job deploy **chỉ chạy khi ref là `main`**. Deploy thủ công: tab
**Actions → Deploy EC2 → Run workflow**.

### Secrets cần thiết

Settings → Secrets and variables → Actions:

| Secret | Ví dụ | Bắt buộc |
| --- | --- | --- |
| `AWS_HOST` | `47.131.6.108` (Elastic IP) | Có |
| `AWS_USER` | `deploy` | Có |
| `AWS_SSH_PRIVATE_KEY` | private key của key pair `bdu-tu-hoc-deploy` | Có |
| `AWS_APP_DIR` | `/opt/bdu-tu-hoc` | Có |
| `AWS_SSH_PORT` | `22` | Không (mặc định 22) |

**`.env` production không nằm trong secrets.** Nó nằm trên EC2 và chỉ được đọc
tại chỗ bởi `deploy.sh` + `docker compose`.

Lưu ý: Actions dùng chung tài khoản GitHub của repo; nếu tài khoản bị khoá
(billing), job không chạy được và phải deploy thủ công theo mục 4.

## 6. Rollback

Deploy fail ở bước 1–4 thì **app cũ vẫn chạy**; chỉ cần sửa nguyên nhân rồi chạy
lại. Chỉ khi bước 5 đã lên code mới mà app không khoẻ mới cần rollback:

```bash
# 1) chọn lại tag image cũ trong .env (IMAGE_TAG=<12 ký tự SHA cũ>)
cd /opt/bdu-tu-hoc
sed -i 's/^IMAGE_TAG=.*/IMAGE_TAG=<short-sha-cu>/' .env

# 2) kéo + dựng lại, KHÔNG build, KHÔNG migrate
docker compose pull && docker compose up -d --no-build --remove-orphans
docker compose logs --tail=100 bdu-hub

# 3) nếu muốn quay cả code về commit cũ
git fetch --prune origin && git checkout --detach <full-sha-cu>
```

Cảnh báo: rollback chỉ quay **code/image**. Dữ liệu đã ghi bởi bản mới vẫn nằm
trong DB; chỉ khôi phục DB khi thật sự cần (xem mục 7) và chấp nhận mất dữ liệu
ghi sau mốc backup.

## 7. Backup & khôi phục

| Việc | Lệnh / cách |
| --- | --- |
| Backup thủ công | `docker compose run --rm --no-deps bdu-hub npm run db:backup -- --reason manual` (dump ra `data/backups/`) |
| Kiểm backup khôi phục được | `docker compose run --rm --no-deps bdu-hub npm run db:backup:verify` (cần `BACKUP_R2_BUCKET` + `DRILL_DATABASE_URL`) |
| Backup định kỳ | service `bdu-db-backup` với `BACKUP_ENABLED=1`, lịch qua `BACKUP_CRON` (dump ra `data/backups/`) |
| Snapshot đĩa | DLM `bdu-tu-hoc-snapshots`, 1 bản/ngày, giữ 7 (`aws/infra.sh status` để xem ID) |
| Khôi phục DB | `BDU_MAINTENANCE_ALLOW_PRODUCTION=1 docker compose run --rm bdu-hub npm run db:restore -- <file> --allow-production --yes` |

Chi tiết quy trình restore/verify: [`docs/backup-restore-runbook.md`](backup-restore-runbook.md).

## 8. Đọc log

```bash
docker compose logs --tail=200 bdu-hub      # log app
docker compose logs -f bdu-hub              # theo dõi trực tiếp
docker compose logs --tail=100 caddy        # log TLS / proxy
docker compose logs --tail=100 postgres
docker compose logs --tail=100 bdu-notifier-bot
docker compose ps                           # cột STATUS phải healthy
```

Cách đọc nhanh:

- **Deploy fail ở đâu** — dòng cuối log script cho biết bước; ví dụ
  `LỖI: Backup DB thất bại...` = hỏng bước 3.
- **App không healthy** — luôn xem `docker compose logs --tail=200 bdu-hub`
  trước khi rollback; thường là thiếu biến trong `.env`.
- **Lỗi 502/526 qua Cloudflare** — kiểm `docker compose logs caddy` và mode
  SSL/TLS của Cloudflare (phải là **Full (strict)** với Origin Certificate).
- **WebSocket rớt liên tục** — kiểm `WS_ALLOWED_ORIGINS` (phải khớp chính xác
  `https://sv.bdu.io.vn`) và `WS_TRUST_PROXY`.
- **Đang chạy bản nào** — `curl -s https://sv.bdu.io.vn/api/version`.

## 9. Bảo trì định kỳ

- Đĩa gần đầy: `docker image prune -f` rồi `docker system df`.
- Kiểm snapshot DLM còn tạo đều: `aws dlm get-lifecycle-policies` và
  `aws ec2 describe-snapshots --owner-ids self`.
- Origin Certificate hết hạn sau 15 năm; gia hạn thủ công trên Cloudflare.
- Rà soát chi phí: Cost Explorer (trần ~24 USD/tháng).
- Giữ cổng 22 chỉ nhận SSH key; nếu không còn dùng GitHub Actions, thu hẹp
  `22` về IP của bạn trong Security Group `bdu-tu-hoc-sg`.

## 10. File liên quan

| File | Vai trò |
| --- | --- |
| `aws/infra.sh`, `aws/cleanup.sh`, `aws/README.md` | Dựng/dọn hạ tầng AWS |
| `deploy/bootstrap-server.sh` | Bootstrap một lần (clone, `.env`, nạp dump, baseline, up) |
| `deploy/deploy.sh` | Script deploy chạy trên EC2 (thủ công và qua Actions) |
| `deploy/caddy/Caddyfile`, `deploy/caddy/certs/` | Reverse proxy + Origin Certificate |
| `docker-compose.yml`, `docker-compose.aws.yml` | Stack và override chỉ dùng trên EC2 |
| `.github/workflows/deploy.yml` | Build & push GHCR + deploy qua SSH |
| `.github/workflows/ci.yml` | Lint/test/build (không deploy) |
| `.env.example` | Danh sách biến môi trường |
