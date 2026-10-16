import { useQuery } from '@tanstack/react-query';
import { getTtcdsCapabilities } from '../../api/ttcds.js';
import { useAuth } from '../../app/providers.jsx';

export const TTCDS_FORBIDDEN_MESSAGE = 'Bạn không thuộc Trung tâm Chuyển đổi số.';

export function useTtcdsCapabilities() {
  const auth = useAuth();
  return useQuery({
    queryKey: ['ttcds-capabilities'],
    queryFn: ({ signal }) => getTtcdsCapabilities(auth.token, { signal }),
    enabled: Boolean(auth.token),
    retry: false,
    staleTime: 5 * 60 * 1000
  });
}

export function TtcdsForbiddenNotice() {
  return (
    <section className="card glass-panel" style={{ padding: '30px', margin: '30px auto', maxWidth: '600px', textAlign: 'center' }}>
      <h2>Không có quyền truy cập</h2>
      <p>{TTCDS_FORBIDDEN_MESSAGE}</p>
    </section>
  );
}
