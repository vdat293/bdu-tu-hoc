import { BAI_1_LESSON } from './bai-1.js';

// AWS, Ubuntu and CloudShell instructions are shared with the Windows lesson.
// Only the student's local shell, file operations and shortcuts differ.
function macCopy(text) {
  return text.replaceAll('CMD', 'Terminal').replaceAll('Windows', 'macOS')
    .replaceAll('Ctrl+Shift+V', 'Cmd+V').replaceAll('Ctrl+V', 'Cmd+V');
}

function macBlock(block) {
  const next = { ...block };
  for (const key of ['title', 'label', 'caption', 'alt']) {
    if (typeof next[key] === 'string') next[key] = macCopy(next[key]);
  }
  if (next.type === 'note') next.text = macCopy(next.text);
  if (next.blocks) next.blocks = next.blocks.map(macBlock);
  return next;
}

const MAC_FOLDER_STEP = {
  ...BAI_1_LESSON.steps[0],
  whereLabel: 'Máy local · Finder hoặc Terminal trên macOS',
  goal: 'Tạo thư mục làm việc trên Mac, tải mã nguồn b5.zip và giải nén vào thư mục vừa tạo.',
  blocks: [
    {
      type: 'note', title: '1. Tạo thư mục',
      text: 'Mở Finder bằng biểu tượng khuôn mặt trên thanh Dock. Mở nơi bạn muốn lưu bài, ví dụ Tài liệu (Documents). Nhấn chuột phải vào vùng trống → chọn Thư mục mới (New Folder), hoặc nhấn Shift+Cmd+N. Đặt tên bất kỳ, ví dụ lab1 hoặc bai1, rồi nhấn Enter. Nhấp đúp để mở thư mục vừa tạo. Các bước bên dưới dùng tên lab1 làm ví dụ; ảnh minh họa dùng tên bai1. Tạo file nhanh',
      jumpLink: { text: 'ở đây', targetId: 'macos-quick-setup' }
    },
    {
      type: 'note', title: '2. Tải mã nguồn b5.zip',
      text: 'Nhấn chuột trái vào nút Tải b5.zip bên dưới. Nếu trình duyệt hỏi nơi lưu, chọn thư mục vừa tạo rồi bấm Lưu (Save). Nếu file tự tải vào Downloads (Tải về), làm tiếp thao tác chuyển file ở mục 3.'
    },
    { type: 'download', label: 'Tải b5.zip', href: '/guides/inf1003/b5.zip', filename: 'b5.zip' },
    {
      type: 'note', title: '3. Đưa file tải về vào lab1',
      text: 'Nếu b5.zip đã nằm trong lab1, bỏ qua mục này. Nếu file nằm trong Downloads: mở Downloads trong Finder, nhấn chuột trái một lần vào b5.zip để chọn rồi nhấn Cmd+C. Mở lại thư mục lab1 và nhấn Cmd+Option+V để chuyển file vào đây. Nếu trình duyệt đã tự giải nén thành thư mục b5, chuyển thư mục b5 vào lab1 theo cách tương tự và bỏ qua mục giải nén bên dưới.'
    },
    {
      type: 'note', title: '4. Giải nén b5.zip ngay trong lab1',
      text: 'Trong lab1, nhấp đúp vào b5.zip. macOS sẽ mở công cụ giải nén và tạo thư mục b5 ngay bên cạnh file zip. Chờ hoàn tất rồi kiểm tra kết quả như ảnh bên dưới. Nhấp đúp vào b5 sẽ thấy frontend, backend, db và docker-compose.yml. Nếu đã có b5 từ mục 3 thì không cần giải nén lại.'
    },
    {
      type: 'note', id: 'macos-quick-setup', title: 'Tạo nhanh bằng Terminal (tùy chọn)',
      text: 'Ấn Command + dấu cách, gõ Terminal rồi nhấn Enter để mở Terminal. Copy lệnh bên dưới, dán vào Terminal bằng Command + V rồi nhấn Enter để thực hiện nhanh chóng. Giải nén thành công, lệnh sẽ tự xóa b5.zip rồi mở thư mục trong Finder.'
    },
    {
      type: 'code', lang: 'zsh', label: 'Máy local · Terminal · Tạo thư mục, tải b5, giải nén và mở Finder',
      text: 'mkdir -p "$HOME/lab1" && cd "$HOME/lab1" && curl -fL --retry 3 -o b5.zip \'{{SITE_ORIGIN}}/guides/inf1003/b5.zip\' && unzip -n b5.zip && rm b5.zip && open .'
    },
    {
      type: 'image', title: 'Kết quả giải nén trên macOS',
      src: '/guides/inf1003/macos/hinh-thu-muc-b5.jpg',
      alt: 'Finder trên macOS mở thư mục bai1, bên trong có thư mục mã nguồn b5.',
      caption: 'Thư mục làm việc chứa thư mục mã nguồn b5. Ảnh dùng tên bai1; thư mục của bạn có thể tên lab1 hoặc tên khác. Lệnh tạo nhanh tự xóa b5.zip sau khi giải nén; nếu làm thủ công, file zip có thể vẫn còn bên cạnh b5.',
      fullSizeLink: true
    },
    {
      type: 'note', title: '5. Copy đường dẫn thư mục lab1',
      text: 'Mở đúng thư mục lab1 có b5 trong Finder. Nếu chưa thấy thanh đường dẫn ở dưới cửa sổ, vào menu Xem (View) → Hiển thị thanh đường dẫn (Show Path Bar). Nhấn chuột phải vào tên thư mục cuối cùng trên thanh này, rồi chọn Sao chép “lab1” dưới dạng tên đường dẫn. Trong ảnh, thư mục tên bai1 nên menu hiện Sao chép “bai1” dưới dạng tên đường dẫn. Quay lại website, nhấn chuột trái vào ô Đường dẫn thư mục làm việc ở cuối bước này rồi nhấn Cmd+V để dán.'
    },
    {
      type: 'image', title: 'Sao chép đường dẫn thư mục trong Finder',
      src: '/guides/inf1003/macos/hinh-sao-chep-duong-dan-finder-annotated.png',
      alt: 'Ảnh Finder có hai mũi tên đỏ: số 1 chỉ tên bai1 ở cuối thanh đường dẫn để nhấn chuột phải; số 2 chỉ mục Sao chép “bai1” dưới dạng tên đường dẫn.',
      caption: '1 — Nhấn chuột phải vào bai1 ở cuối thanh đường dẫn. 2 — Nhấn chuột trái vào Sao chép “bai1” dưới dạng tên đường dẫn. Quay lại website và Cmd+V vào ô bên dưới. Tên thư mục trong menu sẽ theo thư mục của bạn.',
      fullSizeLink: true
    },
    {
      type: 'note', title: 'Lấy đường dẫn nhanh bằng Terminal (tùy chọn)',
      text: 'Nếu vừa dùng lệnh tạo nhanh ở trên, chạy tiếp lệnh dưới trong chính cửa sổ Terminal đó. Nếu tự tạo thư mục ở nơi khác, mở thư mục có b5 trong Finder, nhấn chuột phải vào tên thư mục cuối thanh đường dẫn rồi chọn Mở trong Terminal hoặc Terminal Mới tại Thư mục. Chạy lệnh bên dưới để copy đường dẫn thư mục hiện tại. Lệnh không hiện kết quả trên màn hình; quay lại ô Đường dẫn thư mục làm việc và nhấn Cmd+V để dán.'
    },
    {
      type: 'code', lang: 'zsh', label: 'Máy local · Terminal · Copy đường dẫn thư mục hiện tại',
      text: 'pwd | pbcopy'
    }
  ],
  expect: [
    'lab1 chứa b5; bên trong b5 có frontend, backend, db và docker-compose.yml.',
    'Lưu đường dẫn đầy đủ như /Users/ten-ban/lab1 vào ô bên dưới. Hai file key sẽ được đặt cạnh b5 ở bước 3.'
  ]
};

