# Runbook Sao lưu & Khôi phục Database — BDU Tự Học

> Hệ thống backup PostgreSQL lên Cloudflare R2. Tài liệu này viết theo **đúng script đang có trong repo**; mọi tên file, tên cờ CLI và tên biến môi trường đều được đối chiếu với mã nguồn.
>
> Runbook deploy/rollback: [`deployment-runbook.md`](deployment-runbook.md).

---

## 0. Ba câu hỏi cần trả lời được trước khi đọc tiếp

1. **Tần lớp nào trong `scripts/db-backup*.js` chạy tự động?** → Scheduler nằm trong service Docker `bdu-db-backup` (mục 3).
2. **Backup có thực sự khôi phục được không?** → Chỉ trả lời được bằng restore drill (mục 6). Đây là câu hỏi quan trọng nhất của toàn bộ tài liệu.
3. **Khi cần khôi phục thật, chạy lệnh nào?** → `db:restore` với `--allow-production --yes` (mục 7).

---

## 1. Kiến trúc hệ thống backup

| Thành phần | Nơi chạy | Nhiệm vụ |
| :--- | :--- | :--- |
| `scripts/db-backup.js` | container `bdu-hub`, gọi bởi deploy hoặc scheduler | `pg_dump --format=custom --compress=9 --no-owner --no-privileges` → file local 0600 → fsync → SHA-256 → manifest → `rename` atomic → upload R2 → verify bằng `HeadObject` → xoá bản local |
| `scripts/db-backup-scheduler.js` | service `bdu-db-backup` | Tự tính giờ tới lần chạy kế tiếp rồi `setTimeout`; gọi `db-backup.js`, nếu thành công mới gọi `db-backup-rotate.js` |
| `scripts/db-backup-rotate.js` | gọi bởi scheduler | Retention 3 tầng (daily / weekly / monthly) trên R2 |
| `scripts/db-backup-verify.js` | **chạy tay** | Restore drill: tải bản mới nhất từ R2 → kiểm SHA-256 → `createdb` → `pg_restore` → đếm bản ghi → `dropdb` |
| `scripts/db-backup-shared.js` | thư viện dùng chung | Hàng rào an toàn: key pattern, bucket riêng, `redactForLog` |
| `scripts/postgres-utils.js` | thư viện dùng chung | Hàng rào chung cho mọi thao tác maintenance DB |

Luồng dữ liệu:

```
                       deploy.sh bước 2            scheduler (BACKUP_CRON)
                              │                            │
                              └──────────► db-backup.js ◄───┘
                                             │
                          ┌──────────────────┼──────────────────┐
                          ▼                  ▼                  ▼
                    data/*.dump          upload R2         db-backup-rotate.js
                  (0600, tạm)         s3://<BACKUP_R2_BUCKET>   (xoá bản cũ)
                          │                   db/YYYY/MM/...dump
                    xoá sau khi               + .manifest.json
                    verify R2 OK                    │
                                                     ▼
                                            db-backup-verify.js (drill, chạy tay)
```

**Định dạng object trên R2** (do `buildBackupKeys()` sinh ra):
- `db/YYYY/MM/YYYYMMDDTHHMMSSZ-<sha8>.dump`
- `db/YYYY/MM/YYYYMMDDTHHMMSSZ-<sha8>.dump.manifest.json`

Manifest có `format: "bdu-postgres-dump"`, `version: 1`, `database`, `createdAt`, `size`, `sha256`. `sha8` trong tên object chính là 8 ký tự đầu của SHA-256.

---

## 2. Cấu hình `.env` cho production

Biến nào **đã** có trong `.env.example` (phần "Sao lưu PostgreSQL"): `BACKUP_DATABASE_URL`, `BACKUP_ENABLED`, `BACKUP_CRON`, `BACKUP_RETENTION_DAILY/WEEKLY/MONTHLY`, `BACKUP_R2_BUCKET`, `DRILL_DATABASE_URL`, `BDU_MAINTENANCE_ALLOW_PRODUCTION`.

Các biến **chỉ đọc được từ mã nguồn**, không có trong `.env.example` (đều chạy được vì script đọc trực tiếp `process.env`): `BACKUP_ALLOW_PRODUCTION`, `BACKUP_REASON`, `BACKUP_ALERT_AFTER`, `BACKUP_ALERT_FILE`, `BACKUP_LOCAL_DIR`, `BACKUP_RETAIN_DAILY/WEEKLY/MONTHLY`, `BACKUP_ROTATE_MAX_DELETE`, `DRILL_DATABASE_NAME`, `ALLOW_REMOTE_DRILL`. Muốn đặt giá trị thì thêm vào `.env` **và** khai báo trong `environment` của service tương ứng trong `docker-compose.yml`, nếu không container sẽ không nhìn thấy.

