import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { IdentityPresentationInternals } from '../src/services/identity-presentation.service.js';
import { isCourseFailed } from '../src/services/learning.service.js';

// 1. Kiểm tra cấu hình identity-items.json
const itemsJson = JSON.parse(fs.readFileSync('src/config/identity-items.json', 'utf8'));
const ttcdsItem = itemsJson.find((i) => i.id === 'title:ttcds');
const chatgptItem = itemsJson.find((i) => i.id === 'title:chatgpt');
const doanItem = itemsJson.find((i) => i.id === 'title:pho-bi-thu-doan');
const namVuongItem = itemsJson.find((i) => i.id === 'title:nam-vuong');
const daicaItem = itemsJson.find((i) => i.id === 'title:dai-ca');
const tienboiItem = itemsJson.find((i) => i.id === 'title:tien-boi');
const devItem = itemsJson.find((i) => i.id === 'title:dev');
const khongDoiThuItem = itemsJson.find((i) => i.id === 'title:khong-doi-thu');
const hocTaiThiPhanItem = itemsJson.find((i) => i.id === 'title:hoc-tai-thi-phan');

// TTCDS giữ lại phong cách cũ (vip)
assert.ok(ttcdsItem, 'identity-items.json phải có title:ttcds');
assert.equal(ttcdsItem.label, '#TTCDS');
assert.equal(ttcdsItem.rarity, 'vip', '#TTCDS phải giữ nguyên phong cách (vip)');

// 3 danh hiệu còn lại mỗi cái 1 phong cách riêng biệt
assert.ok(chatgptItem, 'identity-items.json phải có title:chatgpt');
assert.equal(chatgptItem.label, '#ChatGPT');
assert.equal(chatgptItem.description, 'không biết thì hỏi AI');
assert.equal(chatgptItem.rarity, 'ai', '#ChatGPT có phong cách riêng biệt: ai');
assert.equal(chatgptItem.asset_key, 'chatgpt');
assert.equal(chatgptItem.metadata?.manual_grantable, true);

assert.ok(doanItem, 'identity-items.json phải có title:pho-bi-thu-doan');
assert.equal(doanItem.label, '#Phó bí thư đoàn');
assert.equal(doanItem.description, 'Phó bí thư đoàn trường');
assert.equal(doanItem.rarity, 'youth', '#Phó bí thư đoàn có phong cách riêng biệt: youth');
assert.equal(doanItem.asset_key, 'pho-bi-thu-doan');
assert.equal(doanItem.metadata?.manual_grantable, true);

assert.ok(namVuongItem, 'identity-items.json phải có title:nam-vuong');
assert.equal(namVuongItem.label, '#Nam vương');
assert.equal(namVuongItem.description, 'đẹp trai có gì sai');
assert.equal(namVuongItem.rarity, 'charm', '#Nam vương có phong cách riêng biệt: charm');
assert.equal(namVuongItem.metadata?.manual_grantable, true);

assert.ok(daicaItem, 'identity-items.json phải có title:dai-ca');
assert.equal(daicaItem.label, '#Đại ca');
assert.equal(daicaItem.rarity, 'epic');

assert.ok(tienboiItem, 'identity-items.json phải có title:tien-boi');
assert.equal(tienboiItem.label, '#Tiền bối');
assert.equal(tienboiItem.rarity, 'rare');

assert.ok(devItem, 'identity-items.json phải có title:dev');
assert.equal(devItem.label, '#Dev');
assert.equal(devItem.rarity, 'epic');

assert.ok(khongDoiThuItem, 'identity-items.json phải có title:khong-doi-thu');
assert.equal(khongDoiThuItem.label, '#Không đối thủ');
assert.equal(khongDoiThuItem.description, 'Top 1 toàn trường BDU');
assert.equal(khongDoiThuItem.rarity, 'legendary');

