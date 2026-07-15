// Cross-platform "database" bridge: one saved period = one record keyed by
// "<year>-<month>", named with a human label like "July 2020". Exposes a
// single async API, window.journalDB = { list, load, save, remove, backup,
// restore }, that the app's own inline script (data-dc-script below) calls
// without caring which platform it's running on.
//
// On Electron, electron/preload.ts already defines window.journalDB (backed
// by real files in the OS user-data directory, with native save/open dialogs
// for backup/restore) before this script runs, so this file is a no-op there.
// On Android it's backed by Capacitor's Filesystem plugin. Everywhere else
// (a plain browser — used for local dev/testing) it falls back to
// localStorage, mirroring the same one-record-per-period model with an index
// of known keys so list() has something to enumerate.
(function () {
  "use strict";
  if (window.journalDB) return;

  function backupFilename() {
    return "macro-journal-backup-" + new Date().toISOString().slice(0, 10) + ".json";
  }

  function promptForFile(onText) {
    return new Promise(function (resolve) {
      var input = document.createElement("input");
      input.type = "file";
      input.accept = "application/json";
      input.onchange = function () {
        var file = input.files[0];
        if (!file) { resolve({ ok: false }); return; }
        var reader = new FileReader();
        reader.onload = function () {
          try {
            resolve(onText(String(reader.result)));
          } catch (e) {
            resolve({ ok: false });
          }
        };
        reader.onerror = function () { resolve({ ok: false }); };
        reader.readAsText(file);
      };
      input.click();
    });
  }

  // Guard on the actual plugin objects, not just isNativePlatform(): if this
  // script runs before Capacitor finishes registering plugins,
  // window.Capacitor exists but .Plugins.Filesystem/.Share could still be
  // undefined, and accessing them unguarded would throw here at load time —
  // leaving window.journalDB undefined and every save/load/backup/restore
  // broken for the rest of the session. Falling through to the
  // localStorage-backed branch below is a safe degradation instead.
  if (
    window.Capacitor &&
    window.Capacitor.isNativePlatform &&
    window.Capacitor.isNativePlatform() &&
    window.Capacitor.Plugins &&
    window.Capacitor.Plugins.Filesystem &&
    window.Capacitor.Plugins.Share
  ) {
    var Filesystem = window.Capacitor.Plugins.Filesystem;
    var Share = window.Capacitor.Plugins.Share;
    var DIR = "journal-db";

    function fileNameFor(key) { return DIR + "/" + key + ".json"; }

    async function ensureDir() {
      try {
        await Filesystem.mkdir({ path: DIR, directory: "DATA", recursive: true });
      } catch (e) {
        // already exists — fine
      }
    }

    async function readRecord(key) {
      try {
        var r = await Filesystem.readFile({ path: fileNameFor(key), directory: "DATA", encoding: "utf8" });
        return JSON.parse(r.data);
      } catch (e) {
        return null;
      }
    }

    async function writeRecord(record) {
      await ensureDir();
      await Filesystem.writeFile({
        path: fileNameFor(record.key),
        directory: "DATA",
        data: JSON.stringify(record),
        encoding: "utf8",
      });
    }

    async function list() {
      await ensureDir();
      var res;
      try {
        res = await Filesystem.readdir({ path: DIR, directory: "DATA" });
      } catch (e) {
        return [];
      }
      var items = [];
      for (var i = 0; i < res.files.length; i++) {
        var entry = res.files[i];
        var name = typeof entry === "string" ? entry : entry.name;
        if (!name || name.indexOf(".json") === -1) continue;
        var key = name.replace(/\.json$/, "");
        var record = await readRecord(key);
        if (record) items.push({ key: record.key, label: record.label, year: record.year, month: record.month, savedAt: record.savedAt });
      }
      items.sort(function (a, b) { return b.year - a.year || b.month - a.month; });
      return items;
    }

    async function load(key) {
      var record = await readRecord(key);
      return record ? record.data : null;
    }

    async function save(key, label, year, month, data) {
      await writeRecord({ key: key, label: label, year: year, month: month, savedAt: new Date().toISOString(), data: data });
    }

    async function remove(key) {
      try {
        await Filesystem.deleteFile({ path: fileNameFor(key), directory: "DATA" });
      } catch (e) {
        // already gone — fine
      }
    }

    async function backup() {
      var items = await list();
      var records = [];
      for (var i = 0; i < items.length; i++) {
        var record = await readRecord(items[i].key);
        if (record) records.push(record);
      }
      var content = JSON.stringify({ version: 1, records: records }, null, 2);
      var filename = backupFilename();
      var written = await Filesystem.writeFile({ path: filename, data: content, directory: "CACHE" });
      await Share.share({ title: filename, url: written.uri });
      return { ok: true, count: records.length };
    }

    async function restore() {
      return promptForFile(async function (text) {
        var parsed = JSON.parse(text);
        var records = parsed.records || [];
        for (var i = 0; i < records.length; i++) await writeRecord(records[i]);
        return { ok: true, count: records.length };
      });
    }

    window.journalDB = { list: list, load: load, save: save, remove: remove, backup: backup, restore: restore };
    return;
  }

  // Plain-browser fallback.
  var INDEX_KEY = "journal-db-index";
  var PREFIX = "journal-db:";

  function readIndex() {
    try { return JSON.parse(localStorage.getItem(INDEX_KEY) || "[]"); } catch (e) { return []; }
  }
  function writeIndex(idx) { localStorage.setItem(INDEX_KEY, JSON.stringify(idx)); }
  function readRecordLS(key) {
    try {
      var raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }
  function writeRecordLS(record) {
    localStorage.setItem(PREFIX + record.key, JSON.stringify(record));
    var idx = readIndex();
    if (idx.indexOf(record.key) === -1) { idx.push(record.key); writeIndex(idx); }
  }

  async function listLS() {
    return readIndex()
      .map(readRecordLS)
      .filter(Boolean)
      .map(function (r) { return { key: r.key, label: r.label, year: r.year, month: r.month, savedAt: r.savedAt }; })
      .sort(function (a, b) { return b.year - a.year || b.month - a.month; });
  }

  async function loadLS(key) {
    var record = readRecordLS(key);
    return record ? record.data : null;
  }

  async function saveLS(key, label, year, month, data) {
    writeRecordLS({ key: key, label: label, year: year, month: month, savedAt: new Date().toISOString(), data: data });
  }

  async function removeLS(key) {
    localStorage.removeItem(PREFIX + key);
    writeIndex(readIndex().filter(function (k) { return k !== key; }));
  }

  async function backupLS() {
    var items = await listLS();
    var records = items.map(function (it) { return readRecordLS(it.key); }).filter(Boolean);
    var content = JSON.stringify({ version: 1, records: records }, null, 2);
    var blob = new Blob([content], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = backupFilename();
    a.click();
    URL.revokeObjectURL(url);
    return { ok: true, count: records.length };
  }

  async function restoreLS() {
    return promptForFile(function (text) {
      var parsed = JSON.parse(text);
      var records = parsed.records || [];
      records.forEach(writeRecordLS);
      return { ok: true, count: records.length };
    });
  }

  window.journalDB = { list: listLS, load: loadLS, save: saveLS, remove: removeLS, backup: backupLS, restore: restoreLS };
})();
