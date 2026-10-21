const DEFAULT_SYNC_CHANNEL_NAME = "mapfog.sync.v1";
const CONTROL_CHANNEL_NAME = "mapfog.control.v1";
const DEFAULT_SHARED_GRID_STORAGE_KEY = "mapfog.shared.grid.v1";

const viewport = document.getElementById("viewport");
const canvasHolder = document.getElementById("canvasHolder");
const mapCanvas = document.getElementById("mapCanvas");
const gridCanvas = document.getElementById("gridCanvas");
const fogCanvas = document.getElementById("fogCanvas");
const rotateBtn = document.getElementById("rotateBtn");
const toolbarToggleBtn = document.getElementById("toolbarToggleBtn");
const floatingToolbar = document.getElementById("floatingToolbar");
const tokenSettingsBtn = document.getElementById("tokenSettingsBtn");
const tokenPanel = document.getElementById("tokenPanel");
const tokenPanelCloseBtn = document.getElementById("tokenPanelCloseBtn");
const tokenUploadBtn = document.getElementById("tokenUploadBtn");
const tokenFileInput = document.getElementById("tokenFileInput");
const tokenSize = document.getElementById("tokenSize");
const tokenSizeValue = document.getElementById("tokenSizeValue");
const tokenSquareBtn = document.getElementById("tokenSquareBtn");
const tokenHexBtn = document.getElementById("tokenHexBtn");
const tokenClearBtn = document.getElementById("tokenClearBtn");
const tokenStatus = document.getElementById("tokenStatus");
const tokenSelect = document.getElementById("tokenSelect");
const tokenLayer = document.getElementById("tokenLayer");
const mapCtx = mapCanvas.getContext("2d");
const gridCtx = gridCanvas.getContext("2d");
const fogCtx = fogCanvas.getContext("2d");

const DEFAULT_PLAYER_VIEW_STATE_STORAGE_KEY = "mapfog.view.player.v1";
const DEFAULT_PLAYER_MAP_ADJUST_STORAGE_KEY = "mapfog.mapAdjust.player.v1";
const OLROOM_STORAGE_PREFIX = "mapfog.olroom.";
const TOKEN_DEFAULT_SIZE = 96;
const TOKEN_MIN_SIZE = 16;
const TOKEN_MAX_SIZE = 800;
const CONTROL_SYNC_DEBOUNCE_MS = 300;
const TOKEN_SYNC_THROTTLE_MS = 300;
const VIEW_STATE_PERSIST_DELAY_MS = 300;
const LOCAL_TOKEN_PROTECTION_MS = 2000;
const TOKEN_SOURCE_ROLE = "player";
const LOCAL_IMAGE_PRUNE_DELAY_MS = 5000;
// 圖片與 id 只在新增時送出，其餘欄位可以單獨更新。
const TOKEN_SYNC_KEYS = ["name", "initiativeLabel", "initiativeEntryId", "hpFontSize", "x", "y", "size", "shape", "visible", "order", "locked"];
const TOKEN_GEOMETRY_KEYS = ["x", "y", "size", "shape"];
const queryParams = new URLSearchParams(window.location.search);
const FIREBASE_ROOM_ID = queryParams.get("room") || "";
const FIREBASE_SYNC_MODE = queryParams.get("sync") === "firebase";
const OFFLINE_ROOM_ID = FIREBASE_ROOM_ID || FIREBASE_SYNC_MODE ? "" : (queryParams.get("olroom") || "");
const IS_FIREBASE_ROOM = Boolean(FIREBASE_ROOM_ID || FIREBASE_SYNC_MODE);
const IS_OFFLINE_ROOM = Boolean(OFFLINE_ROOM_ID);
const FIREBASE_ROOM_KEY = sanitizeStorageSegment(FIREBASE_ROOM_ID || "default");
const OFFLINE_ROOM_KEY = sanitizeStorageSegment(OFFLINE_ROOM_ID);
const STORAGE_PREFIX = IS_FIREBASE_ROOM
  ? `mapfog.room.${FIREBASE_ROOM_KEY}.`
  : (IS_OFFLINE_ROOM ? `${OLROOM_STORAGE_PREFIX}${OFFLINE_ROOM_KEY}.` : "");