assert.ok(hocTaiThiPhanItem, 'identity-items.json phải có title:hoc-tai-thi-phan');
assert.equal(hocTaiThiPhanItem.label, '#Học tài thi phận');
assert.equal(hocTaiThiPhanItem.description, 'Dành cho sinh viên có môn học bị rớt');
assert.equal(hocTaiThiPhanItem.rarity, 'rare');

// 2. Kiểm tra migration 020, 021 và 022
const migrationSql020 = fs.readFileSync('migrations/020_new_identity_titles.sql', 'utf8');
assert.match(migrationSql020, /title:chatgpt/);
assert.match(migrationSql020, /title:pho-bi-thu-doan/);

const migrationSql021 = fs.readFileSync('migrations/021_top1_namvuong_and_failed_course_titles.sql', 'utf8');
assert.match(migrationSql021, /has_failed_course/);
assert.match(migrationSql021, /title:khong-doi-thu/);
assert.match(migrationSql021, /title:nam-vuong/);
assert.match(migrationSql021, /title:hoc-tai-thi-phan/);

const migrationSql022 = fs.readFileSync('migrations/022_separate_title_styles_and_rarities.sql', 'utf8');
assert.match(migrationSql022, /youth/);
assert.match(migrationSql022, /ai/);
assert.match(migrationSql022, /charm/);

// 3. Kiểm tra logic helper isCourseFailed
assert.equal(isCourseFailed({ ket_qua: 'Không đạt' }), true);
assert.equal(isCourseFailed({ dat_hp: 'rớt môn' }), true);
assert.equal(isCourseFailed({ diem_chu: 'F' }), true);
assert.equal(isCourseFailed({ diem_chu: 'F+' }), true);
assert.equal(isCourseFailed({ diem_chu: 'I' }), true);
assert.equal(isCourseFailed({ diem_4: 0.5 }), true);
assert.equal(isCourseFailed({ diem_10: 3.5 }), true);
assert.equal(isCourseFailed({ diem_chu: 'A', ket_qua: 'Đạt', diem_4: 3.8, diem_10: 8.5 }), false);

// 4. Kiểm tra logic phân bổ tự động trong buildTitleCatalog
// Top 1 toàn trường (#Không đối thủ)
const studentTop1 = IdentityPresentationInternals.buildTitleCatalog({
  mssv: '23010001',
  rankings: {
    tong_hop: { truong: { hang: 1 } }
  }
});
const titlesTop1 = studentTop1.map((t) => t.id);
assert.ok(titlesTop1.includes('title:khong-doi-thu'), 'Top 1 toàn trường phải nhận danh hiệu #Không đối thủ');

// Sinh viên có môn bị rớt (#Học tài thi phận)
const studentFailedCourse = IdentityPresentationInternals.buildTitleCatalog({
  mssv: '24050055',
  has_failed_course: true
});
const titlesFailed = studentFailedCourse.map((t) => t.id);
assert.ok(titlesFailed.includes('title:hoc-tai-thi-phan'), 'Sinh viên có môn rớt phải nhận #Học tài thi phận');

// Manual grants: 4 danh hiệu với 4 phong cách riêng biệt
const studentManualGrants = IdentityPresentationInternals.buildTitleCatalog({
  mssv: '24050126',
  manual_entitlements: [
    {
      id: 'title:ttcds',
      item_type: 'title',
      label: '#TTCDS',
      description: 'Trung tâm Chuyển đổi số BDU',
      rarity: 'vip',
      asset_key: 'ttcds',
      metadata: { tone: 'cyan' }
    },
    {
      id: 'title:chatgpt',
      item_type: 'title',
      label: '#ChatGPT',
      description: 'không biết thì hỏi AI',
      rarity: 'ai',
      asset_key: 'chatgpt',
      metadata: { tone: 'chatgpt' }
    },
    {
      id: 'title:pho-bi-thu-doan',
      item_type: 'title',
      label: '#Phó bí thư đoàn',
      description: 'Phó bí thư đoàn trường',
      rarity: 'youth',
      asset_key: 'pho-bi-thu-doan',
      metadata: { tone: 'youth' }
    },
    {
      id: 'title:nam-vuong',
      item_type: 'title',
      label: '#Nam vương',
      description: 'đẹp trai có gì sai',
      rarity: 'charm',
      asset_key: 'nam-vuong',
      metadata: { tone: 'charm' }
    }
  ]
});
const titlesManual = studentManualGrants.map((t) => t.id);
assert.ok(titlesManual.includes('title:ttcds'), 'Phải nạp #TTCDS (phong cách vip)');
assert.ok(titlesManual.includes('title:chatgpt'), 'Phải nạp #ChatGPT (phong cách ai)');
assert.ok(titlesManual.includes('title:pho-bi-thu-doan'), 'Phải nạp #Phó bí thư đoàn (phong cách youth)');
assert.ok(titlesManual.includes('title:nam-vuong'), 'Phải nạp #Nam vương (phong cách charm)');

