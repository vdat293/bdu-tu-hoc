#!/usr/bin/env bash
# =============================================================================
# BDU TỰ HỌC - DEPLOY TRÊN EC2 (AWS)
#
# Thứ tự bắt buộc (đảo thứ tự là mất an toàn dữ liệu):
#   1. preflight    : docker compose có, .env tồn tại, PostgreSQL reachable, git sạch
#   2. backup DB    : FAIL -> dừng, KHÔNG migrate
#   3. migrate      : đúng 1 lần, FAIL -> dừng, KHÔNG restart app
#   4. pull + up -d --no-build: IMAGE_TAG = short sha
#   5. healthcheck  : poll /api/health tối đa 90s, FAIL -> in hướng dẫn rollback
#   6. rollback hint: in lệnh quay lui cụ thể
#
# Migration KHÔNG nằm trong `command` của container nữa: `docker compose up`
# sẽ chạy migration mỗi lần restart, kể cả restart do sự cố. Migration giờ
# chỉ chạy ở bước 3 của script này, sau khi backup đã thành công.
#
# Script KHÔNG bao giờ in DATABASE_URL hay mật khẩu ra stdout. Mọi thao tác DB
# chạy bên trong container nên credential chỉ tồn tại trong env của container.
#
# Cách chạy:
#   cd /opt/bdu-tu-hoc && DEPLOY_SHA=$(git rev-parse HEAD) bash deploy/deploy.sh
#
# Biến môi trường (đều có giá trị mặc định):
#   DEPLOY_SHA                commit muốn deploy (mặc định: HEAD hiện tại)
#   DEPLOY_SYNC=0|1           có fetch + checkout về DEPLOY_SHA không (mặc định 1)
#   BACKUP_ARGS               đè cờ truyền cho `npm run db:backup` (mặc định tự dò)
#   APP_DIR                   thư mục app trên EC2 (mặc định /opt/bdu-tu-hoc)
#   HEALTH_URL                endpoint kiểm tra (mặc định http://127.0.0.1:3000/api/health)
#   HEALTH_TIMEOUT_SECONDS    tổng thời gian chờ (mặc định 90)
#   HEALTH_INTERVAL_SECONDS   nhịp giữa hai lần poll (mặc định 3)
# =============================================================================

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/bdu-tu-hoc}"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:3000/api/health}"
HEALTH_TIMEOUT_SECONDS="${HEALTH_TIMEOUT_SECONDS:-90}"
HEALTH_INTERVAL_SECONDS="${HEALTH_INTERVAL_SECONDS:-3}"
DEPLOY_SYNC="${DEPLOY_SYNC:-1}"
# Chỉ dùng khi phải probe từ trong container (máy EC2 không có curl/wget).
HEALTH_URL_INTERNAL="http://127.0.0.1:${HEALTH_PORT_INTERNAL:-3000}/api/health"

# Nhánh nguồn được deploy trước đó (dùng cho hướng dẫn rollback).
PREVIOUS_SHA=""
# Commit backup DB cuối cùng mà script biết (nếu tự dò được).
PREVIOUS_BACKUP_FILE=""

# -----------------------------------------------------------------------------
# Log / lỗi
# -----------------------------------------------------------------------------
timestamp() {
  date -u '+%Y-%m-%dT%H:%M:%SZ'
}

log() {
  printf '[%s] [deploy] %s\n' "$(timestamp)" "$*"
}

warn() {
  printf '[%s] [deploy][WARN] %s\n' "$(timestamp)" "$*" >&2
}

on_error() {
  local exit_code="$?"
  local failed_line="${1:-unknown}"
  warn "DỪNG ở dòng ${failed_line} (exit code ${exit_code}). App KHÔNG được deploy."
  print_rollback_hint
  exit "$exit_code"
}
trap 'on_error $LINENO' ERR

# Hướng dẫn rollback cụ thể, dùng khi deploy fail hoặc healthcheck fail.
print_rollback_hint() {
  local target_sha="${PREVIOUS_SHA:-<sha-cu>}"
  local backup_file="${PREVIOUS_BACKUP_FILE:-<duong-dan-file-backup>}"
  cat <<EOF

------------------------------------------------------------------
HƯỚNG DẪN ROLLBACK (chạy trên EC2, từng lệnh một)
------------------------------------------------------------------
1) Quay code về bản đang chạy tốt:
   cd "${APP_DIR}"
   git fetch --prune origin
   git checkout --detach ${target_sha}

