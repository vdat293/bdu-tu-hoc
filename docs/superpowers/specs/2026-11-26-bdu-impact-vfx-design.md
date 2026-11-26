# Design Spec: Hệ thống Hiệu ứng Tương tác BDU Impact VFX (Thay thế hoàn toàn Sakuga VFX)

## 1. Mục tiêu & Lý do (Intent & Why)
Ngay sau đợt chuyển đổi giao diện **BDU Tự Học** sang phong cách **Neo-Brutalism Học thuật BDU**, người dùng muốn đưa cảm giác thích thú, "đã tay" khi **bấm xác nhận** và cảm giác sinh động khi **chờ loading** (vốn đang tạo thiện cảm mạnh ở trang BDU WordFmt) phủ đều lên toàn bộ cổng sinh viên.

Tuy nhiên, hệ thống sẽ **loại bỏ hoàn toàn thư viện bên thứ 3 Sakuga VFX** để **tự xây dựng lại từ đầu** vì các lý do sau:
- Sakuga VFX hiện đang bị nhân bản thành 3 bản rời rạc (`public/assets/vendor/sakuga-vfx/`, `public/sakuga-vfx/`, `client/src/features/english/sakuga-*.js`), khó bảo trì.
- Sakuga gốc hardcode bảng màu hiệu ứng tím–hồng pastel (`#b8b3ff`, `#5a4fd8`, `#ff5fa8`), sử dụng chữ SFX tiếng Nhật (`ドン!`, `ゴゴゴゴ`) và Shadow DOM, gây lệch tông với bảng màu Neo-Brutalism BDU (Xanh – Vàng – Đen/Trắng, Light/Dark) và khó ăn khớp cascade CSS/unit test của React.
- Tự build engine riêng giúp kiểm soát tuyệt đối hiệu năng, thẩm mỹ, khả năng hỗ trợ Light/Dark, accessibility (`prefers-reduced-motion`) và mở rộng đồng bộ ra toàn cổng sinh viên theo 2 mức độ đậm/nhẹ.

## 2. Phạm vi: Goals, Non-Goals & Anti-Goals

### Trong phạm vi (Goals)
1. **Lõi Engine BDU Impact VFX tự build 100% (`client/src/lib/bdu-vfx/`)**:
   - Không phụ thuộc thư viện ngoài; dùng Canvas 2D thuần + vật lý lò xo (`Spring`) + 1 vòng lặp `requestAnimationFrame` **tự ngủ khi rảnh** (0% CPU khi không có hiệu ứng hoạt động).
   - Phong cách **Anime/Manga Impact phiên bản Neo-Brutalism BDU**: nén–bật lò xo, khung chớp đảo màu 1 nhịp, tia nổ gai góc, mảnh vỡ hình học chịu trọng lực, luồng khí/mây góc cạnh cuộn theo đầu thanh tiến trình, vệt tốc độ và dấu tích hoàn tất lấp lánh.
   - **Bỏ hoàn toàn chữ tiếng Nhật** (`ドン!`, `ゴゴゴゴ`...), dùng đồ họa sắc nét + dấu tích `✓`.
   - **Đồng bộ Light & Dark Mode tự động**: đọc màu trực tiếp từ trạng thái theme (`theme-light` / `theme-dark`) và CSS tokens của BDU Tự Học tại thời điểm phát hiệu ứng.
