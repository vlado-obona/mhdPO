package sk.operatorsystem.mhdpresov;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.widget.RemoteViews;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONObject;

// Widget „Najbližší autobus“ (Odkiaľ Kam Plus). Zobrazuje najbližší spoj
// z vopred vypočítaného zoznamu (cestovné poriadky sú v appke, widget nič
// nesťahuje) a prekreslí sa po odchode spoja.
public class NextBusWidget extends AppWidgetProvider {
    static final String PREFS = "odkialkam_widget";
    static final String KEY = "data";

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        render(ctx, mgr, ids);
    }

    static int[] ids(Context ctx) {
        return AppWidgetManager.getInstance(ctx).getAppWidgetIds(new ComponentName(ctx, NextBusWidget.class));
    }

    static void updateAll(Context ctx) {
        render(ctx, AppWidgetManager.getInstance(ctx), ids(ctx));
    }

    private static String hm(long ms) {
        SimpleDateFormat f = new SimpleDateFormat("H:mm", new Locale("sk", "SK"));
        f.setTimeZone(TimeZone.getTimeZone("Europe/Bratislava"));
        return f.format(new Date(ms));
    }

    static void render(Context ctx, AppWidgetManager mgr, int[] ids) {
        if (ids == null || ids.length == 0) return;
        long now = System.currentTimeMillis();
        String title = "Odkiaľ Kam", line = "", time = "", sub = "", next = "", url = "odkialkam://widget";
        int lineBg = Color.parseColor("#0b7a3b"), lineFg = Color.WHITE;
        long nextUpdate = now + 30 * 60 * 1000L;
        boolean showLine = false;
        try {
            String raw = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY, "");
            JSONObject d = raw.isEmpty() ? new JSONObject() : new JSONObject(raw);
            title = d.optString("title", title);
            if (raw.isEmpty()) {
                time = "Otvor appku";
                sub = "Widget sa nastaví po spustení Odkiaľ Kam";
            } else if (!d.optBoolean("plus", false)) {
                time = "Odkiaľ Kam Plus";
                sub = "Widget je súčasť Plus · ťukni a zisti viac";
                url = "odkialkam://plus";
            } else if (!d.has("j")) {
                time = "Nastav widget";
                sub = "V appke: ⭐ Odkiaľ Kam Plus → Widget";
                url = "odkialkam://plus";
            } else {
                JSONArray j = d.getJSONArray("j");
                int first = -1;
                for (int i = 0; i < j.length(); i++) {
                    if (j.getJSONObject(i).getLong("d") > now - 20000) { first = i; break; }
                }
                if (first < 0) {
                    time = "Otvor appku";
                    sub = "Obnoví najbližšie spoje";
                } else {
                    JSONObject e = j.getJSONObject(first);
                    showLine = true;
                    line = e.optString("l", "");
                    try { lineBg = Color.parseColor("#" + e.optString("c", "0b7a3b")); } catch (Exception ignored) {}
                    try { lineFg = Color.parseColor("#" + e.optString("tc", "ffffff")); } catch (Exception ignored) {}
                    time = hm(e.getLong("d"));
                    long walk = e.optLong("w", e.getLong("d"));
                    String from = e.optString("s", "");
                    sub = (walk < e.getLong("d") - 60000 ? "vyraz " + hm(walk) + " · " : "")
                        + "z " + from + " · v cieli " + hm(e.getLong("a"));
                    StringBuilder nb = new StringBuilder();
                    for (int i = first + 1; i < j.length() && i <= first + 3; i++) {
                        JSONObject n = j.getJSONObject(i);
                        if (nb.length() > 0) nb.append("   ");
                        nb.append(hm(n.getLong("d"))).append(" (").append(n.optString("l", "")).append(")");
                    }
                    next = nb.length() > 0 ? "ďalšie: " + nb : "";
                    nextUpdate = e.getLong("d") + 30000;
                }
            }
        } catch (Exception ex) {
            time = "Otvor appku";
            sub = "";
        }

        Intent open = new Intent(ctx, MainActivity.class)
            .setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse(url))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent click = PendingIntent.getActivity(ctx, 0, open,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        for (int id : ids) {
            RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.widget_next_bus);
            v.setTextViewText(R.id.w_title, title);
            v.setTextViewText(R.id.w_time, time);
            v.setTextViewText(R.id.w_sub, sub);
            v.setTextViewText(R.id.w_next, next);
            v.setViewVisibility(R.id.w_next, next.isEmpty() ? android.view.View.GONE : android.view.View.VISIBLE);
            v.setViewVisibility(R.id.w_line, showLine ? android.view.View.VISIBLE : android.view.View.GONE);
            v.setTextViewText(R.id.w_line, line);
            v.setInt(R.id.w_line, "setBackgroundColor", lineBg);
            v.setTextColor(R.id.w_line, lineFg);
            v.setOnClickPendingIntent(R.id.w_root, click);
            mgr.updateAppWidget(id, v);
        }

        // prekresliť po odchode spoja (nepresný budík — nepotrebuje povolenie)
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        if (am != null) {
            Intent u = new Intent(ctx, NextBusWidget.class)
                .setAction(AppWidgetManager.ACTION_APPWIDGET_UPDATE)
                .putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, ids);
            PendingIntent pi = PendingIntent.getBroadcast(ctx, 1, u,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.setAndAllowWhileIdle(AlarmManager.RTC, Math.max(nextUpdate, now + 60000), pi);
        }
    }
}
