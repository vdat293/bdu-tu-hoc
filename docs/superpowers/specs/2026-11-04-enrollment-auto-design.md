# Design: Auto đăng ký môn học BDU (`/enrollment`)

> Trạng thái: chờ duyệt spec. Chưa triển khai code.
> Phạm vi: chỉ phần auto đăng ký môn học dựa trên `sv.bdu.edu.vn`. Không đụng tới các phần khác của hub.

## 1. Intent

**Mục tiêu:** sinh viên xếp danh sách môn/nhóm-tổ ưu tiên cho học kỳ đăng ký (hiện tại: HK2 — Năm học 2026-2027, `nhhk=20262`); tool canh đúng giờ BDU mở cổng và tự gọi API đăng ký theo thứ tự ưu tiên; báo kết quả realtime; hỗ trợ rút môn có xác nhận.

**Trạng thái trang hiện tại:** `client/src/features/enrollment/EnrollmentPage.jsx` là placeholder "coming soon" tại route `/enrollment` (đã khai báo trong `client/src/app/routes.jsx` và badge "Soon" ở `AppLayout.jsx`). Route giữ nguyên; nội dung được thay bằng UI thật.

**Thành công:**
- Sinh viên lưu được danh sách ưu tiên (chính + dự phòng) và danh sách này tồn tại trên server theo tài khoản.
- Đúng giờ mở cổng, tool tự gọi API BDU đăng ký theo thứ tự ưu tiên, nhanh hơn thao tác tay; kết quả từng môn hiện realtime trên trang.
- Hết chỗ → tự thử nhóm dự phòng cùng môn; thiếu tiên quyết → dừng môn đó và báo rõ; không retry vô ích.
- Rút môn theo danh sách với xác nhận; tùy chọn tự dọn trùng TKB (mặc định TẮT).
- Token BDU không ghi DB, không log, không rời RAM ngoài thời gian run.

**Không làm (v1):**
- Không vượt khung giờ/quy chế trường (server BDU tự chặn ngoài giờ — tool không tìm cách lách).
- Không tự đọc OTP từ email/SMS (riêng tư, dễ hỏng); OTP do người dùng nhập trong popup.
- Không multi-account, không thao tác cho tài khoản người khác.
- Không auto-rút môn ngoài danh sách ưu tiên của chính run đó.
- Không bypass rate limit/anti-abuse của BDU (không xoay IP, không giả mạo fingerprint); gặp limit → tuân thủ, dừng/log.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Vị trí triển khai | Trong BDU Smart Student Hub (React client + Express proxy), đúng pattern survey/training-score |
| Vị trí thực thi | **Server chạy lượt**, client chỉ theo dõi; token giữ trong RAM server khi run, xóa khi xong |
| Lưu danh sách ưu tiên | **Postgres theo tài khoản** (bảng `enrollment_priorities`), không dùng localStorage |
| Kích hoạt | Giờ đặt + server xác nhận: user nhập giờ mở dự kiến; tool poll giờ máy chủ BDU (`hsba/w-gettimeserver`) và `trong_thoi_gian_dang_ky`; quá G+5′ server chưa mở → run `failed` |
| Thứ tự bắn | Tuần tự theo `thu_tu`, giãn cách ≥ 100ms, chain `id_rs` từ response trước |
| Fallback | **Chỉ** khi server báo hết chỗ → thử dự phòng cùng `ma_mon` theo thứ tự đã xếp. Thiếu tiên quyết → dừng hẳn môn đó, log, sang môn kế. Trùng TKB → không fallback, log |
| Retry | Tối đa 3 lần khi lỗi tạm thời (5xx/network/timeout/429 với backoff); không retry khi server từ chối vĩnh viễn |
| Trùng TKB tự dọn (withdraw) | Tùy chọn, **mặc định TẮT**; chỉ rút môn thuộc danh sách ưu tiên của run đó, ưu tiên `thu_tu` thấp |
| OTP (HTTP 412) | Server phát SSE `otp_required` → client popup 6 ô → `POST /runs/:id/otp` → server xác thực và chạy tiếp; OTP sai ≤ 5 lần, quá → dừng run |
| Cách A đã chọn | Server chạy + SSE (không chọn client-run hay userscript) |
| Kênh sự kiện | SSE riêng `/api/enrollment/runs/:id/events` (capability = `runId` uuid, không bearer — cùng model với `/api/tool-runs/:runId/events` nhưng tách domain, không đụng survey) |
| OTP mặc định | `POST /runs/:id/otp` mặc định trả **501 OTP_NOT_CONFIGURED** tới khi cổng xác thực mở và khảo sát được endpoint thật (bật qua env `ENROLLMENT_OTP_VERIFY_URL`) |
| Feature gate | Thêm `enrollment` vào `src/config/feature-groups.js` (apiPrefixes `/enrollment`, pagePrefixes `/enrollment`); `/enrollment` chuyển khỏi group `portal` |