const ttcdsObj = studentManualGrants.find((t) => t.id === 'title:ttcds');
const chatgptObj = studentManualGrants.find((t) => t.id === 'title:chatgpt');
const doanObj = studentManualGrants.find((t) => t.id === 'title:pho-bi-thu-doan');
const namVuongObj = studentManualGrants.find((t) => t.id === 'title:nam-vuong');

assert.equal(ttcdsObj.rarity, 'vip', 'TTCDS giữ nguyên phong cách vip');
assert.equal(chatgptObj.rarity, 'ai', 'ChatGPT phong cách ai');
assert.equal(doanObj.rarity, 'youth', 'Phó bí thư đoàn phong cách youth');
assert.equal(namVuongObj.rarity, 'charm', 'Nam vương phong cách charm');
assert.equal(namVuongObj.detail, 'đẹp trai có gì sai');

// 5. Kiểm tra renderIdentityTitleBadges trong public/js/app.js
const appJs = fs.readFileSync('public/js/app.js', 'utf8');
const sandbox = {
  console,
  document: { addEventListener() {} },
  window: {},
  localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  sessionStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
  setTimeout, clearTimeout, setInterval() {}, clearInterval() {},
  URL, Blob, EventSource: class {}, CustomEvent: class {}
};
vm.createContext(sandbox);
vm.runInContext(appJs, sandbox);

const renderedBadges = sandbox.renderIdentityTitleBadges([
  { id: 'title:ttcds', label: '#TTCDS', detail: 'Trung tâm Chuyển đổi số', tone: 'cyan', rarity: 'vip', asset_key: 'ttcds' },
  { id: 'title:chatgpt', label: '#ChatGPT', detail: 'không biết thì hỏi AI', tone: 'chatgpt', rarity: 'ai', asset_key: 'chatgpt' },
  { id: 'title:pho-bi-thu-doan', label: '#Phó bí thư đoàn', detail: 'Phó bí thư đoàn trường', tone: 'youth', rarity: 'youth', asset_key: 'pho-bi-thu-doan' }
]);

assert.match(renderedBadges, /title-ttcds/, 'Badge #TTCDS có class title-ttcds');
assert.match(renderedBadges, /rarity-vip/, 'Badge #TTCDS có class rarity-vip');

assert.match(renderedBadges, /identity-title-icon-chatgpt/, 'Badge #ChatGPT có icon svg chatgpt');
assert.match(renderedBadges, /title-chatgpt/, 'Badge #ChatGPT có class title-chatgpt');
assert.match(renderedBadges, /rarity-ai/, 'Badge #ChatGPT có class rarity-ai');

assert.match(renderedBadges, /identity-title-icon-youth/, 'Badge #Phó bí thư đoàn có icon đoàn thanh niên');
assert.match(renderedBadges, /★/, 'Badge #Phó bí thư đoàn có biểu tượng ngôi sao');
assert.match(renderedBadges, /title-pho-bi-thu-doan/, 'Badge #Phó bí thư đoàn có class title-pho-bi-thu-doan');
assert.match(renderedBadges, /rarity-youth/, 'Badge #Phó bí thư đoàn có class rarity-youth');

