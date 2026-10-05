package sk.operatorsystem.mhdpresov;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.SystemClock;
import org.json.JSONArray;
import org.json.JSONObject;

// Režim cesty: služba v popredí s trvalou notifikáciou „Sledujem cestu“.
// Spúšťa ju appka, keď je na obrazovke (poloha „pri používaní“ — bez
// povolenia na pozadí), a drží GPS aj pri zamknutom displeji. Polohy
// posiela do appky (JS vyhodnocuje jazdu a upozorňuje na výstup). Keď JS
// neodpovedá (systém WebView uspal), upozorní na výstup služba sama.
// Poloha sa nikam neposiela — spracúva sa len v telefóne.
public class TripTrackerService extends Service {
    static final String ACTION_START = "sk.operatorsystem.mhdpresov.TRIP_START";
    static final String ACTION_UPDATE = "sk.operatorsystem.mhdpresov.TRIP_UPDATE";
    static final String ACTION_STOP = "sk.operatorsystem.mhdpresov.TRIP_STOP";
    static final int NOTIF_ID = 7400;
    static final int ALERT_BASE = 7300;              // rovnaké ID ako upozornenia z appky
    static final String CH_TRACK = "odkialkam-cesta";
    static final String CH_ALERT = "mhd-vystup";     // kanál vytvára appka (zvuk + vibrácie)
    static final long JS_SILENT_MS = 15000;          // JS bez odozvy dlhšie = upozorní služba

    // stav zdieľaný s pluginom (jeden proces)
    static volatile boolean running = false;
    static volatile String text = "";
    static volatile long until = 0;
    static volatile long lastBeat = 0;               // elapsedRealtime posledného signálu z JS
    static volatile JSONArray targets = new JSONArray();
    static final JSONArray fired = new JSONArray();

    private LocationManager lm;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable expire = new Runnable() {
        @Override public void run() {
            if (until > 0 && System.currentTimeMillis() > until) stopTracking();
            else handler.postDelayed(this, 60000);
        }
    };
    private final LocationListener listener = new LocationListener() {
        @Override public void onLocationChanged(Location loc) { onFix(loc); }
        @Override public void onProviderEnabled(String p) {}
        @Override public void onProviderDisabled(String p) {}
        @Override public void onStatusChanged(String p, int s, Bundle b) {}
    };

