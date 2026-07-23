// Android/Capacitor compatibility shim.
//
// The app's export/import/print code (in the inline data-dc-script below)
// already has its own File System Access API -> Blob+<a download> fallback,
// and that fallback is exactly what desktop browsers and Electron use. But
// Android's WebView has neither showSaveFilePicker nor a working <a download>
// for blob: URLs, and window.print() silently does nothing. This file
// intercepts those two cases and reroutes them through Capacitor's
// Filesystem + Share plugins, using the global Capacitor.Plugins bridge so
// no bundler/import step is needed for a plain <script src> renderer.
//
// Everywhere else (desktop browser, Electron) window.Capacitor is undefined,
// so this whole file is a no-op and behavior is exactly as before.
(function () {
  "use strict";
  // Also guards on the plugin objects themselves, not just
  // isNativePlatform(): if this script runs before Capacitor finishes
  // registering plugins, window.Capacitor.Plugins.Filesystem/.Share could
  // still be undefined, and accessing them unguarded would throw here at
  // load time — see the matching comment in db-bridge.js.
  if (
    !window.Capacitor ||
    !window.Capacitor.isNativePlatform ||
    !window.Capacitor.isNativePlatform() ||
    !window.Capacitor.Plugins ||
    !window.Capacitor.Plugins.Filesystem ||
    !window.Capacitor.Plugins.Share
  ) {
    return;
  }

  var Filesystem = window.Capacitor.Plugins.Filesystem;
  var Share = window.Capacitor.Plugins.Share;

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onloadend = function () {
        resolve(String(reader.result).split(",")[1] || "");
      };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  async function shareBlobDownload(anchor) {
    var filename = anchor.getAttribute("download") || "export";
    var response = await fetch(anchor.href);
    var blob = await response.blob();
    var base64 = await blobToBase64(blob);
    var written = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: "CACHE",
    });
    await Share.share({ title: filename, url: written.uri });
  }

  // The app builds every export as: a.href = blobUrl; a.download = name; a.click();
  // Intercepting HTMLAnchorElement#click for download+blob: anchors covers
  // Excel, JSON export, and Save & Clear without touching app logic at all.
  var originalClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute("download") && this.href && this.href.indexOf("blob:") === 0) {
      shareBlobDownload(this).catch(function (err) {
        console.error("[capacitor-shim] export failed:", err);
        alert("Couldn't save the file: " + (err && err.message ? err.message : err));
      });
      return;
    }
    return originalClick.call(this);
  };

  // Android's WebView doesn't implement WebChromeClient.onCreateWindow(),
  // so window.open(url, "_blank") (used by openNoteLink in the inline
  // script below) silently does nothing there — no new window, no error,
  // no navigation. A same-window navigation via location.href works
  // instead: Capacitor's default WebViewClient only allows navigation to
  // the app's own bundled host, so any http(s) URL outside it is handed
  // off to the OS as an ACTION_VIEW intent, which opens the system
  // browser — the same behavior Electron gets via shell.openExternal()
  // and desktop/mobile web browsers get from window.open() itself.
  window.open = function (url) {
    window.location.href = url;
    return null;
  };

  // Android WebView's window.print() is a silent no-op. android/app/src/
  // main/java/.../PrintPlugin.java exposes the WebView's own
  // createPrintDocumentAdapter() (this is how printing already works in
  // Chrome for Android) as Capacitor.Plugins.Print — same system print
  // dialog desktop/Electron get via window.print(), "Save as PDF" included.
  var PrintPlugin = window.Capacitor.Plugins.Print;
  window.print = function () {
    if (!PrintPlugin) {
      alert("PDF export isn't available on this device — use Export Excel or Export JSON instead.");
      return;
    }
    PrintPlugin.print().catch(function (err) {
      console.error("[capacitor-shim] print failed:", err);
      alert("Couldn't open the print dialog: " + (err && err.message ? err.message : err));
    });
  };
})();