const USE_NAMESPACED_STORAGE_KEYS = Boolean(STORAGE_PREFIX);
const SYNC_CHANNEL_NAME = getSyncChannelName();
const SHARED_GRID_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}grid.v1` : DEFAULT_SHARED_GRID_STORAGE_KEY;
const PLAYER_VIEW_STATE_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}playerView.v1` : DEFAULT_PLAYER_VIEW_STATE_STORAGE_KEY;
const PLAYER_MAP_ADJUST_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}playerMapAdjust.v1` : DEFAULT_PLAYER_MAP_ADJUST_STORAGE_KEY;
// Firebase room 已經同步一切；同機再走 BroadcastChannel 會讓柔邊擦霧被套用兩次。
const syncChannel = !IS_FIREBASE_ROOM && "BroadcastChannel" in window ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;
// GM 的跨房間控制訊息：切換玩家房間、清除所有 olroom 暫存。
const controlChannel = !IS_FIREBASE_ROOM && "BroadcastChannel" in window ? new BroadcastChannel(CONTROL_CHANNEL_NAME) : null;
const localStore = window.MapFogLocalStore;
// 本機暫存的名稱開頭：room／olroom 各自分開，沒有房間參數的預設畫面用 mapfog.shared.。
const LOCAL_CACHE_PREFIX = STORAGE_PREFIX || "mapfog.shared.";
const imageStore = window.MapFogImageStore.create({ prefix: LOCAL_CACHE_PREFIX, remote: IS_FIREBASE_ROOM });
// 玩家最後看到的畫面：地圖雜湊、迷霧畫布與進度、token、格線。開頁時先顯示它，再跟 GM／Firebase 比對。
const SCENE_CACHE_KEY = `${LOCAL_CACHE_PREFIX}scene.player.v3`;
// 同一台電腦的 GM 畫面暫存；玩家自己的暫存比較舊或沒有時改用它（例如 GM 先準備好 olroom 地圖）。
const GM_SCENE_CACHE_KEY = `${LOCAL_CACHE_PREFIX}scene.gm.v3`;
const SCENE_CACHE_DELAY_MS = 1500;
// 地圖調整只存在這個玩家的瀏覽器，不會同步給 GM 或其他玩家。
const mapAdjust = window.MapFogMapAdjust?.create({
  canvas: mapCanvas,
  storageKey: PLAYER_MAP_ADJUST_STORAGE_KEY,
  onOpen: () => setTokenPanelOpen(false)
}) ?? null;

let hasMap = false;
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let viewRotation = 0;
let gridSettings = createDefaultGridSettings();
let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;
let pinchStartDistance = null;
let pinchStartScale = 1;
let pinchMidStart = null;
let pinchStartOffset = null;
let tokenCollectionState = createDefaultTokenCollectionState();
let draggingTokenId = null;
let tokenDragOffsetX = 0;
let tokenDragOffsetY = 0;
let firebaseSync = null;
let tokenDragSyncTimer = null;
let tokenControlSyncTimer = null;
let viewStatePersistTimer = null;
let lastTokenDragSyncAt = 0;
let currentMapDataUrl = "";
let currentMapHash = "";
let mapLoadSeq = 0;
let localImagePruneTimer = null;
let sceneCacheTimer = null;
let fogCacheDataUrl = "";
let fogCacheDirty = true;
// Firebase SDK 還沒載入（例如離線開啟）時玩家對 token 的修改，連上後補送。
const offlineChanges = { added: new Set(), patched: new Set(), removed: new Set() };
let protectedTokenId = null;
let protectedTokenUntil = 0;
let snapshotApplySeq = 0;
let pendingRemoteFogState = null;
let applyingRemoteMapState = false;
// room 模式的迷霧進度：epoch 換了代表重設、全開或壓縮；seq 是已送出／已套用的最後一筆擦霧序號。
let fogSync = createEmptyFogSync();
let pendingRemoteFogSync = null;
let fogSyncApplySeq = 0;
let fogBatchListenEpoch = "";
let stopFogBatchListener = null;
let suppressBeforeUnloadPersist = false;
// 本機暫存還原完成前收到的 token 更新先排隊，避免被還原的舊資料蓋掉。
let localRestorePending = true;
let queuedTokenUpdates = [];

function sanitizeStorageSegment(value) {
  return encodeURIComponent(String(value || "default").trim().slice(0, 80) || "default");
}

function getSyncChannelName() {
  if (IS_FIREBASE_ROOM) return `${DEFAULT_SYNC_CHANNEL_NAME}.room.${FIREBASE_ROOM_KEY}`;
  if (IS_OFFLINE_ROOM) return `${DEFAULT_SYNC_CHANNEL_NAME}.olroom.${OFFLINE_ROOM_KEY}`;
  return DEFAULT_SYNC_CHANNEL_NAME;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundCanvasValue(value) {
  return Math.round(value * 10) / 10;
}

function whenFirebaseReady(callback) {
  if (window.MapFogFirebaseSync) {
    callback(window.MapFogFirebaseSync);
    return;
  }

  window.addEventListener("mapfog:firebase-ready", (event) => callback(event.detail), { once: true });
}

function writeSharedState(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

function readSharedState(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function isWaitingForFirebase() {
  return IS_FIREBASE_ROOM && !firebaseSync;
}

function scheduleSceneCache() {
  if (!localStore || sceneCacheTimer !== null) return;
  sceneCacheTimer = window.setTimeout(() => {
    sceneCacheTimer = null;
    writeSceneCache();
  }, SCENE_CACHE_DELAY_MS);
}

function markFogChanged() {
  fogCacheDirty = true;
  scheduleSceneCache();
}

// 迷霧畫布與 fogSync 進度在同一刻記下，重新開啟時才能從正確的位置接著讀擦霧紀錄。
function writeSceneCache(force = false) {
  if (!localStore || suppressBeforeUnloadPersist) return;
  if (!force && draggingTokenId) {
    scheduleSceneCache();
    return;
  }
  if (hasMap && (fogCacheDirty || !fogCacheDataUrl)) {
    fogCacheDataUrl = fogCanvas.toDataURL("image/png");
    fogCacheDirty = false;
  }
  localStore.set(SCENE_CACHE_KEY, {
    map: hasMap ? { hash: currentMapHash, width: mapCanvas.width, height: mapCanvas.height } : null,
    fog: hasMap ? { dataUrl: fogCacheDataUrl, width: fogCanvas.width, height: fogCanvas.height, ...fogSync } : null,
    grid: { ...gridSettings },
    tokens: tokenCollectionState.tokens,
    offlineChanges: {
      added: [...offlineChanges.added],
      patched: [...offlineChanges.patched],
      removed: [...offlineChanges.removed]
    },
    savedAt: Date.now()
  });
}

function restoreOfflineChanges(saved) {
  if (!IS_FIREBASE_ROOM || !saved) return;
  (saved.added || []).forEach((tokenId) => offlineChanges.added.add(tokenId));
  (saved.patched || []).forEach((tokenId) => offlineChanges.patched.add(tokenId));
  (saved.removed || []).forEach((tokenId) => offlineChanges.removed.add(tokenId));
}

// 連上 Firebase 時先送出 SDK 載入前的修改；鎖定與否仍由 GM 判斷，不接受的會被 GM 改回去。
function flushOfflineChanges() {
  for (const tokenId of offlineChanges.removed) firebaseSync.removeToken(tokenId).catch(logFirebaseError);
  for (const tokenId of offlineChanges.added) {
    const token = getTokenById(tokenId);
    if (!token) continue;
    uploadImage(token.imageHash, "token");
    firebaseSync.addToken(token, TOKEN_SOURCE_ROLE).catch(logFirebaseError);
  }
  for (const tokenId of offlineChanges.patched) {
    const token = getTokenById(tokenId);
    if (token) firebaseSync.updateToken(tokenId, pickTokenGeometry(token), TOKEN_SOURCE_ROLE).catch(logFirebaseError);
  }

  const hadChanges = offlineChanges.added.size || offlineChanges.patched.size || offlineChanges.removed.size;
  offlineChanges.added.clear();
  offlineChanges.patched.clear();
  offlineChanges.removed.clear();
  if (hadChanges) {
    console.info("[MapFog 暫存] 已送出離線期間的修改");
    scheduleSceneCache();
  }
}

// 本機圖片暫存只留還在用的；GM 與玩家視窗共用同一份暫存時，雙方暫存畫面用到的都會保留。
function scheduleLocalImagePrune() {
  window.clearTimeout(localImagePruneTimer);
  localImagePruneTimer = window.setTimeout(() => {
    const inUse = [currentMapHash, ...tokenCollectionState.tokens.map((token) => token.imageHash)];
    imageStore.pruneLocal(inUse).catch((error) => console.error("[MapFog 圖片]", error));
  }, LOCAL_IMAGE_PRUNE_DELAY_MS);
}

function cacheGridSettings() {
  writeSharedState(SHARED_GRID_STORAGE_KEY, { ...gridSettings });
  scheduleSceneCache();
}

function createDefaultGridSettings() {
  return {
    enabled: false,
    type: "square",
    color: "white",
    opacity: 0.45,
    size: 80,
    lineWidth: 1,
    offsetX: 0,
    offsetY: 0
  };
}

function normalizeGridSettings(settings = {}) {
  const defaults = createDefaultGridSettings();
  return {
    enabled: Boolean(settings.enabled ?? defaults.enabled),
    type: settings.type === "hex" ? "hex" : "square",
    color: settings.color === "black" ? "black" : "white",
    opacity: clamp(Number(settings.opacity ?? defaults.opacity), 0, 1),
    size: clamp(Number(settings.size ?? defaults.size), 24, 240),
    lineWidth: clamp(Number(settings.lineWidth ?? defaults.lineWidth), 1, 20),
    offsetX: clamp(Number(settings.offsetX ?? defaults.offsetX), -240, 240),
    offsetY: clamp(Number(settings.offsetY ?? defaults.offsetY), -240, 240)
  };
}

function createDefaultTokenState() {
  return {
    imageHash: "",
    x: 0,
    y: 0,
    size: TOKEN_DEFAULT_SIZE,
    shape: "square",
    visible: false
  };
}

function normalizeTokenState(state = {}) {
  const imageHash = typeof state.imageHash === "string" ? state.imageHash : "";
  const fallbackX = mapCanvas.width ? mapCanvas.width / 2 : 0;
  const fallbackY = mapCanvas.height ? mapCanvas.height / 2 : 0;
  const x = Number.isFinite(Number(state.x)) ? Number(state.x) : fallbackX;
  const y = Number.isFinite(Number(state.y)) ? Number(state.y) : fallbackY;

  return {
    imageHash,
    x,
    y,
    size: clamp(Number(state.size ?? TOKEN_DEFAULT_SIZE), TOKEN_MIN_SIZE, TOKEN_MAX_SIZE),
    shape: state.shape === "hex" ? "hex" : "square",
    visible: Boolean(state.visible && imageHash)
  };
}

function gridColorToRgba() {
  const channel = gridSettings.color === "black" ? "0,0,0" : "255,255,255";
  return `rgba(${channel},${gridSettings.opacity})`;
}

function addHexGridPath(path, width, height) {
  const radius = gridSettings.size / 2;
  const hexHeight = Math.sqrt(3) * radius;
  const xStep = radius * 1.5;
  const startCol = Math.floor((-gridSettings.size - gridSettings.offsetX) / xStep) - 2;
  const endCol = Math.ceil((width + gridSettings.size - gridSettings.offsetX) / xStep) + 2;

  for (let col = startCol; col <= endCol; col += 1) {
    const cx = gridSettings.offsetX + col * xStep;
    const columnOffsetY = Math.abs(col % 2) === 1 ? hexHeight / 2 : 0;
    const startRow = Math.floor((-hexHeight - gridSettings.offsetY - columnOffsetY) / hexHeight) - 2;
    const endRow = Math.ceil((height + hexHeight - gridSettings.offsetY - columnOffsetY) / hexHeight) + 2;

    for (let row = startRow; row <= endRow; row += 1) {
      const cy = gridSettings.offsetY + columnOffsetY + row * hexHeight;
      const right = cx + radius;
      const lowerRightX = cx + radius / 2;
      const lowerRightY = cy + hexHeight / 2;
      const lowerLeftX = cx - radius / 2;
      const lowerLeftY = lowerRightY;
      const left = cx - radius;

      path.moveTo(right, cy);
      path.lineTo(lowerRightX, lowerRightY);
      path.lineTo(lowerLeftX, lowerLeftY);
      path.lineTo(left, cy);
    }
  }
}

function drawGrid() {
  gridCtx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  if (!gridSettings.enabled || !gridCanvas.width || !gridCanvas.height) return;

  const width = gridCanvas.width;
  const height = gridCanvas.height;
  const lineWidth = gridSettings.lineWidth;
  const lineOffset = lineWidth % 2 === 1 ? 0.5 : 0;
  const path = new Path2D();

  if (gridSettings.type === "hex") {
    addHexGridPath(path, width, height);
  } else {
    const size = gridSettings.size;
    const startX = (gridSettings.offsetX % size) - size;
    const startY = (gridSettings.offsetY % size) - size;

    for (let x = startX; x <= width + size; x += size) {
      const crispX = Math.round(x) + lineOffset;
      path.moveTo(crispX, 0);
      path.lineTo(crispX, height);
    }

    for (let y = startY; y <= height + size; y += size) {
      const crispY = Math.round(y) + lineOffset;
      path.moveTo(0, crispY);
      path.lineTo(width, crispY);
    }
  }

  gridCtx.save();
  gridCtx.strokeStyle = gridColorToRgba();
  gridCtx.lineWidth = lineWidth;
  gridCtx.stroke(path);
  gridCtx.restore();
}

function setGridSettings(nextSettings, options = {}) {
  gridSettings = normalizeGridSettings({ ...gridSettings, ...nextSettings });
  drawGrid();
  if (options.cache !== false) cacheGridSettings();
}

function createTokenId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `token-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultTokenState(overrides = {}) {
  return {
    id: overrides.id || createTokenId(), name: "", imageHash: "",
    x: mapCanvas.width ? mapCanvas.width / 2 : 0,
    y: mapCanvas.height ? mapCanvas.height / 2 : 0,
    size: TOKEN_DEFAULT_SIZE, shape: "square", visible: false, ...overrides
  };
}