## 3. Bằng chứng khảo sát (read-only, tài khoản test do chủ tài khoản cung cấp)

Nguồn: probe API trực tiếp + quan sát network khi mở `#/dangkymonhoc` trên portal chính thức.

- **Auth:** `POST /public/api/auth/login` (form-urlencoded, `grant_type=password`) → `access_token`. Angular app chính thức chỉ gửi `Authorization: Bearer` + `idpc: 0`; mọi endpoint đọc trả `200` với header tối thiểu (không cần cookie/XSRF/fingerprint `ua:`).
- **Danh sách đăng ký:** `POST /public/api/dkmh/w-locdsnhomto` (envelope `{is_CVHT:false, additional:{paging, ordering}}`) → `data.ds_mon_hoc` (306 môn), `data.ds_nhom_to` (555 nhóm tổ), `data.trong_thoi_gian_dang_ky` (hiện `false`), `data.hoc_ky_dang_ky` (hiện "Học kỳ 2 - Năm học 2026 - 2027"), `data.dien_giai_enable_chung` ("Ngoài thời gian cho phép đăng ký"). Mỗi nhóm có `id_to_hoc`, `ma_mon`, `nhom_to`, `lop`, `sl_cp`/`sl_cl` (chỉ tiêu/còn lại), `tkb` (chuỗi "Thứ 3,tiết 1->3,Phòng,GV,ngày"), `is_ctdt`, `is_chctdt`, `enable`, `gc_enable`.
- **Điều kiện lọc:** `POST /public/api/dkmh/w-locdsdieukienloc` → danh sách `{gia_tri, mieu_ta, is_mac_dinh}`; lọc "Môn trong CTĐT kế hoạch" = `gia_tri=2`.
- **CTĐT kế hoạch:** `POST /public/api/sch/w-locdsctdtsinhvien {"filter":{"loai_chuong_trinh_dao_tao":1}}` → `ds_CTDT_hocky[]` + `ds_CTDT_mon_hoc[]` (đã export tham chiếu: `scratch/ctdt-ke-hoach.md`, 92 môn / 11 HK, ngành CNTT). Nguồn thứ 2: `POST /public/api/sch/w-locdschuongtrinhdaotao` → `[{gia_tri:1, mieu_ta:"CTĐT kế hoạch"},{gia_tri:2, mieu_ta:"CTĐT thực hiện"}]`.
- **Kết quả đã đăng ký:** `POST /public/api/dkmh/w-locdskqdkmhsinhvien {"is_CVHT":false,"is_Clear":false}` → `data.ds_kqdkmh` (hiện rỗng) và `mintinchi`/`is_show_nganh_hoc`... qua response.
- **Endpoint đăng ký:** `POST /public/api/dkmh/w-xulydkmhsinhvien` body `{"filter":{"id_to_hoc":"...","is_checked":true|false,"sv_nganh":1,"id_rs":""}}`. `is_checked:true` = đăng ký, `false` = rút. Response `{code:200, data:{is_thanh_cong, is_choose, id_rs, id_to_hoc_xoa, thong_bao_loi, thong_bao_tien_quyet, is_show_nganh_hoc}}`. Chain `id_rs` sang lệnh kế tiếp.
- **412 → OTP:** interceptor chính thức: response HTTP 412 trên `w-xulydkmhsinhvien` → gọi `otp/setup` → 499 (đã xác thực) / 401 "No Email" (chưa cài email) / hiện modal OTP. Có khung "xác thực dkmh" giới hạn thời gian (`dkmh/w-locthoigianxacthucdkmh`, `dkmh/w-thoigiansinhviendkmh`; hiện `ngay_bat_dau/ngay_ket_thuc` trống). → OTP là bước bắt buộc có thể xảy ra khi đăng ký; xử lý qua popup thủ công (xem Phần 5).
- **Realtime chỗ:** SignalR hub `dKMHHub`, client method `updateNhom(id?, id_to_hoc, delta)` cập nhật `sl_cl`/`sl_dk`. v1 không phụ thuộc SignalR; poll là đủ cho vài chục request.
- **Giờ máy chủ:** `GET /public/api/hsba/w-gettimeserver` (trang portal gọi khi init).

