import { useState } from 'react';
import { ClubAvatar } from './ClubPrimitives.jsx';

const MODES = [
  { id: 'discussion', label: 'Thảo luận' },
  { id: 'poll', label: 'Bình chọn' },
  { id: 'material', label: 'Tài liệu' }
];

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

  const handleSubmit = (event) => {
    event?.preventDefault();
    onSubmit?.(
      {
        mode,
        title: title.trim(),
        content: content.trim(),
        url: url.trim(),
        question: question.trim(),
        options: options.map((item) => item.trim()).filter(Boolean)
      },
      { reset }
    );
  };

  if (!expanded) {
    return (
      <button type="button" className="clb-composer-trigger" onClick={() => setExpanded(true)}>
        <ClubAvatar name={user?.name} size="sm" />
        <span className="clb-composer-trigger__copy">
          <strong>Chia sẻ với CLB</strong>
          <span>Đăng câu hỏi, cập nhật hoặc tài liệu học tập…</span>
        </span>
      </button>
    );
  }

  return (
    <form className="clb-composer" onSubmit={handleSubmit}>
      <div className="clb-segmented" role="group" aria-label="Loại bài đăng">
        {MODES.filter((item) => item.id !== 'poll' || canPoll).map((item) => (
          <button
            key={item.id}
            type="button"
            className={mode === item.id ? 'is-active' : ''}
            aria-pressed={mode === item.id}
            onClick={() => setMode(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {mode === 'poll' ? (
        <>
          <label className="clb-field">
            <span>Câu hỏi bình chọn</span>
            <input
              className="clb-input"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              maxLength={280}
              placeholder="Ví dụ: Ôn thi cuối kỳ vào tối nào?"
            />
          </label>
          {options.map((option, index) => (
            <label className="clb-field" key={index}>
              <span>Phương án {index + 1}</span>
              <input
                className="clb-input"
                value={option}
                onChange={(event) => setOptions((cur) => cur.map((v, i) => (i === index ? event.target.value : v)))}
                maxLength={140}
              />
            </label>
          ))}
          <div>
            <button
              type="button"
              className="clb-btn clb-btn--secondary clb-btn--sm"
              onClick={() => setOptions((cur) => (cur.length >= 6 ? cur : [...cur, '']))}
              disabled={options.length >= 6}
            >
              + Thêm phương án
            </button>
          </div>
          <label className="clb-field">
            <span>Ghi chú thêm (tùy chọn)</span>
            <textarea
              className="clb-textarea"
              rows={2}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={2000}
            />
          </label>
        </>
      ) : (
        <>
          <label className="clb-field">
            <span>Tiêu đề</span>
            <input
              className="clb-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={180}
              placeholder="Ví dụ: Tìm bạn ôn thi cuối kỳ"
            />
          </label>
          <label className="clb-field">
            <span>Nội dung</span>
            <textarea
              className="clb-textarea"
              rows={4}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              maxLength={5000}
              placeholder="Chia sẻ câu hỏi, cập nhật hoặc lời mời học nhóm…"
              autoFocus
            />
          </label>
          <label className="clb-field">
            <span>Liên kết tài liệu (tùy chọn)</span>
            <input
              className="clb-input"
              type="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://drive.google.com/… hoặc YouTube"
            />
          </label>
        </>
      )}

      <div className="clb-composer__actions">
        <button type="button" className="clb-btn clb-btn--secondary clb-btn--sm" onClick={reset}>
          Thu gọn
        </button>
        <button type="submit" className="clb-btn clb-btn--primary clb-btn--sm" disabled={isPending}>
          {isPending ? 'Đang đăng…' : 'Đăng bài'}
        </button>
      </div>
    </form>
  );
}