function normalizeTokenState(state = {}) {
  // token 只記圖片雜湊；圖片本身在圖片暫存（imageStore）裡。
  const imageHash = typeof state.imageHash === "string" ? state.imageHash : "";
  return {
    id: typeof state.id === "string" && state.id ? state.id : createTokenId(),
    name: typeof state.name === "string" ? state.name.trim() : "",
    initiativeLabel: typeof state.initiativeLabel === "string" ? state.initiativeLabel.trim() : "",
    initiativeEntryId: typeof state.initiativeEntryId === "string" ? state.initiativeEntryId : "",
    hpFontSize: clamp(Math.round(Number(state.hpFontSize) || 24), 8, 96),
    imageHash,
    x: Number.isFinite(Number(state.x)) ? Number(state.x) : (mapCanvas.width ? mapCanvas.width / 2 : 0),
    y: Number.isFinite(Number(state.y)) ? Number(state.y) : (mapCanvas.height ? mapCanvas.height / 2 : 0),
    size: clamp(Number(state.size ?? TOKEN_DEFAULT_SIZE), TOKEN_MIN_SIZE, TOKEN_MAX_SIZE),
    shape: state.shape === "hex" ? "hex" : "square",
    visible: Boolean(state.visible && imageHash),
    // 建立時間，用來決定 token 清單與疊放順序；各自存在 token 上，同時新增也不會互相蓋掉。
    order: Number.isFinite(Number(state.order)) ? Number(state.order) : 0,
    locked: Boolean(state.locked)
  };
}

function createDefaultTokenCollectionState() { return { tokens: [], selectedTokenId: null }; }

function normalizeTokenCollectionState(state = {}) {
  if (Array.isArray(state.tokens)) {
    const seen = new Set();
    const tokens = state.tokens.map(normalizeTokenState).filter((token) => !seen.has(token.id) && seen.add(token.id))
      .sort((a, b) => a.order - b.order);
    const selectedTokenId = tokens.some((t) => t.id === state.selectedTokenId) ? state.selectedTokenId : (tokens[0]?.id || null);
    return { tokens, selectedTokenId };
  }
  if (state && (state.imageHash || state.visible || state.id)) {
    const token = normalizeTokenState(state);
    return { tokens: [token], selectedTokenId: token.id };
  }
  return createDefaultTokenCollectionState();
}

function mergeTokenCollectionState(incoming = {}) {
  const rawTokens = Array.isArray(incoming.tokens) ? incoming.tokens : [];
  const existing = new Map(tokenCollectionState.tokens.map((token) => [token.id, token]));
  const tokens = rawTokens.map((raw) => normalizeTokenState({ ...(existing.get(raw.id) || {}), ...raw }));
  // 選取狀態只屬於這個畫面，收到的資料就算帶了 selectedTokenId 也不採用。
  return normalizeTokenCollectionState({ tokens, selectedTokenId: tokenCollectionState.selectedTokenId });
}

function getSelectedToken() { return tokenCollectionState.tokens.find((t) => t.id === tokenCollectionState.selectedTokenId) || null; }

function protectLocalToken(tokenId) {
  if (!tokenId) return;
  protectedTokenId = tokenId;
  protectedTokenUntil = Date.now() + LOCAL_TOKEN_PROTECTION_MS;
}

function getProtectedTokenId() {
  if (draggingTokenId) return draggingTokenId;
  if (protectedTokenId && Date.now() < protectedTokenUntil) return protectedTokenId;
  return null;
}

function preserveProtectedTokenState(nextState) {
  const tokenId = getProtectedTokenId();
  if (!tokenId) return nextState;

  const localToken = tokenCollectionState.tokens.find((token) => token.id === tokenId);
  if (!localToken) return nextState;

  const incoming = mergeTokenCollectionState(nextState);
  // 收到的狀態裡沒有這顆 token，代表已被刪除；不把本機版本補回去，避免救回已刪除的 token。
  const tokens = incoming.tokens.map((token) => {
    if (token.id !== tokenId) return token;
    return { ...token, ...pickTokenGeometry(localToken) };
  });

  return {
    tokens,
    selectedTokenId: draggingTokenId || tokenCollectionState.selectedTokenId
  };
}

function broadcastMessage(message) {
  syncChannel?.postMessage({ ...message, source: "player" });
}

function getTokenById(tokenId) {
  return tokenCollectionState.tokens.find((token) => token.id === tokenId) || null;
}

function pickTokenFields(source, keys) {
  const picked = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(source, key)) picked[key] = source[key];
  }
  return picked;
}

function pickTokenGeometry(token) {
  return pickTokenFields(token, TOKEN_GEOMETRY_KEYS);
}

function logFirebaseError(error) {
  console.error("[MapFog Firebase]", error);
}

// 新圖片：算出雜湊、放進圖片暫存，回傳雜湊給 token 使用。
function rememberNewImage(dataUrl) {
  const hash = imageStore.hash(dataUrl);
  imageStore.remember(hash, dataUrl);
  return hash;
}

// room 模式把圖片寫到 images/{雜湊}；一定要在引用它的 token 之前寫，其他人才抓得到。
function uploadImage(hash, kind) {
  const dataUrl = imageStore.peek(hash);
  if (!IS_FIREBASE_ROOM || !firebaseSync || !hash || !dataUrl) return;
  firebaseSync.putImage(hash, dataUrl, kind).catch(logFirebaseError);
}

// 以下三個函式是 token 變更唯一的送出口：olroom 走 BroadcastChannel，room 走 Firebase，格式一致。
function sendTokenAdd(token) {
  if (!token?.id) return;
  if (isWaitingForFirebase()) offlineChanges.added.add(token.id);
  // olroom 訊息附上圖片，GM 畫面不必等本機暫存寫完就能顯示。
  broadcastMessage({ type: "tokenAdd", token: { ...token }, images: imageStore.collect([token.imageHash]), sourceRole: TOKEN_SOURCE_ROLE });
  uploadImage(token.imageHash, "token");
  firebaseSync?.addToken(token, TOKEN_SOURCE_ROLE).catch(logFirebaseError);
}

function sendTokenPatch(tokenId, keys) {
  const token = getTokenById(tokenId);
  if (!token) return;
  const changes = pickTokenFields(token, keys.filter((key) => TOKEN_SYNC_KEYS.includes(key)));
  if (!Object.keys(changes).length) return;
  if (isWaitingForFirebase() && !offlineChanges.added.has(tokenId)) offlineChanges.patched.add(tokenId);
  broadcastMessage({ type: "tokenPatch", tokenId, changes, sourceRole: TOKEN_SOURCE_ROLE });
  firebaseSync?.updateToken(tokenId, changes, TOKEN_SOURCE_ROLE).catch(logFirebaseError);
}

function sendTokenRemove(tokenId) {
  if (!tokenId) return;
  if (isWaitingForFirebase()) {
    offlineChanges.added.delete(tokenId);
    offlineChanges.patched.delete(tokenId);
    offlineChanges.removed.add(tokenId);
  }
  broadcastMessage({ type: "tokenRemove", tokenId, sourceRole: TOKEN_SOURCE_ROLE });
  firebaseSync?.removeToken(tokenId).catch(logFirebaseError);
}

function flushTokenDragSync(tokenId = draggingTokenId, isFinalPosition = false) {
  if (tokenDragSyncTimer !== null) {
    window.clearTimeout(tokenDragSyncTimer);
    tokenDragSyncTimer = null;
  }

  if (!tokenId) return;
  // 拖到一半被 GM 鎖定：中途位置不再送出，只在放開時送最後一筆，GM 會在寬限時間內接受。
  if (getTokenById(tokenId)?.locked && !isFinalPosition) return;
  lastTokenDragSyncAt = Date.now();
  sendTokenPatch(tokenId, ["x", "y"]);
}

