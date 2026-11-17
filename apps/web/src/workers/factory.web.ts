// Module workers loaded by URL (web, Android).
export const createCatalogWorker = () => new Worker(new URL('./catalogSync.worker.ts', import.meta.url), { type: 'module' });
export const createEpgWorker = () => new Worker(new URL('./epg.worker.ts', import.meta.url), { type: 'module' });
export const createSearchWorker = () => new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
