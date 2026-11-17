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