2. **Mô hình 2 mức độ trên toàn cổng sinh viên**:
   - **Mức Đậm (Tier 1 — Full Impact)** qua các React component thuần (`<ImpactButton>`, `<ImpactProgress>`):
     - Thay thế 100% `<SakugaButton>` & `<SakugaProgress>` tại [WordFmtPage.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/wordfmt/WordFmtPage.jsx), [DocxReviewWorkspace.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/wordfmt/DocxReviewWorkspace.jsx) và [EnglishPage.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/english/EnglishPage.jsx).
     - Áp dụng `<ImpactButton>` cho các nút xác nhận / hành động chính trọng điểm:
       - Trang Đăng nhập: [LoginPage.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/auth/LoginPage.jsx) (`#btn-login`).
       - Hộp thoại xác nhận dùng chung: [ConfirmDialog.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/components/feedback/ConfirmDialog.jsx) (nút xác nhận primary & danger).
       - Công cụ tự động: [SurveyPage.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/survey/SurveyPage.jsx) (`#btn-start-survey` và nút xác nhận trong modal), [TrainingScorePage.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/training-score/TrainingScorePage.jsx) (nút xác nhận lưu điểm rèn luyện), [EnrollmentPage.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/enrollment/EnrollmentPage.jsx) (nút lưu danh sách ưu tiên & kích hoạt đăng ký tự động).
       - Cộng đồng & học tập: [ConfessionPage.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/confession/ConfessionPage.jsx) (nút đăng bài), [QuizRunner.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/learning/QuizRunner.jsx) & [QuizTestRunner.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/features/learning/QuizTestRunner.jsx) (nút nộp bài).
     - Áp dụng `<ImpactProgress>` cho tiến trình chuẩn hóa WordFmt (7 giai đoạn + bùng nổ 100%) và tiến trình đăng nhập Moodle English (chạy tới 99% rồi nhảy 100% khi hợp lệ, dừng ở 99% khi lỗi).
   - **Mức Nhẹ (Tier 2 — Micro-impact & Global Loading)**:
     - `<BduVfxBridge />` gắn 1 lần tại [App.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/app/App.jsx), dùng event delegation để mang cảm giác nén–bật gọn + 2–3 vạch tia nhỏ quanh góc nút cho toàn bộ nút bấm thường ngày (`.btn`, `.btn-ghost`, `.btn-icon`, v.v.) trong cổng sinh viên mà không phải sửa tay hàng trăm thẻ JSX.
     - Nâng cấp toàn bộ thành phần loading dùng chung tại [Loading.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/components/feedback/Loading.jsx) (`Spinner`, `PageSpinner`, `InlineSpinner`, `ButtonSpinner`) thành loader chuyển động khối nhịp Neo-Brutalist đồng bộ với hệ VFX (không còn vòng tròn xoay mỏng cũ).
3. **Dọn sạch 100% di sản Sakuga VFX**:
   - Xóa `public/assets/vendor/sakuga-vfx/`, `public/sakuga-vfx/`, `client/src/features/english/sakuga-button.js`, `client/src/features/english/sakuga-progress.js`, `client/src/features/wordfmt/SakugaVfx.jsx`.
   - Dọn các biến CSS `--sk-*` và class `.wf-sakuga-*` / `.sakuga-dot` không còn sử dụng trong `wordfmt-status.css`, `wordfmt-preview.css`, `app.css`.
4. **Kiểm thử đầy đủ**:
   - Cập nhật `tests/frontend/wordfmt-page.test.jsx` và `tests/frontend/english-page.test.jsx` theo component mới (giữ nguyên toàn bộ kiểm chứng nghiệp vụ).
   - Bổ sung unit test mới `tests/frontend/bdu-vfx.test.jsx` cho engine vật lý, `<ImpactButton>`, `<ImpactProgress>`, `<BduVfxBridge>`, và `prefers-reduced-motion`.

### Ngoài phạm vi & Vùng bảo toàn (Non-Goals / Protected Surfaces)
1. **Admin Dashboard (`/admin`)**: Không gắn `BduVfxBridge`, không đổi nút hay loader trong `client/src/admin/**`.
2. **Các vùng bảo toàn của đợt Neo-Brutalism**: Tuyệt đối không để `BduVfxBridge` hay CSS VFX rò rỉ vào:
   - Ngân hàng luyện đề `INF0983` Claymorphism (`.clay-pb-scope`, `practice-bank.css`).
   - Tờ giấy A4 xem trước của WordFmt (`.wf-gdoc-page`).
   - Tranh minh họa sưu tầm bên trong `GradeShareCard`.
   - Cảnh nhân vật 3D trang Đăng nhập (`StudentScene`).
   - Avatar Signature Frames & Title Gems.
   - Khu Mini-Games & trang độc lập (`public/games/**`, `public/killer-sudoku/**`, `public/admin-tool.html`).
3. **Âm thanh (Audio SFX)**: Không phát âm thanh mặc định (phù hợp môi trường giảng đường/thư viện).
4. **Chữ tượng thanh tiếng Nhật / nhãn text bay**: Không vẽ chữ tiếng Nhật (`ドン!`, `ゴゴゴゴ`...) lên canvas.
5. **Logic nghiệp vụ & Backend API**: Không thay đổi API, payload hay hành vi xác nhận/submit hiện có.

