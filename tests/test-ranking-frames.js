import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

console.log('🧪 Bắt đầu kiểm thử Hệ Thống Khung Ranking Avatar Top 1-10...');

// 1. Kiểm tra sự tồn tại của đầy đủ các file SVG khung vinh danh theo phạm vi (Trường, Viện, Khoa, Lớp)
const frameFiles = [
  { file: 'public/assets/frames/frame-top-1.svg', name: 'Top 1 Legacy' },
  { file: 'public/assets/frames/frame-top-2.svg', name: 'Top 2 Legacy' },
  { file: 'public/assets/frames/frame-top-3.svg', name: 'Top 3 Legacy' },
  { file: 'public/assets/frames/frame-top-4-5.svg', name: 'Top 4-5 Legacy' },
  { file: 'public/assets/frames/frame-top-6-10.svg', name: 'Top 6-10 Legacy' },
  { file: 'public/assets/frames/frame-truong-top-1.svg', name: 'Toàn Trường Top 1 (Thiên Cực Đế Tinh BDU)' },
  { file: 'public/assets/frames/frame-truong-top-2.svg', name: 'Toàn Trường Top 2 (Song Nguyệt Tinh Vân BDU)' },
  { file: 'public/assets/frames/frame-truong-top-3.svg', name: 'Toàn Trường Top 3 (Tam Tinh Xích Quang BDU)' },
  { file: 'public/assets/frames/frame-truong-top.svg', name: 'Toàn Trường Top 4-10 (Kinh Tuyến Tinh Tú BDU)' },
  { file: 'public/assets/frames/frame-vien-top-1.svg', name: 'Viện Top 1 (Bạch Kim Sapphire Viện Trưởng)' },
  { file: 'public/assets/frames/frame-vien-top.svg', name: 'Viện Top 2-10 (Băng Tinh Lam Vũ Sapphire)' },
  { file: 'public/assets/frames/frame-khoa-top-1.svg', name: 'Khoa Top 1 (Chiến Tướng Khiên Vàng Lục Bảo)' },
  { file: 'public/assets/frames/frame-khoa-top.svg', name: 'Khoa Top 2-10 (Cyber Knight Emerald)' },
  { file: 'public/assets/frames/frame-khoa-th-top-1.svg', name: 'Khoa TH Top 1 (Quantum Compiler Crown)' },
  { file: 'public/assets/frames/frame-khoa-th-top-2.svg', name: 'Khoa TH Top 2 (Dual-Core Synapse)' },
  { file: 'public/assets/frames/frame-khoa-th-top-3.svg', name: 'Khoa TH Top 3 (Ternary Data Stack)' },
  { file: 'public/assets/frames/frame-khoa-th-top-4-10.svg', name: 'Khoa TH Top 4-10 (Protocol Bracket)' },
  { file: 'public/assets/frames/frame-lop-top-1.svg', name: 'Lớp Top 1 (Phượng Hoàng Hoàng Kim Lửa)' },
  { file: 'public/assets/frames/frame-lop-top.svg', name: 'Lớp Top 2-10 (Hoàng Đồng Hổ Phách Nung)' }
];

for (const { file, name } of frameFiles) {
  assert.equal(fs.existsSync(file), true, `File ${file} phải tồn tại`);
  const content = fs.readFileSync(file, 'utf8');
  assert.equal(content.includes('<svg'), true, `${file} phải là file SVG hợp lệ`);
  assert.equal(content.includes('viewBox="0 0 240 240"'), true, `${file} phải có viewBox chuẩn 240x240`);
  console.log(`✅ PASS: Khung ${name} tồn tại và chuẩn định dạng vector SVG động.`);
}

// 2. Kiểm tra HTML index.html
const indexHtml = fs.readFileSync('public/index.html', 'utf8');
assert.equal(indexHtml.includes('cfs-hero-frame-container'), true, 'index.html phải có container chứa khung avatar vinh danh');
assert.equal(indexHtml.includes('cfs-hero-badge'), true, 'index.html phải có badge danh hiệu');
assert.equal(indexHtml.includes('frame-cinematic-layer'), true, 'index.html phải có sân khấu cinematic cho hiệu ứng mở khung');
assert.equal(indexHtml.includes('frame-particle-field'), true, 'index.html phải có lớp particle burst kiểu game');
assert.equal(indexHtml.includes('frame-unlock-announcement'), true, 'index.html phải có title reveal khi mở khóa khung');
assert.equal(indexHtml.includes('frame-signature-fx'), true, 'index.html phải có lớp đạo cụ riêng cho từng opening signature');
assert.equal(indexHtml.includes('14 Sao'), false, 'Không được còn vết tích 14 Sao');
assert.equal(indexHtml.includes('forum-hero-badge-star'), false, 'Không được còn class badge 14 sao cũ');
console.log('✅ PASS: Giao diện index.html đã tích hợp container khung vinh danh và loại bỏ nhãn cũ.');

