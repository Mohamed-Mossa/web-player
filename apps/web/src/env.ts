declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_TIME__: string;

export const APP_VERSION = __APP_VERSION__;
export const GIT_SHA = __GIT_SHA__;
export const BUILD_TIME = __BUILD_TIME__;

/** Base URL of the Cloudflare Worker (proxy + TMDB/OpenSubtitles relay). Empty = direct requests. */
export const API_BASE: string = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** TMDB image CDN. The mock server serves its own images in development. */
export const TMDB_IMG: string =
  (import.meta.env.VITE_TMDB_IMG as string | undefined)?.replace(/\/$/, '') ?? 'https://image.tmdb.org/t/p';

/** Proxy for provider requests on the web build (normally the same Worker). Empty = direct. */
export const PROXY_BASE: string = (import.meta.env.VITE_PROXY_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** Where the Android app looks for over-the-air web bundles (the Pages site). */
export const OTA_BASE: string = (import.meta.env.VITE_OTA_BASE as string | undefined)?.replace(/\/$/, '') ?? '';

/** Bump when the web code starts needing newer native (Java) code; must match TvBridgePlugin.NATIVE_API. */
export const NATIVE_API = 1;

export const SUPABASE_URL: string = (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? '';
export const SUPABASE_ANON_KEY: string = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ?? '';
export const SENTRY_DSN: string = (import.meta.env.VITE_SENTRY_DSN as string | undefined) ?? '';
/** Public address of the web app (used in the TV sign-in QR code). */
export const APP_URL: string = ((import.meta.env.VITE_APP_URL as string | undefined) ?? (typeof location !== 'undefined' ? location.origin : '')).replace(/\/$/, '');