2) Dựng lại app theo tag image cũ (KHÔNG migrate, KHÔNG build):
   sửa IMAGE_TAG trong .env thành tag cũ rồi:
   docker compose pull && docker compose up -d --no-build --remove-orphans

3) Nếu migration đã chạy và dữ liệu sai, khôi phục DB từ file backup
   (bước 2 của deploy LUÔN tạo backup trước khi migrate; bản bền nằm ở
   bucket R2 của BACKUP_R2_BUCKET, object có reason=pre-deploy):
   cd "${APP_DIR}"
   ls -1t "${APP_DIR}"/data/backups/*.dump "${APP_DIR}"/data/*.dump "${APP_DIR}"/backups/*.dump 2>/dev/null | head -n 10
   docker compose run --rm -e BDU_MAINTENANCE_ALLOW_PRODUCTION=1 bdu-hub \\
     npm run db:restore -- ${backup_file} --allow-production --yes

------------------------------------------------------------------
EOF
}

die() {
  warn "LỖI: $*"
  print_rollback_hint
  exit 1
}

# -----------------------------------------------------------------------------
# Bước 1 - preflight
# -----------------------------------------------------------------------------
preflight() {
  log "Bước 1/5: preflight"

  command -v docker >/dev/null 2>&1 || die "Không tìm thấy lệnh 'docker' trên EC2."
  docker compose version >/dev/null 2>&1 \
    || die "Không có docker compose v2 (plugin). Cài Docker Compose v2 rồi chạy lại."

  [ -d "$APP_DIR" ] || die "Thư mục app không tồn tại: ${APP_DIR}"
  cd "$APP_DIR"
  [ -f "docker-compose.yml" ] || die "Không thấy docker-compose.yml trong ${APP_DIR}"
  # .env giữ toàn bộ secret production; KHÔNG in nội dung file này.
  [ -f ".env" ] || die "Không thấy .env trong ${APP_DIR}. Deploy sẽ dừng để không chạy thiếu cấu hình."

  if ! docker compose exec -T postgres sh -c 'pg_isready -q -U "$POSTGRES_USER" -d "$POSTGRES_DB"' >/dev/null 2>&1; then
    die "PostgreSQL không phản hồi (container postgres chưa healthy). Chạy 'docker compose up -d postgres' rồi thử lại."
  fi
  log "  docker compose OK, .env OK, PostgreSQL reachable."

  # Cảnh báo (không chặn): nếu thiếu cấu hình backup thì bước 2 sẽ fail và deploy
  # dừng. Chỉ kiểm tra TÊN biến, KHÔNG in giá trị (trong đó có mật khẩu).
  if ! grep -qE '^BACKUP_DATABASE_URL=.+' .env 2>/dev/null; then
    warn "Trong .env chưa có BACKUP_DATABASE_URL -> bước 2 (backup bắt buộc) nhiều khả năng sẽ fail."
  fi
}

# Đồng bộ mã nguồn trên EC2 về DEPLOY_SHA. Nằm trong bước 1 vì image phải được
# build từ đúng commit sẽ deploy, không phải từ code cũ đang nằm trên đĩa.
sync_code() {
  PREVIOUS_SHA="$(git rev-parse HEAD 2>/dev/null || true)"

  if [ "$DEPLOY_SYNC" != "1" ]; then
    log "  Bỏ qua đồng bộ mã nguồn (DEPLOY_SYNC=0). Dùng code đang có trên đĩa."
    return 0
  fi

  git rev-parse --git-dir >/dev/null 2>&1 \
    || die "${APP_DIR} không phải git repo; không thể đồng bộ mã nguồn."

  local dirty_count
  dirty_count="$(git status --porcelain --untracked-files=no | wc -l | tr -d ' ')"
  if [ "$dirty_count" != "0" ]; then
    die "Có ${dirty_count} file tracked bị sửa cục bộ trong ${APP_DIR}. Commit hoặc stash trước khi deploy (nếu không, image sẽ chứa code ngoài git)."
  fi

  log "  Đồng bộ mã nguồn về ${DEPLOY_SHA:0:12} (code trước đó: ${PREVIOUS_SHA:0:12})"
  git fetch --prune --quiet origin
  git checkout --quiet --detach "$DEPLOY_SHA"
  log "  HEAD hiện tại: $(git rev-parse HEAD)"
}

# Lần deploy đầu tiên (hoặc sau khi xoá image) chưa có image để chạy
# backup/migrate. Kéo image từ GHCR trước, luôn theo DEPLOY_SHORT_SHA.
# KHÔNG build tại chỗ: t3a.small (2 GB) sẽ OOM với image có Chromium + .NET.
ensure_image() {
  local tag="${DEPLOY_SHORT_SHA:-}"
  [ -n "$tag" ] || die "Thiếu DEPLOY_SHORT_SHA để chọn image cần kéo."
  log "  Kéo image bdu-hub:${tag} từ GHCR (không build tại chỗ)."
  IMAGE_TAG="$tag" docker compose pull --quiet bdu-hub \
    || die "Không kéo được image ${tag} từ GHCR. Kiểm 'docker login ghcr.io' trên EC2 và image của commit này đã được build chưa."
}

# -----------------------------------------------------------------------------
# Bước 2 - backup DB bắt buộc
# -----------------------------------------------------------------------------
# Ghi đè cờ backup bằng BACKUP_ARGS nếu cần; mặc định dùng `--pre-deploy`, cờ
# thật của scripts/db-backup.js (alias của --reason pre-deploy).
backup_args() {
  if [ -n "${BACKUP_ARGS:-}" ]; then
    # shellcheck disable=SC2206 # cần tách có chủ ý thành nhiều tham số
    printf '%s\n' ${BACKUP_ARGS}
  else
    printf '%s\n' --pre-deploy
  fi
}

backup_database() {
  log "Bước 2/5: backup DB (bắt buộc trước khi migrate)"

  local args=()
  # Dùng while read thay vì mapfile để không phụ thuộc bash 4+.
  while IFS= read -r detected; do
    [ -n "$detected" ] && args+=("$detected")
  done < <(backup_args)
  [ "${#args[@]}" -eq 0 ] || log "  Cờ backup: ${args[*]}"

  # Script backup tự xoá bản local sau khi R2 verify OK, nên "chạy exit 0"
  # KHÔNG đồng nghĩa với "còn bản sao lưu". Ta bắt buộc phải xác định được
  # bản bền trước khi đi tiếp:
  #   - ưu tiên bản trên R2 (đã được HEAD xác nhận), hoặc
  #   - bản local trong volume ./data/backups (được mount vào container).
  # Không có một trong hai thì DỪNG — không migrate production.
  local summary_file
  summary_file="$(mktemp)"
  if ! docker compose run --rm --no-deps bdu-hub npm run db:backup -- "${args[@]}" 2>&1 | tee "$summary_file"; then
    rm -f "$summary_file"
    die "Backup DB thất bại. DỪNG, không migrate và không restart app. Sửa nguyên nhân backup rồi chạy lại."
  fi

  local uploaded="false"
  if grep -q '"uploaded"[[:space:]]*:[[:space:]]*true' "$summary_file"; then
    uploaded="true"
  fi
  rm -f "$summary_file"

  PREVIOUS_BACKUP_FILE="$(ls -1t data/backups/*.dump 2>/dev/null | head -n 1 || true)"

  if [ "$uploaded" != "true" ] && [ -z "$PREVIOUS_BACKUP_FILE" ]; then
    die "Backup KHÔNG còn bản bền nào để quay lui (uploaded=false và không có file trong data/backups/). DỪNG, không migrate. Cần BACKUP_R2_BUCKET hoặc sửa BACKUP_LOCAL_DIR rồi chạy lại."
  fi

  log "  Backup xong. Bền vững: ${uploaded}R2 object có reason=pre-deploy${PREVIOUS_BACKUP_FILE:+, bản local ${PREVIOUS_BACKUP_FILE}}."
}

# -----------------------------------------------------------------------------
# Bước 3 - migrate đúng 1 lần
# -----------------------------------------------------------------------------
migrate_database() {
  log "Bước 3/5: migrate (1 lần duy nhất, sau khi backup thành công)"
  if ! docker compose run --rm --no-deps bdu-hub npm run db:migrate; then
    die "Migration thất bại. DỪNG, app cũ vẫn đang chạy và chưa bị restart. Xem log migration rồi hoặc rollback."
  fi
  log "  Migration xong."
}

# -----------------------------------------------------------------------------
# Bước 4 - build + up
# -----------------------------------------------------------------------------
start_app() {
  log "Bước 4/5: docker compose pull + up -d (IMAGE_TAG=${DEPLOY_SHORT_SHA}, --no-build)"
  # --no-build là BẮT BUỘC: docker-compose.yml gốc vẫn khai `build:`, thiếu cờ
  # này thì Compose sẽ build image ~5 GB trên máy 2 GB => OOM.
  IMAGE_TAG="$DEPLOY_SHORT_SHA" docker compose pull --quiet
  IMAGE_TAG="$DEPLOY_SHORT_SHA" docker compose up -d --remove-orphans --no-build
}

# -----------------------------------------------------------------------------
# Bước 5 - healthcheck
# -----------------------------------------------------------------------------
# Trả về HTTP status code (200 = khoẻ), không in body để tránh lộ dữ liệu.
probe_health() {
  local status=""
  if command -v curl >/dev/null 2>&1; then
    status="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$HEALTH_URL" 2>/dev/null)" || status=""
  elif command -v wget >/dev/null 2>&1; then
    if wget -q -T 5 -O /dev/null "$HEALTH_URL" >/dev/null 2>&1; then
      status="200"
    fi
  elif docker compose exec -T bdu-hub node -e \
      "fetch('${HEALTH_URL_INTERNAL}').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" \
      >/dev/null 2>&1; then
    # EC2 không có curl/wget: image là Node nên hỏi Node trong container.
    status="200"
  fi
  printf '%s' "${status:-000}"
}

wait_healthy() {
  log "Bước 5/5: healthcheck ${HEALTH_URL} (tối đa ${HEALTH_TIMEOUT_SECONDS}s, poll ${HEALTH_INTERVAL_SECONDS}s)"
  local deadline=$((SECONDS + HEALTH_TIMEOUT_SECONDS))
  local attempt=0
  local status="000"

  while [ "$SECONDS" -lt "$deadline" ]; do
    attempt=$((attempt + 1))
    status="$(probe_health)"
    if [ "$status" = "200" ]; then
      log "  App healthy sau ${attempt} lần poll (${SECONDS}s kể từ lúc bắt đầu script). Deploy hoàn tất."
      return 0
    fi
    log "  Lần ${attempt}: HTTP ${status} tại ${HEALTH_URL}, thử lại sau ${HEALTH_INTERVAL_SECONDS}s..."
    sleep "$HEALTH_INTERVAL_SECONDS"
  done

  warn "App KHÔNG healthy sau ${HEALTH_TIMEOUT_SECONDS}s (HTTP ${status})."
  warn "Xem log trước khi quyết định rollback:"
  warn "  docker compose logs --tail=200 bdu-hub"
  print_rollback_hint
  exit 1
}

# -----------------------------------------------------------------------------
# Main
# -----------------------------------------------------------------------------
main() {
  log "Bắt đầu deploy trong ${APP_DIR}"

  DEPLOY_SHA="${DEPLOY_SHA:-$(git -C "$APP_DIR" rev-parse HEAD 2>/dev/null || true)}"
  case "$DEPLOY_SHA" in
    "" | *[!0-9a-fA-F]*)
      die "DEPLOY_SHA phải là commit SHA hợp lệ (hex). Nhận được giá trị rỗng/không hợp lệ."
      ;;
  esac
  DEPLOY_SHORT_SHA="$(printf '%s' "$DEPLOY_SHA" | cut -c1-12)"

  preflight
  sync_code
  ensure_image

  backup_database
  migrate_database
  start_app
  wait_healthy

  log "Deploy ${DEPLOY_SHORT_SHA} thành công."
  log "Lưu ý: app chỉ có 1 replica (WebSocket nằm trong process Node) nên có downtime vài giây lúc restart."
}

main "$@"
