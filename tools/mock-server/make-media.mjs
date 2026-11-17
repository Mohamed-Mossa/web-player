// Generates small test media with ffmpeg (once): MP4, HLS VOD with 2 audio tracks + subtitles, live segments.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export function makeMedia(dir) {
  const done = join(dir, '.done-v2');
  if (existsSync(done)) return;
  for (const d of ['', 'hls', 'live']) mkdirSync(join(dir, d), { recursive: true });
  const ff = (...args) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...args], { stdio: 'inherit' });
  const src = (sec, freq) => [
    '-f', 'lavfi', '-i', `testsrc2=size=640x360:rate=25:duration=${sec}`,
    '-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=44100:duration=${sec}`,
  ];
  const enc = ['-c:v', 'libx264', '-preset', 'veryfast', '-profile:v', 'high', '-level', '3.0', '-pix_fmt', 'yuv420p', '-g', '50', '-keyint_min', '50', '-sc_threshold', '0', '-c:a', 'aac', '-b:a', '96k'];

  console.log('[mock] generating test media with ffmpeg…');
  ff(...src(40, 440), ...enc, '-movflags', '+faststart', join(dir, 'vod.mp4'));
  ff(...src(12, 523), ...enc, '-movflags', '+faststart', join(dir, 'episode.mp4'));

  // HLS VOD: video-only rendition + two audio renditions + WebVTT subtitles
  ff('-i', join(dir, 'vod.mp4'), '-map', '0:v', '-c', 'copy', '-f', 'hls', '-hls_time', '4', '-hls_playlist_type', 'vod',
    '-hls_segment_filename', join(dir, 'hls', 'v_%03d.ts'), join(dir, 'hls', 'video.m3u8'));
  for (const [lang, freq] of [['en', 440], ['ar', 660]]) {
    ff('-f', 'lavfi', '-i', `sine=frequency=${freq}:sample_rate=44100:duration=40`, '-c:a', 'aac', '-b:a', '96k', '-f', 'hls', '-hls_time', '4',
      '-hls_playlist_type', 'vod', '-hls_segment_filename', join(dir, 'hls', `a_${lang}_%03d.ts`), join(dir, 'hls', `a_${lang}.m3u8`));
  }
  const vtt = ['WEBVTT', 'X-TIMESTAMP-MAP=MPEGTS:126000,LOCAL:00:00:00.000', ''];
  for (let s = 0; s < 40; s += 4) vtt.push(`00:00:${String(s).padStart(2, '0')}.000 --> 00:00:${String(s + 3).padStart(2, '0')}.000`, `Subtitle line ${s / 4 + 1}`, '');
  writeFileSync(join(dir, 'hls', 's_en.vtt'), vtt.join('\n'));
  writeFileSync(join(dir, 'hls', 's_en.m3u8'), '#EXTM3U\n#EXT-X-TARGETDURATION:40\n#EXT-X-VERSION:3\n#EXT-X-PLAYLIST-TYPE:VOD\n#EXTINF:40.0,\ns_en.vtt\n#EXT-X-ENDLIST\n');
  writeFileSync(join(dir, 'hls', 'master.m3u8'), [
    '#EXTM3U',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",LANGUAGE="en",NAME="English",DEFAULT=YES,AUTOSELECT=YES,URI="a_en.m3u8"',
    '#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="aud",LANGUAGE="ar",NAME="Arabic",DEFAULT=NO,AUTOSELECT=YES,URI="a_ar.m3u8"',
    '#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",LANGUAGE="en",NAME="English",DEFAULT=NO,AUTOSELECT=NO,URI="s_en.m3u8"',
    '#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=640x360,CODECS="avc1.64001e,mp4a.40.2",AUDIO="aud",SUBTITLES="subs"',
    'video.m3u8',
    '',
  ].join('\n'));

  // Live: 2-second muxed segments, served as a sliding window by the server
  ff('-i', join(dir, 'vod.mp4'), '-c', 'copy', '-f', 'hls', '-hls_time', '2', '-hls_list_size', '0',
    '-hls_segment_filename', join(dir, 'live', 'seg_%03d.ts'), join(dir, 'live', 'all.m3u8'));
  writeFileSync(done, new Date().toISOString());
  console.log('[mock] media ready');
}
