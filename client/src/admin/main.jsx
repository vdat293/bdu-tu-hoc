import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AdminApp from './AdminApp.jsx';
import './styles/admin.css';

const adminQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 10 * 1000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => error?.status !== 401 && error?.status !== 403 && failureCount < 1
    }
  }
});

createRoot(document.getElementById('admin-root')).render(
  <StrictMode>
    <QueryClientProvider client={adminQueryClient}>
      <AdminApp />
    </QueryClientProvider>
  </StrictMode>
);