### 2.1. Bắt buộc

> Tất cả biến trong bảng này đều có trong `.env.example` và được truyền vào container `bdu-db-backup` qua `docker-compose.yml`.

| Biến | Ý nghĩa | Ghi chú |
| :--- | :--- | :--- |
| `BACKUP_DATABASE_URL` | URL PostgreSQL của **role backup chỉ đọc** | `db-backup.js` **không có fallback** về `DATABASE_URL`. Còn thiếu là script exit 1 ngay. Không dùng `DATABASE_URL` của app (app user có quyền ghi). |
| `BACKUP_R2_BUCKET` | Bucket R2 **riêng** cho backup | `assertDedicatedBackupBucket()` **ném lỗi** nếu trùng `R2_BUCKET` (bucket media). Thiếu biến này thì vẫn tạo bản local nhưng bước upload bị từ chối và script exit 1. |
| `R2_ENDPOINT` hoặc `R2_ACCOUNT_ID` | Endpoint S3-compatible của R2 | Bỏ trống `R2_ENDPOINT` thì suy ra `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com`. |
| `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` | Credential R2 | Cần quyền **Object Read & Write** cho đúng `BACKUP_R2_BUCKET`. |

### 2.2. Bật scheduler

> `BACKUP_ENABLED`, `BACKUP_CRON` có trong `.env.example`; `BACKUP_ALLOW_PRODUCTION` không có (chỉ đọc từ mã nguồn).

| Biến | Giá trị khuyến nghị | Ghi chú |
| :--- | :--- | :--- |
| `BACKUP_ENABLED` | `1` | **Mặc định TẮT.** Scheduler in log "BACKUP_ENABLED không bằng 1" rồi thoát với code 0 nếu biến này khác `1`. Giá trị được đọc bằng `envFlag()` — chấp nhận `1/true/yes/on`. |
| `BACKUP_CRON` | `03:17` | Định dạng `HH:MM` hoặc `HH:MM:SS` theo **giờ máy chủ** (không phải biểu thức cron). Mặc định `03:17`. Cố ý lệch phút so với `RANKING_SYNC_HOUR=3` để không dồn job. Giá tr sai format làm scheduler fail với thông báo rõ ràng. |
| `BACKUP_ALLOW_PRODUCTION` | xem mục 2.3 | Cho phép scheduler truyền `--allow-production` xuống `db-backup.js`. |
| `BDU_MAINTENANCE_ALLOW_PRODUCTION` | `1` | Hàng rào dùng chung của `scripts/postgres-utils.js`. Scheduler in cảnh báo nếu `BACKUP_ALLOW_PRODUCTION=1` mà thiếu biến này. |

### 2.3. Về `BACKUP_ALLOW_PRODUCTION` trên topology Compose mặc định

`assertSafeMaintenanceTarget()` trong `scripts/postgres-utils.js` coi host nằm trong allowlist
`127.0.0.1`, `::1`, `localhost`, `postgres`, `test-postgres` là **local**. Trong Compose mặc định, `BACKUP_DATABASE_URL` trỏ tới service `postgres`, tức là host `postgres` — **không cần** `--allow-production` và `BDU_MAINTENANCE_ALLOW_PRODUCTION=1` cho backup định kỳ.

Chỉ cần cả hai khi `BACKUP_DATABASE_URL` trỏ tới host **ngoài** allowlist (PostgreSQL quản lý, host khác trong VPS). Khi đó:

```bash
# Nếu database production không local với container, cần cả hai:
BACKUP_ALLOW_PRODUCTION=1
BDU_MAINTENANCE_ALLOW_PRODUCTION=1
```

Cả `BACKUP_ALLOW_PRODUCTION` và `BACKUP_LOCAL_DIR` **đã** được khai báo trong `environment` của service `bdu-db-backup` (và `BACKUP_LOCAL_DIR` cho cả `bdu-hub` vì `deploy.sh` gọi backup qua service đó). Không cần truyền `-e` khi chạy thủ công.

### 2.4. Retention

> `BACKUP_RETENTION_*` có trong `.env.example`; `BACKUP_RETAIN_*` và `BACKUP_ROTATE_MAX_DELETE` không có (chỉ đọc từ mã nguồn).

| Biến | Mặc định | Ghi chú |
| :--- | :--- | :--- |
| `BACKUP_RETENTION_DAILY` | `7` | Số bản mới nhất giữ lại |
| `BACKUP_RETENTION_WEEKLY` | `4` | Số tuần giữ lại |
| `BACKUP_RETENTION_MONTHLY` | `6` | Số tháng giữ lại |
| `BACKUP_RETAIN_DAILY/WEEKLY/MONTHLY` | — | Tên viết tắt tương đương; `BACKUP_RETENTION_*` được ưu tiên |
| `BACKUP_ROTATE_MAX_DELETE` | `1000` | Trần số object xoá mỗi lần (khoảng 500–5000). Vượt trần → rotate dừng lại, yêu cầu kiểm tra tay |

