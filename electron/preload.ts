import { contextBridge, ipcRenderer } from "electron";

// Mirrors the shape scripts/static/db-bridge.js implements for Android and
// plain-browser fallback — same one-record-per-period model, just backed by
// real files in the OS user-data directory instead of Capacitor Filesystem
// or localStorage. db-bridge.js checks for window.journalDB before doing
// anything, so this preload-provided version always wins in Electron.
contextBridge.exposeInMainWorld("journalDB", {
  list: () => ipcRenderer.invoke("db:list"),
  load: (key: string) => ipcRenderer.invoke("db:load", key),
  save: (key: string, label: string, year: number, month: number, data: unknown) =>
    ipcRenderer.invoke("db:save", { key, label, year, month, data }),
  remove: (key: string) => ipcRenderer.invoke("db:remove", key),
  backup: () => ipcRenderer.invoke("db:backup"),
  restore: () => ipcRenderer.invoke("db:restore"),
});

// The native File menu (electron/main.ts) sends these instead of the
// renderer owning any menu UI of its own; the app's ☰ dropdown and the
// native File menu both end up calling the exact same in-page handlers.
contextBridge.exposeInMainWorld("nativeMenu", {
  onAction: (callback: (action: string) => void) => {
    ipcRenderer.on("menu-action", (_event, action: string) => callback(action));
  },
});

// window.print() on Windows opens the native OS print dialog, which for
// Electron apps shows "This app doesn't support print preview" and lists
// physical/virtual printers rather than offering a direct "Save as PDF" —
// confusing, and easy to point at the wrong destination. printToPDF()
// renders straight to a PDF buffer (respecting the app's own print CSS,
// including print-color-adjust:exact) and this writes it to a file the
// user picks via a native Save dialog — no OS print dialog involved.
contextBridge.exposeInMainWorld("electronPrint", {
  exportPDF: (filename: string) => ipcRenderer.invoke("export-pdf", filename),
});
