import { useCallback, useEffect, useRef, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { shouldUseStudentScene, watchStudentSceneSupport } from '../features/auth/studentScene/sceneGate.js';
import StudentScene from '../features/auth/studentScene/StudentScene.jsx';
import CharacterStage from './CharacterStage.jsx';

export default function AuthLayout() {
  // Cảnh 3D chỉ bật trên màn hình rộng và khi không bật giảm chuyển động; hỏng
  // WebGL hoặc chunk lỗi thì khoá luôn, không thử lại để khỏi nhấp nháy.
  const [sceneEnabled, setSceneEnabled] = useState(() => shouldUseStudentScene(window));
  const sceneBlockedRef = useRef(false);

  useEffect(() => {
    document.body.classList.add('theme-light');
    document.body.classList.remove('theme-dark');
    return () => document.body.classList.remove('password-active');
  }, []);

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
