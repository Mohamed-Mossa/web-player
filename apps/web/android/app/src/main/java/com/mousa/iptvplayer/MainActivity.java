package com.mousa.iptvplayer;

import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ExoPlayerPlugin.class);
        registerPlugin(TvBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }

    /** Remote keys the WebView does not deliver reliably are forwarded to the web UI as KeyboardEvents. */
    private static String jsKey(int code) {
        switch (code) {
            case KeyEvent.KEYCODE_CHANNEL_UP: return "ChannelUp";
            case KeyEvent.KEYCODE_CHANNEL_DOWN: return "ChannelDown";
            case KeyEvent.KEYCODE_LAST_CHANNEL: return "Recall";
            case KeyEvent.KEYCODE_GUIDE: return "Guide";
            case KeyEvent.KEYCODE_INFO: return "Info";
            case KeyEvent.KEYCODE_SEARCH:
            case KeyEvent.KEYCODE_VOICE_ASSIST: return "VoiceSearch";
            case KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE:
            case KeyEvent.KEYCODE_HEADSETHOOK: return "MediaPlayPause";
            case KeyEvent.KEYCODE_MEDIA_PLAY: return "MediaPlay";
            case KeyEvent.KEYCODE_MEDIA_PAUSE: return "MediaPause";
            case KeyEvent.KEYCODE_MEDIA_STOP: return "MediaStop";
            case KeyEvent.KEYCODE_MEDIA_FAST_FORWARD: return "MediaFastForward";
            case KeyEvent.KEYCODE_MEDIA_REWIND: return "MediaRewind";
            case KeyEvent.KEYCODE_MEDIA_NEXT: return "MediaTrackNext";
            case KeyEvent.KEYCODE_MEDIA_PREVIOUS: return "MediaTrackPrevious";
            default: return null;
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        String key = jsKey(event.getKeyCode());
        if (key != null && getBridge() != null) {
            if (event.getAction() == KeyEvent.ACTION_DOWN) {
                WebView wv = getBridge().getWebView();
                wv.evaluateJavascript("window.dispatchEvent(new KeyboardEvent('keydown',{key:'" + key + "',bubbles:true,cancelable:true}))", null);
            }
            return true;
        }
        return super.dispatchKeyEvent(event);
    }
}
