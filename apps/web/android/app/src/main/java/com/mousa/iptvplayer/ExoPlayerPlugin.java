package com.mousa.iptvplayer;

import android.app.Activity;
import android.app.PictureInPictureParams;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Rational;
import android.view.Display;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebView;

import androidx.annotation.NonNull;
import androidx.annotation.OptIn;
import androidx.media3.common.C;
import androidx.media3.common.Format;
import androidx.media3.common.MediaItem;
import androidx.media3.common.PlaybackException;
import androidx.media3.common.PlaybackParameters;
import androidx.media3.common.Player;
import androidx.media3.common.TrackSelectionOverride;
import androidx.media3.common.TrackSelectionParameters;
import androidx.media3.common.Tracks;
import androidx.media3.common.text.Cue;
import androidx.media3.common.text.CueGroup;
import androidx.media3.common.util.UnstableApi;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.HttpDataSource;
import androidx.media3.exoplayer.DefaultLoadControl;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.exoplayer.trackselection.DefaultTrackSelector;
import androidx.media3.ui.AspectRatioFrameLayout;
import androidx.media3.ui.PlayerView;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Map;

/**
 * Media3 ExoPlayer drawn underneath a transparent WebView, so the React UI (controls, subtitles,
 * channel list, EPG) stays on top and D-pad focus stays in one place. Mirrors the JS PlayerAdapter.
 */
@UnstableApi
@CapacitorPlugin(name = "ExoPlayer")
public class ExoPlayerPlugin extends Plugin {
    private static final String UA = "VLC/3.0.20 LibVLC/3.0.20";
    private static final long[] BACKOFF = {1000, 2000, 4000, 8000};

    private ExoPlayer player;
    private PlayerView view;
    private DefaultTrackSelector trackSelector;
    private DefaultHttpDataSource.Factory http;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private int bufferMs = 30_000;
    private boolean live = false;
    private int attempt = 0;
    private String lastStatus = "";
    private boolean frameRateMatching = true;
    private int originalModeId = 0;

    private final Runnable ticker = new Runnable() {
        @Override
        public void run() {
            if (player != null) {
                JSObject t = new JSObject();
                t.put("current", Math.max(0, player.getCurrentPosition()) / 1000.0);
                long d = player.getDuration();
                t.put("duration", d == C.TIME_UNSET || live ? 0 : d / 1000.0);
                t.put("buffered", Math.max(0, player.getBufferedPosition()) / 1000.0);
                notifyListeners("time", t);
                handler.postDelayed(this, 500);
            }
        }
    };

    private void ui(Runnable r) {
        getBridge().executeOnMainThread(r);
    }

    @PluginMethod
    public void create(PluginCall call) {
        ui(() -> {
            if (player == null) build();
            call.resolve();
        });
    }

