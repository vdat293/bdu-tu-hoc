import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useAppearance, useAppearanceOverride } from '../app/appearance.jsx';
import { shouldUseStudentScene, watchStudentSceneSupport } from '../features/auth/studentScene/sceneGate.js';
import StudentScene from '../features/auth/studentScene/StudentScene.jsx';
import CharacterStage from './CharacterStage.jsx';

export default function AuthLayout() {
  // Cảnh 3D chỉ bật trên màn hình rộng; hỏng WebGL hoặc chunk lỗi thì khoá luôn,
  // không thử lại để khỏi nhấp nháy. Người bật giảm chuyển động vẫn thấy cảnh,
  // nhưng ở chế độ tĩnh (xem sceneGate/StudentScene).
  const [sceneEnabled, setSceneEnabled] = useState(() => shouldUseStudentScene(window));
  const { theme, toggleTheme } = useAppearance();
  const sceneBlockedRef = useRef(false);

  // Trang đăng nhập luôn thống nhất phong cách Neumorphism độc lập với giao diện bên trong.
  useAppearanceOverride({ surface: 'neumorphism' });

  useEffect(() => () => document.body.classList.remove('password-active'), []);

  useEffect(() => watchStudentSceneSupport(window, (supported) => {
    setSceneEnabled(supported && !sceneBlockedRef.current);
  }), []);

  const handleSceneUnsupported = useCallback(() => {
    sceneBlockedRef.current = true;
    setSceneEnabled(false);
  }, []);

  return <main className="view-section active">
    <div className="bg-glow bg-glow-1" />
    <div className="bg-glow bg-glow-2" />
    <div className="bg-glow bg-glow-3" />
    <div className="login-wrapper">
      <div className="auth-shell">
        <button
          type="button"
          id="btn-login-theme-toggle"
          className="login-theme-toggle-btn"
          onClick={toggleTheme}
          aria-label={theme === 'dark' ? 'Chuyển sang giao diện Sáng' : 'Chuyển sang giao diện Tối'}
        >
          {theme === 'dark' ? '☀️ Sáng' : '🌙 Tối'}
        </button>
        <section className="login-context" aria-label="Minh họa bảo mật tương tác">
          <div className="scene-brand"><span className="scene-brand-mark"><img src="/assets/images/logo-hao-quang-transparent.png" alt="Logo Đại học Bình Dương" /></span><span>Binh Duong University</span></div>
          <div className="character-stage">
            {sceneEnabled ? <StudentScene onUnsupported={handleSceneUnsupported} /> : <div className="character-stage-blobs" aria-hidden="true"><CharacterStage /></div>}
          </div>
          <div className="scene-copy"><p className="scene-kicker">Quyền riêng tư là mặc định</p><h2>Không ai nhìn trộm đâu.</h2><p>Nhập mật khẩu và xem họ lịch sự quay đi.</p></div>
        </section>
        <Outlet />
      </div>
    </div>
  </main>;
}
