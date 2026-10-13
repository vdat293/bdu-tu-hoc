# Spec — Dựng lại server production trên AWS (EC2 + Docker Compose)

**Ngày:** 2026-10-13
**Trạng thái:** chờ duyệt (chưa implement)
**Phạm vi:** hạ tầng AWS và quy trình triển khai. **Không sửa code ứng dụng**
(`server.js`, `src/`, `client/`, `migrations/` giữ nguyên).
**Kế thừa:** kế thừa các quyết định trong **Phụ lục A** của
[`2026-10-12-khoa-dich-vu-bao-tri-design.md`](2026-10-12-khoa-dich-vu-bao-tri-design.md),
có ghi rõ các điểm điều chỉnh ở mục 4.4.

---

## 1. Bối cảnh

VPS cũ đã bị xoá **hoàn toàn**: không còn server để dump dữ liệu, không còn
đường rollback về VPS, không có môi trường chạy song song. AWS trở thành
**môi trường production duy nhất** và phải dựng từ số 0.

Hiện trạng đã kiểm tra trực tiếp bằng AWS API ngày **2026-10-13**:

| Hạng mục | Kết quả |
| --- | --- |
| Tài khoản | `143784554304` (đăng nhập bằng `root`) |
| Region | `ap-southeast-1` (Singapore) |
| EC2 instance | 0 |
| EBS volume | 0 |
| Elastic IP | 0 |
| Security Group | 0 |
| VPC | **0 — không hề có default VPC** |
| Subnet | 0 |
| Key pair | 0 |
| EBS snapshot | 0 |
| DLM lifecycle policy | 0 |
| `t3a.small` khả dụng tại `ap-southeast-1` | **Có** (`t3a.small`, `t3.small`, `t3a.medium` đều có) |

Ba hệ quả trực tiếp:

1. **Phải tự tạo VPC.** Phụ lục A chốt "dùng default VPC" — không còn đúng,
   vì tài khoản không có VPC nào. Giải pháp ở mục 4.4 dùng VPC riêng **không
   NAT Gateway**, giữ nguyên mục tiêu tiết kiệm.
2. **Dữ liệu mới nhất là bản 2026-09-20.** File `data/vps_sync_20260919.sql`
   (89 MB) là bản dump mới nhất còn lại. **Mọi dữ liệu ghi sau 20/09/2026 đã
   mất cùng VPS.**
3. **Media R2 còn hi vọng nhưng chưa xác minh.** Bucket R2 nằm phía Cloudflare,
   không bị xoá theo VPS, nhưng biến `R2_*` **không có trong `.env` local** nên
   phải tạo lại API token. Việc xác minh bucket là bước bắt buộc khi bootstrap.

### 1.1. Đầu vào phải cấp khi thực thi

Các giá trị dưới đây **không** nằm trong repo; phải có trước khi chạy bootstrap:

| Đầu vào | Nguồn |
| --- | --- |
| Domain `sv.bdu.io.vn` | đã có, DNS đang ở Cloudflare |
| Cloudflare Origin Certificate (`origin.pem` + `origin.key`) | tạo trong Cloudflare Dashboard |
| `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` | Cloudflare Dashboard → R2 (tạo API token mới) |
| `ADMIN_DASHBOARD_KEY` | sinh mới: `openssl rand -base64 32` |
| `NOTIFICATION_ENCRYPTION_KEY` | dùng lại `.env` local **nếu chắc chắn là key production**, ngược lại sinh mới |
| `SMTP_*`, `MAIL_FROM` | cấp lại |
| `BACKUP_DATABASE_URL`, `BACKUP_R2_BUCKET` | tạo tại chỗ (xem 6.3) |
| GHCR read token (PAT `read:packages`) | GitHub → Settings → Developer settings |

