import { isNative } from '../lib/platform';
import { NativePlayer } from './nativePlayer';
import type { PlayerAdapter } from './types';
import { WebPlayer } from './webPlayer';

/** Android (Capacitor) → Media3 ExoPlayer under the WebView; everything else → the web engine. */
export function createPlayer(): PlayerAdapter {
  return isNative() ? new NativePlayer() : new WebPlayer();
}