function scheduleTokenDragSync(tokenId) {
  if (!tokenId) return;

  const elapsed = Date.now() - lastTokenDragSyncAt;
  if (elapsed >= TOKEN_SYNC_THROTTLE_MS) {
    flushTokenDragSync(tokenId);
    return;
  }

  if (tokenDragSyncTimer === null) {
    tokenDragSyncTimer = window.setTimeout(() => flushTokenDragSync(tokenId), TOKEN_SYNC_THROTTLE_MS - elapsed);
  }
}

function flushTokenControlSync(tokenId, keys) {
  if (tokenControlSyncTimer !== null) {
    window.clearTimeout(tokenControlSyncTimer);
    tokenControlSyncTimer = null;
  }

  scheduleSceneCache();
  if (tokenId && !getTokenById(tokenId)?.locked) sendTokenPatch(tokenId, keys);
}

function scheduleTokenControlSync(tokenId, keys) {
  window.clearTimeout(tokenControlSyncTimer);
  tokenControlSyncTimer = window.setTimeout(() => flushTokenControlSync(tokenId, keys), CONTROL_SYNC_DEBOUNCE_MS);
}

function clampTokenPosition(x, y) {
  // 地圖載入前 canvas 是預設的 300×150，這時夾座標會把所有 token 擠到左上角。
  if (!hasMap || !mapCanvas.width || !mapCanvas.height) return { x, y };
  return { x: clamp(x, 0, mapCanvas.width), y: clamp(y, 0, mapCanvas.height) };
}

function setTokenPanelOpen(open) {
  if (!tokenPanel || !tokenSettingsBtn) return;
  tokenPanel.hidden = !open;
  tokenSettingsBtn.setAttribute("aria-expanded", String(open));
  tokenSettingsBtn.classList.toggle("active", open);
}

function updateTokenControls() {
  const selected = getSelectedToken();
  if (tokenSelect) {
    tokenSelect.replaceChildren();
    tokenCollectionState.tokens.forEach((token, index) => {
      const option = document.createElement("option");
      option.value = token.id; option.textContent = `${token.locked ? "🔒 " : ""}${token.name || `Token ${index + 1}`}`; tokenSelect.append(option);
    });
    tokenSelect.disabled = !selected;
    if (selected) tokenSelect.value = selected.id;
  }
  // 鎖定的 token 玩家完全不能操作。
  const editable = Boolean(selected && !selected.locked);
  if (tokenSize) { tokenSize.disabled = !editable; tokenSize.value = Math.round(selected?.size ?? TOKEN_DEFAULT_SIZE); }
  if (tokenSizeValue) tokenSizeValue.textContent = `${Math.round(selected?.size ?? TOKEN_DEFAULT_SIZE)}px`;
  tokenSquareBtn?.classList.toggle("active", selected?.shape === "square");
  tokenHexBtn?.classList.toggle("active", selected?.shape === "hex");
  if (tokenSquareBtn) tokenSquareBtn.disabled = !editable;
  if (tokenHexBtn) tokenHexBtn.disabled = !editable;
  if (tokenClearBtn) tokenClearBtn.disabled = !editable;
  tokenSettingsBtn?.classList.toggle("active", !tokenPanel?.hidden || tokenCollectionState.tokens.length > 0);
  if (tokenStatus) {
    tokenStatus.textContent = !selected
      ? "尚未上傳 token"
      : (selected.locked ? "這個 token 已被 GM 鎖定，無法移動或修改" : `共 ${tokenCollectionState.tokens.length} 個 token；拖曳可同步位置`);
  }
}

function safeCssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

// 圖片還沒載入時先畫空白 token，等本機暫存或 Firebase 取回後再補上。
const tokenImageRequests = new Set();

function getTokenImageUrl(token) {
  const url = imageStore.peek(token.imageHash);
  if (!url && token.imageHash && !tokenImageRequests.has(token.imageHash)) {
    tokenImageRequests.add(token.imageHash);
    imageStore.get(token.imageHash).then((loaded) => {
      tokenImageRequests.delete(token.imageHash);
      if (loaded) renderTokens();
    });
  }
  return url;
}

function renderTokens() {
  if (!tokenLayer) return;
  const visibleIds = new Set();
  const canShowLayer = Boolean(hasMap && tokenCollectionState.tokens.some((t) => t.visible && t.imageHash));
  tokenLayer.hidden = !canShowLayer;
  for (const token of tokenCollectionState.tokens) {
    if (!(hasMap && token.visible && token.imageHash)) continue;
    visibleIds.add(token.id);
    let element = tokenLayer.querySelector(`[data-token-id="${safeCssEscape(token.id)}"]`);
    if (!element) {
      element = document.createElement("div");
      element.className = "map-token square";
      element.dataset.tokenId = token.id;
      // tokenLayer 本身使用 pointer-events:none；玩家頁面必須直接把 pointerdown
      // 綁在每顆 token 上，不能只依賴事件委派。
      element.addEventListener("pointerdown", beginTokenDrag);
      const image = document.createElement("img");
      image.alt = "";
      element.append(image);
      tokenLayer.append(element);
    }
    const imageUrl = getTokenImageUrl(token);
    const image = element.querySelector("img"); if (image && imageUrl && image.src !== imageUrl) image.src = imageUrl;
    element.style.width = `${token.size}px`; element.style.height = `${token.size}px`;
    element.style.transform = `translate(${token.x - token.size / 2}px, ${token.y - token.size / 2}px) rotate(var(--token-rotation, 0deg))`;
    element.title = token.name;
    element.classList.toggle("square", token.shape === "square"); element.classList.toggle("hex", token.shape === "hex");
    element.classList.toggle("selected", token.id === tokenCollectionState.selectedTokenId);
    element.classList.toggle("locked", token.locked);
  }
  tokenLayer.querySelectorAll(".map-token").forEach((el) => { if (!visibleIds.has(el.dataset.tokenId)) el.remove(); });
  updateTokenControls();
}

function setTokenCollectionState(nextState, options = {}) {
  tokenCollectionState = options.merge ? mergeTokenCollectionState(nextState) : normalizeTokenCollectionState(nextState);
  if (options.clampPosition !== false) tokenCollectionState.tokens = tokenCollectionState.tokens.map((t) => ({ ...t, ...clampTokenPosition(t.x, t.y) }));
  renderTokens();
  // 玩家暫存只給自己的畫面還原用，收到的變化也一起記下。
  scheduleSceneCache();
}

function setTokenState(nextState, options = {}) {
  const selected = getSelectedToken(); if (!selected || selected.locked) return;
  protectLocalToken(selected.id);
  const updated = normalizeTokenState({ ...selected, ...nextState });
  setTokenCollectionState({ tokens: tokenCollectionState.tokens.map((t) => t.id === selected.id ? updated : t), selectedTokenId: selected.id }, options);
  if (options.sync !== false) sendTokenPatch(selected.id, Object.keys(nextState));
}

function selectToken(tokenId) {
  if (!tokenCollectionState.tokens.some((t) => t.id === tokenId)) return;
  setTokenCollectionState({ ...tokenCollectionState, selectedTokenId: tokenId }, { sync: false, persist: false });
}

function removeSelectedToken() {
  const selected = getSelectedToken(); if (!selected || selected.locked) return;
  const tokens = tokenCollectionState.tokens.filter((t) => t.id !== selected.id);
  setTokenCollectionState({ tokens, selectedTokenId: tokens[0]?.id || null });
  sendTokenRemove(selected.id);
}

function loadTokenFromFile(file) {
  if (!file) return;
  if (tokenStatus) tokenStatus.textContent = "正在處理 token 圖片…";
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const imageDataUrl = await window.MapFogImageProcessing.createCenteredTokenDataUrl(event.target.result);
      const center = clampTokenPosition(mapCanvas.width / 2, mapCanvas.height / 2);
      const token = normalizeTokenState({ imageHash: rememberNewImage(imageDataUrl), visible: true, x: center.x, y: center.y, order: Date.now() });
      setTokenCollectionState({ tokens: [...tokenCollectionState.tokens, token], selectedTokenId: token.id });
      sendTokenAdd(getTokenById(token.id));
    } catch (error) {
      console.error("[Token upload]", error);
      if (tokenStatus) tokenStatus.textContent = "圖片上傳失敗，請改用 PNG、JPG 或 WebP";
    }
  };
  reader.onerror = () => { if (tokenStatus) tokenStatus.textContent = "讀取圖片失敗"; };
  reader.readAsDataURL(file);
}

