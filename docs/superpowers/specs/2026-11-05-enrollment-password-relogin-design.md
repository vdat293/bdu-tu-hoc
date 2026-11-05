# Design: Thay OTP bằng MSSV + mật khẩu, tự đăng nhập lại trước giờ mở

> Trạng thái: chờ duyệt spec. Chưa triển khai code.
> Phạm vi: chỉ luồng auto đăng ký môn học (`/enrollment`). Không đụng các phần khác của hub.
> Thay thế phần OTP trong spec `2026-11-04-enrollment-auto-design.md` (mục 5, 6.5, 7).

## 1. Intent

**Mục tiêu:** bỏ cơ chế OTP thủ công (hiện không hoạt động vì `ENROLLMENT_OTP_VERIFY_URL` chưa cấu hình nên luôn trả 501), thay bằng popup lấy **MSSV + mật khẩu BDU** khi người dùng bấm Kích hoạt Auto. Server giữ mật khẩu **chỉ trong RAM**, tự kiểm tra và đăng nhập lại **trước mốc mở cổng 5 phút**, rồi tự xoá mật khẩu khi lượt chạy kết thúc.

**Thành công:**
- Bấm Kích hoạt Auto → popup 2 trường: MSSV điền sẵn (readonly, lấy từ phiên đăng nhập), mật khẩu (password, không autocomplete).
- Server dùng mật khẩu để login lại đúng `triggerAt − 5 phút` (hoặc ngay khi bắt đầu nếu đã qua mốc), đảm bảo token tươi và mật khẩu đúng trước khi cổng mở.
- Mật khẩu không xuất hiện trong DB, log, SSE, snapshot, summary, response API hay storage của trình duyệt; bị set `null` khi run kết thúc.
- Sai mật khẩu → run dừng ngay với thông báo rõ ràng, không âm thầm chạy bằng token cũ.
- Gặp HTTP 412 (BDU đòi OTP) không còn treo chờ ai nhập mã: thử login lại bằng mật khẩu + đăng ký lại 1 lần; vẫn 412 thì báo môn đó thất bại và chạy tiếp môn khác.

**Không làm:**
- Không lưu mật khẩu trong DB (kể cả mã hoá), không lưu localStorage/sessionStorage/cookie.
- Không thêm cơ chế sống qua server restart: run vẫn chết khi process restart như hiện tại.
- Không đọc OTP từ email/SMS.
- Không thay đổi cách lấy danh mục/đăng ký/rút môn.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Nơi lưu mật khẩu | Chỉ RAM, trong object run của `EnrollmentRunManager`; set `null` ở `finishRun` |
| Thời điểm login | `triggerAt − 5 phút`; nếu bắt đầu muộn hơn mốc này thì login ngay trước khi poll cổng |
| Vai trò mật khẩu | Refresh token vẫn dùng định kỳ như cũ; login bằng mật khẩu là bước kiểm tra ở T−5 và là fallback khi refresh/401 thất bại |
| Sai mật khẩu (login trả 401) | Dừng run ngay, `error: "Mật khẩu BDU không đúng..."`, enqueue cảnh báo Discord như các lỗi run khác |
| Lỗi mạng/5xx khi login T−5 | Log cảnh báo, giữ token hiện tại, thử lại đúng `triggerAt` một lần; vẫn lỗi thì tiếp tục bằng token hiện tại |
| HTTP 412 (OTP) | Không còn popup/status `otp_required`; thử login bằng mật khẩu + đăng ký lại 1 lần, vẫn 412 → môn đó thất bại với lý do rõ ràng |
| OTP cũ | Xoá toàn bộ: modal 6 ô, `submitOtp`, route `/runs/:id/otp`, env `ENROLLMENT_OTP_VERIFY_URL`, `OtpUnavailableError`, trạng thái `otp_required` |
| API | `POST /api/enrollment/runs` nhận thêm `password` (bắt buộc, 1–200 ký tự) |
| DB | Không migration mới |

## 3. Hiện trạng và lý do thay đổi

- `enrollment.service.js:verifyOtp` chỉ hoạt động khi có env `ENROLLMENT_OTP_VERIFY_URL`; mặc định ném `OtpUnavailableError` (501).
- Portal BDU chỉ trả 412 khi khu xác thực đăng ký bật; các lượt đăng ký thực tế ngày 05/11/2026 không gặp 412. Vì vậy nhánh chờ OTP hiện là dead-end: nếu 412 xảy ra, run treo 5 phút rồi thất bại.
- Người dùng đã chọn: thay bằng MSSV + mật khẩu, chỉ RAM, login lại trước mốc 5 phút.

## 4. Luồng người dùng

