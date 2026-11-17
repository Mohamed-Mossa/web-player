declare module 'virtual-worker-polyfills';
declare module 'virtual-worker-factory' {
  export const createCatalogWorker: () => Worker;
  export const createEpgWorker: () => Worker;
  export const createSearchWorker: () => Worker;
}