## 4. Mô hình dữ liệu

Migration mới: `migrations/069_enrollment.sql`. Idempotent, chạy lại an toàn; không FK cứng tới bảng không liên quan; tham chiếu `students(mssv)` như các migration khác.

```sql
CREATE TABLE IF NOT EXISTS enrollment_priorities (
  mssv        VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  ma_mon      VARCHAR(32) NOT NULL,
  ten_mon     TEXT        NOT NULL DEFAULT '',
  so_tc       NUMERIC(4,1),
  id_to_hoc   VARCHAR(40) NOT NULL,
  nhom_to     VARCHAR(16),
  lop         TEXT,
  thu_tu      INTEGER     NOT NULL,
  loai        TEXT        NOT NULL DEFAULT 'chinh'
              CHECK (loai IN ('chinh','du_phong')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (mssv, id_to_hoc)
);
CREATE INDEX IF NOT EXISTS enrollment_priorities_mssv_idx
  ON enrollment_priorities (mssv, thu_tu);

CREATE TABLE IF NOT EXISTS enrollment_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mssv         VARCHAR(32) NOT NULL REFERENCES students(mssv) ON DELETE CASCADE,
  status       TEXT NOT NULL CHECK (status IN
               ('scheduled','running','done','failed','stopped')),
  trigger_at   TIMESTAMPTZ,
  snapshot     JSONB NOT NULL,   -- danh sách ưu tiên lúc start, KHÔNG token
  summary      JSONB,            -- {thanh_cong:[], that_bai:[{ma_mon, ly_do}], rut:[]}
  started_at   TIMESTAMPTZ,
  finished_at  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS enrollment_runs_mssv_idx
  ON enrollment_runs (mssv, created_at DESC);
```

- `loai='du_phong'` là các `id_to_hoc` khác của **cùng `ma_mon`** — fallback = duyệt các mục dự phòng cùng `ma_mon` theo `thu_tu`.
- Token BDU không bao giờ ghi DB/log; `snapshot`/`summary` chỉ chứa định danh môn/nhóm và kết quả.
- Run đang chạy dùng snapshot của chính nó → user sửa danh sách giữa chừng không ảnh hưởng.

## 5. Kiến trúc & API (Express, prefix `/api/enrollment`)

```
Client (/enrollment) ──POST /api/enrollment/runs──▶ Express src/modules/enrollment/
  ▲  └─ SSE /api/enrollment/runs/:id/events              ├─ enrollment.service.js      (catalog, CTĐT, withdraw, registered)
  └─ live log + otp_required + done/error               ├─ enrollment-run.service.js  (canh giờ, bắn, retry, OTP resume)
                                                        ├─ enrollment.controller.js
                                                        ├─ enrollment.routes.js        (đăng ký trong api.routes.js)
                                                        └─ Postgres (069)
```

| Method | Path | Việc |
|---|---|---|
| GET | `/priority` | Danh sách ưu tiên của SV đang đăng nhập |
| GET | `/schedule` | Lịch đăng ký set cứng theo kì (`src/modules/enrollment/enrollment-schedule.js`): khóa = 2 số đầu MSSV (24→2024, ≤2024 mở 05/11/2026; 25→06/11; 26→07/11; chung→10/11; bổ sung 30/11–01/12), khung giờ 09:00–20:00. Cập nhật mỗi kì tại một chỗ |
| PUT | `/priority` | Ghi đè toàn bộ danh sách; validate: mỗi `ma_mon` tối đa 1 `chinh`; `du_phong` phải cùng `ma_mon` với mục chính/khác `id_to_hoc`; `thu_tu` liên tục ≥ 1 |
| GET | `/catalog?loai_loc=2` | Proxy gọn của `w-locdsnhomto` (cache ~60s theo (token, loai_loc)): môn + nhóm + `slCl`/`slCp`. `loai_loc` chỉ đổi cache key — chính sách lọc CTĐT áp dụng phía client dựa trên cờ `isCtdt`/`isChctdt` (mặc định lọc "Môn trong CTĐT kế hoạch"); server không tự bịa tham số filter |
| GET | `/registered` | Proxy `w-locdskqdkmhsinhvien` |
| POST | `/withdraw` `{id_to_hoc}` | Rút 1 nhóm (`is_checked:false`) |
| POST | `/runs` `{triggerAt}` | Snapshot danh sách + token (RAM) → bắt đầu canh giờ → run |
| GET | `/runs/:id` | Trạng thái + `summary` (chỉ đúng mssv chủ run) |
| POST | `/runs/:id/stop` | Dừng run (flag; bắn xong request hiện tại mới dừng) |
| POST | `/runs/:id/otp` `{code}` | Gửi OTP khi server phát `otp_required` |
| GET | `/runs/:id/events` | SSE riêng của enrollment (capability = `runId` uuid, không bearer) |

