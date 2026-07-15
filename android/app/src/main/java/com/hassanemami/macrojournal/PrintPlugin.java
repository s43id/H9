package com.hassanemami.macrojournal;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// WebView already knows how to print its own content via
// createPrintDocumentAdapter() — this just exposes that to JS as
// Capacitor.Plugins.Print.print(), so window.print() (capacitor-shim.js)
// can open the same system print dialog desktop/Electron gets via
// window.print(), "Save as PDF" included, instead of the
// "not available" placeholder alert.
@CapacitorPlugin(name = "Print")
public class PrintPlugin extends Plugin {

    @PluginMethod
    public void print(PluginCall call) {
        PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
        if (printManager == null) {
            call.reject("Print service unavailable on this device");
            return;
        }
        String jobName = "Macro Journal";
        PrintDocumentAdapter adapter = getBridge().getWebView().createPrintDocumentAdapter(jobName);
        printManager.print(jobName, adapter, new PrintAttributes.Builder().build());
        call.resolve();
    }
}
