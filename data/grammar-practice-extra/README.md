# Luyện thêm ngữ pháp

Mỗi `unit-NN.json` là một mảng câu hỏi bổ sung cho bài có cùng thứ tự trong
lộ trình cùng tên. Ví dụ `grammar-in-use/unit-01.json` gắn với unit 1 của
Grammar In Use. Các câu này được lưu trong `grammar_extra_exercises`; tiến độ
được lưu riêng trong `grammar_extra_progress`.

Mỗi câu dùng `id` UUID, `type`, `question`, `optionA`–`optionD`, `correctAnswer`,
`explanation`, `hint` và `order`. Các dạng được trình làm bài hỗ trợ là
`multiple_choice`, `fill_blank` và `arrange_words`. Với câu sắp xếp, có thể lưu
các chip đã xáo trong `optionA` dưới dạng chuỗi phân cách bằng `/`.

Sau khi cập nhật file vào một database đang có dữ liệu gốc, chạy
`npm run db:migrate` rồi `npm run grammar:extra:import`. Import này chỉ upsert
ngân hàng bổ sung theo từng bài và xóa các câu
cũ đã bị loại khỏi file; ngân hàng gốc và tiến độ của nó không bị thay đổi.
Chạy `npm run grammar:export` để tạo bản SQL triển khai. `npm run grammar:import`
cũng nạp các file này khi cần nhập lại toàn bộ dữ liệu crawl.
