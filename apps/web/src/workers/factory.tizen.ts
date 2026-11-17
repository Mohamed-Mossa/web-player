// Samsung package: the app runs from file://, where Chromium may refuse to start a worker from a
// file URL. Workers are bundled into the app and started from Blob URLs instead (classic scripts).
import CatalogWorker from './catalogSync.worker.ts?worker&inline';
import EpgWorker from './epg.worker.ts?worker&inline';
import SearchWorker from './search.worker.ts?worker&inline';

export const createCatalogWorker = (): Worker => new CatalogWorker();
export const createEpgWorker = (): Worker => new EpgWorker();
export const createSearchWorker = (): Worker => new SearchWorker();
