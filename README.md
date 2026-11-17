# IPTV Player

Cross-platform IPTV player for Android TV and Samsung TVs (remote/D-pad), desktop, phones and tablets.
One React + TypeScript codebase ships as a PWA (desktop, iPhone/iPad, any browser), as an Android app
(phones, tablets, Android TV) that plays through Media3 ExoPlayer, and as a Samsung TV app (Tizen, 2020+)
that plays through Samsung's AVPlay.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Xtream/M3U login, account info, catalog sync (Web Worker → IndexedDB), categories, virtual grid, search, TMDB details, profiles, Arabic/English RTL | Done |
| 2 | Web player: hls.js / mpegts.js, tracks, subtitles (SRT/VTT/OpenSubtitles), resume, next episode, PiP, Cast, AirPlay, sleep timer, auto-reconnect | Done |
| 3 | Android + Android TV app: ExoPlayer under a transparent WebView, FFmpeg audio, remote keys, voice search, frame-rate matching, OTA updates | Done (built by GitHub Actions) |
| 4 | Live TV: XMLTV guide, now/next, zapping, catch-up, channel groups, reminders, multi-view | Done |
| 5 | Supabase sync, TV sign-in by QR, Send to TV, encrypted backup, proxy Worker, Pages deploy | Done (needs your accounts, see Setup) |
| + | Samsung TV app: Chromium 69 build (legacy JS, lowered CSS), AVPlay player, Samsung remote keys, install scripts | Done (built by GitHub Actions; install from your PC) |

The architecture and data model are in the design doc ("IPTV Player — Architecture & Data Model").

## Repo layout

```text
apps/web/              React + Vite app (PWA + Capacitor web layer)
  src/player/          PlayerAdapter, WebPlayer (hls.js/mpegts.js/<video>), NativePlayer (ExoPlayer bridge), player UI
  src/features/        home, catalog, details, search, live (list, guide, live player, multi-view), sources, profiles, settings, account
  src/workers/         catalog sync, EPG import, search index
  src/cloud/           Supabase auth, sync engine (outbox + pull), backup, devices / remote commands
  src/native/          Android bridge (back button, TV detection, voice search, OTA updates), Samsung remote keys
  build/               Samsung build: Vite plugin, CSS lowering for Chromium 69 (+ tests)
  android/             Capacitor Android project; ExoPlayerPlugin.java, TvBridgePlugin.java, MainActivity.java
  e2e/                 Playwright tests (28)
apps/tizen/            Samsung TV package: config.xml, icon, install.ps1 / install.sh, setup guide
packages/core/         Pure TypeScript: Xtream client, M3U + XMLTV streaming parsers, title cleaner, subtitles,
                       Arabic-aware search normalization, diffing, sync merge rules (71 tests)
workers/proxy/         Cloudflare Worker: locked proxy (signed tokens), HLS rewrite, TMDB + OpenSubtitles relay (9 tests)
supabase/              SQL migration with row-level security (6 tests on PGlite), edge functions (secrets, device-login)
tools/mock-server/     Mock Xtream/M3U/XMLTV/TMDB/OpenSubtitles server with real test streams (needs ffmpeg)
.github/workflows/     ci.yml (tests + e2e), android.yml (APK → "android-latest" release),
                       tizen.yml (Samsung app → "tizen-latest" release), worker.yml (deploy Worker)
```

## Develop

