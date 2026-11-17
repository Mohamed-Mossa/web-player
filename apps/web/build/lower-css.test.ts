import { describe, expect, it } from 'vitest';
// @ts-expect-error plain ESM build script
import { lowerCss } from './lower-css.mjs';

const low = (css: string) => lowerCss(css, { minify: false }) as Promise<string>;
const flat = (s: string) => s.replace(/:not\(#\\#\)/g, '').replace(/\s+/g, ' ');

describe('lowerCss (Chromium 69)', () => {
  it('removes cascade layers but keeps their order', async () => {
    const out = await low('@layer base, utilities; @layer utilities { .p { color: red } } @layer base { a { color: blue } }');
    expect(out).not.toContain('@layer');
    // utilities must still beat base: they get the higher specificity bump
    const p = out.match(/\.p[^{]*/)![0];
    const a = out.match(/(^|\n)a[^{]*/)![0];
    expect((p.match(/#\\#/g) ?? []).length).toBeGreaterThan((a.match(/#\\#/g) ?? []).length);
  });

  it('turns start/end properties into left/right per direction', async () => {
    const out = flat(await low('.ms-2 { margin-inline-start: 8px } .px { padding-inline: 4px } .s { inset-inline-start: 0 }'));
    expect(out).toContain('html:not([dir="rtl"]) .ms-2 { margin-left: 8px; }');
    expect(out).toContain('html[dir="rtl"] .ms-2 { margin-right: 8px; }');
    expect(out).toContain('.px { padding-left: 4px; padding-right: 4px; }');
    expect(out).toContain('html[dir="rtl"] .s { right: 0; }');
    expect(out).not.toMatch(/inline|:lang/);
  });

  it('merges the html compound instead of nesting html in html', async () => {
    const out = flat(await low('html.tv .x { margin-inline-end: 1px }'));
    expect(out).toContain('html.tv[dir="rtl"] .x { margin-left: 1px; }');
  });

  it('expands :where()/:is() and drops :dir()', async () => {
    const out = flat(
      await low('.g:is(:where(.group):hover *) { opacity: 1 } .r:where(:dir(rtl), [dir="rtl"], [dir="rtl"] *) { color: red } button:where([type=a],[type=b]) { x: y }'),
    );
    expect(out).toContain('.group:hover .g {');
    expect(out).toContain('.r[dir="rtl"], [dir="rtl"] .r {');
    expect(out).toContain('button[type="a"], button[type="b"] {');
    expect(out).not.toMatch(/:where|:is\(|:dir/);
  });

  it('turns translate/rotate/scale into transform', async () => {
    const out = flat(await low('.t { translate: var(--x) var(--y); rotate: 45deg }'));
    expect(out).toContain('transform: translate(var(--x), var(--y)) rotate(45deg)');
  });

  it('applies the @property fallback everywhere and removes @property', async () => {
    const out = flat(
      await low(
        '@property --tw-x { syntax: "*"; inherits: false; initial-value: 0 } @layer properties { @supports ((-webkit-hyphens: none) and (not (margin-trim: inline))) or ((-moz-orient: inline) and (not (color: rgb(from red r g b)))) { *, :before, :after { --tw-x: 0 } } }',
      ),
    );
    expect(out).not.toMatch(/@property|@supports/);
    expect(out).toMatch(/\*, :before, :after \{ --tw-x: 0; \}/);
  });

  it('maps dynamic viewport units and inset', async () => {
    const out = flat(await low('.h { height: 100dvh; inset: 0 }'));
    expect(out).toContain('height: 100vh');
    expect(out).toMatch(/top: 0; bottom: 0; left: 0; right: 0|top: 0; right: 0; bottom: 0; left: 0/);
    expect(out).not.toContain('inset:');
  });
});
