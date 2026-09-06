import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../app/providers.jsx';
import { PageSpinner } from '../../components/feedback/Loading.jsx';

export default function RequireAuth({ children }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.status === 'initializing') return <PageSpinner label="Đang khôi phục phiên đăng nhập…" />;
  if (auth.status !== 'authenticated') {
    const returnTo = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to="/login" replace state={{ returnTo }} />;
  }
  return children;
}
