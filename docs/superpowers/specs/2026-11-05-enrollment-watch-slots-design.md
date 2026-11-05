# Design: Tự dọn môn đã đăng ký + Canh slot lớp hết chỗ (`/enrollment`)

> Trạng thái: chờ duyệt spec. Chưa triển khai code.
> Phạm vi: chỉ module enrollment (`client/src/features/enrollment`, `src/modules/enrollment`). Không đụng các phần khác của hub.

## 1. Intent

**Mục tiêu:** sau khi auto đăng ký chạy xong, tool tự dọn khỏi danh sách ưu tiên những môn đã đăng ký thành công và đánh dấu sẵn các môn đó trong bảng "Môn học đang mở"; đồng thời thêm tùy chọn canh slot — lớp nào bị từ chối vì hết chỗ thì cứ 1 phút thử lại một lần cho tới khi đăng ký được hoặc đợt đóng.

**Thành công:**
- Sau lượt auto, môn đã đăng ký không còn nằm trong danh sách ưu tiên; bảng "Môn học đang mở" hiện các môn đó với checkbox tick sẵn và bị khoá, nên không thể tick trùng khi auto tiếp môn khác.
- Bật toggle canh slot: các lớp báo hết chỗ (mục chính + dự phòng cùng môn) được thử lại mỗi 60 giây; canh được slot nào thì ghi nhận, dọn môn đó khỏi ưu tiên và báo cho người dùng.
- Canh slot dừng đúng lúc: đăng ký hết môn cần canh, đợt đóng, người dùng bấm Dừng, hoặc lỗi phiên không khôi phục được.
- Không thêm bảng/cột DB, mật khẩu và token BDU vẫn chỉ nằm trong RAM khi run active.

**Không làm:**
- Không canh slot cho lý do thất bại khác (thiếu tiên quyết, trùng lịch, vượt tín chỉ, OTP).
- Không tự resume pha canh slot sau khi server restart.
- Không thêm cơ chế né rate limit/anti-abuse của BDU; nhịp 1 phút/lớp là cố định.
- Không thay đổi luồng rút môn thủ công.

## 2. Quyết định đã chốt

| Chủ đề | Quyết định |
|---|---|
| Dọn danh sách ưu tiên | Chỉ xoá môn **đăng ký thành công**; giữ môn thất bại để lần auto sau xử lý tiếp |
| Phạm vi xoá | Xoá **cả nhóm môn**: mục `chinh` + mọi `du_phong` cùng `ma_mon` khi một mục của môn đó thành công |
| Thời điểm dọn | Ngay sau lượt đăng ký đầu (nếu vào canh slot) và lặp lại trong `finishRun` cho mọi kết cục; idempotent |
| Hiển thị môn đã đăng ký | Bảng "Môn học đang mở": checkbox tick sẵn + `disabled` + tag "Đã ĐK"; không cho tick/thêm lại |
| Watcher | Là **pha `watching` của chính run hiện tại**, không phải thực thể riêng |
| Trạng thái DB | `status` vẫn là `running`; thêm `phase` (`registering`/`watching`) vào cột `state` JSON và `serialize()` — không migration |
| Thời gian canh | Tới khi đăng ký được hết hoặc tới `closesAt` của đợt đã chọn; có nút Dừng riêng (dùng nút Dừng sẵn có) |
| Nhịp thử | Mỗi lớp một request mỗi 60 giây (env `ENROLLMENT_WATCH_INTERVAL_MS`, mặc định 60000); không retry 3 lần trong cùng tick |
| Lớp được canh | Mục `chinh` thất bại với `seat_full` → canh mục chính + toàn bộ dự phòng cùng `ma_mon`, theo `thuTu` |
| Toggle | `watchSlots` mặc định **TẮT**, theo từng lượt (giống `autoFixScheduleConflict`), khoá khi run active |
| Tự dọn trùng TKB | Nếu có canh slot, hoãn `autoFixConflicts` tới cuối pha `watching`; nếu không, giữ nguyên như hiện tại |
| Restart | Run ở `phase === 'watching'` bị đánh `failed` khi khởi động lại, không resume; pha đăng ký giữ cơ chế resume hiện tại |
| Thông báo | Discord gửi 1 tin khi mỗi môn canh được + tổng kết khi run kết thúc (dùng prefs Discord sẵn có) |

