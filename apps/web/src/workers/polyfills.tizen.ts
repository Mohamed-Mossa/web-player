// Samsung (Chromium 69) workers: standard library gaps. Hand-picked instead of core-js/stable,
// which breaks Dexie inside workers ("Transaction committed too early" — core-js/stable and its
// queueMicrotask polyfill both do it), so Promise and queueMicrotask are left alone.
import 'core-js/modules/es.global-this.js';
import 'core-js/modules/es.object.from-entries.js';
import 'core-js/modules/es.object.has-own.js';
import 'core-js/modules/es.string.match-all.js';
import 'core-js/modules/es.string.replace-all.js';
import 'core-js/modules/es.string.at-alternative.js';
import 'core-js/modules/es.array.at.js';
import 'core-js/modules/es.array.find-last.js';
import 'core-js/modules/es.array.find-last-index.js';
import 'core-js/modules/es.array.to-sorted.js';
import 'core-js/modules/es.array.to-reversed.js';
import 'core-js/modules/es.symbol.description.js';

if (typeof Promise.allSettled !== 'function') {
  Object.defineProperty(Promise, 'allSettled', {
    configurable: true,
    writable: true,
    value: <T>(items: Iterable<T | PromiseLike<T>>) =>
      Promise.all(
        Array.from(items, (p) =>
          Promise.resolve(p).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason: unknown) => ({ status: 'rejected' as const, reason }),
          ),
        ),
      ),
  });
}
