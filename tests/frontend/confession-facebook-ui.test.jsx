import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ConfessionPage from '../../client/src/features/confession/ConfessionPage.jsx';

const post = {
  id: 10,
  title: 'BDU Confession',
  content: 'mai lên lấy thẻ sinh viên, là đọc tên xong lấy rồi về luôn đúng k mng',
  scope: 'school',
  scope_id: null,
  category: 'confession',
  source: 'facebook',
  is_anonymous: false,
  is_liked: false,
  is_mine: false,
  like_count: 7,
  comment_count: 5,
  created_at: new Date(Date.now() - 51 * 60 * 1000).toISOString(),
  attachments: [
    { type: 'image', url: '/media/fb-import/10/0.jpg', direct_url: '/media/fb-import/10/0.jpg', title: 'Ảnh' },
    { type: 'link', url: 'https://www.facebook.com/groups/bdu.confessions/posts/10/', direct_url: 'https://www.facebook.com/groups/bdu.confessions/posts/10/', title: 'Bài gốc trên Facebook' }
  ],
  author: { mssv: 'FACEBOOK_USER_AAAA1111', name: 'facebook_user_aaaa1111', is_anonymous: false }
};

const commentFixtures = [
  { id: 1, post_id: 10, parent_id: null, content: 'Bình luận gốc', created_at: new Date().toISOString(), is_anonymous: false, author: { name: 'Nguyễn Văn A', mssv: 'A1' } },
  { id: 2, post_id: 10, parent_id: 1, content: 'Trả lời một', created_at: new Date().toISOString(), is_anonymous: false, author: { name: 'Trần Thị B', mssv: 'B1' } },
  { id: 3, post_id: 10, parent_id: 1, content: 'Trả lời hai', created_at: new Date().toISOString(), is_anonymous: false, author: { name: 'Trần Thị B', mssv: 'B1' } },
  { id: 4, post_id: 10, parent_id: 1, content: 'Trả lời ba', created_at: new Date().toISOString(), is_anonymous: false, author: { name: 'Trần Thị B', mssv: 'B1' } },
  { id: 5, post_id: 10, parent_id: null, content: 'Góp ý ẩn danh', created_at: new Date().toISOString(), is_anonymous: true, author: { name: null, mssv: null, is_anonymous: true } }
];

const addCommunityPostComment = vi.fn(() => Promise.resolve({}));
const updateCommunityPost = vi.fn(() => Promise.resolve({}));

vi.mock('../../client/src/app/providers.jsx', () => ({
  useAuth: () => ({ token: 'test-token', user: { name: 'Sinh viên kiểm thử', mssv: 'TEST0001', idsv: '1' } }),
  useRealtimeRoom: () => {},
  useRealtimeStatus: () => 'ready',
  useToasts: () => ({ notify: vi.fn() })
}));

vi.mock('../../client/src/api/community.js', () => ({
  addCommunityPostComment: (...args) => addCommunityPostComment(...args),
  createCommunityPost: vi.fn(),
  deleteCommunityPost: vi.fn(),
  getCommunityPostComments: vi.fn(() => Promise.resolve(commentFixtures)),
  getCommunityPosts: vi.fn(() => Promise.resolve({ posts: [post] })),
  toggleCommunityPostLike: vi.fn(),
  updateCommunityPost: (...args) => updateCommunityPost(...args),
  uploadCommunityMedia: vi.fn()
}));

vi.mock('../../client/src/api/identity.js', () => ({
  getIdentityFrames: vi.fn(() => Promise.resolve({ frames: [] })),
  getMyIdentityPresentation: vi.fn(() => Promise.resolve({ name: 'Sinh viên kiểm thử', selected_titles: [], available_titles: [], frame_access: {} })),
  updateMyEquippedFrame: vi.fn(),
  updateMyIdentityPresentation: vi.fn()
}));

vi.mock('../../client/src/api/academics.js', () => ({
  getMyAcademicRanking: vi.fn(() => Promise.resolve({})),
  getProfile: vi.fn(() => Promise.resolve({}))
}));

