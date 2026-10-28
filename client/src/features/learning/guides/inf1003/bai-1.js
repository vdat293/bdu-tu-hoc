// Ported from lessons/bai-1-three-tier.js (window.BDU_LESSONS.push({...}))
// Source file is valid UTF-8 (verified byte-level); strings preserved byte-identically.
// Asset paths rewritten: "assets/..." -> "/guides/inf1003/..." (served from public/guides/inf1003/).
// Content data only — no site header/hero/footer ported.
export const BAI_1_LESSON = {
  id: "bai-1",
  order: 1,
  progressVersion: "cmd-be-first-v4",
  title: "Bài 1 — Dựng web 3 tầng trên AWS",
  summary: "Tạo hạ tầng bằng CloudShell, tải hai SSH key rồi tự chạy từng nhóm lệnh: chép mã nguồn qua FE, hoàn tất backend trên BE trước rồi quay về FE chạy frontend, trong một cửa sổ CMD.",
  duration: "60–90 phút",
  costNote: "≈ $0.1–0.2/giờ khi còn chạy; hoàn tất bước 7 để dừng tính tiền.",
  prerequisites: [
    "Tài khoản AWS lab có quyền tạo VPC, EC2 và RDS",
    "Windows Command Prompt (CMD), có lệnh ssh và scp",
    "AWS CloudShell tại region ap-southeast-1"
  ],
  steps: [
    {
      id: "buoc-1",
      title: "Tạo thư mục và tải b5",
      where: "local",
      folderInput: true,
      goal: "Tạo thư mục làm việc trên máy tính Windows, tải mã nguồn b5.zip và giải nén vào thư mục vừa tạo.",
      blocks: [
        {
          type: "note",
          title: "1. Tạo thư mục",
          text: "Tạo một thư mục với tên bất kỳ, ví dụ lab01, bai1 hoặc lab1, rồi mở thư mục vừa tạo. Các bước bên dưới dùng tên lab1 làm ví dụ."
        },
        {
          type: "note",
          title: "2. Tải mã nguồn b5.zip",
          text: "Nhấn chuột trái vào nút Tải b5.zip bên dưới. Nếu trình duyệt hỏi nơi lưu, chọn thư mục vừa tạo rồi bấm Save (Lưu). Nếu file tự tải vào Downloads (Tải xuống), làm tiếp thao tác chuyển file ở mục 3."
        },
        {
          type: "download",
          label: "Tải b5.zip",
          href: "/guides/inf1003/b5.zip",
          filename: "b5.zip"
        },
        {
          type: "note",
          title: "3. Đưa file tải về vào lab1",
          text: "Nếu b5.zip đã nằm trong lab1, bỏ qua mục này. Nếu file nằm trong Downloads: mở Downloads trong File Explorer, nhấn chuột trái một lần vào b5.zip để chọn, nhấn Ctrl+X. Mở lại thư mục lab1, nhấn Ctrl+V để chuyển file vào đây."
        },
        {
          type: "note",
          title: "4. Giải nén b5.zip ngay trong lab1",
          text: "Trong lab1, nhấn chuột phải vào b5.zip → chọn Extract All… (Giải nén tất cả…). Ở ô thư mục đích, chọn đúng thư mục lab1 đang làm việc; nếu Windows tự thêm phần b5 ở cuối đường dẫn, xóa phần thêm đó để tránh tạo b5 lồng trong b5. Nhấn chuột trái vào Extract (Giải nén), chờ hoàn tất rồi quay lại lab1. Bạn sẽ thấy thư mục b5 như ảnh bên dưới."
        },
        {
          type: "image",
          title: "Kết quả thực hiện bước 1",
          src: "/guides/inf1003/hinh-minh-hoa-tao-folder.png",
          alt: "File Explorer mở thư mục lab1 trong C:\\BDU\\Năm 3\\Cloud computing; bên trong có thư mục b5 sau khi giải nén.",
          caption: "Thư mục lab1 chứa thư mục mã nguồn b5. Đây là kết quả cần có trước khi sang bước 2; file b5.zip có thể vẫn còn trong lab1."
        },
        {
          type: "note",
          title: "5. Copy đường dẫn thư mục lab1",
          text: "Mở đúng thư mục lab1 có b5. Click chuột trái 2 lần vào cuối dòng ở thanh đường dẫn này, LƯU Ý phải click ở cuối dòng nhé. Vị trí cần bấm là vùng trống ngay sau tên lab1 và dấu mũi tên cuối cùng, trước ô Search lab1, như đầu mũi tên đỏ trong ảnh. Nếu thanh vẫn hiện các tên thư mục rời nhau, nhấn Alt+D. Nhấn Ctrl+C để copy toàn bộ đường dẫn, quay lại website rồi Ctrl+V vào ô Đường dẫn thư mục làm việc ở cuối bước này."
        },
        {
          type: "image",
          title: "Lấy đường dẫn để lệnh tự vào đúng thư mục",
          src: "/guides/inf1003/hinh-lay-duong-dan-lab1.png",
          alt: "Mũi tên đỏ trỏ vào vùng trống cuối thanh đường dẫn, sau lab1 và trước ô Search lab1; chú thích nhắc click chuột trái 2 lần vào cuối dòng.",
          caption: "Hiện đường dẫn dạng chữ → Ctrl+C → dán vào ô cuối bước 1. Website sẽ dùng đường dẫn bạn lưu để tạo lệnh vào thư mục cho CMD.",
          fullSizeLink: true
        }
      ],
      explain: [],
      expect: [
        "Mở lab1 thấy thư mục b5 như ảnh minh họa. Nhấp đúp vào b5 sẽ thấy frontend, backend, db và docker-compose.yml.",
        "Giữ thư mục lab1 để đặt thêm hai file key ở bước 3. Copy và lưu đường dẫn thư mục ở ô cuối bước này trước khi sang bước 2."
      ],
      errors: []
    },
    {
      id: "buoc-2",
      title: "Chạy script tạo hạ tầng",
      where: "cloudshell",
      goal: "Chạy script trong CloudShell. Khi hoàn tất, dán dòng kết quả vào ô cuối bước này để website tự chuẩn bị hướng dẫn tiếp theo.",
      resultInput: true,
      blocks: [
        {
          type: "note",
          tone: "info",
          title: "1. Mở AWS CloudShell",
          text: "Trong AWS Console, kiểm tra góc trên bên phải đang chọn Asia Pacific (Singapore), tức ap-southeast-1. Nhấn chuột trái vào biểu tượng cửa sổ lệnh trên thanh trên cùng, ở vị trí khoanh đỏ trong ảnh. Chờ CloudShell mở ở phía dưới trang và xuất hiện dấu nhắc ~ $. Script bên dưới chỉ chạy trong AWS CloudShell, là terminal Linux của AWS; CMD dùng cho các phần máy Windows được ghi riêng trong bài."
        },
        {
          type: "image",
          src: "/guides/inf1003/hinh1.png",
          alt: "Mũi tên đỏ chỉ vào biểu tượng CloudShell trên thanh công cụ phía trên của AWS Console.",
          caption: "Nhấn vào biểu tượng được khoanh đỏ để mở AWS CloudShell."
        },
        {
          type: "note",
          tone: "info",
          title: "2. Copy lệnh",
          text: "Copy lệnh bên dưới, sau đó dán vào AWS CloudShell."
        },
        {
          type: "script",
          scriptKey: "start",
          previewLines: 10
        },
        {
          type: "note",
          tone: "info",
          title: "3. Dán lệnh vào CloudShell và chạy",
          text: "Quay lại AWS Console. Nhấn chuột trái vào vùng terminal màu tối, ngay sau dấu nhắc ~ $ tại vị trí mũi tên đỏ trong ảnh dưới. Nhấn Ctrl+V để dán lệnh vừa copy; nếu trình duyệt không dán bằng phím này, thử Ctrl+Shift+V. Khi lệnh đã hiện ra, nhấn Enter một lần để chạy nếu lệnh chưa tự chạy. Các dòng thông báo sẽ bắt đầu xuất hiện bên dưới."
        },
        {
          type: "image",
          src: "/guides/inf1003/hinh1.1.png",
          alt: "CloudShell mở ở nửa dưới AWS Console; mũi tên đỏ chỉ dấu nhắc ~ $ trong vùng terminal, là nơi dán lệnh.",
          caption: "Nhấn vào vùng sau dấu ~ $, dán lệnh rồi nhấn Enter. Kết quả chạy sẽ xuất hiện ngay trong cửa sổ này."
        },
        {
          type: "note",
          tone: "info",
          title: "4. Chờ hoàn tất và copy dòng kết quả",
          text: "Giữ CloudShell mở và chờ script chạy xong; EC2 và RDS có thể mất 10–15 phút hoặc lâu hơn. Khi thấy Đã hoàn tất, vui lòng copy phần bên dưới, chọn nguyên dòng bắt đầu bằng BDU-LAB-V1: rồi copy. Dán dòng đó vào ô Kết quả CloudShell ở cuối bước này và bấm Phân tích & sang bước 3. Chưa cần tải key ở bước này. Nếu cần lấy lại dòng kết quả, chạy cat ~/bdu-aws/lab-result.txt trong CloudShell."
        }
      ],
      explain: [
        "Script tạo VPC, hai EC2, RDS và mở sẵn các security group của bài. Không cần mở thêm port."
      ],
      expect: [
        "Script báo Đã hoàn tất và in một dòng BDU-LAB-V1: giữa hai dòng phân cách. Website đọc dòng này để điền đúng đường dẫn tải key và cấu hình cho bạn."
      ],
      errors: [
        {
          symptom: "Key pair đã tồn tại nhưng thiếu .pem.",
          cause: "Key đã tạo ở lần chạy trước và AWS không cho tải lại private key.",
          fix: "Nếu còn file đã tải, giữ nguyên file đó; nếu file trên CloudShell bị mất và không còn bản sao, dọn hạ tầng ở bước 7 rồi tạo lại."
        },
        {
          symptom: "AccessDenied hoặc sai region.",
          cause: "Tài khoản thiếu quyền hoặc CloudShell mở sai khu vực.",
          fix: "Dùng tài khoản lab, kiểm tra region ap-southeast-1 rồi chạy lại."
        }
      ]
    },
    {
      id: "buoc-3",
      title: "Tải hai key và chuyển vào lab1",
      where: "cloudshell",
      whereLabel: "CloudShell → Máy local",
      requiresResult: true,
      goal: "Tải lần lượt hai file key bằng đúng đường dẫn website đã đọc ở bước 2, rồi chuyển cả hai vào lab1 cạnh thư mục b5.",
      blocks: [
        {
          type: "note",
          title: "1. Mở hộp Download file",
          text: "Quay lại CloudShell đã chạy script ở bước 2. Trong khung CloudShell phía dưới trang AWS, nhấn chuột trái vào nút Actions ở bên phải thanh tiêu đề (mũi tên 1). Khi menu mở ra, nhấn chuột trái vào Download file (mũi tên 2) để mở hộp tải tệp. Nếu chưa thấy mục này, cuộn bên trong menu Actions; hoặc mở CloudShell bằng Open in new browser tab rồi chọn lại."
        },
        {
          type: "image",
          src: "/guides/inf1003/hinh-download-key-annotated.png",
          alt: "Hai mũi tên đỏ trên ảnh AWS Console: mũi tên 1 chỉ nút Actions của khung CloudShell phía dưới, mũi tên 2 chỉ mục Download file trong menu đang mở.",
          caption: "Bấm theo thứ tự: 1 — Actions trong CloudShell; 2 — Download file. Trong hộp hiện ra, dán đường dẫn key từ thẻ bên dưới rồi bấm Download.",
          fullSizeLink: true
        },
        {
          type: "key-downloads"
        },
        {
          type: "image",
          title: "Dán đường dẫn vào đâu và bấm gì để tải?",
          src: "/guides/inf1003/hinh-download-dialog-annotated.png",
          alt: "Hộp Download file của CloudShell: mũi tên đỏ số 1 chỉ ô Individual file path để dán đường dẫn key, mũi tên số 2 chỉ nút Download màu cam để tải file.",
          caption: "1 — Nhấn vào ô Individual file path, nhấn Ctrl+V để dán đường dẫn vừa copy từ thẻ key. 2 — Bấm Download màu cam. Ảnh minh họa key FE; tải key BE bằng đường dẫn ở nút Copy đường dẫn BE rồi làm lại hai thao tác này.",
          fullSizeLink: true
        },
        {
          type: "note",
          title: "4. Chuyển cả hai key vào lab1",
          text: "Mở File Explorer → Downloads. Giữ Ctrl và nhấn chuột trái lần lượt vào bdu-key-fe.pem và bdu-key-be.pem để chọn cả hai; nhấn Ctrl+X. Mở thư mục lab1 đã tạo ở bước 1 rồi nhấn Ctrl+V. Đặt hai file cạnh thư mục b5, không đặt bên trong b5. Giữ nguyên tên hai file, tránh bản trùng có hậu tố (1)."
        },
        {
          type: "image",
          title: "Kết quả thực hiện bước 3",
          src: "/guides/inf1003/hinh-ket-qua-tai-key.png",
          alt: "File Explorer mở thư mục lab1, bên trong có thư mục b5 và hai file bdu-key-be.pem, bdu-key-fe.pem nằm cạnh nhau.",
          caption: "Hoàn thành bước này khi lab1 có đủ b5, bdu-key-be.pem và bdu-key-fe.pem như ảnh. Kiểm tra xong, bấm Tôi đã hoàn thành · Sang bước 4.",
          fullSizeLink: true
        }
      ],
      explain: [],
      expect: [
        "Trong lab1 có thư mục b5 cùng hai file bdu-key-fe.pem và bdu-key-be.pem. Kiểm tra đủ cả hai rồi xác nhận để sang bước 4."
      ],
      errors: [
        {
          symptom: "Download file báo không tìm thấy file.",
          cause: "Đã dán tên file thay vì đường dẫn đầy đủ, hoặc đang mở CloudShell khác với phiên chạy script.",
          fix: "Bấm Copy đường dẫn trên đúng thẻ key bên dưới, dán nguyên dòng vào ô đường dẫn của Download file; kiểm tra đúng tài khoản và region đã dùng ở bước 2."
        },
        {
          symptom: "Không thấy Download file.",
          cause: "CloudShell đang mở trong thanh dưới của AWS Console.",
          fix: "Mở CloudShell bằng Open in new browser tab rồi chọn Actions → Download file."
        }
      ]
    },
    {
      id: "buoc-4",
      requiresDirectory: true,
      requiresResult: true,
      title: "CMD → FE → BE: chép mã nguồn và kết nối",
      where: "local",
      whereLabel: "Một cửa sổ CMD · Local → FE → BE",
      goal: "Mở duy nhất một cửa sổ CMD, chép b5 cùng key BE vào bdu-web trên FE, rồi từ FE vào BE để cài backend trước.",
      blocks: [
        {
          type: "note",
          title: "1. Mở một cửa sổ CMD",
          text: "Nhấn Start, gõ cmd và mở Command Prompt. Giữ cửa sổ này suốt bước 4–6. Tại dấu nhắc Windows dạng C:\\…, dán khối lệnh local bên dưới. Website tự vào thư mục đã lưu ở bước 1 và điền sẵn địa chỉ kết nối."
        },
        {
          type: "connection"
        },
        {
          type: "note",
          title: "2. Cấp quyền key FE, chép file và đăng nhập",
          text: "Ngay sau khi tự vào lab1, icacls giới hạn quyền đọc key FE cho tài khoản Windows hiện tại, trước lệnh SSH đầu tiên. Đây là cách xử lý quyền key trên CMD; chmod 400 chỉ dùng ở máy Linux. Tiếp theo mkdir tạo bdu-web trên FE, scp chép b5 cùng key BE vào đó, rồi SSH vào FE trong cùng CMD. Nếu hỏi host lần đầu, kiểm tra đúng IP rồi nhập yes."
        },
        {
          type: "code",
          lang: "cmd",
          label: "Máy local · CMD → Quyền key FE, chép file và SSH",
          text: "icacls \"bdu-key-fe.pem\" /inheritance:r /grant:r \"%USERDOMAIN%\\%USERNAME%:(R)\" /remove:g *S-1-1-0 *S-1-5-11 *S-1-5-32-545 && ^\nssh -i bdu-key-fe.pem ubuntu@{{FE_IP}} \"mkdir -p /home/ubuntu/bdu-web && if [ -f /home/ubuntu/bdu-web/bdu-key-be.pem ]; then chmod 600 /home/ubuntu/bdu-web/bdu-key-be.pem; fi\" && ^\nscp -i bdu-key-fe.pem -r b5 bdu-key-be.pem ubuntu@{{FE_IP}}:/home/ubuntu/bdu-web/ && ^\nssh -i bdu-key-fe.pem ubuntu@{{FE_IP}}",
          localDirectory: true
        },
        {
          type: "troubleshoot",
          title: "+ Gặp vấn đề khi chép file hoặc SSH?",
          blocks: [
            {
              type: "note",
              title: "Chỉ khi gặp UNPROTECTED PRIVATE KEY FILE hoặc Bad permissions",
              text: "Nếu SSH từ CMD báo key quá mở, bạn vẫn đang ở dấu nhắc Windows. Chạy khối icacls dưới trong chính CMD này, rồi copy và chạy lại khối chép file/SSH bên trên. Nếu gặp Permission denied (publickey), kiểm tra đúng user ubuntu và key FE trước."
            },
            {
              type: "code",
              lang: "cmd",
              label: "Máy local · CMD · Chỉ khi SSH báo key quá mở",
              text: "icacls \"bdu-key-fe.pem\" /inheritance:r /grant:r \"%USERDOMAIN%\\%USERNAME%:(R)\" /remove:g *S-1-1-0 *S-1-5-11 *S-1-5-32-545\nicacls \"bdu-key-be.pem\" /inheritance:r /grant:r \"%USERDOMAIN%\\%USERNAME%:(R)\" /remove:g *S-1-1-0 *S-1-5-11 *S-1-5-32-545",
              localDirectory: true
            },
            {
              type: "note",
              title: "Không tìm thấy b5 hoặc file key",
              text: "Kiểm tra thư mục lưu ở bước 1 có b5, bdu-key-fe.pem và bdu-key-be.pem; không đổi tên hai key."
            }
          ]
        },
        {
          type: "image",
          title: "Đã truyền file và đăng nhập frontend",
          src: "/guides/inf1003/hinh-truyen-file-fe-thanh-cong.png",
          alt: "Mũi tên đỏ trỏ ngay sau dấu $ ở dấu nhắc ubuntu của frontend; chú thích: Nếu hiện như này là đã truyền file thành công.",
          caption: "Sau khi khối lệnh chép file chạy thành công, cửa sổ hiện dấu nhắc ubuntu@…:~$ như ảnh. Vị trí ngay sau dấu $ là nơi nhập lệnh tiếp theo.",
          fullSizeLink: true
        },
        {
          type: "note",
          title: "3. Kiểm tra thư mục bdu-web",
          text: "Ngay sau dấu $ trên frontend, gõ ls rồi nhấn Enter, hoặc copy lệnh bên dưới. Nếu kết quả có bdu-web như ảnh, thư mục đã có trên frontend."
        },
        {
          type: "code",
          lang: "bash",
          label: "Trong CMD · Đang SSH trên FE · Kiểm tra thư mục",
          text: "ls"
        },
        {
          type: "image",
          title: "Kết quả chạy ls trên frontend",
          src: "/guides/inf1003/hinh-kiem-tra-bdu-web.png",
          alt: "Lệnh ls được gõ sau dấu $ trên frontend, kết quả hiển thị thư mục bdu-web màu xanh; mũi tên và chú thích chỉ rõ lệnh và kết quả.",
          caption: "Chạy ls để kiểm tra: thấy bdu-web trong kết quả là đã có thư mục trên frontend.",
          fullSizeLink: true
        },
        {
          type: "note",
          title: "4. Từ FE chuyển tiếp vào BE",
          text: "Khi dấu nhắc là ubuntu@… của FE, chạy khối dưới trong cùng cửa sổ CMD. chmod 400 cấp quyền key BE trên Linux; tiếp theo tạo bdu-backend trên BE, chép mã nguồn sang BE rồi SSH vào BE. Chỉ tiếp tục bước 5 khi đã thấy dấu nhắc của BE."
        },
        {
          type: "code",
          lang: "bash",
          label: "Trong CMD · SSH trên FE → BE",
          text: "chmod 400 ~/bdu-web/bdu-key-be.pem &&\nssh -i ~/bdu-web/bdu-key-be.pem ubuntu@{{BE_IP}} 'mkdir -p /home/ubuntu/bdu-backend' &&\nscp -i ~/bdu-web/bdu-key-be.pem -r ~/bdu-web/b5 ubuntu@{{BE_IP}}:/home/ubuntu/bdu-backend/ &&\nssh -i ~/bdu-web/bdu-key-be.pem ubuntu@{{BE_IP}}"
        },
        {
          type: "note",
          title: "5. Kiểm tra kết quả trên backend",
          text: "Sau khi khối lệnh trên chạy thành công, dấu nhắc sẽ chuyển sang ubuntu@… của máy backend. Ngay sau dấu $, gõ ls rồi nhấn Enter để kiểm tra thư mục bdu-backend như ảnh. IP trong ảnh chỉ là ví dụ; đối chiếu với IP backend của bạn ở phần thông tin kết nối."
        },
        {
          type: "code",
          lang: "bash",
          label: "Trong CMD · Đang SSH trên BE · Kiểm tra thư mục",
          text: "ls"
        },
        {
          type: "image",
          title: "Kết quả SSH vào backend và kiểm tra thư mục",
          src: "/guides/inf1003/hinh-ket-qua-ssh-backend.png",
          alt: "Terminal của backend: lệnh ls hiển thị bdu-backend. Hai mũi tên đỏ chỉ thư mục trong kết quả và vị trí nhập lệnh ngay sau dấu $ ở dấu nhắc cuối.",
          caption: "Đang ở backend: chạy ls thấy bdu-backend. Nhập các lệnh của bước 5 ngay sau dấu $ trong cùng cửa sổ này.",
          fullSizeLink: true
        }
      ],
      explain: [],
      expect: [
        "Cùng một cửa sổ CMD, bạn đang ở phiên SSH BE. FE có ~/bdu-web/b5 và ~/bdu-web/bdu-key-be.pem; BE có ~/bdu-backend/b5."
      ],
      errors: []
    },
    {
      id: "buoc-5",
      requiresResult: true,
      title: "Hoàn tất backend và Docker trên BE",
      where: "local",
      whereLabel: "Cùng cửa sổ CMD · Đang SSH BE",
      goal: "Cài Docker, khởi tạo RDS và chạy backend trên BE trước. Khi backend hoạt động, exit đúng một lần để quay về FE.",
      blocks: [
        {
          type: "note",
          title: "1. Bạn đang ở BE",
          text: "Giữ nguyên cửa sổ CMD từ bước 4. Dấu nhắc hiện là ubuntu@… của BE; các lệnh dưới chạy trên Linux của BE qua SSH."
        },
        {
          type: "code",
          lang: "bash",
          label: "SSH · Linux trên BE · Cài Docker, Compose và MySQL client",
          text: "sudo apt update\nsudo apt install -y ca-certificates curl mysql-client\nsudo install -m 0755 -d /etc/apt/keyrings\nsudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc\nsudo chmod a+r /etc/apt/keyrings/docker.asc\n\nsudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF\nTypes: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: $(. /etc/os-release && echo \"$VERSION_CODENAME\")\nComponents: stable\nArchitectures: $(dpkg --print-architecture)\nSigned-By: /etc/apt/keyrings/docker.asc\nEOF\n\nsudo apt update\nsudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin\nsudo systemctl enable --now docker\nsudo docker --version\nsudo docker compose version"
        },
        {
          type: "note",
          title: "2. Kiểm tra Docker và MySQL client",
          text: "Cài đặt xong, chạy lần lượt hai lệnh bên dưới ngay trên máy backend. Nếu cả hai đều hiện thông tin phiên bản như ảnh là Docker và MySQL client đã được cài đặt. Số phiên bản có thể khác ảnh."
        },
        {
          type: "code",
          lang: "bash",
          label: "SSH · Linux trên BE · Kiểm tra Docker và MySQL client",
          text: "docker --version\nmysql --version"
        },
        {
          type: "image",
          title: "Kết quả kiểm tra Docker và MySQL client",
          src: "/guides/inf1003/hinh-kiem-tra-docker-mysql.png",
          alt: "Trên backend, docker --version hiển thị Docker version và mysql --version hiển thị mysql Ver; hai mũi tên đỏ chỉ thông tin phiên bản của từng lệnh.",
          caption: "docker --version và mysql --version đều hiện phiên bản: đã cài Docker và MySQL client trên backend.",
          fullSizeLink: true
        },
        {
          type: "note",
          title: "3. Khởi tạo RDS",
          text: "Khi mysql hỏi Enter password, nhập mật khẩu lab 12345678 rồi Enter; ký tự không hiện trên màn hình. Lưu ý cần xác nhận mật khẩu 2 lần nhé. Chỉ chạy db/init.sql một lần."
        },
        {
          type: "code",
          lang: "bash",
          label: "SSH · Linux trên BE · Khởi tạo database qua TLS",
          text: "cd ~/bdu-backend/b5\ncurl -fsSL -o global-bundle.pem https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem\n\nmysql -h {{DB_ENDPOINT}} -P 3306 -u root -p \\\n  --ssl-mode=VERIFY_IDENTITY --ssl-ca=./global-bundle.pem < db/init.sql\n\nmysql -h {{DB_ENDPOINT}} -P 3306 -u root -p \\\n  --ssl-mode=VERIFY_IDENTITY --ssl-ca=./global-bundle.pem \\\n  -e 'USE todo_db; SHOW TABLES; SELECT COUNT(*) AS todos FROM todos;'"
        },
        {
          type: "note",
          title: "Kết quả khởi tạo SQL thành công",
          text: "Sau khi nhập mật khẩu đủ hai lần, nếu kết quả hiển thị bảng todos và số bản ghi như ảnh bên dưới là đã khởi tạo SQL thành công. Trong ảnh có 3 bản ghi mẫu; số lượng có thể khác nếu bạn đã thay đổi dữ liệu."
        },
        {
          type: "image",
          title: "SQL đã tạo bảng todos và dữ liệu mẫu",
          src: "/guides/inf1003/hinh-khoi-tao-sql-thanh-cong.png",
          alt: "Kết quả MySQL trên backend: SHOW TABLES hiển thị bảng todos và SELECT COUNT(*) hiển thị 3 bản ghi. Mũi tên đỏ chỉ hai kết quả, kèm chú thích Khởi tạo SQL thành công.",
          caption: "Có bảng todos và kết quả đếm bản ghi: khởi tạo SQL thành công. Bạn có thể tiếp tục bật backend bằng Docker.",
          fullSizeLink: true
        },
        {
          type: "note",
          title: "4. Bật backend bằng Docker",
          text: "Chạy khối dưới trên BE. Chờ container backend lên và kiểm tra /api/health trả status ok trước khi thoát."
        },
        {
          type: "code",
          lang: "bash",
          label: "SSH · Linux trên BE · Cấu hình và chạy backend",
          text: "cd ~/bdu-backend/b5/backend\n\ncat > .env <<EOF\nDB_HOST={{DB_ENDPOINT}}\nDB_PORT=3306\nDB_NAME=todo_db\nDB_USER=root\nDB_PASSWORD=12345678\nEOF\n\ncat > docker-compose.override.yml <<EOF\nservices:\n  backend:\n    environment:\n      DB_HOST: {{DB_ENDPOINT}}\n      DB_PORT: 3306\n      DB_NAME: todo_db\n      DB_USER: root\n      DB_PASSWORD: \"12345678\"\nEOF\n\nchmod 600 .env docker-compose.override.yml\nsudo docker compose up -d --build --no-deps backend\nsudo docker compose ps\nsudo docker compose logs --tail 30 backend\ncurl --retry 15 --retry-all-errors --retry-delay 2 -fsS http://localhost:8000/api/health && echo"
        },
        {
          type: "note",
          title: "Kiểm tra kết quả trước khi exit",
          text: "Container hiện Started và trạng thái Up là đã khởi động. Ảnh dưới còn báo curl: (56) Connection reset by peer, nên chưa xác nhận API hoạt động. Nếu gặp lỗi như ảnh, chạy lại lệnh kiểm tra bên dưới. Khi API trả JSON có status là ok mới chuyển sang phần exit. Nếu vẫn lỗi, xem sudo docker compose logs --tail 30 backend trong thư mục ~/bdu-backend/b5/backend."
        },
        {
          type: "image",
          title: "Container đã khởi động, cần kiểm tra API",
          src: "/guides/inf1003/hinh-backend-started-kiem-tra-api.png",
          alt: "Container todo_backend hiện Started và Up, nhưng curl báo lỗi 56 Connection reset by peer. Mũi tên chú thích hai trạng thái và nhắc chỉ exit khi API trả status ok.",
          caption: "Started xác nhận container đã khởi động. Nếu curl còn lỗi như ảnh, kiểm tra lại API trước khi thoát BE.",
          fullSizeLink: true
        },
        {
          type: "code",
          lang: "bash",
          label: "SSH · Linux trên BE · Kiểm tra lại API nếu curl báo lỗi",
          text: "curl --retry 15 --retry-all-errors --retry-delay 2 -fsS http://localhost:8000/api/health && echo"
        },
        {
          type: "note",
          title: "5. Exit về FE",
          text: "Khi API đã trả status là ok, backend đã chạy thành công. Chạy exit đúng một lần để trở lại phiên SSH FE trong cùng cửa sổ CMD; chưa thoát về Windows."
        },
        {
          type: "code",
          lang: "bash",
          label: "Trong CMD · SSH BE → Trở lại FE",
          text: "exit"
        }
      ],
      explain: [],
      expect: [
        "Backend trên BE đang chạy bằng Docker, /api/health trả status ok. Sau một lần exit, dấu nhắc thuộc FE để tiếp tục bước 6."
      ],
      errors: [
        {
          symptom: "mysql báo Access denied.",
          cause: "Mật khẩu RDS nhập không đúng.",
          fix: "Nhập mật khẩu lab 12345678 khi mysql hỏi; nếu bạn đã đổi mật khẩu lúc tạo RDS thì dùng mật khẩu đó và sửa backend/.env cùng override."
        },
        {
          symptom: "Backend không kết nối được database.",
          cause: "Chưa chạy init.sql, sai endpoint hoặc Compose vẫn trỏ DB_HOST=db.",
          fix: "Trên BE, kiểm tra DB_ENDPOINT, chạy phần khởi tạo RDS nếu chưa làm và tạo lại override; xem sudo docker compose logs --tail 30 backend."
        }
      ]
    },
    {
      id: "buoc-6",
      requiresResult: true,
      title: "Hoàn tất frontend và Docker trên FE",
      where: "local",
      whereLabel: "Cùng cửa sổ CMD · FE → Windows",
      goal: "Quay về FE sau khi BE hoàn tất, cài Docker và chạy frontend. Kiểm tra toàn bộ website rồi mới thoát SSH về CMD local.",
      blocks: [
        {
          type: "note",
          title: "1. Bạn đã quay lại FE",
          text: "Sau exit ở bước 5, dấu nhắc vẫn là ubuntu@… nhưng thuộc FE. Giữ nguyên cửa sổ CMD; chạy các lệnh Linux dưới đây trên FE."
        },
        {
          type: "code",
          lang: "bash",
          label: "SSH · Linux trên FE · Cài Docker và Compose",
          text: "sudo apt update\nsudo apt install -y ca-certificates curl mysql-client\nsudo install -m 0755 -d /etc/apt/keyrings\nsudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc\nsudo chmod a+r /etc/apt/keyrings/docker.asc\n\nsudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF\nTypes: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: $(. /etc/os-release && echo \"$VERSION_CODENAME\")\nComponents: stable\nArchitectures: $(dpkg --print-architecture)\nSigned-By: /etc/apt/keyrings/docker.asc\nEOF\n\nsudo apt update\nsudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin\nsudo systemctl enable --now docker\nsudo docker --version\nsudo docker compose version"
        },
        {
          type: "note",
          title: "2. Bật frontend bằng Docker",
          text: "Backend đã chạy ở bước 5. Cấu hình nginx trỏ tới IP BE đã được điền sẵn rồi bật container frontend."
        },
        {
          type: "code",
          lang: "bash",
          label: "SSH · Linux trên FE · Cấu hình và chạy frontend",
          text: "cd ~/bdu-web/b5/frontend\nprintf 'BACKEND_URL=http://%s:8000\\n' {{BE_IP}} > .env\nchmod 600 .env\n\nsudo docker compose up -d --build\nsudo docker compose ps\ncurl -I http://localhost:3000/"
        },
        {
          type: "note",
          title: "3. Kiểm tra trên FE và xóa key BE tạm",
          text: "Chờ API qua nginx trả status ok. Sau khi không còn cần kết nối BE, xóa key BE tạm ở bdu-web trên FE. Hai key trong lab1 ở máy Windows vẫn được giữ."
        },
        {
          type: "code",
          lang: "bash",
          label: "Trong CMD · SSH trên FE · Kiểm tra và dọn key tạm",
          text: "curl --retry 10 --retry-all-errors --retry-delay 2 -fsS http://localhost:3000/api/health && {\n  echo\n  shred -u ~/bdu-web/bdu-key-be.pem\n}"
        },
        {
          type: "note",
          title: "4. Exit về CMD local",
          text: "Chạy exit một lần để rời FE. Khi dấu nhắc trở lại dạng C:\\… của Windows, bạn đã về chính CMD mở từ bước 4; không mở cửa sổ mới."
        },
        {
          type: "code",
          lang: "bash",
          label: "Trong CMD · SSH FE → CMD local",
          text: "exit"
        },
        {
          type: "note",
          title: "5. Kiểm tra website từ CMD local",
          text: "Tại dấu nhắc Windows trong cùng cửa sổ, chạy khối dưới rồi mở URL vừa in trên trình duyệt. Thêm một công việc và tải lại trang để kiểm tra dữ liệu đã được lưu."
        },
        {
          type: "code",
          lang: "cmd",
          label: "Máy local · CMD · Kiểm tra website",
          text: "curl.exe -fsS \"http://{{FE_IP}}:3000/api/health\"\necho.\ncurl.exe -fsS \"http://{{FE_IP}}:3000/api/todos\"\necho.\necho Mo trinh duyet: http://{{FE_IP}}:3000/\nstart \"\" \"http://{{FE_IP}}:3000/\"\necho Hoàn tất\n"
        }
      ],
      explain: [],
      expect: [
        "Frontend trên FE và backend trên BE đều chạy Docker. API qua nginx hoạt động; website mở được và lưu công việc. Bạn đã trở về CMD local."
      ],
      errors: [
        {
          symptom: "docker compose: command not found.",
          cause: "Thiếu Compose plugin hoặc chưa thêm repository Docker.",
          fix: "Chạy đầy đủ nhóm cài Docker phía trên; kiểm tra bằng sudo docker compose version."
        },
        {
          symptom: "Trang chủ mở được nhưng API báo 502.",
          cause: "Backend chưa chạy hoặc BE_IP sai.",
          fix: "Kiểm tra backend đã chạy ở bước 5; nếu vẫn lỗi, kiểm tra BACKEND_URL trong frontend/.env và địa chỉ private của BE."
        }
      ]
    },
    {
      id: "buoc-7",
      title: "Dọn dẹp để dừng tính tiền",
      where: "cloudshell",
      goal: "Quay lại AWS CloudShell để xóa tài nguyên của bài khi học xong.",
      blocks: [
        {
          type: "note",
          tone: "warn",
          title: "Không bỏ qua bước cuối",
          text: "NAT Gateway, RDS và EC2 vẫn phát sinh chi phí khi còn tồn tại. Bấm Copy ở khung bên dưới để lấy lệnh 1 dòng, dán vào CloudShell rồi nhấn Enter. Khi câu hỏi xác nhận xuất hiện, gõ riêng yes rồi nhấn Enter nếu đúng tài khoản và region của bài lab."
        },
        {
          type: "script",
          scriptKey: "clean"
        }
      ],
      explain: [],
      expect: [
        "Cuối script in Khong con tai nguyen bdu-* trong region ap-southeast-1."
      ],
      errors: [
        {
          symptom: "Câu hỏi xác nhận chứa code hoặc script báo Da huy.",
          cause: "Dán trực tiếp script nhiều dòng khiến read đọc phần code phía sau thay cho câu trả lời yes.",
          fix: "Nhấn Ctrl+C để về dấu nhắc CloudShell, bấm Copy để lấy lệnh 1 dòng rồi chạy lại. Chờ câu hỏi xác nhận mới gõ yes và nhấn Enter."
        },
        {
          symptom: "Còn sót subnet, security group hoặc ENI.",
          cause: "RDS/NAT chưa nhả kết nối ngay sau khi xóa.",
          fix: "Đợi 2–5 phút rồi chạy lại script; giữ nguyên region đã dùng để tạo hạ tầng."
        }
      ]
    }
  ]
};
