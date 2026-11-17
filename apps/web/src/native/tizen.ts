import { isTizen } from '../lib/platform';

/**
 * Samsung remote on Tizen. Most buttons are only delivered to the app after registerKey(), and
 * they arrive with Tizen key codes and XF86… names. We re-send them as the standard `key`
 * values the rest of the app already understands (the same ones Android TV sends).
 */
const KEYS: Record<number, string> = {
  10009: 'Escape', // Return / Back
  427: 'ChannelUp',
  428: 'ChannelDown',
  10252: 'MediaPlayPause',
  415: 'MediaPlay',
  19: 'MediaPause',
  413: 'MediaStop',
  417: 'MediaFastForward',
  412: 'MediaRewind',
  10233: 'MediaTrackNext',
  10232: 'MediaTrackPrevious',
  457: 'Info',
  458: 'Guide',
  10073: 'Channels', // CH LIST
  10190: 'Recall', // PRE-CH
  403: 'ColorF0Red',
  404: 'ColorF1Green',
  405: 'ColorF2Yellow',
  406: 'ColorF3Blue',
};

const REGISTER = [
  'MediaPlayPause', 'MediaPlay', 'MediaPause', 'MediaStop', 'MediaFastForward', 'MediaRewind',
  'MediaTrackNext', 'MediaTrackPrevious', 'ChannelUp', 'ChannelDown', 'ChannelList', 'PreviousChannel',
  'Info', 'Guide', 'ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
];

interface TizenApi {
  tvinputdevice?: { registerKey(name: string): void };
  application?: { getCurrentApplication(): { exit(): void; hide(): void } };
}
const tizen = () => (window as unknown as { tizen?: TizenApi }).tizen;

export function exitApp() {
  try {
    tizen()?.application?.getCurrentApplication().exit();
  } catch {
    /* not on a TV */
  }
}

const atRoot = () => {
  const h = location.hash.replace(/^#/, '');
  return h === '' || h === '/';
};

const resent = new WeakSet<Event>();

export function initTizen() {
  if (!isTizen()) return;
  for (const k of REGISTER) {
    try {
      tizen()?.tvinputdevice?.registerKey(k);
    } catch {
      /* this model has no such key */
    }
  }

  // Registered first, so this runs before every other keydown listener (all are on window).
  addEventListener(
    'keydown',
    (e: KeyboardEvent) => {
      if (resent.has(e)) return;
      let key = KEYS[e.keyCode];
      if (!key && e.keyCode >= 48 && e.keyCode <= 57 && e.key !== String(e.keyCode - 48)) key = String(e.keyCode - 48);
      if (!key) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const target = (document.activeElement as HTMLElement | null) ?? document.body;
      const ev = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      resent.add(ev);
      const notHandled = target.dispatchEvent(ev);
      // Back on the home screen leaves the app, like every other TV app.
      if (key === 'Escape' && notHandled && atRoot()) exitApp();
    },
    true,
  );
}