Các giá trị **đã có sẵn** trong `.env` local và dùng lại được:
`POSTGRES_*`, `CDS_USER`, `CDS_PASSWORD`, `DISCORD_*` (gồm `DISCORD_BOT_TOKEN`),
`PUBLIC_APP_URL`, `WS_*`, `SYSTEM_OWNER_MSSV`, `FB_IMPORT_*`.

---

## 2. Ý định đã xác nhận

| | |
| :--- | :--- |
| **Kết quả** | Website BDU Tự Học chạy production trên AWS tại `https://sv.bdu.io.vn`, với đầy đủ dữ liệu khôi phục từ bản dump 20/09, và mọi dấu vết VPS cũ được dọn khỏi repo. |
| **Ai dùng** | Sinh viên BDU (qua domain), chủ sở hữu (vận hành qua SSH/Actions, admin qua `/admin`). |
| **Vì sao bây giờ** | VPS đã bị xoá, website hiện không có chỗ chạy. |
| **Thành công** | 12 tiêu chí nghiệm thu ở mục 12 đều đạt; dữ liệu truy vấn được; realtime + WebSocket hoạt động; bot Discord online; backup lên R2 chạy được; cổng 3000/5432 không lộ từ Internet. |
| **Ràng buộc** | Ngân sách < 30 USD/tháng; không sửa code ứng dụng; giữ quy trình deploy có backup-trước-migrate; `deploy/deploy.sh` là đường deploy duy nhất. |
| **Ngoài phạm vi** | Zero-downtime deploy; HA/multi-AZ; chuyển sang RDS; tách WebSocket sang service riêng; mở lại FB import; CI pass gate (`workflow_run`). |

---

## 3. Bằng chứng hiện trạng liên quan dữ liệu

| Bằng chứng | Giá trị |
| --- | --- |
| `data/vps_sync_20260919.sql` | 89.137.219 byte; sửa đổi 2026-09-20 00:37; header `PostgreSQL database dump`, `pg_dump version 16.15` |
| Nội dung dump | 61 lệnh `CREATE TABLE`; có `DROP TABLE IF EXISTS` (nạp đè được); **không** có `CREATE DATABASE`/`\connect`; **không** có bảng `public.schema_migrations` |
| Hệ quả ledger | Vì dump **không** có ledger, `db:migrate` sẽ coi DB là "trống ledger" ⇒ **bắt buộc baseline** trước khi migrate (mục 7) |
| `data/backup.sql` | 7.429.201 byte, 2026-09-04 — bản cũ/nhỏ hơn, **không dùng** |
| `data/avatars/`, `data/fb-import/` | **rỗng** (0 file) — không có media local phải mang |
| `data/grammar-practice-extra/` | 41 file JSON (~1,03 MB) — nguồn import, sẽ copy sang EC2 |
| `data/fb-profile/` | 511 file (74,7 MB) — profile Playwright, **không** cần |
| `data/client-assets/` | 434 file (9,17 MB) — chunk build cũ, tuỳ chọn, mặc định bỏ |
| `\restrict` trong dump | Meta-command của `psql` mới → nạp bằng `psql` trong container `postgres:16-alpine`, không dùng `npm run db:restore` |

---

## 4. Kiến trúc

### 4.1. Sơ đồ

```
Cloudflare (proxy ON, SSL Full strict)
        │  https://sv.bdu.io.vn
        ▼
Elastic IP  →  EC2 t3a.small  (Ubuntu 24.04 LTS, x86_64, ap-southeast-1a)
                default VPC thay thế: VPC bdu-tu-hoc 10.20.0.0/16
                └─ public subnet 10.20.1.0/24 → IGW (KHÔNG NAT Gateway)
                   Docker Compose stack:
                     • caddy  (caddy:2-alpine — TLS + reverse_proxy toàn bộ)
                     • bdu-hub (image GHCR, Express + static + WebSocket)
                     • postgres (postgres:16-alpine + named volume)
                     • bdu-notifier-bot (Discord)
                     • bdu-db-backup (scheduler pg_dump → R2)
```

