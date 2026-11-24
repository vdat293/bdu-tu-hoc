import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../app/providers.jsx';
import { findRouteMeta } from './navigation.js';
import {
  configureTelemetry,
  installTelemetryListeners,
  trackPageView
} from '../services/telemetry.js';

export default function TelemetryBridge() {
  const auth = useAuth();
  const location = useLocation();

  useEffect(() => {
    configureTelemetry({
      token: auth?.status === 'authenticated' ? auth.token : null
    });
  }, [auth?.status, auth?.token]);

  useEffect(() => installTelemetryListeners(), []);

  useEffect(() => {
    const meta = findRouteMeta(location.pathname);
    trackPageView(location.pathname, meta?.title || '');
  }, [location.pathname]);

  return null;
}
