// 本機大型暫存（地圖、迷霧、token 圖片）改存 IndexedDB，避免 localStorage 約 5MB 的上限。
// 小型設定（格線、視角、先攻等）仍留在 localStorage。
(function () {
  const DB_NAME = "mapfog-local";
  const DB_VERSION = 1;
  const STORE_NAME = "kv";
  let dbPromise = null;
  let writeErrorReported = false;

  function openDb() {
    if (dbPromise) return dbPromise;

    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) {
        reject(new Error("IndexedDB is not available"));
        return;
      }

      const request = window.indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("IndexedDB open is blocked"));
    });

    return dbPromise;
  }

  function runStore(mode, run) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const result = run(transaction.objectStore(STORE_NAME));
      transaction.oncomplete = () => resolve(result?.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    }));
  }

  function prefixRange(prefix) {
    return IDBKeyRange.bound(prefix, `${prefix}￿`);
  }

  function readLegacy(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function removeLegacy(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Legacy cleanup is best-effort.
    }
  }

  function reportWriteError(error) {
    console.error("[MapFog local store]", error);
    if (writeErrorReported) return;
    writeErrorReported = true;
    window.alert("本機暫存寫入失敗，重新整理後可能會遺失地圖、迷霧或 token。\n\n請確認瀏覽器沒有封鎖網站資料，或磁碟空間足夠。");
  }

  async function get(key) {
    try {
      const value = await runStore("readonly", (store) => store.get(key));
      if (value !== undefined) return value;
    } catch (error) {
      console.error("[MapFog local store]", error);
      return readLegacy(key);
    }

    // 舊版資料在 localStorage：搬進 IndexedDB 後刪掉，釋放 localStorage 空間。
    const legacyValue = readLegacy(key);
    if (legacyValue !== null && await set(key, legacyValue)) removeLegacy(key);
    return legacyValue;
  }

  async function set(key, value) {
    try {
      await runStore("readwrite", (store) => store.put(value, key));
      return true;
    } catch (error) {
      reportWriteError(error);
      return false;
    }
  }

  async function remove(key) {
    removeLegacy(key);
    try {
      await runStore("readwrite", (store) => store.delete(key));
    } catch (error) {
      console.error("[MapFog local store]", error);
    }
  }

  async function removeByPrefix(prefix) {
    try {
      const keys = await runStore("readonly", (store) => store.getAllKeys(prefixRange(prefix)));
      if (!keys?.length) return 0;
      await runStore("readwrite", (store) => store.delete(prefixRange(prefix)));
      return keys.length;
    } catch (error) {
      console.error("[MapFog local store]", error);
      return 0;
    }
  }

  window.MapFogLocalStore = { get, set, remove, removeByPrefix };
})();