const renderedBadges2 = sandbox.renderIdentityTitleBadges([
  { id: 'title:nam-vuong', label: '#Nam vương', detail: 'đẹp trai có gì sai', tone: 'charm', rarity: 'charm', asset_key: 'nam-vuong' },
  { id: 'title:khong-doi-thu', label: '#Không đối thủ', detail: 'Top 1 toàn trường', tone: 'gold', rarity: 'legendary', asset_key: 'khong-doi-thu' },
  { id: 'title:hoc-tai-thi-phan', label: '#Học tài thi phận', detail: 'Dành cho sinh viên có môn học bị rớt', tone: 'bronze', rarity: 'rare', asset_key: 'hoc-tai-thi-phan' }
]);

assert.match(renderedBadges2, /identity-title-icon-namvuong/, 'Badge #Nam vương có icon vương miện');
assert.match(renderedBadges2, /👑/, 'Badge #Nam vương có biểu tượng vương miện');
assert.match(renderedBadges2, /title-nam-vuong/, 'Badge #Nam vương có class title-nam-vuong');
assert.match(renderedBadges2, /rarity-charm/, 'Badge #Nam vương có class rarity-charm');

// 7. Kiểm tra giới hạn 4 danh hiệu
assert.equal(IdentityPresentationInternals.MAX_DISPLAYED_TITLES, 4, 'Giới hạn danh hiệu hiển thị phải là 4');

// 8. Kiểm tra migration 023 và identity-items.json có 7 danh hiệu mới
const migrationSql023 = fs.readFileSync('migrations/023_gpa_and_new_achievement_titles.sql', 'utf8');
assert.match(migrationSql023, /title:hoc-than/);
assert.match(migrationSql023, /title:tinh-hoa-bdu/);
assert.match(migrationSql023, /title:bat-bai-mon-phai/);
assert.match(migrationSql023, /title:con-nha-nguoi-ta/);
assert.match(migrationSql023, /title:tho-san-tin-chi/);
assert.match(migrationSql023, /title:cu-dem-luyen-thi/);
assert.match(migrationSql023, /title:tay-to-ganh-team/);

const hocThanItem = itemsJson.find((i) => i.id === 'title:hoc-than');
const tinhHoaItem = itemsJson.find((i) => i.id === 'title:tinh-hoa-bdu');
const batBaiItem = itemsJson.find((i) => i.id === 'title:bat-bai-mon-phai');
const conNhaItem = itemsJson.find((i) => i.id === 'title:con-nha-nguoi-ta');
const thoSanItem = itemsJson.find((i) => i.id === 'title:tho-san-tin-chi');
const cuDemItem = itemsJson.find((i) => i.id === 'title:cu-dem-luyen-thi');
const tayToItem = itemsJson.find((i) => i.id === 'title:tay-to-ganh-team');

assert.ok(hocThanItem && hocThanItem.rarity === 'legendary');
assert.ok(tinhHoaItem && tinhHoaItem.rarity === 'epic');
assert.ok(batBaiItem && batBaiItem.rarity === 'epic');
assert.ok(conNhaItem && conNhaItem.rarity === 'legendary');
assert.ok(thoSanItem && thoSanItem.rarity === 'epic');
assert.ok(cuDemItem && cuDemItem.rarity === 'rare');
assert.ok(tayToItem && tayToItem.rarity === 'rare');

