// Small gaps on older TV browsers (Samsung 2020 = Chromium 69) that core-js does not cover.
// Everything here is a no-op on current browsers.
import { startFlexGapFallback } from './flexGap';

if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function') {
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: function randomUUID() {
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    },
  });
}

// Flex `gap` (Chromium 84+) and aspect-ratio (88+) are filled in for older engines.
if (typeof document !== 'undefined') {
  const flexGap = (() => {
    const d = document.createElement('div');
    d.style.cssText = 'display:flex;flex-direction:column;row-gap:1px;position:absolute;visibility:hidden';
    d.appendChild(document.createElement('div'));
    d.appendChild(document.createElement('div'));
    document.documentElement.appendChild(d);
    const ok = d.scrollHeight === 1;
    d.remove();
    return ok;
  })();
  if (!flexGap) {
    document.documentElement.classList.add('no-flexgap');
    startFlexGapFallback();
  }
  if (!CSS.supports('aspect-ratio', '1')) document.documentElement.classList.add('no-aspect');
}
