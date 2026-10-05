package sk.operatorsystem.mhdpresov;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

// Vlastná aktivita: zaregistruje most pre widget „Najbližší autobus“.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(WidgetBridgePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
