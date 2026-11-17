// Mock Xtream Codes + M3U + TMDB server for local development and e2e tests.
// Usage: node tools/mock-server/server.mjs [--port 4010] [--movies 30000] [--series 8000] [--live 12000]
import http from 'node:http';
import { URL, fileURLToPath } from 'node:url';
import { createReadStream, readdirSync, statSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { makeMedia } from './make-media.mjs';
import { gzipSync } from 'node:zlib';

const MEDIA = join(dirname(fileURLToPath(import.meta.url)), 'media');
makeMedia(MEDIA);
const LIVE_SEGS = readdirSync(join(MEDIA, 'live')).filter((f) => f.endsWith('.ts')).sort();
const SEG_DUR = 2;

const arg = (name, def) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : def;
};
const PORT = arg('port', 4010);
const N_MOVIES = arg('movies', 30000);
const N_SERIES = arg('series', 8000);
const N_LIVE = arg('live', 12000);
const USER = 'test';
const PASS = 'test';
const BASE = `http://localhost:${PORT}`;

// deterministic PRNG
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (a) => a[Math.floor(rnd() * a.length)];

const EN = ['The Matrix', 'Inception', 'Interstellar', 'The Dark Knight', 'Dune: Part Two', 'Oppenheimer', 'Spider-Man: No Way Home',
  'Blade Runner 2049', 'Mission: Impossible - Dead Reckoning', 'Gladiator', 'The Godfather', 'Parasite', 'Joker', 'Avatar',
  'Top Gun: Maverick', 'The Batman', 'Arrival', 'Whiplash', 'Mad Max: Fury Road', 'Glass Onion', 'Amélie', 'Coco', 'Up',
  'Inside Out', 'Frozen', 'Titanic', 'Heat', 'Se7en', 'Fight Club', 'Prisoners', 'Sicario', 'The Prestige', 'Memento'];
const AR = ['الفيل الأزرق', 'باب الحديد', 'الكيت كات', 'عمارة يعقوبيان', 'تيتو', 'الجزيرة', 'اللمبي', 'صعيدي في الجامعة الأمريكية',
  'إبراهيم الأبيض', 'كيرة والجن', 'ولاد رزق', 'الممر', 'الفيل الأزرق ٢', 'سهر الليالي', 'عسل إسود', 'الإرهاب والكباب'];
const SERIES_EN = ['Breaking Bad', 'The Office', 'Game of Thrones', 'Ted Lasso', 'Severance', 'The Bear', 'Dark', 'Narcos', 'Succession', 'Chernobyl'];
const SERIES_AR = ['الحشاشين', 'الاختيار', 'جعفر العمدة', 'لن أعيش في جلباب أبي', 'ليالي الحلمية', 'رأفت الهجان', 'الكبير أوي', 'نيران صديقة'];
const CHANNELS = ['MBC 1', 'MBC 2', 'MBC Masr', 'beIN SPORTS 1', 'beIN SPORTS 2', 'Al Jazeera', 'CBC', 'ON E', 'DMC', 'Rotana Cinema',
  'OSN Movies', 'Nile Drama', 'Al Hayah', 'Sky News Arabia', 'BBC Arabic', 'CNN', 'Fox News', 'Discovery', 'Nat Geo', 'Cartoon Network'];
const PREFIX = ['HQ | ', 'AR - ', '|EN| ', '4K-AR | ', 'VIP | ', 'NF - ', '', '', '', '[AR] '];
const SUFFIX = [' [MULTI-SUB]', ' FHD', ' 4K', ' HDR', '', '', '', ' مترجم'];
const GENRES = ['Action', 'Drama', 'Comedy', 'Sci-Fi', 'Thriller', 'Animation', 'Horror', 'Romance', 'Crime', 'Family'];
const CAT_MOVIE = ['Arabic Movies', 'English Movies', 'Netflix', '4K Movies', 'Kids', 'Turkish Movies', 'Indian Movies', 'Classic', 'Ramadan', 'Recently Added'];
const CAT_SERIES = ['Arabic Series', 'English Series', 'Turkish Series', 'Netflix Series', 'Kids Series', 'Documentary'];
const CAT_LIVE = ['AR | General', 'AR | News', 'AR | Sports', 'EN | Movies', 'EN | News', 'Kids', 'Documentary', 'Music', 'Religious', '24/7'];

