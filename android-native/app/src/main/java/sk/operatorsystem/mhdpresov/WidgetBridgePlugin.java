package sk.operatorsystem.mhdpresov;

import android.content.Context;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Appka (JS) sem posiela vopred vypočítané najbližšie spoje; widget ich
// číta zo SharedPreferences. Nič neodchádza mimo telefónu.
@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        String data = call.getString("data", "");
        Context ctx = getContext();
        ctx.getSharedPreferences(NextBusWidget.PREFS, Context.MODE_PRIVATE)
            .edit().putString(NextBusWidget.KEY, data).apply();
        NextBusWidget.updateAll(ctx);
        JSObject ret = new JSObject();
        ret.put("widgets", NextBusWidget.ids(ctx).length);
        call.resolve(ret);
    }
}
