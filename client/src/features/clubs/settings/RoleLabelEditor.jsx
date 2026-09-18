import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateClanRoles } from '../../../api/community.js';
import { useAuth, useToasts } from '../../../app/providers.jsx';
import RoleBadge from '../components/RoleBadge.jsx';
import { DEFAULT_LABELS, ROLE_ORDER } from '../lib/roles.js';

function normalizeInitial(roleLabels) {
  // Nhận cả map { role_key: { display_name|name, color } } (từ GET /clans)
  // lẫn mảng [{ role_key, display_name, color }] (từ GET /roles).
  const byKey = {};
  if (Array.isArray(roleLabels)) {
    for (const item of roleLabels) {
      const key = String(item?.role_key ?? item?.role ?? item?.key ?? '');
      if (key) byKey[key] = item;
    }
  } else if (roleLabels && typeof roleLabels === 'object') {
    Object.assign(byKey, roleLabels);
  }
  const next = {};
  for (const role of ROLE_ORDER) {
    const fallback = DEFAULT_LABELS[role];
    const entry = byKey[role];
    if (typeof entry === 'string') next[role] = { name: entry, color: fallback.color };
    else if (entry && typeof entry === 'object') {
      next[role] = {
        name: String(entry.display_name ?? entry.name ?? entry.label ?? fallback.name),
        color: String(entry.color ?? fallback.color)
      };
    } else next[role] = { ...fallback };
  }
  return next;
}

// List 5 roles: preview badge live + input tên 2-20 ký tự + color input
// + validate trùng tên, nút Lưu gọi PUT /roles.
export default function RoleLabelEditor({ clanId, initialLabels }) {
  const auth = useAuth();
  const { notify } = useToasts();
  const client = useQueryClient();
  const [labels, setLabels] = useState(() => normalizeInitial(initialLabels));
  const [touched, setTouched] = useState(false);

  const errors = useMemo(() => {
    const result = {};
    const seen = new Map();
    for (const role of ROLE_ORDER) {
      const name = String(labels[role]?.name || '').trim();
      if (name.length < 2 || name.length > 20) {
        result[role] = 'Tên vai trò phải từ 2–20 ký tự.';
        continue;
      }
      const key = name.toLocaleLowerCase('vi-VN');
      if (seen.has(key)) {
        result[role] = `Trùng tên với vai trò ${seen.get(key)}.`;
      } else {
        seen.set(key, role);
      }
    }
    return result;
  }, [labels]);
  const hasError = Object.keys(errors).length > 0;

  const save = useMutation({
    // PUT /api/community/clans/:id/roles nhận { roles: [{ role_key, display_name, color }] }.
    mutationFn: (roles) => updateClanRoles(auth.token, clanId, roles),
    onSuccess: () => {
      setTouched(false);
      client.invalidateQueries({ queryKey: ['clans'] });
      notify('Đã lưu tên hiển thị vai trò.', 'success');
    },
    onError: (error) => notify(error.message, 'error')
  });

  const previewMap = useMemo(() => {
    const map = {};
    for (const role of ROLE_ORDER) map[role] = { name: labels[role].name.trim() || DEFAULT_LABELS[role].name, color: labels[role].color };
    return map;
  }, [labels]);

  return (
    <section className="club-panel" aria-label="Tên hiển thị vai trò">
      <div className="club-panel-heading">
        <div><h2>Tên hiển thị vai trò</h2><p>Tùy chỉnh tên và màu badge cho 5 vai trò trong CLB.</p></div>
      </div>
      <div className="club-role-editor">
        {ROLE_ORDER.map((role) => (
          <div className="club-role-row" key={role}>
            <div className="club-role-row__preview">
              <RoleBadge role={role} roleLabels={previewMap} />
              <code>{role}</code>
            </div>
            <label>Tên hiển thị
              <input
                className="form-input"
                value={labels[role].name}
                minLength={2}
                maxLength={20}
                onChange={(event) => {
                  setTouched(true);
                  setLabels((cur) => ({ ...cur, [role]: { ...cur[role], name: event.target.value } }));
                }}
              />
            </label>
            <label>Màu
              <input
                type="color"
                className="club-color-input"
                value={/^#[0-9a-fA-F]{6}$/.test(labels[role].color) ? labels[role].color : DEFAULT_LABELS[role].color}
                onChange={(event) => {
                  setTouched(true);
                  setLabels((cur) => ({ ...cur, [role]: { ...cur[role], color: event.target.value } }));
                }}
              />
            </label>
            {errors[role] && <p className="club-field-error" role="alert">{errors[role]}</p>}
          </div>
        ))}
      </div>
      <div className="club-settings-actionbar">
        <button
          type="button"
          className="btn btn-primary"
          disabled={save.isPending || hasError || !touched}
          onClick={() => {
            const roles = ROLE_ORDER.map((role) => ({ role_key: role, display_name: labels[role].name.trim(), color: labels[role].color }));
            save.mutate(roles);
          }}
        >
          {save.isPending ? 'Đang lưu…' : 'Lưu tên vai trò'}
        </button>
      </div>
      {hasError && <p className="club-muted">Khắc phục lỗi trùng tên / độ dài trước khi lưu.</p>}
    </section>
  );
}
