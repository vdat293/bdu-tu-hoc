# Dựng lại server production trên AWS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Đưa website BDU Tự Học chạy production trên một EC2 `t3a.small` ở `ap-southeast-1`, phục vụ `https://sv.bdu.io.vn` qua Cloudflare, với dữ liệu khôi phục từ `data/vps_sync_20260919.sql`, và dọn sạch mọi dấu vết VPS khỏi repo.

**Architecture:** Một EC2 Ubuntu 24.04 trong VPC riêng không NAT, chạy Docker Compose gồm `caddy` (TLS + reverse proxy) → `bdu-hub` (Express + static + WebSocket), `postgres`, `bdu-notifier-bot`, `bdu-db-backup`. Image build ở GitHub Actions và đẩy lên GHCR; EC2 chỉ `pull`, không bao giờ build.

**Tech Stack:** AWS CLI v2, Docker Engine + Compose v2, Caddy 2, PostgreSQL 16, GitHub Actions, GHCR, Cloudflare (DNS + proxy + Origin Certificate).

**Spec:** [`docs/superpowers/specs/2026-10-13-dung-server-aws-design.md`](../specs/2026-10-13-dung-server-aws-design.md)

## Global Constraints

- **Không sửa code ứng dụng**: `server.js`, `src/**`, `client/**`, `migrations/**` giữ nguyên. Chỉ thêm/sửa hạ tầng và tài liệu.
- Region `ap-southeast-1`; tài khoản AWS `143784554304`; domain `sv.bdu.io.vn`.
- Instance `t3a.small`; root volume gp3 **30 GB**; swap **2 GB**; **không** dùng NAT Gateway.
- Không mở cổng `3000` và `5432` ra Internet. Chỉ mở `22`, `80`, `443`.
- Ngân sách trần **30 USD/tháng**; ước tính ~24 USD/tháng.
- `deploy/deploy.sh` là đường deploy duy nhất; backup DB **phải** chạy trước migrate.
- Image app luôn là `ghcr.io/vdat293/bdu-tu-hoc:<short-sha 12 ký tự>`; `IMAGE_TAG` khớp 12 ký tự đầu của commit.
- Node `>=22.12 <25` (từ `package.json`).
- Không commit secret: `.env`, `*.pem`, `aws/*.state`, `deploy/caddy/certs/**`.
- Commit message theo Conventional Commits, tiếng Việt không dấu, như lịch sử repo (`feat(x): ...`, `docs(x): ...`).
- Mọi lệnh AWS chạy bằng credentials của account; thao tác trên Windows dùng Git Bash (`bash`), thao tác remote dùng `ssh`/`scp`.
- Trên Git Bash, khi truyền đường dẫn vào `docker -v`, đặt `MSYS_NO_PATHCONV=1` để tránh MSYS biến đổi đường dẫn.

## Review Focus

Năm lớp lỗi dưới đây không có test tự động nào phủ, nhưng rất dễ làm hỏng việc thật; mỗi dòng được gắn một bước kiểm tra ở task sở hữu:

1. **Compose tự build trên máy 2 GB** — `docker-compose.yml` gốc vẫn khai `build:`, nên `docker compose up` thiếu `--no-build` sẽ build image ~5 GB và OOM. Kiểm ở Task 6 Step 4.
2. **Nạp dump lên DB đã có ledger** — nếu DB đích đã có `public.schema_migrations` thì baseline/migrate sẽ sai. Kiểm ở Task 5 Step 1 (bootstrap từ chối chạy lại) và Step 5 (`max(version) = 56`).
3. **Cloudflare Full (strict) khi origin chưa có cert** — bật proxy trước khi cài Origin Certificate làm site lỗi 526. Kiểm ở Task 4 Step 8.
4. **Tự khoá SSH** — cloud-init tắt password/root có thể khiến không vào được máy. Kiểm ở Task 4 Step 6.
5. **Lộ cổng 3000/5432** — bind sai (`0.0.0.0`) là lộ DB/Node ra Internet. Kiểm ở Task 8 Step 3.

