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
  if (!window.Capacitor || !window.Capacitor.isNativePlatform || !window.Capacitor.isNativePlatform()) {
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

  // Android WebView's window.print() is a silent no-op — tell the user
  // rather than have "Export PDF" appear to do nothing.
  window.print = function () {
    alert("PDF export isn't available on Android yet — use Export Excel or Export JSON instead.");
  };
})();
