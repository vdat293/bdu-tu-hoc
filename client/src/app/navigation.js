export const navigation = [
  { path: '/gpa', label: 'Bảng điểm & GPA', icon: '▦', keywords: 'điểm gpa kết quả học tập' },
  { path: '/info', label: 'Lý lịch sinh viên', icon: '◎', keywords: 'hồ sơ thông tin cá nhân' },
  { path: '/schedule', label: 'Thời khóa biểu', icon: '□', keywords: 'lịch học thời khóa biểu' },
  { path: '/leaderboard', label: 'Bảng xếp hạng', icon: '♛', keywords: 'xếp hạng gpa top khóa' },
  { path: '/wordfmt', label: 'Chuẩn hóa Word BDU', icon: '▤', keywords: 'word docx văn bản' },
  { path: '/survey', label: 'Auto đánh giá khảo sát', icon: '✓', keywords: 'khảo sát đánh giá giảng viên' },
  { path: '/english', label: 'Auto bài tập tiếng Anh', icon: 'A', keywords: 'english moodle quiz' },
  { path: '/enrollment', label: 'Đăng ký môn học', icon: '+', keywords: 'đăng ký tín chỉ học phần' },
  { path: '/learning', label: 'Kho Tài Liệu', icon: '09', keywords: 'kho tài liệu video học liệu môn học' },
  { path: '/clans', label: 'CLB / Nhóm Học Tập', icon: '10', keywords: 'clan nhóm câu lạc bộ guild' },
  { path: '/confession', label: 'BDU Confession', icon: '11', keywords: 'bài viết diễn đàn confession cfs' }
];

export const routeMeta = Object.fromEntries(navigation.map((item) => [item.path, { title: item.label }]));

export function findRouteMeta(pathname) {
  const canonical = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (canonical.startsWith('/learning/')) return { title: 'Không gian môn học' };
  if (canonical.startsWith('/clans/')) return { title: 'Kênh CLB' };
  return routeMeta[canonical] || { title: 'BDU Tự Học' };
}
