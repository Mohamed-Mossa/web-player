package com.mousa.iptvplayer;

import android.app.UiModeManager;
import android.content.Context;
import android.content.Intent;
import android.content.res.Configuration;
import android.speech.RecognizerIntent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.ArrayList;

/** Small Android helpers: TV detection and voice search through the remote's microphone. */
@CapacitorPlugin(name = "TvBridge")
public class TvBridgePlugin extends Plugin {
    /** Must match NATIVE_API in apps/web/src/env.ts; bump when the web code needs new native methods. */
    static final int NATIVE_API = 1;

    @PluginMethod
    public void info(PluginCall call) {
        UiModeManager ui = (UiModeManager) getContext().getSystemService(Context.UI_MODE_SERVICE);
        JSObject o = new JSObject();
        o.put("isTv", ui != null && ui.getCurrentModeType() == Configuration.UI_MODE_TYPE_TELEVISION);
        o.put("voice", RecognizerIntentAvailable());
        o.put("nativeApi", NATIVE_API);
        call.resolve(o);
    }

    private boolean RecognizerIntentAvailable() {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        return i.resolveActivity(getContext().getPackageManager()) != null;
    }

    @PluginMethod
    public void voiceSearch(PluginCall call) {
        Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
        String lang = call.getString("lang", "ar-EG");
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang);
        i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_PREFERENCE, lang);
        i.putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1);
        if (i.resolveActivity(getContext().getPackageManager()) == null) {
            call.reject("Voice search is not available on this device");
            return;
        }
        startActivityForResult(call, i, "onVoiceResult");
    }

    @ActivityCallback
    private void onVoiceResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject o = new JSObject();
        Intent data = result.getData();
        ArrayList<String> texts = data != null ? data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS) : null;
        o.put("text", texts != null && !texts.isEmpty() ? texts.get(0) : "");
        call.resolve(o);
    }
}
