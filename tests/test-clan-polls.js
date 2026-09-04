import assert from 'node:assert/strict';
import { query, closeDatabase } from '../src/db/database.js';
import { CommunityService } from '../src/services/community.service.js';
import { StudentService } from '../src/services/student.service.js';

console.log('🧪 Bắt đầu kiểm thử Bản Tin CLB & Tính Năng Bình Chọn (Clan Polls)...');

const MSSV_LEADER = 'TEST_POLL_LEADER';
const MSSV_MEMBER_1 = 'TEST_POLL_MEMBER_1';
const MSSV_MEMBER_2 = 'TEST_POLL_MEMBER_2';
const MSSV_OUTSIDER = 'TEST_POLL_OUTSIDER';
const CLAN_CODE = `CLAN_POLL_TEST_${Date.now()}`;

let createdClanId = null;

try {
  // Dọn dẹp dữ liệu test cũ nếu có
  await query("DELETE FROM clans WHERE code LIKE 'CLAN_POLL_TEST_%'");
  await query("DELETE FROM students WHERE mssv LIKE 'TEST_POLL_%'");

  // 1. Tạo 4 sinh viên
  await StudentService.recordLogin(MSSV_LEADER, 'Nguyễn Leader Poll');
  await StudentService.recordLogin(MSSV_MEMBER_1, 'Trần Member Một');
  await StudentService.recordLogin(MSSV_MEMBER_2, 'Lê Member Hai');
  await StudentService.recordLogin(MSSV_OUTSIDER, 'Phạm Người Ngoài');

  // 2. Tạo CLB test
  const clan = await StudentService.createClan({
    code: CLAN_CODE,
    name: 'CLB Khảo Sát & Bình Chọn',
    tag: '[VOTE]',
    description: 'CLB kiểm thử tính năng bình chọn',
    leaderMssv: MSSV_LEADER
  });
  createdClanId = clan.id;

  // Cho 2 member tham gia CLB
  await StudentService.joinClan(MSSV_MEMBER_1, clan.id);
  await StudentService.joinClan(MSSV_MEMBER_2, clan.id);
  console.log('✅ PASSED: Tạo CLB và thêm thành viên thành công.');

  // 3. Đăng bài Bản tin thông thường (Discussion)
  const normalPost = await CommunityService.createPost({
    authorMssv: MSSV_LEADER,
    title: 'Thông báo sinh hoạt tuần mới',
    content: 'Tuần này CLB chúng ta sẽ có buổi sinh hoạt online vào cuối tuần.',
    scope: 'clan',
    scopeId: String(clan.id),
    category: 'discussion'
  });
  assert.equal(normalPost.category, 'discussion');
  assert.equal(normalPost.poll, null);
  console.log('✅ PASSED: Đăng bài Bản tin thông thường thành công.');

  // 4. Tạo cuộc Bình chọn (Poll)
  const pollPost = await CommunityService.createPost({
    authorMssv: MSSV_MEMBER_1,
    title: 'Chọn ngày tổ chức Workshop AI',
    content: 'Mọi người biểu quyết chọn ngày phù hợp nhất nhé!',
    scope: 'clan',
    scopeId: String(clan.id),
    category: 'poll',
    poll: {
      question: 'Bạn muốn tổ chức Workshop vào ngày nào?',
      options: ['Thứ Bảy (Sáng)', 'Thứ Bảy (Chiều)', 'Chủ Nhật (Sáng)']
    }
  });

  assert.equal(pollPost.category, 'poll');
  assert.ok(pollPost.poll, 'Phải có trường poll');
  assert.equal(pollPost.poll.question, 'Bạn muốn tổ chức Workshop vào ngày nào?');
  assert.equal(pollPost.poll.options.length, 3);
  assert.equal(pollPost.poll.total_votes, 0);
  console.log('✅ PASSED: Tạo cuộc Bình chọn (Poll) với 3 phương án thành công.');

  const option1 = pollPost.poll.options[0];
  const option2 = pollPost.poll.options[1];
  const option3 = pollPost.poll.options[2];

  // 5. Thành viên 1 bỏ phiếu cho Lựa chọn 1
  const voteRes1 = await CommunityService.voteClanPoll(pollPost.poll.id, option1.id, MSSV_MEMBER_1);
  assert.equal(voteRes1.total_votes, 1);
  assert.equal(voteRes1.my_voted_option_id, String(option1.id));
  const opt1After = voteRes1.options.find(o => o.id === String(option1.id));
  assert.equal(opt1After.vote_count, 1);
  assert.equal(opt1After.percentage, 100);
  console.log('✅ PASSED: Thành viên bỏ phiếu thành công, tỷ lệ % tính chuẩn 100%.');

  // 6. Thành viên 2 bỏ phiếu cho Lựa chọn 2
  const voteRes2 = await CommunityService.voteClanPoll(pollPost.poll.id, option2.id, MSSV_MEMBER_2);
  assert.equal(voteRes2.total_votes, 2);
  const opt1v2 = voteRes2.options.find(o => o.id === String(option1.id));
  const opt2v2 = voteRes2.options.find(o => o.id === String(option2.id));
  assert.equal(opt1v2.vote_count, 1);
  assert.equal(opt1v2.percentage, 50);
  assert.equal(opt2v2.vote_count, 1);
  assert.equal(opt2v2.percentage, 50);
  console.log('✅ PASSED: Nhiều thành viên bỏ phiếu, chia đều tỷ lệ 50% - 50%.');

  // 7. Thành viên 1 đổi phiếu sang Lựa chọn 2 (Đổi ý kiến)
  const voteChange = await CommunityService.voteClanPoll(pollPost.poll.id, option2.id, MSSV_MEMBER_1);
  assert.equal(voteChange.total_votes, 2, 'Tổng số phiếu vẫn là 2');
  const opt1AfterChange = voteChange.options.find(o => o.id === String(option1.id));
  const opt2AfterChange = voteChange.options.find(o => o.id === String(option2.id));
  assert.equal(opt1AfterChange.vote_count, 0);
  assert.equal(opt1AfterChange.percentage, 0);
  assert.equal(opt2AfterChange.vote_count, 2);
  assert.equal(opt2AfterChange.percentage, 100);
  console.log('✅ PASSED: Thành viên thay đổi lựa chọn bình chọn mượt mà.');

  // 8. Chặn người ngoài CLB tham gia bình chọn
  await assert.rejects(
    CommunityService.voteClanPoll(pollPost.poll.id, option3.id, MSSV_OUTSIDER),
    (err) => err.status === 403,
    'Người ngoài không thể bỏ phiếu trong CLB'
  );
  console.log('✅ PASSED: Chặn người ngoài CLB bình chọn thành công (HTTP 403).');

  // 9. Kiểm tra filter bài viết CLB theo 'discussion' và 'poll'
  const filterDiscuss = await CommunityService.getPosts({
    scope: 'clan',
    scopeId: String(clan.id),
    category: 'discussion'
  });
  assert.ok(filterDiscuss.posts.every(p => p.category === 'discussion'));
  assert.ok(filterDiscuss.posts.some(p => p.id === normalPost.id));

  const filterPoll = await CommunityService.getPosts({
    scope: 'clan',
    scopeId: String(clan.id),
    category: 'poll'
  });
  assert.ok(filterPoll.posts.every(p => p.category === 'poll'));
  assert.ok(filterPoll.posts.some(p => p.id === pollPost.id));
  console.log('✅ PASSED: Bộ lọc bài viết theo Bản tin và Bình chọn hoạt động hoàn hảo.');

  console.log('\n🎉 TẤT CẢ CÁC BÀI KIỂM THỬ BÌNH CHỌN (CLAN POLLS) ĐÃ ĐẠT 100%!');
} catch (err) {
  console.error('❌ Kiểm thử thất bại:', err);
  process.exitCode = 1;
} finally {
  // Dọn dẹp sạch sẽ dữ liệu test
  try {
    if (createdClanId) {
      await query('DELETE FROM clans WHERE id = $1', [createdClanId]);
    }
    await query("DELETE FROM clans WHERE code LIKE 'CLAN_POLL_TEST_%'");
    await query("DELETE FROM students WHERE mssv LIKE 'TEST_POLL_%'");
  } catch {}
  await closeDatabase();
}