function eventToCanvasPoint(event) {
  const rect = viewport.getBoundingClientRect();
  const visualX = (event.clientX - rect.left - offsetX) / scale;
  const visualY = (event.clientY - rect.top - offsetY) / scale;
  const width = fogCanvas.width;
  const height = fogCanvas.height;

  if (viewRotation === 90) {
    return { x: visualY, y: height - visualX };
  }

  if (viewRotation === 180) {
    return { x: width - visualX, y: height - visualY };
  }

  if (viewRotation === 270) {
    return { x: width - visualY, y: visualX };
  }

  return { x: visualX, y: visualY };
}

function beginTokenDrag(event) {
  const element = event.target.closest?.(".map-token");
  if (!element || !hasMap || event.button > 0) return;

  const token = tokenCollectionState.tokens.find((t) => t.id === element.dataset.tokenId);
  if (!token || token.locked) return;

  // 玩家頁面同時支援拖曳地圖。Token 開始拖曳時必須明確取消地圖平移，
  // 並由 token 本身取得 pointer capture，否則部分手機瀏覽器會把後續事件交給 viewport。
  event.preventDefault();
  event.stopPropagation();
  isPanning = false;
  viewport.classList.remove("panning");

  draggingTokenId = token.id;
  protectLocalToken(token.id);
  tokenCollectionState.selectedTokenId = token.id;
  const point = eventToCanvasPoint(event);
  tokenDragOffsetX = point.x - token.x;
  tokenDragOffsetY = point.y - token.y;

  element.classList.add("dragging");
  try { element.setPointerCapture?.(event.pointerId); } catch { /* unsupported/ended pointer */ }
  renderTokens();
}

function moveTokenDrag(event) {
  if (!draggingTokenId) return;
  event.preventDefault();
  event.stopPropagation();

  const point = eventToCanvasPoint(event);
  const pos = clampTokenPosition(point.x - tokenDragOffsetX, point.y - tokenDragOffsetY);
  const tokens = tokenCollectionState.tokens.map((token) => token.id === draggingTokenId
    ? { ...token, x: roundCanvasValue(pos.x), y: roundCanvasValue(pos.y) }
    : token);
  setTokenCollectionState(
    { tokens, selectedTokenId: draggingTokenId },
    { persist: false, sync: false }
  );
  protectLocalToken(draggingTokenId);
  scheduleTokenDragSync(draggingTokenId);
}

function endTokenDrag(event) {
  if (!draggingTokenId) return;
  event.preventDefault();
  event.stopPropagation();

  const tokenId = draggingTokenId;
  const element = tokenLayer?.querySelector(`[data-token-id="${safeCssEscape(tokenId)}"]`);
  element?.classList.remove("dragging");
  try { element?.releasePointerCapture?.(event.pointerId); } catch { /* pointer capture already released */ }

  draggingTokenId = null;
  protectLocalToken(tokenId);
  scheduleSceneCache();
  // 確保放開時再送出一次最終位置，即使最後一個 pointermove 沒有成功送出。
  flushTokenDragSync(tokenId, true);
}

function stopUiPointerEvent(event) {
  event.stopPropagation();
}

function createViewState() {
  return {
    viewRotation,
    scale,
    offsetX,
    offsetY
  };
}

