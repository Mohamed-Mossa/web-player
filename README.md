# IPTV Player

Cross-platform IPTV player for Android TV (remote/D-pad), desktop, phones and tablets.
One React + TypeScript codebase ships as a PWA and (from phase 3) as a Capacitor app with a native ExoPlayer.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Login (Xtream / M3U), account info, catalog sync, categories, grid, search, details, profiles, Arabic/English | **Done** |
| 2 | Web player (hls.js, mpegts.js), subtitles, resume, next episode, PiP, Cast, AirPlay | Next |
| 3 | Android + Android TV wrapper with Media3 ExoPlayer | |
| 4 | Live TV + EPG (XMLTV), zapping, catch-up, multi-view | |
| 5 | Supabase sync, Cloudflare Worker proxy, Pages deploy, OTA updates | |

The architecture and data model are in the design doc (Claude Docs: "IPTV Player — Architecture & Data Model").

## Repo layout

```text
apps/web/            React + Vite PWA (also the Capacitor web layer from phase 3)
  src/app/           shell, routes, profile gate
  src/features/      home, catalog, details, search, sources, profiles, settings, live
  src/workers/       catalogSync.worker.ts (download + diff into IndexedDB), search.worker.ts (MiniSearch)
  src/db/            Dexie schema (IndexedDB)
  src/nav/           spatial navigation (D-pad / remote / keyboard)
  src/i18n/          en.ts, ar.ts
  e2e/               Playwright tests
packages/core/       Pure TypeScript, no UI: Xtream client, M3U parser, title cleaner,
                     Arabic-aware normalization, diffing, cross-playlist merge (Vitest)
tools/mock-server/   Mock Xtream + M3U + TMDB server with 50k items for development and tests
workers/proxy/       Cloudflare Worker (phase 5)
supabase/            migrations + edge functions (phase 5)
```

## Requirements

- Node.js 22+
- pnpm 10 (`corepack enable` or `npm i -g pnpm`)
- Google Chrome for the e2e tests (or set `CHROME_PATH`)

## Develop

```bash
pnpm install
pnpm mock                         # terminal 1: mock server on http://localhost:4010
pnpm --filter @iptv/web dev:mock  # terminal 2: app on http://localhost:5173
```

In the app, add an Xtream playlist with server `http://localhost:4010`, user `test`, password `test`
(or the M3U link `http://localhost:4010/playlist.m3u`).

Useful URL switches: `?layout=tv` forces the 10-foot TV layout, `?layout=mobile` the phone layout.

### Environment variables (`apps/web/.env*`)

| Variable | Meaning |
| --- | --- |
| `VITE_API_BASE` | Base URL of the Cloudflare Worker (TMDB/OpenSubtitles relay). Empty disables TMDB. |
| `VITE_TMDB_IMG` | TMDB image CDN, default `https://image.tmdb.org/t/p`. |

`.env.mock` points both at the mock server. The provider proxy URL for the web build is set inside the app (Settings → Proxy URL).

## Tests

```bash
pnpm test                          # unit tests (packages/core): parser, title cleaner, Xtream client, diff, search normalization
pnpm --filter @iptv/web typecheck
pnpm e2e                           # Playwright: starts the mock server and the app itself
```

The e2e suite covers: Xtream login with account info and a 50k-item sync, wrong password, M3U → Xtream
upgrade, plain M3U parsing, virtualized grid + filters, hide/rename/reorder categories, typo-tolerant and
Arabic search, details with TMDB data and seasons, favorites, D-pad navigation with Back, PIN profiles,
and Arabic RTL.

## Build

```bash
pnpm build        # apps/web/dist, includes the service worker and web manifest
```

## Deploy (set up in phase 5)

Cloudflare Pages, connected to the GitHub repo:

- Production branch: `main` (every push deploys)
- Build command: `pnpm install --frozen-lockfile && pnpm --filter @iptv/web build`
- Build output directory: `apps/web/dist`
- Environment variables: `VITE_API_BASE` = your Worker URL, `NODE_VERSION` = `22`

The service worker checks for a new deploy every 30 minutes and shows an "update ready" prompt.
Settings shows the app version and the git commit it was built from.

## Security notes

- Playlist credentials are encrypted with AES-GCM using a non-extractable key stored in IndexedDB;
  nothing sensitive goes to localStorage. Stream URLs stored from M3U files have credentials replaced by placeholders.
- Profile PINs are PBKDF2 hashes. They are a parental lock, not a security boundary.