const cats = (names, offset) => names.map((n, i) => ({ category_id: String(offset + i), category_name: n, parent_id: 0 }));
const vodCats = cats(CAT_MOVIE, 100);
const seriesCats = cats(CAT_SERIES, 200);
const liveCats = cats(CAT_LIVE, 300);

const NOW = 1763300000; // fixed "now" (Nov 2025) so data is stable
const movies = [];
for (let i = 0; i < N_MOVIES; i++) {
  const arabic = rnd() < 0.35;
  const base = arabic ? pick(AR) : pick(EN);
  const year = 1960 + Math.floor(rnd() * 66);
  const yearPart = rnd() < 0.7 ? ` (${year})` : rnd() < 0.5 ? ` ${year}` : '';
  const name = `${pick(PREFIX)}${base}${i > EN.length + AR.length ? ` ${i}` : ''}${yearPart}${pick(SUFFIX)}`;
  movies.push({
    num: i + 1, name, stream_type: 'movie', stream_id: 10000 + i,
    stream_icon: `${BASE}/img/m/${10000 + i}.svg`,
    rating: rnd() < 0.15 ? '' : (3 + rnd() * 6.5).toFixed(1),
    rating_5based: 0,
    added: String(NOW - Math.floor(rnd() * 3 * 365 * 86400)),
    category_id: pick(vodCats).category_id,
    container_extension: pick(['mp4', 'mkv', 'mp4', 'avi']),
    genre: `${pick(GENRES)}, ${pick(GENRES)}`,
    tmdb: rnd() < 0.4 ? String(1000 + (i % 5000)) : '',
  });
}
// a few stable, searchable titles for tests
Object.assign(movies[0], { name: 'HQ | The Matrix (1999)', tmdb: '603', added: String(NOW) });
Object.assign(movies[1], { name: 'AR - الفيل الأزرق (2014)', tmdb: '', added: String(NOW - 10) });
Object.assign(movies[2], { name: '|EN| Interstellar 2014 FHD', tmdb: '157336', added: String(NOW - 20), container_extension: 'm3u8' });

const series = [];
for (let i = 0; i < N_SERIES; i++) {
  const arabic = rnd() < 0.4;
  const base = arabic ? pick(SERIES_AR) : pick(SERIES_EN);
  const name = `${pick(PREFIX)}${base}${i > 20 ? ` ${i}` : ''}${rnd() < 0.5 ? ` (${1990 + Math.floor(rnd() * 36)})` : ''}`;
  series.push({
    num: i + 1, name, series_id: 50000 + i, cover: `${BASE}/img/s/${50000 + i}.svg`,
    plot: 'A gripping story told across several seasons.', cast: 'Actor One, Actor Two', director: 'Director Name',
    genre: `${pick(GENRES)} / ${pick(GENRES)}`, releaseDate: `${1990 + Math.floor(rnd() * 36)}-01-01`,
    last_modified: String(NOW - Math.floor(rnd() * 2 * 365 * 86400)),
    rating: (4 + rnd() * 5).toFixed(1), rating_5based: 0, backdrop_path: [], youtube_trailer: '',
    category_id: pick(seriesCats).category_id,
  });
}
Object.assign(series[0], { name: 'EN - Breaking Bad (2008)', last_modified: String(NOW) });
Object.assign(series[1], { name: 'AR | الحشاشين (2024)' });

