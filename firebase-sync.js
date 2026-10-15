(function () {
  const query = new URLSearchParams(window.location.search);
  const requestedRoom = query.get("room");
  const requestedMode = query.get("sync");
  const shouldUseFirebase = Boolean(requestedRoom) || requestedMode === "firebase";

  if (shouldUseFirebase) {
    startFirebaseSync(requestedRoom || "default").catch((error) => {
      console.error("[MapFog Firebase]", error);
    });
  }

  async function startFirebaseSync(rawRoomId) {
    if (!window.firebase || !window.firebase.database) {
      throw new Error("Firebase compat SDK is not loaded. Check firebase-app-compat.js and firebase-database-compat.js script tags.");
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

    function listenEvent(path, callback) {
      const reference = roomPath(path);
      const attachedAt = Date.now();
      let lastEventId = null;
      reference.on(
        "value",
        (snapshot) => {
          const value = snapshot.val();
          if (!value || value.sourceClientId === clientId) return;

          const updatedAt = Number(value.updatedAt || 0);
          if (updatedAt && updatedAt < attachedAt - 1000) return;

          const eventId = value.id || `${value.sourceClientId || "unknown"}:${value.updatedAt || ""}:${value.sequence || ""}`;
          if (eventId && eventId === lastEventId) return;
          lastEventId = eventId;

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

    function tokenKey(tokenId) {
      return String(tokenId || "").replace(/[.#$/[\]]/g, "-");
    }

    function toFirebaseTokenState(tokenState = {}) {
      const tokens = Array.isArray(tokenState.tokens) ? tokenState.tokens : [];
      const tokensById = {};
      const tokenOrder = [];

      for (const token of tokens) {
        if (!token?.id) continue;
        tokensById[tokenKey(token.id)] = token;
        tokenOrder.push(token.id);
      }

      return {
        selectedTokenId: tokenState.selectedTokenId || null,
        tokenOrder,
        tokensById
      };
    }

    function fromFirebaseTokenState(value = {}) {
      if (Array.isArray(value.tokens)) return value;
      if (!value.tokensById || typeof value.tokensById !== "object") return value;

      const byOriginalId = new Map();
      for (const token of Object.values(value.tokensById)) {
        if (token?.id) byOriginalId.set(token.id, token);
      }

      const tokenOrder = Array.isArray(value.tokenOrder) ? value.tokenOrder : [];
      const orderedTokens = tokenOrder.map((id) => byOriginalId.get(id)).filter(Boolean);
      const orderedIds = new Set(orderedTokens.map((token) => token.id));
      const rest = Object.values(value.tokensById).filter((token) => token?.id && !orderedIds.has(token.id));

      return {
        selectedTokenId: value.selectedTokenId || null,
        tokens: [...orderedTokens, ...rest]
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
        return roomPath("events/drawBatch").set(makeEventPayload({
          strokes
        }));
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
        return roomPath("events/fogCommand").set(makeEventPayload({
          command
        }));
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
      sendTokenState(tokenState, includeImage = true, changedTokenId = null) {
        if (includeImage || !changedTokenId || !Array.isArray(tokenState.tokens)) {
          return roomPath("token").set(withMeta(toFirebaseTokenState(tokenState)));
        }
        const changed = tokenState.tokens.find((token) => token.id === changedTokenId);
        if (!changed) return roomPath("token").set(withMeta(toFirebaseTokenState(tokenState)));
        const updates = {
          selectedTokenId: tokenState.selectedTokenId || null,
          tokenOrder: tokenState.tokens.map((token) => token.id).filter(Boolean),
          sourceClientId: clientId,
          updatedAt: firebase.database.ServerValue.TIMESTAMP
        };
        for (const [key, value] of Object.entries(changed)) updates[`tokensById/${tokenKey(changed.id)}/${key}`] = value;
        return roomPath("token").update(updates);
      },
      clearToken() {
        return roomPath("token").remove();
      },
      onTokenState(callback) {
        return listen("token", (value) => callback(fromFirebaseTokenState(stripMeta(value))));
      },
      sendInitiativeState(initiativeState) {
        return roomPath("initiative").set(withMeta(initiativeState || { entries: [] }));
      },
      onInitiativeState(callback) {
        return listen("initiative", (value) => callback(stripMeta(value)));
      },
      sendDiceRoll(roll) {
        return roomPath("events/diceRoll").set(makeEventPayload(roll || {}));
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
