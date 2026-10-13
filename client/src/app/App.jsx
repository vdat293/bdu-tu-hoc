import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from './providers.jsx';
import AppErrorBoundary from './AppErrorBoundary.jsx';
import AppRoutes from './routes.jsx';
import '../styles/app.css';

// Cổng bảo trì KHÔNG bọc ở đây nữa: trước đây nó phủ toàn bộ <AppRoutes/> nên
// một nhóm bị khoá cũng chặn luôn portal/trang đăng nhập, và người dùng không
// chuyển sang nhóm khác được. Nay nó nằm trong AppLayout quanh <Outlet/> nên chỉ
// thay vùng nội dung, giữ sidebar/topbar (xem client/src/layouts/AppLayout.jsx).
export default function App() {
  return <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppErrorBoundary><AppProviders><AppRoutes /></AppProviders></AppErrorBoundary></BrowserRouter>;
}