**Auth & ownership:** mọi request dùng `bearerToken(req)` + `BduIdentityService.resolveVerifiedMssv`; không tin mssv từ client; run/summary chỉ đọc được bởi đúng mssv chủ. 2 tab cùng bấm Auto → tab sau nhận **409** (run đang chạy).

**Luồng người dùng (UI):**
1. Mở `/enrollment` → tải catalog → bảng môn/nhóm (cột Còn lại, TKB, badge CTĐT), tìm kiếm + lọc điều kiện.
2. Tick nhóm muốn đăng ký; xếp thứ tự (↑↓ hoặc kéo thả); đánh dấu Chính/Dự phòng theo môn; **Lưu danh sách**.
3. Nhập **giờ mở cổng dự kiến** (mặc định 07:00 ngày theo thông báo, sửa được) → **Kích hoạt Auto** → màn theo dõi: đếm ngược theo giờ máy chủ, live log SSE, nút **Dừng**.
4. Danh sách đã đăng ký có nút **Rút** từng dòng + modal xác nhận; checkbox **"Tự động dọn trùng TKB (mặc định TẮT)"**.

## 6. Luồng chạy của run-service

1. **Trước `triggerAt`**: không gọi cổng đăng ký. Chỉ giữ phiên BDU tươi (refresh token mỗi ~60 phút, xem mục 2) và ngủ theo từng đoạn ≤60s để thức đúng giờ hẹn.
2. **Đúng `triggerAt`**: bắt đầu poll `w-locdsnhomto`/`w-thoigiansinhviendkmh` mỗi **0.5s**; cổng mở → chạy đăng ký ngay. Quá `triggerAt + 5 phút` mà server vẫn đóng → `failed("Cổng chưa mở")`.
3. **Giữ phiên BDU tươi khi chờ dài** (đặt hôm nay cho ngày mai): access token BDU sống ~5h; tool tự gọi `auth/login` với `grant_type=refresh_token` mỗi ~60 phút và khi gặp 401, cập nhật token trong RAM (refresh token chỉ giữ RAM, không ghi DB/log). Nếu refresh thất bại hoàn toàn → run `failed("Phiên đăng nhập đã hết hạn")` và **enqueue cảnh báo Discord** (`notification_outbox` type `enrollment_alert`) cho tài khoản đã liên kết Discord.
4. Khi server báo mở → duyệt `snapshot` theo `thu_tu`; mỗi mục gọi `w-xulydkmhsinhvien` với `{is_checked:true, id_to_hoc, sv_nganh, id_rs}` tuần tự, giãn cách ≥100ms; `id_rs` của response trước truyền sang lệnh kế.
5. Phân loại response:
   - `code:200` + `is_thanh_cong` → đánh dấu thành công, log.
   - Hết chỗ (server message nhận diện, ví dụ "hết chỗ"/`sl_cl` về 0 ở catalog kế tiếp) → **fallback**: các mục `du_phong` cùng `ma_mon` theo `thu_tu`; hết dự phòng → log "hết chỗ toàn bộ", sang môn kế.
   - Thiếu tiên quyết (`thong_bao_tien_quyet` / message tương ứng) → **dừng hẳn môn đó**, log, sang môn kế.
   - Trùng TKB → không fallback, log "trùng lịch".
   - "Ngoài thời gian cho phép đăng ký" → từ chối vĩnh viễn, không retry; nếu xảy ra ở lệnh đầu → run `failed`.
   - HTTP **412** → phát SSE `otp_required`; chờ tối đa 5 phút; nhận OTP qua `/runs/:id/otp` → xác thực (mặc định trả **501** tới khi cổng mở và khảo sát được endpoint thật — bật qua env `ENROLLMENT_OTP_VERIFY_URL`) → chạy tiếp. OTP sai ≤ 5 lần, quá → dừng run (`failed`).
   - 5xx/network/timeout/429 → retry ≤ 3 lần, backoff 200ms→500ms→1200ms; 429 ưu tiên `Retry-After` nếu có.