1. Sinh viên xếp danh sách ưu tiên, chọn đợt, bấm **Kích hoạt Auto**.
2. Modal `Xác thực tài khoản BDU`:
   - `MSSV`: giá trị `auth.user.mssv`, `readOnly`, không cho sửa.
   - `Mật khẩu`: `type="password"`, `autoComplete="off"`, không lưu vào storage.
   - Ghi chú: "Mật khẩu chỉ dùng để đăng nhập lại trước giờ mở, chỉ giữ trong RAM của server và tự xoá khi lượt chạy kết thúc."
   - Nút Huỷ / Kích hoạt. Trong lúc gửi: disable, hiện "Đang kích hoạt…".
3. Submit → `POST /api/enrollment/runs` với `{ roundId, autoFixScheduleConflict, password }`. Thành công → đóng modal, xoá state mật khẩu, hiện run như hiện tại.
4. Không có popup OTP nữa. Nếu run dừng vì mật khẩu sai, UI hiện `error` của run và gợi ý bấm Kích hoạt lại.
5. F5 giữa lúc chờ: run khôi phục từ server (đã có ở tính năng trước); mật khẩu vẫn chỉ nằm ở RAM server, client không cần nhập lại.

## 5. API

| Method | Path | Thay đổi |
|---|---|---|
| POST | `/api/enrollment/runs` | Body thêm `password` (bắt buộc). Thiếu/rỗng → 400 "Thiếu mật khẩu BDU để đăng nhập lại trước giờ mở." |
| POST | `/api/enrollment/runs/:id/otp` | **Xoá** |
| GET | `/api/enrollment/runs/:id`, `/runs/latest`, SSE | Không đổi shape; tuyệt đối không chứa `password` |

Controller:
- `startRun` đọc `password = String(req.body?.password ?? '').trim()`, giới hạn 200 ký tự, truyền vào `EnrollmentRunService.start`.
- Không log body của request này (đã có traffic logging; cần xác nhận/whitelist để không ghi `password` — xem mục 7).

## 6. Run service

State mới trong object run (RAM): `password`, `loginAtMs = triggerAtMs − 5 phút`, `loginAttempts = 0`, `loginDone = false`.

### 6.1 Chờ trước giờ mở
- Giữ nguyên vòng chờ và refresh token định kỳ mỗi 60 phút.
- Khi `now >= loginAtMs` và chưa login: gọi `service.login(mssv, password)`.
  - Thành công: cập nhật `run.token`, `run.refreshToken`, `loginDone = true`, log "Đã kiểm tra và đăng nhập lại BDU trước giờ mở."
  - 401: `finishRun(failed)` với lỗi "Mật khẩu BDU không đúng. Kiểm tra lại rồi kích hoạt lại." (cảnh báo Discord theo luồng sẵn có).
  - Lỗi mạng/5xx: log cảnh báo, hẹn thử lại đúng `triggerAt` một lần; nếu vẫn lỗi thì tiếp tục bằng token hiện tại.
- Bấm muộn (now > triggerAt): login ngay trước khi poll cổng.

### 6.2 Poll cổng và đăng ký
- Không đổi: poll `getGateStatus` mỗi 0.5s trong cửa sổ 5 phút tính từ `max(triggerAt, now)` (đã sửa trước đó).
- Trước khi đăng ký: giữ bước re-map `id_to_hoc` theo catalog hiện tại.

### 6.3 Token hết hạn giữa chừng
- `tryRefresh`: thử `refresh_token` như cũ; nếu fail và còn mật khẩu → `login(mssv, password)`.
- Giới hạn tổng số lần login/refresh bằng `refreshCount` hiện tại (tối đa 3) + `loginAttempts` (tối đa 3) để không biến thành vòng lặp đăng nhập.

### 6.4 HTTP 412
- Bỏ trạng thái `otp_required`, bỏ chờ 5 phút, bỏ `submitOtp`.
- Khi `classifyRegisterResult` trả `otp`: thử `login(mssv, password)` rồi gọi lại đăng ký đúng 1 lần.
- Vẫn 412 → `recordItem(failed, "BDU yêu cầu OTP — không thể tự xử lý, vui lòng đăng ký thủ công")`, chạy tiếp môn kế.
- Không có mật khẩu (trường hợp không thể xảy ra qua API mới, nhưng phòng thủ) → fail môn với cùng thông báo.

### 6.5 Kết thúc
- `finishRun`: set `run.password = null`, `run.token = null`, `run.refreshToken = ''` trước khi ghi DB/phát sự kiện cuối.
- `serialize()` không bao giờ thêm `password`; `snapshot`/`summary`/`logs` không chứa mật khẩu.

## 7. Bảo mật và vòng đời mật khẩu