function readStoredViewState() {
  try {
    const raw = localStorage.getItem(PLAYER_VIEW_STATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistViewState() {
  if (!hasMap) return;

  try {
    localStorage.setItem(PLAYER_VIEW_STATE_STORAGE_KEY, JSON.stringify(createViewState()));
  } catch {
    // View state is local-only; failing to save should not affect live play.
  }
}

function scheduleViewStatePersist() {
  if (!hasMap) return;

  window.clearTimeout(viewStatePersistTimer);
  viewStatePersistTimer = window.setTimeout(persistViewState, VIEW_STATE_PERSIST_DELAY_MS);
}

function applyStoredViewState() {
  const state = readStoredViewState();
  if (!state) return false;

  const nextRotation = Number(state.viewRotation);
  viewRotation = [0, 90, 180, 270].includes(nextRotation) ? nextRotation : 0;
  scale = clamp(Number(state.scale || 1), 0.1, 5);
  offsetX = Number.isFinite(Number(state.offsetX)) ? Number(state.offsetX) : 0;
  offsetY = Number.isFinite(Number(state.offsetY)) ? Number(state.offsetY) : 0;
  applyTransform();
  return true;
}

function applyTransform() {
  const width = mapCanvas.width;
  const height = mapCanvas.height;
  let transform = `matrix(${scale}, 0, 0, ${scale}, ${offsetX}, ${offsetY})`;

  if (viewRotation === 90) {
    transform = `matrix(0, ${scale}, ${-scale}, 0, ${offsetX + height * scale}, ${offsetY})`;
  }

  if (viewRotation === 180) {
    transform = `matrix(${-scale}, 0, 0, ${-scale}, ${offsetX + width * scale}, ${offsetY + height * scale})`;
  }

  if (viewRotation === 270) {
    transform = `matrix(0, ${-scale}, ${scale}, 0, ${offsetX}, ${offsetY + width * scale})`;
  }

  canvasHolder.style.transform = transform;
  // Counter-rotate around each token's center while its position follows the map.
  canvasHolder.style.setProperty("--token-rotation", `${-viewRotation}deg`);
  scheduleViewStatePersist();
}

function getViewDimensions() {
  const rotatedSideways = viewRotation === 90 || viewRotation === 270;
  return {
    width: rotatedSideways ? mapCanvas.height : mapCanvas.width,
    height: rotatedSideways ? mapCanvas.width : mapCanvas.height
  };
}

function setCanvasSize(width, height) {
  mapCanvas.width = width;
  mapCanvas.height = height;
  gridCanvas.width = width;
  gridCanvas.height = height;
  fogCanvas.width = width;
  fogCanvas.height = height;
  mapCanvas.style.width = `${width}px`;
  mapCanvas.style.height = `${height}px`;
  gridCanvas.style.width = `${width}px`;
  gridCanvas.style.height = `${height}px`;
  fogCanvas.style.width = `${width}px`;
  fogCanvas.style.height = `${height}px`;
  canvasHolder.style.width = `${width}px`;
  canvasHolder.style.height = `${height}px`;
}

function centerMap() {
  if (!hasMap) return;
  const dims = getViewDimensions();
  offsetX = (viewport.clientWidth - dims.width * scale) / 2;
  offsetY = (viewport.clientHeight - dims.height * scale) / 2;
  applyTransform();
}

function fitToViewport() {
  if (!hasMap) return;
  const dims = getViewDimensions();
  scale = clamp(Math.min(viewport.clientWidth / dims.width, viewport.clientHeight / dims.height), 0.1, 5);
  centerMap();
}

function setScale(nextScale, centerClientX = null, centerClientY = null) {
  if (!hasMap) return;
  const oldScale = scale;
  scale = clamp(nextScale, 0.1, 5);

  if (centerClientX !== null && centerClientY !== null) {
    const rect = viewport.getBoundingClientRect();
    const vx = centerClientX - rect.left;
    const vy = centerClientY - rect.top;
    const contentX = (vx - offsetX) / oldScale;
    const contentY = (vy - offsetY) / oldScale;
    offsetX = vx - contentX * scale;
    offsetY = vy - contentY * scale;
  }

  applyTransform();
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function applySnapshot(snapshot, options = {}) {
  if (!snapshot?.mapDataUrl) return;

  const applySeq = ++snapshotApplySeq;
  const initialWidth = Number(snapshot.width);
  const initialHeight = Number(snapshot.height);
  const mapHash = snapshot.mapHash || imageStore.hash(snapshot.mapDataUrl);
  const canReuseMap = hasMap
    && currentMapHash === mapHash
    && initialWidth === mapCanvas.width
    && initialHeight === mapCanvas.height;
  const mapImage = canReuseMap ? null : await loadImage(snapshot.mapDataUrl);
  if (applySeq !== snapshotApplySeq) return;
  const width = initialWidth || mapImage.naturalWidth;
  const height = initialHeight || mapImage.naturalHeight;

  if (!canReuseMap) {
    // 換了地圖，舊地圖的迷霧進度不再適用，等這張地圖的迷霧狀態送來再套用。
    stopFogBatches();
    fogSync = createEmptyFogSync();
    setCanvasSize(width, height);
    mapCtx.clearRect(0, 0, width, height);
    mapCtx.drawImage(mapImage, 0, 0, width, height);
    currentMapDataUrl = snapshot.mapDataUrl;
    currentMapHash = mapHash;
    mapAdjust?.setMapSource(snapshot.mapDataUrl);
    scheduleLocalImagePrune();
  }

  if (!options.keepGridSettings) setGridSettings(snapshot.gridSettings ?? createDefaultGridSettings());
  fogCtx.clearRect(0, 0, width, height);

  if (snapshot.fogDataUrl) {
    const fogImage = await loadImage(snapshot.fogDataUrl);
    if (applySeq !== snapshotApplySeq) return;
    fogCtx.drawImage(fogImage, 0, 0, width, height);
  } else {
    resetFog();
  }

  hasMap = true;
  canvasHolder.hidden = false;

  if (snapshot.tokenState) {
    setTokenCollectionState(preserveProtectedTokenState(snapshot.tokenState), { sync: false, persist: false });
  } else {
    renderTokens();
  }
  markFogChanged();
  applyPendingRemoteFogSync();

  if (options.restoreView && applyStoredViewState()) return;
  if (canReuseMap && options.preserveView !== false) {
    applyTransform();
    return;
  }
  fitToViewport();
}

function fogStateMatchesCurrentMap(fogState) {
  return Boolean(hasMap)
    && Number(fogState?.width) === fogCanvas.width
    && Number(fogState?.height) === fogCanvas.height;
}

async function applyRemoteFogState(fogState) {
  if (!fogState?.fogDataUrl) return;

  if (applyingRemoteMapState || !fogStateMatchesCurrentMap(fogState)) {
    pendingRemoteFogState = fogState;
    return;
  }

  const applySeq = ++snapshotApplySeq;
  const fogImage = await loadImage(fogState.fogDataUrl);
  if (applySeq !== snapshotApplySeq || !fogStateMatchesCurrentMap(fogState)) return;

  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  fogCtx.drawImage(fogImage, 0, 0, fogCanvas.width, fogCanvas.height);
  markFogChanged();
}

// 收到地圖 { hash, width, height }：本機已有同一個雜湊的圖片就直接用，沒有才下載。
async function applyRemoteMapState(mapState, options = {}) {
  if (!mapState?.hash) return;
  // 和畫面上（例如本機暫存）是同一張地圖：不重畫，保留迷霧，只等迷霧進度比對。
  if (hasMap && mapState.hash === currentMapHash
    && Number(mapState.width) === mapCanvas.width && Number(mapState.height) === mapCanvas.height) {
    applyPendingRemoteFogSync();
    return;
  }
  const loadSeq = ++mapLoadSeq;
  const mapDataUrl = await imageStore.get(mapState.hash);
  if (loadSeq !== mapLoadSeq || !mapDataUrl) return;

  const pendingFogMatchesMap = pendingRemoteFogState?.fogDataUrl
    && Number(pendingRemoteFogState.width) === Number(mapState.width)
    && Number(pendingRemoteFogState.height) === Number(mapState.height);
  const fogState = pendingFogMatchesMap ? pendingRemoteFogState : null;
  if (fogState) pendingRemoteFogState = null;

  applyingRemoteMapState = true;
  try {
    await applySnapshot({
      type: "snapshot",
      width: mapState.width,
      height: mapState.height,
      mapHash: mapState.hash,
      mapDataUrl,
      fogDataUrl: fogState?.fogDataUrl || ""
    }, { ...options, keepGridSettings: true });
  } finally {
    applyingRemoteMapState = false;
  }

  if (pendingRemoteFogState) {
    const pendingFog = pendingRemoteFogState;
    pendingRemoteFogState = null;
    await applyRemoteFogState(pendingFog);
  }
}

function applyFogHistoryBase(base) {
  fogCtx.globalCompositeOperation = "source-over";
  fogCtx.globalAlpha = 1;
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);

  if (base !== "revealed") {
    fogCtx.fillStyle = "rgba(0,0,0,1)";
    fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
  }
}

function createEmptyFogSync() {
  return { epoch: "", seq: 0, base: "covered", checkpointHash: "", mapHash: "" };
}

function paintFogBase(base, checkpointImage = null) {
  if (base === "checkpoint" && checkpointImage) {
    fogCtx.globalCompositeOperation = "source-over";
    fogCtx.globalAlpha = 1;
    fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
    fogCtx.drawImage(checkpointImage, 0, 0, fogCanvas.width, fogCanvas.height);
    return;
  }
  applyFogHistoryBase(base === "revealed" ? "revealed" : "covered");
}

// 收到 Firebase 的迷霧狀態 { epoch, base, checkpointHash, mapHash }：
// 同一個 epoch 只要接著讀之後的擦霧；epoch 不同代表 GM 重設、全開或壓縮過，要從底圖重畫。
async function applyRemoteFogSync(remoteFog) {
  if (!remoteFog?.epoch) return;
  if (!hasMap || remoteFog.mapHash !== currentMapHash) {
    pendingRemoteFogSync = remoteFog;
    return;
  }
  pendingRemoteFogSync = null;
  if (remoteFog.epoch === fogSync.epoch) {
    listenFogBatches();
    return;
  }

  const applySeq = ++fogSyncApplySeq;
  let checkpointImage = null;
  if (remoteFog.base === "checkpoint") {
    const dataUrl = await imageStore.get(remoteFog.checkpointHash);
    checkpointImage = dataUrl ? await loadImage(dataUrl) : null;
    if (applySeq !== fogSyncApplySeq || remoteFog.mapHash !== currentMapHash) return;
  }

  stopFogBatches();
  paintFogBase(remoteFog.base, checkpointImage);
  fogSync = {
    epoch: remoteFog.epoch,
    seq: 0,
    base: remoteFog.base,
    checkpointHash: remoteFog.checkpointHash || "",
    mapHash: remoteFog.mapHash
  };
  markFogChanged();
  listenFogBatches();
}

function applyPendingRemoteFogSync() {
  if (!pendingRemoteFogSync) return;
  applyRemoteFogSync(pendingRemoteFogSync).catch((error) => console.error("[MapFog Firebase]", error));
}

// 從目前進度之後開始聽擦霧紀錄；斷線再久，重新連線後 Firebase 會把漏掉的依序補上。
function listenFogBatches() {
  if (!IS_FIREBASE_ROOM || !firebaseSync || !fogSync.epoch || fogBatchListenEpoch === fogSync.epoch) return;
  stopFogBatches();
  const epoch = fogSync.epoch;
  fogBatchListenEpoch = epoch;
  stopFogBatchListener = firebaseSync.onFogBatches(epoch, fogSync.seq, (seq, strokes) => {
    if (fogSync.epoch !== epoch || seq <= fogSync.seq) return;
    fogSync.seq = seq;
    drawBatch(strokes);
  });
}

function stopFogBatches() {
  stopFogBatchListener?.();
  stopFogBatchListener = null;
  fogBatchListenEpoch = "";
}

function resetFog() {
  if (!hasMap && !mapCanvas.width) return;
  fogCtx.globalCompositeOperation = "source-over";
  fogCtx.globalAlpha = 1;
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  fogCtx.fillStyle = "rgba(0,0,0,1)";
  fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);
}

function revealAllFog() {
  if (!hasMap) return;
  fogCtx.globalCompositeOperation = "source-over";
  fogCtx.globalAlpha = 1;
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
}

function drawAt(x, y, stroke) {
  if (!hasMap) return;
  const radius = Number(stroke.brushSize) / 2;
  const useSoftBrush = stroke.softBrush !== false;

  fogCtx.save();
  fogCtx.beginPath();
  fogCtx.arc(x, y, radius, 0, Math.PI * 2);

  if (stroke.mode === "erase") {
    fogCtx.globalCompositeOperation = "destination-out";
  } else {
    fogCtx.globalCompositeOperation = "source-over";
  }

  if (useSoftBrush) {
    const gradient = fogCtx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, "rgba(0,0,0,1)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    fogCtx.fillStyle = gradient;
    fogCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  } else {
    fogCtx.fillStyle = "rgba(0,0,0,1)";
    fogCtx.fill();
  }

  fogCtx.restore();
}

function drawRectFog(stroke) {
  if (!hasMap) return;

  const rawX = Number(stroke.x) || 0;
  const rawY = Number(stroke.y) || 0;
  const rawRight = rawX + (Number(stroke.width) || 0);
  const rawBottom = rawY + (Number(stroke.height) || 0);
  const left = clamp(Math.min(rawX, rawRight), 0, fogCanvas.width);
  const top = clamp(Math.min(rawY, rawBottom), 0, fogCanvas.height);
  const right = clamp(Math.max(rawX, rawRight), 0, fogCanvas.width);
  const bottom = clamp(Math.max(rawY, rawBottom), 0, fogCanvas.height);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) return;

  fogCtx.save();
  fogCtx.globalAlpha = 1;
  fogCtx.globalCompositeOperation = stroke.mode === "erase" ? "destination-out" : "source-over";
  fogCtx.fillStyle = "rgba(0,0,0,1)";
  fogCtx.fillRect(left, top, width, height);
  fogCtx.restore();
}

function drawBatch(strokes) {
  if (!Array.isArray(strokes)) return;

  for (const stroke of strokes) {
    if (stroke?.type === "rect") {
      drawRectFog(stroke);
    } else {
      drawAt(stroke.x, stroke.y, stroke);
    }
  }
  markFogChanged();
}

function rotateViewClockwise() {
  if (!hasMap) return;
  viewRotation = (viewRotation + 90) % 360;
  fitToViewport();
}

function beginPan(clientX, clientY, pointerId = null) {
  if (!hasMap) return;
  isPanning = true;
  lastPanX = clientX;
  lastPanY = clientY;
  viewport.classList.add("panning");
  if (pointerId !== null) viewport.setPointerCapture?.(pointerId);
}

function movePan(clientX, clientY) {
  if (!isPanning) return;
  offsetX += clientX - lastPanX;
  offsetY += clientY - lastPanY;
  lastPanX = clientX;
  lastPanY = clientY;
  applyTransform();
}

function endPan(pointerId = null) {
  isPanning = false;
  viewport.classList.remove("panning");
  if (pointerId !== null) viewport.releasePointerCapture?.(pointerId);
}

function touchDistance(t1, t2) {
  return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
}

function touchMidpoint(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2
  };
}

