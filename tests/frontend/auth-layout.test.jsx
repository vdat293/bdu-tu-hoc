import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../../client/src/app/providers.jsx';
import LoginPage from '../../client/src/features/auth/LoginPage.jsx';
import {
  SCENE_MIN_WIDTH,
  shouldReduceMotion,
  shouldUseStudentScene,
  watchStudentSceneSupport
} from '../../client/src/features/auth/studentScene/sceneGate.js';
import AuthLayout from '../../client/src/layouts/AuthLayout.jsx';

const FUTURE = { v7_startTransition: true, v7_relativeSplatPath: true };

// Scope giả để kiểm tra cổng điều kiện mà không cần trình duyệt thật: chỉ quan
// tâm hai câu truy vấn mà sceneGate dùng, không cần MatchMediaList thật.
function createFakeScope({ width = 1440, reducedMotion = false } = {}) {
  const state = { width, reducedMotion };
  const listeners = [];
  const matches = (query) => {
    if (query.includes('min-width')) return state.width >= SCENE_MIN_WIDTH;
    if (query.includes('reduced-motion')) return state.reducedMotion;
    return false;
  };
  return {
    state,
    matchMedia: (query) => ({
      media: query,
      get matches() { return matches(query); },
      addEventListener: (_type, handler) => { listeners.push({ query, handler }); },
      removeEventListener: (_type, handler) => {
        const index = listeners.findIndex((entry) => entry.query === query && entry.handler === handler);
        if (index >= 0) listeners.splice(index, 1);
      }
    }),
    emitChange() { listeners.slice().forEach(({ handler }) => handler()); },
    listenerCount() { return listeners.length; }
  };
}

function renderAuthRoutes() {
  return render(
    <MemoryRouter future={FUTURE} initialEntries={['/login']}>
      <AppProviders>
        <Routes>
          <Route element={<AuthLayout />}>
            <Route path="/login" element={<LoginPage />} />
          </Route>
        </Routes>
      </AppProviders>
    </MemoryRouter>
  );
}

describe('sceneGate', () => {
  it('mở cổng trên màn hình rộng khi không bật giảm chuyển động', () => {
    expect(shouldUseStudentScene(createFakeScope({ width: 1440 }))).toBe(true);
  });

  it('đóng cổng ở đúng ngưỡng mobile 900px', () => {
    expect(shouldUseStudentScene(createFakeScope({ width: 900 }))).toBe(false);
    expect(shouldUseStudentScene(createFakeScope({ width: 901 }))).toBe(true);
  });

  it('vẫn mở cổng khi người dùng bật giảm chuyển động, nhưng cảnh chuyển sang tĩnh', () => {
    // Giảm chuyển động không tắt cảnh nữa: cổng vẫn mở, cảnh tự đọc cờ này để bỏ
    // hết phần chuyển động (camera trôi, hover phóng, lật trang, animation).
    expect(shouldUseStudentScene(createFakeScope({ width: 1440, reducedMotion: true }))).toBe(true);
    expect(shouldReduceMotion(createFakeScope({ width: 1440, reducedMotion: true }))).toBe(true);
    expect(shouldReduceMotion(createFakeScope({ width: 1440 }))).toBe(false);
  });

  it('đóng cổng khi môi trường thiếu matchMedia thay vì ném lỗi', () => {
    expect(shouldUseStudentScene({})).toBe(false);
    expect(shouldUseStudentScene(undefined)).toBe(false);
    expect(shouldUseStudentScene({ matchMedia: () => { throw new Error('boom'); } })).toBe(false);
  });

  it('theo dõi thay đổi kích thước và gỡ listener khi huỷ', () => {
    const scope = createFakeScope({ width: 1440 });
    const onChange = vi.fn();
    const stop = watchStudentSceneSupport(scope, onChange);
    expect(scope.listenerCount()).toBe(1);
    scope.state.width = 820;
    scope.emitChange();
    expect(onChange).toHaveBeenLastCalledWith(false);
    scope.state.width = 1280;
    scope.emitChange();
    expect(onChange).toHaveBeenLastCalledWith(true);
    stop();
    expect(scope.listenerCount()).toBe(0);
  });

  it('cờ giảm chuyển động hỏng thì coi như không bật, không ném lỗi', () => {
    expect(shouldReduceMotion({})).toBe(false);
    expect(shouldReduceMotion(undefined)).toBe(false);
    expect(shouldReduceMotion({ matchMedia: () => { throw new Error('boom'); } })).toBe(false);
  });
});

describe('AuthLayout trên /login', () => {
  afterEach(() => {
    cleanup();
    document.body.className = '';
  });

  it('giữ blob CSS làm fallback mặc định trong môi trường không có WebGL', () => {
    const { container } = renderAuthRoutes();
    expect(container.querySelector('.character-stage')).not.toBeNull();
    expect(container.querySelectorAll('.character')).toHaveLength(4);
    expect(container.querySelector('.student-scene')).toBeNull();
    expect(container.querySelector('.character-round')).not.toBeNull();
    // Blob là trang trí nên vẫn ẩn với trình đọc màn hình, còn sân khấu thì không
    // (vì bản 3D có nút thật cho bàn phím).
    expect(container.querySelector('.character-stage').getAttribute('aria-hidden')).toBeNull();
    expect(container.querySelector('.character-stage-blobs').getAttribute('aria-hidden')).toBe('true');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('bản 3D dựng sẵn nút thật và vùng aria-live, bấm nút là đổi tư thế', () => {
    const scope = createFakeScope({ width: 1440 });
    vi.stubGlobal('matchMedia', scope.matchMedia);
    renderAuthRoutes();
    // Đồng bộ hoàn toàn: ba lô phải thành "bỏ xuống" và vùng live phải đọc tư
    // thế mới ngay trong cùng nhịp render.
    fireEvent.click(screen.getByRole('button', { name: 'Đeo ba lô' }));
    expect(screen.getByRole('button', { name: 'Bỏ ba lô xuống' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('đã đeo ba lô');
    fireEvent.click(screen.getByRole('button', { name: 'Ngồi vào bàn học' }));
    expect(screen.getByRole('button', { name: 'Đứng dậy khỏi bàn' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('ngồi học');
  });

  it('vẫn dựng đầy đủ form đăng nhập khi cảnh 3D không khởi động được', async () => {
    // three tự log lỗi khi không tạo được context: đây là nhánh mong đợi, không
    // phải thất bại, nên chặn log cho log test sạch.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const scope = createFakeScope({ width: 1440 });
    vi.stubGlobal('matchMedia', scope.matchMedia);
    const { container } = renderAuthRoutes();
    expect(await screen.findByLabelText('Mã Số Sinh Viên (MSSV)')).toBeInTheDocument();
    expect(screen.getByLabelText('Mật Khẩu')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Đăng nhập' })).toBeInTheDocument();
    // jsdom không có WebGL: scene phải tự báo không hỗ trợ rồi trả về blob cũ.
    await waitFor(() => expect(container.querySelector('.student-scene')).toBeNull());
    expect(container.querySelectorAll('.character')).toHaveLength(4);
  });

  it('bật class password-active khi focus ô mật khẩu để cảnh/blob biết né', async () => {
    renderAuthRoutes();
    const password = await screen.findByLabelText('Mật Khẩu');
    fireEvent.focus(password);
    expect(document.body.classList.contains('password-active')).toBe(true);
    fireEvent.blur(password);
    expect(document.body.classList.contains('password-active')).toBe(false);
    // Class cũ không còn ai dùng: CSS chỉ nghe .password-active.
    expect(document.body.classList.contains('password-focused')).toBe(false);
  });
});