## 3. Hiện trạng liên quan

- `client/src/features/enrollment/EnrollmentPage.jsx`
  - `selected` là danh sách ưu tiên; `selectedIds` quyết định checkbox bảng catalog (dòng ~874).
  - Toggle mẫu "Tự dọn trùng TKB sau khi chạy" dùng `.enroll-switch` (dòng ~1053); state `autoFixScheduleConflict`.
  - SSE `done` hiện chỉ `loadRegistered()` (dòng ~347).
  - `startRun` gửi `roundId`, `autoFixScheduleConflict`, `refreshToken`, `password`.
  - `registeredRows` đã có `idToHoc` từ `w.dsKqdkmh` — dùng làm nguồn cho tick sẵn.
- `client/src/api/enrollment.js`: `startRun` là nơi duy nhất cần thêm `watchSlots`.
- `src/modules/enrollment/enrollment.controller.js`
  - `startRun` suy ra `triggerAt` từ `roundId` + `resolveSchedule(mssv)`, đã có `closesAt` của đợt.
  - `run-service.start` nhận `autoFixScheduleConflict`.
- `src/modules/enrollment/enrollment-run.service.js`
  - `execute()`: đăng ký tuần tự các mục `chinh`, gọi `autoFixConflicts` (nếu bật), rồi `finishRun('done')`.
  - `recordItem()` ghi `results` + `summaryAcc`, nhưng `that_bai` chỉ có `ly_do` dạng chữ — chưa có mã lý do máy đọc được.
  - `registerSubject()` phân loại `seat_full`, fallback dự phòng, rồi `recordItem(..., 'failed', 'hết chỗ (kể cả dự phòng)')`.
  - `refreshCatalogIds()` cập nhật `id_to_hoc` trong snapshot theo `maMon` + `nhomTo`/`tkb`.
  - `resumeActiveRuns()` / `resumeRun()` đang resume các run active từ DB.
  - `finishRun()` xoá password/token khỏi RAM, ghi DB, phát SSE `done`, gửi Discord.
- `src/modules/enrollment/enrollment.service.js`: `classifyRegisterResult()` đã trả `seat_full`.
- `src/modules/enrollment/priority-store.js`: chỉ có `listPriorities` / `replacePriorities`; cần thêm hàm xoá theo nhóm môn.

## 4. Mô hình dữ liệu & state

### 4.1. Không migration

`enrollment_runs.status` giữ nguyên. Thông tin canh slot nằm trong cột `state` JSON (đã có từ migration 072) và `serialize()`:

```jsonc
// state
{
  "phase": "registering" | "watching",
  "watchSlots": true,
  "watchUntilMs": 1762905600000,
  "autoFixScheduleConflict": false,
  "summaryAcc": { "...": "như hiện tại" }
}
```

`serialize()` trả thêm `phase`, `watchUntil` (ISO), `watchSlots` để client hiển thị badge/đếm ngược. `serializeStoredRun()` cũng trả `phase: row.state?.phase ?? 'registering'`, `watchSlots`, `watchUntil`.

`canh_slot` phải được khởi tạo/đồng bộ ở tất cả nơi đang xử lý `summaryAcc`: `start()`, `resumeRun()`, `summaryOf()`, `stateOf()`, `finishRun()` và bản copy trong `serialize()` / `serializeStoredRun()`. Thiếu một chỗ sẽ làm mất thống kê canh slot khi F5 hoặc khi ghi DB.

### 4.2. Lưu trữ danh sách ưu tiên

Thêm vào `priorityStore`:

```js
async deletePrioritiesBySubjects(mssv, maMons) {
  const subjects = [...new Set((maMons ?? []).filter(Boolean))];
  if (!subjects.length) return 0;
  const result = await query(
    'DELETE FROM enrollment_priorities WHERE mssv = $1 AND ma_mon = ANY($2::text[])',
    [String(mssv), subjects]
  );
  return result.rowCount ?? 0;
}
```

- Idempotent: gọi lại không lỗi, trả 0.
- Không đụng môn không thành công.
- Store giả trong test cũ không có hàm này → run-service bỏ qua an toàn (`typeof === 'function'`).

