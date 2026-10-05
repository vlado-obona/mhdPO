package sk.operatorsystem.mhdpresov;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Vlastná aktivita: zaregistruje most pre widget „Najbližší autobus“ a
// sledovanie cesty na pozadí (upozornenie na výstup podľa GPS).
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        registerPlugin(TripTrackerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
