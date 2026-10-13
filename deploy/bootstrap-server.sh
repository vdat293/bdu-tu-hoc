#!/usr/bin/env bash
# =============================================================================
# BDU TỰ HỌC - BOOTSTRAP EC2 (CHẠY ĐÚNG MỘT LẦN)
#
# Điều kiện trước khi chạy:
#   - Repo đã được clone vào APP_DIR và đang ở đúng commit cần deploy.
#   - `.env` đã có đủ biến (script kiểm, không in giá trị).
#   - File dump dữ liệu đã được copy lên APP_DIR/data/ (mặc định
#     data/vps_sync_20260919.sql).
#   - Cert Cloudflare đã có ở $CERTS_SRC (mặc định ~/cloudflare: cert.pem + cert.key).
#
# Script làm:
#   1. kiểm điều kiện  2. pull image GHCR  3. dựng postgres
#   4. từ chối nếu DB đã có ledger  5. nạp dump
#   6. lấy fingerprint DB đích  7. baseline (ghi ledger, KHÔNG chạy SQL)
#   8. migrate phần còn lại  9. kiểm fingerprint với DB sạch
#  10. đặt cert vào deploy/caddy/certs  11. up -d + healthcheck
#
# Vì sao phải baseline: dump không có bảng `public.schema_migrations`, nên nếu
# chạy migrate trực tiếp script sẽ từ chối (MIGRATION_BASELINE_REQUIRED). Baseline
# đánh dấu các migration cũ "đã áp dụng" mà không chạy lại SQL, rồi migrate chỉ
# chạy phần mới hơn. Bước 9 chứng minh mốc chọn là đúng.
#
# Biến có thể đè: APP_DIR, DUMP_FILE, BASELINE_VERSION, CERTS_SRC, HEALTH_TIMEOUT.
# =============================================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/bdu-tu-hoc}"
DUMP_FILE="${DUMP_FILE:-data/vps_sync_20260919.sql}"
BASELINE_VERSION="${BASELINE_VERSION:-43}"
CERTS_SRC="${CERTS_SRC:-$HOME/cloudflare}"
FRESH_DB="bdu_fresh"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"

timestamp() { date -u '+%Y-%m-%dT%H:%M:%SZ'; }
log()  { printf '[%s] [bootstrap] %s\n' "$(timestamp)" "$*"; }
warn() { printf '[%s] [bootstrap][WARN] %s\n' "$(timestamp)" "$*" >&2; }
die()  { printf '[%s] [bootstrap][ERROR] %s\n' "$(timestamp)" "$*" >&2; exit 1; }
ok()   { printf '[%s] [bootstrap][ OK ] %s\n' "$(timestamp)" "$*"; }

# psql trong container postgres (không in mật khẩu). Truyền SQL bằng chuỗi trích
# dẫn tường minh ngay tại chỗ gọi, tránh để shell diễn giải dấu ngoặc/`*`.
psql_q() { docker compose exec -T postgres sh -c "$1" | tr -d '\r'; }

cd "$APP_DIR" || die "Không vào được APP_DIR=$APP_DIR"

# docker compose tự đọc .env, nhưng script cũng cần vài biến để dựng tham số.
# Đọc tường minh thay vì `source .env` để tránh thực thi nội dung lạ trong file.
POSTGRES_DB="$(grep -m1 '^POSTGRES_DB=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r')"
POSTGRES_USER="$(grep -m1 '^POSTGRES_USER=' .env 2>/dev/null | cut -d= -f2- | tr -d '\r')"
[ -n "${POSTGRES_DB:-}" ] && [ -n "${POSTGRES_USER:-}" ] \
  || die "Thiếu POSTGRES_DB/POSTGRES_USER trong .env."

