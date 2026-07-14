#!/usr/bin/env node
// Extracts the self-unpacking bundler HTML export ("Macro Journal (standalone) (5).html")
// into a plain static site under app/: real asset files instead of runtime
// base64+gzip blob unpacking, so it needs no CSP-unfriendly tricks (blob: URLs,
// DecompressionStream) to run inside Electron or an Android WebView.
//
// Usage: node scripts/extract-app.js

const fs = require("fs");
const zlib = require("zlib");
const path = require("path");

const SOURCE = path.join(__dirname, "..", "Macro Journal (standalone) (5).html");
const OUT_DIR = path.join(__dirname, "..", "app");

function extractScriptTag(html, type) {
  const re = new RegExp(`<script type="${type}">([\\s\\S]*?)</script>`);
  const m = html.match(re);
  if (!m) throw new Error(`Missing <script type="${type}"> in source file`);
  return m[1];
}

function main() {
  const html = fs.readFileSync(SOURCE, "utf8");
  const manifest = JSON.parse(extractScriptTag(html, "__bundler/manifest"));
  const extResources = JSON.parse(extractScriptTag(html, "__bundler/ext_resources"));
  let template = JSON.parse(extractScriptTag(html, "__bundler/template"));

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT_DIR, "assets", "fonts"), { recursive: true });

  const extUuidToUrl = {};
  for (const r of extResources) extUuidToUrl[r.uuid] = r.id;

  const nameMap = {};
  for (const [uuid, entry] of Object.entries(manifest)) {
    let buf = Buffer.from(entry.data, "base64");
    if (entry.compressed) buf = zlib.gunzipSync(buf);

    let relPath;
    if (entry.mime === "text/javascript") {
      const cdnUrl = extUuidToUrl[uuid] || "";
      if (cdnUrl.includes("react-dom")) relPath = "assets/react-dom.production.min.js";
      else if (cdnUrl.includes("/react@")) relPath = "assets/react.production.min.js";
      else relPath = "assets/dc-runtime.js"; // the template-rendering runtime, not from a CDN
    } else if (entry.mime === "image/jpeg") {
      relPath = "assets/avatar.jpg";
    } else if (entry.mime === "font/woff2") {
      relPath = `assets/fonts/${uuid}.woff2`;
    } else {
      relPath = `assets/${uuid}.bin`;
    }

    fs.mkdirSync(path.dirname(path.join(OUT_DIR, relPath)), { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, relPath), buf);
    nameMap[uuid] = relPath;
  }

  for (const [uuid, relPath] of Object.entries(nameMap)) {
    template = template.split(uuid).join(relPath);
  }

  // dc-runtime checks window.__resources[cdnUrl] before falling back to a live
  // CDN fetch for React/ReactDOM — populate it statically instead of building
  // it at runtime from unpacked blobs.
  const resourceMapEntries = extResources.map(
    (r) => `  ${JSON.stringify(r.id)}: ${JSON.stringify(nameMap[r.uuid])}`
  );
  const resourceScript =
    `<script>\nwindow.__resources = {\n${resourceMapEntries.join(",\n")}\n};\n</script>\n`;
  template = template.replace(/(<head[^>]*>)/i, `$1\n${resourceScript}`);

  // All fonts are local now; this preconnect hint is dead weight offline.
  template = template.replace(
    /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n?/,
    ""
  );

  // Same policy Electron sets via response header (electron/main.ts) — baked
  // in here too so the Capacitor/Android build and a plain browser preview
  // get it as well. unsafe-inline: the page's own inline <script> tags.
  // unsafe-eval: dc-runtime evaluates the app's component class via
  // `new Function(...)` — confirmed required by testing with it omitted
  // (app silently falls back to a non-interactive, props-only render).
  // connect-src blob:: the Android shim (capacitor-shim.js) does
  // fetch(anchor.href) on the app's own blob: export URLs to read their
  // content back out — confirmed required by testing with it omitted
  // (fetch was refused, export silently failed on Android).
  const csp =
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
    "style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self' blob:";
  template = template.replace(
    /(<head[^>]*>)/i,
    `$1\n<meta http-equiv="Content-Security-Policy" content="${csp}">\n`
  );

  // Android WebView has no File System Access API and no working
  // window.print(); this shim is a no-op everywhere else (guarded on
  // window.Capacitor.isNativePlatform()) so desktop/Electron/browser
  // behavior is untouched. See app/assets/capacitor-shim.js.
  template = template.replace(
    /(<script src="assets\/dc-runtime\.js"><\/script>)/,
    `<script src="assets/capacitor-shim.js"></script>\n$1`
  );

  // The source file wires exportPDF/exportExcel to toolbar buttons but leaves
  // exportJSON/importJSONPrompt as dead code (no button calls them, in the
  // original file too). Add the two missing buttons so JSON export/import is
  // actually reachable, matching the existing toolbar button style.
  template = template.replace(
    '<button sc-camel-on-click="{{ exportExcel }}" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:#fff;color:#10233a;font-size:13px;cursor:pointer;border-top:1px solid #eee;" style-hover="background:#f6f3ea;">Export Excel</button>\n        </div>',
    '<button sc-camel-on-click="{{ exportExcel }}" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:#fff;color:#10233a;font-size:13px;cursor:pointer;border-top:1px solid #eee;" style-hover="background:#f6f3ea;">Export Excel</button>\n          <button sc-camel-on-click="{{ exportJSON }}" style="display:block;width:100%;text-align:left;padding:10px 14px;border:none;background:#fff;color:#10233a;font-size:13px;cursor:pointer;border-top:1px solid #eee;" style-hover="background:#f6f3ea;">Export JSON</button>\n        </div>'
  );
  template = template.replace(
    '<button sc-camel-on-click="{{ saveAll }}" style="flex-shrink:0;white-space:nowrap;padding:7px 14px;border:none;background:#c8963e;color:#10233a;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;" style-hover="background:#d9a94f;">Save &amp; Clear</button>',
    '<button sc-camel-on-click="{{ importJSONPrompt }}" style="flex-shrink:0;white-space:nowrap;padding:7px 12px;border:1px solid #3a5a82;background:transparent;color:#fff;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;" style-hover="background:#1a3f6e;">Import JSON</button>\n    <button sc-camel-on-click="{{ saveAll }}" style="flex-shrink:0;white-space:nowrap;padding:7px 14px;border:none;background:#c8963e;color:#10233a;border-radius:6px;font-size:12px;font-weight:800;cursor:pointer;" style-hover="background:#d9a94f;">Save &amp; Clear</button>'
  );

  fs.writeFileSync(path.join(OUT_DIR, "index.html"), template);

  fs.copyFileSync(
    path.join(__dirname, "static", "capacitor-shim.js"),
    path.join(OUT_DIR, "assets", "capacitor-shim.js")
  );

  console.log(`Extracted ${Object.keys(nameMap).length} assets to ${OUT_DIR}`);
}

main();