---

### Task 1: Compose override AWS + Caddyfile + gitignore

**Files:**
- Create: `docker-compose.aws.yml`
- Create: `deploy/caddy/Caddyfile`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: `docker-compose.yml` hiện có (service `postgres`, `bdu-hub`, `bdu-notifier-bot`, `bdu-db-backup`); `deploy/caddy/Caddyfile.example` làm mẫu.
- Produces: service `caddy` (image `caddy:2-alpine`, ports `80:80`/`443:443`, volumes `./deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro`, `./deploy/caddy/certs:/etc/caddy/certs:ro`, named volumes `caddy_data`, `caddy_config`); các service `bdu-hub`, `bdu-notifier-bot`, `bdu-db-backup` nhận `image: ghcr.io/vdat293/bdu-tu-hoc:${IMAGE_TAG:?Set IMAGE_TAG in .env}` và `pull_policy: always`.

- [ ] **Step 1: Viết `docker-compose.aws.yml`**

Bốn service như mô tả trong Interfaces. Header của file ghi rõ: file này **chỉ** dùng trên EC2, bật bằng `COMPOSE_FILE=docker-compose.yml:docker-compose.aws.yml` trong `.env`; không được dùng ở local.

- [ ] **Step 2: Viết `deploy/caddy/Caddyfile`**

```caddy
sv.bdu.io.vn {
	tls /etc/caddy/certs/origin.pem /etc/caddy/certs/origin.key
	encode zstd gzip
	reverse_proxy bdu-hub:3000
}
```

- [ ] **Step 3: Thêm 3 dòng vào `.gitignore`**

`aws/*.state`, `aws/*.pem`, `deploy/caddy/certs/`.

- [ ] **Step 4: Kiểm Compose ghép đúng**

```bash
IMAGE_TAG=testsha123456 POSTGRES_DB=x POSTGRES_USER=x POSTGRES_PASSWORD=x \
COMPOSE_FILE=docker-compose.yml:docker-compose.aws.yml \
docker compose config
```

Expected: exit 0; output chứa `image: ghcr.io/vdat293/bdu-tu-hoc:testsha123456` (3 lần), `pull_policy: always`, service `caddy`, và `published: "443"`.

- [ ] **Step 5: Kiểm Caddyfile hợp lệ**

```bash
docker run --rm -v "$PWD/deploy/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2-alpine caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile
```

Expected: exit 0, in ra JSON có `bdu-hub:3000`. (Dùng `adapt`, không dùng `validate`, để không cần file cert tồn tại.)

- [ ] **Step 6: Commit**

```bash
git add docker-compose.aws.yml deploy/caddy/Caddyfile .gitignore
git commit -m "feat(aws): them compose override + Caddy reverse proxy cho EC2"
```

---

### Task 2: CI build và đẩy image lên GHCR

**Files:**
- Modify: `.github/workflows/deploy.yml`

**Interfaces:**
- Consumes: `Dockerfile` (build sẵn, không sửa).
- Produces: image `ghcr.io/vdat293/bdu-tu-hoc:<short-sha>` với `short-sha` = 12 ký tự đầu của `github.sha`; job `deploy` dùng secrets `AWS_HOST`, `AWS_USER`, `AWS_SSH_PRIVATE_KEY`, `AWS_APP_DIR`, `AWS_SSH_PORT`.

- [ ] **Step 1: Thêm `permissions: packages: write` cho job `build`**

Giữ `contents: read`.

- [ ] **Step 2: Thêm bước tính short sha và đăng nhập GHCR**

Bước `id: shortsha` đặt output `sha` = `${GITHUB_SHA:0:12}`. Đăng nhập bằng `docker/login-action@v3` với `registry: ghcr.io`, `username: ${{ github.actor }}`, `password: ${{ secrets.GITHUB_TOKEN }}`.

