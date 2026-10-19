import { useCallback, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import {
  describeStudentSceneSupport,
  watchStudentSceneSupport
} from '../features/auth/studentScene/sceneGate.js';
import StudentScene from '../features/auth/studentScene/StudentScene.jsx';
import CharacterStage from './CharacterStage.jsx';

// Câu chữ cho lý do cảnh 3D không chạy — hiện khi mở kèm ?scene3d-debug và ghi ra
// console một lần, để "vì sao không thấy cảnh 3D" trả lời được ngay tại máy người dùng.
const SUPPORT_REASONS = {
  narrow: 'màn hình hẹp hơn 901px',
  'reduced-motion': 'máy đang bật giảm chuyển động (prefers-reduced-motion: reduce)'
};
const FAILURE_REASONS = {
  webgl: 'không tạo được WebGL context',
  'three-import': 'không nạp được three.js',
  model: 'không tải được mô hình .glb',
  start: 'không khởi động được cảnh',
  'context-lost': 'mất WebGL context khi đang chạy',
  frame: 'lỗi khi vẽ khung hình'
};

export default function AuthLayout() {
  // Cảnh 3D chỉ bật trên màn hình rộng và khi không bật giảm chuyển động; hỏng
  // WebGL hoặc chunk lỗi thì khoá luôn, không thử lại để khỏi nhấp nháy.
  //
  // Riêng ?scene3d-debug là chế độ chẩn đoán: bỏ qua cổng giảm chuyển động để soi
  // cảnh 3D trên máy đang bật reduce-motion (cổng bề rộng vẫn giữ vì panel hẹp thì
  // không có chỗ hiển thị).
  const debugEnabled = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).has('scene3d-debug');
  const [support, setSupport] = useState(() => describeStudentSceneSupport(window));
  const [sceneFailure, setSceneFailure] = useState('');
  const forced = debugEnabled && support !== 'ok';
  const sceneEnabled = (support === 'ok' || debugEnabled) && !sceneFailure;
  const reason = sceneFailure
    ? FAILURE_REASONS[sceneFailure] ?? sceneFailure
    : SUPPORT_REASONS[support] ?? '';

  useEffect(() => {
    document.body.classList.add('theme-light');
    document.body.classList.remove('theme-dark');
    return () => document.body.classList.remove('password-active');
  }, []);

  useEffect(() => watchStudentSceneSupport(window, () => {
    setSupport(describeStudentSceneSupport(window));
  }), []);

  useEffect(() => {
    if (!reason) return;
    if (forced) console.info(`[student-scene] ?scene3d-debug: bỏ qua cổng "${reason}" để bật cảnh 3D`);
    else if (!sceneEnabled) console.info(`[student-scene] cảnh 3D tắt: ${reason}`);
  }, [reason, forced, sceneEnabled]);

  const handleSceneUnsupported = useCallback((failure) => {
    setSceneFailure(failure || 'start');
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
            {debugEnabled && !sceneEnabled && reason && <pre className="student-scene-debug">cảnh 3D tắt: {reason}</pre>}
            {forced && <pre className="student-scene-debug">?scene3d-debug: bỏ qua cổng &quot;{reason}&quot;</pre>}
          </div>
          <div className="scene-copy"><p className="scene-kicker">Quyền riêng tư là mặc định</p><h2>Không ai nhìn trộm đâu.</h2><p>Nhập mật khẩu và xem họ lịch sự quay đi.</p></div>
        </section>
        <Outlet />
      </div>
    </div>
  </main>;
}