### 4.3. Mã lý do trong kết quả

`recordItem(run, item, status, reason, fallbackFrom, reasonCode)` bổ sung `reasonCode`:

| `classifyRegisterResult` | `reasonCode` |
|---|---|
| `seat_full` | `seat_full` |
| `prereq` | `prereq` |
| `schedule_conflict` | `schedule_conflict` |
| `over_credit` | `over_credit` |
| `gate_closed` | `gate_closed` |
| `auth` | `auth` |
| `otp` | `otp` |
| `rejected` | `rejected` |
| `transient` | `transient` |

`results[]` và `summaryAcc.that_bai[]` mang thêm `code`. Các consumer hiện tại (log, Discord, UI) bỏ qua field thừa nên tương thích ngược.

## 5. Vòng đời run

### 5.1. Kích hoạt

`POST /api/enrollment/runs` nhận thêm `watchSlots: boolean`. Controller:

1. Nếu `watchSlots === true`:
   - Bắt buộc dùng đường `roundId` (lịch nhà trường). Nếu chỉ có `triggerAt` → `400 "Canh slot chỉ hỗ trợ khi chọn đợt theo lịch nhà trường."`
   - `watchUntil = new Date(slot.closesAt + ':00+07:00')`; nếu không hợp lệ → `400`.
2. Truyền `watchSlots` và `watchUntil` xuống `EnrollmentRunService.start()`.
3. `start()` lưu `watchSlots`, `watchUntilMs`, `phase: 'registering'` vào run + `state`.

### 5.2. Sau lượt đăng ký đầu

Sau vòng lặp các mục `chinh`, trước khi quyết định kết thúc:

1. `doneMaMons` = các `ma_mon` trong `summaryAcc.thanh_cong` (gồm thành công trực tiếp, `already_registered`, và dự phòng thay thế).
2. Gọi `cleanupSuccessfulPriorities(run)`:
   - Bỏ qua các `maMon` đã dọn trong run này (Set `cleanedMaMons`).
   - Gọi `priorityStore.deletePrioritiesBySubjects(mssv, maMonsMới)`.
   - Log `info`: "Đã gỡ N môn đã đăng ký khỏi danh sách ưu tiên."
   - Phát SSE `{ type: 'priority_updated', removedMaMons: [...] }`.
   - Lỗi DB → log `warning`, không đổi kết quả run.
3. `watchTargets` = các môn có mục `chinh` trong `summaryAcc.that_bai` với `code === 'seat_full'`.
   - Mục tiêu mỗi tick: lấy lại từ `run.snapshot` mọi item cùng `maMon`, sắp theo `thuTu` (để tự ăn theo `refreshCatalogIds`).
4. Nếu `!watchSlots` hoặc `watchTargets` rỗng hoặc `now >= watchUntilMs`:
   - Chạy `autoFixConflicts` nếu bật (như hiện tại) rồi `finishRun('done')`.
5. Ngược lại: `phase = 'watching'`, `updateRun` + `persistRun`, log "Bắt đầu canh slot N môn tới <giờ đóng>. Thử lại mỗi 60s.", phát `snapshot`, rồi vào vòng canh.

### 5.3. Vòng canh slot

```
while (!run.stopRequested && now() < watchUntilMs && còn môn cần canh):
  if token sắp hết hạn: tryRefresh(allowPassword: true); thất bại → finishRun('failed')
  for mỗi môn cần canh (theo thuTu):
    for mỗi item của môn trong snapshot (chính → dự phòng):
      bỏ qua nếu item đã nằm trong watchDropped
      một request registerGroup (không retry nội bộ)
      phân loại:
        thanh_cong | already_registered → ghi success, dọn nhóm môn, bỏ môn khỏi canh
        seat_full → giữ nguyên, sang lớp kế
        gate_closed → tạm dừng toàn bộ vòng canh 15 phút (ngoài 09:00–20:00), không drop lớp
        transient | rate_limit → bỏ qua tick cho lớp đó, không drop
        auth → tryRefresh; thất bại → finishRun('failed')
        rejected + Warning (mã lớp cũ) → refreshCatalogIds một lần (rate-limit ≥10 phút), tiếp tục
        prereq | over_credit | schedule_conflict | otp | rejected khác → thêm item vào watchDropped
      nếu mọi item của môn đã nằm trong watchDropped và chưa thành công:
        bỏ môn khỏi danh sách canh + log "không còn lớp khả dụng cho <ma_mon>"
  sleep theo từng đoạn ≤5s tới mốc tick kế (Dừng phản hồi ≤5s)
```