### Anti-Goals (Tiêu chí thất bại)
- Còn sót bất kỳ file, import, custom element (`<sakuga-button>`, `<sakuga-progress>`) hoặc CSS `--sk-*` nào của Sakuga VFX trong mã nguồn.
- Vòng lặp `requestAnimationFrame` vẫn chạy khi màn hình đứng yên không có hiệu ứng.
- Lớp Canvas chặn click/scroll (thiếu `pointer-events: none`) hoặc hiệu ứng bị cắt bởi `overflow: hidden` của card/modal.
- Spam click gây giật/lag hoặc tràn bộ nhớ hạt; hoặc bỏ qua `prefers-reduced-motion: reduce`.
- Nét vẽ canvas bị tàng hình hoặc chói gắt sai tương phản khi chuyển Light ↔ Dark.
- Làm vỡ bộ test hiện có hoặc các ID/selector quan trọng (`#btn-login`, `#btn-start-wordfmt`, `#btn-confirm-wordfmt`, `#btn-download-docx`, `#btn-english-connect`, `#english-connect-progress`, `#btn-start-survey`).

## 3. Ràng buộc kỹ thuật (Constraints)
- **Môi trường test & SSR-safe**: Chạy trên Vitest + jsdom (`@testing-library/react`), nơi `Path2D`, `matchMedia`, hoặc `canvas.getContext('2d')` có thể không tồn tại hoặc trả về `null`. Engine phải tự nhận diện và fallback im lặng (không throw), đồng thời giữ nguyên tương tác nút/progress bình thường.
- **Hợp đồng luồng `EnglishPage`**: Khi bấm `#btn-english-connect`, form đăng nhập vẫn mờ đi, khóa cuộn trang, hiển thị overlay `#english-connect-progress-wrap` với trạng thái `#english-connect-status` ("Đang đăng nhập, chờ tí" + 3 dấu chấm nảy) và `#english-connect-progress` chạy lên 99% (`0.995`); khi API trả thành công mới nhảy lên 100% (`1`) phát nổ hoàn tất rồi mở danh sách khóa học; khi API lỗi thì dừng ở 99% và hiện `#english-login-error`.
- **Hợp đồng luồng `WordFmtPage`**: Giữ nguyên 7 giai đoạn xử lý, hiển thị `<ImpactProgress>` ở chế độ running/success, khi hoàn tất 100% phát nổ hoàn tất và hiện nút `#btn-download-docx` (`<ImpactButton>` có `doneTrigger` kích hoạt dấu tích `✓` lấp lánh sau khi tải).
- **Bảo vệ hiệu năng**: Giới hạn tối đa số hạt đồng thời (`MAX_PARTICLES = 180`), giới hạn `devicePixelRatio <= 2`, debounce/throttle nhẹ khi spam click liên tục cùng một nút.
- **Accessibility**: Tôn trọng `prefers-reduced-motion: reduce` động (lắng nghe cả sự kiện `change`). Khi bật reduced motion: không vẽ hạt/chớp đảo màu trên canvas, chỉ hiển thị thay đổi trạng thái rõ ràng (dấu tích, thanh tiến trình cập nhật trực tiếp).

## 4. Các hướng tiếp cận đã cân nhắc (Approaches)
- **Hướng A *(Đã chọn)* — Engine Canvas 2D tự viết + React Components (Mức Đậm) + Global Delegation Bridge (Mức Nhẹ)**:
  - *Cách làm*: Tự viết lõi Canvas 2D + Spring physics gọn nhẹ không dependency; xây `<ImpactButton>` / `<ImpactProgress>` trên thẻ HTML/React thuần (không Shadow DOM) cho Mức Đậm; gắn 1 `<BduVfxBridge />` tại `App.jsx` bắt sự kiện toàn cổng sinh viên cho Mức Nhẹ; nâng cấp `Loading.jsx`.
  - *Lý do chọn*: Hòa làm một với CSS Neo-Brutalism & Light/Dark hiện có, hiệu ứng nổ không bị cắt bởi `overflow: hidden`, phủ toàn cổng sinh viên mà không phải sửa tay hàng trăm file JSX, dễ viết unit test React.
