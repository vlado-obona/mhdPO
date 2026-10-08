package sk.operatorsystem.mhdpresov;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Vlastná aktivita: zaregistruje most pre widget „Najbližší autobus“ a
// sledovanie cesty na pozadí (upozornenie na výstup podľa GPS).
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Otvorenie zo zoznamu „Nedávne“ zopakuje pôvodný intent úlohy — ak ju
        // spustil widget (odkialkam://widget…), appka by znova spustila cestu
        // alebo sa skryla. Odkaz sa platí len pri skutočnom ťuknutí na widget.
        Intent i = getIntent();
        if (i != null && i.getData() != null && (i.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) {
            setIntent(new Intent(i).setData(null));
        }
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(TripTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