### 4.2. Thành phần

| Service | Image | Vai trò |
| --- | --- | --- |
| `caddy` | `caddy:2-alpine` (chính thức) | Nhận 80/443, TLS bằng Origin Certificate, `reverse_proxy` **toàn bộ** request (static + API + WebSocket) về `bdu-hub:3000` |
| `bdu-hub` | `ghcr.io/vdat293/bdu-tu-hoc:<sha>` (build ở CI) | Express: API, phục vụ `dist/client`, WebSocket |
| `postgres` | `postgres:16-alpine` | DB, named volume `bdu-postgres-data` (giữ tên như hiện tại) |
| `bdu-notifier-bot` | `ghcr.io/vdat293/bdu-tu-hoc:<sha>` | Bot Discord (`scripts/discord-bot.js`) |
| `bdu-db-backup` | `ghcr.io/vdat293/bdu-tu-hoc:<sha>` | Scheduler `db-backup-scheduler.js`, đẩy dump lên R2 |

Không đổi tên service hiện có (`postgres`, `bdu-hub`, `bdu-notifier-bot`,
`bdu-db-backup`) để tránh phải sửa `deploy.sh`, `DATABASE_URL`, runbook.
Service `caddy` là mới.

### 4.3. Chi phí (giá thật `ap-southeast-1`, on-demand)

| Hạng mục | Tính toán | USD/tháng |
| --- | --- | --- |
| EC2 `t3a.small` | 0,0236 × 730 giờ | 17,23 |
| EBS gp3 30 GB | 0,096 × 30 | 2,88 |
| Public IPv4 (Elastic IP) | 0,005 × 730 | 3,65 |
| EBS snapshot (DLM, ~5 GB tăng dần) | 0,05 × 5 | 0,25 |
| **Tổng** | | **~24** |

Egress ra Cloudflare tính theo bảng bậc thang (~0,12 USD/GB cho 10 TB đầu);
lưu lượng thực tế thấp. GHCR miễn phí cho repo này. **Tổng vẫn dưới 30 USD.**
(Phụ lục A ước ~22 USD với 20 GB gp3; ở đây nâng lên 30 GB, xem 4.4.)

### 4.4. Điều chỉnh so với Phụ lục A

| Điểm | Phụ lục A | Spec này | Lý do |
| --- | --- | --- | --- |
| VPC | "default VPC" | **Tạo VPC riêng** `10.20.0.0/16`, 1 public subnet, IGW, không NAT | Tài khoản **không có VPC nào** (đã kiểm 2026-10-13); VPC riêng cho teardown sạch và tagging rõ, chi phí bằng default VPC |
| Dung lượng đĩa | 20 GB gp3 | **30 GB gp3** (+0,96 USD) | Chứa Docker images (~5 GB), DB đã restore, file dump khi backup, swap 2 GB; 20 GB dễ đầy khi deploy |
| Cổng 22 | "chỉ mở IP chủ sở hữu" | **Mở `0.0.0.0/0`**, chỉ chấp nhận SSH key | Đã chốt với chủ sở hữu: cần GitHub Actions SSH tự động. Bù lại: tắt password auth, tắt root login, fail2ban, unattended-upgrades |
| TLS | "proxy ON + Caddy Let's Encrypt" (mâu thuẫn) | **proxy ON + Cloudflare Origin Certificate**, Full (strict) | ACME HTTP-01 bị Cloudflare chặn khi proxy ON; Origin Cert là cách đúng. Đã chốt |
| Static ở `fe` | "`file_server` cho `dist/client`" | **`caddy` reverse_proxy toàn bộ** về `bdu-hub` | Express đã phục vụ static cùng origin như VPS; tránh phải build/pull image thứ hai. Đã chốt |
| OS | không nêu | **Ubuntu 24.04 LTS** | Docker Compose plugin + apt quen thuộc, AMI lấy qua SSM public parameter |

---

## 5. Hạ tầng AWS chi tiết