// 9. Kiểm tra logic auto-unlock cho cả 7 danh hiệu
// GPA >= 3.6 -> #Học thần & #Tinh hoa BDU
const studentHighGpa = IdentityPresentationInternals.buildTitleCatalog({
  mssv: '24050100',
  cumulative_gpa_4: 3.75,
  cumulative_earned_credits: 85,
  has_failed_course: false,
  has_perfect_semester: true,
  has_heavy_semester: true,
  clans: [{ id: 1, name: 'CLB Dev', tag: 'DEV', role: 'leader' }]
});
const highGpaTitles = studentHighGpa.map((t) => t.id);
assert.ok(highGpaTitles.includes('title:hoc-than'), 'GPA 3.75 phải nhận #Học thần');
assert.ok(highGpaTitles.includes('title:tinh-hoa-bdu'), 'GPA 3.75 phải nhận #Tinh hoa BDU');
assert.ok(highGpaTitles.includes('title:bat-bai-mon-phai'), 'Tích lũy 85 tín chỉ chưa rớt môn phải nhận #Bất bại môn phái');
assert.ok(highGpaTitles.includes('title:tho-san-tin-chi'), 'Tích lũy 85 tín chỉ phải nhận #Thợ săn tín chỉ');
assert.ok(highGpaTitles.includes('title:con-nha-nguoi-ta'), 'Học kỳ GPA 4.0 phải nhận #Con nhà người ta');
assert.ok(highGpaTitles.includes('title:cu-dem-luyen-thi'), 'Học kỳ >= 18 tín chỉ GPA >= 3.0 phải nhận #Cú đêm luyện thi');
assert.ok(highGpaTitles.includes('title:tay-to-ganh-team'), 'Có clan phải nhận #Tay to gánh team');

// Sinh viên GPA 3.3, rớt môn, 40 tín chỉ
const studentMidGpa = IdentityPresentationInternals.buildTitleCatalog({
  mssv: '24050200',
  cumulative_gpa_4: 3.30,
  cumulative_earned_credits: 40,
  has_failed_course: true,
  has_community_contribution: true
});
const midGpaTitles = studentMidGpa.map((t) => t.id);
assert.equal(midGpaTitles.includes('title:hoc-than'), false, 'GPA 3.30 không được nhận #Học thần');
assert.ok(midGpaTitles.includes('title:tinh-hoa-bdu'), 'GPA 3.30 phải nhận #Tinh hoa BDU');
assert.equal(midGpaTitles.includes('title:bat-bai-mon-phai'), false, 'Rớt môn không được nhận #Bất bại môn phái');
assert.equal(midGpaTitles.includes('title:tho-san-tin-chi'), false, '40 tín chỉ chưa đạt #Thợ săn tín chỉ');
assert.ok(midGpaTitles.includes('title:hoc-tai-thi-phan'), 'Rớt môn phải nhận #Học tài thi phận');
assert.ok(midGpaTitles.includes('title:tay-to-ganh-team'), 'Có đóng góp tài liệu phải nhận #Tay to gánh team');

// 10. Kiểm tra render badges hiển thị đủ 4 danh hiệu và icons
const fourBadges = sandbox.renderIdentityTitleBadges([
  { id: 'title:hoc-than', label: '#Học thần', detail: 'GPA 3.6+', tone: 'gold', rarity: 'legendary', asset_key: 'hoc-than' },
  { id: 'title:tinh-hoa-bdu', label: '#Tinh hoa BDU', detail: 'GPA 3.2+', tone: 'emerald', rarity: 'epic', asset_key: 'tinh-hoa-bdu' },
  { id: 'title:bat-bai-mon-phai', label: '#Bất bại môn phái', detail: 'Bất bại', tone: 'gold', rarity: 'epic', asset_key: 'bat-bai-mon-phai' },
  { id: 'title:con-nha-nguoi-ta', label: '#Con nhà người ta', detail: 'GPA 4.0', tone: 'violet', rarity: 'legendary', asset_key: 'con-nha-nguoi-ta' },
  { id: 'title:tho-san-tin-chi', label: '#Thợ săn tín chỉ', detail: '80+ tín chỉ', tone: 'blue', rarity: 'epic', asset_key: 'tho-san-tin-chi' },
  { id: 'title:cu-dem-luyen-thi', label: '#Cú đêm luyện thi', detail: '18+ tín chỉ', tone: 'violet', rarity: 'rare', asset_key: 'cu-dem-luyen-thi' }
]);
assert.match(fourBadges, /title-hoc-than/, 'Có badge #Học thần');
assert.match(fourBadges, /⚡/, 'Badge #Học thần có icon ⚡');
assert.match(fourBadges, /title-tinh-hoa-bdu/, 'Có badge #Tinh hoa BDU');
assert.match(fourBadges, /🎓/, 'Badge #Tinh hoa BDU có icon 🎓');
assert.match(fourBadges, /title-bat-bai-mon-phai/, 'Có badge #Bất bại môn phái');
assert.match(fourBadges, /🛡️/, 'Badge #Bất bại môn phái có icon 🛡️');
assert.match(fourBadges, /title-con-nha-nguoi-ta/, 'Có badge #Con nhà người ta');
assert.match(fourBadges, /✨/, 'Badge #Con nhà người ta có icon ✨');
// Danh hiệu thứ 5 và thứ 6 không được xuất hiện do slice(0, 4)
assert.equal(fourBadges.includes('title-tho-san-tin-chi'), false, 'Chỉ hiển thị tối đa 4 danh hiệu');
assert.equal(fourBadges.includes('title-cu-dem-luyen-thi'), false, 'Chỉ hiển thị tối đa 4 danh hiệu');