function renderPage(initialEntry = '/confession?source=all') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const utils = render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <QueryClientProvider client={client}>
        <ConfessionPage />
      </QueryClientProvider>
    </MemoryRouter>
  );
  return { ...utils, client };
}

async function openComments() {
  const action = await screen.findByRole('button', { name: /Bình luận/ });
  fireEvent.click(action);
  await screen.findByText('Bình luận gốc');
  expect(screen.getByRole('dialog', { name: 'Bài viết của facebook_user_aaaa1111' })).toBeInTheDocument();
  return document.querySelector('#fbc-post-modal');
}

afterEach(() => {
  cleanup();
  addCommunityPostComment.mockClear();
  updateCommunityPost.mockClear();
});

describe('Confession kiểu Facebook', () => {
  it('dựng đủ hàng hành động, lưới ảnh và link preview', async () => {
    const { container } = renderPage();
    await screen.findByText(post.content);

    expect(screen.getByRole('button', { name: /Thích/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Chia sẻ/ })).toBeInTheDocument();
    expect(screen.getByText('7 bình luận'.replace('7', String(post.comment_count)))).toBeInTheDocument();

    const grid = container.querySelector('.fbc-photo-grid');
    expect(grid).toBeTruthy();
    expect(grid.querySelector('img')?.getAttribute('src')).toBe('/media/fb-import/10/0.jpg');

    // Link bài gốc không còn hiện thành thẻ; nó nằm ở tên tác giả.
    expect(container.querySelector('.fbc-link-card')).toBeNull();
    const nameLink = container.querySelector('.fbc-post-name.fbc-name-link');
    expect(nameLink?.getAttribute('href')).toBe('https://www.facebook.com/groups/bdu.confessions/posts/10/');
    expect(nameLink?.textContent).toBe(post.author.name);
    expect(nameLink?.getAttribute('target')).toBe('_blank');

    // Tiêu đề mặc định không được lặp lại phía trên nội dung.
    expect(screen.queryByText('BDU Confession')).not.toBeInTheDocument();
  });

  it('hiển thị bình luận dạng bong bóng, gom reply và giấu bớt câu trả lời', async () => {
    renderPage();
    const modal = await openComments();

    const bubbles = modal.querySelectorAll('.fbc-comment .fbc-bubble');
    expect(bubbles.length).toBeGreaterThanOrEqual(4);
    expect(within(bubbles[0]).getByText('Nguyễn Văn A')).toBeInTheDocument();
    expect(within(bubbles[0]).getByText('Bình luận gốc')).toBeInTheDocument();

    // 3 reply nhưng chỉ hiện 2, phần còn lại nằm sau nút "Xem ... câu trả lời".
    expect(screen.getByText('Trả lời một')).toBeInTheDocument();
    expect(screen.getByText('Trả lời hai')).toBeInTheDocument();
    expect(screen.queryByText('Trả lời ba')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Xem 3 câu trả lời/ }));
    expect(screen.getByText('Trả lời ba')).toBeInTheDocument();

    // Bình luận ẩn danh không được lộ danh tính.
    expect(screen.getByText('Sinh viên giấu tên')).toBeInTheDocument();
  });

  it('gửi trả lời kèm parentId của bình luận gốc', async () => {
    renderPage();
    const modal = await openComments();

    const [replyButton] = screen.getAllByRole('button', { name: 'Trả lời' });
    fireEvent.click(replyButton);
    expect(modal.querySelector('.fbc-reply-chip')?.textContent).toContain('Nguyễn Văn A');

    const input = screen.getByLabelText('Nội dung bình luận');
    expect(input.getAttribute('placeholder')).toBe('Trả lời Nguyễn Văn A...');
    fireEvent.change(input, { target: { value: 'Cảm ơn bạn' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi bình luận' }));

    await waitFor(() => expect(addCommunityPostComment).toHaveBeenCalledTimes(1));
    expect(addCommunityPostComment).toHaveBeenCalledWith('test-token', 10, { content: 'Cảm ơn bạn', parentId: 1, isAnonymous: false, attachments: [] });
  });

  it('gửi bình luận gốc thì không kèm parentId', async () => {
    renderPage();
    await openComments();

    const input = screen.getByLabelText('Nội dung bình luận');
    expect(input.getAttribute('placeholder')).toBe('Viết bình luận...');
    fireEvent.change(input, { target: { value: 'Bình luận mới' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi bình luận' }));

    await waitFor(() => expect(addCommunityPostComment).toHaveBeenCalledTimes(1));
    expect(addCommunityPostComment).toHaveBeenCalledWith('test-token', 10, { content: 'Bình luận mới', isAnonymous: false, attachments: [] });
  });


  it('mở popup kiểu Facebook, khoá cuộn trang và đóng bằng Escape', async () => {
    const { container } = renderPage();
    await screen.findByText(post.content);
    expect(container.querySelector('#fbc-post-modal')).toBeNull();

    const opener = screen.getByRole('button', { name: /Bình luận/ });
    fireEvent.click(opener);

    const dialog = await screen.findByRole('dialog', { name: 'Bài viết của facebook_user_aaaa1111' });
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(document.body.style.overflow).toBe('');
    expect(opener).toHaveFocus();
  });

  it('giữ khung Sukuna trên avatar bài viết (class legacy + artwork)', async () => {
    const { getCommunityPosts } = await import('../../client/src/api/community.js');
    getCommunityPosts.mockResolvedValueOnce({
      posts: [{ ...post, author: { ...post.author, equipped_frame_id: 'anime-sukuna' } }]
    });

    const { container } = renderPage();
    await screen.findByText(post.content);

    const avatar = container.querySelector('.fbc-post .fbc-avatar-post');
    // CSS khung bám vào `.forum-avatar.has-inline-frame`, thiếu class là mất khung.
    expect(avatar.classList.contains('forum-avatar')).toBe(true);
    expect(avatar.classList.contains('has-inline-frame')).toBe(true);
    expect(avatar.classList.contains('has-frame-anime-sukuna')).toBe(true);
    expect(avatar.querySelector('.avatar-frame-artwork')).toBeTruthy();
    expect(avatar.querySelector('.sukuna-domain-stage')).toBeTruthy();
  });

  it('CSS avatar không đè kích thước artwork khung (Sukuna)', () => {
    const css = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/src/styles/app.css'),
      'utf8'
    );
    // Rule có id sẽ thắng `.has-frame-anime-sukuna .anime-frame-art { width: 170% }`,
    // nên ảnh đại diện phải dùng child combinator để không chạm vào artwork khung.
    expect(css).not.toMatch(/\.fbc-avatar img\s*\{/);
    expect(css).toMatch(/\.fbc-avatar > img\s*\{/);
    expect(css).toMatch(/\.fbc-avatar\.has-inline-frame\s*\{[^}]*overflow:\s*visible/);
  });

  it('giới hạn chiều cao popup chi tiết bài viết để thread dài không phình khỏi màn hình', () => {
    const css = fs.readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../../client/src/styles/app.css'),
      'utf8'
    );
    // `ViewportModal` đặt id ở backdrop nên selector phải bám dialog con; nếu viết
    // id dính liền class .modal-dialog thì max-height không bao giờ được áp dụng.
    expect(css).not.toMatch(/#fbc-post-modal\.modal-dialog/);
    expect(css).toMatch(/#fbc-post-modal > \.modal-dialog\.fbc-modal\s*\{[^}]*max-height:\s*calc\(100vh - 40px\)/s);
    expect(css).toMatch(/#fbc-post-modal > \.modal-dialog\.fbc-modal\s*\{[^}]*display:\s*flex/s);
    expect(css).toMatch(/\.fb-composer-dialog\s*\{[^}]*max-height:\s*calc\(100vh - 40px\)/s);
  });

  it('bật ẩn danh thì bình luận gửi kèm isAnonymous và avatar đổi thành ?', async () => {
    renderPage();
    const modal = await openComments();

    const toggle = screen.getByRole('button', { name: /Ẩn danh/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(modal.querySelector('.fbc-composer .fbc-avatar-anon')?.textContent).toBe('?');

    fireEvent.change(screen.getByLabelText('Nội dung bình luận'), { target: { value: 'Góp ý kín đáo' } });
    fireEvent.click(screen.getByRole('button', { name: 'Gửi bình luận' }));

    await waitFor(() => expect(addCommunityPostComment).toHaveBeenCalledTimes(1));
    expect(addCommunityPostComment).toHaveBeenCalledWith('test-token', 10, { content: 'Góp ý kín đáo', isAnonymous: true, attachments: [] });
  });

  it('sự kiện realtime làm mới feed và thread đúng phạm vi', async () => {
    const { client } = renderPage();
    await screen.findByText(post.content);

    const spy = vi.spyOn(client, 'invalidateQueries');
    const keys = () => spy.mock.calls.map(([arg]) => JSON.stringify(arg.queryKey));

    window.dispatchEvent(new CustomEvent('bdu:realtime', { detail: { type: 'community.post.created', data: { postId: 99 } } }));
    expect(keys()).toContain(JSON.stringify(['confession']));

    spy.mockClear();
    // Bình luận của bài đang hiển thị: làm mới thread + feed (đếm bình luận đổi).
    window.dispatchEvent(new CustomEvent('bdu:realtime', { detail: { type: 'community.comment.created', data: { postId: 10 } } }));
    expect(keys()).toContain(JSON.stringify(['post-comments', '10']));
    expect(keys()).toContain(JSON.stringify(['confession']));

    spy.mockClear();
    // Bình luận của bài không có trong feed: chỉ làm mới thread đó.
    window.dispatchEvent(new CustomEvent('bdu:realtime', { detail: { type: 'community.comment.created', data: { postId: 555 } } }));
    expect(keys()).toContain(JSON.stringify(['post-comments', '555']));
    expect(keys()).not.toContain(JSON.stringify(['confession']));
  });

  it('menu "..." chỉ hiện với bài của mình và đóng khi bấm ra ngoài', async () => {
    const { getCommunityPosts } = await import('../../client/src/api/community.js');
    getCommunityPosts.mockResolvedValueOnce({ posts: [{ ...post, is_mine: true }] });

    renderPage();
    await screen.findByText(post.content);

    const opener = screen.getByRole('button', { name: 'Tuỳ chọn bài viết' });
    expect(screen.queryByRole('menuitem', { name: /Xóa bài viết/ })).not.toBeInTheDocument();

    fireEvent.click(opener);
    expect(screen.getByRole('menuitem', { name: /Xóa bài viết/ })).toBeInTheDocument();

    fireEvent.click(document.body);
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: /Xóa bài viết/ })).not.toBeInTheDocument());
  });

  it('cú click lan từ vùng menu "..." ra document không tự đóng menu vừa mở', async () => {
    const { getCommunityPosts } = await import('../../client/src/api/community.js');
    getCommunityPosts.mockResolvedValueOnce({ posts: [{ ...post, is_mine: true }] });

    renderPage();
    await screen.findByText(post.content);

    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn bài viết' }));
    expect(screen.getByRole('menuitem', { name: /Xóa bài viết/ })).toBeInTheDocument();

    // Trình duyệt thật gắn listener đóng menu ngay khi effect chạy, rồi chính cú
    // click mở menu lan tiếp tới document và đóng nó. Click trong .fbc-menu-wrap
    // phải được bỏ qua để menu trụ lại.
    fireEvent.click(document.querySelector('.fbc-menu-wrap'));
    expect(screen.getByRole('menuitem', { name: /Xóa bài viết/ })).toBeInTheDocument();
  });

  it('không hiện menu "..." trên bài của người khác', async () => {
    renderPage();
    await screen.findByText(post.content);
    expect(screen.queryByRole('button', { name: 'Tuỳ chọn bài viết' })).not.toBeInTheDocument();
  });

  it('quản trị viên thấy menu sửa/xoá trên bài của người khác', async () => {
    const { getCommunityPosts } = await import('../../client/src/api/community.js');
    getCommunityPosts.mockResolvedValueOnce({ posts: [{ ...post, can_edit: true, can_delete: true }] });

    renderPage();
    await screen.findByText(post.content);

    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn bài viết' }));
    expect(screen.getByRole('menuitem', { name: /Chỉnh sửa bài viết/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /Xóa bài viết/ })).toBeInTheDocument();
  });

  it('lưu chỉnh sửa bài viết của người khác và đóng hộp thoại', async () => {
    const { getCommunityPosts } = await import('../../client/src/api/community.js');
    getCommunityPosts.mockResolvedValueOnce({ posts: [{ ...post, can_edit: true, can_delete: true }] });

    renderPage();
    await screen.findByText(post.content);

    fireEvent.click(screen.getByRole('button', { name: 'Tuỳ chọn bài viết' }));
    fireEvent.click(screen.getByRole('menuitem', { name: /Chỉnh sửa bài viết/ }));

    const dialog = await screen.findByRole('dialog', { name: 'Chỉnh sửa bài viết' });
    const contentInput = within(dialog).getByDisplayValue(post.content);
    fireEvent.change(contentInput, { target: { value: 'Nội dung đã được quản trị viên chỉnh sửa' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Lưu thay đổi' }));

    await waitFor(() => expect(updateCommunityPost).toHaveBeenCalledTimes(1));
    expect(updateCommunityPost).toHaveBeenCalledWith('test-token', 10, {
      title: 'BDU Confession',
      content: 'Nội dung đã được quản trị viên chỉnh sửa',
      isAnonymous: false,
      attachments: post.attachments
    });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Chỉnh sửa bài viết' })).not.toBeInTheDocument());
  });

  it('hiển thị nhãn "Đã chỉnh sửa" khi bài viết có edited_at', async () => {
    const { getCommunityPosts } = await import('../../client/src/api/community.js');
    getCommunityPosts.mockResolvedValueOnce({ posts: [{ ...post, edited_at: new Date().toISOString() }] });

    renderPage();
    await screen.findByText(post.content);
    expect(screen.getByText('Đã chỉnh sửa')).toBeInTheDocument();
  });

  it('mặc định tab Web lọc ẩn bài Facebook và hiện badge Web/Facebook ở tab Tất cả', async () => {
    const { getCommunityPosts } = await import('../../client/src/api/community.js');
    const webPost = { ...post, id: 11, source: 'portal', content: 'bài web nội bộ', attachments: [] };
    getCommunityPosts.mockResolvedValueOnce({ posts: [webPost, post] });

    renderPage('/confession?source=all');
    await screen.findByText('bài web nội bộ');
    await screen.findByText(post.content);
    // Badge nguồn từng bài ở tab chung.
    expect(screen.getAllByText('Facebook').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Web').length).toBeGreaterThanOrEqual(1);
  });

  it('tab Web mặc định (không param source) chỉ hiện bài web', async () => {
    const { getCommunityPosts } = await import('../../client/src/api/community.js');
    const webPost = { ...post, id: 12, source: 'portal', content: 'chỉ bài web mới thấy', attachments: [] };
    getCommunityPosts.mockResolvedValueOnce({ posts: [webPost, post] });

    renderPage('/confession');
    await screen.findByText('chỉ bài web mới thấy');
    expect(screen.queryByText(post.content)).not.toBeInTheDocument();
    // API được gọi kèm source web để backend lọc.
    expect(getCommunityPosts).toHaveBeenCalledWith('test-token', expect.objectContaining({ source: 'web' }));
  });
});