- [ ] **Step 3: Đổi bước build thành push**

`docker/build-push-action@v6` với `push: true`, `tags: ghcr.io/${{ github.repository }}:${{ steps.shortsha.outputs.sha }}`, giữ `build-args: BUILD_ID=${{ github.sha }}` và `cache-from/to: type=gha`.

- [ ] **Step 4: Đổi job `deploy` sang EC2**

Trong `appleboy/ssh-action`: `host: ${{ secrets.AWS_HOST }}`, `username: ${{ secrets.AWS_USER }}`, `key: ${{ secrets.AWS_SSH_PRIVATE_KEY }}`, `port: ${{ secrets.AWS_SSH_PORT || '22' }}`; env forward `DEPLOY_SHA` và `APP_DIR: ${{ secrets.AWS_APP_DIR }}`; comment mô tả secrets đổi sang `AWS_*`. Đổi `name:` của workflow và các chỗ ghi "VPS" thành "EC2".

- [ ] **Step 5: Kiểm workflow hợp lệ**

```bash
docker run --rm -v "$PWD:/repo" -w /repo rhysd/actionlint:latest .github/workflows/deploy.yml
```

Expected: không có dòng lỗi nào in ra.

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/deploy.yml
git commit -m "ci(deploy): build day image len GHCR va deploy EC2"
```

---

### Task 3: Bộ script hạ tầng `aws/`

**Files:**
- Create: `aws/README.md`
- Create: `aws/infra.sh`
- Create: `aws/user-data.sh`
- Create: `aws/cleanup.sh`
- Create: `aws/dlm-policy.json`

**Interfaces:**
- Consumes: không.
- Produces:
  - `aws/infra.sh <check|deploy|status|ssh|cleanup>`; state file `aws/infra.state` với các khóa `REGION`, `VPC_ID`, `SUBNET_ID`, `IGW_ID`, `RT_ID`, `SG_ID`, `KEY_NAME`, `KEY_PATH`, `INSTANCE_ID`, `EIP_ALLOC_ID`, `EIP_PUBLIC_IP`, `DLM_POLICY_ID`.
  - `aws/user-data.sh` đọc 2 biến `DEPLOY_PUBLIC_KEY` và `APP_DIR` (được `infra.sh` thay trước khi truyền `--user-data`).
  - `aws/cleanup.sh [--yes]` xoá theo thứ tự phụ thuộc và idempotent.

- [ ] **Step 1: Viết `aws/user-data.sh`**

Cloud-init: `apt-get update`; cài `docker.io`, `docker-compose-plugin`, `git`, `fail2ban`, `unattended-upgrades`; tạo `/swapfile` 2 GB + bật; tạo user `deploy`, thêm vào group `docker`, đặt `DEPLOY_PUBLIC_KEY` vào `~deploy/.ssh/authorized_keys` (600/700); ghi `/etc/ssh/sshd_config.d/99-bdu.conf` với `PasswordAuthentication no`, `PermitRootLogin no`; `systemctl enable --now docker fail2ban`; tạo `/opt/bdu-tu-hoc`.

- [ ] **Step 2: Viết `aws/infra.sh` — phần `check`**

In `sts get-caller-identity`, region hiệu lực, và đếm tài nguyên hiện có (`ec2 describe-instances`, `describe-volumes`, `describe-addresses`, `describe-security-groups`, `describe-vpcs`). Không tạo gì.

- [ ] **Step 3: Viết `aws/infra.sh` — phần `deploy`**

Idempotent, mỗi bước kiểm state trước khi tạo. Thứ tự và tham số chính:
1. VPC `10.20.0.0/16`, bật DNS hostnames → `VPC_ID`.
2. Subnet `10.20.1.0/24` tại `ap-southeast-1a`, `MapPublicIpOnLaunch=false` → `SUBNET_ID`.
3. IGW + attach; route table `0.0.0.0/0 → IGW`, associate subnet → `IGW_ID`, `RT_ID`.
4. SG với 3 ingress (`22`, `80`, `443` từ `0.0.0.0/0`) và egress all → `SG_ID`.
5. Key pair ed25519 `bdu-tu-hoc-deploy` → ghi private key vào `$KEY_PATH` (mặc định `aws/bdu-tu-hoc-deploy.pem`, chmod 600) → `KEY_NAME`, `KEY_PATH`.
6. AMI Ubuntu 24.04 qua SSM parameter `/aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id`.
7. `run-instances` với `t3a.small`, `--metadata-options HttpTokens=required,HttpPutResponseHopLimit=1`, root gp3 30 GB `DeleteOnTermination=true` `Encrypted=true`, `--user-data file://<file tạm đã thay biến>`, tag `Project=bdu-tu-hoc`, `Name=bdu-tu-hoc-app` → `INSTANCE_ID`.
8. `allocate-address` + `associate-address` → `EIP_ALLOC_ID`, `EIP_PUBLIC_IP`.
9. DLM: tạo role `bdu-tu-hoc-dlm-role` (trust `dlm.amazonaws.com`, gắn `arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole`), `create-lifecycle-policy` từ `aws/dlm-policy.json` (cron `0 18 * * ? *`, `RetentionCount` 7, target tag `Project=bdu-tu-hoc`) → `DLM_POLICY_ID`.
10. `wait instance-status-ok`, chờ `/var/lib/cloud/instance/boot-finished` qua SSH.