6. Kết thúc: ghi `enrollment_runs.summary`, phát SSE `done`/`error`, **xóa token + refresh token khỏi RAM**.
7. **Tự động dọn trùng TKB (chỉ khi user bật, trước khi run):** sau khi run xong, nếu 2 môn đã đăng ký trùng TKB → tự `withdraw` môn có `thu_tu` cao hơn (thấp ưu tiên hơn), chỉ trong phạm vi danh sách của run đó; mọi hành động log + có xác nhận bật trước.
8. **Thông báo Discord (tài khoản đã liên kết):** run `done` → tóm tắt số môn thành công/thất bại + danh sách lỗi (tối đa 5) + số môn tự rút; run `failed` → lý do (gồm token hết hạn). Enqueue `notification_outbox` type `enrollment_alert`, bot DM user.

## 7. Xử lý lỗi & an toàn

- Token hết hạn giữa chừng (401/426): thử refresh bằng refresh token (RAM); refresh thành công → chạy tiếp. Refresh thất bại → dừng run, SSE `error`, enqueue cảnh báo Discord (`enrollment_alert`) và client logout theo cơ chế sẵn có.
- Dữ liệu `w-locdsnhomto` đổi cấu trúc → `enrollment.service.js` là nơi duy nhất phải sửa (adapter response); UI nhận shape gọn do server quyết định.
- Client mất SSE → reconnect và hỏi `GET /runs/:id` để đồng bộ trạng thái.
- Rút môn luôn qua modal xác nhận; không có endpoint rút hàng loạt không xác nhận.
- Mọi thao tác đều bằng token của chính chủ tài khoản, trong khung giờ trường cho phép; tool chỉ làm nhanh hơn thao tác tay, không né server.
- **Lưu ý quy chế:** tính hợp lệ của auto đăng ký theo nội quy BDU do người dùng tự chịu trách nhiệm; tool không ẩn danh và không che giấu hành vi.

## 8. Testing

Theo convention repo (`npm test`, không đụng DB/.env thật, không tài khoản thật):

- `tests/test-enrollment-priority.js` — validator thuần: 1 môn 1 mục chính; dự phòng cùng `ma_mon`; `thu_tu` liên tục; trùng `id_to_hoc`.
- `tests/test-enrollment-run.js` — run-service với **fetch mock**: (a) poll tới khi `trong_thoi_gian_dang_ky:true` rồi bắn; (b) chain `id_rs`; (c) fallback khi hết chỗ; (d) dừng khi thiếu tiên quyết; (e) retry 5xx/timeout, không retry vĩnh viễn; (f) 412 → `otp_required` → OTP đúng → resume; OTP sai 5 lần → stop; (g) token KHÔNG xuất hiện trong `snapshot`/`summary`/log; (h) quá `triggerAt+5′` cổng chưa mở → `failed`.
- `tests/test-enrollment-routes.js` — 401 thiếu token; 403/404 run của mssv khác; 409 run đang chạy; 400 validate body; rút môn yêu cầu body hợp lệ.
- Client: `npm run lint:frontend` + `npm run build:client`; nếu có pattern `tests/frontend/` cho trang tool → thêm test render/flow chính.
- Fixture từ probe (`scratch/`, đã gitignore) chỉ dùng cục bộ, không commit.

## 9. Rủi ro & điểm mở

1. **412/OTP flow chưa tái hiện được** cho tới khi khung xác thực mở → endpoint `/runs/:id/otp` và nhánh resume trong run-service có thể cần chỉnh theo hành vi thật (code sẽ cô lập trong 1 hàm để sửa rẻ).
2. **`id_rs` / `sv_nganh` semantics** suy ra từ Angular bundle, chưa xác nhận với server thật; run-service coi `id_rs` là opaque, chỉ chain, không diễn giải.
3. **Thông điệp "hết chỗ" / "tiên quyết"** của server chưa biết dạng string chính xác → nhánh fallback nhận diện qua nhiều mẫu + fallback an toàn (coi như từ chối vĩnh viễn nếu không khớp, log full message để bổ sung mẫu sau).
4. Nếu BDU siết limit (429/khóa tạm), tool tuân thủ và dừng — **không** có cơ chế né.
5. Server restart giữa run → run mất token trong RAM → `failed` (báo rõ); không resume tự động (tránh bắn lại khi chưa rõ trạng thái server-side); user chạy lại thủ công.

## 10. Các bước kế tiếp

1. Duyệt spec (tài liệu này) → 2. writing-plans tạo implementation plan → 3. triển khai theo plan (DB migration → module server → routes → client UI → tests) → 4. verify (lint, test, build) → 5. khảo sát 412/OTP khi cổng mở và chỉnh nhánh resume (không mở rộng scope).
