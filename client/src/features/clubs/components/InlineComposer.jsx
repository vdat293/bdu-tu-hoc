import { useState } from 'react';
import { initials } from '../lib/format.js';

const MODES = [
  { id: 'discussion', label: 'Thảo luận' },
  { id: 'poll', label: 'Bình chọn' },
  { id: 'material', label: 'Tài liệu' }
];

// Composer inline: avatar + placeholder, expand khi focus.
// Hỗ trợ discussion + poll + link tài liệu (material).
export default function InlineComposer({ user, canPoll, isPending, onSubmit }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState('discussion');
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [question, setQuestion] = useState('');
  const [options, setOptions] = useState(['', '']);

  const reset = () => {
    setTitle('');
    setContent('');
    setUrl('');
    setQuestion('');
    setOptions(['', '']);
    setExpanded(false);
  };

  const submit = (event) => {
    event?.preventDefault();
    onSubmit?.(
      { mode, title: title.trim(), content: content.trim(), url: url.trim(), question: question.trim(), options: options.map((o) => o.trim()).filter(Boolean) },
      { reset }
    );
  };

  if (!expanded) {
    return (
      <button type="button" className="club-composer-trigger" onClick={() => setExpanded(true)}>
        <span className="club-avatar club-avatar--sm" aria-hidden="true">{initials(user?.name)}</span>
        <span className="club-composer-trigger__copy">
          <strong>Chia sẻ với CLB</strong>
          <span>Đăng câu hỏi, cập nhật hoặc tài liệu học tập</span>
        </span>
      </button>
    );
  }

  return (
    <form className="club-composer" onSubmit={submit}>
      <div className="club-composer__modes" role="group" aria-label="Loại bài đăng">
        {MODES.filter((m) => m.id !== 'poll' || canPoll).map((m) => (
          <button key={m.id} type="button" className={mode === m.id ? 'is-active' : ''} aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>
            {m.label}
          </button>
        ))}
      </div>
      {mode === 'poll' ? (
        <>
          <label>Câu hỏi bình chọn<input className="form-input" value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={280} placeholder="Ví dụ: Ôn thi cuối kỳ vào tối nào?" /></label>
          {options.map((option, index) => (
            <label key={index}>Phương án {index + 1}<input className="form-input" value={option} onChange={(e) => setOptions((cur) => cur.map((v, i) => (i === index ? e.target.value : v)))} maxLength={140} /></label>
          ))}
          <div className="club-composer__row">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOptions((cur) => (cur.length >= 6 ? cur : [...cur, '']))} disabled={options.length >= 6}>Thêm phương án</button>
          </div>
          <label>Ghi chú thêm (tùy chọn)<textarea className="form-input" rows={2} value={content} onChange={(e) => setContent(e.target.value)} maxLength={2000} /></label>
        </>
      ) : (
        <>
          <label>Tiêu đề<input className="form-input" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={180} placeholder="Ví dụ: Tìm bạn ôn thi cuối kỳ" /></label>
          <label>Nội dung<textarea className="form-input" rows={4} value={content} onChange={(e) => setContent(e.target.value)} maxLength={5000} placeholder="Chia sẻ câu hỏi, cập nhật hoặc lời mời học nhóm…" autoFocus /></label>
          <label>Liên kết tài liệu (tùy chọn)<input className="form-input" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Google Drive hoặc YouTube" /></label>
        </>
      )}
      <div className="club-composer__actions">
        <button type="button" className="btn btn-secondary btn-sm" onClick={reset}>Thu gọn</button>
        <button type="submit" className="btn btn-primary btn-sm" disabled={isPending}>{isPending ? 'Đang đăng…' : 'Đăng bài'}</button>
      </div>
    </form>
  );
}
