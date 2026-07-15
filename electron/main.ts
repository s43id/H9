import { app, BrowserWindow, session, shell, Menu, ipcMain } from "electron";
import path from "path";
import * as db from "./db";

const APP_HTML = path.join(__dirname, "..", "app", "index.html");
const ICON_PATH = path.join(__dirname, "..", "build-resources", "icon.png");
const PRELOAD = path.join(__dirname, "preload.js");

function sendMenuAction(action: string): void {
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
  win?.webContents.send("menu-action", action);
}

function buildMenu(): void {
  // New Entry/Save/Open/Export/Backup/Restore all just forward to the
  // renderer, which runs the exact same handlers the in-page ☰ menu calls
  // (app/index.html's handleMenuAction) — one implementation per action,
  // regardless of which UI triggered it.
  const fileItems: Electron.MenuItemConstructorOptions[] = [
    { label: "New Entry", accelerator: "CmdOrCtrl+N", click: () => sendMenuAction("new-entry") },
    { label: "Save", accelerator: "CmdOrCtrl+S", click: () => sendMenuAction("save") },
    { label: "Open", accelerator: "CmdOrCtrl+O", click: () => sendMenuAction("open") },
    { type: "separator" },
    { label: "Export PDF", click: () => sendMenuAction("export-pdf") },
    { label: "Export Excel", click: () => sendMenuAction("export-excel") },
    { type: "separator" },
    { label: "Backup Database…", click: () => sendMenuAction("backup") },
    { label: "Restore Database…", click: () => sendMenuAction("restore") },
  ];

  const template: Electron.MenuItemConstructorOptions[] = [];
  if (process.platform === "darwin") {
    template.push({ role: "appMenu" });
    template.push({ label: "File", submenu: fileItems });
  } else {
    template.push({ label: "File", submenu: [...fileItems, { type: "separator" }, { label: "Exit", role: "quit" }] });
  }
  template.push({ role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 480,
    minHeight: 600,
    backgroundColor: "#10233a",
    icon: ICON_PATH,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: PRELOAD,
    },
  });

  // Note links (openNoteLink -> window.open(link, "_blank")) should open in
  // the user's default browser, not spawn a chromeless Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadFile(APP_HTML);
}

function registerDbHandlers(): void {
  ipcMain.handle("db:list", () => db.list());
  ipcMain.handle("db:load", (_e, key: string) => db.load(key));
  ipcMain.handle("db:save", (_e, args: { key: string; label: string; year: number; month: number; data: unknown }) =>
    db.save(args.key, args.label, args.year, args.month, args.data)
  );
  ipcMain.handle("db:remove", (_e, key: string) => db.remove(key));
  ipcMain.handle("db:backup", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || BrowserWindow.getAllWindows()[0];
    return db.backup(win);
  });
  ipcMain.handle("db:restore", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) || BrowserWindow.getAllWindows()[0];
    return db.restore(win);
  });
}

app.whenReady().then(() => {
  // Everything the app needs (React, ReactDOM, dc-runtime, fonts, the JSON
  // it saves/loads) is local, so a strict CSP with no external origins costs
  // nothing and closes off the CDN fallback dc-runtime would otherwise try.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          // 'unsafe-inline' covers the renderer's inline <script> tags
          // (window.__resources setup, the app's data-dc-script class).
          // 'unsafe-eval' is required because dc-runtime evaluates that
          // class body via `new Function(...)` rather than as a static
          // script — confirmed by testing with it omitted (app silently
          // falls back to a props-only, non-interactive render). Neither
          // relaxation reaches outside this page: there is no remote or
          // user-supplied content anywhere in it.
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' blob:",
        ],
      },
    });
  });

  registerDbHandlers();
  buildMenu();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
