import { BrowserRouter } from 'react-router-dom';
import { AppProviders } from './providers.jsx';
import AppRoutes from './routes.jsx';
import '../styles/app.css';

export default function App() {
  return <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}><AppProviders><AppRoutes /></AppProviders></BrowserRouter>;
}