// 3. Kiểm tra CSS style.css
const styleCss = fs.readFileSync('public/css/style.css', 'utf8');
assert.equal(styleCss.includes('.avatar-frame-overlay'), true, 'CSS phải có class overlay khung SVG');
assert.equal(styleCss.includes('.has-frame-top-1'), true, 'CSS phải có hào quang vinh danh Top 1');
assert.equal(styleCss.includes('.has-frame-top-2'), true, 'CSS phải có hào quang vinh danh Top 2');
assert.equal(styleCss.includes('.has-frame-top-3'), true, 'CSS phải có hào quang vinh danh Top 3');
assert.equal(styleCss.includes('.avatar-hero-rank-badge.tier-top-1'), true, 'CSS phải có ruy băng danh hiệu Top 1');
assert.equal(styleCss.includes('@keyframes frame-title-reveal'), true, 'CSS phải có timeline reveal danh hiệu cinematic');
assert.equal(styleCss.includes('@keyframes frame-particle-burst'), true, 'CSS phải có particle burst khi trang bị khung');
assert.match(styleCss, /\.frame-unlock-announcement\s*\{[\s\S]*?filter:\s*none\s*!important/, 'Chữ cinematic phải luôn nét, không được làm mờ cùng lớp ánh sáng');
assert.match(styleCss, /@media\s*\(min-width:\s*700px\)[\s\S]*?\.frame-unlock-announcement[\s\S]*?left:\s*20%/, 'Desktop phải tách bảng danh hiệu khỏi avatar để không che khuôn mặt');
['constellation-forge', 'binary-eclipse', 'triad-supernova', 'orbit-lock', 'crystal-wings', 'mecha-assemble', 'phoenix-rise', 'runner-up-dual', 'blade-cross', 'elite-pulse'].forEach(effect => {
  assert.equal(styleCss.includes(`frame-effect-${effect}`), true, `CSS phải có opening signature ${effect}`);
});
['th-quantum-compile', 'th-dual-synapse', 'th-ternary-boot', 'th-protocol-lock'].forEach(effect => {
  assert.equal(styleCss.includes(`frame-effect-${effect}`), true, `CSS phải có opening biến hình riêng cho Khoa TH: ${effect}`);
});
assert.equal(styleCss.includes('@keyframes th-quantum-tile-morph'), true, 'Top 1 Khoa TH phải morph compiler tile');
assert.equal(styleCss.includes('@keyframes th-dual-bracket-morph'), true, 'Top 2 Khoa TH phải morph dual bracket');
assert.equal(styleCss.includes('@keyframes th-ternary-pylon-boot'), true, 'Top 3 Khoa TH phải dựng ba data pylon');
assert.equal(styleCss.includes('@keyframes th-protocol-node-lock'), true, 'Top 4-10 Khoa TH phải dùng protocol lock');
['gojo-limitless-awaken', 'itachi-crow-genjutsu'].forEach(effect => {
  assert.equal(styleCss.includes(`frame-effect-${effect}`), true, `Anime frame phải có motion grammar độc lập: ${effect}`);
});
assert.equal(styleCss.includes('@keyframes gojo-distance-halving'), true, 'Gojo phải biến hình bằng cơ chế chia đôi khoảng cách');
assert.equal(styleCss.includes('@keyframes gojo-six-eye-awaken'), true, 'Gojo phải có bước khai mở Lục Nhãn');
assert.equal(styleCss.includes('@keyframes itachi-crow-ink-assemble'), true, 'Itachi phải tụ hình từ mực quạ');
assert.equal(styleCss.includes('@keyframes itachi-mangekyo-aperture'), true, 'Itachi phải mở khẩu độ Mangekyo');
console.log('✅ PASS: Bảng mã phong cách CSS đã sẵn sàng hiệu ứng hào quang động & ruy băng.');

// 4. Kiểm tra logic xử lý trong app.js
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
assert.equal(appJs.includes('getAcademicAvatarFrame'), true, 'app.js phải chứa hàm logic xác định khung getAcademicAvatarFrame');
assert.equal(appJs.includes('prepareFrameCinematic'), true, 'app.js phải dựng theme và particle riêng theo từng phạm vi xếp hạng');
assert.equal(appJs.includes('prefers-reduced-motion: reduce'), true, 'Hiệu ứng phải tôn trọng cài đặt giảm chuyển động');
assert.match(appJs, /scopeCode\s*===\s*'truong'[\s\S]*?'constellation-forge'[\s\S]*?'binary-eclipse'[\s\S]*?'triad-supernova'[\s\S]*?'orbit-lock'/, 'Top 1, 2, 3 Toàn Trường phải có opening riêng; Top 4-10 dùng chung orbit-lock');
assert.match(appJs, /r\s*===\s*2[\s\S]*?frame-truong-top-2\.svg[\s\S]*?r\s*===\s*3[\s\S]*?frame-truong-top-3\.svg/, 'Top 2 và Top 3 Toàn Trường phải dùng hai SVG độc lập');
assert.match(appJs, /r\s*===\s*2\s*\?\s*'runner-up-dual'/, 'Top 2 phải có opening Á quân riêng');
assert.match(appJs, /r\s*===\s*3\s*\?\s*'blade-cross'/, 'Top 3 phải có opening song đao riêng');
assert.match(appJs, /:\s*'elite-pulse'\)\)/, 'Top 4-10 phải dùng chung opening Elite');
assert.equal(appJs.includes('getPreviewRank'), true, 'Preview khung phải giữ đúng hạng thật để Top 2 và Top 3 chạy đúng signature');
assert.match(appJs, /normalizeFacultyCode[\s\S]*?ma_khoa[\s\S]*?===\s*'TH'/, 'Bộ frame Khoa TH phải được cô lập bằng đúng mã khoa TH');
assert.match(appJs, /frame-khoa-th-top-1\.svg[\s\S]*?frame-khoa-th-top-2\.svg[\s\S]*?frame-khoa-th-top-3\.svg[\s\S]*?frame-khoa-th-top-4-10\.svg/, 'Top 1, 2, 3 và 4-10 Khoa TH phải dùng bốn SVG độc lập');
assert.match(appJs, /th-quantum-compile[\s\S]*?th-dual-synapse[\s\S]*?th-ternary-boot[\s\S]*?th-protocol-lock/, 'Mỗi tier Khoa TH phải có opening biến hình riêng');
assert.doesNotMatch(appJs, /FULL_FRAME_PREVIEW_MSSV|ANIME_FRAME_ACCESS_MSSV/, 'MSSV đặc biệt không được hard-code trong frontend');
assert.match(appJs, /identityPresentation\?\.frame_access[\s\S]*?\.all/, 'Quyền toàn bộ khung phải lấy từ presentation phía server');
const entitlementsMigration = fs.readFileSync('migrations/016_community_identity_entitlements.sql', 'utf8');
assert.match(entitlementsMigration, /\('24050126',\s*'capability:frame-preview-all'/, 'MSSV 24050126 phải được chuyển vào entitlement server');
assert.match(appJs, /'anime-gojo':\s*\{\s*unlocked:\s*false[\s\S]*?'anime-itachi':\s*\{\s*unlocked:\s*false/, 'Gojo và Itachi phải khóa mặc định với mọi tài khoản');
assert.match(appJs, /previewTier === 'anime-gojo' \|\| previewTier === 'anime-itachi'[\s\S]*?hasFullFramePreviewAccess\(\)/, 'Chỉ tài khoản sở hữu toàn bộ khung mới được render Gojo/Itachi từ localStorage');
assert.match(appJs, /window\.selectAvatarFramePreview[\s\S]*?access\.unlocked[\s\S]*?return;/, 'Không được gọi hàm trực tiếp để vượt khóa khung');
assert.match(appJs, /storedEquipped[\s\S]*?unlocked[\s\S]*?:\s*'real'/, 'Khung đã lưu nhưng không còn quyền phải tự rơi về chế độ thành tích thật');
assert.equal(appJs.includes('(14 Sao) ⭐'), false, 'app.js không được gán text (14 Sao) ⭐');
const animeAuthorizedMssvs = ['21050008', '21050011', '21050044', '22050068', '22050090', '22050101'];
animeAuthorizedMssvs.forEach(mssv => {
  assert.match(entitlementsMigration, new RegExp(`'${mssv}',\\s*'frame:anime-gojo'`), `MSSV ${mssv} phải có grant khung anime phía server`);
});
assert.match(appJs, /function hasAnimeFrameAccess[\s\S]*?frame_access[\s\S]*?anime-gojo/, 'Khung anime phải lấy quyền từ entitlement server');
assert.equal(appJs.includes('chibi-gojo-signature.png'), true, 'Khung Gojo phải gắn asset chibi riêng');
assert.equal(appJs.includes('chibi-itachi-signature.png'), true, 'Khung Itachi phải gắn asset chibi riêng');

const animeAssets = [
  'public/assets/images/chibi-gojo-signature.png',
  'public/assets/images/chibi-itachi-signature.png',
  'public/assets/images/frame-gojo-limitless-art.png',
  'public/assets/images/frame-itachi-genjutsu-art.png',
  'public/assets/images/gojo-six-eyes-awakening.png',
  'public/assets/images/itachi-sharingan-awakening.png',
  'public/assets/images/gojo-six-eyes-closed-v2.png',
  'public/assets/images/gojo-six-eyes-half-v2.png',
  'public/assets/images/itachi-sharingan-closed-v2.png',
  'public/assets/images/itachi-sharingan-half-v2.png'
];
animeAssets.forEach(file => {
  assert.equal(fs.existsSync(file), true, `${file} phải tồn tại`);
  const png = fs.readFileSync(file);
  assert.equal(png.subarray(1, 4).toString(), 'PNG', `${file} phải là PNG thật`);
  assert.equal(png[25], 6, `${file} phải là PNG RGBA có kênh alpha`);
});

assert.equal(appJs.includes('anime-frame-art-stack'), true, 'Anime frame phải được tách thành stack nhiều mảnh để dựng hình');
assert.equal(styleCss.includes('@keyframes gojo-glass-piece-converge'), true, 'Gojo phải ráp khung bằng ba lát kính khúc xạ');
assert.equal(styleCss.includes('@keyframes itachi-ink-piece-form'), true, 'Itachi phải tụ khung bằng ba mảng mực/quạ/Susanoo');
assert.equal(/frame-anime-(gojo|itachi)\.svg/.test(appJs), false, 'Renderer không được quay lại dùng hai SVG anime hình học cũ');
assert.equal(appJs.includes('anime-awakening-stage'), true, 'Renderer phải có sân khấu cận cảnh khai nhãn');
assert.equal(styleCss.includes('@keyframes gojo-six-eyes-open'), true, 'Gojo phải có timeline hé mở Lục Nhãn');
assert.equal(styleCss.includes('@keyframes itachi-sharingan-open'), true, 'Itachi phải có timeline hé mở Sharingan');
assert.equal(styleCss.includes('@keyframes anime-cinematic-steady-focus'), true, 'Cinematic anime phải giữ camera ổn định, không tái dùng shake');
['anime-eye-state-closed', 'anime-eye-state-half', 'anime-eye-state-open'].forEach(state => {
  assert.equal(appJs.includes(state), true, `Renderer khai nhãn phải có ảnh trạng thái thật: ${state}`);
});
assert.equal(styleCss.includes('@keyframes gojo-eye-state-closed'), true, 'Gojo phải bắt đầu bằng asset mắt nhắm thật');
assert.equal(styleCss.includes('@keyframes gojo-eye-state-half'), true, 'Gojo phải đi qua asset hé mắt thật');
assert.equal(styleCss.includes('@keyframes itachi-eye-state-closed'), true, 'Itachi phải bắt đầu bằng asset mắt nhắm thật');
assert.equal(styleCss.includes('@keyframes itachi-eye-state-half'), true, 'Itachi phải đi qua asset hé mắt thật');
assert.match(styleCss, /\.forum-hero-avatar-wrap\.has-frame-anime-itachi \.anime-frame-art\s*\{[\s\S]*?left:\s*calc\(50% - 13px\)[\s\S]*?top:\s*calc\(50% - 11px\)[\s\S]*?width:\s*244%/, 'Artwork Itachi phải bù đúng tâm aperture về avatar');
assert.match(styleCss, /@keyframes itachi-awakening-stage\s*\{[\s\S]*?0%\s*\{\s*transform:\s*translate\(-50%, -50%\)[\s\S]*?100%\s*\{\s*transform:\s*translate\(-50%, -50%\)/, 'Cinematic Itachi phải khóa tâm trong toàn bộ quá trình zoom');

const thFrameFiles = [
  'public/assets/frames/frame-khoa-th-top-1.svg',
  'public/assets/frames/frame-khoa-th-top-2.svg',
  'public/assets/frames/frame-khoa-th-top-3.svg',
  'public/assets/frames/frame-khoa-th-top-4-10.svg'
];
const thFrames = thFrameFiles.map(file => fs.readFileSync(file, 'utf8'));
assert.equal(new Set(thFrames).size, 4, 'Bốn tier Khoa TH phải là bốn thiết kế thật sự khác nhau');
thFrames.forEach((svg, index) => {
  assert.equal(/animateTransform|rotate\s*\(/i.test(svg), false, `${thFrameFiles[index]} không được dùng hoạt họa xoay`);
  assert.equal(/mecha|sword|blade|emerald|dragon|wing/i.test(svg), false, `${thFrameFiles[index]} không được tái sử dụng ngôn ngữ frame cũ`);
  assert.equal(svg.includes('<animate'), true, `${thFrameFiles[index]} phải có hoạt họa vector nội tại`);
});
assert.equal(thFrames.slice(0, 3).every(svg => svg.includes('attributeName="d"')), true, 'Top 1-3 Khoa TH phải morph path SVG thật');

const schoolChampionSvg = fs.readFileSync('public/assets/frames/frame-truong-top-1.svg', 'utf8');
const schoolRunnerUpSvg = fs.readFileSync('public/assets/frames/frame-truong-top-2.svg', 'utf8');
const schoolThirdSvg = fs.readFileSync('public/assets/frames/frame-truong-top-3.svg', 'utf8');
const schoolTopSvg = fs.readFileSync('public/assets/frames/frame-truong-top.svg', 'utf8');
assert.equal(/dragon|crown|wing|hoàng kim|vương miện/i.test(`${schoolChampionSvg}${schoolRunnerUpSvg}${schoolThirdSvg}${schoolTopSvg}`), false, 'Khung Toàn Trường mới không được tái dùng ngôn ngữ cũ');
assert.equal(schoolChampionSvg.includes('astral-metal'), true, 'Top 1 Toàn Trường phải dùng hệ Tinh Đồ mới');
assert.equal(schoolChampionSvg.includes('BDU #1'), true, 'Nhãn trực tiếp trên khung Top 1 Toàn Trường phải là BDU #1');
assert.equal(schoolRunnerUpSvg.includes('BDU #2'), true, 'Nhãn trực tiếp trên khung Top 2 Toàn Trường phải là BDU #2');
assert.equal(schoolThirdSvg.includes('BDU #3'), true, 'Nhãn trực tiếp trên khung Top 3 Toàn Trường phải là BDU #3');
assert.equal(schoolRunnerUpSvg.includes('eclipse-silver'), true, 'Top 2 Toàn Trường phải dùng hệ Song Nguyệt riêng');
assert.equal(schoolThirdSvg.includes('triad-metal'), true, 'Top 3 Toàn Trường phải dùng hệ Tam Tinh riêng');
assert.equal(schoolTopSvg.includes('meridian-metal'), true, 'Top 4-10 Toàn Trường phải dùng chung hệ Kinh Tuyến');
assert.match(styleCss, /#cfs-hero-avatar-wrap\[class\*="has-frame-scope-"\]\s*~\s*\.forum-hero-username\s*\{[\s\S]*?margin-top:\s*62px/, 'Tên sinh viên phải chừa đủ khoảng trống cho phần đáy của mọi khung desktop');
assert.match(styleCss, /\.forum-hero-username \+ \.identity-title-hero\s*\{[\s\S]*?margin:\s*9px auto 0[\s\S]*?\.forum-hero-sub\s*\{[\s\S]*?margin:\s*9px auto 0/, 'Tên, name tag và thuộc tính phải có nhịp dọc đồng đều 9px');
assert.match(styleCss, /\.frame-cinematic-active \.forum-hero-username,\s*\.frame-cinematic-active \.identity-title-hero,\s*\.frame-cinematic-active \.forum-hero-sub/, 'Tên, ba name tag và thuộc tính sinh viên phải ẩn/hiện cùng một timeline cinematic');
assert.match(styleCss, /@media\s*\(min-width:\s*700px\)[\s\S]*?\.frame-unlock-announcement\.is-persistent\s*\{[\s\S]*?opacity:\s*1/, 'Bảng danh hiệu phải được giữ thường trực ở vùng trống bên trái trên desktop');
assert.match(styleCss, /@keyframes frame-title-reveal-side\s*\{[\s\S]*?0%\s*\{\s*opacity:\s*1[\s\S]*?100%\s*\{\s*opacity:\s*1/, 'Bảng danh hiệu desktop không được biến mất trước hoặc sau opening');
assert.match(appJs, /announcement\?\.classList\.add\('is-persistent'\)/, 'Khi có frame phải đánh dấu bảng danh hiệu ở trạng thái thường trực');

// 5. Kiểm thử runtime trong VM: quyền khung đến từ presentation server
const sandbox = {
  console,
  document: {
    addEventListener() {},
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; }
  },
  window: {},
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  setTimeout,
  clearTimeout,
  setInterval() {},
  clearInterval() {},
  EventSource: class {},
  CustomEvent: class {},
  URL,
  Blob
};
vm.createContext(sandbox);
vm.runInContext(appJs, sandbox);

vm.runInContext(`
  const authorized = ['21050008', '21050011', '21050044', '22050068', '22050090', '22050101'];
  authorized.forEach(mssv => {
    AppState.user = { mssv };
    AppState.identityPresentation = { frame_access: { all: false, keys: ['anime-gojo', 'anime-itachi'] } };
    const unlocked = getStudentAcademicUnlockedFrames();
    if (!unlocked['anime-gojo']?.unlocked) throw new Error(mssv + ' phải được mở khóa khung Gojo');
    if (!unlocked['anime-itachi']?.unlocked) throw new Error(mssv + ' phải được mở khóa khung Itachi');
    if (unlocked['truong-1']?.unlocked) throw new Error(mssv + ' không được tự động mở Top 1 Toàn Trường nếu không đạt thứ hạng');

    AppState.confession.framePreview = 'anime-gojo';
    const gojoFrame = getAcademicAvatarFrame(null);
    if (!gojoFrame || gojoFrame.tier !== 'anime-gojo') throw new Error(mssv + ' không render được khung Gojo');
    if (gojoFrame.scopeUpper !== 'THIÊN THƯỢNG THIÊN HẠ') throw new Error('scopeUpper của Gojo phải là THIÊN THƯỢNG THIÊN HẠ');
    if (gojoFrame.rankLabel !== '#tochancauduockhong') throw new Error('rankLabel của Gojo phải là #tochancauduockhong');

    AppState.confession.framePreview = 'anime-itachi';
    const itachiFrame = getAcademicAvatarFrame(null);
    if (!itachiFrame || itachiFrame.tier !== 'anime-itachi') throw new Error(mssv + ' không render được khung Itachi');
  });

  AppState.user = { mssv: '24050126' };
  AppState.identityPresentation = { frame_access: { all: true, keys: [] } };
  if (!getStudentAcademicUnlockedFrames()['anime-gojo']?.unlocked) throw new Error('24050126 phải có quyền toàn bộ khung');

  // Kiểm tra tài khoản bình thường không được tự ý mở khung Anime
  AppState.user = { mssv: '22050001' };
  AppState.identityPresentation = { frame_access: { all: false, keys: [] } };
  const unAuth = getStudentAcademicUnlockedFrames();
  if (unAuth['anime-gojo']?.unlocked) throw new Error('22050001 không được tự động mở khung Gojo');
  if (unAuth['anime-itachi']?.unlocked) throw new Error('22050001 không được tự động mở khung Itachi');
  AppState.confession.framePreview = 'anime-gojo';
  if (getAcademicAvatarFrame(null) !== null) throw new Error('22050001 không được phép hiển thị khung Gojo khi chưa được cấp quyền');
`, sandbox);
console.log('✅ PASS: Đã xác minh runtime mở khóa thành công khung Gojo & Itachi cho 21050008, 21050011, 21050044, 22050068, 22050090, 22050101.');

console.log('✅ PASS: Logic app.js điều phối khung học thuật dựa trên thứ hạng thực tế.');

console.log('🎉 TẤT CẢ KIỂM THỬ BỘ ASSET KHUNG RANKING ĐẠT ĐIỂM TUYỆT ĐỐI!');
