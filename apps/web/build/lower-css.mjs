// Lowers the Tailwind v4 stylesheet for Samsung TVs from 2020 (Tizen 5.5 = Chromium 69).
//
// Tailwind v4 targets Chrome 111+. Chromium 69 is missing: cascade layers, :where()/:is(),
// :dir(), logical properties (margin-inline-start…), `inset`, individual transforms
// (translate/scale/rotate), dynamic viewport units and @property. A rule whose selector list has
// one unknown selector is dropped entirely, so selectors are rewritten one by one.
// Flex `gap` and aspect-ratio are handled at runtime (src/lib/polyfills.ts).
import postcss from 'postcss';
import selectorParser from 'postcss-selector-parser';
import cascadeLayers from '@csstools/postcss-cascade-layers';
import { transform } from 'lightningcss';

/** Selectors Chromium 69 cannot parse; such a selector is removed from its list. */
const UNSUPPORTED = /:dir\(|:has\(|::marker|:-moz-|::-moz-|:popover-open|:user-(?:in)?valid|:open\b|::details-content|:modal|::picker|:autofill|:host-context|:focus-visible-within/;

// ---------- selectors ----------

/** Splits a selector's nodes at its combinators: [[compound], combinator, [compound], …] */
function splitCompounds(nodes) {
  const out = [[]];
  for (const n of nodes) {
    if (n.type === 'combinator') {
      out.push(n, []);
    } else out[out.length - 1].push(n);
  }
  return out;
}

const isTag = (n) => n.type === 'tag' || n.type === 'universal';
const isPseudoElement = (n) => n.type === 'pseudo' && (n.value.startsWith('::') || /^:(before|after|first-line|first-letter)$/.test(n.value));

/** Merges simple selectors into one compound in a valid order (type first, pseudo-elements last). */
function mergeCompound(parts) {
  const tags = parts.filter(isTag);
  const named = tags.filter((t) => t.type === 'tag');
  const tag = named[0] ?? (tags.length && parts.length === tags.length ? tags[0] : null);
  const rest = parts.filter((n) => !isTag(n) && !isPseudoElement(n));
  const pe = parts.filter(isPseudoElement);
  return [...(tag ? [tag] : []), ...rest, ...pe];
}

const str = (nodes) =>
  nodes
    .map((n) => {
      if (n.type === 'combinator') return n.value.trim() ? ` ${n.value.trim()} ` : ' ';
      const c = n.clone();
      c.spaces = { before: '', after: '' };
      return c.toString();
    })
    .join('');

/**
 * Expands :where(A, B) / :is(A, B) into separate selectors. When an alternative has combinators
 * (`.x:is(:where(.group):hover *)`), its ancestors move in front: `.group:hover .x`.
 */
function expandSelector(sel) {
  let result = null;
  const root = selectorParser().astSync(sel);
  root.walkPseudos((p) => {
    if (result || (p.value !== ':where' && p.value !== ':is' && p.value !== ':matches')) return;
    // inside :not() only a single simple alternative can be unwrapped
    let anc = p.parent;
    let inNot = false;
    while (anc) {
      if (anc.type === 'pseudo' && anc.value === ':not') inNot = true;
      anc = anc.parent;
    }
    const owner = p.parent; // the Selector node that contains p
    const alts = p.nodes;
    if (inNot) {
      if (alts.length === 1 && !alts[0].nodes.some((n) => n.type === 'combinator')) {
        const repl = alts[0].nodes.map((n) => {
          const c = n.clone();
          c.spaces = { before: '', after: '' };
          return c;
        });
        p.replaceWith(...repl);
        result = [root.toString()];
      } else result = [];
      return;
    }
    const nodes = owner.nodes;
    const groups = splitCompounds(nodes);
    let gi = -1;
    for (let i = 0; i < groups.length; i += 2) if (groups[i].includes(p)) gi = i;
    const before = groups.slice(0, gi).flat();
    const after = groups.slice(gi + 1).flat();
    const idx = groups[gi].indexOf(p);
    const head = groups[gi].slice(0, idx);
    const tail = groups[gi].slice(idx + 1);
    const expanded = [];
    for (const alt of alts) {
      const ag = splitCompounds(alt.nodes);
      const last = ag[ag.length - 1];
      const prefix = ag.slice(0, -1).flat();
      const merged = mergeCompound([...head, ...last, ...tail]);
      const all = [...before, ...prefix, ...merged, ...after];
      // other selectors of the same list stay intact; only `owner` is rewritten
      const others = root.nodes.filter((s) => s !== owner).map((s) => s.toString().trim());
      expanded.push(str(all), ...others);
    }
    result = [...new Set(expanded)];
  });
  if (result === null) return [sel];
  return result.flatMap((s) => (s === sel ? [s] : expandSelector(s)));
}

function rewriteSelector(sel) {
  const s = sel
    .replace(/::file-selector-button/g, '::-webkit-file-upload-button')
    .replace(/:focus-visible/g, ':focus');
  return expandSelector(s.trim())
    .map((x) => x.trim())
    .filter((x) => x && !UNSUPPORTED.test(x));
}

// ---------- declarations ----------

/** Splits a value at top-level spaces (keeps var(), calc() intact). */
function words(v) {
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of v.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Direction-independent logical shorthands → physical. */
function physicalSymmetric(prop, value) {
  const w = words(value);
  const pair = (a, b) => [
    [a, w[0]],
    [b, w[1] ?? w[0]],
  ];
  const m = /^(margin|padding|scroll-margin|scroll-padding)-(inline|block)$/.exec(prop);
  if (m) {
    const [x, y] = m[2] === 'block' ? ['top', 'bottom'] : ['left', 'right'];
    if (m[2] === 'inline' && w[1] && w[1] !== w[0]) return null; // start ≠ end: direction dependent
    return pair(`${m[1]}-${x}`, `${m[1]}-${y}`);
  }
  const mb = /^(margin|padding|scroll-margin|scroll-padding)-block-(start|end)$/.exec(prop);
  if (mb) return [[`${mb[1]}-${mb[2] === 'start' ? 'top' : 'bottom'}`, value]];
  if (prop === 'inset') {
    const [t, r = t, b = t, l = r] = w;
    return [['top', t], ['right', r], ['bottom', b], ['left', l]];
  }
  if (prop === 'inset-block') return pair('top', 'bottom');
  if (prop === 'inset-block-start') return [['top', value]];
  if (prop === 'inset-block-end') return [['bottom', value]];
  if (prop === 'inset-inline' && !(w[1] && w[1] !== w[0])) return pair('left', 'right');
  const bb = /^border-block(-start|-end)?(-width|-style|-color)?$/.exec(prop);
  if (bb) {
    const sides = bb[1] ? [bb[1] === '-start' ? 'top' : 'bottom'] : ['top', 'bottom'];
    return sides.map((s) => [`border-${s}${bb[2] ?? ''}`, value]);
  }
  const bi = /^border-inline(-width|-style|-color)?$/.exec(prop);
  if (bi) return ['left', 'right'].map((s) => [`border-${s}${bi[1] ?? ''}`, value]);
  if (prop === 'block-size') return [['height', value]];
  if (prop === 'inline-size') return [['width', value]];
  if (prop === 'min-block-size') return [['min-height', value]];
  if (prop === 'min-inline-size') return [['min-width', value]];
  if (prop === 'max-block-size') return [['max-height', value]];
  if (prop === 'max-inline-size') return [['max-width', value]];
  return null;
}

/** Start/end properties → [ltr declarations, rtl declarations]. */
function physicalDirectional(prop, value) {
  const se = (start, end) => ({ ltr: [[start, value]], rtl: [[end, value]] });
  let m = /^(margin|padding|scroll-margin|scroll-padding)-inline-(start|end)$/.exec(prop);
  if (m) return m[2] === 'start' ? se(`${m[1]}-left`, `${m[1]}-right`) : se(`${m[1]}-right`, `${m[1]}-left`);
  m = /^(margin|padding|scroll-margin|scroll-padding|inset)-inline$/.exec(prop);
  if (m) {
    const [a, b] = words(value);
    const p = m[1] === 'inset' ? '' : `${m[1]}-`;
    return { ltr: [[`${p}left`, a], [`${p}right`, b]], rtl: [[`${p}right`, a], [`${p}left`, b]] };
  }
  if (prop === 'inset-inline-start') return se('left', 'right');
  if (prop === 'inset-inline-end') return se('right', 'left');
  m = /^border-inline-(start|end)(-width|-style|-color)?$/.exec(prop);
  if (m) {
    const s = m[2] ?? '';
    return m[1] === 'start' ? se(`border-left${s}`, `border-right${s}`) : se(`border-right${s}`, `border-left${s}`);
  }
  const radius = {
    'border-start-start-radius': ['border-top-left-radius', 'border-top-right-radius'],
    'border-start-end-radius': ['border-top-right-radius', 'border-top-left-radius'],
    'border-end-start-radius': ['border-bottom-left-radius', 'border-bottom-right-radius'],
    'border-end-end-radius': ['border-bottom-right-radius', 'border-bottom-left-radius'],
  }[prop];
  if (radius) return se(radius[0], radius[1]);
  if (prop === 'float' || prop === 'clear') {
    if (value === 'inline-start') return { ltr: [[prop, 'left']], rtl: [[prop, 'right']] };
    if (value === 'inline-end') return { ltr: [[prop, 'right']], rtl: [[prop, 'left']] };
  }
  return null;
}

/** Puts [dir] on the html element in front of a selector. */
function withDir(sel, rtl) {
  const attr = rtl ? '[dir="rtl"]' : ':not([dir="rtl"])';
  const m = /^(html|:root)((?:[.[:#][^\s>+~]*)?)(.*)$/s.exec(sel);
  if (m) return `html${m[2]}${attr}${m[3]}`;
  return `html${attr} ${sel}`;
}

const lowerPlugin = {
  postcssPlugin: 'tizen-lower',
  AtRule: {
    supports(at) {
      // Tailwind's @property fallback only targets Safari/Firefox; Chromium 69 needs it too.
      if (/margin-trim|-moz-orient/.test(at.params)) at.replaceWith(at.nodes);
    },
    property(at) {
      at.remove(); // unknown to Chromium 69; the fallback above sets the initial values
    },
  },
  Rule(rule) {
    if (rule.__lowered) return;
    rule.__lowered = true;
    const inKeyframes = rule.parent?.type === 'atrule' && /keyframes$/.test(rule.parent.name);
    if (!inKeyframes) {
      const sels = rule.selectors.flatMap(rewriteSelector);
      if (!sels.length) return void rule.remove();
      rule.selectors = [...new Set(sels)];
    }

    const ltr = [];
    const rtl = [];
    const transforms = [];
    rule.each((d) => {
      if (d.type !== 'decl') return;
      let v = d.value.replace(/(\d)(?:d|s|l)v(h|w|min|max)\b/g, '$1v$2');
      if (v !== d.value) d.value = v;
      if (d.prop === 'translate' || d.prop === 'scale' || d.prop === 'rotate') {
        const w = words(d.value);
        if (d.value === 'none') transforms.push('none');
        else if (d.prop === 'rotate') transforms.push(`rotate(${d.value})`);
        else if (d.prop === 'translate') transforms.push(w.length > 2 ? `translate3d(${w.join(', ')})` : `translate(${w.join(', ')})`);
        else transforms.push(w.length > 2 ? `scale3d(${w.join(', ')})` : `scale(${w.join(', ')})`);
        d.remove();
        return;
      }
      const sym = physicalSymmetric(d.prop, d.value);
      if (sym) {
        for (const [p, val] of sym) d.cloneBefore({ prop: p, value: val });
        d.remove();
        return;
      }
      const dir = physicalDirectional(d.prop, d.value);
      if (dir) {
        ltr.push(...dir.ltr.map(([p, val]) => ({ prop: p, value: val, important: d.important })));
        rtl.push(...dir.rtl.map(([p, val]) => ({ prop: p, value: val, important: d.important })));
        d.remove();
      }
    });
    if (transforms.length) {
      const order = (t) => (t.startsWith('translate') ? 0 : t.startsWith('rotate') ? 1 : 2);
      const list = transforms.includes('none') ? ['none'] : transforms.sort((a, b) => order(a) - order(b));
      rule.append({ prop: 'transform', value: list.join(' ') });
    }
    if (ltr.length) {
      const r = rule.clone({ selectors: rule.selectors.map((s) => withDir(s, false)), nodes: [] });
      r.__lowered = true;
      ltr.forEach((d) => r.append(d));
      const l = rule.clone({ selectors: rule.selectors.map((s) => withDir(s, true)), nodes: [] });
      l.__lowered = true;
      rtl.forEach((d) => l.append(d));
      rule.after(l);
      rule.after(r);
    }
    if (!rule.nodes.length) rule.remove();
  },
};

export async function lowerCss(css, { minify = true, from = 'app.css' } = {}) {
  const lowered = await postcss([lowerPlugin, cascadeLayers()]).process(css, { from });
  const out = transform({
    filename: from,
    code: Buffer.from(lowered.css),
    minify,
    targets: { chrome: 69 << 16 }, // vendor prefixes, colour functions, nesting
  });
  return out.code.toString();
}
