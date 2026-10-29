// Ported from aws-web-tut/assets/local-setup.js. Adapt the existing OS lesson
// so the richer macOS file/SSH instructions remain shared with CloudShell.
function parseLocalDirectory(value) {
  const display = String(value ?? '').trim();
  const bash = /^[A-Za-z]:\\/.test(display)
    ? '/' + display[0].toLowerCase() + display.slice(2).replace(/\\/g, '/')
    : display;
  if (!/^(?:[A-Za-z]:\\|\/(?:Users|Volumes)\/)/.test(display)) {
    throw new Error('Lưu đường dẫn đầy đủ của thư mục bài lab ở bước 1.');
  }
  return { display, bash };
}

export function labKeySource(token) {
  try {
    const match = String(token).match(/(?:^|\s)BDU-LAB-V1:([A-Za-z0-9+/]+={0,2})(?=\s|$)/);
    return match && /(?:^|\n)KEY_SOURCE=LOCAL(?:\n|$)/.test(window.atob(match[1])) ? 'LOCAL' : 'CLOUDSHELL';
  } catch { return 'CLOUDSHELL'; }
}

function shellQuote(value) { return "'" + String(value).replace(/'/g, "'\\''") + "'"; }
function psQuote(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
export function bootstrapCommand(options) {
  const url = new URL(options.baseUrl);
  const octets = url.hostname.split('.').map(Number);
  const tailscale = /^100\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(url.hostname)
    && octets[1] >= 64 && octets[1] <= 127 && octets.every(value => value >= 0 && value <= 255);
  const localHttp = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(url.hostname) || tailscale;
  if (url.username || url.password || (url.protocol !== "https:" && !(url.protocol === "http:" && localHttp))) {
    throw new Error("Mở website qua HTTPS, localhost hoặc địa chỉ IP Tailscale để tải bộ chạy tự động.");
  }
  url.search = ""; url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  const action = options.action === "clean" ? "clean" : "start";
  if (![options.bootstrapHash, options.scriptHash].every(function (hash) { return /^[a-f0-9]{64}$/.test(hash); })) {
    throw new Error("Thiếu thông tin kiểm tra bộ chạy. Hãy tải lại website.");
  }
  const directory = parseLocalDirectory(options.directory);
  if (!/^\/[\p{L}\p{M}\p{N}_./ ()'@+-]+$/u.test(directory.bash) || directory.bash.length > 2000) {
    throw new Error("Hãy dùng thư mục có tên gồm chữ, số, dấu cách hoặc các ký tự _ . - ( ) ' @ + để website đọc được kết quả.");
  }
  if (options.platform === "macos") {
    if (!/^\/(Users|Volumes)\//.test(directory.bash)) throw new Error("Hãy lưu đường dẫn thư mục macOS, ví dụ /Users/ten/lab1.");
    return "/bin/bash -c " + shellQuote(
      "set -e; tmp=$(mktemp); trap 'rm -f -- \"$tmp\"' EXIT; " +
      "curl --fail --location " + shellQuote(new URL("scripts/start-aws-local.sh", url).href) + " -o \"$tmp\"; " +
      "test \"$(shasum -a 256 \"$tmp\" | awk '{print $1}')\" = " + shellQuote(options.bootstrapHash) + "; " +
      "/bin/bash \"$tmp\" " + shellQuote(directory.bash) + " " + shellQuote(url.href) + " " + shellQuote(options.scriptHash) + " " + action
    );
  }
  if (/^\/(Users|Volumes)\//.test(directory.bash)) throw new Error("Hãy chọn macOS hoặc lưu đường dẫn thư mục Windows ở bước 1.");
  const windowsPath = /^\/[a-zA-Z](?:\/|$)/.test(directory.display) ?
    directory.bash[1].toUpperCase() + ":" + (directory.bash.slice(2).replace(/\//g, "\\") || "\\") : directory.display;
  const script = "$ErrorActionPreference='Stop'; $p=Join-Path ([IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString() + '.ps1'); try { " +
    "[Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; " +
    "Invoke-WebRequest -UseBasicParsing -Uri " + psQuote(new URL("scripts/start-aws-local.ps1", url).href) + " -OutFile $p; " +
    "if ((Get-FileHash -LiteralPath $p -Algorithm SHA256).Hash.ToLowerInvariant() -ne " + psQuote(options.bootstrapHash) + ") { throw 'Reload the tutorial and copy the command again.' }; " +
    "& $p -LabDirectory " + psQuote(windowsPath) + " -BaseUrl " + psQuote(url.href) + " -ScriptSha256 " + psQuote(options.scriptHash) + " -Action " + action +
    " } finally { if (Test-Path -LiteralPath $p) { Remove-Item -LiteralPath $p -Force } }";
  let binary = "";
  for (let i = 0; i < script.length; i++) {
    const code = script.charCodeAt(i);
    binary += String.fromCharCode(code & 255, code >>> 8);
  }
  return "powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand " + window.btoa(binary);
}

export function adaptLesson(original, mode, platform) {
  if (mode !== "local") return original;
  const lesson = JSON.parse(JSON.stringify(original));
  lesson.infrastructureMode = "local";
  lesson.platform = platform === "macos" ? "macos" : "windows";
  const mac = lesson.platform === "macos";
  const terminal = mac ? "Terminal" : "PowerShell";
  lesson.summary = "Tạo hạ tầng bằng AWS CLI trên máy cá nhân, lưu hai key ngay vào thư mục bài lab, rồi tự triển khai backend và frontend theo các bước bên dưới.";
  lesson.prerequisites = ["Tài khoản AWS có quyền tạo VPC, EC2, RDS và đăng nhập CLI", mac ? "macOS, Terminal và quyền cài AWS CLI" : "Windows 64-bit; bộ chạy tự cài AWS CLI và Git Bash nếu thiếu", "Thư mục bài lab có mã nguồn b5"];
  Object.assign(lesson.steps[1], {
    where: "local", whereLabel: "Máy local · " + terminal,
    goal: "Chạy bộ khởi động trong " + terminal + ". Đăng nhập AWS xong, script tự tạo hạ tầng và lưu hai key vào thư mục đã chọn.",
    blocks: [
      { type: "note", title: "1. Mở " + terminal, text: mac ? "Mở Terminal trên macOS. Giữ cửa sổ mở cho đến khi tạo hạ tầng xong; macOS có thể yêu cầu mật khẩu quản trị để cài AWS CLI." : "Nhấn Start, gõ PowerShell và mở Windows PowerShell. Bộ chạy tự tải AWS CLI và Git Bash nếu thiếu; không cần tự mở Git Bash." },
      { type: "local-bootstrap", action: "start" },
      ...(mac ? [
        { type: "note", title: "Nhập mật khẩu mở máy của bạn", text: "Khi Terminal hiện Password: và biểu tượng chìa khóa như ảnh, nhập mật khẩu đăng nhập Mac rồi nhấn Enter. Khi gõ, màn hình không hiện ký tự hay dấu sao; bạn cứ nhập đủ mật khẩu rồi nhấn Enter để tiếp tục cài AWS CLI." },
        { type: "image", src: "/guides/inf1003/macos/hinh-nhap-mat-khau-cai-aws-cli-annotated.png", alt: "Biểu tượng chìa khóa cạnh Password: trong Terminal macOS, mũi tên đỏ chỉ vào đó với ghi chú Nhập mật khẩu mở máy của bạn.", caption: "Nhập mật khẩu mở máy Mac tại dòng Password: rồi nhấn Enter. Đây là bước cài AWS CLI trên macOS.", fullSizeLink: true }
      ] : []),
      { type: "note", title: "2. Đăng nhập rồi chờ hoàn tất", text: "Trình duyệt sẽ mở để bạn đăng nhập AWS. Chọn đúng tài khoản lab, quay lại cửa sổ lệnh và chờ script tự chạy. Region dùng cho bài là ap-southeast-1. Không đóng cửa sổ trong khi chờ EC2 và RDS." },
      { type: "note", title: "3. Copy dòng kết quả và dán bên dưới", text: "Khi script báo hoàn tất, copy toàn bộ chuỗi bắt đầu bằng BDU-LAB-V1: trong cửa sổ lệnh rồi dán vào ô cuối bước này. Nếu chuỗi tự xuống dòng, chọn hết các dòng của chuỗi như khung đỏ trong ảnh minh họa. Thư mục bài lab chỉ cần hai file bdu-key-fe.pem và bdu-key-be.pem nằm cạnh b5." }
    ],
    explain: [], expect: ["Hai file bdu-key-fe.pem và bdu-key-be.pem nằm cạnh b5. Script báo hoàn tất và in chuỗi BDU-LAB-V1: để copy vào ô bên dưới."],
    errors: [
      { symptom: "aws login báo AccessDenied hoặc không đăng nhập được.", cause: "Identity chưa có quyền SignInLocalDevelopmentAccess, hoặc dùng IAM Identity Center.", fix: "Nhờ quản trị viên cấp quyền đăng nhập CLI. IAM Identity Center cần cấu hình SSO; không tiếp tục tạo tài nguyên khi chưa đăng nhập được." },
      { symptom: "Key pair đã tồn tại nhưng không có .pem trên máy.", cause: "Hạ tầng đã được tạo ở CloudShell hoặc máy khác.", fix: "Chép lại hai PEM gốc vào thư mục bài lab rồi chạy lại. AWS không cho tải lại private key đã tạo; không xóa key đang dùng." }
    ]
  });
  Object.assign(lesson.steps[2], {
    title: "Kiểm tra hai key trong thư mục bài lab", where: "local", whereLabel: "Máy local",
    goal: "Hai key đã được lưu trực tiếp trên máy. Kiểm tra đủ file trước khi chép mã nguồn và SSH.",
    blocks: [
      { type: "note", title: "Key đã có sẵn trên máy", text: "Mở thư mục đã lưu ở bước 1. Bên trong phải có b5, bdu-key-fe.pem và bdu-key-be.pem. Giữ nguyên tên hai key, đặt cạnh b5. Không cần tải key từ CloudShell." },
      { type: "connection" }
    ], explain: [], expect: ["Thư mục bài lab có b5 và đủ hai PEM. Bấm xác nhận để sang bước 4."],
    errors: [{ symptom: "Thiếu file PEM.", cause: "Script chưa chạy xong hoặc bạn đang mở nhầm thư mục.", fix: "Kiểm tra thư mục hiển thị trong cửa sổ chạy script. Nếu key đã tồn tại trên AWS, tìm lại bản PEM gốc." }]
  });
  Object.assign(lesson.steps[6], {
    where: "local", whereLabel: "Máy local · " + terminal,
    goal: "Dùng AWS CLI trên máy để dọn tài nguyên của bài khi học xong.",
    blocks: [
      { type: "note", title: "Dọn tài nguyên bằng " + terminal, text: "Mở lại " + terminal + ", chạy lệnh bên dưới và đăng nhập đúng tài khoản lab. Khi script hiển thị tài khoản cùng region ap-southeast-1, chỉ gõ yes nếu đúng hạ tầng bạn muốn dọn. Chờ kết quả kiểm tra tài nguyên còn sót." },
      { type: "local-bootstrap", action: "clean" }
    ], explain: [], expect: ["Script xác nhận không còn tài nguyên của bài trong region ap-southeast-1."],
    errors: [{ symptom: "Script báo còn tài nguyên hoặc thiếu quyền xóa.", cause: "Tài nguyên còn phụ thuộc nhau hoặc phiên đăng nhập không có đủ quyền.", fix: "Đọc lỗi trong cửa sổ lệnh, xử lý quyền rồi chạy lại lệnh dọn. Không xem là hoàn tất khi vẫn còn tài nguyên." }]
  });
  return lesson;
}