# -----------------------------------------------------------------------------
# 1. Điều kiện
# -----------------------------------------------------------------------------
log "Bước 1/11: kiểm điều kiện"
docker compose version >/dev/null 2>&1 || die "Thiếu docker compose v2."
[ -f .env ] || die "Thiếu .env trong $APP_DIR."
[ -f docker-compose.yml ] || die "Không thấy docker-compose.yml — repo chưa được clone?"
[ -f "$DUMP_FILE" ] || die "Không thấy file dump: $APP_DIR/$DUMP_FILE"

missing=""
# BACKUP_R2_BUCKET KHÔNG bắt buộc: db-backup.js vẫn dump ra file local khi thiếu
# R2 (uploaded=false) và deploy.sh chấp nhận file local làm bản backup bền.
for k in POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL MIGRATION_DATABASE_URL \
         IMAGE_TAG COMPOSE_FILE BACKUP_DATABASE_URL \
         BDU_MAINTENANCE_ALLOW_PRODUCTION WS_ALLOWED_ORIGINS; do
  grep -q "^${k}=." .env || missing="$missing $k"
done
[ -z "$missing" ] || die "Thiếu hoặc rỗng trong .env:$missing"
grep -q '^BACKUP_R2_BUCKET=.' .env || warn "Chưa có BACKUP_R2_BUCKET: backup chỉ nằm local (+ DLM snapshot). Thêm sau nếu muốn bản off-site."
ok "Điều kiện đạt ($(git rev-parse --short HEAD))"

# -----------------------------------------------------------------------------
# 2. Kéo image
# -----------------------------------------------------------------------------
log "Bước 2/11: kéo image theo IMAGE_TAG trong .env"
docker compose pull --quiet || die "Không kéo được image từ GHCR (đã 'docker login ghcr.io' chưa?)."
ok "Đã kéo image"

# -----------------------------------------------------------------------------
# 3. Dựng postgres
# -----------------------------------------------------------------------------
log "Bước 3/11: dựng postgres"
docker compose up -d postgres
for _ in $(seq 1 30); do
  if docker compose exec -T postgres sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    ok "postgres healthy"; break
  fi
  sleep 3
done
docker compose exec -T postgres sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1 \
  || die "postgres không lên."

# -----------------------------------------------------------------------------
# 4. Từ chối nếu đã bootstrap
# -----------------------------------------------------------------------------
log "Bước 4/11: kiểm ledger"
# Chỉ từ chối khi ledger ĐÃ CÓ BẢN GHI (tức baseline/migrate đã chạy). Ledger
# tồn tại nhưng rỗng (vừa tạo ở bước 5b của lần chạy lỗi trước) thì vẫn cho chạy
# lại — nạp lại dump là idempotent và ledger vẫn rỗng.
ledger_count="$(docker compose exec -T postgres sh -c \
  'psql -tAc "select count(*) from public.schema_migrations" -U "$POSTGRES_USER" -d "$POSTGRES_DB" 2>/dev/null' \
  2>/dev/null | tr -d '[:space:]' || true)"
[ -z "$ledger_count" ] && ledger_count=0
[ "$ledger_count" = "0" ] \
  || die "DB đã bootstrap rồi (ledger có $ledger_count bản ghi) — KHÔNG nạp lại dump."
ok "Ledger rỗng, chưa bootstrap"

# -----------------------------------------------------------------------------
# 5. Nạp dump
# -----------------------------------------------------------------------------
log "Bước 5/11: nạp dump $DUMP_FILE"
docker compose exec -T postgres sh -c \
  'psql --single-transaction --set=ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < "$DUMP_FILE" >/dev/null
rows="$(psql_q 'psql -tAc "select count(*) from public.students" -U "$POSTGRES_USER" -d "$POSTGRES_DB"')"
ok "Nạp xong. students=$rows"