- Mỗi tick chỉ ghi log khi có thay đổi trạng thái; heartbeat mỗi 5 phút: "Đang canh N môn · lần thử tiếp theo sau …".
- Khi một môn canh được:
  - Gọi `recordItem(run, item, 'success', undefined, fallbackFrom)`. Nếu item thành công là `du_phong`, `fallbackFrom` = `id_to_hoc` của mục `chinh` cùng môn và ghi thêm `summaryAcc.fallback`.
  - Xoá entry `that_bai` cũ của cùng `maMon` khỏi `summaryAcc` (không còn mâu thuẫn thành công/thất bại).
  - Thêm `summaryAcc.canh_slot.push({ ma_mon, id_to_hoc, so_lan_thu })`.
  - Gọi `cleanupSuccessfulPriorities(run)`.
  - Gửi Discord: "Canh được slot <ma_mon> (<nhóm>) sau N lần thử."
- Kết thúc vòng:
  - `stopRequested` → `finishRun('stopped')`.
  - `now >= watchUntilMs` → log "Đợt đăng ký đã đóng — kết thúc canh slot." rồi `finishRun('done')`.
  - `autoFixScheduleConflict` bật → `autoFixConflicts(run)` **một lần** trước khi `finishRun`.
  - Không còn môn cần canh → `finishRun('done')`.

### 5.4. Kết thúc run

- `finishRun()` gọi `cleanupSuccessfulPriorities(run)` trước khi dựng `summary`/phát `done` để mọi kết cục (done/failed/stopped) đều dọn được môn đã đăng ký.
- `summary` cuối gồm `thanh_cong`, `that_bai` (đã loại các môn canh được), `fallback`, `rut`, và `canh_slot`.
- Môn đã đăng ký thành công rồi bị `autoFixConflicts` tự rút vì trùng lịch vẫn được coi là đã xử lý và đã bị gỡ khỏi ưu tiên — id đó sẽ luôn trùng lịch nếu thử lại; người dùng tick lớp khác nếu muốn học môn đó.
- Discord `done`: giữ mẫu hiện tại, thêm câu "Canh slot: N môn được đăng ký" nếu có.
- Password/token vẫn bị xoá khỏi RAM như hiện tại.

### 5.5. Restart

- `resumeActiveRuns()`: row active có `state.phase === 'watching'` → gọi `markRunFailed` với lỗi "Server khởi động lại khi đang canh slot — lượt này không thể tiếp tục." (không resume).
- `getLatestForStudent()`: row active + `state.phase === 'watching'` cũng đi nhánh đánh `failed`, không gọi `resumeRun`.
- Row `phase === 'registering'` giữ nguyên hành vi resume hiện tại.

## 6. API & SSE

| Method | Path | Thay đổi |
|---|---|---|
| POST | `/api/enrollment/runs` | Body thêm `watchSlots`; validate `watchUntil` khi bật; truyền xuống run-service |
| GET | `/api/enrollment/runs/:id` | Trả thêm `phase`, `watchUntil` (qua `serialize`) |
| GET | `/api/enrollment/runs/latest` | Trả thêm `phase`, `watchUntil` (qua `serializeStoredRun`) |
| POST | `/api/enrollment/runs/:id/stop` | Không đổi; dừng được cả pha watching |
| SSE | `/api/enrollment/runs/:id/events` | Thêm event `{ type: 'priority_updated', removedMaMons: string[] }` |

Không thêm endpoint xoá priority riêng: việc dọn gắn với vòng đời run để không có thao tác phá huỷ rời rạc.

## 7. UI

### 7.1. Toggle canh slot