    @OptIn(markerClass = UnstableApi.class)
    private void build() {
        Activity a = getActivity();
        // FFmpeg audio decoders (AC3, E-AC3, DTS, TrueHD…) are used when the device has none.
        DefaultRenderersFactory renderers = new DefaultRenderersFactory(a)
                .setExtensionRendererMode(DefaultRenderersFactory.EXTENSION_RENDERER_MODE_ON)
                .setEnableDecoderFallback(true);
        trackSelector = new DefaultTrackSelector(a);
        trackSelector.setParameters(trackSelector.buildUponParameters().setTunnelingEnabled(false));
        http = new DefaultHttpDataSource.Factory()
                .setUserAgent(UA)
                .setAllowCrossProtocolRedirects(true)
                .setConnectTimeoutMs(15_000)
                .setReadTimeoutMs(20_000);
        DefaultLoadControl load = new DefaultLoadControl.Builder()
                .setBufferDurationsMs(Math.min(15_000, bufferMs), Math.max(bufferMs, 20_000), 1_500, 3_000)
                .build();
        player = new ExoPlayer.Builder(a, renderers)
                .setTrackSelector(trackSelector)
                .setLoadControl(load)
                .setMediaSourceFactory(new DefaultMediaSourceFactory(http))
                .build();
        player.setVideoChangeFrameRateStrategy(C.VIDEO_CHANGE_FRAME_RATE_STRATEGY_ONLY_IF_SEAMLESS);
        player.addListener(listener);

        view = new PlayerView(a);
        view.setUseController(false);
        view.setResizeMode(AspectRatioFrameLayout.RESIZE_MODE_FIT);
        view.setShutterBackgroundColor(Color.BLACK);
        view.setBackgroundColor(Color.BLACK);
        view.setKeepScreenOn(true);
        if (view.getSubtitleView() != null) view.getSubtitleView().setVisibility(View.GONE); // subtitles are drawn by the web UI
        view.setPlayer(player);
        view.setFocusable(false);

        WebView wv = getBridge().getWebView();
        ViewGroup parent = (ViewGroup) wv.getParent();
        parent.addView(view, 0, new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        wv.setBackgroundColor(Color.TRANSPARENT);
        handler.post(ticker);
    }

    @PluginMethod
    public void load(PluginCall call) {
        String url = call.getString("url");
        boolean isLive = Boolean.TRUE.equals(call.getBoolean("live", false));
        double startAt = call.getDouble("startAt", 0.0);
        Integer buf = call.getInt("bufferMs");
        JSObject headers = call.getObject("headers", new JSObject());
        ui(() -> {
            if (buf != null && buf != bufferMs && player != null) {
                bufferMs = buf;
                release(false);
            }
            if (player == null) build();
            Map<String, String> props = new HashMap<>();
            Iterator<String> it = headers.keys();
            while (it.hasNext()) {
                String k = it.next();
                props.put(k, headers.optString(k));
            }
            if (props.containsKey("User-Agent")) http.setUserAgent(props.remove("User-Agent"));
            else http.setUserAgent(UA);
            http.setDefaultRequestProperties(props);
            live = isLive;
            attempt = 0;
            player.setMediaItem(MediaItem.fromUri(url), isLive ? C.TIME_UNSET : (long) (startAt * 1000));
            player.prepare();
            player.setPlayWhenReady(true);
            emitStatus("loading");
            call.resolve();
        });
    }

    @PluginMethod
    public void play(PluginCall call) {
        ui(() -> {
            if (player != null) {
                if (player.getPlaybackState() == Player.STATE_ENDED) player.seekTo(0);
                player.play();
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void pause(PluginCall call) {
        ui(() -> {
            if (player != null) player.pause();
            call.resolve();
        });
    }

    @PluginMethod
    public void seek(PluginCall call) {
        double pos = call.getDouble("position", 0.0);
        ui(() -> {
            if (player != null) player.seekTo((long) (pos * 1000));
            call.resolve();
        });
    }

    @PluginMethod
    public void setRate(PluginCall call) {
        float rate = call.getFloat("rate", 1f);
        ui(() -> {
            if (player != null) player.setPlaybackParameters(new PlaybackParameters(rate));
            call.resolve();
        });
    }

    @PluginMethod
    public void setBuffer(PluginCall call) {
        bufferMs = call.getInt("bufferMs", 30_000);
        call.resolve(); // applied on the next load (LoadControl is fixed per player instance)
    }

    @PluginMethod
    public void setFrameRateMatching(PluginCall call) {
        frameRateMatching = Boolean.TRUE.equals(call.getBoolean("enabled", true));
        call.resolve();
    }

    @PluginMethod
    public void selectTrack(PluginCall call) {
        String kind = call.getString("kind");
        String id = call.getString("id");
        ui(() -> {
            if (player == null) {
                call.resolve();
                return;
            }
            int type = "audio".equals(kind) ? C.TRACK_TYPE_AUDIO : "text".equals(kind) ? C.TRACK_TYPE_TEXT : C.TRACK_TYPE_VIDEO;
            TrackSelectionParameters.Builder b = player.getTrackSelectionParameters().buildUpon();
            if (id == null || "-1".equals(id)) {
                b.clearOverridesOfType(type);
                if (type == C.TRACK_TYPE_TEXT) b.setTrackTypeDisabled(C.TRACK_TYPE_TEXT, true);
            } else {
                String[] p = id.split(":");
                int gi = Integer.parseInt(p[0]);
                int ti = Integer.parseInt(p[1]);
                List<Tracks.Group> groups = player.getCurrentTracks().getGroups();
                if (gi < groups.size()) {
                    b.setTrackTypeDisabled(type, false);
                    b.setOverrideForType(new TrackSelectionOverride(groups.get(gi).getMediaTrackGroup(), ti));
                }
            }
            player.setTrackSelectionParameters(b.build());
            call.resolve();
        });
    }

    @PluginMethod
    public void enterPip(PluginCall call) {
        ui(() -> {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                PictureInPictureParams params = new PictureInPictureParams.Builder().setAspectRatio(new Rational(16, 9)).build();
                getActivity().enterPictureInPictureMode(params);
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void destroy(PluginCall call) {
        ui(() -> {
            release(true);
            call.resolve();
        });
    }

    private void release(boolean restoreUi) {
        handler.removeCallbacks(ticker);
        handler.removeCallbacksAndMessages(null);
        if (player != null) {
            player.removeListener(listener);
            player.release();
            player = null;
        }
        if (view != null) {
            ViewGroup parent = (ViewGroup) view.getParent();
            if (parent != null) parent.removeView(view);
            view = null;
        }
        restoreDisplayMode();
        if (restoreUi) getBridge().getWebView().setBackgroundColor(Color.parseColor("#0b0d12"));
    }

    @Override
    protected void handleOnDestroy() {
        release(false);
    }

    // ---------- events ----------
    private void emitStatus(String s) {
        if (s.equals(lastStatus)) return;
        lastStatus = s;
        JSObject o = new JSObject();
        o.put("status", s);
        notifyListeners("state", o);
    }

    private void emitTracks(Tracks tracks) {
        JSArray arr = new JSArray();
        List<Tracks.Group> groups = tracks.getGroups();
        for (int gi = 0; gi < groups.size(); gi++) {
            Tracks.Group g = groups.get(gi);
            String kind = g.getType() == C.TRACK_TYPE_AUDIO ? "audio" : g.getType() == C.TRACK_TYPE_TEXT ? "text" : g.getType() == C.TRACK_TYPE_VIDEO ? "video" : null;
            if (kind == null) continue;
            for (int ti = 0; ti < g.length; ti++) {
                if (!g.isTrackSupported(ti) && !"text".equals(kind)) continue;
                Format f = g.getTrackFormat(ti);
                JSObject t = new JSObject();
                t.put("id", gi + ":" + ti);
                t.put("kind", kind);
                String label = f.label != null ? f.label : f.language != null ? f.language : ("video".equals(kind) && f.height > 0 ? f.height + "p" : kind + " " + (ti + 1));
                if ("audio".equals(kind) && f.codecs != null) label += " (" + shortCodec(f) + ")";
                t.put("label", label);
                if (f.language != null) t.put("lang", f.language);
                t.put("active", g.isTrackSelected(ti));
                arr.put(t);
            }
        }
        JSObject o = new JSObject();
        o.put("tracks", arr);
        notifyListeners("tracks", o);
    }

    private static String shortCodec(Format f) {
        String m = f.sampleMimeType != null ? f.sampleMimeType : "";
        if (m.contains("ac3") || m.contains("eac3")) return m.contains("eac3") ? "E-AC3" : "AC3";
        if (m.contains("dts")) return "DTS";
        if (m.contains("mp4a")) return "AAC";
        if (m.contains("opus")) return "Opus";
        return f.codecs;
    }

    private void fail(String code, String message) {
        emitStatus("error");
        JSObject o = new JSObject();
        o.put("code", code);
        o.put("message", message);
        notifyListeners("error", o);
    }

    private void retry() {
        if (attempt >= BACKOFF.length) {
            fail("network", "Stream dropped");
            return;
        }
        long delay = BACKOFF[attempt++];
        JSObject o = new JSObject();
        o.put("attempt", attempt);
        o.put("max", BACKOFF.length);
        notifyListeners("retry", o);
        emitStatus("buffering");
        handler.postDelayed(() -> {
            if (player == null) return;
            if (live) player.seekToDefaultPosition();
            player.prepare();
            player.play();
        }, delay);
    }

    private final Player.Listener listener = new Player.Listener() {
        @Override
        public void onPlaybackStateChanged(int state) {
            if (state == Player.STATE_BUFFERING) emitStatus("buffering");
            else if (state == Player.STATE_ENDED) emitStatus("ended");
            else if (state == Player.STATE_READY) emitStatus(player != null && player.isPlaying() ? "playing" : "paused");
        }

        @Override
        public void onIsPlayingChanged(boolean isPlaying) {
            if (isPlaying) {
                attempt = 0;
                emitStatus("playing");
            } else if (player != null && player.getPlaybackState() == Player.STATE_READY) {
                emitStatus("paused");
            }
        }

        @Override
        public void onTracksChanged(@NonNull Tracks tracks) {
            emitTracks(tracks);
            if (frameRateMatching) matchFrameRate(tracks);
        }

        @Override
        public void onCues(@NonNull CueGroup cueGroup) {
            JSArray lines = new JSArray();
            for (Cue c : cueGroup.cues) if (c.text != null) lines.put(c.text.toString());
            JSObject o = new JSObject();
            o.put("lines", lines);
            notifyListeners("cues", o);
        }

        @Override
        public void onPlayerError(@NonNull PlaybackException error) {
            int code = error.errorCode;
            if (code == PlaybackException.ERROR_CODE_BEHIND_LIVE_WINDOW && player != null) {
                player.seekToDefaultPosition();
                player.prepare();
                return;
            }
            Throwable cause = error.getCause();
            if (cause instanceof HttpDataSource.InvalidResponseCodeException) {
                int status = ((HttpDataSource.InvalidResponseCodeException) cause).responseCode;
                if (status == 401 || status == 403) { fail("forbidden", "HTTP " + status); return; }
                if (status == 404) { fail("notFound", "HTTP 404"); return; }
                if (status == 429 || status == 458 || status == 509) { fail("maxConnections", "HTTP " + status); return; }
            }
            if (code == PlaybackException.ERROR_CODE_DECODER_INIT_FAILED
                    || code == PlaybackException.ERROR_CODE_DECODING_FORMAT_UNSUPPORTED
                    || code == PlaybackException.ERROR_CODE_DECODING_FORMAT_EXCEEDS_CAPABILITIES
                    || code == PlaybackException.ERROR_CODE_PARSING_CONTAINER_UNSUPPORTED) {
                fail("unsupported", error.getErrorCodeName());
                return;
            }
            retry();
        }
    };

    // ---------- auto frame-rate matching (Android TV) ----------
    private void matchFrameRate(Tracks tracks) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        float fps = 0;
        for (Tracks.Group g : tracks.getGroups()) {
            if (g.getType() != C.TRACK_TYPE_VIDEO) continue;
            for (int i = 0; i < g.length; i++) if (g.isTrackSelected(i)) fps = g.getTrackFormat(i).frameRate;
        }
        if (fps <= 0) return;
        Activity a = getActivity();
        Display display = a.getWindowManager().getDefaultDisplay();
        Display.Mode current = display.getMode();
        Display.Mode best = null;
        for (Display.Mode m : display.getSupportedModes()) {
            if (m.getPhysicalWidth() != current.getPhysicalWidth() || m.getPhysicalHeight() != current.getPhysicalHeight()) continue;
            float r = m.getRefreshRate();
            float ratio = r / fps;
            if (Math.abs(ratio - Math.round(ratio)) < 0.01f && Math.round(ratio) >= 1) {
                if (best == null || Math.abs(r - fps) < Math.abs(best.getRefreshRate() - fps)) best = m;
            }
        }
        if (best == null || best.getModeId() == current.getModeId()) return;
        WindowManager.LayoutParams lp = a.getWindow().getAttributes();
        if (originalModeId == 0) originalModeId = current.getModeId();
        lp.preferredDisplayModeId = best.getModeId();
        a.getWindow().setAttributes(lp);
    }

    private void restoreDisplayMode() {
        if (originalModeId == 0 || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return;
        WindowManager.LayoutParams lp = getActivity().getWindow().getAttributes();
        lp.preferredDisplayModeId = 0;
        getActivity().getWindow().setAttributes(lp);
        originalModeId = 0;
    }
}