syncChannel?.addEventListener("message", (event) => {
  const message = event.data;
  if (!message) return;

  imageStore.rememberAll(message.images);
  // token 的新增、變更、刪除不論來自 GM 或其他玩家畫面都要套用；其餘訊息只聽 GM 的。
  if (message.type === "tokenAdd") applyIncomingTokenEvent({ kind: "add", token: message.token, sourceRole: message.sourceRole });
  if (message.type === "tokenPatch") applyIncomingTokenEvent({ kind: "patch", tokenId: message.tokenId, changes: message.changes, sourceRole: message.sourceRole });
  if (message.type === "tokenRemove") applyIncomingTokenEvent({ kind: "remove", tokenId: message.tokenId, sourceRole: message.sourceRole });
  if (message.source !== "gm") return;

  if (message.type === "snapshot") applySnapshot(message);
  if (message.type === "mapUpdate") applyRemoteMapState(message, { restoreView: !hasMap }).catch((error) => console.error("[MapFog sync]", error));
  if (message.type === "fogUpdate") applyRemoteFogState(message).catch((error) => console.error("[MapFog sync]", error));
  if (message.type === "draw") drawAt(message.x, message.y, message);
  if (message.type === "drawBatch") drawBatch(message.strokes);
  if (message.type === "resetFog") {
    resetFog();
    markFogChanged();
  }
  if (message.type === "revealAllFog") {
    revealAllFog();
    markFogChanged();
  }
  if (message.type === "gridUpdate") setGridSettings(message.gridSettings);
  if (message.type === "tokenState") applyIncomingTokenEvent({ kind: "state", tokenState: message.tokenState });
  if (message.type === "roomCacheCleared") reloadWithoutPersist();
});

controlChannel?.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.source !== "gm") return;

  if (message.type === "switchRoom") switchToOfflineRoom(message.olroom);
  if (message.type === "olroomCachesCleared" && IS_OFFLINE_ROOM) reloadWithoutPersist();
});

function reloadWithoutPersist() {
  suppressBeforeUnloadPersist = true;
  window.location.reload();
}

function switchToOfflineRoom(olroom) {
  const nextRoom = typeof olroom === "string" ? olroom : "";
  if (nextRoom === OFFLINE_ROOM_ID) return;

  const url = new URL(window.location.href);
  if (nextRoom) url.searchParams.set("olroom", nextRoom);
  else url.searchParams.delete("olroom");
  window.location.href = url.toString();
}

function applyIncomingTokenState(tokenState) {
  const nextState = { ...preserveProtectedTokenState(tokenState), selectedTokenId: tokenCollectionState.selectedTokenId };
  setTokenCollectionState(nextState, { persist: false, merge: true });
}

function replaceLocalToken(tokenId, nextToken) {
  const tokens = tokenCollectionState.tokens.map((token) => token.id === tokenId ? nextToken : token);
  setTokenCollectionState({ tokens, selectedTokenId: tokenCollectionState.selectedTokenId }, { persist: false });
}

function addIncomingToken(token) {
  if (!token?.id || !token.imageHash) return;
  const existing = getTokenById(token.id);
  const incoming = normalizeTokenState({ ...(existing || {}), ...token });
  if (existing) {
    // 正在拖曳或調整的 token 保留本機的位置與外觀。
    replaceLocalToken(token.id, getProtectedTokenId() === token.id ? { ...incoming, ...pickTokenGeometry(existing) } : incoming);
    return;
  }
  setTokenCollectionState({ tokens: [...tokenCollectionState.tokens, incoming], selectedTokenId: tokenCollectionState.selectedTokenId }, { persist: false });
}

function patchIncomingToken(tokenId, changes, sourceRole) {
  const existing = getTokenById(tokenId);
  // 已刪除的 token 不接受晚到的變更，避免被救回來。
  if (!existing) return;
  const accepted = pickTokenFields(changes || {}, TOKEN_SYNC_KEYS);
  // GM 對鎖定 token 的變更（包含把玩家的修改改回去）一定要套用，不受本機拖曳保護影響。
  const isGmLockedChange = sourceRole === "gm" && (accepted.locked ?? existing.locked);
  if (getProtectedTokenId() === tokenId && !isGmLockedChange) {
    for (const key of TOKEN_GEOMETRY_KEYS) delete accepted[key];
  }
  if (!Object.keys(accepted).length) return;
  replaceLocalToken(tokenId, normalizeTokenState({ ...existing, ...accepted }));
}

function removeIncomingToken(tokenId) {
  if (!getTokenById(tokenId)) return;
  if (draggingTokenId === tokenId) draggingTokenId = null;
  const tokens = tokenCollectionState.tokens.filter((token) => token.id !== tokenId);
  const selectedTokenId = tokenCollectionState.selectedTokenId === tokenId ? (tokens[0]?.id || null) : tokenCollectionState.selectedTokenId;
  setTokenCollectionState({ tokens, selectedTokenId }, { persist: false });
}

function applyIncomingTokenEvent(event) {
  if (localRestorePending) {
    queuedTokenUpdates.push(event);
    return;
  }
  if (event.kind === "state") applyIncomingTokenState(event.tokenState);
  if (event.kind === "add") addIncomingToken(event.token);
  if (event.kind === "patch") patchIncomingToken(event.tokenId, event.changes, event.sourceRole);
  if (event.kind === "remove") removeIncomingToken(event.tokenId);
}

function flushQueuedTokenUpdates() {
  localRestorePending = false;
  const updates = queuedTokenUpdates;
  queuedTokenUpdates = [];
  for (const update of updates) applyIncomingTokenEvent(update);
}

// 地圖、迷霧與 token 存在 IndexedDB，不會觸發 storage 事件；只有格線還能走 localStorage 備援。
if (!syncChannel) {
  window.addEventListener("storage", (event) => {
    if (IS_FIREBASE_ROOM) return;

    try {
      if (event.key === SHARED_GRID_STORAGE_KEY && event.newValue) {
        setGridSettings(JSON.parse(event.newValue), { cache: false });
      }
    } catch {
      // Ignore malformed fallback state.
    }
  });
}

// 暫存畫面裡有、Firebase 上已被刪除的 token 直接移除。
function removeTokensMissingFromRoom(tokenIds) {
  const present = new Set(tokenIds);
  const tokens = tokenCollectionState.tokens.filter((token) => present.has(token.id));
  if (tokens.length === tokenCollectionState.tokens.length) return;
  const selectedTokenId = tokens.some((token) => token.id === tokenCollectionState.selectedTokenId)
    ? tokenCollectionState.selectedTokenId
    : (tokens[0]?.id || null);
  setTokenCollectionState({ tokens, selectedTokenId });
}

async function discardRoomCacheAndReload() {
  suppressBeforeUnloadPersist = true;
  await localStore?.removeByPrefix(LOCAL_CACHE_PREFIX);
  window.location.reload();
}

function attachFirebaseSync(sync) {
  firebaseSync = sync;
  // 本機沒有的圖片才向 Firebase 的 images/{雜湊} 下載。
  imageStore.setRemoteFetcher(sync.getImage);
  flushOfflineChanges();
  listenFogBatches();

  sync.onMapState?.((mapState) => {
    // 暫存裡有地圖，Firebase 上卻沒有：GM 已清除這個房間，暫存也跟著清掉。
    if (!mapState && hasMap) {
      discardRoomCacheAndReload();
      return;
    }
    applyRemoteMapState(mapState, { restoreView: !hasMap }).catch((error) => console.error("[MapFog Firebase]", error));
  });

  sync.onFogState((remoteFog) => {
    applyRemoteFogSync(remoteFog).catch((error) => console.error("[MapFog Firebase]", error));
  });

  sync.onGridSettings((nextGridSettings) => {
    setGridSettings(nextGridSettings);
  });

  sync.onTokenEvents({
    onAdd: (token, meta) => applyIncomingTokenEvent({ kind: "add", token, ...meta }),
    onPatch: (tokenId, changes, meta) => applyIncomingTokenEvent({ kind: "patch", tokenId, changes, ...meta }),
    onRemove: (tokenId) => applyIncomingTokenEvent({ kind: "remove", tokenId }),
    onInitialSync: removeTokensMissingFromRoom
  });
}