- State `watchSlots` (mặc định `false`), reset không cần lưu localStorage.
- Đặt ngay dưới toggle "Tự dọn trùng TKB sau khi chạy", cùng class `.enroll-switch`, `disabled={activeRun}`.
- Khi có run active, toggle hiển thị đúng cấu hình của run đó: `checked={activeRun ? run.watchSlots === true : watchSlots}`.
- Object `setRun` tạo ngay sau khi kích hoạt phải có `phase: 'registering'`, `watchSlots`, `watchUntil` để UI không nháy trạng thái sai trước snapshot đầu tiên.
- Nhãn: **Canh slot lớp hết chỗ**
- Phụ: "Cứ 1 phút thử lại lớp báo hết chỗ (gồm dự phòng) tới khi đăng ký được hoặc đợt đóng. Mặc định tắt."
- `handleConfirmStart` gửi `watchSlots` trong `startRun`.

### 7.2. Trạng thái & đếm ngược

- `statusLabel`: nếu `run.phase === 'watching'` → "Đang canh slot" (badge riêng, tone info), ngược lại giữ map hiện tại.
- Khi watching, khối `enroll-countdown` hiện: "Đang canh slot · thử lại mỗi 60s · tới `<watchUntil>`".
- Terminal log nhận các dòng canh slot qua SSE sẵn có.
- Nút Dừng hiển thị vì `activeRun` vẫn đúng.

### 7.3. Bảng "Môn học đang mở"

- Tạo `registeredIds` từ `registeredRows` (Set `idToHoc`).
- Thêm helper `client/src/features/enrollment/catalog-selection.js`:
  - `isRegisteredId(registeredIds, idToHoc)`.
  - `checkboxState({ idToHoc, selectedIds, registeredIds })` → `{ checked, disabled, registered }` với `checked = selected || registered`, `disabled = registered`.
- Render dòng:
  - `checked` lấy từ helper; `disabled` khi đã đăng ký.
  - Tag `Đã ĐK` cạnh mã môn; class `is-registered` để làm mờ nhẹ.
  - `toggleGroup` return sớm nếu `isRegisteredId(...)`.
- Môn đã đăng ký nhưng không còn trong catalog (do bộ lọc) không hiện — chấp nhận được.
- `registeredIds` lấy **toàn bộ** môn đã đăng ký (kể cả đăng ký thủ công/đợt trước), không chỉ môn của run này — đúng mục tiêu "tránh trùng" khi auto tiếp.
- CSS: thêm `.enroll-table tr.is-registered` (làm mờ nhẹ), tag "Đã ĐK" dùng biến thể `.enroll-tag.is-ok`, badge `.enroll-status.is-watching` (tone info). Không đổi layout hiện có.

### 7.4. Đồng bộ sau khi server dọn ưu tiên

- SSE `priority_updated`: `setSelected(current => current.filter(item => !removedMaMons.includes(item.maMon)))`; gọi `loadRegistered()`; toast "Đã gỡ N môn đã đăng ký khỏi danh sách ưu tiên."
- Không gọi `loadPriority()` ở đây để tránh đè thay đổi chưa lưu của người dùng.
- SSE `done`: giữ `loadRegistered()`; thêm `loadPriority()` nếu `!dirty` để đồng bộ trường hợp lỡ event.
- Môn đã đăng ký vẫn hiện tick sẵn nhờ `registeredIds`, kể cả sau khi đã bị gỡ khỏi `selected`.

## 8. Xử lý lỗi & an toàn

- **Xoá priority lỗi:** log warning; run vẫn thành công. Lần auto sau BDU trả "đã đăng ký" → `already_registered` → coi là thành công và dọn lại.
- **Token hết hạn khi canh:** refresh trước mỗi tick nếu sắp hết hạn; gặp 401/426 thì refresh/login; thất bại hoàn toàn → `finishRun('failed')` + cảnh báo Discord.
- **429/5xx khi canh:** bỏ qua tick cho lớp đó, chờ tick sau; limiter BDU hiện có (8 đồng thời, ≥25ms) vẫn áp dụng.
- **Mã lớp đổi (Warning):** `refreshCatalogIds` cập nhật snapshot; giới hạn 1 lần/10 phút để tránh tải catalog liên tục.
- **Đợt đóng giữa chừng:** dừng theo `watchUntilMs`; request ngoài giờ trả `gate_closed` chỉ bị bỏ qua trong tick, không làm fail run.
- **Trùng tab/kích hoạt lại:** run đang watching vẫn active → `startRun` trả `409` như hiện tại.
- **Bảo mật:** không ghi password/token vào DB/log; `state` chỉ chứa phase/timing. Run watching không resume sau restart nên không giữ bí mật lâu hơn vòng đời process.
- **Tính phá huỷ:** xoá priority là hành vi người dùng yêu cầu, chỉ áp dụng cho môn đã đăng ký thật trong chính run đó.