### 2.5. Cho drill

> `DRILL_DATABASE_URL` có trong `.env.example`; `DRILL_DATABASE_NAME` và `ALLOW_REMOTE_DRILL` không có (chỉ đọc từ mã nguồn).

| Biến | Ghi chú |
| :--- | :--- |
| `DRILL_DATABASE_URL` | URL của role **có quyền `CREATEDB`** (database quản trị, thường là `postgres`). Role backup chỉ đọc thì **không đủ**. URL chỉ được chứa query `sslmode` / `connect_timeout` / `application_name`. |
| `DRILL_DATABASE_NAME` | Mặc định `bdu_restore_drill`. **Bắt buộc kết thúc bằng `_drill`** — script từ chối nếu không. |
| `ALLOW_REMOTE_DRILL` | Chỉ khi host drill không nằm trong allowlist local. Với remote còn cần thêm `BDU_MAINTENANCE_ALLOW_PRODUCTION=1`. |

⚠️ `DRILL_DATABASE_URL` **không** được khai báo trong `environment` của bất kỳ service nào (docker-compose.yml chỉ nhắc tên nó ở comment), nên phải truyền kèm lúc chạy:
`docker compose run --rm -e DRILL_DATABASE_URL=... bdu-hub npm run db:backup:verify`.

---

## 3. Bật service `bdu-db-backup`

Service này đã có sẵn trong `docker-compose.yml` với `container_name: bdu-tu-hoc-db-backup` và `command: ["node", "scripts/db-backup-scheduler.js"]`.

Tách riêng khỏi `bdu-hub` vì ba lý do ghi trong file compose:
- `pg_dump` nặng, không nên giành CPU của app.
- App restart không được làm mất lịch backup.
- Bật/tắt độc lập.

```bash
# 1) Điền .env production (mục 2), đặc biệt BACKUP_ENABLED=1
# 2) Bật service
docker compose up -d bdu-db-backup

# 3) Xem log scheduler
docker compose logs -f bdu-db-backup
```

Log lành mạnh khi bật đúng sẽ có các dòng kiểu:
```
[...] [db-backup-scheduler] Scheduler ON. Giờ chạy 03:17:00 (giờ máy, <timezone>).
[...] [db-backup-scheduler] Retention: daily=7, weekly=4, monthly=6. Cảnh báo sau 3 lần fail liên tiếp.
[...] [db-backup-scheduler] Lần chạy kế tiếp: <ngày mai> (sau 12h34m56s).
```

Nếu thấy `BACKUP_ENABLED không bằng 1 → scheduler KHÔNG chạy` thì container thoát với code 0 và sẽ restart-loop. Sửa `.env` rồi `docker compose up -d bdu-db-backup`.

**Chạy thử một chu kỳ ngay** (hữu ích sau khi mới cấu hình, không cần chờ tới giờ `BACKUP_CRON`):

```bash
docker compose run --rm bdu-db-backup node scripts/db-backup-scheduler.js --once
```

Scheduler chỉ gọi `db-backup-rotate.js` **khi backup thành công** — nếu pipeline hỏng thì giữ nguyên các bản cũ còn hiệu lực thay vì xoá dần tài sản dự phòng.

### Cảnh báo fail

- `BACKUP_ALERT_AFTER` (mặc định `3`): sau N lần fail liên tiếp, scheduler ghi cảnh báo.
- `BACKUP_ALERT_FILE` (mặc định `BACKUP_LOCAL_DIR`/`data` → `data/backup-alerts.log`): file log cảnh báo.
- Điều tra khi thấy cảnh báo: R2 còn quota? `BACKUP_DATABASE_URL` còn hiệu lực? `pg_dump` có chạy được không?

### Volume bản local

`bdu-db-backup` mount `./data/backups:/app/data/backups`. Tuy nhiên `BACKUP_LOCAL_DIR` mặc định là `data` (không phải `data/backups`) và **không** được truyền qua compose. Bản local tồn tại cho tới khi R2 verify xong rồi bị xoá, nên mất nó khi restart container không phải tổn thất dữ liệu — nhưng nếu muốn giữ bản local lâu hơn, hãy đặt `BACKUP_LOCAL_DIR=/app/data/backups` **và** khai báo biến đó trong `docker-compose.yml`.

---

## 4. Lịch backup & retention 3 tầng

