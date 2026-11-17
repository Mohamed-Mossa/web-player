import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.mousa.iptvplayer',
  appName: 'IPTV Player',
  webDir: 'dist',
  backgroundColor: '#0b0d12',
  android: {
    // Logos/posters are often plain http; the page itself is served from the app bundle.
    allowMixedContent: true,
    captureInput: true,
  },
  server: {
    androidScheme: 'https',
  },
  plugins: {
    // Native HTTP for fetch/XHR: no CORS, no mixed-content blocking, no proxy needed on Android.
    CapacitorHttp: { enabled: true },
    // Self-hosted over-the-air web bundle updates (see src/native/ota.ts).
    CapacitorUpdater: { autoUpdate: false, appReadyTimeout: 15000, resetWhenUpdate: true },
    LocalNotifications: { iconColor: '#7c5cff' },
  },
};

export default config;