    static boolean hasLocationPermission(Context ctx) {
        return ctx.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ctx.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action) || !hasLocationPermission(this)) {
            stopTracking();
            return START_NOT_STICKY;
        }
        Notification n = buildNotification();
        if (ACTION_UPDATE.equals(action) && running) {
            // len nový text — startForeground znova nevolať (appka môže byť v pozadí)
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) { try { nm.notify(NOTIF_ID, n); } catch (SecurityException ignored) {} }
            return START_NOT_STICKY;
        }
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
            else startForeground(NOTIF_ID, n);
        } catch (RuntimeException e) {
            // Android 12+ nedovolí spustiť z pozadia / bez povolenia polohy
            running = false;
            stopSelf();
            return START_NOT_STICKY;
        }
        if (!running) {
            running = true;
            lastBeat = SystemClock.elapsedRealtime();
            startLocation();
            handler.postDelayed(expire, 60000);
        }
        return START_NOT_STICKY;
    }

    private void startLocation() {
        lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return;
        try {
            if (lm.isProviderEnabled(LocationManager.GPS_PROVIDER))
                lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 2000, 0, listener, Looper.getMainLooper());
            if (lm.isProviderEnabled(LocationManager.NETWORK_PROVIDER))
                lm.requestLocationUpdates(LocationManager.NETWORK_PROVIDER, 5000, 0, listener, Looper.getMainLooper());
        } catch (SecurityException | IllegalArgumentException e) {
            stopTracking();
        }
    }

    private void onFix(Location loc) {
        TripTrackerPlugin.emitLocation(loc);
        // JS spracúva polohy — upozorní on (aj s hlasom). Inak záloha tu.
        if (SystemClock.elapsedRealtime() - lastBeat > JS_SILENT_MS) checkTargets(loc);
    }

    // záloha: ďalší cieľ v poradí — upozorniť pri priblížení k predposlednej
    // zastávke jazdy (vo vozidle) alebo priamo pri výstupnej zastávke
    private void checkTargets(Location loc) {
        if (loc.getAccuracy() > 150) return;
        JSONObject tg;
        synchronized (TripTrackerService.class) {
            if (targets.length() == 0) return;
            tg = targets.optJSONObject(0);
        }
        if (tg == null) return;
        float[] d = new float[1];
        Location.distanceBetween(loc.getLatitude(), loc.getLongitude(), tg.optDouble("la"), tg.optDouble("lo"), d);
        float dPrev = d[0];
        Location.distanceBetween(loc.getLatitude(), loc.getLongitude(), tg.optDouble("ela"), tg.optDouble("elo"), d);
        float dExit = d[0];
        boolean moving = loc.hasSpeed() && loc.getSpeed() > 2f;
        if (dExit < 60 || (dPrev < 150 && moving)) {
            alert(tg, dExit < 60);
            synchronized (TripTrackerService.class) {
                JSONArray rest = new JSONArray();
                for (int i = 1; i < targets.length(); i++) rest.put(targets.opt(i));
                targets = rest;
                fired.put(tg.optInt("k"));
            }
            TripTrackerPlugin.emitFired(tg.optInt("k"));
        }
    }

    private void alert(JSONObject tg, boolean now) {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CH_ALERT) == null) {
            NotificationChannel ch = new NotificationChannel(CH_ALERT, "Upozornenie na výstup", NotificationManager.IMPORTANCE_HIGH);
            ch.enableVibration(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        String title = tg.optString(now ? "titleNow" : "title", "🔔 Vystupuj na ďalšej zastávke");
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_ALERT) : new Notification.Builder(this);
        b.setSmallIcon(getApplicationInfo().icon)
            .setContentTitle(title)
            .setContentText(tg.optString("body", ""))
            .setCategory(Notification.CATEGORY_ALARM)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(openApp());
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_MAX).setDefaults(Notification.DEFAULT_ALL);
        try { nm.notify(ALERT_BASE + tg.optInt("k"), b.build()); } catch (SecurityException ignored) {}
    }

    private PendingIntent openApp() {
        Intent i = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (i == null) i = new Intent(this, MainActivity.class);
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm != null && nm.getNotificationChannel(CH_TRACK) == null) {
            NotificationChannel ch = new NotificationChannel(CH_TRACK, "Sledovanie cesty", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Kým je zapnutý režim cesty, appka sleduje polohu, aby ťa upozornila na výstup.");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(this, CH_TRACK) : new Notification.Builder(this);
        b.setSmallIcon(getApplicationInfo().icon)
            .setContentTitle("Odkiaľ Kam sleduje tvoju cestu")
            .setContentText(text == null || text.isEmpty() ? "Upozorní ťa pred výstupom aj pri zamknutom displeji." : text)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(Notification.CATEGORY_NAVIGATION)
            .setContentIntent(openApp());
        PendingIntent stop = PendingIntent.getService(this, 1,
            new Intent(this, TripTrackerService.class).setAction(ACTION_STOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        b.addAction(new Notification.Action.Builder(null, "Ukončiť sledovanie", stop).build());
        if (Build.VERSION.SDK_INT >= 31) b.setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE);
        return b.build();
    }

    static void refresh(Context ctx) {
        if (!running) return;
        Intent i = new Intent(ctx, TripTrackerService.class).setAction(ACTION_UPDATE);
        try { ctx.startService(i); } catch (RuntimeException ignored) {}
    }

    private void stopTracking() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        if (lm != null) { try { lm.removeUpdates(listener); } catch (SecurityException ignored) {} }
        synchronized (TripTrackerService.class) { targets = new JSONArray(); }
        if (Build.VERSION.SDK_INT >= 24) stopForeground(STOP_FOREGROUND_REMOVE); else stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        if (lm != null) { try { lm.removeUpdates(listener); } catch (SecurityException ignored) {} }
        super.onDestroy();
    }

    // appku zavrel zo zoznamu posledných: sledovanie beží ďalej (JS už nie je,
    // upozorní záloha v službe) — skončí s koncom cesty (until) alebo ťukom „Ukončiť“
}