Tất cả tài nguyên gắn tag `Project=bdu-tu-hoc` và `Name=bdu-tu-hoc-<thành phần>`.

### 5.1. Mạng

| Tài nguyên | Giá trị |
| --- | --- |
| VPC | `bdu-tu-hoc-vpc` — `10.20.0.0/16`, DNS hostnames bật |
| Subnet | `bdu-tu-hoc-public-1a` — `10.20.1.0/24`, AZ `ap-southeast-1a`, `MapPublicIpOnLaunch=false` (dùng EIP) |
| Internet Gateway | `bdu-tu-hoc-igw`, gắn vào VPC |
| Route table | `bdu-tu-hoc-rt-public`: `0.0.0.0/0 → IGW`, gắn vào subnet public |
| NAT Gateway | **không tạo** |

### 5.2. Security Group `bdu-tu-hoc-sg`

| Chiều | Protocol | Port | Nguồn | Ghi chú |
| --- | --- | --- | --- | --- |
| Ingress | tcp | 80 | `0.0.0.0/0` | Caddy; cũng để Cloudflare kết nối origin |
| Ingress | tcp | 443 | `0.0.0.0/0` | Caddy TLS |
| Ingress | tcp | 22 | `0.0.0.0/0` | SSH (key-only) cho vận hành + GitHub Actions |
| Egress | all | all | `0.0.0.0/0` | kéo image GHCR, gọi BDU/R2/SMTP/Discord |

Không mở `3000`, `5432` ra ngoài. `postgres` chỉ trong network của Compose.

### 5.3. EC2

| Thuộc tính | Giá trị |
| --- | --- |
| AMI | Ubuntu 24.04 LTS x86_64, lấy động qua SSM public parameter `/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id` |
| Instance type | `t3a.small` (2 vCPU / 2 GB) |
| Root volume | gp3 **30 GB**, `DeleteOnTermination=true`, **mã hoá bằng default key của account** |
| Metadata | **IMDSv2 bắt buộc** (`HttpTokens=required`, `HttpPutResponseHopLimit=1`) |
| Key pair | `bdu-tu-hoc-deploy` (ed25519), tạo mới; private key lưu **ngoài repo** |
| Elastic IP | `bdu-tu-hoc-eip`, gắn cố định vào instance |
| Swap | 2 GB file `/swapfile` (tạo bởi cloud-init) |
| Instance profile IAM | **không dùng** (app dùng credential tĩnh của R2 từ `.env`) |
| User data | `aws/user-data.sh`: cài Docker Engine + Compose plugin, tạo swap, tạo user `deploy` + key, bật fail2ban + unattended-upgrades, tạo `/opt/bdu-tu-hoc` |

### 5.4. DLM snapshot

- Lifecycle policy `bdu-tu-hoc-snapshots`: chạy `cron(0 18 * * ? *)` (01:00 giờ Việt Nam), `RetentionCount=7`, target = volume gắn tag `Project=bdu-tu-hoc`.
- Role `bdu-tu-hoc-dlm-role`: trust `dlm.amazonaws.com`, gắn AWS managed policy `service-role/AWSDataLifecycleManagerServiceRole`.

### 5.5. Ngân sách

- **Không tạo AWS Budgets** (chủ sở hữu đã quyết bỏ để tránh phụ thuộc email). Chi phí theo dõi thủ công bằng AWS Cost Explorer khi cần; trần chi phí vẫn là 30 USD/tháng theo mục 4.3.

---

## 6. Thành phần trong repo

### 6.1. File mới