Với cấu hình mặc định `BACKUP_CRON=03:17` và retention `7 / 4 / 6`:

| Tầng | Giữ | Ý nghĩa |
| :--- | :--- | :--- |
| **Daily** | 7 bản mới nhất | Luôn có dữ liệu của hôm nay và 6 ngày trước |
| **Weekly** | 4 tuần | Mỗi tuần một bản đại diện, **bỏ qua tuần đã có bản trong tầng daily** |
| **Monthly** | 6 tháng | Mỗi tháng một bản đại diện, **bỏ qua tháng đã có bản trong daily hoặc weekly** |

Cơ chế `selectKeepSet()` trong `db-backup-rotate.js` đi tuần tự: lấy 7 bản mới nhất vào tầng daily → quét danh sách để tìm các tuần chưa có mặt → đếm tầng weekly → tương tự cho tháng. Nhờ vậy **không** tốn thêm object cho các tuần/tháng đã được daily/weekly đại diện.

Số bản thực tế giữ lại **ít hơn** 7 + 4 + 6 = 17 vì có chồng lấn. Chạy `--dry-run` để xem chính xác:

```bash
docker compose run --rm bdu-db-backup node scripts/db-backup-rotate.js --dry-run
# in: ROTATE_SUMMARY {"total":N,"kept":M,"deleted":0,"dryRun":true}
```

Xoá thật:
```bash
docker compose run --rm bdu-db-backup node scripts/db-backup-rotate.js
```

### Bốn hàng rào an toàn của rotate

1. Chỉ liệt kê dưới tiền tố `db/`.
2. Chỉ xoá key khớp **đúng** `DUMP_KEY_PATTERN` / `MANIFEST_KEY_PATTERN` mà chính `db-backup.js` sinh ra. Object lạ do người dùng tự đẩy lên (kể cả trong cùng bucket) **không bao giờ** bị đụng tới. Ngoài ra key chứa `..` bị loại, và ngày không tồn tại (tháng 13) bị loại qua round-trip timestamp.
3. Nếu kế hoạch xoá **hết** bản backup thì dừng lại và exit 1.
4. Nếu số bản cần xoá vượt `BACKUP_ROTATE_MAX_DELETE` thì dừng lại và exit 1.

Rotate xoá theo **cặp**: xoá `.dump` và `.manifest.json` cùng lúc, nên không bao giờ còn manifest mồ côi.

---

## 5. Backup thủ công

```bash
# Nhãn lý do bắt buộc, chỉ nhận [A-Za-z0-9._:-], tối đa 64 ký tự
docker compose run --rm bdu-hub npm run db:backup -- --reason manual

# Giữ lại bản local sau khi upload (mặc định bản local bị xoá khi R2 verify OK)
docker compose run --rm bdu-hub npm run db:backup -- --reason pre-upgrade --output /app/temp/manual.dump

# Cờ do deploy.sh dùng (alias thật của --reason pre-deploy)
docker compose run --rm bdu-hub npm run db:backup -- --pre-deploy

# Host không local thì thêm cờ
docker compose run --rm -e BDU_MAINTENANCE_ALLOW_PRODUCTION=1 bdu-hub \
  npm run db:backup -- --reason manual --allow-production
```

| Cờ | Ý nghĩa |
| :--- | :--- |
| `--reason <label>` | **Bắt buộc.** Ghi vào log và vào metadata `bdu-reason` của object R2. Thiếu cờ này script in usage rồi exit 2. |
| `--output <path>` | Ghi bản local vào đường dẫn này và **giữ lại** sau khi upload. Dạng `--output=<path>` cũng được. |
| `--pre-deploy` | Alias thật, tương đương `--reason pre-deploy`. `deploy/deploy.sh` dùng cờ này. |
| `--allow-production` | Cho phép host không nằm trong allowlist local. Vẫn cần thêm `BDU_MAINTENANCE_ALLOW_PRODUCTION=1`. |
| `--help`, `-h` | In usage. |

Script in dòng JSON `BACKUP_SUMMARY {...}` ở cuối để CI hoặc log collector đọc được. Các trường: `reason`, `database`, `createdAt`, `size`, `sha256`, `localFile`, `dumpKey`, `manifestKey`, `uploaded`.

### Mã thoát

| Mã | Nghĩa |
| :--- | :--- |
| `0` | Thành công. Nếu R2 chưa cấu hình thì vẫn exit 0 nhưng `uploaded: false` và bản local **được giữ lại**. |
| `1` | Lỗi: thiếu `BACKUP_DATABASE_URL`, không tìm thấy `pg_dump`, `pg_dump` fail, upload/verify fail, hoặc `BACKUP_R2_BUCKET` trùng `R2_BUCKET`. Bản local luôn được giữ lại và log in ra đường dẫn. |
| `2` | Sai cú pháp CLI hoặc thiếu `--reason`. |
| `130` | Nhận `SIGINT`/`SIGTERM` giữa chừng: script dừng `pg_dump` và **xoá file tạm** để không để lại backup dở dang. |

