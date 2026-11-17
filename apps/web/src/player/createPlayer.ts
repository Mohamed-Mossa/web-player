import { isNative, isTizen } from '../lib/platform';
import { NativePlayer } from './nativePlayer';
import { TizenPlayer, hasAvPlay } from './tizenPlayer';
import type { PlayerAdapter } from './types';
import { WebPlayer } from './webPlayer';

/** Android (Capacitor) → Media3 ExoPlayer; Samsung TV → AVPlay; everything else → the web engine. */
export function createPlayer(): PlayerAdapter {
  if (isNative()) return new NativePlayer();
  if (isTizen() && hasAvPlay()) return new TizenPlayer();
  return new WebPlayer();
}
