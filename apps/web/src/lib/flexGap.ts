/**
 * Flex `gap` for browsers that only know it for grid (Chromium < 84, e.g. Samsung 2020 TVs).
 * Each flex container with a gap class gets data-fg (which side its children need a margin on)
 * and the gap sizes as CSS variables; the margins themselves are in styles.css.
 */
const SELECTOR = '[class*="gap-"]';

function apply(el: HTMLElement) {
  const cs = getComputedStyle(el);
  if (!/flex/.test(cs.display)) {
    if (el.dataset.fg) {
      delete el.dataset.fg;
      delete el.dataset.fgw;
    }
    return;
  }
  const px = (v: string) => (v && v !== 'normal' ? v : '0px');
  const column = cs.flexDirection.startsWith('column');
  const reverse = cs.flexDirection.endsWith('reverse');
  let side: string;
  if (column) side = reverse ? 'b' : 't';
  else side = (cs.direction === 'rtl') !== reverse ? 'r' : 'l';
  el.style.setProperty('--fg-x', px(cs.columnGap));
  el.style.setProperty('--fg-y', px(cs.rowGap));
  if (el.dataset.fg !== side) el.dataset.fg = side;
  const wrap = !column && cs.flexWrap !== 'nowrap';
  if (wrap) el.dataset.fgw = '';
  else delete el.dataset.fgw;
}

function scan(root: ParentNode) {
  if (root instanceof HTMLElement && root.matches(SELECTOR)) apply(root);
  root.querySelectorAll<HTMLElement>(SELECTOR).forEach(apply);
}

export function startFlexGapFallback() {
  const pending = new Set<ParentNode>();
  let queued = false;
  const flush = () => {
    queued = false;
    const roots = [...pending];
    pending.clear();
    roots.forEach((r) => (r as Node).isConnected && scan(r));
  };
  const queue = (n: ParentNode) => {
    pending.add(n);
    if (!queued) {
      queued = true;
      requestAnimationFrame(flush);
    }
  };
  new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes') queue(r.target as HTMLElement);
      else r.addedNodes.forEach((n) => n.nodeType === 1 && queue(n as HTMLElement));
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'dir'] });
  addEventListener('resize', () => queue(document.documentElement));
  queue(document.documentElement);
}
