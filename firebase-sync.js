(function () {
  const query = new URLSearchParams(window.location.search);
  const requestedRoom = query.get("room");
  // 由 sync-mode.js 判斷：只有 room 模式才用 Firebase；lanroom、olroom 或參數衝突時完全不載入 SDK。
  const shouldUseFirebase = window.MapFogSyncMode?.mode === "firebase";
  // 只有 room 模式才下載 SDK；單機離線時不必等 gstatic 連線逾時。
  const FIREBASE_SDK_URLS = [
    "https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/12.13.0/firebase-database-compat.js"
  ];

  // 連不上 gstatic（例如離線開啟）時每 10 秒重試一次，網路恢復時立刻重試；畫面先顯示本機暫存。
  const SDK_RETRY_MS = 10000;
  const loadedScripts = new Set();
  let sdkRetryTimer = null;

  if (shouldUseFirebase) {
    startWithRetry();
    window.addEventListener("online", () => {
      if (sdkRetryTimer !== null) startWithRetry();
    });
  }

  function startWithRetry() {
    window.clearTimeout(sdkRetryTimer);
    sdkRetryTimer = null;
    loadFirebaseSdk()
      .then(() => startFirebaseSync(requestedRoom || "default"))
      .catch((error) => {
        console.error("[MapFog Firebase]", error);
        window.dispatchEvent(new CustomEvent("mapfog:firebase-error", { detail: { message: String(error?.message || error) } }));
        sdkRetryTimer = window.setTimeout(startWithRetry, SDK_RETRY_MS);
      });
  }

  function loadScript(src) {
    if (loadedScripts.has(src)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = () => {
        loadedScripts.add(src);
        resolve();
      };
      script.onerror = () => {
        // 移除失敗的 script，重試時才會重新下載。
        script.remove();
        reject(new Error(`Failed to load ${src}`));
      };
      document.head.appendChild(script);
    });
  }

  async function loadFirebaseSdk() {
    // database-compat 依賴 app-compat，必須依序載入。
    for (const src of FIREBASE_SDK_URLS) await loadScript(src);
  }

  async function startFirebaseSync(rawRoomId) {
    if (!window.firebase || !window.firebase.database) {
      throw new Error("Firebase compat SDK is not loaded. Check the network connection to www.gstatic.com.");
    }

    const firebaseConfig = {
      apiKey: "AIzaSyCzWs_yeXLLDyXDpbOl4-Pt68AJTLFk9Z8",
      authDomain: "mapfog.firebaseapp.com",
      databaseURL: "https://mapfog-default-rtdb.asia-southeast1.firebasedatabase.app",
      projectId: "mapfog",
      storageBucket: "mapfog.firebasestorage.app",
      messagingSenderId: "95534280582",
      appId: "1:95534280582:web:26b1168e7d009dbe4a8607"
    };

    const app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
    const database = app.database();
    let serverTimeOffset = 0;
    database.ref(".info/serverTimeOffset").on("value", (snapshot) => {
      serverTimeOffset = Number(snapshot.val()) || 0;
    });
    const roomId = sanitizeRoomId(rawRoomId);
    const clientId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let eventSequence = 0;
    // 擲骰事件只保留最近幾筆；迷霧改存在 fog／fogBatches，不走事件清單。
    const EVENT_KEEP_LIMIT = 100;

    function roomPath(path) {
      return database.ref(`rooms/${roomId}/${path}`);
    }

    function withMeta(payload = {}) {
      return {
        ...payload,
        sourceClientId: clientId,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };
    }

    // includeEmpty：節點不存在（例如房間被清除）時也通知，callback 會收到 null。
    function listen(path, callback, options = {}) {
      const reference = roomPath(path);
      reference.on(
        "value",
        (snapshot) => {
          const value = snapshot.val();
          if (!value) {
            if (options.includeEmpty) callback(null);
            return;
          }
          if (value.sourceClientId === clientId) return;
          callback(value);
        },
        logError
      );
      return function unsubscribe() {
        reference.off("value");
      };
    }

    function stripMeta(value = {}) {
      const { sourceClientId, updatedAt, ...data } = value;
      return data;
    }

    function makeEventPayload(payload = {}) {
      eventSequence += 1;
      return withMeta({
        ...payload,
        id: payload.id || ((crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`),
        sequence: eventSequence
      });
    }

    let deniedReported = false;

    // 房間被資料庫規則拒絕（多半是房間名稱不符合規則）時通知畫面，右下角會顯示原因。
    function logError(error) {
      console.error("[MapFog Firebase]", error);
      const text = `${error?.code || ""} ${error?.message || error || ""}`;
      if (deniedReported || !/permission[_ ]denied/i.test(text)) return;
      deniedReported = true;
      window.dispatchEvent(new CustomEvent("mapfog:firebase-denied", { detail: { roomId } }));
    }

    // 每種事件清單各自記住看過的 key（由舊到新），寫入端靠它刪除超過上限的舊事件。
    const eventKeysByPath = new Map();

    function getEventKeys(path) {
      if (!eventKeysByPath.has(path)) eventKeysByPath.set(path, { keys: [], seen: new Set(), trimming: false });
      return eventKeysByPath.get(path);
    }

    function trackEventKey(path, key) {
      const state = getEventKeys(path);
      if (!key || state.seen.has(key)) return;
      state.seen.add(key);
      state.keys.push(key);
      state.keys.sort();
    }

    function trimEventList(path) {
      const state = getEventKeys(path);
      if (state.trimming || state.keys.length <= EVENT_KEEP_LIMIT) return;

      const oldestKeptKey = state.keys[state.keys.length - EVENT_KEEP_LIMIT];
      state.keys = state.keys.slice(-EVENT_KEEP_LIMIT);
      state.seen = new Set(state.keys);
      state.trimming = true;
      // 只讀取比保留範圍更舊、準備刪掉的事件，不必下載整份清單。
      roomPath(path).orderByKey().endBefore(oldestKeptKey).once("value")
        .then((snapshot) => {
          const removals = {};
          snapshot.forEach((child) => {
            removals[child.key] = null;
          });
          if (Object.keys(removals).length) return roomPath(path).update(removals);
          return null;
        })
        .catch(logError)
        .finally(() => {
          state.trimming = false;
          // 刪除期間若又新增了事件，接著再整理一次。
          trimEventList(path);
        });
    }

    // 事件改成 push 到清單，快速連續寫入也不會只剩最後一筆。
    function sendEvent(path, payload) {
      const pushed = roomPath(path).push(makeEventPayload(payload));
      trackEventKey(path, pushed.key);
      pushed.catch(logError);
      trimEventList(path);
      return pushed;
    }

    function listenEvent(path, callback) {
      const reference = roomPath(path);
      let query = null;
      let active = true;

      // 只處理掛上監聽「之後」才新增的事件：先找出目前最後一筆的 key，再從它之後開始聽。
      // 不拿伺服器時間跟本機時鐘比，避免本機時鐘偏差時把剛發生的事件當成舊的丟掉。
      reference.orderByKey().limitToLast(1).once("value")
        .then((snapshot) => {
          if (!active) return;
          let lastKey = null;
          snapshot.forEach((child) => {
            lastKey = child.key;
          });
          query = lastKey ? reference.orderByKey().startAfter(lastKey) : reference.orderByKey();
          query.on("child_added", (child) => {
            trackEventKey(path, child.key);
            const value = child.val();
            if (!value || value.sourceClientId === clientId) return;
            callback(value);
          }, logError);
        })
        .catch(logError);

      return function unsubscribe() {
        active = false;
        query?.off("child_added");
      };
    }

    function fogBatchKey(seq) {
      return String(seq).padStart(8, "0");
    }

    function tokenKey(tokenId) {
      return String(tokenId || "").replace(/[.#$/[\]]/g, "-");
    }

    function tokenRef(tokenId) {
      return roomPath(`token/tokensById/${tokenKey(tokenId)}`);
    }

    // 每次寫入 token 都記下是誰改的，GM 端靠 sourceRole 判斷要不要接受。
    function tokenMeta(sourceRole) {
      return {
        sourceRole: sourceRole === "gm" ? "gm" : "player",
        sourceClientId: clientId,
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      };
    }

    function stripTokenMeta(node = {}) {
      const { sourceRole, sourceClientId, updatedAt, ...token } = node;
      return token;
    }

    function listenTokens(handlers = {}) {
      const reference = roomPath("token/tokensById");
      // 記住每顆 token 上一次收到的內容，才能算出這次到底改了哪些欄位。
      const lastNodes = new Map();

      function handleNode(snapshot) {
        const node = snapshot.val() || {};
        const previous = lastNodes.get(snapshot.key);
        lastNodes.set(snapshot.key, node);
        const meta = { sourceRole: node.sourceRole === "gm" ? "gm" : "player", sourceClientId: node.sourceClientId || "" };
        const token = stripTokenMeta(node);

        // 沒有圖片的節點是「別人剛刪掉、這邊又送了位置更新」留下的殘骸，不能當成 token。
        if (!token.id || !token.imageHash) {
          handlers.onGhost?.(snapshot.key);
          return;
        }
        if (!previous?.id || !previous.imageHash) {
          handlers.onAdd?.(token, meta);
          return;
        }

        const changes = {};
        for (const [key, value] of Object.entries(token)) {
          if (value !== previous[key]) changes[key] = value;
        }
        if (Object.keys(changes).length) handlers.onPatch?.(token.id, changes, meta);
      }

      const onError = logError;
      reference.on("child_added", handleNode, onError);
      reference.on("child_changed", handleNode, onError);
      reference.on("child_removed", (snapshot) => {
        const node = snapshot.val() || {};
        lastNodes.delete(snapshot.key);
        if (node.id && node.imageHash) handlers.onRemove?.(node.id);
      }, onError);
      // 第一次讀完時告訴畫面目前有哪些 token，讓畫面移除暫存裡已被刪掉的 token。
      reference.once("value")
        .then((snapshot) => handlers.onInitialSync?.(Object.values(snapshot.val() || {}).map((node) => node?.id).filter(Boolean)))
        .catch(onError);
      return function unsubscribe() {
        reference.off();
      };
    }

    const api = {
      mode: "firebase",
      roomId,
      clientId,
      // 換地圖時，地圖與新的迷霧版本一起寫入，並刪掉舊的擦霧紀錄。
      saveMapAndFog(mapState, fogState) {
        return roomPath("").update({ map: withMeta(mapState), fog: withMeta(fogState), fogBatches: null });
      },
      // 地圖節點只放 { hash, width, height }，圖片本身在 images/{hash}。
      onMapState(callback) {
        return listen("map", (value) => callback(value ? stripMeta(value) : null), { includeEmpty: true });
      },
      clearRoomState() {
        return roomPath("").update({
          snapshot: null,
          map: null,
          fog: null,
          fogBatches: null,
          fogHistory: null,
          gridSettings: null,
          initiative: null,
          token: null,
          events: null,
          images: null,
          imageIndex: null
        });
      },
      // 迷霧重設、全開或壓縮成 checkpoint：換新的 epoch，舊 epoch 的擦霧紀錄一併刪除。
      saveFogState(fogState) {
        return roomPath("").update({ fog: withMeta(fogState), fogBatches: null });
      },
      onFogState(callback) {
        return listen("fog", (value) => callback(value ? stripMeta(value) : null), { includeEmpty: true });
      },
      // 擦霧紀錄放在 fogBatches/{epoch}/{序號}；序號由 GM 依序編號，不依賴裝置時鐘。
      appendFogBatch(epoch, seq, strokes) {
        return roomPath(`fogBatches/${epoch}/${fogBatchKey(seq)}`).set(withMeta({ strokes }));
      },
      onFogBatches(epoch, afterSeq, callback) {
        let query = roomPath(`fogBatches/${epoch}`).orderByKey();
        if (afterSeq > 0) query = query.startAfter(fogBatchKey(afterSeq));
        query.on("child_added", (child) => {
          const value = child.val();
          if (!value || value.sourceClientId === clientId) return;
          callback(Number(child.key), Array.isArray(value.strokes) ? value.strokes : []);
        }, logError);
        return function unsubscribe() {
          query.off("child_added");
        };
      },
      sendGridSettings(gridSettings) {
        return roomPath("gridSettings").set(withMeta(gridSettings));
      },
      onGridSettings(callback) {
        return listen("gridSettings", (value) => callback(stripMeta(value)));
      },
      // 圖片存在 images/{雜湊}，只在本機沒有時用 once() 單獨下載；imageIndex 很小，GM 用它找出沒人用的圖片。
      putImage(hash, dataUrl, kind) {
        if (!hash || !dataUrl) return Promise.resolve();
        return roomPath("").update({
          [`images/${hash}`]: { dataUrl, kind },
          [`imageIndex/${hash}`]: { kind, bytes: dataUrl.length, addedAt: firebase.database.ServerValue.TIMESTAMP }
        });
      },
      onImageIndex(callback) {
        const reference = roomPath("imageIndex");
        reference.on("value", (snapshot) => callback(snapshot.val() || {}), logError);
        return function unsubscribe() {
          reference.off("value");
        };
      },
      deleteImages(hashes) {
        const updates = {};
        for (const hash of hashes) {
          updates[`images/${hash}`] = null;
          updates[`imageIndex/${hash}`] = null;
        }
        return Object.keys(updates).length ? roomPath("").update(updates) : Promise.resolve();
      },
      // 以伺服器時間計算，避免本機時鐘不準時誤判圖片上傳了多久。
      serverNow() {
        return Date.now() + serverTimeOffset;
      },
      getImage(hash) {
        return roomPath(`images/${hash}/dataUrl`).once("value").then((snapshot) => {
          const value = snapshot.val();
          return typeof value === "string" ? value : "";
        });
      },
      // 新增 token 才寫入完整節點（含圖片雜湊）；之後的修改只 update 有變的欄位。
      addToken(token, sourceRole) {
        if (!token?.id) return Promise.resolve();
        return tokenRef(token.id).set({ ...token, ...tokenMeta(sourceRole) });
      },
      updateToken(tokenId, changes, sourceRole) {
        const updates = {};
        for (const [key, value] of Object.entries(changes || {})) {
          if (key === "id" || key === "imageHash" || value === undefined) continue;
          updates[key] = value;
        }
        if (!tokenId || !Object.keys(updates).length) return Promise.resolve();
        return tokenRef(tokenId).update({ ...updates, ...tokenMeta(sourceRole) });
      },
      removeToken(tokenId) {
        if (!tokenId) return Promise.resolve();
        return tokenRef(tokenId).remove();
      },
      onTokenEvents(handlers) {
        return listenTokens(handlers);
      },
      sendInitiativeState(initiativeState) {
        return roomPath("initiative").set(withMeta(initiativeState || { entries: [] }));
      },
      onInitiativeState(callback) {
        return listen("initiative", (value) => callback(stripMeta(value)));
      },
      sendDiceRoll(roll) {
        return sendEvent("events/diceRoll", roll || {});
      },
      onDiceRoll(callback) {
        return listenEvent("events/diceRoll", (value) => callback(stripMeta(value)));
      }
    };

    // 連線狀態與在線名單：rooms/{room}/presence/{clientId}，斷線時由 Firebase 自動移除。
    const role = document.body.classList.contains("gm-page") ? "gm" : "player";
    const connectionState = { role, connected: false, everConnected: false, players: 0, gms: 0 };
    const presenceRef = roomPath(`presence/${clientId}`);

    function emitConnectionState() {
      window.dispatchEvent(new CustomEvent("mapfog:connection", { detail: { ...connectionState } }));
    }

    database.ref(".info/connected").on("value", (snapshot) => {
      connectionState.connected = snapshot.val() === true;
      if (connectionState.connected) {
        connectionState.everConnected = true;
        // 先登記「斷線時移除」，再寫入在線資料，避免斷線後留下殘留紀錄。
        presenceRef.onDisconnect().remove()
          .then(() => presenceRef.set({ role, connectedAt: firebase.database.ServerValue.TIMESTAMP }))
          .catch(logError);
      }
      emitConnectionState();
    });

    roomPath("presence").on("value", (snapshot) => {
      const entries = Object.values(snapshot.val() || {});
      connectionState.players = entries.filter((entry) => entry?.role === "player").length;
      connectionState.gms = entries.filter((entry) => entry?.role === "gm").length;
      emitConnectionState();
    }, logError);

    api.getConnectionState = () => ({ ...connectionState });

    window.MapFogFirebaseSync = api;
    // 各模組透過 MapFogSync／mapfog:sync-ready 取得同步服務，不必分辨是 Firebase 還是 LAN。
    window.MapFogSync = api;
    console.info("[MapFog Firebase] connected", { roomId, clientId });
    window.dispatchEvent(new CustomEvent("mapfog:firebase-ready", { detail: api }));
    window.dispatchEvent(new CustomEvent("mapfog:sync-ready", { detail: api }));
    emitConnectionState();
  }

  function sanitizeRoomId(value) {
    return String(value || "default").replace(/[.#$/[\]]/g, "-").slice(0, 80) || "default";
  }
})();