const live = [];
for (let i = 0; i < N_LIVE; i++) {
  const ch = pick(CHANNELS);
  live.push({
    num: i + 1, name: `${pick(['AR | ', 'EN | ', '', 'AR: '])}${ch}${i >= CHANNELS.length ? ` ${i}` : ''}${pick([' HD', ' FHD', '', ' SD'])}`,
    stream_type: 'live', stream_id: 1000 + i, stream_icon: `${BASE}/img/l/${1000 + i}.svg`,
    epg_channel_id: `${ch.toLowerCase().replace(/\s+/g, '')}.${i}`, added: String(NOW),
    category_id: pick(liveCats).category_id, tv_archive: i % 7 === 0 ? 1 : 0, tv_archive_duration: i % 7 === 0 ? '3' : '0',
  });
}
Object.assign(live[0], { name: 'AR | MBC 1 HD', num: 1 });

const seriesById = new Map(series.map((s) => [String(s.series_id), s]));

function seriesInfo(id) {
  const s = seriesById.get(String(id));
  if (!s) return { seasons: [], info: {}, episodes: {} };
  const n = 1 + (Number(id) % 4);
  const episodes = {};
  const seasons = [];
  for (let season = 1; season <= n; season++) {
    seasons.push({ season_number: season, name: `Season ${season}`, episode_count: 8 });
    episodes[season] = Array.from({ length: 8 }, (_, e) => ({
      id: String(Number(id) * 100 + season * 10 + e + 1), episode_num: e + 1, season,
      title: `${s.name} S${String(season).padStart(2, '0')}E${String(e + 1).padStart(2, '0')}`,
      container_extension: 'mp4', info: { duration_secs: 2400 + e * 60, plot: `Episode ${e + 1} of season ${season}.` },
    }));
  }
  return { seasons, info: { name: s.name, plot: s.plot, cast: s.cast, director: s.director, genre: s.genre, backdrop_path: [], rating: s.rating }, episodes };
}

function userInfo() {
  return {
    user_info: {
      username: USER, password: PASS, message: 'Welcome', auth: 1, status: 'Active',
      exp_date: String(Math.floor(Date.now() / 1000) + 5 * 86400), // expires in 5 days → triggers the warning
      is_trial: '0', active_cons: '0', created_at: '1700000000', max_connections: '2',
      allowed_output_formats: ['m3u8', 'ts'],
    },
    server_info: { url: 'localhost', port: String(PORT), https_port: '', server_protocol: 'http', timezone: 'Africa/Cairo', timestamp_now: Math.floor(Date.now() / 1000) },
  };
}

function m3u() {
  const lines = [`#EXTM3U x-tvg-url="${BASE}/xmltv.php?username=${USER}&password=${PASS}"`];
  for (const c of live.slice(0, 2000)) {
    const cat = liveCats.find((x) => x.category_id === c.category_id).category_name;
    lines.push(`#EXTINF:-1 tvg-id="${c.epg_channel_id}" tvg-name="${c.name}" tvg-logo="${c.stream_icon}" group-title="${cat}",${c.name}`, `${BASE}/live/${USER}/${PASS}/${c.stream_id}.ts`);
  }
  for (const m of movies.slice(0, 5000)) {
    const cat = vodCats.find((x) => x.category_id === m.category_id).category_name;
    lines.push(`#EXTINF:-1 tvg-logo="${m.stream_icon}" group-title="${cat}",${m.name}`, `${BASE}/movie/${USER}/${PASS}/${m.stream_id}.${m.container_extension}`);
  }
  for (const s of series.slice(0, 50)) {
    const cat = seriesCats.find((x) => x.category_id === s.category_id).category_name;
    for (let e = 1; e <= 3; e++) lines.push(`#EXTINF:-1 tvg-logo="${s.cover}" group-title="${cat}",${s.name.replace(/\s*\(\d{4}\)/, '')} S01E0${e}`, `${BASE}/series/${USER}/${PASS}/${s.series_id}0${e}.mp4`);
  }
  return lines.join('\n');
}

