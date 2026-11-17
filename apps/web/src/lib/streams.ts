import { Gunzip } from 'fflate';

/** gzip → bytes. Native DecompressionStream where available (Chromium 80+), fflate otherwise. */
export function gunzipStream(): TransformStream<Uint8Array, Uint8Array> {
  if (typeof DecompressionStream === 'function') return new DecompressionStream('gzip') as unknown as TransformStream<Uint8Array, Uint8Array>;
  let out: TransformStreamDefaultController<Uint8Array>;
  const g = new Gunzip((chunk) => out.enqueue(chunk));
  return new TransformStream<Uint8Array, Uint8Array>({
    start(c) {
      out = c;
    },
    transform(chunk) {
      g.push(chunk);
    },
    flush() {
      g.push(new Uint8Array(0), true);
    },
  });
}

/** bytes → text. Native TextDecoderStream where available (Chromium 71+), TextDecoder otherwise. */
export function textDecoderStream(): TransformStream<Uint8Array, string> {
  if (typeof TextDecoderStream === 'function') return new TextDecoderStream() as unknown as TransformStream<Uint8Array, string>;
  const d = new TextDecoder();
  return new TransformStream<Uint8Array, string>({
    transform(chunk, c) {
      const s = d.decode(chunk, { stream: true });
      if (s) c.enqueue(s);
    },
    flush(c) {
      const s = d.decode();
      if (s) c.enqueue(s);
    },
  });
}