## 9. Testing

Theo convention repo (`npm test`, không DB/.env thật, không tài khoản thật):

- `tests/test-enrollment-run.js` — mở rộng `makeManager` (đồng hồ ảo, service/store giả):
  - Tắt `watchSlots` → `finishRun('done')` như cũ, không gọi thêm register.
  - `seat_full` ở mục chính, `watchSlots: true` → sang `phase='watching'`, thử lại đúng chu kỳ 60s, thành công ở tick N → `summary.thanh_cong` có môn, entry `that_bai` cũ bị loại, `summary.canh_slot` có số lần thử.
  - Dọn ưu tiên: `deletePrioritiesBySubjects` được gọi đúng **cả nhóm** `ma_mon` (chính + dự phòng), kể cả khi thành công qua dự phòng; không gọi cho môn thất bại.
  - `gate_closed` không dừng vòng; tới `watchUntilMs` → `done` + log đóng đợt.
  - `stop()` giữa canh → `stopped`, không bắn request sau đó.
  - Auth lỗi khi canh → `failed`, có cảnh báo.
  - `resumeActiveRuns` với row `state.phase='watching'` → `failed`, không resume; row `registering` vẫn resume.
  - Không có môn `seat_full` → không vào watching.
  - `autoFixScheduleConflict` bật + watching → `autoFixConflicts` chỉ chạy một lần ở cuối.
- `tests/test-enrollment-controller.js`:
  - `startRun` truyền `watchSlots`/`watchUntil` xuống run-service.
  - Bật canh slot mà thiếu `roundId`/`closesAt` hợp lệ → `400`.
- `tests/test-enrollment-priority.js` hoặc test store mới (nếu có pattern): `deletePrioritiesBySubjects` bỏ qua mảng rỗng, dedupe `ma_mon`.
- `tests/frontend/enrollment-selection.test.js`: `checkboxState` trả `checked + disabled` cho môn đã đăng ký; môn chưa đăng ký giữ hành vi theo `selected`.
- Frontend API test (trong `enrollment-credentials.test.jsx` hoặc file mới): `startRun` gửi `watchSlots` trong body.
- Chạy `npm test`, `npm run lint:frontend`, `npm run build:client`.

## 10. Rủi ro & điểm mở

1. **Nhận diện `seat_full`** dựa trên regex message BDU hiện có; nếu BDU đổi câu chữ, watcher có thể không kích hoạt. Đã có `reasonCode` để sau này bổ sung mẫu ở một chỗ (`classifyRegisterResult`).
2. **Run watching sống lâu** (tới khi đợt đóng) chiếm slot active của tài khoản, nên không kích hoạt lượt mới được cho tới khi dừng. Đây là đánh đổi đã chọn để giữ kiến trúc server-side.
3. **`closesAt` lấy từ lịch tĩnh** (`enrollment-schedule.js`); nếu nhà trường đổi giờ đóng, watcher dừng sai mốc. Cập nhật lịch ở một chỗ như hiện tại.
4. **Xoá cả nhóm môn** là hành vi phá huỷ: nếu người dùng muốn thử lại môn đã đăng ký, phải tick lại từ bảng catalog. Chấp nhận theo yêu cầu.
5. **Không thông báo realtime qua Discord cho từng tick** (chỉ khi có kết quả) để tránh spam; heartbeat chỉ nằm trong log SSE.

## 11. Các bước kế tiếp

1. Duyệt spec này.
2. `writing-plans` tạo implementation plan.
3. Triển khai: store → run-service (reasonCode, cleanup, watching) → controller → client API/helper → UI/CSS → test.
4. Verify: `npm test`, `npm run lint:frontend`, `npm run build:client`.