| File | Vai trò |
| --- | --- |
| `aws/README.md` | Cách dùng, kiến trúc, chi phí, ánh xạ với spec này |
| `aws/infra.sh` | Script idempotent: `check \| deploy \| status \| ssh \| cleanup`. Tạo VPC/subnet/IGW/RT/SG/key pair/EC2/EIP/DLM |
| `aws/user-data.sh` | cloud-init cho lần boot đầu |
| `aws/cleanup.sh` | Xoá tài nguyên đúng thứ tự phụ thuộc, idempotent, có retry `DependencyViolation` |
| `aws/dlm-policy.json` | Body lifecycle policy |
| `deploy/bootstrap-server.sh` | Chạy **một lần** trên EC2: kiểm tra swap/Docker, clone repo, kiểm `.env`, dựng `postgres`, nạp dump, baseline + migrate, `up -d`, kiểm health |
| `deploy/caddy/Caddyfile` | Cấu hình Caddy (thay `Caddyfile.example`) |
| `docker-compose.aws.yml` | Override **chỉ dùng trên AWS**: thêm service `caddy` + 2 volume cert; đặt `image: ghcr.io/vdat293/bdu-tu-hoc:${IMAGE_TAG}` và `pull_policy: always` cho `bdu-hub`, `bdu-notifier-bot`, `bdu-db-backup` |

### 6.2. File sửa

| File | Sửa gì |
| --- | --- |
| `docker-compose.yml` | **Chỉ đổi 2 comment "VPS"** — giữ nguyên khối `build:` để dev/local và các máy khác vẫn dùng được |
| `deploy/deploy.sh` | Bước 4: `docker compose pull` rồi `docker compose up -d --remove-orphans --no-build` (thay `--build`; `--no-build` chặn Compose tự build trên máy 2 GB → tránh OOM); `VPS_APP_DIR` → `APP_DIR`; đổi mọi chữ "VPS" |
| `.github/workflows/deploy.yml` | Workflow GHCR: push image tag `<sha>`; job deploy SSH dùng secrets `AWS_*` |
| `.gitignore` | Thêm `aws/*.state`, `aws/*.pem`, `deploy/caddy/certs/` |
| `.env.example` | Thêm `COMPOSE_FILE`, `IMAGE_TAG`, `GHCR_OWNER`, `GHCR_PULL_TOKEN`; đổi chữ "VPS" |
| `README.md`, `READFORME.md`, `docs/deployment-runbook.md`, `docs/backup-restore-runbook.md`, `Dockerfile`, `vite.config.js`, `scripts/db-backup*.js` | Đổi "VPS" → "server/EC2"; runbook viết lại cho AWS |
| `deploy/nginx/bdu-hub.conf.example` | **Xoá** (Caddy là reverse proxy chính) |

### 6.3. Biến môi trường thêm trên EC2

```
COMPOSE_FILE=docker-compose.yml:docker-compose.aws.yml
IMAGE_TAG=<sha 12 ký tự>
GHCR_PULL_TOKEN=<PAT read:packages>
BACKUP_DATABASE_URL=postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>
MIGRATION_DATABASE_URL=postgresql://<POSTGRES_USER>:<POSTGRES_PASSWORD>@postgres:5432/<POSTGRES_DB>
BACKUP_R2_BUCKET=<bucket backup riêng, KHÁC R2_BUCKET media>
BACKUP_ENABLED=1
BACKUP_CRON=0 17 * * *
WS_TRUST_PROXY=true
WS_ALLOWED_ORIGINS=https://sv.bdu.io.vn
APP_URL=https://sv.bdu.io.vn
PUBLIC_APP_URL=https://sv.bdu.io.vn
FB_IMPORT_ENABLED=false
BDU_MAINTENANCE_ALLOW_PRODUCTION=1
```

### 6.4. `deploy/caddy/Caddyfile`

```caddy
sv.bdu.io.vn {
	tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key
	encode zstd gzip
	reverse_proxy bdu-hub:3000
}
```

Caddy tự xử lý `Upgrade` cho WebSocket. Certificate mount từ
`deploy/caddy/certs/` (đã gitignore, không commit).

---

## 7. Dữ liệu — trình tự bootstrap

`deploy/bootstrap-server.sh` chạy **một lần**, theo đúng thứ tự:

