# Kế hoạch chuyển frontend BDU Tự Học sang JSX và routing

Ngày khảo sát: 06/09/2026. Trạng thái: đề xuất kỹ thuật dựa trên checkout hiện tại; chưa triển khai migration.

## 1. Mục tiêu và phạm vi

Chuyển giao diện sinh viên sang React viết bằng JavaScript/JSX, chia module theo chức năng và điều hướng bằng URL như `/gpa`, `/info`, `/schedule`. Người dùng mở link trực tiếp, tải lại trang và dùng Back/Forward mà vẫn đến đúng màn hình, đúng bộ lọc đã thể hiện trên URL.

Phạm vi chính gồm 11 tab hiện có, đăng nhập, layout chung, danh tính/ảnh đại diện/danh hiệu, modal, hiệu ứng, API client, kiểm thử và pipeline build/deploy. API Express, PostgreSQL, scheduler và engine WordFmt tiếp tục phục vụ frontend mới. Thay đổi backend tập trung vào phục vụ frontend và những điểm tương thích được chứng minh là cần thiết.

Trang quản trị độc lập `/admin-tool` tiếp tục chạy và phải qua kiểm tra hồi quy; chuyển toàn bộ trang này sang JSX là đợt riêng. Các chức năng quản lý danh tính đang nhúng trong giao diện sinh viên vẫn thuộc phạm vi chuyển đổi. `/enrollment` giữ trạng thái “sắp ra mắt”; migration không bao gồm xây dựng nghiệp vụ đăng ký môn.

## 2. Căn cứ từ mã nguồn

| Thành phần hiện tại | Kết quả khảo sát | Hệ quả đối với kế hoạch |
| --- | --- | --- |
| `public/js/app.js` | 7.721 dòng, 337.994 byte; `AppState` dùng chung; `DOMContentLoaded` gọi các hàm init toàn bộ module | Phải tách state, logic và vòng đời; đổi phần mở rộng thành JSX chưa tạo được ranh giới module |
| `public/index.html` | 2.278 dòng, 124.371 byte; chứa 11 tab cùng modal, có inline `onclick` | Tách layout/page/component; chuyển event sang React |
| `public/js/api.js` | 742 dòng; đối tượng `BduApi`; xử lý hết phiên bằng custom event | Chuyển sang module API, chuẩn hóa lỗi và cơ chế thông báo hết phiên |
| `public/js/interactions.js` | 502 dòng; command palette dựa vào nút tab; nhiều listener/observer | Điều hướng dùng chung cấu hình route, effect có cleanup |
| CSS | `style.css` 15.161 dòng; `showcase.css` 1.062 dòng | Giữ giao diện đối chiếu trong giai đoạn đầu, sau đó tách CSS theo module |
| `server.js` | Serve `public/`, có fallback `GET *` về `index.html`, ngoại lệ `/api` và route `/admin-tool` | Đã có nền tảng fallback nhưng cần trỏ đúng build mới và phân biệt asset/API/page |
| `package.json` | ESM; chưa có React, router, bundler; test chạy bằng các script Node | Bổ sung build frontend, lint và test component/E2E |
| Auth | `bdu_token`, `bdu_user`, `bdu_token_expires_at` ở local/session storage | Phải giữ chức năng nhớ đăng nhập và chống lẫn dữ liệu hai tài khoản |
| Realtime | Community dùng `/ws/community`; survey và English dùng SSE | Không được xem mọi kết nối là tài nguyên chỉ sống cùng page |
| Docker | Node 22 + .NET 10, `npm ci --omit=dev`, chưa có bước build UI | Cần build stage riêng và copy artifact frontend vào runtime |
| Test UI | Nhiều test đọc chuỗi `public/js/app.js`, `public/index.html`, CSS rồi dùng regex | Cần thay kiểm tra cấu trúc cũ bằng kiểm tra hành vi tương đương |

Các số liệu là kích thước source, không phải dung lượng truyền qua mạng hay số liệu hiệu năng. Chưa đo benchmark và chưa chạy regression suite trong đợt lập kế hoạch này.

`READFORME.md` đang mô tả một số cấu trúc chưa có trong checkout, ví dụ `public/js/features/`, `public/js/core/`, `src/server/modules/`. Không dùng các đường dẫn đó làm giả định rằng công việc đã hoàn tất. Khi triển khai phải cập nhật tài liệu theo cấu trúc thực tế.

## 3. Kiến trúc đích và quyết định công nghệ

| Quyết định đề xuất | Lý do | Kết quả mong muốn |
| --- | --- | --- |
| React + JavaScript/JSX | Đúng định hướng JSX, phù hợp code JS hiện tại | Component nhận props, render từ state; hàm nghiệp vụ thuần để trong `.js` |
| Vite + plugin React | Tạo bước biên dịch JSX, dev server và production build | Một quy trình build có thể lặp lại từ lockfile |
| React Router, Declarative mode | Nhu cầu chính là route, nested layout, URL và navigation | `BrowserRouter`, `Routes`, `Route`, `Outlet`, `NavLink`; URL là nguồn xác định page |
| TanStack Query cho dữ liệu API | Có nhiều dữ liệu chia sẻ, cache và invalidation sau mutation | Query được phân vùng theo tài khoản và tham số, tránh tự viết thêm một hệ thống cache |
| Context cho auth/theme/toast; state cục bộ cho UI | Mỗi loại state có vòng đời khác nhau | Không thay `AppState` cũ bằng một context khổng lồ |
| Chart.js quản lý qua module và component | Giữ biểu đồ hiện có, bỏ phụ thuộc global CDN trong app mới | Chart chỉ tải cùng GPA và được destroy khi unmount |
| Giữ Express cùng origin ở production | Tái sử dụng API, SSE, WebSocket, media và download | Chưa cần tách domain, CORS hoặc thêm SSR vào đợt này |