const extraBadgesCheck = sandbox.renderIdentityTitleBadges([
  { id: 'title:tho-san-tin-chi', label: '#Thợ săn tín chỉ', detail: '80+ tín chỉ', tone: 'blue', rarity: 'epic', asset_key: 'tho-san-tin-chi' },
  { id: 'title:cu-dem-luyen-thi', label: '#Cú đêm luyện thi', detail: 'Cày đêm', tone: 'violet', rarity: 'rare', asset_key: 'cu-dem-luyen-thi' },
  { id: 'title:tay-to-ganh-team', label: '#Tay to gánh team', detail: 'Gánh team', tone: 'blue', rarity: 'rare', asset_key: 'tay-to-ganh-team' }
]);
assert.match(extraBadgesCheck, /🎯/, 'Badge #Thợ săn tín chỉ có icon 🎯');
assert.match(extraBadgesCheck, /🦉/, 'Badge #Cú đêm luyện thi có icon 🦉');
assert.match(extraBadgesCheck, /💪/, 'Badge #Tay to gánh team có icon 💪');

// 11. Kiểm tra CSS các danh hiệu mới
const styleCss = fs.readFileSync('public/css/style.css', 'utf8');
assert.match(styleCss, /\.identity-title-badge\.rarity-vip/);
assert.match(styleCss, /\.identity-title-badge\.title-chatgpt/);
assert.match(styleCss, /\.identity-title-badge\.title-pho-bi-thu-doan/);
assert.match(styleCss, /\.identity-title-badge\.title-nam-vuong/);
assert.match(styleCss, /\.identity-title-badge\.title-hoc-than/);
assert.match(styleCss, /hocthan-thunder-pulse/);
assert.match(styleCss, /\.identity-title-badge\.title-tinh-hoa-bdu/);
assert.match(styleCss, /\.identity-title-badge\.title-bat-bai-mon-phai/);
assert.match(styleCss, /\.identity-title-badge\.title-con-nha-nguoi-ta/);
assert.match(styleCss, /connha-twinkle/);
assert.match(styleCss, /\.identity-title-badge\.title-tho-san-tin-chi/);
assert.match(styleCss, /\.identity-title-badge\.title-cu-dem-luyen-thi/);
assert.match(styleCss, /\.identity-title-badge\.title-tay-to-ganh-team/);

// 12. Kiểm tra HTML giao diện modal 4 danh hiệu
const indexHtml = fs.readFileSync('public/index.html', 'utf8');
assert.match(indexHtml, /Chọn tối đa 4 danh hiệu/, 'index.html mô tả tối đa 4 danh hiệu');
assert.match(indexHtml, /0\/4 đã chọn/, 'index.html bộ đếm mặc định 0/4');

console.log('✓ Tất cả kiểm thử nâng giới hạn danh hiệu (3 -> 4) và 7 danh hiệu mới đã VƯỢT QUA thành công!');