### Quy tắc "không bao giờ ghi đè"

`db-backup.js` kiểm tra `HeadObject` trước khi upload. Nếu object đã tồn tại, nó **bỏ qua upload** và in cảnh báo, rồi vẫn verify. Kết hợp với việc key chứa timestamp + sha8, chạy backup hai lần trong cùng một giây cũng không mất dữ liệu.

---

## 6. Restore drill — vì sao quan trọng hơn việc "có file backup"

### 6.1. Bài toán thật

Một file `.dump` tồn tại trên R2 **không chứng minh** được rằng bạn sẽ khôi phục được dữ liệu. Những thứ có thể hỏng mà vẫn "có file":

- `pg_dump` chạy với quyền thiếu nên bỏ sót bảng mà không báo lỗi.
- Object trên R2 bị hỏng byte (checksum lưu trong manifest không còn khớp).
- `pg_restore` fail vì thiếu extension, thiếu quyền, hoặc do lỗi schema.
- Bản backup đã cũ hơn nhiều so với bản ghi mới nhất — khôi phục xong thì mất dữ liệu mấy ngày mà không ai biết.
- Bạn không có role `CREATEDB` để dựng database tạm kiểm thử.

Tất cả các lỗi trên **đều im lặng cho tới khi cần thật**. Restore drill biến "có thể là vận hành" thành "đã chứng minh chạy được lúc 03:00 hôm nay".

### 6.2. Chạy drill

```bash
# Drill bản daily mới nhất trên R2
docker compose run --rm \
  -e DRILL_DATABASE_URL='postgresql://bdu_admin:secret@postgres:5432/postgres' \
  bdu-hub npm run db:backup:verify

# Drill một bản cụ thể
docker compose run --rm \
  -e DRILL_DATABASE_URL='postgresql://bdu_admin:secret@postgres:5432/postgres' \
  bdu-hub npm run db:backup:verify -- --key db/2026/09/20260925T031700Z-a1b2c3d4.dump

# Giữ file tải về + database drill để soi thủ công
docker compose run --rm \
  -e DRILL_DATABASE_URL='postgresql://bdu_admin:secret@postgres:5432/postgres' \
  bdu-hub npm run db:backup:verify -- --keep
```

| Cờ | Ý nghĩa |
| :--- | :--- |
| `--key <objectKey>` | Chỉ định bản backup cụ thể. Mặc định: bản **mới nhất** dưới `db/`. Key sai pattern → từ chối ngay. |
| `--keep` | Giữ thư mục tạm + database drill. Mặc định xoá sau khi xong (kể cả khi drill fail). |
| `--help`, `-h` | In usage. |

### 6.3. Những gì drill kiểm tra (theo đúng thứ tự trong `db-backup-verify.js`)

1. R2 đã cấu hình và `BACKUP_R2_BUCKET` khác `R2_BUCKET`.
2. **Hàng rào đích drill** chạy *trước khi* tải gì: host phải local hoặc có `ALLOW_REMOTE_DRILL=1`; tên database **bắt buộc kết thúc bằng `_drill`**; tên drill không được trùng `DATABASE_URL` của app. Sau đó mới chạy `assertSafeMaintenanceTarget()` của `postgres-utils.js`.
3. Tải `.dump` + `.manifest.json` về thư mục tạm (quyền 0700/0600).
4. Manifest phải đúng `format` + `version` + có SHA-256 hợp lệ; `manifest.size` phải khớp size file tải về; **SHA-256 tính lại phải khớp manifest**.
5. Chạy lại hàng rào đích drill lần nữa, lần này so với `manifest.database` — chặn trường hợp bản backup được lấy từ một database mà tên drill trùng.
6. `dropdb --if-exists` database drill cũ → `createdb --owner=<user>` → `pg_restore --exit-on-error --no-owner --no-privileges`.
7. `SELECT count(*)` trên 3 bảng cốt lõi: `students`, `clans`, `community_posts`. Cảnh báo nếu bảng nào rỗng.
8. In `DRILL_SUMMARY {"pass":true,...}` hoặc `{"pass":false,"error":"..."}`.
9. `finally`: nếu database drill **đã được tạo** thì `dropdb --if-exists --force` (kể cả khi `pg_restore` fail), rồi xoá thư mục tạm trừ khi có `--keep`. Nếu `createdb` đã fail thì không có database nào để dọn; nếu `dropdb` cuối cùng thất bại, log sẽ in `cần dọn tay`.

