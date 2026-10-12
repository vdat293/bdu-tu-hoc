import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from './providers.jsx';
import AppErrorBoundary from './AppErrorBoundary.jsx';
import MaintenanceGate from './MaintenanceGate.jsx';
import AppRoutes from './routes.jsx';
import '../styles/app.css';

export default function App() {
  // MaintenanceGate nằm trong AppProviders (để dùng chung bối cảnh khi cần) nhưng
  // bọc quanh AppRoutes nên phủ được mọi route mà không thêm <Route> nào.
  return <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppErrorBoundary><AppProviders><MaintenanceGate><AppRoutes /></MaintenanceGate></AppProviders></AppErrorBoundary></BrowserRouter>;
}
