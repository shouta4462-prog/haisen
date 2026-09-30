// IndexedDB による端末内保存(オフライン・オフライン優先のローカルストレージ層)
// クラウド未設定でもこれだけでアプリは完全に動作する。

const DB_NAME = "hairnesu-db";
const DB_VERSION = 1;
const STORE_SHEETS = "sheets";
const STORE_ROWS = "rows";

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_SHEETS)) {
        db.createObjectStore(STORE_SHEETS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_ROWS)) {
        const rowsStore = db.createObjectStore(STORE_ROWS, { keyPath: "id" });
        rowsStore.createIndex("sheetId", "sheetId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDb().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
}

export const db = {
  async getAllSheets() {
    const store = await tx(STORE_SHEETS, "readonly");
    const all = await reqToPromise(store.getAll());
    return all.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  },
  async putSheet(sheet) {
    const store = await tx(STORE_SHEETS, "readwrite");
    await reqToPromise(store.put(sheet));
    return sheet;
  },
  async deleteSheet(id) {
    const store = await tx(STORE_SHEETS, "readwrite");
    await reqToPromise(store.delete(id));
  },
  async getRowsBySheet(sheetId) {
    const store = await tx(STORE_ROWS, "readonly");
    const idx = store.index("sheetId");
    const all = await reqToPromise(idx.getAll(IDBKeyRange.only(sheetId)));
    return all.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  },
  async putRow(row) {
    const store = await tx(STORE_ROWS, "readwrite");
    await reqToPromise(store.put(row));
    return row;
  },
  async putRows(rows) {
    const store = await tx(STORE_ROWS, "readwrite");
    await Promise.all(rows.map((r) => reqToPromise(store.put(r))));
  },
  async deleteRow(id) {
    const store = await tx(STORE_ROWS, "readwrite");
    await reqToPromise(store.delete(id));
  },
  async deleteRowsBySheet(sheetId) {
    const rows = await this.getRowsBySheet(sheetId);
    const store = await tx(STORE_ROWS, "readwrite");
    await Promise.all(rows.map((r) => reqToPromise(store.delete(r.id))));
  },
};
