import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { getInf1003Deployment, issueInf1003DeployKey } from '../../../../api/guides.js';
import { useAuth } from '../../../../app/providers.jsx';
import BlockCopy from '../BlockCopy.jsx';
import GuideLayout from '../GuideLayout.jsx';

export default function DeployLessonPage() {
  const { token, user } = useAuth();
  const [selectedId, setSelectedId] = useState('');
  const [issuedKeys, setIssuedKeys] = useState(() => new Map());
  const deployment = useQuery({
    queryKey: ['inf1003-deployment', user?.mssv],
    queryFn: ({ signal }) => getInf1003Deployment(token, signal),
    enabled: Boolean(token),
    retry: false
  });
  const issue = useMutation({
    mutationFn: (scriptId) => issueInf1003DeployKey(token, scriptId),
    gcTime: 0,
    onSuccess: (issued) => setIssuedKeys((keys) => new Map(keys).set(issued.scriptId, issued))
  });

  useEffect(() => {
    if (!issuedKeys.size) return undefined;
    const nextExpiry = Math.min(...Array.from(issuedKeys.values(), ({ expiresAt }) => Date.parse(expiresAt)));
    const timer = window.setTimeout(() => {
      const now = Date.now();
      setIssuedKeys((keys) => new Map([...keys].filter(([, { expiresAt }]) => Date.parse(expiresAt) > now)));
    }, Math.max(0, nextExpiry - Date.now()));
    return () => window.clearTimeout(timer);
  }, [issuedKeys]);

  const scripts = deployment.data?.scripts ?? [];
  const selected = scripts.find(({ id }) => id === selectedId) ?? scripts[0];
  const currentKey = issuedKeys.get(selected?.id);

  return (
    <GuideLayout courseCode="INF1003">
      <article className="guide-step">
        <section className="guide-step-card glass-panel">
          <Link to="/learning/INF1003/guides">← Hướng dẫn thực hành</Link>
          <h1 className="guide-step-title">Bài 2 — Triển khai ứng dụng bằng key</h1>
          {deployment.isLoading && <p role="status">Đang kiểm tra quyền truy cập…</p>}
          {deployment.isError && (
            <div role="alert">
              <p>{deployment.error.message}</p>
              <button type="button" className="btn btn-secondary" onClick={() => deployment.refetch()}>Tải lại</button>
            </div>
          )}
          {selected && !deployment.isError && (
            <>
              <p>Chạy file <code>start-gk.sh</code> đã được cung cấp riêng, rồi dán key vào terminal khi được hỏi.</p>
              <p>Mỗi thao tác có key riêng, dùng một lần trong 10 phút. Tạo lại chỉ thay key của thao tác đang chọn.</p>
              {scripts.length > 1 ? (
                <fieldset className="guide-deploy-actions" disabled={issue.isPending}>
                  <legend>Chọn thao tác</legend>
                  {scripts.map(({ id, label }) => (
                    <label className="guide-deploy-choice" key={id}>
                      <input type="radio" name="deploy-action" value={id} checked={id === selected.id}
                        onChange={() => { setSelectedId(id); issue.reset(); }} />
                      <span>{label}</span>
                    </label>
                  ))}
                </fieldset>
              ) : <p>Thao tác được cấp key <strong>{selected.label}</strong>.</p>}
              {selected.id === 'thi-gk-clean' && (
                <p>Khi dùng key xóa, chạy launcher trong cùng thư mục <code>thi-gk</code> đã dùng để dựng web.</p>
              )}
              <div className="guide-step-actions">
                <button type="button" className="btn btn-primary" disabled={issue.isPending}
                  onClick={() => issue.mutate(selected.id)}>
                  {issue.isPending ? 'Đang tạo…' : currentKey ? 'Tạo key mới' : 'Tạo key'}
                </button>
              </div>
              {issue.isError && <p className="guide-workdir-error" role="alert">{issue.error.message}</p>}
              {currentKey && (
                <div className="guide-lab-saved">
                  <code className="guide-deploy-key">{currentKey.key}</code>{' '}
                  <BlockCopy text={currentKey.key} label="Sao chép key" />
                  <p>Key hết hạn lúc <time dateTime={currentKey.expiresAt}>{new Date(currentKey.expiresAt).toLocaleTimeString('vi-VN')}</time>.</p>
                </div>
              )}
              {!deployment.data.deliveryConfigured && <p role="status">Bạn có thể tạo key. Máy chủ chưa cấu hình kho script để giao file.</p>}
            </>
          )}
        </section>
      </article>
    </GuideLayout>
  );
}