- **Hướng B *(Loại)* — Tự viết lại Custom Web Components (`<bdu-button>`, `<bdu-progress>`) dùng Shadow DOM**:
  - *Đánh đổi*: Shadow DOM cắt đứt cascade `.btn` của Neo-Brutalism, xử lý form submit/ref/test rườm rà và không giải quyết được Mức Nhẹ toàn cục.
- **Hướng C *(Loại)* — Thuần CSS Keyframes + SVG inline (không Canvas 2D)**:
  - *Đánh đổi*: Không tạo được hạt rơi vật lý, đám mây cuộn biến dạng theo tốc độ tiến trình thực tế, bấm liên tiếp dễ bị cắt ngang và bị `overflow: hidden` cắt mất tia nổ.

## 5. Thiết kế chi tiết Hệ thống BDU Impact VFX

### 5.1. Bảng màu Canvas động theo Light / Dark Mode
Engine đọc bảng màu tại thời điểm phát hiệu ứng từ `document.body.classList.contains('theme-dark')` (ưu tiên đọc CSS variables nếu có override, fallback về bộ màu Neo-Brutalism BDU chuẩn):

| Token hiệu ứng | Light Mode | Dark Mode | Vai trò hình họa |
|---|---|---|---|
| `ink` | `#111111` | `#E4E4E7` | Viền nét vẽ, tia tốc độ, đường mặt đất, bóng cứng |
| `primary` | `#1D4ED8` | `#3B82F6` | Lõi tia nổ chính, thanh tiến trình, mảnh vỡ chủ đạo |
| `accent` | `#FACC15` | `#FDE047` | Tia nhấn nổi bật, vạch tốc độ (ticks), ngôi sao lấp lánh |
| `surface` | `#FFFFFF` | `#1A1E26` | Mảng sáng trong mây/khói, lõi sao nổ |
| `shade` | `#DBEAFE` | `#1E3A8A` | Mảng đổ bóng cứng (cel-shading) trên mây/sỏi/mảnh vỡ |
| `success` | `#10B981` | `#34D399` | Dấu tích hoàn tất `✓` & tia chúc mừng |
| `danger` | `#EF4444` | `#FB7185` | Tông nổ riêng cho nút xác nhận nguy hiểm (`tone="danger"`) |

### 5.2. Kiến trúc module (`client/src/lib/bdu-vfx/`)
1. **`spring.js`**:
   - Lớp `Spring(initial, stiffness, damping)` tích phân bước nhỏ `<= 0.008s` để chuyển động đồng nhất ở 60Hz/120Hz/144Hz.
   - Các hàm easing gọn (`easeOutCubic`, `easeInCubic`, `easeOutBack`).
2. **`palette.js`**:
   - Hàm `readVfxPalette(tone)` trả về bảng màu khớp Light/Dark hiện tại và `tone` (`primary` | `success` | `danger` | `secondary`).
   - Theo dõi `prefers-reduced-motion: reduce` (`isReducedMotion()`).
3. **`stage.js`**:
   - Singleton quản lý 1 `<canvas class="bdu-vfx-canvas" aria-hidden="true">` gắn vào `document.body` (`position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 2147483000`).
   - Quản lý danh sách hiệu ứng ngắn hạn (`effects`, giới hạn `MAX_PARTICLES = 180` bằng cách loại bỏ hạt cũ nhất khi vượt ngưỡng) và vòng vẽ liên tục (`persistentRenderers` cho các `<ImpactProgress>` đang hiển thị).
   - **Tự động ngủ khi rảnh**: chỉ gọi `requestAnimationFrame` khi còn hiệu ứng hoặc renderer đang hoạt động; khi xong thì xóa sạch canvas và dừng vòng lặp hoàn toàn.
   - Đảm bảo tọa độ vẽ theo viewport (`getBoundingClientRect()`) nên luôn bám đúng nút/thanh ngay cả bên trong container cuộn (`#main-content`) hoặc modal.