Exit code: `0` = pass, `1` = fail. Chạy drill hỏng **không** phải sự cố hệ thống, nhưng phải xử lý ngay — backup mà không drill được thì chưa phải backup.

### 6.4. Lịch drill khuyến nghị

- **Mỗi tuần một lần**, chạy tay hoặc bằng cron của hệ điều hành (`cron` của OS, tách khỏi `BACKUP_CRON` để không trùng).
- **Sau mọi đợt deploy** có migration.
- **Ngay sau khi đổi** `BACKUP_DATABASE_URL`, `BACKUP_R2_BUCKET`, hoặc quyền của role backup.
- Lưu lại output `DRILL_SUMMARY` vào tài liệu sự cố / log vận hành. Một drill pass tháng trước không thay thế drill pass hôm nay.

> Lưu ý: `deploy/deploy.sh` **không** tự chạy drill. Bước 2 của deploy chỉ **backup**; drill là hoạt động thủ công có chủ ý vì nó cần role `CREATEDB` mà container `bdu-hub` không được cấp.

### 6.5. ⛔ Cảnh báo: drill KHÔNG BAO GIỜ restore vào production

Đây là quy tắc cứng, không có ngoại lệ:

- `DRILL_DATABASE_URL` phải trỏ tới database **quản trị** (thường `postgres`) trên host trong allowlist local, **không** phải database ứng dụng.
- Tên database drill phải kết thúc bằng `_drill` (mặc định `bdu_restore_drill`). Script ném lỗi nếu không.
- Tên drill không được trùng database từ `DATABASE_URL` của app, cũng không được trùng `manifest.database` của bản backup.
- Không có đường vòng: nếu host không local thì cần `ALLOW_REMOTE_DRILL=1` **và** `BDU_MAINTENANCE_ALLOW_PRODUCTION=1`, nhưng tên `_drill` vẫn là bắt buộc.

Muốn drill cùng host với production thì dùng **PostgreSQL riêng cho maintenance** (container/máy khác), không dùng chung instance với database ứng dụng.

### 6.6. Điều kiện môi trường cho drill

- **`postgresql-client` đã được cài trong `Dockerfile`** (`apt-get install -y --no-install-recommends postgresql-client`) vì image gốc là `mcr.microsoft.com/dotnet/runtime:10.0` không có sẵn các binary này. `Dockerfile` còn có smoke check `pg_dump --version && pg_restore --version` ở bước build để image không bao giờ thiếu tool mà vẫn build được.
- Drill cần **4 binary**: `createdb`, `dropdb`, `pg_restore`, `psql`. Thiếu bất kỳ binary nào thì `requireBinaries()` ném lỗi ngay.
- Cần role có quyền `CREATEDB` — role backup chỉ đọc **không đủ**.

---

## 7. Khôi phục thật

> Đây là thao tác **không hoàn tác được**. Chỉ làm khi thật sự cần và đã xác minh bản backup.

### 7.1. Trước khi restore

1. **Chọn đúng bản backup.** Repo **không có** lệnh CLI liệt kê object — hãy xem bucket `BACKUP_R2_BUCKET` trên Cloudflare Dashboard (hoặc một S3 client), lọc theo tiền tố `db/`, sắp theo thời gian giảm dần. `db-backup-verify.js` mặc định tự chọn bản mới nhất; cần bản cũ hơn thì truyền `--key`. Tìm bản có metadata `bdu-reason=pre-deploy` quanh thời điểm deploy.
2. **Tải về VPS kèm manifest.** `db-restore.js` yêu cầu file `<đường_dẫn>` và `<đường dẫn>.manifest.json` cùng tồn tại.
3. **Chạy drill với `--key` trước** trên database tạm, xác nhận `pass: true`. Đừng bỏ bước này.
4. **Dừng app** để không có ghi trong lúc restore: `docker compose stop bdu-hub`.

### 7.2. Lệnh restore

```bash
docker compose run --rm -e BDU_MAINTENANCE_ALLOW_PRODUCTION=1 bdu-hub \
  npm run db:restore -- data/backups/backup-20260925T031700Z.dump \
  --allow-production --yes
```

`db-restore.js` kiểm tra theo thứ tự và **fail-closed ở mọi bước**:

