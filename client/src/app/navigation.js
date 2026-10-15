export const navigation = [
  { path: '/gpa', label: 'Bảng điểm & GPA', icon: '▦', keywords: 'điểm gpa kết quả học tập' },
  { path: '/info', label: 'Lý lịch sinh viên', icon: '◎', keywords: 'hồ sơ thông tin cá nhân' },
  { path: '/schedule', label: 'Thời khóa biểu', icon: '□', keywords: 'lịch học thời khóa biểu' },
  { path: '/leaderboard', label: 'Bảng xếp hạng', icon: '♛', keywords: 'xếp hạng gpa top khóa' },
  { path: '/wordfmt', label: 'Chuẩn hóa Word BDU', icon: '▤', keywords: 'word docx văn bản' },
  { path: '/survey', label: 'Auto đánh giá khảo sát', icon: '✓', keywords: 'khảo sát đánh giá giảng viên' },
  { path: '/training-score', label: 'Auto điểm rèn luyện', icon: '☑', keywords: 'điểm rèn luyện dgrl đánh giá kết quả rèn luyện' },
  { path: '/english', label: 'Auto bài tập tiếng Anh', icon: 'A', keywords: 'english moodle quiz' },
  { path: '/enrollment', label: 'Đăng ký môn học', icon: '+', keywords: 'đăng ký tín chỉ học phần' },
  { path: '/learning', label: 'Kho Tài Liệu', icon: '09', keywords: 'kho tài liệu video học liệu môn học' },
  { path: '/vocab', label: 'Luyện từ vựng', icon: 'Aa', keywords: 'luyện từ vựng flashcard quiz typing ghép cặp english' },
  { path: '/grammar', label: 'Luyện ngữ pháp', icon: 'Ab', keywords: 'luyện ngữ pháp grammar toeic destination trắc nghiệm điền từ sắp xếp đọc hiểu' },
  { path: '/clans', label: 'CLB / Nhóm Học Tập', icon: '10', keywords: 'clan nhóm câu lạc bộ guild' },
  { path: '/confession', label: 'BDU Confession', icon: '11', keywords: 'bài viết diễn đàn confession cfs' },
  { path: '/mystudent', label: 'Sinh viên của tôi', icon: '12', keywords: 'trung tâm chuyển đổi số sinh viên của tôi ttcds', requiresCapability: 'ttcds:access', section: 'ttcds' }
];

export function filterNavigation(items, capabilities) {
  return items.filter((item) => {
    if (item.requiresCapability === 'ttcds:access') return Boolean(capabilities?.can_access);
    return true;
  });
}

export const routeMeta = Object.fromEntries(navigation.map((item) => [item.path, { title: item.label }]));

export function findRouteMeta(pathname) {
  const canonical = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (canonical.startsWith('/learning/')) return { title: 'Không gian môn học' };
  if (canonical === '/vocab') return { title: 'Luyện từ vựng' };
  if (canonical.startsWith('/vocab/')) return { title: 'Luyện từ vựng' };
  if (canonical.startsWith('/grammar')) return { title: 'Luyện ngữ pháp' };
  if (canonical.startsWith('/clans/')) return { title: 'Kênh CLB' };
  if (canonical === '/mystudent') return { title: 'Sinh viên của tôi' };
  if (canonical.startsWith('/ttcds')) return { title: 'Trung tâm CĐS' };
  if (canonical.startsWith('/confession/profile/')) return { title: 'Hồ sơ sinh viên' };
  return routeMeta[canonical] || { title: 'BDU Tự Học' };
}