4. **`effects.js`**:
   - Các hàm vẽ thuần Canvas 2D theo phong cách Anime/Manga Impact Neo-Brutalist (viền sắc, cel-shading cứng 2 tông, 0 blur):
     - `spawnPressCharge(el, tone)`: 3 vạch tốc độ (`ticks`) hướng vào nút + 2 cặp nét cong nén 2 bên khi `pointerdown` trên nút Mức Đậm.
     - `spawnImpactBurst(el, tone)`:
       - Tia nổ gai góc 2 lớp (`spikyBurst`: lớp ngoài `accent` + viền `ink`, lớp trong `surface`/`primary`).
       - 8–10 mảnh vỡ đa giác (`shards`) văng ra chịu trọng lực và xoay.
       - 3–4 cụm luồng khí/mây góc cạnh (`angularPuff`) có bóng cel-shading tản ra 4 góc nút.
       - 1 vòng xung kích elip (`shockRing`) mở rộng rồi tan.
     - `spawnMicroTap(el, tone)`: 2–3 vạch tia nhỏ (`ticks`) gọn sắc ở góc trên-phải hoặc quanh điểm chạm (thời lượng ~`240ms`, tối đa 3–4 phần tử vẽ) cho Mức Nhẹ.
     - `spawnDoneSpark(el, tone)`: 1–2 ngôi sao 4 cánh (`sparkle`) mở–khép kèm vạch nhấn nhỏ bên cạnh dấu tích `✓`.
     - `renderProgressOverlay(ctx, barRect, state, palette)`:
       - Đường nền mặt đất có vạch cỏ/vạch tốc độ vẽ dần dưới thanh.
       - 5 viên sỏi hình học nhỏ bật nảy lên theo lò xo khi đầu thanh tiến trình đi qua và hạ xuống khi đạt 100%.
       - Cụm luồng khí/mây góc cạnh nhiều thùy cuộn tại đầu thanh tiến trình, lớn dần theo `%` và nghiêng kéo ngược theo tốc độ `speed`; khi đang chạy nhanh thì rải thêm tia tốc độ (`speedLines`) và cụm khí nhỏ bay về sau.
       - Tại mốc 100%: kích hoạt bùng nổ 1 lần (`spikyBurst` + `shards` + `angularPuff` quanh thanh), bật dấu tích `✓` lớn bằng lò xo phía trên thanh kèm ngôi sao 4 cánh lấp lánh, để lại 2 cụm khí nhỏ đứng yên hai bên mặt đất.
5. **`ImpactButton.jsx`** (Mức Đậm — Tier 1):
   - Render thẻ `<button>` native gắn `data-vfx="impact"` (tránh Bridge kích hoạt trùng).
   - Props: `id`, `type = 'button'`, `tone = 'primary'`, `className = ''`, `disabled = false`, `loading = false`, `doneTrigger = 0`, `onClick`, `ariaLabel`, `title`, `children`, `...rest`.
   - Hỗ trợ `forwardRef` / `useImperativeHandle` với 2 phương thức `impact()` và `done(holdMs = 1800)` để các màn đặc thù như `EnglishPage` chủ động kích hoạt lúc submit thành công.
   - Cơ chế tương tác:
     - `pointerdown`: nén nút theo trục Y (`squash`), phình nhẹ trục X, gọi `spawnPressCharge`.
     - `click`: kích hoạt hiệu ứng chớp đảo màu `.bdu-impact-btn--invert` trong `150ms`, bật nảy lò xo (`rebound` + nghiêng nhẹ `-2.5deg` rồi hồi về `0deg`), gọi `spawnImpactBurst`.
     - `doneTrigger` tăng hoặc gọi `ref.done()`: trượt mở dấu tích SVG `✓` trên nút kèm `spawnDoneSpark`, tự ẩn sau `1800ms`.
6. **`ImpactProgress.jsx`** (Mức Đậm — Tier 1):
   - Props: `id`, `progress` (`0..100`, tùy chọn nếu điều khiển qua ref), `label`, `doneLabel = 'Hoàn tất 100% ✓'`, `isComplete = false`, `tone = 'primary'`, `onComplete`, `className = ''`, `style`.
   - Hỗ trợ `ref` với `{ set(ratio01, instant), reset(), get value() }` để hỗ trợ mượt luồng `EnglishPage` (chạy tới `0.995` rồi quyết định `1` hoặc dừng).
   - Cấu trúc DOM chuẩn Neo-Brutalism (không Shadow DOM):
     - Container `role="progressbar"` với `aria-valuemin="0"`, `aria-valuemax="100"`, `aria-valuenow`, `aria-label`.
     - Thanh `.bdu-impact-progress__bar`: viền `3px solid var(--border-color)`, bo góc `6px`, bóng cứng; phần fill `.bdu-impact-progress__fill` có họa tiết sọc chéo tốc độ chuyển động bằng CSS.
     - Nhãn phần trăm `.bdu-impact-progress__badge`: khung nghiêng `-8deg`, viền đen, bóng cứng màu accent, nảy nhẹ mỗi bước 5% và nảy lớn lúc 100%.
     - Khi mount & visible trên viewport, đăng ký renderer với `stage.js` để vẽ phần luồng khí/sỏi/vệt tốc độ/nổ 100% lên canvas chung.
