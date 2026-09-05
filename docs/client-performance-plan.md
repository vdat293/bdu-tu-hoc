# Kế hoạch tối ưu CPU, bộ nhớ và độ mượt phía người dùng

Ngày: 05/09/2026. Trạng thái: các hạng mục tối ưu phía client đã triển khai; phần nghiệm thu dashboard dài phiên và thiết bị thật vẫn cần môi trường đo tương ứng.

Đã triển khai trong đợt này: chính sách motion sớm và nút giảm hiệu ứng; dừng xử lý pointer/parallax khi tab ẩn hoặc giảm chuyển động; lazy-load Chart.js, avatar và logo ngoài màn hình; thêm kích thước/decoding cho ảnh; tạo WebP responsive cho logo/ảnh khung và bọc toàn bộ logo bằng `<picture>`; hoãn `api.js`, `app.js`, `interactions.js` đến khi có phiên đăng nhập; chuyển tám pane nặng sang template lazy; khởi tạo feature ở lần mở đầu tiên; trì hoãn tải thời khóa biểu và kho tài liệu cho đến khi mở mục; request loader trong phiên; vòng đời activate/deactivate cho các view đọc dữ liệu; AbortSignal cho schedule/learning/forum; phân trang feed forum; làm mới lại đúng mục đang mở; cache headers cho tài nguyên tĩnh; tạo sidecar Brotli cho CSS/JS/SVG/JSON và phục vụ theo `Accept-Encoding`; runner benchmark login/dashboard fixture.

CSS đã được tách theo vòng đời ở mức an toàn: `login.css` chỉ giữ base/login/privacy character, HTML tải `login.min.css`, sau khi xác thực `style-loader.js` tải `style.min.css` dashboard rồi tắt stylesheet login. Source `style.css` vẫn giữ nguyên thứ tự override; script `split-public-css.mjs` tái tạo phần login trước mỗi lần build để tránh chỉnh cascade thủ công.

## 1. Phạm vi và căn cứ

Tập trung vào trình duyệt: tải lần đầu, xử lý tương tác, animation, dựng giao diện, bộ nhớ và cập nhật nền. Ưu tiên giữ nhận diện hình ảnh và các chức năng hiện có.

Số đo thăm dò trên i7-12700F, 32 GB RAM, Chrome 152 headless, localhost, viewport 1366×768, chưa đăng nhập:

| Tình huống | CPU renderer, % một lõi | CPU tiến trình GPU, % một lõi | Working set renderer |
| --- | ---: | ---: | ---: |
| Đăng nhập, đứng yên | 2,29 | 12,51 | 102,4 MiB |
| Di chuyển chuột | 9,76 | 16,77 | 118,9 MiB |
| Đứng yên, giảm chuyển động | 0,014 | 0,056 | 129,0 MiB |

- Lấy mẫu ngắn 6–9 giây; các tình huống dùng chung phiên trình duyệt và có tải lại. Chưa đủ để đánh giá RAM tăng lâu dài.
- CPU tiến trình GPU là thời gian CPU của tiến trình đó, không phải mức sử dụng phần cứng GPU.
- 100% CPU trong bảng tương đương một lõi logic; không đồng nhất cách chuẩn hóa tổng CPU của Task Manager.
- Working set gồm bộ nhớ thường trú của renderer, có phần chia sẻ; chưa gồm toàn bộ Chrome/GPU. JavaScript heap chỉ khoảng 1,2–2 MB trong các mẫu.
- Trang đăng nhập tải khoảng 2,9 MB/19 request; DOM khoảng 4.490 node, bao gồm phần giao diện chưa hiển thị.
- Sáu file HTML/CSS/JS chính: 927.948 byte; thử Brotli trong bộ nhớ: 145.381 byte. Không phải số truyền tải production đã xác minh.
- Tổng kho ảnh/SVG trong public khoảng 13,51 MB; không phải toàn bộ được tải ở trang đầu.
- Chưa có benchmark dashboard với dữ liệu thật hoặc điện thoại thật. Chưa xác nhận memory leak.

Script thăm dò: `temp/client-performance-audit.mjs`; kết quả: `temp/client-performance-results.json`. Hai file tạm đang nằm trong thư mục bị Git bỏ qua. Bước đầu tiên là chuẩn hóa phép đo trước khi dùng làm cổng nghiệm thu.