Không tạo AWS Budgets (chủ sở hữu đã quyết bỏ).

Mọi giá trị lấy bằng `--output text` phải lọc `\r` (Git Bash trên Windows chèn CRLF) — bọc `aws()` như `aws-script/lab01.sh` đang làm.

- [ ] **Step 4: Viết `aws/infra.sh` — phần `status` và `ssh`**

`status` in `EIP_PUBLIC_IP`, `INSTANCE_ID`, lệnh `ssh -i $KEY_PATH deploy@$EIP_PUBLIC_IP`, và URL `https://sv.bdu.io.vn`. `ssh` mở SSH tới máy bằng key trong state.

- [ ] **Step 5: Viết `aws/cleanup.sh`**

Xoá theo thứ tự: instance → EIP (release) → volume mồ côi → DLM policy → IAM role → SG → route table → subnet → IGW → VPC. Idempotent, retry khi gặp `DependencyViolation`, ghi log `aws/cleanup-log.txt`, hỏi xác nhận trừ khi `--yes`.

- [ ] **Step 6: Viết `aws/README.md`**

Cách dùng 5 subcommand, ánh xạ tài nguyên, bảng chi phí (chép từ spec mục 4.3), cảnh báo "NAT Gateway không có; xoá tài nguyên bằng `cleanup.sh` khi không dùng", và trỏ về spec.

- [ ] **Step 7: Kiểm cú pháp và `check`**

```bash
bash -n aws/infra.sh aws/user-data.sh aws/cleanup.sh
bash aws/infra.sh check
```

Expected: `bash -n` không in gì; `check` in ra `Account: 143784554304` và `0` cho mọi loại tài nguyên.

- [ ] **Step 8: Commit**

```bash
git add aws/
git commit -m "feat(aws): script dung ha tang EC2 + VPC + EIP + DLM"
```

---

### Task 4: Cấp phát hạ tầng AWS + DNS + Origin Certificate

**Files:** không sửa file repo (trừ `aws/infra.state` sinh ra, đã gitignore).

**Interfaces:**
- Consumes: `aws/infra.sh` (Task 3).
- Produces: EC2 chạy với 1 Elastic IP; DNS `sv.bdu.io.vn → <EIP>` trên Cloudflare; Origin Certificate đã cài tại `/opt/bdu-tu-hoc/deploy/caddy/certs/` trên EC2.

- [ ] **Step 1: Cấp phát**

```bash
bash aws/infra.sh deploy
```

