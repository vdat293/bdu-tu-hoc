import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App.jsx';
import { installPreloadErrorRecovery } from './app/chunk-recovery.js';

installPreloadErrorRecovery();

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>);