Requirements: Node.js 22+, pnpm 10, ffmpeg (for the mock server's test streams), Google Chrome (e2e).

```bash
pnpm install
pnpm mock                         # terminal 1: mock server on http://localhost:4010
pnpm --filter @iptv/web dev:mock  # terminal 2: app on http://localhost:5173
```

Add an Xtream playlist with server `http://localhost:4010`, user `test`, password `test`
(or the M3U link `http://localhost:4010/playlist.m3u`). `?layout=tv` forces the 10-foot layout.

### Tests

```bash
pnpm test        # unit + integration: core (71), proxy (9), RLS on Postgres (6), sync engine + Samsung CSS (11)
pnpm typecheck
pnpm e2e         # 28 Playwright tests; starts the mock server and the app itself
                 # (the Samsung test needs `pnpm --filter @iptv/web build:tizen:mock` first)
```

## Setup and deploy

You need free accounts on **Supabase**, **Cloudflare**, **TMDB** and (optionally) **OpenSubtitles** and **Sentry**.

### 1. Supabase (sync + sign-in)

1. Create a project at supabase.com. Note the **Project URL**, **anon key** and **project ref**.
2. Authentication → URL configuration: set **Site URL** to your Pages URL (step 3), e.g. `https://web-player.pages.dev`.
3. Apply the schema and deploy the functions (Supabase CLI):
   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase db push
   npx supabase secrets set SECRETS_KEY=$(openssl rand -base64 32)
   npx supabase functions deploy secrets
   npx supabase functions deploy device-login --no-verify-jwt
   ```
4. Create your user: open the app → Settings → Account & sync → Create account.

### 2. Cloudflare Worker (proxy for the web version + TMDB/OpenSubtitles)

```bash
cd workers/proxy
npx wrangler login
npx wrangler secret put TOKEN_SECRET          # any long random string
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put ALLOWED_USERS         # your Supabase user id or email (comma-separated)
npx wrangler secret put TMDB_API_KEY          # themoviedb.org → Settings → API
npx wrangler secret put OPENSUBTITLES_API_KEY # optional, opensubtitles.com → API consumers
npx wrangler deploy
```

Edit `ALLOWED_ORIGINS` in `wrangler.toml` to your Pages URL. The Worker refuses any request without a
token, and it only gives tokens to users in `ALLOWED_USERS`, so it is not an open proxy. It sets
`allow_custom_ports`, so providers on ports like 8080 or 25461 work. Optional: add `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` as GitHub secrets and `worker.yml` deploys on every change.

### 3. Cloudflare Pages (web app, auto-deploy on every push to main)

Workers & Pages → Create → Pages → Connect to Git → `Mohamed-Mossa/web-player`:

- Production branch: `main`
- Build command: `pnpm install --frozen-lockfile && pnpm --filter @iptv/web build`
- Build output directory: `apps/web/dist`
- Environment variables:

| Name | Value |
| --- | --- |
| `NODE_VERSION` | `22` |
| `VITE_API_BASE` | Worker URL, e.g. `https://iptv-proxy.<you>.workers.dev` |
| `VITE_PROXY_BASE` | same Worker URL |
| `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` | from step 1 |
| `VITE_APP_URL` | your Pages URL (used in the TV sign-in QR code) |
| `VITE_OTA_BASE` | your Pages URL (Android app updates) |
| `VITE_SENTRY_DSN` | optional |

Every push to `main` deploys. Open browsers pick up the new service worker within 30 minutes and show a
"new version" prompt. Settings shows the version and the commit it was built from.

### 4. Android APK

GitHub Actions builds the APK on every push and attaches it to the **android-latest** release:
`https://github.com/Mohamed-Mossa/web-player/releases/download/android-latest/iptv-player.apk`

- Add the same `VITE_*` values as GitHub **repository variables** (Settings → Secrets and variables →
  Actions → Variables) named `API_BASE`, `OTA_BASE`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `APP_URL`, `SENTRY_DSN`.
- Add the signing key as **secrets**: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_PASSWORD`, `ANDROID_KEY_ALIAS`. Without them the APK is debug-signed, and each build then
  needs an uninstall before installing.
- Install on Android TV: use the "Downloader" app (or `adb install iptv-player.apk`) with the link above.
- After the first install, web changes reach the app as OTA bundles from Pages (`/ota/version.json`), so you
  do not reinstall. Java/native changes need a new APK; bump `NATIVE_API` in `src/env.ts` and
  `TvBridgePlugin.java` when the web code starts needing them.

### 5. Samsung TV (2020 and newer)

GitHub Actions builds `tizen-app.zip` on every push and attaches it to the **tizen-latest** release. Samsung
only installs apps signed for your TV, so signing and installing run on your computer with Tizen Studio:
one-time setup (Developer Mode, Samsung certificate) and the install command are in
[apps/tizen/README.md](apps/tizen/README.md). Also set the repository variable `APP_URL` (your Pages address)
so the TV's "sign in with your phone" QR code points to the right site.

## Notes

- **Codecs.** Browsers cannot play most MKV, AC3/DTS or HEVC streams; the web player says so and suggests the
  Android app. ExoPlayer plays them, with FFmpeg audio decoders (Jellyfin's `media3-ffmpeg-decoder`, GPL-3.0). Samsung's AVPlay
  plays MKV/HEVC/AC3/E-AC3 in hardware; DTS audio is not supported on most Samsung models from 2018 on.
- **Proxy.** Only the web build uses the proxy. The Android and Samsung apps connect directly (a proxy can
  still be typed in Settings on the Samsung app if a provider needs one).
  Cloudflare's terms limit serving video through Workers on free plans; heavy web viewing may need Workers Paid.
- **Chromecast.** Works from Chrome (desktop/Android browser). Inside the Android app the Cast button is
  hidden; use "Send to TV" between your own devices instead.
- **Credentials** are AES-GCM encrypted on the device (non-extractable key) and in Supabase (server key in the
  `secrets` function, bound to the user id). Backups are encrypted with your passphrase. PINs are PBKDF2 hashes
  (a parental lock, not a security boundary).
