// 圖片依內容雜湊存放：記憶體 → 本機 IndexedDB →（room 模式）Firebase／（lanroom 模式）LAN 伺服器。
// 同一個雜湊的圖片在一台裝置上只下載一次；GM 與玩家、olroom 與 room 共用同一套規則。
(function () {
  const IMAGE_KEY_PART = "img.";
  const SCENE_KEY_PART = "scene.";
  const ROOM_CACHE_PREFIX = "mapfog.room.";
  const ROOM_OPENED_AT_STORAGE_KEY = "mapfog.roomCacheOpenedAt.v1";
  // room 的資料 Firebase 上還有一份，太久沒開的本機暫存可以放心清掉；olroom 只存在本機，不自動清除。
  const ROOM_CACHE_MAX_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

  // 純 JavaScript 雜湊：http 區網網址沒有 crypto.subtle 也能用。兩組 53 位元結果合併，用來分辨圖片已足夠。
  function cyrb53(text, seed) {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let index = 0; index < text.length; index += 1) {
      const code = text.charCodeAt(index);
      h1 = Math.imul(h1 ^ code, 2654435761);
      h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }

  function hashDataUrl(dataUrl) {
    const text = String(dataUrl || "");
    return `${cyrb53(text, 1).toString(36).padStart(11, "0")}${cyrb53(text, 0x9e3779b1).toString(36).padStart(11, "0")}`;
  }

  function formatBytes(bytes) {
    return bytes >= 1000000 ? `${Number((bytes / 1000000).toFixed(2))}MB` : `${Number((bytes / 1000).toFixed(1))}KB`;
  }

  function isImageDataUrl(value) {
    return typeof value === "string" && value.startsWith("data:image/");
  }

  function create({ prefix, remote = false, remoteLabel = "Firebase" }) {
    const localStore = window.MapFogLocalStore;
    const imageKeyPrefix = `${prefix}${IMAGE_KEY_PART}`;
    const memory = new Map();
    const loading = new Map();
    let remoteFetcher = null;
    let remoteWaiters = [];

    function peek(hash) {
      return memory.get(hash) || "";
    }

    // 新圖片或收到的圖片：先放進記憶體讓畫面立刻能用，再寫入本機暫存。
    function remember(hash, dataUrl) {
      if (!hash || !isImageDataUrl(dataUrl) || memory.get(hash) === dataUrl) return;
      memory.set(hash, dataUrl);
      localStore?.set(`${imageKeyPrefix}${hash}`, { dataUrl, savedAt: Date.now() });
    }

    function rememberAll(images) {
      for (const [hash, dataUrl] of Object.entries(images || {})) remember(hash, dataUrl);
    }

    function collect(hashes) {
      const images = {};
      for (const hash of hashes) {
        const dataUrl = peek(hash);
        if (dataUrl) images[hash] = dataUrl;
      }
      return images;
    }

    async function getLocal(hash) {
      if (!hash) return "";
      if (memory.has(hash)) return memory.get(hash);
      const cached = await localStore?.get(`${imageKeyPrefix}${hash}`);
      if (!isImageDataUrl(cached?.dataUrl)) return "";
      memory.set(hash, cached.dataUrl);
      console.info(`[MapFog 圖片] ${hash} 從本機暫存載入（${formatBytes(cached.dataUrl.length)}），不需下載`);
      return cached.dataUrl;
    }

    async function load(hash) {
      const local = await getLocal(hash);
      if (local || !remote) return local;

      // 同步服務（Firebase 或 LAN 伺服器）還沒就緒（例如離線開啟）時先等待，連上後自動補抓。
      const fetcher = remoteFetcher || await new Promise((resolve) => remoteWaiters.push(resolve));
      const dataUrl = await fetcher(hash);
      if (!isImageDataUrl(dataUrl)) {
        console.warn(`[MapFog 圖片] ${hash} 在 ${remoteLabel} 上找不到`);
        return "";
      }
      console.info(`[MapFog 圖片] ${hash} 從 ${remoteLabel} 下載（${formatBytes(dataUrl.length)}）`);
      remember(hash, dataUrl);
      return dataUrl;
    }

    function get(hash) {
      if (!hash) return Promise.resolve("");
      if (memory.has(hash)) return Promise.resolve(memory.get(hash));
      if (!loading.has(hash)) {
        loading.set(hash, load(hash)
          .catch((error) => {
            console.error("[MapFog 圖片]", error);
            return "";
          })
          .finally(() => loading.delete(hash)));
      }
      return loading.get(hash);
    }

    function setRemoteFetcher(fetcher) {
      remoteFetcher = fetcher;
      const waiters = remoteWaiters;
      remoteWaiters = [];
      waiters.forEach((resolve) => resolve(fetcher));
    }

    // 刪掉這個房間本機已沒人用的圖片：GM 與玩家畫面各自的暫存畫面都沒用到，畫面上也沒在用。
    async function pruneLocal(inUseHashes = []) {
      if (!localStore?.keys) return;
      const keep = new Set(inUseHashes.filter(Boolean));
      const sceneKeys = await localStore.keys(`${prefix}${SCENE_KEY_PART}`);
      for (const key of sceneKeys) {
        const scene = await localStore.get(key);
        if (scene?.map?.hash) keep.add(scene.map.hash);
        for (const token of scene?.tokens || []) if (token?.imageHash) keep.add(token.imageHash);
      }

      const imageKeys = await localStore.keys(imageKeyPrefix);
      const removable = imageKeys.filter((key) => !keep.has(key.slice(imageKeyPrefix.length)));
      for (const key of removable) {
        memory.delete(key.slice(imageKeyPrefix.length));
        await localStore.remove(key);
      }
      if (removable.length) console.info(`[MapFog 圖片] 已清除本機 ${removable.length} 張沒在使用的圖片`);
    }

    return { hash: hashDataUrl, peek, remember, rememberAll, collect, get, getLocal, setRemoteFetcher, pruneLocal };
  }

  function readOpenedAt() {
    try {
      return JSON.parse(window.localStorage.getItem(ROOM_OPENED_AT_STORAGE_KEY) || "{}") || {};
    } catch {
      return {};
    }
  }

  // 記下這個 room 的開啟時間，並清掉 30 天沒開過的其他 room 本機暫存。
  async function cleanIdleRoomCaches(currentPrefix) {
    const openedAt = readOpenedAt();
    const now = Date.now();
    if (currentPrefix.startsWith(ROOM_CACHE_PREFIX)) openedAt[currentPrefix] = now;

    for (const [prefix, time] of Object.entries(openedAt)) {
      if (prefix === currentPrefix || now - Number(time || 0) < ROOM_CACHE_MAX_IDLE_MS) continue;
      delete openedAt[prefix];
      await window.MapFogLocalStore?.removeByPrefix(prefix);
      console.info(`[MapFog 暫存] 已清除超過 30 天沒開啟的 room 暫存：${prefix}`);
    }

    try {
      window.localStorage.setItem(ROOM_OPENED_AT_STORAGE_KEY, JSON.stringify(openedAt));
    } catch {
      // 記錄失敗只會讓清理晚一點發生。
    }
  }

  window.MapFogImageStore = { create, hash: hashDataUrl, cleanIdleRoomCaches };
})();
