import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';

export default function AuthLayout() {
  useEffect(() => {
    document.body.classList.add('theme-light');
    document.body.classList.remove('theme-dark');
    return () => document.body.classList.remove('password-active');
  }, []);

  return <main className="view-section active">
    <div className="bg-glow bg-glow-1" />
    <div className="bg-glow bg-glow-2" />
    <div className="bg-glow bg-glow-3" />
    <div className="login-wrapper">
      <div className="auth-shell">
        <section className="login-context" aria-label="Minh họa bảo mật tương tác">
          <div className="scene-brand"><span className="scene-brand-mark"><img src="/assets/images/logo-hao-quang-transparent.png" alt="Logo Đại học Bình Dương" /></span><span>Binh Duong University</span></div>
          <div className="character-stage" aria-hidden="true">
            <div className="character character-tall"><div className="character-face"><span className="face-eye"><span className="pupil" /></span><span className="face-eye"><span className="pupil" /></span><span className="face-mouth" /></div></div>
            <div className="character character-dark"><div className="character-face"><span className="face-eye"><span className="pupil" /></span><span className="face-eye"><span className="pupil" /></span></div><span className="character-hand hand-left" /><span className="character-hand hand-right" /></div>
            <div className="character character-round"><div className="character-face"><span className="face-eye"><span className="pupil" /></span><span className="face-eye"><span className="pupil" /></span><span className="face-mouth face-mouth-smile" /></div></div>
            <div className="character character-pill"><div className="character-face"><span className="face-eye face-eye-single"><span className="pupil" /></span><span className="face-mouth face-mouth-flat" /></div></div>
          </div>
          <div className="scene-copy"><p className="scene-kicker">Quyền riêng tư là mặc định</p><h2>Không ai nhìn trộm đâu.</h2><p>Nhập mật khẩu và xem họ lịch sự quay đi.</p></div>
        </section>
        <Outlet />
      </div>
    </div>
  </main>;
}
