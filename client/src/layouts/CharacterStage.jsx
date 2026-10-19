// 4 blob CSS của trang đăng nhập: hình nền mặc định đồng thời là fallback khi
// cảnh 3D không chạy được (mobile, giảm chuyển động, không có WebGL, chunk lỗi).
// Markup giữ nguyên như bản gốc trong AuthLayout để CSS `.character-*` cũ dùng lại.
export default function CharacterStage() {
  return <>
    <div className="character character-tall"><div className="character-face"><span className="face-eye"><span className="pupil" /></span><span className="face-eye"><span className="pupil" /></span><span className="face-mouth" /></div></div>
    <div className="character character-dark"><div className="character-face"><span className="face-eye"><span className="pupil" /></span><span className="face-eye"><span className="pupil" /></span></div><span className="character-hand hand-left" /><span className="character-hand hand-right" /></div>
    <div className="character character-round"><div className="character-face"><span className="face-eye"><span className="pupil" /></span><span className="face-eye"><span className="pupil" /></span><span className="face-mouth face-mouth-smile" /></div></div>
    <div className="character character-pill"><div className="character-face"><span className="face-eye face-eye-single"><span className="pupil" /></span><span className="face-mouth face-mouth-flat" /></div></div>
  </>;
}