- Mật khẩu đi qua HTTPS trong body JSON, không lên URL/query, không vào header.
- Chỉ nằm trong RAM của process: không cột DB, không file, không cache, không log, không SSE, không response.
- Traffic logging hiện chỉ ghi `req.query` đã qua `sanitizeQueryForLog` và **không ghi body** (`src/services/traffic.service.js`), nên mật khẩu trong body `/api/enrollment/runs` không vào `traffic_logs`. Yêu cầu: không thêm bất kỳ log body nào cho route này; nếu sau này thêm, phải scrub key `password` trước.
- Xoá: set `null` + để GC. Ghi rõ giới hạn: JS string là immutable nên không thể zero-hoá bộ nhớ tuyệt đối; đây là mức tốt nhất trong cùng kiến trúc token-only-in-RAM.
- Không có cơ chế "remember": mỗi lần Kích hoạt Auto phải nhập lại mật khẩu.
- Sai mật khẩu không bị log kèm giá trị; chỉ log MSSV + lý do.
- Modal không render mật khẩu lại sau khi submit; state bị xoá ngay khi request bắt đầu.

## 8. Mô hình dữ liệu

Không thay đổi schema. `enrollment_runs` tiếp tục không có cột bí mật. Trạng thái `otp_required` không còn được tạo mới; dữ liệu cũ (nếu có) vẫn đọc được và được `failStaleRuns` xử lý như trạng thái active.

## 9. Testing

Node (`tests/test-enrollment-run.js`, `tests/test-enrollment-service.js`, `tests/test-enrollment-controller.js`):
- `start` từ chối khi thiếu `password`; chấp nhận và không đưa vào `serialize()`/log/snapshot.
- Login đúng mốc `triggerAt − 5 phút`: gọi `service.login(mssv, password)` đúng 1 lần, token mới được dùng cho đăng ký.
- Bắt đầu muộn hơn mốc: login ngay trước khi poll cổng.
- Login trả 401: run `failed`, lỗi chứa "Mật khẩu", có notify Discord.
- Login lỗi mạng ở T−5: không fail, thử lại ở `triggerAt`.
- Refresh token fail + có mật khẩu: fallback login thành công, chạy tiếp.
- 412: login lại + gọi đăng ký lại 1 lần; vẫn 412 → môn thất bại với thông báo OTP, các môn khác vẫn chạy.
- `finishRun`: `password`, `token`, `refreshToken` đều bị xoá; `updateRun` không chứa mật khẩu.
- Xoá các test OTP cũ (e, e2, k, l) hoặc chuyển thành test hành vi 412 mới.

Frontend (`tests/frontend/enrollment-credentials.test.jsx`):
- Bấm Kích hoạt Auto mở modal; MSSV readonly đúng `auth.user.mssv`.
- Submit gọi `startRun` với `password`, đóng modal, không ghi gì vào localStorage/sessionStorage.
- Không còn modal OTP khi run `done`/lỗi.
- Huỷ modal không gọi API, mật khẩu bị xoá khỏi state.

Kiểm chứng thủ công sau deploy: đặt lịch cách hiện tại vài phút để thấy log login T−5; thử mật khẩu sai thấy run dừng ngay; F5 giữa lúc chờ vẫn thấy run và không phải nhập lại mật khẩu.

## 10. Rủi ro và điểm mở

1. BDU có thể chặn/đánh dấu khi login nhiều lần (login lúc mở trang + T−5 + fallback). Giới hạn cứng 3 lần login/run; nếu BDU trả 429 thì dừng run như lỗi hiện tại.
2. Chưa có bằng chứng login lại bằng mật khẩu gỡ được 412; spec chỉ thử 1 lần rồi báo thất bại môn đó, không treo UI.
3. Login T−5 làm token cũ bị thay; nếu login thành công nhưng token mới không có quyền đăng ký (trường hợp hiếm), run sẽ fail ở bước đăng ký với lỗi auth như hiện tại.
4. Việc xoá mật khẩu khỏi RAM là best-effort (JS string immutable). Không cam kết zero-hoá bộ nhớ; đổi lại là không lưu ở đâu khác.
5. Modal yêu cầu mật khẩu có thể tạo thói quen nhập mật khẩu vào web; UI phải ghi rõ đây là app của chính người dùng, mật khẩu chỉ dùng để login BDU và tự xoá.

## 11. Các bước kế tiếp

1. Duyệt spec này.
2. `writing-plans` tạo implementation plan.
3. Triển khai: service login → run manager (T−5, fallback, 412, wipe) → controller/routes → client modal → xoá OTP → tests.
4. Verify: test node + frontend + build; deploy; kiểm chứng log T−5 và trường hợp sai mật khẩu.