Expected: kết thúc bằng `EIP_PUBLIC_IP=<ip>`; instance ở trạng thái `running` + `ok`.

- [ ] **Step 2: Kiểm tài nguyên đã tạo**

`aws ec2 describe-instances`, `describe-security-groups`, `describe-addresses`, `aws dlm get-lifecycle-policies`. Expected: có đúng 1 instance `t3a.small`, 1 EIP, SG có đúng 3 ingress, 1 DLM policy.

- [ ] **Step 3: Xác nhận cổng 80/443 mở, 3000/5432 đóng**

`aws ec2 describe-security-groups --group-ids <SG_ID>`. Expected: chỉ có perm 22/80/443 ingress.

- [ ] **Step 4: Tạo bản ghi DNS trên Cloudflare**

`A sv.bdu.io.vn → <EIP>`, **proxied = OFF (DNS only)** trong lúc này; TTL Auto.

- [ ] **Step 5: Lấy Origin Certificate**

Trong Cloudflare Dashboard → SSL/TLS → Origin Server → Create Certificate cho host `sv.bdu.io.vn` (RSA, 15 năm). Lưu 2 nội dung vào file cục bộ `origin.pem` và `origin.key`.

- [ ] **Step 6: Kiểm SSH vào máy bằng user `deploy`**

```bash
ssh -i aws/bdu-tu-hoc-deploy.pem deploy@<EIP> 'id; docker version --format "{{.Server.Version}}"; sudo swapon --show'
```

Expected: user `deploy` trong group `docker`; Docker in ra version; swap 2 GB hiện ra. Sau đó kiểm tự khoá SSH: `ssh -o PreferredAuthentications=password -o PubkeyAuthentication=no deploy@<EIP>` phải bị từ chối.

- [ ] **Step 7: Cài cert và `.env` lên máy**

```bash
scp -i aws/bdu-tu-hoc-deploy.pem origin.pem origin.key deploy@<EIP>:/opt/bdu-tu-hoc/deploy/caddy/certs/
```

tạo thư mục trước nếu chưa có; đặt quyền 600 cho `origin.key`.

- [ ] **Step 8: Kiểm cert trước khi bật proxy**

```bash
openssl x509 -in origin.pem -noout -subject -enddate -ext subjectAltName
```

Expected: subject/SAN chứa `sv.bdu.io.vn`, còn hạn. **Chỉ sau bước này** mới bật Cloudflare proxy.

- [ ] **Step 9: Bật Cloudflare proxy + Full (strict)**

Đổi bản ghi `sv.bdu.io.vn` sang proxied (orange cloud); SSL/TLS mode = **Full (strict)**.

- [ ] **Step 10: Commit (nếu có sửa script do lỗi phát sinh)**

Nếu `infra.sh` phải sửa: `git add aws/ && git commit -m "fix(aws): <lý do>"`. Không commit state/pem.

---

### Task 5: `deploy/bootstrap-server.sh` + chạy bootstrap dữ liệu

**Files:**
- Create: `deploy/bootstrap-server.sh`

**Interfaces:**
- Consumes: `docker-compose.aws.yml` + `Caddyfile` (Task 1); image trên GHCR (Task 2); EC2 đã cấp phát (Task 4).
- Produces: DB `bdu_hub` chứa dữ liệu từ `data/vps_sync_20260919.sql` với ledger khớp (`fingerprint` bằng `bdu_fresh`); stack 5 service healthy.

- [ ] **Step 1: Viết `deploy/bootstrap-server.sh`**

Thực hiện đúng 11 bước của spec mục 7. Bắt buộc:
- Từ chối chạy nếu `aws/infra.state` không tồn tại hoặc `/opt/bdu-tu-hoc/.env` thiếu nhóm biến bắt buộc (`POSTGRES_*`, `DATABASE_URL`, `IMAGE_TAG`, `COMPOSE_FILE`, `BACKUP_DATABASE_URL`, `BACKUP_R2_BUCKET`).
- Từ chối chạy lại nếu `public.schema_migrations` đã tồn tại (chống nạp đè dữ liệu).
- Dừng ngay (không `up -d` toàn bộ) nếu fingerprint lệch.