React Router hỗ trợ route lồng và layout dùng `Outlet`; `NavLink` phục vụ trạng thái điều hướng đang chọn. Đây là cơ sở cho cấu trúc đề xuất. [Tài liệu routing chính thức](https://reactrouter.com/start/declarative/routing).

Chốt phiên bản tương thích khi bắt đầu, ghi vào lockfile; không dùng khoảng phiên bản “latest” cho quy trình deploy. Chuẩn hóa dev/CI theo Node 22 với patch đáp ứng Vite đã chọn; tài liệu Vite hiện nêu yêu cầu Node 20.19+ hoặc 22.12+. README hiện ghi 18+/20+ cần cập nhật. [Yêu cầu Vite](https://vite.dev/guide/).

### Cấu trúc thư mục đề xuất

```text
client/
  index.html
  src/
    main.jsx
    app/
      App.jsx
      routes.jsx
      navigation.js
      providers.jsx
    layouts/
      AppLayout.jsx
      AuthLayout.jsx
    components/
      navigation/             # Sidebar, Topbar, CommandPalette
      feedback/               # Toast, Loading, EmptyState, ErrorState
      overlays/               # Modal, ConfirmDialog
      identity/               # Avatar, Frame, TitleBadges
    features/
      auth/                   # LoginPage, RequireAuth, session storage
      gpa/                    # GpaPage, bảng điểm, chart, filters, selectors
      info/                   # InfoPage, hồ sơ, cố vấn
      schedule/               # SchedulePage, chọn học kỳ, lịch
      leaderboard/
      wordfmt/
      survey/
      english/
      enrollment/
      learning/
      clans/
      confession/
      identity/               # presentation, đổi avatar/frame/title, quản lý
    api/
      http.js
      academics.js
      identity.js
      community.js
      learning.js
      tools.js
    services/
      tool-runs.js             # công việc đang chạy xuyên route
      community-realtime.js
    hooks/
    lib/
    styles/                   # tokens, base, layout, shared
dist/client/                  # build output, không sửa tay/commit
public/                       # tài nguyên dùng chung và admin độc lập
src/                          # backend hiện hữu
tests/
  frontend/
  e2e/
vite.config.js
package.json
```

Mỗi feature có page entry, component nội bộ, hook truy vấn, selector/formatter và CSS riêng khi cần. Feature khác chỉ dùng public exports có chủ đích. Không import service/database Node vào frontend. Giữ một package manifest và lockfile ở root ở giai đoạn này để giảm công việc vận hành.

## 4. Bản đồ route và hành vi URL

| URL đích | Nguồn hiện tại | Component dự kiến | Hành vi nghiệm thu riêng |
| --- | --- | --- | --- |
| `/login` | `login-view` | `LoginPage` | Login xong trở về đường dẫn nội bộ đã yêu cầu |
| `/` | Điểm vào ứng dụng | Redirect | Về `/gpa` khi có phiên, `/login` khi chưa có phiên |
| `/gpa` | `tab-grades` | `GpaPage` | Điểm, GPA, chart, lọc, CSV, in, chi tiết môn |
| `/info` | `tab-profile` | `InfoPage` | Hồ sơ, ảnh, khoa/ngành/lớp, cố vấn, sao chép MSSV |
| `/schedule` | `tab-schedule` | `SchedulePage` | Tải lịch theo học kỳ, giữ trạng thái chọn hợp lệ |
| `/leaderboard` | `tab-leaderboard` | `LeaderboardPage` | Phạm vi/metric, hạng bản thân, avatar/frame |
| `/wordfmt` | `tab-wordfmt` | `WordFmtPage` | Upload, tùy chọn tài liệu/bìa, tiến trình, tải file |
| `/survey` | `tab-survey` | `SurveyPage` | Chỉ chạy sau thao tác bắt đầu, không chạy lại khi trở về trang |
| `/english` | `tab-english` | `EnglishPage` | Phiên Moodle, course/quiz, log, dừng, tùy chọn nộp |
| `/enrollment` | `tab-enrollment` | `EnrollmentPage` | Giữ thông báo sắp ra mắt |
| `/learning` | `tab-learning` | `LearningPage` | Danh mục môn, tìm kiếm và bộ lọc |
| `/learning/:courseCode` | Môn đang mở | `CourseLearningPage` | Link trực tiếp một môn, xử lý mã không tồn tại |
| `/clans` | `tab-clans` | `ClansPage` | Danh sách nhóm, tạo/xin vào/rời nhóm |
| `/clans/:clanId` | Kênh nhóm đang mở | `ClanPage` | Tab con qua `?tab=posts|documents|members|settings|requests`, kiểm tra quyền |
| `/confession` | `tab-confession` | `ConfessionPage` | Feed, bài đăng, bình luận, phản hồi, danh tính |
| `/admin-tool` | Trang HTML độc lập | Express hiện hữu | Hoạt động độc lập, API tiếp tục kiểm tra quyền |
| Route không tồn tại | Fallback hiện tại | `NotFoundPage` | Hiển thị 404 trong ứng dụng, có đường quay về |

Quy ước: các route sinh viên nằm sau `RequireAuth`, giữ trải nghiệm đăng nhập hiện có. Đây là kiểm soát UI; backend vẫn phải xác thực và phân quyền từng request.

URL mẫu đề xuất: `/gpa?semester=ALL&status=ALL&q=toan`, `/schedule?semester=<ma-hoc-ky>`, `/leaderboard?scope=school&metric=gpa`. Giá trị cần parse/validate, ánh xạ sang API hiện tại như `hoc_ky`; không đổi API theo tên query frontend. Chỉ thêm tham số tuần khi đã kiểm kê được mô hình tuần và hành vi lịch thực tế.

Không ghi token, mật khẩu hoặc dữ liệu hồ sơ vào URL frontend. Bộ lọc tìm kiếm dùng `replace` khi gõ để tránh tạo hàng chục history entry; chuyển trang/chọn một trạng thái điều hướng có ý nghĩa dùng `push`. Quy định này phải được kiểm tra bằng Back/Forward.

Sau refresh, bộ lọc trên URL được phục hồi. Query không hợp lệ được đưa về mặc định có kiểm soát. Login có `returnTo` chỉ chấp nhận đường dẫn nội bộ; ngăn URL ngoài origin và vòng lặp `/login`. Sidebar, tiêu đề trang, `document.title`, breadcrumb và command palette lấy chung từ route metadata.

Không có bằng chứng rằng các `tab-*` hiện là URL public. Không tạo hàng loạt alias dựa trên suy đoán; chỉ thêm redirect nếu tìm được link cũ thực sự đã sử dụng.

## 5. Các hạng mục triển khai và tiêu chí nghiệm thu

### H01 — Lập baseline và hợp đồng hành vi

**Thực hiện:** Lập bảng 11 tab, các modal, quyền, storage keys, request/response, download, SSE/WS. Chụp màn hình desktop/mobile/sáng/tối; ghi lại kịch bản chức năng với fixture đã loại dữ liệu cá nhân. Phân loại test thuần, integration cần DB và test đọc source. Đo production build hiện tại qua server thực tế để có baseline dung lượng và tốc độ.

**Lý do:** File lớn chứa nhiều hành vi ngầm; chia theo màn hình dễ bỏ sót avatar/frame, quyền nhóm, export hoặc thao tác modal.

**Nghiệm thu:** Mỗi hành vi trong scope có ID, nguồn code, testcase và đợt chuyển đổi; lỗi có sẵn được ghi riêng. Có snapshot màn hình, API contract và số đo baseline để so sánh sau này.

### H02 — Thiết lập frontend build và môi trường dev

**Thực hiện:** Tạo `client/`, React entry, Vite root/output rõ ràng, lint React/hooks, scripts `dev:server`, `dev:client`, `build:client`, `test:frontend`, `test:e2e`. Giữ bước migration DB ở luồng khởi động backend, tránh chạy lại mỗi lần Vite HMR. Cấu hình proxy `/api`, `/media`, assets chung, `/admin-tool` và `/ws` phù hợp môi trường.

**Lý do:** Trình duyệt cần JS đã build; FE phải giao tiếp được API, streaming và trang admin trong cả dev lẫn production.

**Nghiệm thu:** Từ clean checkout, `npm ci` và build thành công; không cần cài dependency toàn cục. API, download, avatar, admin, SSE và WS hoạt động qua dev origin. Không đưa biến bí mật backend vào `VITE_*` hoặc bundle.

**Điểm đặc thù WS:** Backend hiện so sánh host của `Origin` với host request upgrade. Chọn proxy giữ Host/Origin nhất quán và kiểm tra handshake; không mặc định bật `changeOrigin` rồi bỏ kiểm tra origin để chữa lỗi. [Tùy chọn proxy Vite](https://vite.dev/config/server-options.html#server-proxy).

### H03 — Layout và routing thật

**Thực hiện:** Tạo layout cố định bao `Outlet`, chuyển sidebar thành `NavLink`, dùng route config chung, thêm loading/error boundary và trang không tìm thấy. Chuyển command palette từ `item.click()` sang navigation. Quản lý scroll của vùng nội dung chính, focus sau chuyển route và đóng sidebar mobile. Khi người dùng chọn một mục ở sidebar, active state được cập nhật ngay và vùng nội dung hiển thị spinner route loading trong lúc lazy chunk hoặc dữ liệu trang đang chờ. Xóa trigger/class/animation shake hiện dùng khi đổi tab; không giữ shake như một fallback ẩn.

**Lý do:** Điều hướng hiện chỉ đổi class của `.tab-pane`; tiêu đề, URL, active menu và history cần cùng phản ánh một trạng thái.

**Nghiệm thu:** Paste URL, mở tab mới, refresh, Back/Forward đều đúng page; không reload toàn bộ document khi chuyển route đã migrate. Layout không remount khi chuyển các trang con. Tab/Enter, focus, Escape và command palette hoạt động; trạng thái active có ngữ nghĩa truy cập được. Khi click từng mục sidebar ở môi trường dev, không còn rung/shake; spinner xuất hiện đúng lúc, không nhấp nháy vô hạn, biến mất sau khi page đạt success/empty/error và không che sidebar. Chuyển liên tục giữa hai mục không tạo nhiều spinner/listener hoặc hiển thị dữ liệu của route trước.

### H04 — Phiên đăng nhập và phân vùng dữ liệu

**Thực hiện:** Tạo auth provider với `initializing`, `authenticated`, `anonymous`; đọc storage tương thích keys hiện tại; xử lý JSON lỗi, timestamp lỗi/hết hạn. Chuẩn hóa lỗi phiên từ HTTP/body mà API đang trả. Gom các lỗi 401 đồng thời thành một lần logout/toast. Clear dữ liệu và kết nối khi logout/đổi tài khoản; đồng bộ logout giữa các tab với phiên được lưu lâu dài.

**Lý do:** Guard chạy trước khi đọc phiên sẽ redirect sai; request đang chạy có thể đưa dữ liệu của tài khoản A vào UI của tài khoản B.

**Nghiệm thu:** Có/không chọn nhớ đăng nhập đều đúng; login trở lại deep link; phiên hỏng không làm trang trắng. Logout xóa cache dữ liệu riêng tư, bản nháp cá nhân, ảnh tạm và token ở cả hai storage theo chính sách đã chọn. Response cũ bị hủy hoặc bỏ qua sau đổi phiên; không hiển thị dữ liệu tài khoản trước. Hết phiên không tạo vòng lặp redirect hay loạt toast.

### H05 — API module, query và state

**Thực hiện:** Tách `BduApi` thành module có export; transport nhận token, signal, headers và xử lý JSON/FormData/download đúng kiểu. Chuyển các envelope như `data.data || data` vào adapter theo endpoint. Query key chứa định danh người dùng đã xác thực, tên tài nguyên và bộ lọc; không đưa token vào key. Bỏ chuỗi `loadAllDashboardData()` bắt tải điểm rồi mới đến các phần khác; mỗi route tải nhu cầu của nó, identity dùng chung được chia sẻ.

**Lý do:** `/schedule` cần hoạt động kể cả API bảng điểm đang lỗi; thay đổi filter nhanh cần tránh response cũ ghi đè response mới.

**Nghiệm thu:** 401 đưa về xử lý phiên, 403 hiện không đủ quyền, 404 tài nguyên hiện không tồn tại, lỗi mạng có retry phù hợp. Loading, empty, error, success được phân biệt. Ranking lỗi không chặn điểm; điểm lỗi không chặn lịch/hồ sơ. Refresh chỉ invalidates dữ liệu thuộc phạm vi đã quy định. Mutation tạo bài/upload/chạy tool không tự retry ngoài chủ đích.

Đề xuất ban đầu: dữ liệu học vụ `staleTime` 5 phút, tắt refetch khi focus và retry tự động cho request đắt tiền; feed cập nhật bằng invalidation/realtime có debounce. Đây là cấu hình dự án cần hiệu chỉnh bằng baseline. TanStack có cơ chế tự refetch và retry mặc định nên phải cấu hình rõ. [Query defaults](https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults). Truyền `signal` xuống `fetch` để việc hủy query có tác dụng ở transport. [Query cancellation](https://tanstack.com/query/latest/docs/framework/react/guides/query-cancellation).

State được chia: dữ liệu API ở query cache; auth/theme ở provider; bộ lọc chia sẻ qua URL; modal/input ở page; bản nháp và công việc dài ở service/provider sống qua navigation. Tài nguyên nhạy cảm không persist query cache vào localStorage.

### H06 — Chuyển nhóm học vụ: GPA, info, schedule, leaderboard

**Thực hiện:** Bắt đầu bằng info/schedule để kiểm chứng nền tảng, sau đó GPA/leaderboard. Tách formatter, selector, bảng học kỳ, bộ lọc, chart, modal chi tiết điểm, thông tin cố vấn. Giữ thuật toán hiển thị/tính toán và precision đã có; lấy fixtures đối chiếu trước/sau. Chart dùng ref/effect và destroy instance đúng vòng đời.

**Lý do:** Đây là nhóm người dùng truy cập thường xuyên và là mốc nghiệm thu routing cốt lõi. Các công thức và cách parse dữ liệu không được vô tình đổi cùng thao tác chuyển JSX.

**Nghiệm thu:** Cùng payload cho kết quả GPA/tín chỉ/môn/điểm như baseline; lọc học kỳ, tình trạng và tìm kiếm kết hợp đúng. CSV và bản in giữ tiếng Việt, cột, giá trị và phạm vi lọc hiện có. Hồ sơ/ảnh/cố vấn đúng fallback. Lịch đúng học kỳ, phòng/tiết/giảng viên, trạng thái không có lịch/hết phiên; chọn A rồi B nhanh không hiển thị lịch A dưới nhãn B. Leaderboard đúng scope/metric, đánh dấu bản thân và frame/title.

### H07 — Identity, component chung và CSS

**Thực hiện:** Chuyển avatar, frame, title badge, modal, confirm, toast thành component; giữ fallback ảnh BDU/ảnh override theo baseline. Đưa chọn frame/title và quản lý identity nhúng vào feature riêng. Chuyển `innerHTML` template và `window.handle...` sang JSX/props/events; phần nội dung người dùng render dạng text hoặc qua chính sách HTML đã kiểm soát. Tách CSS tokens/base/layout và CSS feature từng đợt; giữ thứ tự cascade để đối chiếu.

**Lý do:** Danh tính xuất hiện ở GPA, hồ sơ, nhóm và confession; nếu mỗi page sao chép logic, thay ảnh/khung dễ chỉ cập nhật được một chỗ.

**Nghiệm thu:** Thay avatar/frame/title cập nhật nhất quán các nơi; quyền mở khóa không bị thay bằng state frontend. Không còn inline handler/global render ở module đã migrate. Overlay có focus trap/trả focus, không tràn mobile; bảng điểm giữ sticky header đúng. Giao diện sáng/tối, giảm chuyển động và trạng thái bàn phím đạt baseline.

### H08 — Công cụ và vòng đời công việc dài

**Thực hiện:** WordFmt, survey, English mỗi công cụ có page, form và run state riêng. Service công việc sống ngoài page để navigation không làm mất tiến trình, file đang chọn, link tải hay log. Mỗi lần bắt đầu từ thao tác người dùng có khóa chống bấm lặp; effect chỉ đồng bộ hiển thị/subscription. Có giới hạn log trong bộ nhớ.

**Lý do:** Tab cũ vẫn nằm trong DOM khi bị ẩn; route React thường unmount. Không được làm công việc dừng hoặc chạy lại chỉ vì chuyển trang.

**Survey đặc biệt:** `GET /api/survey/stream` hiện gọi `runAutoSurvey()` ngay khi mở SSE. Không mở lại stream khi page mount hoặc retry tự động sau lỗi; giữ một kết nối cho lần chạy trong provider/service. Mất kết nối phải hiện “mất kết nối/chưa xác định kết quả”, không tự báo đã dừng backend. Nếu yêu cầu khôi phục công việc sau F5, cần bổ sung backend `start/status/stream` theo run ID và cơ chế chống chạy trùng; đó là phần mở rộng API riêng, không mặc định đã có.

**English:** Phân biệt subscribe log với start/stop/close session; giữ xác nhận tự nộp như baseline. **WordFmt:** giữ FormData fields, file input, loại tài liệu, options bìa và đường dẫn tải; không tự resend upload khi remount. File và Moodle session nhạy cảm chỉ giữ trong bộ nhớ theo vòng đời phù hợp.

**Nghiệm thu:** Chuyển `/survey → /gpa → /survey` không khởi chạy lần hai và vẫn thấy log. Tương tự cho WordFmt/English. Logout đóng subscription và thực hiện cleanup phiên hiện có; không tuyên bố đóng SSE đồng nghĩa hủy survey. Sau F5 không tự gửi lại hành động; hiện trạng thái phục hồi/giới hạn rõ ràng. StrictMode dev không làm nhân đôi thao tác nghiệp vụ. Trên dev phải chạy thủ công tối thiểu một file DOCX hợp lệ và một file lỗi/biên để xác nhận upload, spinner xử lý, thông báo lỗi, kết quả tải xuống và nội dung file đầu ra; kiểm tra các lựa chọn loại tài liệu, bìa, nhận xét, cảm ơn, caption và chế độ bỏ qua đề cương theo phạm vi hiện có. Không đạt nếu chỉ thấy form render mà chưa nhận được file DOCX thực tế. React yêu cầu setup/cleanup effect tương ứng khi unmount/chạy lại. [Effect lifecycle](https://react.dev/reference/react/useEffect).

### H09 — Learning, clans, confession và realtime

**Thực hiện:** Chuyển danh mục môn, trang môn, post/comment, feed, attachment, poll, membership, join request, roles và settings theo các lát chức năng. Room WS gắn với tài nguyên đang xem; một connection manager quản lý auth/reconnect, đăng ký/hủy room. Chuẩn hóa invalidation để một event không kích hoạt nhiều lượt reload; loại event trùng theo ID nếu giao thức có hỗ trợ.

**Lý do:** Đây là phần nhiều mutation/quyền/state liên quan nhau nhất, nên chuyển sau khi nền auth/query/component ổn định.

**Nghiệm thu:** Tạo/sửa/xóa nội dung, like/comment/reply, chia sẻ tài liệu, bình chọn, vào/rời nhóm và duyệt thành viên đúng baseline. Người không có quyền truy cập direct link nhận kết quả phù hợp, kể cả API trực tiếp. Môn/nhóm không tồn tại không crash. Kết nối lại không nhân đôi bài/log/listener; rời nhóm hoặc đổi tài khoản không tiếp tục nhận dữ liệu room cũ. URL lấy đúng courseCode/clanId đã validate và encode. Trên môi trường dev phải kiểm tra bằng phiên đăng nhập thật hoặc fixture dev có quyền tương ứng toàn bộ góc Tự học số: tải danh sách môn, mở một môn, đọc/tạo/xóa bài, like, bình luận và trả lời; chia sẻ tài liệu/link; danh sách CLB, tạo hoặc xin vào, duyệt/từ chối, vai trò thành viên, feed, tài liệu, poll; và confession nếu thuộc build chuyển đổi. Sau mỗi mutation phải kiểm tra dữ liệu hiển thị lại sau refresh/deep link, không chỉ kiểm tra toast thành công.

### H10 — Hiệu ứng và tải theo route

**Thực hiện:** Dùng `lazy`/`Suspense` tại entry feature; tránh barrel import làm tải toàn bộ feature vào entry. GPA tải Chart.js khi cần; giữ UI enhancement theo hooks có cleanup listener, observer, animation frame và timer. Đưa command palette về danh mục route/action chung. Thêm error boundary cho lỗi tải chunk, cho phép người dùng chủ động tải lại khi cần. Xây bộ component loading thống nhất gồm `RouteSpinner` cho chuyển sidebar/lazy route, `PageSpinner` cho tải toàn trang, `InlineSpinner` cho bảng/khu vực nhỏ, `ButtonSpinner` cho submit/mutation và `Skeleton` cho dữ liệu có layout ổn định. Mỗi component có `aria-busy`, `role="status"`/`aria-live` phù hợp, nhãn tiếng Việt, trạng thái reduced-motion và quy tắc không khóa thao tác ngoài phạm vi đang tải.

**Lý do:** Tách file chỉ cải thiện bảo trì; cần import động để browser có thể tải code theo trang. React cung cấp lazy loading với fallback qua Suspense. [React lazy](https://react.dev/reference/react/lazy).

**Nghiệm thu:** Network ở `/login` không tải chart/cộng đồng/công cụ; `/info` không tải chunk chart. Loading fallback không làm mất layout; feature lỗi không làm trắng cả app. Sau 20 vòng chuyển route, số kết nối/listener/chart còn sống trở về mức hợp lý đã định; không tăng tuyến tính. Giảm chuyển động vẫn hoạt động và không bắt buộc browser hỗ trợ View Transitions. Với từng trạng thái loading thật trên dev, xác nhận spinner xuất hiện khi request/chunk chậm, biến mất khi thành công, chuyển sang empty/error khi cần, không hiện đồng thời với shake, không nhảy layout gây mất focus và không bị treo nếu request bị hủy. Spinner route phải có thời gian tối thiểu ngắn để tránh nhấp nháy khi mạng nhanh nhưng không được giả lập chờ cố định làm chậm thao tác. Có kiểm tra keyboard và screen reader cơ bản cho thông báo đang tải.

### H11 — Express, tài nguyên và Docker production

**Thực hiện:** Build vào `dist/client`; artifact JS/CSS hash đặt dưới namespace riêng, ví dụ `/app-assets/`, để không đụng `/assets/` ảnh đang dùng. Vite không dùng trực tiếp `public/` cũ làm publicDir sao chép cả app legacy. Express serve build mới trước khi một static index cũ có thể bắt `/`; mount assets/admin/media bằng quy tắc rõ ràng.

Thứ tự xử lý đề xuất: middleware → media/assets cụ thể → admin độc lập → API và API 404 → SPA fallback cho request HTML phù hợp → 404 khác/error handler. Giữ HTTP upgrade `/ws/community`. URL asset/download phải tuyệt đối từ root hoặc do bundler tạo để không hỏng tại `/clans/:id` và đường dẫn có slash cuối.

Docker thêm stage cài cả devDependencies và chạy frontend build; runtime chỉ giữ production dependencies, build output, backend, binary .NET và tài nguyên cần thiết. Duy trì volumes avatar/temp, migration và scheduler. Thêm `dist/` vào ignore thích hợp; không copy artifact cũ từ máy dev đè artifact đã build trong image. Build fail phải dừng pipeline.

**Lý do:** Frontend chạy đúng với Vite dev chưa chứng minh F5/deep link hoạt động khi deploy Express/Docker.

**Nghiệm thu:** Container mới build từ clean checkout phục vụ `/gpa`, `/info`, `/schedule`, route động sau refresh. `/api/not-found` trả JSON 404; asset/media/file tải không tồn tại trả 404 đúng kiểu, không trả HTML 200. Route UI lạ hiện NotFound; xác định rõ SPA fallback có thể HTTP 200 dù UI hiển thị 404. SSE không bị buffer thành một lượt cuối; WS upgrade thành công. HTML revalidate/no-cache, chỉ assets có hash immutable dài hạn; không áp cache công khai cho dữ liệu riêng tư. `/admin-tool` và tài nguyên phụ của nó tiếp tục hoạt động.

### H12 — Chuyển test và hoàn thiện tài liệu

**Thực hiện:** Giữ test backend/nghiệp vụ; bổ sung test component với React Testing Library và runner phù hợp, E2E bằng trình duyệt. Các test regex phải có bảng ánh xạ sang test hành vi trước khi bỏ. Rà toàn bộ `tests/`, vì không phải script nào cũng có trong `npm test`. Cập nhật README, sơ đồ kiến trúc, lệnh chạy/build, contract URL, hướng dẫn thêm page và runbook rollback.

**Lý do:** Test tìm `showToast(...)` hoặc tên hàm trong file cũ sẽ báo lỗi khi tách hợp lệ; chỉ sửa regex cho xanh không chứng minh trải nghiệm được giữ.

**Nghiệm thu:** Test GPA/parser giữ kết quả; có component test cho auth/filters/modal và integration test API contract; E2E chạy trên build Express/Docker, không chỉ Vite. Test integration DB chạy trên DB test phù hợp yêu cầu bảo vệ của script hiện hữu. Không dùng dữ liệu mẫu trong sản phẩm; fixture chỉ thuộc test. Tài liệu ghi đúng cấu trúc đã tạo và lệnh thực thi được. Mỗi đợt nghiệm thu phải có biên bản chạy website thật trên dev: commit/build được test, URL và cấu hình API đã dùng, tài khoản/fixture (đã che dữ liệu nhạy cảm), thời gian chạy và kết quả từng luồng; ảnh/video hoặc log chỉ dùng để chứng minh, không thay thế thao tác thực tế.

### H13 — Nghiệm thu vận hành trên môi trường dev và UX loading

**Thực hiện:** Dựng một môi trường dev hoàn chỉnh gồm frontend dev server, Express API, database dev/test, thư mục `temp`, avatar và các kết nối SSE/WebSocket cần thiết. Chạy smoke test qua trình duyệt thật trên cả mạng nhanh và throttling chậm; kiểm tra console, Network, request status, response payload, download và log server. Lập checklist theo vai trò sinh viên thường, thành viên CLB và quản trị viên/điều phối nếu chức năng đó nằm trong scope. Mỗi luồng phải đi từ thao tác người dùng đến kết quả dữ liệu sau refresh, không kết luận dựa trên DOM tĩnh.

**Lý do:** Test source và component chỉ chứng minh code có cấu trúc đúng; lỗi proxy, CORS/origin, streaming, file system, database, binary WordFmt, quyền và cleanup chỉ lộ ra khi website chạy đầy đủ. Spinner cũng chỉ có ý nghĩa khi có request/chunk thật để chuyển qua các trạng thái loading/success/empty/error.

**Nghiệm thu bắt buộc trên dev:**

1. **Smoke và routing:** đăng nhập, logout, hết phiên, mở trực tiếp và refresh mọi route; click từng mục sidebar; kiểm tra tiêu đề, active state, URL, Back/Forward, deep link và route không tồn tại.
2. **Loading UX:** làm chậm API/chunk bằng devtools hoặc fixture chậm; xác nhận `RouteSpinner` thay cho shake ở mọi lần chuyển sidebar, `PageSpinner`/`InlineSpinner`/`ButtonSpinner` xuất hiện đúng phạm vi, có thông báo truy cập được và luôn kết thúc ở success/empty/error. Không có spinner vô hạn, overlay chặn toàn app ngoài ý muốn, layout nhảy mạnh hoặc request bị gửi lặp do mount lại.
3. **Học vụ:** GPA/điểm, lọc, chart, CSV/in; hồ sơ và avatar; lịch đổi học kỳ; leaderboard đổi phạm vi/metric. Kiểm tra một request lỗi không làm hỏng các page độc lập.
4. **WordFmt:** chọn file `.docx`, kéo thả nếu có, nhập tùy chọn bìa và document type, bắt đầu format, theo dõi spinner/progress, nhận lỗi file không hợp lệ, tải file thành công, mở file đầu ra và xác nhận nội dung/định dạng chính. Chạy tối thiểu một file tiểu luận và một file đồ án/fixture tương ứng nếu hệ thống hỗ trợ; xác nhận không mất file khi chuyển route và không tự upload lại khi quay lại.
5. **Tự học số:** dùng dữ liệu thật/fixture dev đi qua `/learning`, `/learning/:courseCode`, `/clans`, `/clans/:clanId` và `/confession` trong phạm vi build; thực hiện đọc, tạo, sửa/xóa, like, comment/reply, chia sẻ tài liệu, poll, join/leave, duyệt và phân quyền. Refresh/deep link để chứng minh mutation đã được lưu; mô phỏng mất mạng và reconnect để kiểm tra không trùng item/listener.
6. **Realtime và công cụ dài:** survey/English start-stop-subscribe, WordFmt download, WS room; chuyển route, logout, đóng tab và F5 theo chính sách đã định. Ghi nhận rõ trạng thái “đang chạy”, “mất kết nối/chưa rõ kết quả” và “hoàn tất”, không suy diễn từ việc spinner biến mất.
7. **Responsive/accessibility:** desktop và mobile, sáng/tối, keyboard, reduced-motion; kiểm tra spinner không làm mất focus, có tên accessible và shake không còn trong computed style/animation khi chuyển sidebar.

**Bằng chứng đạt:** biên bản dev smoke có timestamp, commit SHA, build command, browser/device, các bước đã thao tác, kết quả mong muốn/thực tế, link log/screenshot/video khi cần và danh sách lỗi còn mở. Chỉ đánh dấu đạt khi các luồng quan trọng có kết quả thật từ API/file/database; ảnh chụp giao diện hoặc test tĩnh đơn lẻ không đủ.

## 6. Chiến lược chuyển đổi, mốc bàn giao và rollback

Đề xuất xây bản React ở môi trường phát triển/staging riêng trong khi bản đang phục vụ người dùng vẫn là legacy. Mỗi đợt merge phải có kiểm thử của phần đã chuyển; phát hành thay entry sinh viên khi phạm vi đã hoàn tất. Như vậy chưa có giai đoạn React và script legacy cùng sửa một DOM.

Nếu cần mở sớm ba trang học vụ trên production, thêm chế độ coexistence có server route allowlist: chỉ route đã nghiệm thu được phục vụ bởi React, phần còn lại mở ứng dụng legacy qua full document navigation. Cần mapping tab legacy rõ ràng và xử lý trạng thái job; không dùng iframe hoặc mount nguyên `app.js` trong effect để coi là đã chuyển xong. Phương án này làm tăng phạm vi và không phải mặc định.

| Mốc | Hạng mục/phụ thuộc | Đầu ra bàn giao | Ước lượng ngày công |
| --- | --- | --- | --- |
| M0 | H01 | Baseline, inventory, contract, danh sách test và rủi ro | 1–2 |
| M1 | H02–H05, nền component H07; sau M0 | Build, layout, router, auth, API/query; smoke deep link | 3–5 |
| M2 | H06 và identity dùng chung; sau M1 | `/gpa`, `/info`, `/schedule`, `/leaderboard` đạt parity | 4–6 |
| M3 | H08; sau M1 và nền component | WordFmt, survey, English; chạy xuyên route | 3–5 |
| M4 | H09, phần identity quản lý còn lại; sau M1/M2 | Learning, clans, confession, quyền và realtime | 5–8 |
| M5 | Hoàn thiện H07/H10–H13 xuyên suốt; sau các mốc trên | Build production, E2E toàn scope, dev smoke thực tế, tài liệu và release | 4–7 |

Tổng sơ bộ: 20–33 ngày công cho một lập trình viên quen repo, cộng khoảng 20% dự phòng thành 24–40 ngày công. Đây là ước lượng phạm vi đầy đủ, không phải cam kết lịch; cần hiệu chỉnh sau M0. Riêng nền tảng và nhóm học vụ đến M2 khoảng 8–13 ngày công trước dự phòng. Các ước lượng đã tính kiểm tra từng đợt và dev smoke thực tế, không bao gồm viết mới enrollment, migration toàn bộ admin hoặc backend job phục hồi survey sau refresh.

Rollback: lưu image/release cũ và cặp HTML/assets tương ứng trước cutover; không xóa artifacts cần cho release cũ. Chuyển lại image trước nếu login, deep link, quyền, download hoặc realtime lỗi nghiêm trọng. Vì migration mặc định không sửa schema DB, rollback frontend không cần rollback DB. Nếu phát sinh thay đổi backend job/API, triển khai tương thích ngược và nghiệm thu riêng trước UI. Thử rollback ở staging, bao gồm kiểm tra phiên, `/admin-tool` và job đang chạy; lên lịch cutover tránh làm gián đoạn công việc dài đang hoạt động.

## 7. Ma trận nghiệm thu tổng thể

| Nhóm | Ca kiểm thử bắt buộc | Bằng chứng |
| --- | --- | --- |
| Routing | Mở trực tiếp/F5/slash cuối/Back/Forward ở mọi route, route động, route lạ | E2E trên production build |
| Auth | Chưa login, phiên hợp lệ/hết hạn/hỏng, remember on/off, returnTo, logout, đổi tài khoản | Component/E2E và network log đã che thông tin riêng tư |
| Data | Loading/empty/error/success, request chậm đảo thứ tự, API điểm lỗi nhưng lịch chạy | Test fixture, kết quả đối chiếu |
| Học vụ | GPA/tín chỉ/filter, profile/avatar/advisor, schedule semester, leaderboard | Payload cố định và output trước/sau |
| Xuất file | CSV, in bảng điểm, upload WordFmt và tải DOCX | File đầu ra và kiểm tra nội dung hiện có |
| Công cụ | Chạy, chuyển trang, quay lại, mất kết nối, F5, logout; không chạy lặp | Theo dõi số request/start và trạng thái log |
| Cộng đồng | Post/comment/document/poll/join/leave/approve/role và denial | Test đa vai trò trên DB test |
| Realtime | Mất mạng, reconnect, đổi room/tài khoản, unmount nhiều lần | WS/SSE log và kiểm tra số subscriber |
| UI | Mobile 360/390 px và desktop 1366/1440 px, sáng/tối, keyboard, reduced motion | Ảnh đối chiếu và checklist thao tác |
| Hiệu năng | Cold login, cold GPA, chuyển route có cache, 20 vòng navigation | Network/bundle report, trace và tài nguyên còn sống |
| Dev runtime | Chạy website qua frontend dev server + Express + DB dev; login, route, API, console, Network, SSE/WS | Biên bản dev smoke có commit SHA, cấu hình, timestamp, kết quả thao tác và lỗi còn mở |
| Loading UX | Throttling request/chunk, click toàn bộ sidebar, retry/error/empty, reduced-motion, keyboard | Video/ảnh khi cần, trạng thái `aria-busy`, không còn shake và không có spinner treo |
| WordFmt thực tế | Upload DOCX hợp lệ/lỗi, tùy chọn document type/bìa, xử lý, download, mở và đối chiếu output | File input/output, log tiến trình, screenshot và checklist nội dung/định dạng |
| Tự học số thực tế | Learning/course, bài viết, like/comment/reply, tài liệu, clan/poll/quyền, confession theo scope | Dữ liệu sau refresh/deep link, kiểm tra đa quyền và log realtime/reconnect |
| Deploy | Clean build, API/asset 404, media/download, admin, SSE/WS, rollback | Build log và smoke report container |
| Bảo trì | Thêm page qua route/feature; không sửa chuỗi if/else điều hướng global | Review cấu trúc và hướng dẫn trong README |

Mục tiêu đo hiệu năng đề xuất: dung lượng JS+CSS tải ban đầu tại login giảm ít nhất 30% so với baseline production đo cùng cách; thời gian hiển thị nội dung chính không chậm hơn baseline quá 10% với cùng fixture/máy/network, lấy median 5 lần. Đây là ngưỡng cần xác nhận ở M0, chưa phải kết quả đã đạt. Không dùng thời gian phản hồi cổng BDU trực tiếp để kết luận tốc độ render frontend; đo fixture và upstream riêng.

Điều kiện chốt nghiệm thu: mọi route trong scope đạt parity, không còn lỗi chặn đăng nhập/điểm/quyền/công cụ, không rò dữ liệu giữa tài khoản, test cần thiết đạt, production build và rollback đã chạy thử. Các module đã chuyển không còn phụ thuộc `AppState`, `BduApi` global hoặc init DOM của app cũ. Chỉ loại file legacy khi mọi nơi sử dụng, bao gồm admin và test, đã được rà soát; kết quả cuối không tải `app.js` cũ trong giao diện sinh viên mới.
