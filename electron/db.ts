import { app, dialog, BrowserWindow } from "electron";
import fs from "fs/promises";
import path from "path";

// One saved period = one JSON file, named by key ("<year>-<month>"), holding
// { key, label, year, month, savedAt, data }. Mirrors the record shape
// scripts/static/db-bridge.js uses for Android/browser, so backup files
// exported from one platform can be restored on another.
const DB_DIR = path.join(app.getPath("userData"), "journal-db");

interface Record_ {
  key: string;
  label: string;
  year: number;
  month: number;
  savedAt: string;
  data: unknown;
}

async function ensureDir(): Promise<void> {
  await fs.mkdir(DB_DIR, { recursive: true });
}

function fileFor(key: string): string {
  return path.join(DB_DIR, `${key}.json`);
}

async function readRecord(key: string): Promise<Record_ | null> {
  try {
    const raw = await fs.readFile(fileFor(key), "utf8");
    return JSON.parse(raw) as Record_;
  } catch {
    return null;
  }
}

async function writeRecord(record: Record_): Promise<void> {
  await ensureDir();
  await fs.writeFile(fileFor(record.key), JSON.stringify(record), "utf8");
}

export async function list(): Promise<Omit<Record_, "data">[]> {
  await ensureDir();
  const files = await fs.readdir(DB_DIR);
  const records: Omit<Record_, "data">[] = [];
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const record = await readRecord(file.replace(/\.json$/, ""));
    if (record) records.push({ key: record.key, label: record.label, year: record.year, month: record.month, savedAt: record.savedAt });
  }
  records.sort((a, b) => b.year - a.year || b.month - a.month);
  return records;
}

export async function load(key: string): Promise<unknown | null> {
  const record = await readRecord(key);
  return record ? record.data : null;
}

export async function save(key: string, label: string, year: number, month: number, data: unknown): Promise<void> {
  await writeRecord({ key, label, year, month, savedAt: new Date().toISOString(), data });
}

export async function remove(key: string): Promise<void> {
  try {
    await fs.unlink(fileFor(key));
  } catch {
    // already gone — fine
  }
}

function backupFilename(name: string): string {
  const trimmed = name.trim();
  const base = trimmed || `macro-journal-backup-${new Date().toISOString().slice(0, 10)}`;
  return base.toLowerCase().endsWith(".json") ? base : `${base}.json`;
}

export async function backup(win: BrowserWindow, name: string): Promise<{ ok: boolean; count?: number }> {
  const items = await list();
  const records: Record_[] = [];
  for (const item of items) {
    const record = await readRecord(item.key);
    if (record) records.push(record);
  }
  const result = await dialog.showSaveDialog(win, {
    defaultPath: backupFilename(name),
    filters: [{ name: "Journal backup", extensions: ["json"] }],
  });
  if (result.canceled || !result.filePath) return { ok: false };
  await fs.writeFile(result.filePath, JSON.stringify({ version: 1, records }, null, 2), "utf8");
  return { ok: true, count: records.length };
}

function isPlausibleRecord(r: unknown): r is Record_ {
  return (
    !!r &&
    typeof r === "object" &&
    typeof (r as Record_).year === "number" &&
    typeof (r as Record_).month === "number" &&
    (r as Record_).month >= 1 &&
    (r as Record_).month <= 12
  );
}

export async function restore(win: BrowserWindow): Promise<{ ok: boolean; count?: number }> {
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "Journal backup", extensions: ["json"] }],
  });
  if (result.canceled || result.filePaths.length === 0) return { ok: false };

  let parsed: { records?: unknown };
  try {
    const raw = await fs.readFile(result.filePaths[0], "utf8");
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false };
  }
  if (!Array.isArray(parsed.records)) return { ok: false };

  // Regenerate `key` from year/month rather than trusting whatever the
  // backup file says — guarantees every restored record is internally
  // consistent (loadPeriod() always looks records up by a freshly
  // computed key, never by the stored `key` field, so a mismatch here
  // would otherwise make a record show up in the Open list but silently
  // fail to load). Also tolerate a partially-corrupt backup: skip
  // individual bad/unwritable records instead of aborting the whole
  // restore and losing every record that WOULD have imported fine.
  let count = 0;
  for (const record of parsed.records) {
    if (!isPlausibleRecord(record)) continue;
    const key = `${record.year}-${String(record.month).padStart(2, "0")}`;
    try {
      await writeRecord({
        key,
        label: record.label || key,
        year: record.year,
        month: record.month,
        savedAt: record.savedAt || new Date().toISOString(),
        data: record.data,
      });
      count++;
    } catch {
      // this one record failed to write — keep going with the rest
    }
  }
  return { ok: true, count };
}