- [ ] **Step 2: Chuẩn bị `.env` trên EC2**

Tạo `/opt/bdu-tu-hoc/.env` (quyền 600) từ `.env.example`, điền đủ giá trị, gồm các dòng ở spec mục 6.3. Không in nội dung file ra log.

- [ ] **Step 3: Kiểm `.env` đã đủ**

```bash
ssh -i aws/bdu-tu-hoc-deploy.pem deploy@<EIP> \
  'cd /opt/bdu-tu-hoc && for k in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL IMAGE_TAG COMPOSE_FILE BACKUP_DATABASE_URL BACKUP_R2_BUCKET WS_ALLOWED_ORIGINS; do grep -q "^$k=" .env || echo "THIEU $k"; done; echo XONG'
```

Expected: chỉ in `XONG`.

- [ ] **Step 4: Chạy bootstrap (11 bước, tự gate fingerprint)**

```bash
scp -i aws/bdu-tu-hoc-deploy.pem data/vps_sync_20260919.sql deploy@<EIP>:/opt/bdu-tu-hoc/data/
ssh -i aws/bdu-tu-hoc-deploy.pem deploy@<EIP> 'cd /opt/bdu-tu-hoc && bash deploy/bootstrap-server.sh'
```

Expected: in ra 2 fingerprint; nếu lệch thì script **tự dừng, không `up -d`**; nếu trùng thì chạy nốt `up -d --no-build`.

- [ ] **Step 5: Kiểm ledger SAU baseline**

```bash
ssh -i aws/bdu-tu-hoc-deploy.pem deploy@<EIP> \
  'cd /opt/bdu-tu-hoc && docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select max(version) from public.schema_migrations"'
```

Expected: `max = 56`. Nếu `psql` báo bảng không tồn tại thì bootstrap đã không chạy baseline đúng — dừng và xem log bootstrap.

- [ ] **Step 6: Xác nhận fingerprint trùng**

Expected: `fingerprint(bdu_hub)` == `fingerprint(bdu_fresh)` (đã in ở Step 4). Nếu lệch: xoá `bdu_hub`, `up -d postgres`, nạp lại dump, thử `BDU_MIGRATION_BASELINE_THROUGH_VERSION` khác (44, 42, …), lặp tới khi trùng. Ghi lại giá trị đã dùng vào `aws/README.md`.

- [ ] **Step 7: Chạy nốt `up -d` và kiểm health**

```bash
ssh -i aws/bdu-tu-hoc-deploy.pem deploy@<EIP> \
  'cd /opt/bdu-tu-hoc && docker compose up -d --no-build && sleep 60 && docker compose ps'
```

Expected: `caddy`, `bdu-hub`, `postgres`, `bdu-notifier-bot`, `bdu-db-backup` đều `healthy`/`running`.

- [ ] **Step 8: Kiểm dữ liệu và R2**

```bash
curl -s https://sv.bdu.io.vn/api/health
curl -s https://sv.bdu.io.vn/api/version
ssh -i aws/bdu-tu-hoc-deploy.pem deploy@<EIP> \
  'cd /opt/bdu-tu-hoc && docker compose exec -T postgres psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "select count(*) from students; select count(*) from community_posts;"'
```

Expected: health 200; version = short sha đã deploy; số dòng `students`/`community_posts` > 0 và khớp khi đối chiếu với dump. Kiểm 1 ảnh cũ tải được (mở 1 URL avatar trong DB) để xác nhận R2 sống.

- [ ] **Step 9: Commit**

```bash
git add deploy/bootstrap-server.sh
git commit -m "feat(deploy): script bootstrap mot lan cho EC2 (clone, env, restore, baseline, up)"
```

---

### Task 6: Sửa `deploy/deploy.sh` cho EC2 + thử deploy lại