## 2. Mục tiêu đề xuất

Đây là ngân sách kỹ thuật để kiểm chứng, chưa phải cam kết đạt được trên mọi máy.

| Hạng mục | Mục tiêu |
| --- | --- |
| Tải lạnh trang đăng nhập | Không quá 1 MB truyền tải gồm HTML/CSS/JS/font/ảnh cần thiết, đo ở cấu hình phục vụ có nén |
| CPU khi đứng yên, chế độ Cân bằng | Giảm ít nhất 70% tổng CPU renderer + tiến trình GPU so với baseline chuẩn hóa cùng máy |
| CPU khi di chuyển chuột, Cân bằng | Giảm ít nhất 40% tổng CPU renderer + tiến trình GPU cùng kịch bản |
| DOM đang gắn vào trang đăng nhập | Giảm ít nhất 60% so với số node baseline, đo cùng API |
| Bộ nhớ ổn định | Không tăng dần do giữ DOM/listener/timer sau các vòng chuyển mục; so retained heap sau GC trong phép thử riêng |
| Chuyển mục đã tải | p95 từ click tới paint nội dung đã có dưới 200 ms trên máy kiểm thử chuẩn; tách thời gian chờ mạng |
| Cuộn/hiệu ứng | Kiểm tra frame time, dropped frames và long task trên màn hình 60 Hz; không dùng nhịp rAF để khẳng định FPS hiển thị |