1. Kiểm tra EC2: swap 2 GB đã bật, Docker + Compose plugin có, `git`, `psql` trong image.
2. `git clone` repo vào `/opt/bdu-tu-hoc`, checkout đúng SHA.
3. Kiểm `.env` tồn tại và có đủ nhóm biến bắt buộc (không in giá trị).
4. Tạo các thư mục volume: `data/backups`, `data/client-assets`, `temp`.
5. `docker compose up -d postgres` → chờ healthy.
6. `docker login ghcr.io` bằng `GHCR_PULL_TOKEN`, `docker compose pull`.
7. Chuyển `data/vps_sync_20260919.sql` (scp) và `data/grammar-practice-extra/` lên EC2.
8. **Nạp dump** bằng `psql` của container `postgres`:
   ```bash
   docker compose exec -T postgres sh -c \
     'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --set=ON_ERROR_STOP=1' \
     < data/vps_sync_20260919.sql
   ```
9. **Chốt mốc migration bằng fingerprint:**
   - Tạo DB rác `bdu_fresh`, chạy `npm run db:migrate` (001→056), lấy
     `npm run db:migration:fingerprint`.
   - Trên `bdu_hub`: `npm run db:migrate:baseline` với
     `BDU_MIGRATION_BASELINE_THROUGH_VERSION=43` (ứng viên đầu; bằng chứng: dump
     có 042 + 043, thiếu 044/045/047/052–056) kèm các biến
     `BDU_MIGRATION_BASELINE_CONFIRM*`.
   - `npm run db:migrate` để áp 044→056.
   - `fingerprint(bdu_hub)` phải **trùng khít** `fingerprint(bdu_fresh)`. Nếu
     lệch, hạ/tăng `THROUGH_VERSION` và lặp lại trên DB sạch.
   - Xoá DB rác `bdu_fresh` sau khi đối chiếu xong.
10. `docker login ghcr.io` đã xong; `docker compose up -d --no-build` (tất cả service).
11. Kiểm `/api/health` và `/api/version`; in URL để chủ sở hữu trỏ
    Cloudflare và nghiệm thu.

`deploy/deploy.sh` các lần sau **không bao giờ** chạm file dump: nó dùng
`IMAGE_TAG` đã pull, chỉ backup → migrate → `up -d` → healthcheck.

**Cách khác cho bước 8 (dự phòng):** sinh manifest (`format`,
`version`, `sha256`, `database`, `size`) rồi dùng `npm run db:restore`
chính thức. Chỉ dùng nếu `psql` trực tiếp gặp trục trặc; bước 9 vẫn là lưới an
toàn thật.

---

## 8. Deploy & rollback

**Đường deploy:** push lên `main` → GitHub Actions build image → push
`ghcr.io/vdat293/bdu-tu-hoc:<sha>` → SSH vào EC2 chạy `deploy/deploy.sh` với
`DEPLOY_SHA=<sha>`.

**Deploy thủ công:** `gh workflow run` hoặc SSH vào EC2 và
`DEPLOY_SHA=<sha> bash deploy/deploy.sh`.

**`deploy.sh` sau khi sửa:**
1. preflight (docker compose, `.env`, PostgreSQL `pg_isready`, git sạch)
2. backup DB bắt buộc (`--pre-deploy`) — lỗi thì dừng
3. migrate đúng 1 lần — lỗi thì dừng, app cũ vẫn chạy
4. `docker compose pull` + `IMAGE_TAG=<sha> docker compose up -d --remove-orphans --no-build`
   (`--no-build` là bắt buộc: `docker-compose.yml` gốc vẫn khai `build:`, nếu không
   chặn thì Compose có thể tự build image ~5 GB trên máy 2 GB và OOM.)
5. healthcheck `/api/health` tối đa 90 s
6. in hướng dẫn rollback

