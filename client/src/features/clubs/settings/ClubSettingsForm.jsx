import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateClan } from '../../../api/community.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import { cleanTag } from '../lib/format.js';

export default function ClubSettingsForm({ club }) {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [draft, setDraft] = useState({ name: '', description: '', tag: '' });

  useEffect(() => {
    if (club) setDraft({ name: club.name || '', description: club.description || '', tag: cleanTag(club.tag) });
  }, [club]);

  const save = useMutation({
    mutationFn: () => updateClan(auth.token, club.id, draft),
    onSuccess: () => {
      client.invalidateQueries({ queryKey: ['clans'] });
      notify('Đã lưu thông tin CLB.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  return (
    <form
      className="clb-surface clb-form"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="clb-panel-head" style={{ marginBottom: 0 }}>
        <div>
          <h2>Thông tin công khai</h2>
          <p>Những gì sinh viên nhìn thấy trước khi tham gia CLB.</p>
        </div>
      </div>

      <div className="clb-form-row">
        <label className="clb-field" htmlFor="club-name">
          <span>Tên CLB</span>
          <input
            id="club-name"
            className="clb-input"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            required
          />
        </label>
        <label className="clb-field" htmlFor="club-tag">
          <span>Tag</span>
          <input
            id="club-tag"
            className="clb-input"
            value={draft.tag}
            onChange={(event) => setDraft({ ...draft, tag: event.target.value })}
          />
        </label>
      </div>

      <label className="clb-field" htmlFor="club-description">
        <span>Mô tả</span>
        <textarea
          id="club-description"
          className="clb-textarea"
          rows={3}
          value={draft.description}
          onChange={(event) => setDraft({ ...draft, description: event.target.value })}
        />
      </label>

      <div className="clb-settings-bar">
        <button type="submit" className="clb-btn clb-btn--primary" disabled={save.isPending}>
          {save.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}
        </button>
      </div>
    </form>
  );
}