const COLORS = ['#7c3aed', '#2563eb', '#0891b2', '#059669', '#ca8a04', '#dc2626', '#db2777', '#4f46e5'];
function poster(kind, id) {
  const c = COLORS[Number(id) % COLORS.length];
  const w = kind === 'l' ? 200 : 200;
  const h = kind === 'l' ? 200 : 300;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c}"/><stop offset="1" stop-color="#111827"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="50%" y="55%" font-family="sans-serif" font-size="28" fill="#fff" text-anchor="middle" opacity=".85">${kind.toUpperCase()}${id}</text></svg>`;
}

// ---- fake TMDB ----
function tmdbSearch(q, type) {
  const query = (q.get('query') || '').toLowerCase();
  const year = q.get('year') || q.get('first_air_date_year');
  if (!query) return { results: [] };
  const id = 100000 + [...query].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) % 900000, 7);
  const title = q.get('query');
  return {
    results: [{
      id, [type === 'tv' ? 'name' : 'title']: title, original_language: /[؀-ۿ]/.test(title) ? 'ar' : 'en',
      [type === 'tv' ? 'first_air_date' : 'release_date']: `${year || 2020}-05-01`,
      poster_path: `/p${id}.svg`, backdrop_path: `/b${id}.svg`, overview: `Overview of ${title}.`, vote_average: 7.4,
    }],
  };
}
function tmdbDetail(type, id, lang) {
  const ar = lang?.startsWith('ar');
  return {
    id: Number(id), [type === 'tv' ? 'name' : 'title']: ar ? `عنوان ${id}` : `Title ${id}`,
    overview: ar ? 'قصة الفيلم بالعربي.' : 'A thrilling story about choices and consequences.',
    poster_path: `/p${id}.svg`, backdrop_path: `/b${id}.svg`, vote_average: 7.8, runtime: 128,
    genres: [{ id: 1, name: 'Drama' }, { id: 2, name: 'Thriller' }],
    [type === 'tv' ? 'first_air_date' : 'release_date']: '2014-11-05',
    credits: { cast: Array.from({ length: 8 }, (_, i) => ({ id: i, name: `Actor ${i + 1}`, character: `Role ${i + 1}`, profile_path: `/c${i}.svg` })) },
    videos: { results: [{ site: 'YouTube', type: 'Trailer', key: 'dQw4w9WgXcQ', name: 'Official Trailer' }] },
    similar: { results: Array.from({ length: 10 }, (_, i) => ({ id: Number(id) + i + 1, title: `Similar ${i + 1}`, name: `Similar ${i + 1}`, poster_path: `/p${Number(id) + i + 1}.svg` })) },
  };
}

function xmltv() {
  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00 +0000`; };
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const hour = 3600_000;
  const base = Math.floor(Date.now() / hour) * hour - 24 * hour;
  const SHOWS = ['Morning News', 'نشرة الأخبار', 'Cooking Time', 'مسلسل السهرة', 'Football Live', 'فيلم السهرة', 'Documentary', 'Kids Club'];
  const out = ['<?xml version="1.0" encoding="UTF-8"?>', '<tv generator-info-name="mock">'];
  const chans = live.slice(0, 300);
  for (const c of chans) out.push(`<channel id="${c.epg_channel_id}"><display-name>${esc(c.name)}</display-name></channel>`);
  for (const [ci, c] of chans.entries()) {
    let t = base;
    let k = ci;
    while (t < base + 72 * hour) {
      const len = (k % 3 === 0 ? 60 : 30) * 60_000;
      const title = `${SHOWS[k % SHOWS.length]}`;
      out.push(`<programme start="${fmt(t)}" stop="${fmt(t + len)}" channel="${c.epg_channel_id}"><title>${esc(title)}</title><desc>${esc(`About ${title} (${ci}).`)}</desc></programme>`);
      t += len;
      k++;
    }
  }
  out.push('</tv>');
  return out.join('\n');
}

const json = (res, data, status = 200) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
};

function sendFile(req, res, file, type) {
  const size = statSync(file).size;
  const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
  if (range) {
    const start = range[1] ? Number(range[1]) : 0;
    const end = range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-length': end - start + 1, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' });
    return createReadStream(file, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes' });
  createReadStream(file).pipe(res);
}

/** Sliding-window live playlist over looping 2 s segments. */
function livePlaylist() {
  const seq = Math.floor(Date.now() / 1000 / SEG_DUR);
  const lines = ['#EXTM3U', '#EXT-X-VERSION:3', `#EXT-X-TARGETDURATION:${SEG_DUR}`, `#EXT-X-MEDIA-SEQUENCE:${seq}`];
  let disc = 0;
  for (let i = 0; i < 6; i++) {
    const idx = (seq + i) % LIVE_SEGS.length;
    if (idx === 0) disc++;
    if (idx === 0 && i > 0) lines.push('#EXT-X-DISCONTINUITY');
    lines.push(`#EXTINF:${SEG_DUR}.000,`, `${BASE}/media/live/${LIVE_SEGS[idx]}`);
  }
  lines.splice(4, 0, `#EXT-X-DISCONTINUITY-SEQUENCE:${Math.floor(seq / LIVE_SEGS.length)}`);
  return lines.join('\n') + '\n';
}

