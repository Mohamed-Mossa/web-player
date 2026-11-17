/**
 * Horizontal scrolling measured from the inline start (right edge in Arabic).
 * Chromium 85+ uses negative scrollLeft in RTL; older engines (Samsung 2020 TVs) count from the
 * left edge, with the start of an RTL box at the maximum.
 */
let negativeRtl: boolean | null = null;

function detect(): boolean {
  const outer = document.createElement('div');
  outer.dir = 'rtl';
  outer.style.cssText = 'position:absolute;top:-999px;width:10px;height:10px;overflow:scroll;visibility:hidden';
  const inner = document.createElement('div');
  inner.style.cssText = 'width:20px;height:1px';
  outer.appendChild(inner);
  document.body.appendChild(outer);
  const neg = outer.scrollLeft === 0 && ((outer.scrollLeft = -1), outer.scrollLeft < 0);
  outer.remove();
  return neg;
}

export function scrollToStart(el: HTMLElement, offset: number) {
  if (getComputedStyle(el).direction !== 'rtl') return el.scrollTo({ left: offset });
  if (negativeRtl === null) negativeRtl = detect();
  el.scrollTo({ left: negativeRtl ? -offset : el.scrollWidth - el.clientWidth - offset });
}
