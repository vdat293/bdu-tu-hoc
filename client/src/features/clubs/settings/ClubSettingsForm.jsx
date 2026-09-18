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
      className="club-panel"
      onSubmit={(event) => {
        event.preventDefault();
        save.mutate();
      }}
    >
      <div className="club-panel-heading">
        <div><h2>Thông tin công khai</h2><p>Những gì sinh viên thấy trước khi tham gia.</p></div>
      </div>
      <div className="club-form-grid">
        <label htmlFor="club-name">Tên CLB<input id="club-name" className="form-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required /></label>
        <label htmlFor="club-tag">Tag<input id="club-tag" className="form-input" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })} /></label>
      </div>
      <label htmlFor="club-description">Mô tả<textarea id="club-description" className="form-input" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} /></label>
      <div className="club-settings-actionbar">
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>{save.isPending ? 'Đang lưu…' : 'Lưu thay đổi'}</button>
      </div>
    </form>
  );
}
