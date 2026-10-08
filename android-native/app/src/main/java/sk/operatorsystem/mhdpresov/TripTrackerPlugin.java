package sk.operatorsystem.mhdpresov;

import android.content.Context;
import android.content.Intent;
import android.location.Location;
import android.os.Build;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Most medzi režimom cesty v appke (JS) a službou TripTrackerService.
// JS: start/update (text notifikácie, koniec cesty, ciele pre zálohu),
// beat (JS žije), stop, getState; udalosti „location“ a „fired“.
@CapacitorPlugin(name = "TripTracker")
public class TripTrackerPlugin extends Plugin {
    private static volatile TripTrackerPlugin instance;

    @Override
    public void load() { instance = this; }

    @Override
    protected void handleOnDestroy() { if (instance == this) instance = null; }

    private void apply(PluginCall call) {
        if (call.hasOption("text")) TripTrackerService.text = call.getString("text", "");
        Object u = call.getData().opt("until");
        if (u instanceof Number) TripTrackerService.until = ((Number) u).longValue();
        JSArray t = call.getArray("targets");
        if (t != null) synchronized (TripTrackerService.class) { TripTrackerService.targets = t; }
        TripTrackerService.lastBeat = SystemClock.elapsedRealtime();
    }

    @PluginMethod
    public void start(PluginCall call) {
        Context ctx = getContext();
        if (!TripTrackerService.hasLocationPermission(ctx)) { call.reject("Bez povolenia polohy"); return; }
        apply(call);
        synchronized (TripTrackerService.class) {
            while (TripTrackerService.fired.length() > 0) TripTrackerService.fired.remove(0);
        }
        Intent i = new Intent(ctx, TripTrackerService.class).setAction(TripTrackerService.ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i); else ctx.startService(i);
            call.resolve();
        } catch (RuntimeException e) {
            call.reject("Sledovanie sa nedá spustiť: " + e.getMessage());
        }
    }

    @PluginMethod
    public void update(PluginCall call) {
        apply(call);
        if (call.hasOption("text")) TripTrackerService.refresh(getContext());
        call.resolve();
    }

    @PluginMethod
    public void beat(PluginCall call) {
        TripTrackerService.lastBeat = SystemClock.elapsedRealtime();
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        if (TripTrackerService.running) {
            Intent i = new Intent(ctx, TripTrackerService.class).setAction(TripTrackerService.ACTION_STOP);
            try { ctx.startService(i); } catch (RuntimeException e) { ctx.stopService(new Intent(ctx, TripTrackerService.class)); }
        }
        call.resolve();
    }

    // tlačidlo „Ukončiť“: zastaví sledovanie a zavrie appku aj zo zoznamu
    // „Nedávne“ (App.exitApp volá len finish() — karta by ostala a jej otvorenie
    // by zopakovalo odkaz z widgetu)
    @PluginMethod
    public void closeApp(PluginCall call) {
        Context ctx = getContext();
        if (TripTrackerService.running) {
            Intent i = new Intent(ctx, TripTrackerService.class).setAction(TripTrackerService.ACTION_STOP);
            try { ctx.startService(i); } catch (RuntimeException e) { ctx.stopService(new Intent(ctx, TripTrackerService.class)); }
        }
        call.resolve();
        if (getActivity() != null) getActivity().runOnUiThread(() -> getActivity().finishAndRemoveTask());
    }

    @PluginMethod
    public void getState(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("running", TripTrackerService.running);
        JSArray f = new JSArray();
        synchronized (TripTrackerService.class) {
            for (int k = 0; k < TripTrackerService.fired.length(); k++) f.put(TripTrackerService.fired.opt(k));
        }
        ret.put("fired", f);
        call.resolve(ret);
    }

    static void emitLocation(Location loc) {
        TripTrackerPlugin p = instance;
        if (p == null) return;
        JSObject d = new JSObject();
        d.put("latitude", loc.getLatitude());
        d.put("longitude", loc.getLongitude());
        d.put("accuracy", loc.hasAccuracy() ? loc.getAccuracy() : 30);
        if (loc.hasSpeed()) d.put("speed", loc.getSpeed());
        d.put("time", loc.getTime());
        d.put("provider", loc.getProvider());
        p.notifyListeners("location", d);
    }

    static void emitFired(int k) {
        TripTrackerPlugin p = instance;
        if (p == null) return;
        JSObject d = new JSObject();
        d.put("k", k);
        p.notifyListeners("fired", d);
    }
}
