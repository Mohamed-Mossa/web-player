# Samsung TV app (Tizen)

A packaged Tizen web app for Samsung TVs from **2020 onwards** (Tizen 5.5+, Chromium 69 and newer).
It is the same React app as the web version, built for an old engine, and it plays through Samsung's
built-in **AVPlay** player (hardware decoding: MKV, HEVC/H.265, AC3/E-AC3, embedded audio and subtitle
tracks). Providers are contacted directly, so no proxy is needed.

GitHub Actions builds it on every push and attaches `tizen-app.zip` to the **tizen-latest** release.
Samsung only installs apps signed for your TV, so the last step (signing + installing) runs on your computer.

## One-time setup

1. **Tizen Studio** (free): install "Tizen Studio with IDE" (or the CLI-only package) from
   developer.tizen.org. In its **Package Manager** → *Extension SDK*, install **Samsung Certificate Extension**
   (and *TV Extensions* if offered).
2. **TV in Developer Mode**: open *Apps* on the TV, press `1 2 3 4 5` on the remote, switch
   *Developer mode* **On**, enter your computer's IP address, then restart the TV (hold the power button).
   Computer and TV must be on the same network.
3. **Certificate**: Tizen Studio → *Tools* → **Certificate Manager** → `+` → **Samsung** → **TV** →
   name it `iptv` → create an author certificate (any password) → sign in with a Samsung account →
   create the distributor certificate with **your TV's DUID**. To get the DUID, first connect the TV in
   *Device Manager* (Scan / Remote Device Manager → add the TV's IP) and the wizard fills it in.

## Install / update

Windows (PowerShell, from this folder):

```powershell
.\install.ps1 -TvIp 192.168.1.50
```

macOS / Linux:

```bash
./install.sh 192.168.1.50
```

The script downloads the latest `tizen-app.zip`, signs it with the `iptv` certificate profile, connects to
the TV and installs it. Run it again to update. If the repository is private, download `tizen-app.zip` from
the release yourself and pass it: `-Zip .\tizen-app.zip` (PowerShell) or as the second argument (bash).

Note: with a developer certificate the TV may remove the app after a long time; installing again fixes it.

## Build it yourself

```bash
pnpm --filter @iptv/web build:tizen     # → apps/web/tizen-app.zip (unsigned)
```

The build uses the same `VITE_*` variables as the web version (see the main README).

## How it differs from the web build

| | Web | Samsung |
| --- | --- | --- |
| Engine | Chrome 111+ | Chromium 69 (2020), 76 (2021), 85 (2022)… |
| JavaScript | modern ESM | legacy SystemJS bundle + core-js (`@vitejs/plugin-legacy`) |
| CSS | Tailwind v4 | lowered by `apps/web/build/lower-css.mjs` (layers, `:where`, logical props, transforms…) |
| Workers | module workers | classic workers started from Blob URLs (the app runs from `file://`) |
| Player | hls.js / mpegts.js | AVPlay (`src/player/tizenPlayer.ts`) |
| Routing | `/path` | `#/path` |
| Remote | arrows + Enter | plus CH ±, PLAY/PAUSE, numbers, colour keys, INFO, GUIDE, PRE-CH (`src/native/tizen.ts`) |

`node apps/web/scripts/check-tizen.mjs` checks a build for syntax and CSS that Chromium 69 cannot read, and
`e2e/tizen.spec.ts` runs the packaged app from `file://` with AVPlay and the remote stubbed.