# -----------------------------------------------------------------------------
# 5b. Tạo bảng ledger TRƯỚC khi đo fingerprint
# -----------------------------------------------------------------------------
# runMigrations() gọi ensureLedger() (tạo public.schema_migrations) RỒI mới so
# fingerprint. Vì vậy fingerprint dùng cho baseline phải được đo khi bảng ledger
# ĐÃ tồn tại, nếu không sẽ luôn lệch (MIGRATION_BASELINE_FINGERPRINT_MISMATCH).
# DDL dưới đây chép đúng từ scripts/migration-ledger.mjs::ensureLedger.
log "Bước 5b/11: tạo bảng ledger (không ghi bản ghi nào)"
docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null <<'SQL'
CREATE TABLE IF NOT EXISTS public.schema_migrations (
  version INTEGER PRIMARY KEY,
  filename TEXT NOT NULL UNIQUE,
  checksum_sha256 TEXT NOT NULL CHECK (checksum_sha256 ~ '^[0-9a-f]{64}$'),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  execution_ms INTEGER NOT NULL CHECK (execution_ms >= 0),
  applied_by TEXT NOT NULL DEFAULT CURRENT_USER
);
SQL
ok "Ledger đã tồn tại (rỗng)"

# -----------------------------------------------------------------------------
# 6. Fingerprint DB đích (giá trị này baseline BẮT BUỘC khớp)
# -----------------------------------------------------------------------------
log "Bước 6/11: fingerprint schema DB đích"
fp_target="$(docker compose run --rm --no-deps bdu-hub npm run --silent db:migration:fingerprint | tr -d '\r' | tail -n 1)"
[[ "$fp_target" =~ ^[a-f0-9]{64}$ ]] || die "Fingerprint DB đích không hợp lệ: '$fp_target'"
ok "fp_target=$fp_target"

# -----------------------------------------------------------------------------
# 7. Baseline (ghi ledger 001..BASELINE_VERSION, KHÔNG chạy SQL)
# -----------------------------------------------------------------------------
log "Bước 7/11: baseline qua version $BASELINE_VERSION"
docker compose run --rm --no-deps \
  -e BDU_MIGRATION_BASELINE_CONFIRM=1 \
  -e BDU_MIGRATION_BASELINE_THROUGH_VERSION="$BASELINE_VERSION" \
  -e BDU_MIGRATION_BASELINE_CONFIRM_DATABASE="$POSTGRES_DB" \
  -e BDU_MIGRATION_BASELINE_CONFIRM_TARGET="postgres:5432/$POSTGRES_DB" \
  -e BDU_MIGRATION_BASELINE_CONFIRM_FINGERPRINT="$fp_target" \
  -e BDU_MAINTENANCE_ALLOW_PRODUCTION=1 \
  bdu-hub npm run db:migrate:baseline -- --yes \
  || die "Baseline thất bại (fingerprint/mốc không khớp?). Thử BASELINE_VERSION khác."
ok "Baseline xong"

# -----------------------------------------------------------------------------
# 8. Migrate phần mới hơn
# -----------------------------------------------------------------------------
log "Bước 8/11: migrate phần còn lại"
docker compose run --rm --no-deps bdu-hub npm run db:migrate || die "Migrate thất bại."
ok "Migrate xong"

# -----------------------------------------------------------------------------
# 9. Chứng minh mốc đúng: DB sạch migrate 001→hết phải trùng fingerprint
# -----------------------------------------------------------------------------
log "Bước 9/11: đối chiếu với DB sạch ($FRESH_DB)"
docker compose exec -T postgres sh -c \
  'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE IF EXISTS '"$FRESH_DB"'" -c "CREATE DATABASE '"$FRESH_DB"'"' >/dev/null
fresh_url="$(grep '^MIGRATION_DATABASE_URL=' .env | head -n1 | cut -d= -f2- | sed "s#/[^/]*\$#/$FRESH_DB#")"
[[ "$fresh_url" == *"$FRESH_DB"* ]] || die "Không dựng được URL cho $FRESH_DB."
docker compose run --rm --no-deps -e MIGRATION_DATABASE_URL="$fresh_url" bdu-hub \
  npm run --silent db:migrate >/dev/null || die "Migrate DB sạch thất bại."
