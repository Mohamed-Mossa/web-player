import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import './i18n';
import { App } from './app/App';
import { initSpatialNav, setSpatialRtl } from './nav/focus';
import { useApp } from './state/app';
import { registerPwa } from './lib/pwa';
import { initNative } from './native/bridge';
import { initAuth } from './cloud/auth';
import { SENTRY_DSN, APP_VERSION, GIT_SHA } from './env';

initSpatialNav(useApp.getState().lang === 'ar');
useApp.subscribe((s, prev) => {
  if (s.lang !== prev.lang) setSpatialRtl(s.lang === 'ar');
});
registerPwa();
initAuth();
if (SENTRY_DSN) {
  import('@sentry/react').then((Sentry) =>
    Sentry.init({ dsn: SENTRY_DSN, release: `${APP_VERSION}+${GIT_SHA}`, tracesSampleRate: 0 }),
  );
}

initNative().finally(() =>
  createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
  ),
);