**Rollback:** đặt `IMAGE_TAG` về tag SHA cũ trong `.env`, chạy
`docker compose pull && up -d`. Không build lại. Nếu migration đã chạy và dữ
liệu sai, restore từ object backup R2 có `reason=pre-deploy`.

**Downtime:** vài giây mỗi lần deploy (1 replica vì WebSocket trong cùng process).

---

## 9. Bảo mật

- Cổng 22 mở toàn cầu nhưng **chỉ xác thực bằng key**; `PasswordAuthentication no`,
  `PermitRootLogin no`, user deploy là `deploy` (không phải root).
- Caddy là điểm vào duy nhất; `bdu-hub` không lộ cổng.
- TLS: Cloudflare proxy ON, mode **Full (strict)**; origin cert hợp lệ cho
  `sv.bdu.io.vn`. WebSocket đi qua Cloudflare (mặc định được hỗ trợ).
- `WS_TRUST_PROXY=true` và `WS_ALLOWED_ORIGINS=https://sv.bdu.io.vn` để chống
  giả mạo origin; không dùng `*`.
- `.env` chỉ nằm trên EC2 (quyền 0600), không vào git, không vào GitHub secrets.
- GitHub secrets chỉ chứa thông tin SSH: `AWS_HOST`, `AWS_USER`,
  `AWS_SSH_PRIVATE_KEY`, `AWS_APP_DIR`, `AWS_SSH_PORT`.
- IMDSv2 bắt buộc; EBS mã hoá; fail2ban + unattended-upgrades bật.
- Khuyến nghị (ngoài phạm vi thực thi): sau này tạo IAM user/role riêng thay vì
  dùng `root` cho tác vụ vận hành.

---

## 10. Vận hành

| Việc | Cách làm |
| --- | --- |
| Health | `docker compose ps` phải `healthy`; `curl -s https://sv.bdu.io.vn/api/health` |
| Biết bản đang chạy | `curl -s https://sv.bdu.io.vn/api/version` → build id (12 ký tự SHA) |
| Log | `docker compose logs --tail=200 bdu-hub` |
| Backup định kỳ | service `bdu-db-backup` với `BACKUP_ENABLED=1`, cron cấu hình qua `BACKUP_CRON` |
| Kiểm backup khôi phục được | `npm run db:backup:verify` |
| Snapshot EBS | DLM `bdu-tu-hoc-snapshots`, 1 bản/ngày giữ 7 |
| Chi phí | Theo dõi thủ công bằng AWS Cost Explorer; trần 30 USD/tháng |
| Dọn đĩa | `docker image prune -f`, `docker system df` |
| Origin cert hết hạn | Origin Certificate hiệu lực tới 15 năm; ghi nhớ gia hạn thủ công (Cloudflare Dashboard) |

---

## 11. Dọn sạch VPS khỏi repo

Thực hiện **sau khi** AWS chạy được, trong cùng đợt:

| File | Việc |
| --- | --- |
| `.github/workflows/deploy.yml` | `name` → AWS; secrets `VPS_*` → `AWS_*`; comment "VPS" → "EC2" |
| `deploy/deploy.sh` | `VPS_APP_DIR` → `APP_DIR`; đổi mọi chữ "VPS" trong comment/log/rollback |
| `docs/deployment-runbook.md` | Viết lại cho EC2; xoá nội dung VPS |
| `README.md` (~12 chỗ), `READFORME.md` (~3 chỗ) | Cập nhật mục deploy, TLS, secrets, bảng workflow |
| `.env.example` (6 chỗ), `docker-compose.yml` (2), `Dockerfile` (1), `vite.config.js` (1), `scripts/db-backup.js` (1), `scripts/db-backup-scheduler.js` (2), `docs/backup-restore-runbook.md` (2) | Đổi "VPS" → "server/EC2" |
| `client/src/services/community-realtime.js` (1 comment) | Đổi "VPS restart" → "server restart" |
| `deploy/nginx/bdu-hub.conf.example` | Xoá |
| `docs/superpowers/specs|plans/*`, `.superpowers/**` | **Không sửa** (hồ sơ lịch sử); chỉ thêm một dòng trỏ sang spec này ở spec 2026-10-12 |

