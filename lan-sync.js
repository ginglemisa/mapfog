// LAN 模式（?lanroom=）的同步服務：連到同一台 MapFog LAN 伺服器的 WebSocket，API 與 firebase-sync.js 相同。
// 不載入任何外部程式，也不需要網際網路；房間狀態以 LAN 伺服器為準。
(function () {
  "use strict";
  const syncMode = window.MapFogSyncMode;
  if (!syncMode || syncMode.mode !== "lan") return;

  const PROTOCOL_VERSION = 1;
  const ROLE = document.body.classList.contains("gm-page") ? "gm" : "player";
  const ADMIN_KEY_STORAGE_KEY = "mapfog.lan.adminKey.v1";
  const RECONNECT_MIN_MS = 500;
  const RECONNECT_MAX_MS = 15000;
  const CONNECT_TIMEOUT_MS = 8000;
  const HEARTBEAT_INTERVAL_MS = 8000;
  const HEARTBEAT_TIMEOUT_MS = 6000;
  // 這些錯誤代表資料本身不被接受，回報給呼叫端；其餘（衝突、已刪除、權限）由伺服器送回正確狀態，不必另外處理。
  const HARD_ERROR_CODES = new Set(["too-large", "bad-request", "server-error", "not-connected"]);
  // 斷線期間還沒送出的修改存在這台裝置（IndexedDB），重新整理或關掉分頁後再開也會補送。
  const PENDING_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const PENDING_SAVE_DELAY_MS = 300;
  const roomId = syncMode.roomId;
  const PENDING_STORAGE_KEY = `mapfog.lanroom.${encodeURIComponent(String(roomId).trim().slice(0, 80))}.lanPending.${ROLE}.v1`;
  const clientId = createId();
  const sessionSecret = `${createId()}${createId()}`;

  let socket = null;
  // idle → connecting → authing → syncing → live；斷線回到 idle，金鑰錯誤等無法自動恢復時為 stopped。
  let phase = "idle";
  let everSynced = false;
  let reconnectAttempt = 0;
  let reconnectTimer = null;
  let heartbeatTimer = null;
  let pongTimer = null;
  let serverTimeOffset = 0;
  let lastError = "";
  let authProblem = null;
  let opCounter = 0;
  // 還沒送出的操作（斷線時累積），與已送出、等待伺服器回覆的操作；重新連線後依原本順序補送。
  const outbox = [];
  const inflight = new Map();
  // 有本機操作還在路上的目標：重新連線取得完整狀態時先不蓋掉，等伺服器回覆或更正。
  const pendingKeys = new Map();
  const knownImages = new Set();
  const imageUploads = new Map();
  // 上一個分頁（重新整理前）留下的身分：伺服器用它辨認補送的修改是同一個人做的。
  let resumeFrom = null;
  let pendingSaveTimer = null;
  let pendingStored = false;

  const mirror = {
    map: null,
    fog: null,
    grid: null,
    initiative: null,
    metas: { map: null, fog: null, grid: null, initiative: null },
    fogEpoch: "",
    fogItems: new Map(),
    tokens: new Map(),
    imageIndex: {},
    presence: { players: 0, gms: 0 }
  };

  const listeners = {
    map: new Set(),
    fog: new Set(),
    grid: new Set(),
    initiative: new Set(),
    dice: new Set(),
    imageIndex: new Set(),
    tokens: new Set(),
    fogBatches: new Set()
  };

  function createId() {
    const bytes = new Uint8Array(16);
    window.crypto.getRandomValues(bytes);
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  function clone(value) {
    return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
  }

  function sameJson(a, b) {
    return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  }

  function safeCall(callback, ...args) {
    try {
      callback(...args);
    } catch (error) {
      console.error("[MapFog LAN]", error);
    }
  }

  function readAdminKey() {
    try {
      return window.localStorage.getItem(ADMIN_KEY_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function writeAdminKey(key) {
    try {
      if (key) window.localStorage.setItem(ADMIN_KEY_STORAGE_KEY, key);
      else window.localStorage.removeItem(ADMIN_KEY_STORAGE_KEY);
    } catch {
      // 存不下來只會讓下次重新整理時要再輸入一次。
    }
  }

  // ---- 連線狀態 ----

  function getConnectionState() {
    return {
      mode: "lan",
      role: ROLE,
      connected: phase === "live",
      everConnected: everSynced,
      players: mirror.presence.players,
      gms: mirror.presence.gms,
      reconnecting: phase !== "live" && phase !== "stopped",
      attempt: reconnectAttempt,
      error: lastError,
      authProblem: authProblem ? { ...authProblem } : null,
      queued: outbox.length + inflight.size
    };
  }

  function emitConnectionState() {
    window.dispatchEvent(new CustomEvent("mapfog:connection", { detail: getConnectionState() }));
  }

  function wsUrl() {
    const url = new URL("lan-ws", window.location.href);
    url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    url.search = "";
    url.hash = "";
    return url.toString();
  }

  function connect() {
    if (phase === "stopped" || socket) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    let ws;
    try {
      ws = new WebSocket(wsUrl());
    } catch (error) {
      handleDisconnect(null, `無法建立連線：${error.message}`);
      return;
    }
    socket = ws;
    phase = "connecting";
    emitConnectionState();
    const connectTimer = window.setTimeout(() => {
      if (socket === ws && phase === "connecting") dropSocket(ws, "連線逾時");
    }, CONNECT_TIMEOUT_MS);

    ws.onopen = () => {
      window.clearTimeout(connectTimer);
      if (socket !== ws) return;
      phase = "authing";
      ws.send(JSON.stringify({
        t: "hello",
        protocol: PROTOCOL_VERSION,
        room: roomId,
        role: ROLE,
        clientId,
        secret: sessionSecret,
        ...(resumeFrom ? { resume: resumeFrom } : {}),
        ...(ROLE === "gm" && readAdminKey() ? { adminKey: readAdminKey() } : {})
      }));
      startHeartbeat(ws);
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      handleMessage(message);
    };
    ws.onclose = (event) => {
      window.clearTimeout(connectTimer);
      if (socket !== ws) return;
      socket = null;
      handleDisconnect(event, phase === "connecting" ? "無法連線至 LAN 伺服器" : "與 LAN 伺服器的連線中斷");
    };
    ws.onerror = () => {};
  }

  function dropSocket(ws, reason) {
    if (socket !== ws) return;
    socket = null;
    try {
      ws.close();
    } catch {
      // 已經關閉。
    }
    handleDisconnect(null, reason);
  }

  function handleDisconnect(event, reason) {
    stopHeartbeat();
    if (phase === "stopped") {
      emitConnectionState();
      return;
    }
    phase = "idle";
    lastError = reason || "";
    emitConnectionState();
    scheduleReconnect();
  }

  // 有上限的指數退避：0.5 秒起跳，每次加倍，最多 15 秒，並加一點隨機避免大家同時重連。
  function scheduleReconnect() {
    if (phase === "stopped" || reconnectTimer !== null) return;
    const base = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** reconnectAttempt);
    const delay = Math.round(base * (0.75 + Math.random() * 0.5));
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  }

  function reconnectNow() {
    if (phase !== "idle" || socket) return;
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
    reconnectAttempt = 0;
    connect();
  }

  // 瀏覽器常要很久才發現 Wi-Fi 斷了：定時送 ping，太久沒回就當作斷線並重連。
  function startHeartbeat(ws) {
    stopHeartbeat();
    heartbeatTimer = window.setInterval(() => {
      if (socket !== ws || ws.readyState !== WebSocket.OPEN) return;
      ws.send(JSON.stringify({ t: "ping" }));
      window.clearTimeout(pongTimer);
      pongTimer = window.setTimeout(() => dropSocket(ws, "LAN 伺服器沒有回應"), HEARTBEAT_TIMEOUT_MS);
    }, HEARTBEAT_INTERVAL_MS);
  }

  function stopHeartbeat() {
    window.clearInterval(heartbeatTimer);
    window.clearTimeout(pongTimer);
    heartbeatTimer = null;
    pongTimer = null;
  }

  function updateServerTime(serverTime) {
    if (Number.isFinite(serverTime)) serverTimeOffset = serverTime - Date.now();
  }

  // ---- 收到伺服器訊息 ----

  function handleMessage(message) {
    switch (message.t) {
      case "auth": handleAuth(message); break;
      case "welcome": handleWelcome(message); break;
      case "ack": handleAck(message); break;
      case "pong":
        window.clearTimeout(pongTimer);
        updateServerTime(message.serverTime);
        break;
      case "presence":
        mirror.presence = { players: Number(message.players) || 0, gms: Number(message.gms) || 0 };
        emitConnectionState();
        break;
      case "error":
        console.warn("[MapFog LAN]", message.message || message.code);
        break;
      default:
        handleStateMessage(message);
    }
  }

  function handleAuth(message) {
    if (!message.ok) {
      handleAuthFailure(message);
      return;
    }
    authProblem = null;
    updateServerTime(message.serverTime);
    if (message.adminKey) writeAdminKey(message.adminKey);
    // 先補送斷線期間的操作，再要求完整狀態：伺服器依序處理，收到的狀態已包含補送的結果。
    const replay = [...inflight.values(), ...outbox.splice(0)];
    inflight.clear();
    for (const entry of replay) transmit(entry, true);
    phase = "syncing";
    socket.send(JSON.stringify({ t: "sync" }));
  }

  function handleAuthFailure(message) {
    const recoverable = message.code === "busy";
    lastError = message.message || "LAN 伺服器拒絕連線";
    if (recoverable) return;
    phase = "stopped";
    authProblem = { code: message.code, message: lastError };
    emitConnectionState();
    if (message.code === "gm-key-required" || message.code === "gm-key-invalid") {
      if (message.code === "gm-key-invalid") writeAdminKey("");
      window.setTimeout(askForAdminKey, 50);
    }
  }

  function askForAdminKey() {
    const hint = authProblem?.code === "gm-key-invalid" ? "金鑰不正確，請再確認一次。\n\n" : "";
    const key = window.prompt(`${hint}這台裝置要以 GM 身分加入 LAN 房間「${roomId}」，請輸入 GM 管理金鑰。\n（金鑰顯示在 GM 筆電的 LAN 伺服器視窗，也存在 lan-data/admin-key.txt）`, "");
    if (!key || !key.trim()) {
      emitConnectionState();
      return;
    }
    writeAdminKey(key.trim());
    authProblem = null;
    lastError = "";
    phase = "idle";
    reconnectAttempt = 0;
    connect();
  }

  function handleWelcome(message) {
    updateServerTime(message.serverTime);
    applyWelcome(message.state || {});
    phase = "live";
    everSynced = true;
    reconnectAttempt = 0;
    lastError = "";
    resumeFrom = null;
    // 等待完整狀態期間又做的修改，現在送出。
    for (const entry of outbox.splice(0)) transmit(entry, entry.offline);
    schedulePendingSave();
    emitConnectionState();
  }

  // ---- 斷線期間的修改存到本機，重新整理後也能補送 ----

  function pendingEntries() {
    return [...inflight.values(), ...outbox];
  }

  function schedulePendingSave() {
    if (pendingSaveTimer !== null) return;
    pendingSaveTimer = window.setTimeout(() => {
      pendingSaveTimer = null;
      savePendingNow();
    }, PENDING_SAVE_DELAY_MS);
  }

  function savePendingNow() {
    window.clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
    const store = window.MapFogLocalStore;
    if (!store) return;
    const entries = pendingEntries();
    if (!entries.length) {
      if (pendingStored) store.remove(PENDING_STORAGE_KEY);
      pendingStored = false;
      return;
    }
    // 連線正常時操作很快就會被確認，只有在斷線或還沒確認時才寫入。
    if (phase === "live" && !entries.some((entry) => entry.offline)) {
      if (pendingStored) store.remove(PENDING_STORAGE_KEY);
      pendingStored = false;
      return;
    }
    pendingStored = true;
    store.set(PENDING_STORAGE_KEY, {
      clientId: resumeFrom?.clientId || clientId,
      secret: resumeFrom?.secret || sessionSecret,
      savedAt: Date.now(),
      ops: entries.map((entry) => ({ message: entry.message, keys: entry.keys }))
    });
  }

  async function restorePending() {
    const store = window.MapFogLocalStore;
    if (!store) return;
    const saved = await store.get(PENDING_STORAGE_KEY);
    if (!saved) return;
    await store.remove(PENDING_STORAGE_KEY);
    if (!Array.isArray(saved.ops) || !saved.ops.length || Date.now() - Number(saved.savedAt || 0) > PENDING_MAX_AGE_MS) return;
    resumeFrom = typeof saved.clientId === "string" && typeof saved.secret === "string"
      ? { clientId: saved.clientId, secret: saved.secret }
      : null;
    for (const op of saved.ops) {
      if (!op?.message?.opId) continue;
      const keys = Array.isArray(op.keys) ? op.keys : [];
      holdPending(keys);
      outbox.push({
        message: { ...op.message, restored: true },
        keys,
        softFail: true,
        offline: true,
        resolve() {},
        reject() {}
      });
    }
    console.info(`[MapFog LAN] 上次斷線時有 ${outbox.length} 筆修改還沒送出，連上後補送`);
  }

  function handleAck(message) {
    const entry = inflight.get(message.opId);
    if (!entry) return;
    inflight.delete(message.opId);
    releasePending(entry.keys);
    if (pendingStored) schedulePendingSave();
    if (message.ok) {
      entry.onAck?.(message);
      entry.resolve(true);
      return;
    }
    const text = message.error || message.code || "LAN 伺服器拒絕這個操作";
    if (HARD_ERROR_CODES.has(message.code) && !entry.softFail) {
      const error = new Error(text);
      error.code = message.code;
      entry.reject(error);
      return;
    }
    console.warn(`[MapFog LAN] ${entry.message.op}：${text}`);
    entry.resolve(false);
  }

  // ---- 本機鏡像：與伺服器狀態比對後，只把有變的部分交給畫面 ----

  function holdPending(keys) {
    for (const key of keys) pendingKeys.set(key, (pendingKeys.get(key) || 0) + 1);
  }

  function releasePending(keys) {
    for (const key of keys) {
      const count = (pendingKeys.get(key) || 0) - 1;
      if (count > 0) pendingKeys.set(key, count);
      else pendingKeys.delete(key);
    }
  }

  function emitValue(key, value) {
    for (const callback of listeners[key]) safeCall(callback, clone(value));
  }

  function setFogBatches(epoch, items) {
    if (mirror.fogEpoch !== epoch) {
      mirror.fogEpoch = epoch || "";
      mirror.fogItems = new Map();
    }
    for (const item of items || []) {
      if (Number.isFinite(item?.seq) && !mirror.fogItems.has(item.seq)) {
        mirror.fogItems.set(item.seq, { strokes: Array.isArray(item.strokes) ? item.strokes : [], by: item.by || "" });
      }
    }
  }

  function deliverFogBatches() {
    for (const subscription of listeners.fogBatches) deliverFogBatchesTo(subscription);
  }

  function deliverFogBatchesTo(subscription) {
    if (subscription.epoch !== mirror.fogEpoch) return;
    const seqs = [...mirror.fogItems.keys()].sort((a, b) => a - b);
    for (const seq of seqs) {
      if (seq <= subscription.afterSeq || subscription.delivered.has(seq)) continue;
      const item = mirror.fogItems.get(seq);
      subscription.delivered.add(seq);
      // 自己送出的擦霧不再套用一次（跟 Firebase 版一樣以 clientId 過濾）。
      if (item.by === clientId) continue;
      safeCall(subscription.callback, seq, clone(item.strokes));
    }
  }

  function tokenMeta(entry, sourceRole) {
    return { sourceRole: sourceRole || (entry?.sourceRole === "gm" ? "gm" : "player"), sourceClientId: entry?.by || "" };
  }

  function emitTokens(name, ...args) {
    for (const handlers of listeners.tokens) {
      if (typeof handlers[name] === "function") safeCall(handlers[name], ...args.map((arg) => (arg && typeof arg === "object" ? clone(arg) : arg)));
    }
  }

  function sortedTokenEntries() {
    return [...mirror.tokens.values()].sort((a, b) => (Number(a.token.order) || 0) - (Number(b.token.order) || 0));
  }

  function diffToken(tokenId, nextEntry, sourceRole) {
    const previous = mirror.tokens.get(tokenId);
    if (!nextEntry) {
      if (!previous) return;
      mirror.tokens.delete(tokenId);
      emitTokens("onRemove", tokenId, { sourceRole });
      return;
    }
    mirror.tokens.set(tokenId, nextEntry);
    if (!previous) {
      emitTokens("onAdd", nextEntry.token, tokenMeta(nextEntry, sourceRole));
      return;
    }
    const changes = {};
    for (const [key, value] of Object.entries(nextEntry.token)) {
      if (!sameJson(value, previous.token[key])) changes[key] = value;
    }
    if (Object.keys(changes).length) emitTokens("onPatch", tokenId, changes, tokenMeta(nextEntry, sourceRole));
  }

  function applyValue(key, value, meta, first, includeEmpty) {
    if (pendingKeys.has(key)) return;
    const changed = !sameJson(mirror[key], value);
    mirror[key] = value ?? null;
    mirror.metas[key] = meta || null;
    if (!first && (!changed || meta?.by === clientId)) return;
    if (value === null || value === undefined) {
      if (includeEmpty) emitValue(key, null);
      return;
    }
    emitValue(key, value);
  }

  function applyWelcome(state) {
    const first = !everSynced;
    const metas = state.metas || {};
    applyValue("map", state.map ?? null, metas.map, first, true);
    if (!pendingKeys.has("fog")) {
      const changed = !sameJson(mirror.fog, state.fog ?? null);
      mirror.fog = state.fog ?? null;
      mirror.metas.fog = metas.fog || null;
      setFogBatches(state.fogBatches?.epoch || "", state.fogBatches?.items || []);
      if (first || (changed && metas.fog?.by !== clientId)) emitValue("fog", mirror.fog);
    }
    applyValue("grid", state.grid ?? null, metas.grid, first, false);
    applyValue("initiative", state.initiative ?? null, metas.initiative, first, false);

    const serverTokens = new Map();
    for (const entry of state.tokens || []) {
      if (entry?.token?.id) serverTokens.set(entry.token.id, { token: entry.token, rev: entry.rev || 0, by: entry.by || "", sourceRole: entry.sourceRole });
    }
    if (first) {
      for (const [tokenId, entry] of serverTokens) if (!pendingKeys.has(`token:${tokenId}`)) mirror.tokens.set(tokenId, entry);
      for (const handlers of listeners.tokens) announceTokens(handlers);
    } else {
      for (const [tokenId, entry] of serverTokens) {
        if (!pendingKeys.has(`token:${tokenId}`)) diffToken(tokenId, entry, "server");
      }
      for (const tokenId of [...mirror.tokens.keys()]) {
        if (!serverTokens.has(tokenId) && !pendingKeys.has(`token:${tokenId}`)) diffToken(tokenId, null, "server");
      }
    }

    if (ROLE === "gm") {
      mirror.imageIndex = state.imageIndex || {};
      emitValue("imageIndex", mirror.imageIndex);
    }
    mirror.presence = { players: Number(state.presence?.players) || 0, gms: Number(state.presence?.gms) || 0 };
    deliverFogBatches();
  }

  function announceTokens(handlers) {
    const entries = sortedTokenEntries();
    for (const entry of entries) {
      if (typeof handlers.onAdd === "function") safeCall(handlers.onAdd, clone(entry.token), tokenMeta(entry));
    }
    if (typeof handlers.onInitialSync === "function") safeCall(handlers.onInitialSync, entries.map((entry) => entry.token.id));
  }

  function resetMirror() {
    mirror.map = null;
    mirror.fog = null;
    mirror.grid = null;
    mirror.initiative = null;
    mirror.metas = { map: null, fog: null, grid: null, initiative: null };
    mirror.fogEpoch = "";
    mirror.fogItems = new Map();
    mirror.imageIndex = {};
    knownImages.clear();
  }

  function handleStateMessage(message) {
    // 其他人的即時變更只在取得完整狀態後處理；伺服器對自己操作的更正（correction）隨時處理。
    if (phase !== "live" && !message.correction && message.t !== "token") return;
    const meta = message.by ? { rev: message.rev || 0, by: message.by } : null;
    switch (message.t) {
      case "map":
        mirror.map = message.map ?? null;
        mirror.metas.map = meta;
        emitValue("map", mirror.map);
        break;
      case "fog":
        mirror.fog = message.fog ?? null;
        mirror.metas.fog = meta;
        mirror.fogEpoch = "";
        setFogBatches(message.fog?.epoch || "", message.batches || []);
        emitValue("fog", mirror.fog);
        deliverFogBatches();
        break;
      case "fogBatch":
        if (message.epoch === mirror.fogEpoch) {
          setFogBatches(message.epoch, [message]);
          deliverFogBatches();
        }
        break;
      case "grid":
        mirror.grid = message.grid ?? null;
        mirror.metas.grid = meta;
        if (mirror.grid) emitValue("grid", mirror.grid);
        break;
      case "initiative":
        mirror.initiative = message.initiative ?? null;
        mirror.metas.initiative = meta;
        if (mirror.initiative) emitValue("initiative", mirror.initiative);
        break;
      case "tokenAdd": {
        const entry = { token: message.token, rev: message.rev || 0, by: message.by || "", sourceRole: message.sourceRole };
        mirror.tokens.set(message.token.id, entry);
        emitTokens("onAdd", entry.token, tokenMeta(entry, message.sourceRole));
        break;
      }
      case "tokenPatch": {
        const previous = mirror.tokens.get(message.tokenId);
        if (!previous) break;
        const entry = { token: { ...previous.token, ...message.changes }, rev: message.rev || 0, by: message.by || "", sourceRole: message.sourceRole };
        mirror.tokens.set(message.tokenId, entry);
        emitTokens("onPatch", message.tokenId, message.changes || {}, tokenMeta(entry, message.sourceRole));
        break;
      }
      case "tokenRemove":
        if (!mirror.tokens.has(message.tokenId)) break;
        mirror.tokens.delete(message.tokenId);
        emitTokens("onRemove", message.tokenId, { sourceRole: message.sourceRole === "gm" ? "gm" : "player" });
        break;
      case "token":
        // 伺服器的權威版本：自己的修改被拒絕（鎖定、已刪除或衝突）時，改回伺服器上的樣子。
        diffToken(message.tokenId, message.token ? { token: message.token, rev: message.rev || 0, by: message.by || "", sourceRole: message.sourceRole } : null, "server");
        break;
      case "imageIndex":
        mirror.imageIndex = message.index || {};
        emitValue("imageIndex", mirror.imageIndex);
        break;
      case "dice":
        for (const callback of listeners.dice) safeCall(callback, clone(message.roll));
        break;
      case "roomCleared": {
        const tokenIds = [...mirror.tokens.keys()];
        resetMirror();
        mirror.tokens.clear();
        // 先通知地圖被清空（畫面會清掉暫存並重新整理），再移除 token。
        emitValue("map", null);
        emitValue("fog", null);
        for (const tokenId of tokenIds) emitTokens("onRemove", tokenId, { sourceRole: "server" });
        break;
      }
      default:
        break;
    }
  }

  // ---- 送出操作 ----

  function enqueue(op, payload, options = {}) {
    return new Promise((resolve, reject) => {
      opCounter += 1;
      const entry = {
        message: { t: "op", op, opId: `${clientId.slice(0, 8)}-${Date.now().toString(36)}-${opCounter}`, ...payload },
        keys: options.keys || [],
        softFail: Boolean(options.softFail),
        onAck: options.onAck,
        offline: phase !== "live",
        resolve,
        reject
      };
      holdPending(entry.keys);
      if (phase === "live" && socket?.readyState === WebSocket.OPEN) transmit(entry, false);
      else {
        outbox.push(entry);
        schedulePendingSave();
      }
      emitConnectionState();
    });
  }

  function transmit(entry, replay) {
    entry.message.replay = Boolean(replay);
    inflight.set(entry.message.opId, entry);
    try {
      socket.send(JSON.stringify(entry.message));
    } catch (error) {
      console.warn("[MapFog LAN] 送出失敗，重新連線後補送", error);
    }
  }

  function baseRevOf(meta) {
    return everSynced ? (meta?.rev || 0) : null;
  }

  function tokenBaseRev(tokenId) {
    return everSynced ? (mirror.tokens.get(tokenId)?.rev || 0) : null;
  }

  function onTokenAck(tokenId) {
    return (ack) => {
      const entry = mirror.tokens.get(tokenId);
      if (entry && ack.rev) mirror.tokens.set(tokenId, { ...entry, rev: ack.rev, by: clientId });
    };
  }

  function onMetaAck(...keys) {
    return (ack) => {
      if (!ack.rev) return;
      for (const key of keys) mirror.metas[key] = { rev: ack.rev, by: clientId };
    };
  }

  function addValueListener(key, callback, includeEmpty) {
    listeners[key].add(callback);
    if (everSynced) {
      queueMicrotask(() => {
        if (!listeners[key].has(callback)) return;
        if (mirror[key] !== null || includeEmpty) safeCall(callback, clone(mirror[key]));
      });
    }
    return function unsubscribe() {
      listeners[key].delete(callback);
    };
  }

  function hasServerImage(hash) {
    if (knownImages.has(hash) || mirror.imageIndex[hash]) return true;
    if (mirror.map?.hash === hash || mirror.fog?.checkpointHash === hash) return true;
    for (const entry of mirror.tokens.values()) if (entry.token.imageHash === hash) return true;
    return false;
  }

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function waitUntilLive() {
    if (phase === "live") return Promise.resolve();
    return new Promise((resolve) => {
      const check = () => {
        if (phase !== "live") return;
        window.removeEventListener("mapfog:connection", check);
        resolve();
      };
      window.addEventListener("mapfog:connection", check);
    });
  }

  function imageUrl(hash) {
    return new URL(`lan-api/rooms/${encodeURIComponent(roomId)}/images/${encodeURIComponent(hash)}`, window.location.href).toString();
  }

  const api = {
    mode: "lan",
    roomId,
    clientId,
    saveMapAndFog(mapState, fogState) {
      const map = { hash: mapState?.hash, width: mapState?.width, height: mapState?.height };
      const fog = clone(fogState);
      const baseRevs = { map: baseRevOf(mirror.metas.map), fog: baseRevOf(mirror.metas.fog) };
      mirror.map = map;
      mirror.fog = fog;
      mirror.metas.map = mirror.metas.fog = { rev: baseRevs.map || 0, by: clientId };
      mirror.fogEpoch = "";
      setFogBatches(fog?.epoch || "", []);
      return enqueue("saveMapAndFog", { map, fog, baseRevs }, { keys: ["map", "fog"], onAck: onMetaAck("map", "fog") });
    },
    onMapState(callback) {
      return addValueListener("map", callback, true);
    },
    clearRoomState() {
      if (phase !== "live") return Promise.reject(new Error("LAN 伺服器未連線"));
      return enqueue("clearRoomState", {}, {}).then((ok) => {
        if (!ok) throw new Error("LAN 伺服器拒絕清除房間");
        resetMirror();
        mirror.tokens.clear();
      });
    },
    saveFogState(fogState) {
      const fog = clone(fogState);
      const baseRev = baseRevOf(mirror.metas.fog);
      mirror.fog = fog;
      mirror.fogEpoch = "";
      setFogBatches(fog?.epoch || "", []);
      return enqueue("saveFogState", { fog, baseRev }, { keys: ["fog"], onAck: onMetaAck("fog") });
    },
    onFogState(callback) {
      return addValueListener("fog", callback, true);
    },
    appendFogBatch(epoch, seq, strokes) {
      if (epoch === mirror.fogEpoch) setFogBatches(epoch, [{ seq, strokes, by: clientId }]);
      return enqueue("appendFogBatch", { epoch, seq, strokes });
    },
    onFogBatches(epoch, afterSeq, callback) {
      const subscription = { epoch, afterSeq: Number(afterSeq) || 0, callback, delivered: new Set() };
      listeners.fogBatches.add(subscription);
      if (everSynced) queueMicrotask(() => {
        if (listeners.fogBatches.has(subscription)) deliverFogBatchesTo(subscription);
      });
      return function unsubscribe() {
        listeners.fogBatches.delete(subscription);
      };
    },
    sendGridSettings(gridSettings) {
      const grid = clone(gridSettings);
      const baseRev = baseRevOf(mirror.metas.grid);
      mirror.grid = grid;
      return enqueue("sendGridSettings", { grid, baseRev }, { keys: ["grid"], softFail: true, onAck: onMetaAck("grid") });
    },
    onGridSettings(callback) {
      return addValueListener("grid", callback, false);
    },
    putImage(hash, dataUrl, kind) {
      if (!hash || !dataUrl) return Promise.resolve();
      if (hasServerImage(hash)) return Promise.resolve();
      if (imageUploads.has(hash)) return imageUploads.get(hash);
      const upload = enqueue("putImage", { hash, dataUrl, kind }, {
        onAck: () => knownImages.add(hash)
      }).finally(() => imageUploads.delete(hash));
      imageUploads.set(hash, upload);
      return upload;
    },
    onImageIndex(callback) {
      return addValueListener("imageIndex", callback, true);
    },
    deleteImages(hashes) {
      const list = [...hashes];
      if (!list.length) return Promise.resolve();
      for (const hash of list) knownImages.delete(hash);
      return enqueue("deleteImages", { hashes: list }, { softFail: true });
    },
    serverNow() {
      return Date.now() + serverTimeOffset;
    },
    // 圖片用一般 HTTP 下載（依雜湊命名、可快取）；伺服器暫時連不上時等重新連線再試。
    async getImage(hash) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        try {
          const response = await fetch(imageUrl(hash), { cache: "default" });
          if (response.ok) {
            const text = await response.text();
            return text.startsWith("data:image/") ? text : "";
          }
          if (response.status !== 404 || attempt >= 2) return "";
          await delay(800 * (attempt + 1));
        } catch {
          await waitUntilLive();
        }
      }
      return "";
    },
    addToken(token, _sourceRole) {
      if (!token?.id) return Promise.resolve();
      const baseRev = tokenBaseRev(token.id);
      const previous = mirror.tokens.get(token.id);
      mirror.tokens.set(token.id, { token: clone(token), rev: previous?.rev || 0, by: previous?.by || clientId, sourceRole: ROLE });
      return enqueue("addToken", { token: clone(token), baseRev }, { keys: [`token:${token.id}`], onAck: onTokenAck(token.id) });
    },
    updateToken(tokenId, changes, _sourceRole) {
      const updates = {};
      for (const [key, value] of Object.entries(changes || {})) {
        if (key === "id" || key === "imageHash" || value === undefined) continue;
        updates[key] = value;
      }
      if (!tokenId || !Object.keys(updates).length) return Promise.resolve();
      const baseRev = tokenBaseRev(tokenId);
      const previous = mirror.tokens.get(tokenId);
      if (previous) mirror.tokens.set(tokenId, { ...previous, token: { ...previous.token, ...updates } });
      return enqueue("updateToken", { tokenId, changes: updates, baseRev }, { keys: [`token:${tokenId}`], onAck: onTokenAck(tokenId) });
    },
    removeToken(tokenId) {
      if (!tokenId) return Promise.resolve();
      const baseRev = tokenBaseRev(tokenId);
      mirror.tokens.delete(tokenId);
      return enqueue("removeToken", { tokenId, baseRev }, { keys: [`token:${tokenId}`] });
    },
    onTokenEvents(handlers) {
      const entry = handlers || {};
      listeners.tokens.add(entry);
      if (everSynced) queueMicrotask(() => {
        if (listeners.tokens.has(entry)) announceTokens(entry);
      });
      return function unsubscribe() {
        listeners.tokens.delete(entry);
      };
    },
    // 只送公開的名稱與敵友；GM 的 HP 與先攻值留在 GM 瀏覽器。
    sendInitiativeState(initiativeState) {
      const state = {
        entries: (initiativeState?.entries || []).map((entry) => ({ id: entry.id, name: entry.name, side: entry.side }))
      };
      mirror.initiative = state;
      return enqueue("sendInitiativeState", { state }, { keys: ["initiative"], softFail: true, onAck: onMetaAck("initiative") });
    },
    onInitiativeState(callback) {
      return addValueListener("initiative", callback, false);
    },
    sendDiceRoll(roll) {
      return enqueue("diceRoll", { roll: clone(roll) || {} }, { softFail: true });
    },
    onDiceRoll(callback) {
      listeners.dice.add(callback);
      return function unsubscribe() {
        listeners.dice.delete(callback);
      };
    },
    getConnectionState,
    reconnect: reconnectNow
  };

  window.addEventListener("online", reconnectNow);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") reconnectNow();
    else if (pendingEntries().length) savePendingNow();
  });
  window.addEventListener("pagehide", () => {
    // 斷線中、或剛送出還沒確認的修改，在關閉或重新整理前寫進本機。
    for (const entry of inflight.values()) entry.offline = true;
    if (pendingEntries().length) savePendingNow();
  });

  window.MapFogLanSync = api;
  window.MapFogSync = api;
  console.info("[MapFog LAN] 同步服務就緒", { roomId, clientId, role: ROLE });
  window.dispatchEvent(new CustomEvent("mapfog:sync-ready", { detail: api }));
  // 先讀回上次沒送出的修改，再連線：補送一定排在完整狀態之前。
  restorePending()
    .catch((error) => console.error("[MapFog LAN] 讀取未送出的修改失敗", error))
    .finally(connect);
})();
