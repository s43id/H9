import { app, BrowserWindow, session, shell } from "electron";
import path from "path";

const APP_HTML = path.join(__dirname, "..", "app", "index.html");
const ICON_PATH = path.join(__dirname, "..", "build-resources", "icon.png");

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
          "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'",
        ],
      },
    });
  });

  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
