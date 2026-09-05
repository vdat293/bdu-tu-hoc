# Baseline hiệu năng phía trình duyệt

Ngày đo gần nhất: 05/09/2026. Lệnh: `npm run benchmark:client -- --runs=1 --warmup=1 --duration=1`.

Môi trường: Chrome 152 headless, Windows, Intel i7-12700F, 20 logical cores, 31,8 GiB RAM, localhost static server. Đây là phép đo lab, không phải kết quả điện thoại thật hay dữ liệu người dùng thật.

Sau khi hoãn `api.js`, `app.js`, `interactions.js` đến khi có phiên đăng nhập, thay logo đầu trang bằng WebP responsive và lazy-load ảnh không thiết yếu, kịch bản login cold ghi nhận:

| Chỉ số | Kết quả lab |
| --- | ---: |
| Dung lượng request tính trong phiên | **756.495 bytes** |
| First Contentful Paint | khoảng **74 ms** trong lượt đo này |
| CPU renderer | **5,7% của một lõi** |
| CPU tiến trình GPU | **15,4% của một lõi** |
| JavaScript heap đang dùng | khoảng **0,81 MiB** |
| DOM node | **1.343** |
| Long task quan sát được | **0** |

Sau khi chuyển tám pane nặng sang template lazy và bọc logo bằng `<picture>`, kiểm tra Chrome trực tiếp trên localhost ghi nhận **667 node DOM đang sống**, chỉ còn 3 pane lõi (`grades`, `profile`, `schedule`) và 8 template chưa mount. Đây là phép kiểm tra DOM riêng, không trộn vào các chỉ số CPU/FCP của lượt benchmark trước.

Log HTTP của cùng lượt kiểm tra chỉ thấy login CSS, showcase CSS, style loader và các script bootstrap/core cùng logo WebP cần thiết; `style.min.css`, `api.js`, `app.js`, `interactions.js` và ảnh nằm trong template không được request trước khi có phiên/mở mục.

Phép đo HTTP độc lập sau khi tách CSS và bật Brotli (`npm run measure:login-transfer -- 3423`) ghi nhận **196.748 bytes trên wire**, 11 tài nguyên nội bộ, gồm HTML, login/showcase CSS, năm core/bootstrap script và hai logo WebP. Phép đo loại bỏ nội dung trong `<template>` và ảnh fallback trong `<picture>`, không tính Google Fonts bên ngoài; kết quả lưu ở `output/login-transfer.json`.

Sau khi tách native `import()`, phần core `app.js` còn **111.085 bytes** nguồn (**25.772 bytes Brotli**). Các bundle theo nhóm là `features/automation.js` (**33.775 / 8.672 bytes Brotli**), `features/learning.js` (**36.488 / 8.980 bytes Brotli**) và `features/community.js` (**178.990 / 36.927 bytes Brotli**); mỗi bundle chỉ request khi mở nhóm mục tương ứng.

HTML login hiện tải `login.min.css` **18.759 bytes** nguồn (**4.832 Brotli**) và `showcase.min.css` **26.055 bytes** (**6.854 Brotli**). Sau khi xác thực, `style.min.css` **301.659 bytes** nguồn (**49.923 Brotli**) được tải và stylesheet login được tắt; việc tách này giảm khoảng 44.484 bytes Brotli khỏi cold login so với tải full CSS.

Server production đã có bản Brotli tiền nén cho CSS/JS/SVG/JSON. Với `Accept-Encoding: br`, `css/style.min.css?v=20260905-perf-v22` trả **49.923 bytes** (bản minified nguồn **301.659 bytes**) trước khi tính HTTP header; kiểm tra bằng `curl` ghi nhận `Content-Encoding: br`, `Vary: Accept-Encoding` và cache immutable cho URL versioned. Tạo lại sidecar sau khi sửa tài nguyên bằng `npm run build:client-assets`.

Số byte phụ thuộc cache, font, trình duyệt và đường mạng. CPU/RAM renderer không được hiểu là tổng CPU/RAM của toàn Chrome. Benchmark hiện tách CPU theo process; working set có thể null nếu process kết thúc trong lúc PowerShell đọc dữ liệu. Kết quả đầy đủ nằm ở `output/client-performance.json` sau lượt đo thành công gần nhất. Nếu GPU headless của máy kiểm thử không khởi tạo được, cần chạy lại trên máy có compositor hoạt động hoặc trình duyệt có GPU ảo.

Phép đo pointer, dashboard và vòng đời 30 lần chuyển mục đã có trong runner (`--fixture=dashboard --memory-cycles=30`). Lượt chạy lại sau khi tách feature đã có fallback đo process, nhưng môi trường Chrome vẫn không trả lời các CDP domain nên fallback không có renderer/heap/DOM và không dùng để so sánh ngân sách. Cần một máy/trình duyệt có CDP hoạt động ổn định để ghi nhận số liệu mới. Không tuyên bố đạt ngân sách RAM dashboard hoặc hỗ trợ máy yếu trước khi có phép đo đó.