fp_fresh="$(docker compose run --rm --no-deps -e MIGRATION_DATABASE_URL="$fresh_url" bdu-hub \
  npm run --silent db:migration:fingerprint | tr -d '\r' | tail -n 1)"
# PHẢI đo lại fingerprint của DB đích SAU migrate: giá trị fp_target ở bước 6 là
# trạng thái TRƯỚC migrate (dùng cho baseline), so nó với DB sạch là sai.
fp_after="$(docker compose run --rm --no-deps bdu-hub \
  npm run --silent db:migration:fingerprint | tr -d '\r' | tail -n 1)"

log "  fp_baseline (trước migrate) = $fp_target"
log "  fp_after    (sau migrate)   = $fp_after"
log "  fp_fresh    (001..056)      = $fp_fresh"
if [ "$fp_after" != "$fp_fresh" ]; then
  warn "Fingerprint LỆCH. KHÔNG chạy 'up -d' toàn bộ."
  warn "Cách sửa: DROP DATABASE $POSTGRES_DB, tạo lại, nạp lại dump, thử BASELINE_VERSION khác (ví dụ 42 hoặc 44)."
  die "Dừng vì fingerprint lệch — cần người quyết định mốc baseline."
fi
docker compose exec -T postgres sh -c \
  'psql -U "$POSTGRES_USER" -d postgres -c "DROP DATABASE '"$FRESH_DB"'"' >/dev/null
ok "Fingerprint trùng khít — mốc $BASELINE_VERSION đúng"

# -----------------------------------------------------------------------------
# 10. Đặt cert Cloudflare
# -----------------------------------------------------------------------------
log "Bước 10/11: đặt cert Cloudflare vào deploy/caddy/certs"
mkdir -p deploy/caddy/certs
if [ -f "$CERTS_SRC/cert.pem" ] && [ -f "$CERTS_SRC/cert.key" ]; then
  cp "$CERTS_SRC/cert.pem" deploy/caddy/certs/origin.pem
  cp "$CERTS_SRC/cert.key" deploy/caddy/certs/origin.key
  chmod 644 deploy/caddy/certs/origin.pem
  chmod 600 deploy/caddy/certs/origin.key
fi
[ -f deploy/caddy/certs/origin.pem ] || die "Thiếu deploy/caddy/certs/origin.pem"
[ -f deploy/caddy/certs/origin.key ] || die "Thiếu deploy/caddy/certs/origin.key"
if command -v openssl >/dev/null 2>&1; then
  a="$(openssl x509 -in deploy/caddy/certs/origin.pem -noout -pubkey | sha256sum | cut -d' ' -f1)"
  b="$(openssl pkey -in deploy/caddy/certs/origin.key -pubout | sha256sum | cut -d' ' -f1)"
  [ "$a" = "$b" ] || die "Cert và key KHÔNG khớp cặp."
  ok "Cert/key khớp cặp"
fi

# -----------------------------------------------------------------------------
# 11. Dựng toàn bộ + healthcheck
# -----------------------------------------------------------------------------
log "Bước 11/11: dựng toàn bộ stack (không build)"
docker compose up -d --no-build

log "Chờ /api/health (tối đa ${HEALTH_TIMEOUT}s)..."
deadline=$((SECONDS + HEALTH_TIMEOUT))
while [ "$SECONDS" -lt "$deadline" ]; do
  if docker compose exec -T bdu-hub node -e \
      "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
    ok "App healthy"
    docker compose ps
    log "XONG. Kiểm tiếp: curl -s https://sv.bdu.io.vn/api/health"
    exit 0
  fi
  sleep 5
done
warn "App không healthy sau ${HEALTH_TIMEOUT}s."
docker compose logs --tail=120 bdu-hub || true
die "Healthcheck thất bại."