| # | Kiểm tra (đúng thứ tự trong `db-restore.js`) | Thông báo khi không đạt |
| :--- | :--- | :--- |
| 1 | Chỉ chấp nhận cờ `--allow-production` và `--yes`; đúng 1 đối số vị trí | `❌ Không hỗ trợ flag: ...` / usage, exit 2 |
| 2 | Thiếu `--yes` | `❌ Restore là thao tác phá hủy. Phải truyền --yes sau khi kiểm tra backup.`, exit 2 |
| 3 | File tồn tại, là file thường, **không phải symlink** | `❌ Không tìm thấy file backup tại: ...` / `❌ Backup phải là file thường, không được là symlink.` |
| 4 | `getSafeDatabaseTarget({ operation: 'restore', allowProduction, preferMigration: true })` | Hàng rào của `postgres-utils.js`: restore mặc định chỉ cho database `bdu_test_*`; database khác cần `--allow-production` + `BDU_MAINTENANCE_ALLOW_PRODUCTION=1` |
| 5 | Manifest tồn tại và là file thường (không symlink) | `❌ Backup phải có manifest hợp lệ (...)` |
| 6 | `manifest.format === 'bdu-postgres-dump'`, `version === 1`, SHA-256 đúng format, `manifest.database` khớp database đích, `manifest.size` khớp size file | `❌ Manifest backup không khớp format/database/size.` |
| 7 | **SHA-256 tính lại từ file** khớp manifest | `❌ SHA-256 backup không khớp manifest; từ chối restore.` |
| 8 | `BDU_MAINTENANCE_CONFIRM_DESTRUCTIVE=1` | `❌ Thiếu BDU_MAINTENANCE_CONFIRM_DESTRUCTIVE=1.` |
| 9 | `BDU_MAINTENANCE_CONFIRM_DATABASE` = tên database đích | `❌ Xác nhận database không khớp. Expected ...` |
| 10 | Tìm thấy `psql` | `❌ Không tìm thấy công cụ psql trên máy.` + hướng dẫn cài theo OS |

Bước 4 chạy **trước** bước 5–7, nên URL sai bị chặn sớm mà không cần đọc manifest.

Restore chạy `psql` với `--no-psqlrc --single-transaction --set=ON_ERROR_STOP=1`, nên **toàn bộ** thao tác là một transaction: lỗi giữa chừng thì rollback sạch, không để lại database nửa nạp. Cần role có quyền đủ (`preferMigration: true` → dùng `MIGRATION_DATABASE_URL` nếu có, không dùng `BACKUP_DATABASE_URL` chỉ đọc).

Đầy đủ cờ cần thiết cho production (truyền qua `-e` vì `docker-compose.yml` không khai báo hai biến xác nhận này):

```bash
docker compose run --rm \
  -e BDU_MAINTENANCE_ALLOW_PRODUCTION=1 \
  -e BDU_MAINTENANCE_CONFIRM_DESTRUCTIVE=1 \
  -e BDU_MAINTENANCE_CONFIRM_DATABASE=<tên_database_đích> \
  bdu-hub npm run db:restore -- <đường_dẫn.dump> --allow-production --yes
```

`MIGRATION_DATABASE_URL` phải có trong env của container nếu bạn dùng role migration riêng (xem `.env.example` và `src/db/database.js`).

### 7.3. Sau khi restore

```bash
docker compose up -d bdu-hub
docker compose logs --tail=200 bdu-hub
curl -fsS http://127.0.0.1:3000/api/health
```

Nếu app chạy code mới hơn schema vừa khôi phục, migration có thể không áp dụng được vì ledger ghi version đã có checksum khác. Trường hợp đó thuộc kịch bản rollback đầy đủ: quay code về đúng commit đã deploy, rồi deploy lại (deploy.sh sẽ backup trước rồi migrate).

---

## 8. Xử lý sự cố

| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
| :--- | :--- | :--- |
| `Thiếu BACKUP_DATABASE_URL. Backup bắt buộc dùng role chỉ đọc riêng` | Chưa khai báo biến | Tạo role chỉ đọc, điền vào `.env` của container `bdu-hub`/`bdu-db-backup` |
| `BACKUP_R2_BUCKET đang trỏ đúng bucket media (R2_BUCKET)` | Cấu hình nhầm | Tạo bucket backup riêng. **Tuyệt đối không dùng chung** — rotate có thể xoá nhầm ảnh |
| `R2 chưa cấu hình (thiếu: ...)` | Thiếu `R2_ENDPOINT`/`R2_ACCOUNT_ID`/credential | Bản local **vẫn được tạo**; exit 0 với `uploaded: false`. Sửa cấu hình rồi chạy lại |
| `Không tìm thấy công cụ pg_dump` | Image thiếu `postgresql-client` | Dockerfile đã cài; nếu chạy ngoài Docker thì `apt-get install -y postgresql-client` |
| `Target phân giải được không phải BACKUP_DATABASE_URL (bị ghi đè bởi biến khác)` | Có `MIGRATION_DATABASE_URL`/`DATABASE_URL` ghi đè trong env con | Kiểm tra lại env của container |
| Scheduler không chạy | `BACKUP_ENABLED` khác `1` | Đặt `BACKUP_ENABLED=1` rồi `docker compose up -d bdu-db-backup` |
| `BACKUP_CRON không hợp lệ` | Sai định dạng | Đặt `HH:MM` hoặc `HH:MM:SS`, ví dụ `03:17` |
| `Host "..." không nằm trong allowlist local` | Host không nằm trong `127.0.0.1/::1/localhost/postgres/test-postgres` | Thêm `--allow-production` + `BDU_MAINTENANCE_ALLOW_PRODUCTION=1` (và `BACKUP_ALLOW_PRODUCTION=1` cho scheduler) |
| `Số bản cần xoá ... vượt trần BACKUP_ROTATE_MAX_DELETE` | Dữ liệu bị lệch | Chạy `--dry-run` xem danh sách, rồi tăng trần tạm thời nếu hợp lý |
| `Kế hoạch retention xoá hết bản backup — dừng lại` | Retention cấu hình sai | Kiểm tra `BACKUP_RETENTION_*` / `BACKUP_RETAIN_*` |
| Drill: `Thiếu DRILL_DATABASE_URL` hoặc `createdb thất bại` | Role không có `CREATEDB` | Dùng role quản trị; truyền `-e DRILL_DATABASE_URL=...` vì biến này không có trong compose |
| Drill: `Tên database drill "..." bắt buộc kết thúc bằng _drill` | Đặt tên sai | Đặt `DRILL_DATABASE_NAME` hoặc dùng mặc định |
| Drill: `SHA-256 dump tải về KHÔNG khớp manifest` | Object R2 bị hỏng/thay đổi | **Backup hỏng.** Drill bản khác ngay và kiểm tra bucket. Đây đúng là lý do drill quan trọng |
| `Verify thất bại: size trên R2 ... khác manifest` | Upload không trọn vẹn | Bản local vẫn được giữ; chạy lại backup |

Mọi dòng log đi qua `redactForLog()` — connection string, mật khẩu, `PGPASSWORD` và R2 secret key đều bị thay bằng `***`. Khi dán log vào ticket, dán nguyên văn; nếu thấy dấu hiệu lộ secret thì rotate credential ngay.

---

## 9. Danh sách lệnh tham chiếu

```bash
# --- Backup ---
npm run db:backup -- --reason manual
npm run db:backup -- --reason pre-upgrade --output /app/temp/manual.dump
npm run db:backup -- --pre-deploy
npm run db:backup -- --reason manual --allow-production

# --- Scheduler ---
node scripts/db-backup-scheduler.js           # vòng lặp (cần BACKUP_ENABLED=1)
node scripts/db-backup-scheduler.js --once    # một chu kỳ rồi thoát

# --- Retention ---
node scripts/db-backup-rotate.js --dry-run
node scripts/db-backup-rotate.js

# --- Drill ---
npm run db:backup:verify
npm run db:backup:verify -- --key db/2026/09/20260925T031700Z-a1b2c3d4.dump
npm run db:backup:verify -- --keep

# --- Restore thật (không hoàn tác được) ---
npm run db:restore -- <file.dump> --allow-production --yes
```

Dòng JSON máy đọc được mà mỗi script in ra ở cuối:
`BACKUP_SUMMARY {...}` · `ROTATE_SUMMARY {...}` · `DRILL_SUMMARY {...}`

---

## 10. File liên quan

| File | Vai trò |
| :--- | :--- |
| `scripts/db-backup.js` | Tạo 1 bản backup (dump local → SHA-256 → manifest → R2 → verify) |
| `scripts/db-backup-scheduler.js` | Đồng hồ chạy định kỳ, cảnh báo fail |
| `scripts/db-backup-rotate.js` | Retention 3 tầng |
| `scripts/db-backup-verify.js` | Restore drill |
| `scripts/db-backup-shared.js` | Thư viện dùng chung: key pattern, bucket riêng, `redactForLog` |
| `scripts/postgres-utils.js` | Hàng rào target DB cho mọi thao tác maintenance |
| `scripts/db-dump.js`, `scripts/db-restore.js` | Dump/restore SQL dạng portable (không qua R2) |
| `scripts/migration-ledger.mjs` | Ledger + advisory lock cho migration |
| `deploy/deploy.sh` | Bước 2: backup bắt buộc trước migrate |
| `docker-compose.yml` | Service `bdu-db-backup`, volume `./data/backups` |
| `Dockerfile` | Cài `postgresql-client`, smoke check `pg_dump`/`pg_restore` |
| `.env.example` | Danh sách tên biến phần "Sao lưu PostgreSQL" |
| `docs/deployment-runbook.md` | Runbook deploy & rollback |