toolbarToggleBtn?.addEventListener("click", () => {
  floatingToolbar?.classList.toggle("collapsed");
  const collapsed = floatingToolbar?.classList.contains("collapsed");
  toolbarToggleBtn.title = collapsed ? "展開工具列" : "收合工具列";
  toolbarToggleBtn.setAttribute("aria-label", collapsed ? "展開工具列" : "收合工具列");
  toolbarToggleBtn.setAttribute("aria-expanded", String(!collapsed));
});

tokenSettingsBtn?.addEventListener("click", () => {
  mapAdjust?.setOpen(false);
  setTokenPanelOpen(tokenPanel?.hidden);
});

tokenPanelCloseBtn?.addEventListener("click", () => {
  setTokenPanelOpen(false);
});

tokenUploadBtn?.addEventListener("click", (event) => {
  event.stopPropagation();
  tokenFileInput?.click();
});

tokenFileInput?.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) loadTokenFromFile(file);
  event.target.value = "";
});

tokenSelect?.addEventListener("change", () => selectToken(tokenSelect.value));

tokenSize?.addEventListener("input", () => {
  const tokenId = getSelectedToken()?.id || null;
  setTokenState({ size: Number(tokenSize.value) }, { sync: false, persist: false });
  scheduleTokenControlSync(tokenId, ["size"]);
});

tokenSize?.addEventListener("change", () => {
  const tokenId = getSelectedToken()?.id || null;
  setTokenState({ size: Number(tokenSize.value) }, { sync: false, persist: false });
  flushTokenControlSync(tokenId, ["size"]);
});

tokenSquareBtn?.addEventListener("click", () => {
  setTokenState({ shape: "square" });
});

tokenHexBtn?.addEventListener("click", () => {
  setTokenState({ shape: "hex" });
});

tokenClearBtn?.addEventListener("click", () => {
  removeSelectedToken();
});

// 每顆 token 在建立時直接綁定 pointerdown；window 接手後續移動與放開事件。
window.addEventListener("pointermove", moveTokenDrag, { capture: true, passive: false });
window.addEventListener("pointerup", endTokenDrag, { capture: true, passive: false });
window.addEventListener("pointercancel", endTokenDrag, { capture: true, passive: false });

for (const surface of [toolbarToggleBtn, floatingToolbar, tokenPanel]) {
  surface?.addEventListener("pointerdown", stopUiPointerEvent);
  surface?.addEventListener("pointermove", stopUiPointerEvent);
  surface?.addEventListener("pointerup", stopUiPointerEvent);
}

viewport.addEventListener("pointerdown", (event) => {
  if (draggingTokenId || event.target.closest?.("button,input,.floating-toolbar,.token-panel")) return;
  if (event.button === 2) {
    event.preventDefault();
    beginPan(event.clientX, event.clientY, event.pointerId);
    return;
  }
  if (event.button !== 0 || event.target.closest?.(".map-token")) return;
  beginPan(event.clientX, event.clientY, event.pointerId);
});
viewport.addEventListener("pointermove", (event) => {
  if (!draggingTokenId) movePan(event.clientX, event.clientY);
});
viewport.addEventListener("pointerup", (event) => {
  if (!draggingTokenId) endPan(event.pointerId);
});
viewport.addEventListener("pointercancel", (event) => {
  if (!draggingTokenId) endPan(event.pointerId);
});
viewport.addEventListener("pointerleave", (event) => {
  if (!draggingTokenId) endPan(event.pointerId);
});
viewport.addEventListener("contextmenu", (event) => event.preventDefault());
rotateBtn.addEventListener("click", rotateViewClockwise);
viewport.addEventListener("wheel", (event) => {
  if (!hasMap) return;
  event.preventDefault();
  setScale(scale * (event.deltaY < 0 ? 1.1 : 0.9), event.clientX, event.clientY);
}, { passive: false });

viewport.addEventListener("touchstart", (event) => {
  if (!hasMap || event.touches.length !== 2) return;
  event.preventDefault();
  pinchStartDistance = touchDistance(event.touches[0], event.touches[1]);
  pinchStartScale = scale;
  pinchMidStart = touchMidpoint(event.touches[0], event.touches[1]);
  pinchStartOffset = { x: offsetX, y: offsetY };
}, { passive: false });

viewport.addEventListener("touchmove", (event) => {
  if (!hasMap || event.touches.length !== 2 || !pinchStartDistance) return;
  event.preventDefault();
  const nextDistance = touchDistance(event.touches[0], event.touches[1]);
  scale = clamp(pinchStartScale * (nextDistance / pinchStartDistance), 0.1, 5);
  const mid = touchMidpoint(event.touches[0], event.touches[1]);
  offsetX = pinchStartOffset.x + mid.x - pinchMidStart.x;
  offsetY = pinchStartOffset.y + mid.y - pinchMidStart.y;
  applyTransform();
}, { passive: false });

viewport.addEventListener("touchend", () => {
  pinchStartDistance = null;
  pinchMidStart = null;
  pinchStartOffset = null;
});

window.addEventListener("resize", () => {
  if (hasMap) fitToViewport();
});

// iPad Safari 關閉分頁時常常不觸發 beforeunload，改用 pagehide 與切到背景時立刻寫入暫存。
function persistBeforeLeaving() {
  if (suppressBeforeUnloadPersist) return;
  window.clearTimeout(sceneCacheTimer);
  sceneCacheTimer = null;
  writeSceneCache(true);
  if (hasMap) persistViewState();
}

window.addEventListener("pagehide", persistBeforeLeaving);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") persistBeforeLeaving();
});

updateTokenControls();
setTokenPanelOpen(false);

async function readNewestScene() {
  const own = await localStore.get(SCENE_CACHE_KEY);
  const gm = await localStore.get(GM_SCENE_CACHE_KEY);
  restoreOfflineChanges(own?.offlineChanges);
  if (!gm?.map) return own;
  if (!own?.map) return gm;
  return Number(gm.savedAt) > Number(own.savedAt) ? gm : own;
}

// 開頁時先立刻顯示本機暫存畫面；完成後才連上 GM／Firebase，讓最新狀態蓋在暫存之上。
async function restoreLocalState() {
  if (!localStore) return;
  const scene = await readNewestScene();
  if (!scene) return;

  const mapDataUrl = await imageStore.getLocal(scene.map?.hash);
  if (!mapDataUrl) {
    if (Array.isArray(scene.tokens)) setTokenCollectionState({ tokens: scene.tokens }, { sync: false });
    return;
  }

  const fogMatchesMap = scene.fog?.dataUrl
    && Number(scene.fog.width) === Number(scene.map.width)
    && Number(scene.fog.height) === Number(scene.map.height);
  await applySnapshot({
    type: "snapshot",
    width: scene.map.width,
    height: scene.map.height,
    mapHash: scene.map.hash,
    mapDataUrl,
    fogDataUrl: fogMatchesMap ? scene.fog.dataUrl : "",
    gridSettings: scene.grid,
    tokenState: { tokens: Array.isArray(scene.tokens) ? scene.tokens : [] }
  }, { restoreView: true });
  if (fogMatchesMap && scene.fog.epoch) {
    const { epoch, seq, base, checkpointHash, mapHash } = scene.fog;
    fogSync = { epoch, seq: Number(seq) || 0, base, checkpointHash: checkpointHash || "", mapHash: mapHash || scene.map.hash };
    fogCacheDataUrl = scene.fog.dataUrl;
    fogCacheDirty = false;
  }
  window.dispatchEvent(new CustomEvent("mapfog:cache-shown"));
}

if (IS_FIREBASE_ROOM) window.MapFogImageStore.cleanIdleRoomCaches(LOCAL_CACHE_PREFIX).catch((error) => console.error("[MapFog 暫存]", error));

// 先顯示本機暫存，再向 GM 要最新狀態，讓 GM 的回覆一定蓋在暫存之上。
restoreLocalState()
  .catch((error) => console.error("[MapFog restore]", error))
  .finally(() => {
    flushQueuedTokenUpdates();
    scheduleLocalImagePrune();
    whenFirebaseReady(attachFirebaseSync);
    syncChannel?.postMessage({ type: "requestSnapshot", source: "player" });
  });