7. **`BduVfxBridge.jsx`** (Mức Nhẹ — Tier 2):
   - Gắn 1 lần trong [App.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/app/App.jsx) (chỉ có trong cổng sinh viên; không gắn trong `AdminApp.jsx`).
   - Event delegation (`pointerdown` & `click` trên `document`):
     - Chọn mục tiêu: `event.target.closest('button, a.btn, [role="button"]')`.
     - **Luật loại trừ nghiêm ngặt**: bỏ qua nếu nút `disabled` / `aria-disabled="true"`, nằm trong `.clay-pb-scope`, `.wf-gdoc-page`, `[data-vfx="off"]`, `[data-vfx="impact"]`, `.admin-shell`, hoặc kích thước quá nhỏ (`rect.width < 28 || rect.height < 24`).
     - Hiệu ứng Mức Nhẹ: thêm class CSS `.bdu-vfx-micro-pop` (~`180ms` nén–bật gọn bằng CSS keyframes không đè transform tĩnh lâu dài) + gọi `spawnMicroTap(el)` vẽ 2–3 vạch tốc độ ở góc nút.
8. **Nâng cấp bộ Loading dùng chung ([Loading.jsx](file:///c:/Nor/bdu-tu-hoc/bdu-tu-hoc/client/src/components/feedback/Loading.jsx))**:
   - Thay vòng xoay mảnh cũ bằng loader **Neo-Brutalist Kinetic Blocks**:
     - `PageSpinner`: 3 khối vuông bo nhẹ viền `2px solid var(--border-color)` + bóng cứng (màu Xanh BDU – Vàng – Xanh/Trắng) nhảy nối tiếp kiểu đàn hồi (squash-and-stretch), kèm nhãn chữ in đậm; dừng chuyển động gọn khi `prefers-reduced-motion`.
     - `InlineSpinner` & `ButtonSpinner`: phiên bản 3 chấm/khối vuông mini sắc cạnh (`14px–16px`) đồng bộ, không phá bố cục nút hay dòng chữ.
9. **`bdu-vfx.css`**:
   - Import một lần từ `client/src/styles/app.css` hoặc `client/src/app/App.jsx`.
   - Khai báo toàn bộ style cho `.bdu-impact-btn`, `.bdu-impact-btn--invert`, `.bdu-impact-progress`, `.bdu-vfx-micro-pop`, `.bdu-kinetic-loader` và media query `@media (prefers-reduced-motion: reduce)`.

## 6. Bản đồ file tác động

### Tạo mới
- `client/src/lib/bdu-vfx/spring.js`
- `client/src/lib/bdu-vfx/palette.js`
- `client/src/lib/bdu-vfx/stage.js`
- `client/src/lib/bdu-vfx/effects.js`
- `client/src/lib/bdu-vfx/ImpactButton.jsx`
- `client/src/lib/bdu-vfx/ImpactProgress.jsx`
- `client/src/lib/bdu-vfx/BduVfxBridge.jsx`
- `client/src/lib/bdu-vfx/bdu-vfx.css`
- `client/src/lib/bdu-vfx/index.js`
- `tests/frontend/bdu-vfx.test.jsx`

### Chỉnh sửa
- `client/src/app/App.jsx`: Gắn `<BduVfxBridge />`.
- `client/src/components/feedback/Loading.jsx` & `client/src/styles/app.css`: Nâng cấp kinetic loader & dọn `.sakuga-dot`.
- `client/src/components/feedback/ConfirmDialog.jsx`: Dùng `<ImpactButton>` cho nút xác nhận.
- `client/src/features/wordfmt/WordFmtPage.jsx`, `DocxReviewWorkspace.jsx`, `client/src/styles/wordfmt-status.css`, `wordfmt-preview.css`: Thay `<SakugaButton>`/`<SakugaProgress>` sang `<ImpactButton>`/`<ImpactProgress>`, dọn `--sk-*` và `.wf-sakuga-*`.
- `client/src/features/english/EnglishPage.jsx`: Thay `<sakuga-button>`/`<sakuga-progress>` sang `<ImpactButton>`/`<ImpactProgress>` giữ nguyên hợp đồng 99%→100% / 99% lỗi.
- `client/src/features/auth/LoginPage.jsx`: Thay `#btn-login` bằng `<ImpactButton>`.
- `client/src/features/survey/SurveyPage.jsx`, `client/src/features/training-score/TrainingScorePage.jsx`, `client/src/features/enrollment/EnrollmentPage.jsx`: Gắn `<ImpactButton>` cho các nút xác nhận/kích hoạt chính.
- `client/src/features/confession/ConfessionPage.jsx`, `client/src/features/learning/QuizRunner.jsx`, `QuizTestRunner.jsx`: Gắn `<ImpactButton>` cho nút đăng bài / nộp bài.
- `tests/frontend/wordfmt-page.test.jsx`, `tests/frontend/english-page.test.jsx`: Cập nhật selector từ `sakuga-button`/`sakuga-progress` sang `#btn-english-connect`/`#english-connect-progress` và xác minh đầy đủ hành vi mới.

### Xóa bỏ hoàn toàn
- `public/assets/vendor/sakuga-vfx/` (`button.js`, `progress.js`)
- `public/sakuga-vfx/` (`button.js`, `progress.js`)
- `client/src/features/english/sakuga-button.js`
- `client/src/features/english/sakuga-progress.js`
- `client/src/features/wordfmt/SakugaVfx.jsx`

## 7. Các quyết định đã chốt & Phần để lại cho người triển khai (What's Left to the Builder)

### Các quyết định mặc định đã chốt trong thiết kế
- Không phát âm thanh mặc định; luôn hỗ trợ `prefers-reduced-motion: reduce`.
- Bỏ hoàn toàn chữ SFX tiếng Nhật (`ドン!`, `ゴゴゴゴ`), dùng đồ họa thuần + dấu tích `✓`.
- Giữ nguyên `/admin` và toàn bộ vùng bảo toàn (`INF0983`, tờ giấy A4 WordFmt, `GradeShareCard`, cảnh 3D Login, Avatar Frames, Mini-Games).
- Thống nhất `ImpactButton` & `ImpactProgress` dùng DOM/React thuần (không Shadow DOM) để thừa hưởng CSS Neo-Brutalism.

### Phần để lại cho người triển khai tinh chỉnh
- Hằng số lò xo (`stiffness`, `damping`), số đỉnh gai burst, kích thước hạt và vận tốc rơi cụ thể (miễn đảm bảo cảm giác gọn–bật, không vượt `MAX_PARTICLES = 180` và hiển thị đẹp trên cả Desktop lẫn Mobile).
- Tinh chỉnh responsive khoảng đệm phía trên/dưới của `ImpactProgress` để mây cuộn và dấu tích không đè lên chữ tiêu đề trên màn hình mobile 390px.
- Rà soát bổ sung `data-vfx="off"` cho các nút micro-control đặc thù (nếu có trong quá trình kiểm thử thực tế) để Mức Nhẹ luôn gọn gàng.

## 8. Kế hoạch kiểm chứng (Verification)
1. **Kiểm tra sạch Sakuga**: Tìm kiếm toàn repo (`client/`, `public/`, `tests/`) xác nhận không còn file/import/custom-element `sakuga`.
2. **Kiểm thử tự động**: Chạy `npm run lint:frontend`, `npm run test:frontend`, `npm run build:client` đều xanh.
3. **Kiểm thử trình duyệt thật (Antigravity browser)**:
   - Kiểm tra Light & Dark mode, Desktop (1440×900) & Mobile (390×844).
   - Kiểm tra trực tiếp Mức Đậm (WordFmt, English, Login, ConfirmDialog, Survey/Enrollment/Training Score) và Mức Nhẹ (các nút thường trên cổng + kinetic loader).
   - Xác minh không rò rỉ hiệu ứng sang `INF0983` (`.clay-pb-scope`), tờ giấy A4 WordFmt, và `/admin`.
   - Kiểm tra `prefers-reduced-motion: reduce` tắt toàn bộ hiệu ứng canvas.