Tiêu chí sạch: `grep -rI "vps" --exclude-dir=node_modules --exclude-dir=.git` chỉ
còn kết quả trong `docs/superpowers/` và `.superpowers/`.

---

## 12. Nghiệm thu

1. `docker compose ps` → `caddy`, `bdu-hub`, `postgres`, `bdu-notifier-bot`, `bdu-db-backup` đều healthy.
2. `https://sv.bdu.io.vn/api/health` = 200; `/api/version` trả đúng SHA đã deploy.
3. `http://` tự chuyển `https://`; cert ở browser hợp lệ; Cloudflare mode Full (strict) không báo lỗi.
4. WebSocket `wss://sv.bdu.io.vn` kết nối được; thử 1 broadcast realtime thành công.
5. Đăng nhập BDU thật bằng `CDS_USER`/`CDS_PASSWORD` → bảng điểm hiển thị.
6. Đếm `students`, `community_posts`, `vocab_words` khớp với dump; `fingerprint(bdu_hub)` trùng `fingerprint(bdu_fresh)`.
7. Ảnh cũ load được từ R2 (xác nhận bucket còn sống; nếu bucket đã mất thì ghi nhận và xử lý riêng).
8. `npm run db:backup` tạo object trên R2; `npm run db:backup:verify` xanh.
9. Từ một máy ngoài Internet: cổng 3000 và 5432 **đóng**; 22/80/443 mở.
10. Rollback: đổi `IMAGE_TAG` về SHA trước, `up -d`, app vẫn healthy.
11. Bot Discord online; xác nhận không còn nơi nào khác chạy cùng token.
12. `grep -rI "vps"` chỉ còn trong `docs/superpowers/` và `.superpowers/`.

---

## 13. Rủi ro & câu hỏi mở

| Rủi ro | Mức | Giảm thiểu |
| --- | --- | --- |
| Mất dữ liệu sau 20/09/2026 | **Đã xảy ra** | Không cứu được; ghi nhận và thông báo người dùng nếu cần |
| R2 bucket đã bị xoá → mất toàn bộ ảnh | Trung bình | Xác minh bucket ở bước 7 bootstrap; nếu mất, thống kê ảnh hỏng riêng |
| `THROUGH_VERSION=43` sai → fingerprint lệch | Thấp | Lặp lại trên DB sạch với version khác; chỉ migrate khi fingerprint trùng |
| `NOTIFICATION_ENCRYPTION_KEY` khác key cũ | Thấp | Người dùng đăng nhập lại; không mất dữ liệu nghiệp vụ |
| `t3a.small` 2 GB không đủ khi chạy đủ service | Trung bình | Build ở CI (không build trên máy); swap 2 GB; tắt FB import; theo dõi RAM, nâng lên `t3a.medium` nếu cần (+~20 USD/tháng) |
| Cổng 22 mở toàn cầu bị dò | Trung bình | Chỉ key, không password, không root, fail2ban |
| Cloudflare Full (strict) lỗi cert | Thấp | Kiểm cert trước khi bật proxy; DNS-only trong lúc kiểm |

Câu hỏi mở (không chặn implement): có cần chạy `db:migrate:baseline` trên một
bản copy để rehearsal trước, hay làm trực tiếp trên `bdu_hub` sau khi đã backup?

---

## 14. Ngoài phạm vi

- Zero-downtime deploy; tách WebSocket ra service riêng; shared pub/sub (Redis).
- HA/multi-AZ, Auto Scaling, Load Balancer.
- Chuyển PostgreSQL sang Amazon RDS.
- Bật lại FB import (Playwright) trên production.
- Bắt buộc CI xanh trước khi deploy (`workflow_run`).
- Tạo IAM user/role không phải `root` cho vận hành.
