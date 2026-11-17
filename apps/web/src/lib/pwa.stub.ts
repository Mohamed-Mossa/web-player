// Stand-in for vite-plugin-pwa's virtual module in the Samsung build (no service worker there).
export function registerSW(_o?: unknown) {
  return async (_reload?: boolean) => {};
}