let failNext = 0;
let delayMs = 0;
const server = http.createServer(async (req, res) => {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-headers', '*');
  if (req.method === 'OPTIONS') return res.end();
  const u = new URL(req.url, BASE);
  const q = u.searchParams;
  if (delayMs) await new Promise((r) => setTimeout(r, delayMs));

  if (u.pathname === '/__fail') {
    failNext = Number(q.get('n') || 0);
    return json(res, { failNext });
  }
  const isMedia = /^\/(media|movie|series|live)\//.test(u.pathname) && !u.pathname.endsWith('.m3u8');
  if (isMedia && failNext > 0) {
    failNext--;
    res.writeHead(503);
    return res.end('injected failure');
  }
  if (u.pathname === '/__delay') {
    delayMs = Number(q.get('ms') || 0);
    return json(res, { delayMs });
  }
  if (u.pathname === '/player_api.php') {
    if (q.get('username') !== USER || q.get('password') !== PASS) return json(res, { user_info: { auth: 0 } });
    switch (q.get('action')) {
      case null: return json(res, userInfo());
      case 'get_vod_categories': return json(res, vodCats);
      case 'get_series_categories': return json(res, seriesCats);
      case 'get_live_categories': return json(res, liveCats);
      case 'get_vod_streams': return json(res, movies);
      case 'get_series': return json(res, series);
      case 'get_live_streams': return json(res, live);
      case 'get_series_info': return json(res, seriesInfo(q.get('series_id')));
      default: return json(res, []);
    }
  }
  if (u.pathname === '/playlist.m3u') {
    // Plain M3U link without Xtream credentials in the URL
    res.writeHead(200, { 'content-type': 'audio/x-mpegurl; charset=utf-8' });
    return res.end(m3u());
  }
  if (u.pathname === '/get.php') {
    if (q.get('username') !== USER || q.get('password') !== PASS) return json(res, { error: 'auth' }, 401);
    res.writeHead(200, { 'content-type': 'audio/x-mpegurl; charset=utf-8' });
    return res.end(m3u());
  }
  let m;
  if ((m = /^\/media\/(hls|live)\/([\w.-]+)$/.exec(u.pathname))) {
    const file = join(MEDIA, m[1], m[2]);
    try {
      statSync(file);
    } catch {
      res.writeHead(404);
      return res.end();
    }
    const type = file.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : file.endsWith('.vtt') ? 'text/vtt' : 'video/mp2t';
    return sendFile(req, res, file, type);
  }
  if (/^\/movie\/test\/test\/10003\./.test(u.pathname)) {
    res.writeHead(403);
    return res.end('forbidden');
  }
  if ((m = /^\/movie\/test\/test\/(\d+)\.(\w+)$/.exec(u.pathname))) {
    if (m[2] === 'm3u8') {
      const master = readFileSync(join(MEDIA, 'hls', 'master.m3u8'), 'utf8').replace(/^(?!#)(\S+)$/gm, `${BASE}/media/hls/$1`).replace(/URI="([^"]+)"/g, `URI="${BASE}/media/hls/$1"`);
      res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl' });
      return res.end(master);
    }
    return sendFile(req, res, join(MEDIA, 'vod.mp4'), 'video/mp4');
  }
  if ((m = /^\/series\/test\/test\/(\d+)\.(\w+)$/.exec(u.pathname))) return sendFile(req, res, join(MEDIA, 'episode.mp4'), 'video/mp4');
  if ((m = /^\/live\/test\/test\/(\d+)\.m3u8$/.exec(u.pathname))) {
    res.writeHead(200, { 'content-type': 'application/vnd.apple.mpegurl', 'cache-control': 'no-store' });
    return res.end(livePlaylist());
  }
  if ((m = /^\/live\/test\/test\/(\d+)\.ts$/.exec(u.pathname))) {
    // Endless MPEG-TS stream paced in real time
    res.writeHead(200, { 'content-type': 'video/mp2t', 'cache-control': 'no-store' });
    let i = 0;
    let closed = false;
    req.on('close', () => (closed = true));
    const push = () => {
      if (closed) return;
      res.write(readFileSync(join(MEDIA, 'live', LIVE_SEGS[i++ % LIVE_SEGS.length])));
      setTimeout(push, i < 3 ? 0 : SEG_DUR * 1000);
    };
    return push();
  }
  if ((m = /^\/img\/([msl])\/(\d+)\.svg$/.exec(u.pathname))) {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' });
    return res.end(poster(m[1], m[2]));
  }
  if ((m = /^\/tmdb-img\/[^/]+\/([pbc])(\d+)\.svg$/.exec(u.pathname))) {
    res.writeHead(200, { 'content-type': 'image/svg+xml', 'cache-control': 'max-age=86400' });
    return res.end(poster(m[1] === 'b' ? 'b' : 'm', m[2]));
  }
  if ((m = /^\/tmdb\/3\/search\/(movie|tv)$/.exec(u.pathname))) return json(res, tmdbSearch(q, m[1]));
  if ((m = /^\/tmdb\/3\/(movie|tv)\/(\d+)$/.exec(u.pathname))) return json(res, tmdbDetail(m[1], m[2], q.get('language')));
  if (u.pathname === '/xmltv.php') {
    res.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' });
    return res.end(xmltv());
  }
  if (u.pathname === '/epg.xml.gz') {
    res.writeHead(200, { 'content-type': 'application/gzip' });
    return res.end(gzipSync(xmltv()));
  }
  if (/^\/timeshift\/test\/test\//.test(u.pathname)) return sendFile(req, res, join(MEDIA, 'vod.mp4'), 'video/mp4');
  if (u.pathname === '/os/subtitles') {
    return json(res, { data: [
      { id: '1', attributes: { language: 'ar', release: `${q.get('query')} WEB-DL`, download_count: 900, files: [{ file_id: 101, file_name: 'ar.srt' }] } },
      { id: '2', attributes: { language: 'en', release: `${q.get('query')} BluRay`, download_count: 500, files: [{ file_id: 102, file_name: 'en.srt' }] } },
    ] });
  }
  if (u.pathname === '/os/download' && req.method === 'POST') {
    const body = await new Promise((r) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => r(b)); });
    const ar = JSON.parse(body || '{}').file_id === 101;
    const lines = [];
    for (let i = 0; i < 20; i++) lines.push(String(i + 1), `00:00:${String(i * 2).padStart(2, '0')},000 --> 00:00:${String(i * 2 + 1).padStart(2, '0')},500`, ar ? `سطر ترجمة ${i + 1}` : `Online line ${i + 1}`, '');
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    return res.end(lines.join('\n'));
  }
  if (u.pathname === '/health') return json(res, { ok: true, movies: movies.length, series: series.length, live: live.length });
  res.writeHead(404);
  res.end('not found');
});

server.listen(PORT, () => {
  console.log(`mock xtream on ${BASE}  user=${USER} pass=${PASS}  movies=${movies.length} series=${series.length} live=${live.length}`);
});