Mục tiêu trải nghiệm thực tế sau triển khai: LCP ≤ 2,5 giây, INP ≤ 200 ms, CLS ≤ 0,1 ở p75, phân nhóm mobile/desktop. Nguồn: [Core Web Vitals](https://web.dev/articles/vitals). Kết quả lab và tốc độ localhost không thay thế số đo người dùng thật.

## 3. Gói A — Chuẩn hóa benchmark

**File dự kiến:** `scripts/benchmark-client.mjs`, `docs/client-performance-baseline.md`, `package.json`; kế thừa script tạm.

1. Nhận đường dẫn Chrome, URL, viewport, chế độ hiệu ứng, thời lượng và thư mục kết quả từ tham số; không hard-code máy người phát triển.
2. Dùng hồ sơ trình duyệt riêng. Xác định renderer bằng trace marker sau mỗi navigation; không giữ PID cũ nếu renderer đã đổi. Tách CPU renderer/GPU/browser và các loại bộ nhớ.
3. Khởi động nóng 10 giây, đo 30 giây, chạy ít nhất 3 lần mỗi tình huống; báo median và khoảng dao động. Chạy baseline/candidate xen kẽ, cùng trình duyệt, cùng tốc độ chuột và cùng dữ liệu.
4. Tách cold cache và warm cache; ghi lỗi font/CDN, số byte, request, FCP/LCP/CLS, long task, DOM, heap, working set và process CPU. Runner hỗ trợ `--memory-cycles=30` để đổi mục lặp và thu heap sau GC.
5. Dùng browser có cửa sổ trên máy test để kiểm tra compositor/frame time thực tế. Headless phục vụ so sánh tự động. Giả lập viewport/CPU slowdown không được ghi là kết quả điện thoại thật.
6. Kịch bản: login idle/pointer/gõ input; dashboard idle; bảng điểm dài; leaderboard; feed 20/100/300 bài với nhiều khung; chuyển mục 30 vòng; mở/đóng modal; ẩn tab 60 giây rồi quay lại; WordFmt đang chạy.
7. Dữ liệu dashboard dùng fixture chỉ trong test hoặc tài khoản test được cấp. Không đưa dữ liệu mẫu vào luồng production. Fixture hiệu năng không chứng minh API thật đúng.
8. So retained heap và detached DOM sau GC ở bài thử memory riêng; không ép GC trong bài đo trải nghiệm người dùng. Có timeout và đóng đúng các process đã tạo khi lỗi.

**Nghiệm thu:** báo cáo có môi trường đầy đủ, kết quả lặp lại và phân biệt rõ số đo/tham số mô phỏng; có baseline dashboard trước khi đặt ngân sách RAM dashboard.

## 4. Gói B — Điều khiển hiệu ứng và giảm CPU nền (ưu tiên cao nhất)

**File sửa:** `public/js/interactions.js`, `public/js/app.js`, `public/css/showcase.css`, `public/css/style.css`, `public/index.html`.

**File mới:** `public/js/motion-policy.js`.

### B1. Một chính sách hiệu ứng chung

- Đề xuất ba lựa chọn trong cài đặt giao diện: **Cân bằng** (mặc định), **Đầy đủ**, **Giảm hiệu ứng**. Lưu lựa chọn giao diện ở localStorage và áp dụng trước paint đầu tiên để tránh chớp animation.
- Cân bằng giữ màu sắc/khung, chạy hiệu ứng ngắn khi hover, focus hoặc mở mục; khi tương tác kết thúc chuyển về hình tĩnh. Giảm hiệu ứng dùng khung tĩnh, tắt parallax/tilt/nền chuyển động. Đầy đủ giữ hiệu ứng phong phú khi vùng đó đang được nhìn thấy.
- `prefers-reduced-motion: reduce` luôn được tôn trọng, kể cả khi đã lưu Đầy đủ. Theo dõi thay đổi media query ngay trong phiên, không chỉ đọc một lần ở constructor.
- Chỉ kích hoạt pointer tracking trên thiết bị hỗ trợ hover và con trỏ chính xác. Không suy đoán cấu hình máy từ user-agent hoặc từ một API bộ nhớ không phổ biến.
- Dùng thuộc tính `data-motion` trên phần tử html, tránh mất trạng thái khi `initTheme()` thay `body.className`.
- Chính sách trả lời việc một hiệu ứng có được chạy hay không dựa trên chế độ, document visibility, mục đang mở và khả năng nhìn thấy phần tử.

### B2. Giảm việc theo chuột

- `setupPointerSpotlight()`: thu hẹp vùng listener; chỉ cập nhật lớp spotlight liên quan, tránh cập nhật biến CSS kế thừa toàn trang mỗi frame.
- `.login-wrapper`: thay nền gradient thay đổi theo tọa độ chuột bằng lớp trang trí có thể dịch chuyển bằng transform nếu thử nghiệm paint xác nhận có lợi.
- `.login-wrapper::after`: nền aurora `18s infinite` chuyển thành tĩnh ở Cân bằng sau hiệu ứng mở trang; Đầy đủ vẫn dừng khi login bị ẩn.
- `setupParallaxEnvironment()`: chỉ tạo và gắn listener sau khi dashboard xuất hiện. Hiện đang được thiết lập từ màn hình login.
- `initLoginCharacters()` và `setupTiltCards()`: gộp các sự kiện vào một rAF; chỉ đọc bounds khi cần (pointerenter/resize/scroll thích hợp), đọc layout trước ghi style. Hủy frame khi rời vùng hoặc rời mục.
- Chỉ gắn `will-change` lên phần tử sắp chuyển động, gỡ sau khi xong; tránh giữ nhiều lớp compositor lâu dài.

### B3. Animation trong khung, danh hiệu và công cụ

- Lập danh sách các nhóm hiệu ứng: nền, hero, khung mini, danh hiệu, opening cinematic, skeleton, thanh xử lý tác vụ.
- Khung nhỏ trong feed/leaderboard dùng hình tĩnh ở Cân bằng; chỉ khung được hover/focus/preview chạy animation. Cinematic chỉ có một instance, kết thúc phải dọn timer/lớp DOM.
- Kết hợp mục đang mở với IntersectionObserver có root đúng `.dashboard-body`; pause phần tử ngoài vùng nhìn và cả pseudo-element liên quan.
- Khi animation bị tắt, đặt trạng thái cuối hiện rõ; không để reveal/intro giữ nội dung ở opacity 0.
- Loading thiết yếu tiếp tục diễn đạt trạng thái bằng chữ/progress. Không tắt hàng loạt animation theo selector `*` làm mất phản hồi hoặc kẹt code đang chờ `animationend`.
- View Transition theo cùng chính sách hiệu ứng; không chỉ kiểm tra media query riêng trong `initNavigation()`.

**Nghiệm thu:** đạt ngân sách CPU ở mục 2; theme, nhập mật khẩu, bàn phím, khung, modal, reveal và progress vẫn hoạt động; đổi chế độ ngay trong phiên có hiệu lực; không có vòng rAF trang trí khi vùng đã bị ẩn.

Tham khảo kỹ thuật: [CSS animation và render pipeline](https://web.dev/articles/animations-guide). Transform/opacity là ưu tiên để thử, không bảo đảm mọi hiệu ứng sẽ miễn chi phí GPU.

## 5. Gói C — Ảnh, font và dung lượng tải đầu

**File sửa:** `public/index.html`, đường dẫn tài nguyên trong `public/js/app.js` và CSS, `package.json`.

**File mới:** `scripts/optimize-public-images.mjs`, các biến thể ảnh trong `public/assets/images/`, manifest ánh xạ kích thước nếu cần.

1. Dùng Sharp đã có trong dự án để tạo WebP từ ảnh gốc. Chọn chất lượng theo từng ảnh, kiểm tra nền trong suốt và đường nét; không mặc định áp dụng quality 80 cho mọi tài nguyên.
2. Logo: tạo các cỡ tương ứng vị trí hiển thị, ví dụ 64/128/256/512 px; wordmark giữ đúng tỷ lệ. Dùng srcset/sizes theo chiều rộng thực và DPR.
3. Khung/avatar: tách thumbnail 96/192 px với ảnh preview 384/768 px theo nhu cầu thực tế. Không tải ba trạng thái mắt độ phân giải lớn cho một avatar nhỏ khi đang dùng khung tĩnh.
4. Khai báo width/height hoặc aspect-ratio. Lazy-load ảnh dưới fold và nội dung chưa mở; không lazy-load ảnh là ứng viên LCP. Dùng decoding async cho ảnh không thiết yếu.
5. Ưu tiên sửa hai logo xuất hiện ngay ở login. Ba thử nghiệm WebP trước đó giảm 79–89% chỉ là căn cứ ưu tiên, không phải cam kết giảm tương ứng RAM.
6. Rà lại ba họ font và các weight đang yêu cầu. Stylesheet Google Fonts đã chuyển thành preload không chặn render (`media=print` + `onload`), có fallback `noscript`; font mono cho log/editor vẫn dùng `font-display: swap`. Nếu tự host, kiểm tra giấy phép và giữ đủ bộ ký tự tiếng Việt; dùng fallback có kích thước gần nhau.
7. Không preload toàn bộ font/ảnh/khung. Ảnh dùng nhiều chỗ cần cùng URL biến thể phù hợp để tận dụng cache.

**Nghiệm thu:** trang login cold transfer ≤1 MB ở cấu hình có nén; không mất ảnh, mờ quá mức hay đổi tỷ lệ; kiểm tra ở DPR 1/2 và màn hình hẹp. Ảnh khung lớn chỉ được request khi mở preview hoặc thực sự cần.

## 6. Gói D — Tách vòng đời và tải mã theo mục

**File sửa:** `public/js/app.js`, `public/js/api.js`, `public/js/interactions.js`, `public/index.html`.

**File mới:** `public/js/core/{state,navigation,view-lifecycle,resource-loader,style-loader}.js`, `public/js/features/{automation,learning,community}.js`.

Đã có bản đầu của `core/view-lifecycle.js`; tám feature lớn được khởi tạo khi mở mục. Ba bundle theo nhóm được tải bằng native `import()` theo nhu cầu và dùng bridge runtime tường minh trong `app.js` để giữ tương thích với API/inline action hiện có.

1. Tách bootstrap login/shell khỏi khởi tạo từng tính năng. Hiện DOMContentLoaded gọi hầu hết init dù chưa đăng nhập.
2. Thiết lập giao ước `mount(root)`, `activate()`, `deactivate()`, `dispose()`; mount có thể gọi lại mà không nhân đôi listener. Mỗi module sở hữu controller/timer/observer/chart của mình.
3. Di chuyển AppState dùng chung vào core; tách dữ liệu lâu sống khỏi tham chiếu DOM. Tránh mỗi module tạo một bản state hoặc mở một WebSocket riêng.
4. Xử lý các `onclick` inline trước khi chuyển sang ES module: dùng event delegation/data-action. Trong giai đoạn chuyển tiếp có thể có bridge toàn cục tường minh và giới hạn, sau đó gỡ từng phần.
5. Dùng `import()` native và cache promise tải module. Mở lại mục không tải/khởi tạo trùng. Tải module lỗi phải có trạng thái thử lại mà không phá shell.
6. Bỏ Chart.js chặn parser trong head trang login. Chỉ tải một lần khi vào biểu đồ; giữ phiên bản xác định, có xử lý lỗi. Dữ liệu điểm dạng bảng vẫn xem được nếu thư viện biểu đồ không tải được.
7. Tách quyền sở hữu tác vụ và giao diện: rời WordFmt/English/Survey chỉ dừng vẽ UI, không tự hủy job hay đóng luồng tiến độ cần thiết. Khi quay lại dựng từ trạng thái hiện tại; log phải có bộ đệm hữu hạn.
8. Khi logout: dispose module, hủy request đọc không còn cần, dọn dữ liệu thuộc tài khoản, chart, observer, listener và socket/timer theo cơ chế logout hiện tại.

**Nghiệm thu:** login không tải module công cụ và Chart.js; mỗi feature chỉ mount một lần; thử nhanh đổi mục khi module đang tải; không mất job/form, không nhân đôi API mutation.

## 7. Gói E — Chỉ dựng DOM cho nội dung cần dùng

**Phụ thuộc:** giao ước vòng đời ở gói D đã ổn định.

**File sửa:** `public/index.html`, module navigation và các feature đã tách; `public/js/interactions.js`.

**Tài nguyên mới:** các fragment `<template data-view-fragment>` trong `public/index.html` và `public/js/core/view-fragment-loader.js`.

1. Trang đầu chỉ có login, ba pane lõi và shell cần thiết. Tám pane nặng nằm trong template; vào từng mục mới gắn DOM và mount feature.
2. Template nhúng có thể là bước chuyển tiếp giúp ngăn tải ảnh/chạy layout, nhưng vẫn được parse và giữ bộ nhớ; muốn giảm DOM/RAM thực phải chuyển fragment không cần sang tải theo nhu cầu hoặc tạo khi mở.
3. Sửa các hàm đang dùng `getElementById()` với giả định mọi mục tồn tại. Lưu kết quả API/identity vào state; feature mới mount đọc state để render, không phụ thuộc cập nhật DOM từ trước.
4. Command palette dùng registry điều hướng độc lập với DOM chưa mount. Liên kết nhanh, focus sau chuyển mục, backdrop sidebar, modal và sticky header phải tiếp tục đúng.
5. Dùng cache DOM có giới hạn cho mục đã thăm; chọn giải phóng phần lớn không hoạt động sau khi benchmark, thay vì giữ tất cả hoặc hủy tất cả mỗi lần đổi tab. Form chưa lưu và file đang chọn cần được bảo toàn.
6. MutationObserver trong `setupDynamicEnhancement()` hiện quét lại dashboard khi có node thêm. Chuyển sang xử lý addedNodes trong vùng đã mount; bỏ qua node trang trí do chính enhancement tạo; có dispose khi gỡ vùng.
7. Một observer theo nhóm hiệu ứng thay vì một observer cho mỗi avatar. Gỡ tham chiếu phần tử bị unmount và tránh đăng ký listener trên từng lần render lại.

**Nghiệm thu:** giảm ≥60% DOM login; mở lại mục giữ state cần thiết; sau 30 vòng chuyển mục, retained heap/listener/observer không tăng tuyến tính; không có trường hợp dữ liệu tải xong nhưng mục mới mở bị trống.

## 8. Gói F — Tải dữ liệu, feed và realtime

**File sửa:** các feature grades/profile/schedule/learning/clans/confession, `public/js/api.js`, phần kết nối realtime hiện trong `public/js/app.js`.

1. Thay `loadAllDashboardData()` bằng tải dữ liệu tối thiểu cho mục đang mở. Profile chi tiết, schedule, learning chỉ tải khi mở, trừ dữ liệu thực sự cần cho shell. Xác định các phụ thuộc nghiệp vụ trước khi đổi thứ tự.
2. Gom các request đọc trùng bằng promise dùng chung. Cache ngắn trong phiên, khóa theo tài khoản + bộ lọc, xóa khi logout; nút Làm mới vẫn có thể bỏ cache. Không dùng cache công khai/service worker cho token, điểm, hồ sơ.
3. Thêm AbortSignal cho request đọc theo bộ lọc/mục; kết quả của request cũ không ghi đè state mới. Không tự hủy request ghi/job chỉ vì người dùng rời mục.
4. Feed đã có limit/offset trong API: dùng trang đầu 20 bài và Tải thêm; bình luận tải khi mở. Tài liệu clan đã có limit/offset nên tận dụng hợp đồng sẵn có.
5. Cập nhật like/comment/identity trên đúng item theo ID thay vì dựng lại cả feed, giữ vị trí cuộn, focus và nội dung đang nhập. Tránh đồng bộ lại tất cả avatar trên mọi sự kiện không liên quan.
6. Avatar mini ngoài viewport hoặc trong danh sách không tương tác dùng ảnh tĩnh; render khung động chỉ cho vùng đang cần.
7. Giữ một kết nối realtime cấp phiên khi cần. Khi document/mục bị ẩn, không refresh/render toàn feed cho từng event: đánh dấu dữ liệu cần làm mới, gộp và đọc lại một lần khi quay lại. Với event khác scope, đánh dấu scope tương ứng.
8. Giữ cơ chế chống request cũ và chống tải trùng đã có trong confession. Không coi refresh timeout 250 ms hiện tại là polling định kỳ để xóa nhầm.
9. Hủy timer reconnect khi logout, chỉ một timer hoạt động; resubscribe room sau reconnect và đọc bù dữ liệu để không mất cập nhật. Việc unsubscribe theo mục chỉ áp dụng room không cần cho thông báo toàn cục.
10. Log tác vụ giới hạn buffer hiển thị, cập nhật DOM theo lô; dữ liệu trạng thái hoàn thành/lỗi không được loại bỏ chỉ vì buffer đầy.

**Nghiệm thu:** đổi filter nhanh không hiện kết quả cũ; feed không nhảy về đầu khi có reaction; tab ẩn không dựng feed nền; quay lại không mất event; logout/login tài khoản khác không lẫn cache; tác vụ vẫn tiếp tục khi chuyển mục.

**Theo kết quả đo:** chỉ làm virtualization khi phân trang và cập nhật từng item vẫn chưa đáp ứng; cần kiểm tra bàn phím, tìm kiếm và chiều cao item động. Backend pagination cho leaderboard là thay đổi riêng chỉ khi payload thực tế chứng minh cần, không gộp vào đợt tối ưu đầu.

## 9. Gói G — CSS, cache và đóng gói

**File sửa:** `public/css/style.css`, `public/css/showcase.css`, `public/index.html`, `server.js`, `package.json`; cấu hình proxy thực tế nếu dự án có quản lý.

1. Tách CSS base/login/shell/feature cùng module tương ứng sau khi gói D/E ổn định. Bản hiện tại tách login khỏi dashboard bằng `scripts/split-public-css.mjs`; phần shell/feature vẫn nằm trong `style.css` để giữ thứ tự override của các khung động.
2. Dùng coverage trên các trạng thái thực (theme, modal, quyền admin, khung, lỗi/loading, mobile) để tìm rule thừa; không xóa rule chỉ vì chưa xuất hiện trong một lần mở trang.
3. Minify tài nguyên xuất bản; nếu có build thì quản lý đầu ra riêng và giữ source rõ ràng. `npm run build:client-assets` tạo bản `.min.css` rồi Brotli sidecar, bảo toàn source CSS; HTML đã trỏ tới bản minified. Không cần chuyển framework cho mục tiêu này.
4. Kiểm tra reverse proxy/CDN đã nén trước khi thêm cơ chế mới. Ưu tiên Brotli/gzip tiền nén hoặc proxy; xác minh Content-Encoding và Vary thực tế, tránh nén đồng bộ mỗi request.
5. Chỉ dùng cache dài immutable cho tài nguyên có hash/phiên bản đổi chắc chắn khi nội dung đổi. HTML revalidate để không giữ tham chiếu bundle cũ; giữ asset phiên bản trước trong giai đoạn chuyển bản để tab cũ còn hoạt động. Static server đã áp dụng `immutable` cho asset có query `?v=` và revalidate cho HTML.
6. Tạo Brotli tiền nén bằng `npm run compress:assets`; server chọn `.br` khi client hỗ trợ và giữ fallback không nén cho client cũ. Kiểm tra `Content-Encoding: br`, `Vary: Accept-Encoding` và `Content-Length` trên đường dẫn versioned.
7. Kiểm tra tài nguyên mới trong fragment/module/CSS đều được version hóa. Không áp cache tài nguyên tĩnh sang API cá nhân.

**Nghiệm thu:** trình duyệt cũ tải lại thấy bản mới đúng; tab đang mở không lỗi tải module khi cập nhật; refresh warm cache giảm byte; login cold transfer đạt ngân sách; layout không đổi ngoài điều chỉnh hiệu ứng đã nêu.

## 10. Thứ tự triển khai và kiểm thử

| Đợt | Công việc | Điểm chốt trước khi chuyển đợt |
| --- | --- | --- |
| 0 | A: baseline chuẩn hóa | Có phép đo lặp lại, dashboard fixture và trạng thái đo rõ |
| 1 | B: chính sách motion + điểm nóng login/pointer | CPU giảm; giao diện/focus/progress còn đúng |
| 2 | C: ảnh/font | Giảm byte; chất lượng ảnh và tiếng Việt đạt |
| 3 | D: module/vòng đời + Chart.js | Feature hoạt động khi tải muộn; không trùng listener/job |
| 4 | E: DOM theo nhu cầu | Giảm DOM; không mất form/state; memory ổn định |
| 5 | F: feed/realtime/request | Không mất cập nhật hoặc sai tài khoản/filter |
| 6 | G: CSS/bản phát hành/cache + benchmark cuối | Chức năng và ngân sách hiệu năng đều đạt |

Mỗi đợt là một nhóm thay đổi có thể review và hoàn tác riêng. Tách patch giảm hiệu ứng, đổi ảnh và refactor module để nhận biết nguyên nhân khi có lỗi. Sau mỗi đợt đo lại cùng baseline; không gộp một lần viết lại toàn bộ app.js và style.css.

Các kiểm tra bắt buộc phù hợp phạm vi:

- Chạy bộ test hiện có; các test đọc mã nguồn theo vị trí cũ cần cập nhật theo hành vi sau khi tách module, không xóa assertion để làm xanh test.
- Kiểm tra UI login/logout/đổi theme, menu và command palette bằng bàn phím, mật khẩu ẩn/hiện, bảng điểm/biểu đồ, lịch, modal và responsive.
- Kiểm tra khung/danh hiệu, avatar override, feed/clan/poll/comment, đổi bộ lọc và mất/kết nối lại mạng.
- Kiểm tra upload WordFmt, hiển thị tiến độ/hoàn thành/lỗi và chuyển mục giữa lúc tác vụ chạy; tương tự luồng công cụ có SSE.
- Test vòng đời có giá trị: mount/dispose lặp không tăng listener, request cũ không ghi đè, hidden/visible pause/resume đúng, animation bị tắt vẫn cleanup, module tải lỗi có thể thử lại.
- Kiểm tra tối thiểu một laptop dùng GPU tích hợp và một điện thoại Android thật trước khi tuyên bố hỗ trợ máy yếu; nếu chưa có thiết bị, ghi rõ phần xác minh còn thiếu.
- Chưa đặt trần RAM dashboard tùy ý. Chốt trần theo baseline dữ liệu đại diện và retained heap, đồng thời báo CPU/working set thay đổi tương đối.

## 11. Các quyết định mặc định của kế hoạch

- Mặc định Cân bằng; giữ lựa chọn Đầy đủ và Giảm hiệu ứng. Danh hiệu, màu khung và nội dung vẫn tồn tại ở cả ba chế độ.
- Tận dụng Express, JavaScript hiện tại và Sharp; dùng module native để tách dần.
- Ưu tiên lợi ích người dùng đo được: CPU đứng yên, độ phản hồi, tài nguyên tải đầu, bộ nhớ sau phiên dùng dài.
- Không đưa hạ tầng worker WordFmt, nâng VPS, đổi database hoặc phát triển tính năng mới vào đợt này. Chỉ mở rộng thay đổi backend khi cần phục vụ trực tiếp một vấn đề phía client đã được đo.
- Tài liệu này là kế hoạch để triển khai; các chỉ tiêu vẫn cần kiểm chứng bằng benchmark sau thay đổi.