**Files:**
- Modify: `deploy/deploy.sh`

**Interfaces:**
- Consumes: image GHCR + `.env` trên EC2 (Task 5).
- Produces: `deploy.sh` đổi `VPS_APP_DIR` → `APP_DIR`, bước 4 dùng `pull` + `up -d --no-build`, không còn chữ "VPS".

- [ ] **Step 1: Đổi biến thư mục**

`APP_DIR="${VPS_APP_DIR:-/opt/bdu-tu-hoc}"` → `APP_DIR="${APP_DIR:-/opt/bdu-tu-hoc}"`; cập nhật bảng biến ở header và mọi chỗ ghi `VPS_APP_DIR`.

- [ ] **Step 2: Đổi bước 4 sang pull + no-build**

`BUILD_ID="$DEPLOY_SHORT_SHA" docker compose up -d --build --remove-orphans` → `IMAGE_TAG="$DEPLOY_SHORT_SHA" docker compose pull` rồi `IMAGE_TAG="$DEPLOY_SHORT_SHA" docker compose up -d --remove-orphans --no-build`. Thêm chú thích vì sao `--no-build` là bắt buộc (máy 2 GB).

- [ ] **Step 3: Đổi chữ "VPS" còn lại**

Comment, log, hướng dẫn rollback: "VPS" → "EC2". Giữ nguyên logic backup/migrate/healthcheck/rollback.

- [ ] **Step 4: Thử deploy lại cùng SHA**

```bash
ssh -i aws/bdu-tu-hoc-deploy.pem deploy@<EIP> \
  'cd /opt/bdu-tu-hoc && DEPLOY_SYNC=0 DEPLOY_SHA=$(git rev-parse HEAD) bash deploy/deploy.sh' 2>&1 | tee /tmp/deploy-test.log
grep -c -i "building" /tmp/deploy-test.log
```

