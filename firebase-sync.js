(function () {
  const query = new URLSearchParams(window.location.search);
  const requestedRoom = query.get("room");
  const requestedMode = query.get("sync");
  const shouldUseFirebase = Boolean(requestedRoom) || requestedMode === "firebase";
  // 只有 room 模式才下載 SDK；單機離線時不必等 gstatic 連線逾時。
  const FIREBASE_SDK_URLS = [
    "https://www.gstatic.com/firebasejs/12.13.0/firebase-app-compat.js",
    "https://www.gstatic.com/firebasejs/12.13.0/firebase-database-compat.js"
  ];

  if (shouldUseFirebase) {
    loadFirebaseSdk()
      .then(() => startFirebaseSync(requestedRoom || "default"))
      .catch((error) => {
        console.error("[MapFog Firebase]", error);
      });
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = src;
      script.onload = resolve;
      script.onerror = () => reject(new Error(`Failed to load ${src}`));
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
    const roomId = sanitizeRoomId(rawRoomId);
    const clientId = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    let eventSequence = 0;
    // 擦霧、迷霧指令、擲骰各自只保留最近幾筆；迷霧的持久保存靠 fogHistory，不靠這些事件。
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

    function listen(path, callback) {
      const reference = roomPath(path);
      reference.on(
        "value",
        (snapshot) => {
          const value = snapshot.val();
          if (!value || value.sourceClientId === clientId) return;
          callback(value);
        },
        (error) => {
          console.error("[MapFog Firebase]", error);
        }
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

    function logError(error) {
      console.error("[MapFog Firebase]", error);
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
        if (!token.id || !token.imageDataUrl) {
          handlers.onGhost?.(snapshot.key);
          return;
        }
        if (!previous?.id || !previous.imageDataUrl) {
          handlers.onAdd?.(token, meta);
          return;
        }

        const changes = {};
        for (const [key, value] of Object.entries(token)) {
          if (value !== previous[key]) changes[key] = value;
        }
        if (Object.keys(changes).length) handlers.onPatch?.(token.id, changes, meta);
      }

      const onError = (error) => console.error("[MapFog Firebase]", error);
      reference.on("child_added", handleNode, onError);
      reference.on("child_changed", handleNode, onError);
      reference.on("child_removed", (snapshot) => {
        const node = snapshot.val() || {};
        lastNodes.delete(snapshot.key);
        if (node.id && node.imageDataUrl) handlers.onRemove?.(node.id);
      }, onError);
      return function unsubscribe() {
        reference.off();
      };
    }

    function normalizeFogHistory(value = {}) {
      const batches = value.batches && typeof value.batches === "object"
        ? Object.entries(value.batches)
            .map(([id, batch]) => ({ id, ...stripMeta(batch || {}) }))
            .filter((batch) => Array.isArray(batch.strokes))
            .sort((a, b) => {
              const timeA = Number(a.createdAt || 0);
              const timeB = Number(b.createdAt || 0);
              if (timeA !== timeB) return timeA - timeB;
              return String(a.id).localeCompare(String(b.id));
            })
        : [];

      return {
        base: value.base === "revealed" || value.base === "checkpoint" ? value.base : "covered",
        checkpoint: value.checkpoint && typeof value.checkpoint === "object" ? value.checkpoint : null,
        batches
      };
    }

    const api = {
      mode: "firebase",
      roomId,
      clientId,
      saveSnapshot(snapshot) {
        return roomPath("snapshot").set(withMeta(snapshot));
      },
      onSnapshot(callback) {
        return listen("snapshot", (value) => callback(stripMeta(value)));
      },
      saveMapState(mapState) {
        return roomPath("map").set(withMeta(mapState));
      },
      onMapState(callback) {
        return listen("map", (value) => callback(stripMeta(value)));
      },
      clearRoomState() {
        return roomPath("").update({
          snapshot: null,
          map: null,
          fog: null,
          fogHistory: null,
          gridSettings: null,
          initiative: null,
          token: null,
          events: null
        });
      },
      saveFogState(fogState) {
        return roomPath("fog").set(withMeta(fogState));
      },
      onFogState(callback) {
        return listen("fog", (value) => callback(stripMeta(value)));
      },
      sendDrawBatch(strokes) {
        return sendEvent("events/drawBatch", { strokes });
      },
      onDrawBatch(callback) {
        return listenEvent("events/drawBatch", (value) => callback(Array.isArray(value.strokes) ? value.strokes : []));
      },
      appendFogHistoryBatch(strokes) {
        if (!Array.isArray(strokes) || !strokes.length) return Promise.resolve();
        return roomPath("fogHistory/batches").push(withMeta({
          strokes,
          createdAt: firebase.database.ServerValue.TIMESTAMP
        }));
      },
      setFogHistoryBase(base) {
        return roomPath("fogHistory").set(withMeta({
          base: base === "revealed" ? "revealed" : "covered",
          batches: null
        }));
      },
      compactFogHistory(checkpoint) {
        return roomPath("fogHistory").set(withMeta({
          base: "checkpoint",
          checkpoint,
          batches: null
        }));
      },
      loadFogHistory() {
        return roomPath("fogHistory").once("value").then((snapshot) => normalizeFogHistory(snapshot.val() || {}));
      },
      sendFogCommand(command) {
        return sendEvent("events/fogCommand", { command });
      },
      onFogCommand(callback) {
        return listenEvent("events/fogCommand", (value) => {
          if (value.command) callback(value.command);
        });
      },
      sendGridSettings(gridSettings) {
        return roomPath("gridSettings").set(withMeta(gridSettings));
      },
      onGridSettings(callback) {
        return listen("gridSettings", (value) => callback(stripMeta(value)));
      },
      // 新增 token 才寫入完整節點（含圖片）；之後的修改只 update 有變的欄位。
      addToken(token, sourceRole) {
        if (!token?.id) return Promise.resolve();
        return tokenRef(token.id).set({ ...token, ...tokenMeta(sourceRole) });
      },
      updateToken(tokenId, changes, sourceRole) {
        const updates = {};
        for (const [key, value] of Object.entries(changes || {})) {
          if (key === "id" || key === "imageDataUrl" || value === undefined) continue;
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

    window.MapFogFirebaseSync = api;
    console.info("[MapFog Firebase] connected", { roomId, clientId });
    window.dispatchEvent(new CustomEvent("mapfog:firebase-ready", { detail: api }));
  }

  function sanitizeRoomId(value) {
    return String(value || "default").replace(/[.#$/[\]]/g, "-").slice(0, 80) || "default";
  }
})();