function macStep(source) {
  if (source.folderInput) return MAC_FOLDER_STEP;
  const step = { ...source, blocks: source.blocks.map(macBlock) };
  for (const key of ['title', 'goal', 'whereLabel']) {
    if (typeof step[key] === 'string') step[key] = macCopy(step[key]);
  }
  step.expect = source.expect.map(macCopy);

  if (step.id === 'buoc-2') {
    step.blocks = step.blocks.map((block) => block.title === '4. Dán lệnh vào CloudShell và chạy'
      ? { ...block, text: 'Trong AWS Console, click vùng terminal ngay sau dấu nhắc ~ $. Nhấn Cmd+V để dán lệnh vừa copy vào CloudShell rồi Enter nếu lệnh chưa tự chạy. Các thông báo sẽ xuất hiện bên dưới.' }
      : block);
  }
  if (step.id === 'buoc-3') {
    step.blocks = step.blocks.map((block) => {
      if (block.title === '4. Chuyển cả hai key vào lab1') {
        return { ...block, text: 'Mở Finder → Downloads. Giữ Cmd và click bdu-key-fe.pem cùng bdu-key-be.pem để chọn cả hai, nhấn Cmd+C. Mở đúng thư mục đã lưu ở bước 1 (lab1 hoặc tên riêng như bai1 trong ảnh) rồi nhấn Cmd+Option+V để chuyển hai file vào đây. Đặt hai key cạnh b5, không đặt bên trong b5. Giữ nguyên tên file tải từ CloudShell, tránh bản trùng có hậu tố (1).' };
      }
      if (block.src === '/guides/inf1003/hinh-ket-qua-tai-key.png') {
        return {
          ...block,
          src: '/guides/inf1003/macos/hinh-thu-muc-hai-key.jpg',
          alt: 'Finder trên macOS mở thư mục bai1, bên trong có b5 cùng hai file key PEM nằm cạnh nhau.',
          caption: 'Kết quả cần có: b5 và hai key nằm cùng cấp. Ảnh minh họa dùng tên bdu-be-key.pem và bdu-fe-key.pem; trong bài này, tên đúng phải là bdu-key-be.pem và bdu-key-fe.pem để khớp lệnh Terminal. Kiểm tra đủ file rồi bấm Tôi đã hoàn thành · Sang bước 4.'
        };
      }
      return block;
    });
  }
  if (step.id === 'buoc-4') {
    step.blocks = step.blocks.map((block) => {
      if (block.title === '1. Mở một cửa sổ Terminal') {
        return { ...block, text: 'Nhấn Cmd+Space, gõ Terminal rồi nhấn Enter để mở. Giữ cửa sổ này suốt bước 4–6. Dùng Cmd+C để copy và Cmd+V để dán khối lệnh local bên dưới vào Terminal. Website tự vào thư mục đã lưu ở bước 1 và điền địa chỉ kết nối.' };
      }
      if (block.title === '2. Cấp quyền key FE, chép file và đăng nhập') {
        return { ...block, text: 'chmod 400 giới hạn quyền đọc hai key trên Mac trước khi SSH. Sau đó mkdir tạo bdu-web trên FE, scp chép b5 và key BE lên FE, rồi SSH vào FE trong cùng Terminal. Khi được hỏi host lần đầu, kiểm tra đúng IP rồi nhập yes. Các lệnh Linux sau đó chạy trên máy AWS qua SSH; bạn không cần cài Docker trên Mac.' };
      }
      if (block.lang === 'cmd') {
        return {
          ...block, lang: 'zsh',
          text: 'chmod 400 bdu-key-fe.pem bdu-key-be.pem &&\n' + block.text.slice(block.text.indexOf('ssh -i')).replaceAll(' && ^', ' &&')
        };
      }
      if (block.type === 'troubleshoot') {
        return {
          ...block, blocks: [
            { type: 'note', title: 'Khi gặp UNPROTECTED PRIVATE KEY FILE hoặc Bad permissions', text: 'Nếu SSH từ Mac báo key quá mở, chạy chmod bên dưới tại Terminal local, rồi chạy lại khối chép file/SSH. Nếu gặp Permission denied (publickey), kiểm tra user ubuntu và đúng key FE. Nếu báo Operation not permitted, cho phép Terminal truy cập Downloads trong cài đặt Quyền riêng tư & Bảo mật của macOS.' },
            { type: 'code', lang: 'zsh', label: 'Máy local · Terminal · Sửa quyền key', text: 'chmod 400 bdu-key-fe.pem bdu-key-be.pem', localDirectory: true },
            { type: 'note', title: 'Không tìm thấy b5 hoặc file key', text: 'Kiểm tra thư mục đã lưu ở bước 1 có b5, bdu-key-fe.pem và bdu-key-be.pem. Giữ nguyên tên hai key.' }
          ]
        };
      }
      return block;
    });
  }
  if (step.id === 'buoc-6') {
    step.blocks = step.blocks.map((block) => {
      if (block.title === '4. Exit về Terminal local') {
        return { ...block, text: 'Chạy exit một lần để rời FE. Khi thấy dấu nhắc Mac (thường kết thúc bằng %), bạn đã về Terminal local mở từ bước 4. Không mở cửa sổ mới.' };
      }
      if (block.lang === 'cmd') {
        return {
          ...block, lang: 'zsh',
          text: 'curl -fsS "http://{{FE_IP}}:3000/api/health" && echo &&\ncurl -fsS "http://{{FE_IP}}:3000/api/todos" && echo &&\nopen "http://{{FE_IP}}:3000/"'
        };
      }
      return block;
    });
  }
  return step;
}

export const BAI_1_MACOS_LESSON = {
  ...BAI_1_LESSON,
  platform: 'macos',
  summary: 'Dựng web 3 tầng trên AWS với CloudShell và Terminal trên macOS: chép mã nguồn, chạy backend trên BE rồi frontend trên FE.',
  prerequisites: [
    'Tài khoản AWS lab có quyền tạo VPC, EC2 và RDS',
    'macOS Terminal (zsh hoặc bash), có ssh, scp, curl và unzip',
    'AWS CloudShell; chọn vùng AWS ở bước 2 (mặc định Singapore)'
  ],
  steps: BAI_1_LESSON.steps.map(macStep)
};