Expected: script đi qua đủ 5 bước, kết thúc `App healthy`; `grep -c -i building` = `0` (**Review Focus #1**: không có build nào chạy).

- [ ] **Step 5: Kiểm `/api/version` vẫn khớp SHA**

`curl -s https://sv.bdu.io.vn/api/version` → đúng 12 ký tự SHA.

- [ ] **Step 6: Commit**

```bash
git add deploy/deploy.sh
git commit -m "refactor(deploy): deploy.sh dung image GHCR + --no-build tren EC2"
```

---

### Task 7: Dọn sạch VPS khỏi repo

**Files:**
- Modify: `docs/deployment-runbook.md`, `README.md`, `READFORME.md`, `.env.example`, `docker-compose.yml`, `Dockerfile`, `vite.config.js`, `scripts/db-backup.js`, `scripts/db-backup-scheduler.js`, `docs/backup-restore-runbook.md`, `client/src/services/community-realtime.js`
- Delete: `deploy/nginx/bdu-hub.conf.example`
- Modify: `docs/superpowers/specs/2026-10-12-khoa-dich-vu-bao-tri-design.md` (chỉ thêm 1 dòng trỏ sang spec mới)

**Interfaces:**
- Consumes: mọi thay đổi ở Task 1–6.
- Produces: không còn tham chiếu "VPS" ngoài thư mục hồ sơ lịch sử.

- [ ] **Step 1: Viết lại `docs/deployment-runbook.md` cho EC2**

Nội dung: bức tranh tổng thể (Actions → GHCR → EC2), deploy thủ công, biến `APP_DIR`, rollback bằng `IMAGE_TAG`, đọc log, bảo trì (backup R2, DLM snapshot, prune), secrets `AWS_*`. Không còn mục "SSH vào VPS".

- [ ] **Step 2: Đổi "VPS" trong các file còn lại**

`.env.example` (6 chỗ), `docker-compose.yml` (2), `Dockerfile` (1), `vite.config.js` (1), `scripts/db-backup.js` (1), `scripts/db-backup-scheduler.js` (2), `docs/backup-restore-runbook.md` (2), `client/src/services/community-realtime.js` (1), `README.md` (~12), `READFORME.md` (~3). Ngữ nghĩa: "VPS" → "EC2"/"server".

- [ ] **Step 3: Xoá `deploy/nginx/bdu-hub.conf.example`**

```bash
git rm deploy/nginx/bdu-hub.conf.example
```

- [ ] **Step 4: Thêm dòng trỏ sang spec mới ở spec 2026-10-12**

Thêm một dòng ở Phụ lục A: "Đợt dựng server đã chuyển thành [`2026-10-13-dung-server-aws-design.md`](2026-10-13-dung-server-aws-design.md)." Không sửa phần còn lại.

- [ ] **Step 5: Kiểm sạch**

```bash
grep -rI "vps" --exclude-dir=node_modules --exclude-dir=.git . | grep -v "^./docs/superpowers/" | grep -v "^./.superpowers/"
```

Expected: không có dòng nào.

- [ ] **Step 6: Kiểm test/lint vẫn xanh**

```bash
npm run lint:frontend && npm run test:node
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "docs(aws): don sach tham chieu VPS, runbook cho EC2"
```

---

### Task 8: Vận hành + nghiệm thu 12 tiêu chí

**Files:**
- Modify: `aws/README.md` (ghi mốc `THROUGH_VERSION` và kết quả nghiệm thu)

**Interfaces:**
- Consumes: toàn bộ Task 1–7.
- Produces: bằng chứng nghiệm thu; backup R2 + DLM hoạt động.

- [ ] **Step 1: Kiểm backup và verify**

```bash
ssh -i aws/bdu-tu-hoc-deploy.pem deploy@<EIP> \
  'cd /opt/bdu-tu-hoc && docker compose run --rm --no-deps bdu-hub npm run db:backup -- --reason manual-test && docker compose run --rm --no-deps bdu-hub npm run db:backup:verify'
```

Expected: tạo object trên R2; `db:backup:verify` báo xanh.

- [ ] **Step 2: Kiểm DLM**

`aws dlm get-lifecycle-policies` → 1 policy `bdu-tu-hoc-snapshots`. Sau ≥1 ngày, `aws ec2 describe-snapshots --owner-ids self` phải có snapshot.

- [ ] **Step 3: Kiểm cổng từ Internet (Review Focus #5)**

Từ máy ngoài: `curl -m 5 http://<EIP>:3000` và `curl -m 5 http://<EIP>:5432` phải **timeout/refused**; `curl -I -m 5 https://sv.bdu.io.vn` phải 200.

- [ ] **Step 4: Rollback thử một lần**

Đặt `IMAGE_TAG` = short sha của commit trước đó trong `.env` trên EC2 → `docker compose pull && docker compose up -d --no-build` → health 200 → đặt lại `IMAGE_TAG` hiện tại và `up -d --no-build`.

- [ ] **Step 5: Chạy đủ 12 tiêu chí mục 12 của spec**

Ghi kết quả từng tiêu chí (đạt/không, bằng chứng) vào `aws/README.md`.

- [ ] **Step 6: Commit**

```bash
git add aws/README.md
git commit -m "docs(aws): ghi moc baseline va ket qua nghiem thu 12 tieu chi"
```

---

## Ghi chú thực thi

- **Đầu vào phải có trước Task 4:** Cloudflare Origin Certificate; `R2_*`; `ADMIN_DASHBOARD_KEY`; `GHCR` PAT read-only; `SMTP_*`. (Không tạo AWS Budgets — đã quyết bỏ.)
- Thao tác AWS chạy qua AWS MCP trong phiên này (account đã đăng nhập); thao tác repo chạy cục bộ.
- Sau Task 8, máy vẫn tính phí ~24 USD/tháng; muốn tạm dừng mà giữ dữ liệu thì `stop-instances` (không `terminate`), hoặc `bash aws/cleanup.sh` để xoá sạch.
