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
  const [issued, setIssued] = useState(null);
  const deployment = useQuery({
    queryKey: ['inf1003-deployment', user?.mssv],
    queryFn: ({ signal }) => getInf1003Deployment(token, signal),
    enabled: Boolean(token),
    retry: false
  });
  const issue = useMutation({
    mutationFn: (scriptId) => issueInf1003DeployKey(token, scriptId),
    gcTime: 0,
    onSuccess: setIssued
  });

  useEffect(() => {
    if (!issued) return undefined;
    const delay = Math.max(0, new Date(issued.expiresAt).getTime() - Date.now());
    const timer = window.setTimeout(() => setIssued(null), delay);
    return () => window.clearTimeout(timer);
  }, [issued]);

  const scripts = deployment.data?.scripts ?? [];
  const selected = scripts.find(({ id }) => id === selectedId) ?? scripts[0];
  const currentKey = issued?.scriptId === selected?.id ? issued : null;

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
              <p>Mỗi key dùng một lần trong 10 phút. Tạo key mới sẽ thay key đã cấp trước đó.</p>
              {scripts.length > 1 ? (
                <label className="guide-workdir-label">
                  Script cần chạy{' '}
                  <select className="guide-workdir-input" value={selected.id} disabled={issue.isPending}
                    onChange={(event) => { setSelectedId(event.target.value); issue.reset(); }}>
                    {scripts.map(({ id, label }) => <option key={id} value={id}>{label}</option>)}
                  </select>
                </label>
              ) : <p>Script được cấp key <strong>{selected.label}</strong>.</p>}
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
