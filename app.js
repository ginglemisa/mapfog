const fileInput = document.getElementById("fileInput");
const brushSize = document.getElementById("brushSize");
const brushSizeValue = document.getElementById("brushSizeValue");
const zoomRange = document.getElementById("zoomRange");
const zoomValue = document.getElementById("zoomValue");
const resetFogBtn = document.getElementById("resetFogBtn");
const revealAllFogBtn = document.getElementById("revealAllFogBtn");
const toggleFogBtn = document.getElementById("toggleFogBtn");
const rectFogBtn = document.getElementById("rectFogBtn");
const softBrush = { checked: true };
const panModeBtn = document.getElementById("panModeBtn");
const rotateBtn = document.getElementById("rotateBtn");
const fitBtn = document.getElementById("fitBtn");
const actualBtn = document.getElementById("actualBtn");
const centerBtn = document.getElementById("centerBtn");
const modeNote = document.getElementById("modeNote");
const controlsPanel = document.getElementById("controlsPanel");
const controlsCollapseBtn = document.getElementById("controlsCollapseBtn");
const floatingToolbar = document.getElementById("floatingToolbar");
const toolbarToggleBtn = document.getElementById("toolbarToggleBtn");
const gridSettingsBtn = document.getElementById("gridSettingsBtn");
const gridPanel = document.getElementById("gridPanel");
const gridPanelCloseBtn = document.getElementById("gridPanelCloseBtn");
const gridEnabled = document.getElementById("gridEnabled");
const gridSquareBtn = document.getElementById("gridSquareBtn");
const gridHexBtn = document.getElementById("gridHexBtn");
const gridWhiteBtn = document.getElementById("gridWhiteBtn");
const gridBlackBtn = document.getElementById("gridBlackBtn");
const gridOpacity = document.getElementById("gridOpacity");
const gridOpacityValue = document.getElementById("gridOpacityValue");
const gridSize = document.getElementById("gridSize");
const gridSizeValue = document.getElementById("gridSizeValue");
const gridLineWidth = document.getElementById("gridLineWidth");
const gridLineWidthValue = document.getElementById("gridLineWidthValue");
const gridOffsetX = document.getElementById("gridOffsetX");
const gridOffsetXValue = document.getElementById("gridOffsetXValue");
const gridOffsetY = document.getElementById("gridOffsetY");
const gridOffsetYValue = document.getElementById("gridOffsetYValue");
const gridNudgeButtons = document.querySelectorAll("[data-grid-nudge-x], [data-grid-nudge-y]");
const saveGridImageBtn = document.getElementById("saveGridImageBtn");
const saveAdjustedMapBtn = document.getElementById("saveAdjustedMapBtn");
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
const clearCurrentOlroomBtn = document.getElementById("clearCurrentOlroomBtn");
const clearAllOlroomsBtn = document.getElementById("clearAllOlroomsBtn");
const sendPlayersToRoomBtn = document.getElementById("sendPlayersToRoomBtn");

const viewport = document.getElementById("viewport");
const emptyState = document.getElementById("emptyState");
const canvasHolder = document.getElementById("canvasHolder");
const mapCanvas = document.getElementById("mapCanvas");
const gridCanvas = document.getElementById("gridCanvas");
const fogCanvas = document.getElementById("fogCanvas");
const tokenLayer = document.getElementById("tokenLayer");
const rectFogPreview = document.getElementById("rectFogPreview");

const mapCtx = mapCanvas.getContext("2d");
const gridCtx = gridCanvas.getContext("2d");
const fogCtx = fogCanvas.getContext("2d");

let currentImage = null;
let isDrawing = false;
let mode = "erase";
let drawingTool = "brush";
let scale = 1;
let offsetX = 0;
let offsetY = 0;
let viewRotation = 0;
let gridSettings = createDefaultGridSettings();
let currentMapFileName = "map";

let isPanning = false;
let lastPanX = 0;
let lastPanY = 0;
let isPanMode = false;
let rectDrag = null;

let pinchStartDistance = null;
let pinchStartScale = 1;
let pinchMidStart = null;
let pinchStartOffset = null;
let draggingTokenId = null;
let tokenDragOffsetX = 0;
let tokenDragOffsetY = 0;

const CONTROLS_COLLAPSED_STORAGE_KEY = "fogmap.controls.collapsed";
const DEFAULT_SYNC_CHANNEL_NAME = "mapfog.sync.v1";
const CONTROL_CHANNEL_NAME = "mapfog.control.v1";
const DEFAULT_SHARED_STATE_STORAGE_KEY = "mapfog.shared.state";
const DEFAULT_SHARED_MAP_STORAGE_KEY = "mapfog.shared.map.v1";
const DEFAULT_SHARED_FOG_STORAGE_KEY = "mapfog.shared.fog.v1";
const DEFAULT_SHARED_GRID_STORAGE_KEY = "mapfog.shared.grid.v1";
const DEFAULT_TOKEN_STATE_STORAGE_KEY = "mapfog.tokens.state.v2";
const DEFAULT_INITIATIVE_GM_STATE_STORAGE_KEY = "mapfog.initiative.gm.v1";
const DEFAULT_INITIATIVE_PUBLIC_STATE_STORAGE_KEY = "mapfog.initiative.public.v1";
const LEGACY_TOKEN_STATE_STORAGE_KEY = "mapfog.token.state";
const DEFAULT_GM_VIEW_STATE_STORAGE_KEY = "mapfog.view.gm.v1";
const DEFAULT_PLAYER_VIEW_STATE_STORAGE_KEY = "mapfog.view.player.v1";
const DEFAULT_GM_MAP_ADJUST_STORAGE_KEY = "mapfog.mapAdjust.gm.v1";
const DEFAULT_PLAYER_MAP_ADJUST_STORAGE_KEY = "mapfog.mapAdjust.player.v1";
const OLROOM_STORAGE_PREFIX = "mapfog.olroom.";
const DEFAULT_LOCAL_CACHE_KEYS = [
  DEFAULT_SHARED_STATE_STORAGE_KEY,
  DEFAULT_SHARED_MAP_STORAGE_KEY,
  DEFAULT_SHARED_FOG_STORAGE_KEY,
  DEFAULT_SHARED_GRID_STORAGE_KEY,
  DEFAULT_TOKEN_STATE_STORAGE_KEY,
  DEFAULT_INITIATIVE_GM_STATE_STORAGE_KEY,
  DEFAULT_INITIATIVE_PUBLIC_STATE_STORAGE_KEY,
  LEGACY_TOKEN_STATE_STORAGE_KEY,
  DEFAULT_GM_VIEW_STATE_STORAGE_KEY,
  DEFAULT_PLAYER_VIEW_STATE_STORAGE_KEY,
  DEFAULT_GM_MAP_ADJUST_STORAGE_KEY,
  DEFAULT_PLAYER_MAP_ADJUST_STORAGE_KEY
];
const TOKEN_DEFAULT_SIZE = 96;
const TOKEN_MIN_SIZE = 16;
const TOKEN_MAX_SIZE = 800;
const TOKEN_CROP_SIZE = 512;
const CONTROL_SYNC_DEBOUNCE_MS = 300;
const TOKEN_SYNC_THROTTLE_MS = 300;
const SNAPSHOT_PERSIST_DELAY_MS = 1000;
const VIEW_STATE_PERSIST_DELAY_MS = 300;
const LOCAL_TOKEN_PROTECTION_MS = 2000;
const FOG_HISTORY_COMPACT_BATCH_LIMIT = 200;
const queryParams = new URLSearchParams(window.location.search);
const FIREBASE_ROOM_ID = queryParams.get("room") || "";
const FIREBASE_SYNC_MODE = queryParams.get("sync") === "firebase";
const OFFLINE_ROOM_ID = FIREBASE_ROOM_ID || FIREBASE_SYNC_MODE ? "" : (queryParams.get("olroom") || "");
const IS_FIREBASE_ROOM = Boolean(FIREBASE_ROOM_ID || FIREBASE_SYNC_MODE);
const IS_OFFLINE_ROOM = Boolean(OFFLINE_ROOM_ID);
const FIREBASE_ROOM_KEY = sanitizeStorageSegment(FIREBASE_ROOM_ID || "default");
const OFFLINE_ROOM_KEY = sanitizeStorageSegment(OFFLINE_ROOM_ID);
const IS_DEFAULT_LOCAL_PAGE = !IS_FIREBASE_ROOM && !IS_OFFLINE_ROOM;
const STORAGE_PREFIX = IS_FIREBASE_ROOM
  ? `mapfog.room.${FIREBASE_ROOM_KEY}.`
  : (IS_OFFLINE_ROOM ? `${OLROOM_STORAGE_PREFIX}${OFFLINE_ROOM_KEY}.` : "");
const USE_NAMESPACED_STORAGE_KEYS = Boolean(STORAGE_PREFIX);
const SYNC_CHANNEL_NAME = getSyncChannelName();
const SHARED_STATE_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}shared.state.v1` : DEFAULT_SHARED_STATE_STORAGE_KEY;
const SHARED_MAP_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}map.v1` : DEFAULT_SHARED_MAP_STORAGE_KEY;
const SHARED_FOG_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}fog.v1` : DEFAULT_SHARED_FOG_STORAGE_KEY;
const SHARED_GRID_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}grid.v1` : DEFAULT_SHARED_GRID_STORAGE_KEY;
const TOKEN_STATE_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}tokens.v2` : DEFAULT_TOKEN_STATE_STORAGE_KEY;
const GM_VIEW_STATE_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}gmView.v1` : DEFAULT_GM_VIEW_STATE_STORAGE_KEY;
const GM_MAP_ADJUST_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}gmMapAdjust.v1` : DEFAULT_GM_MAP_ADJUST_STORAGE_KEY;
// Firebase room 已經同步一切；同機再走 BroadcastChannel 會讓柔邊擦霧被套用兩次。
const syncChannel = !IS_FIREBASE_ROOM && "BroadcastChannel" in window ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;
// 跨房間的控制訊息（切換玩家房間、清除暫存），不分 olroom。
const controlChannel = !IS_FIREBASE_ROOM && "BroadcastChannel" in window ? new BroadcastChannel(CONTROL_CHANNEL_NAME) : null;
const localStore = window.MapFogLocalStore;
// Display-only adjustment for this GM browser; never broadcast or written into map snapshots.
const mapAdjust = window.MapFogMapAdjust?.create({
  canvas: mapCanvas,
  storageKey: GM_MAP_ADJUST_STORAGE_KEY,
  onOpen: () => {
    setGridPanelOpen(false);
    setTokenPanelOpen(false);
  }
}) ?? null;

let tokenCollectionState = createDefaultTokenCollectionState();
let firebaseSync = null;
let statePersistTimer = null;
let gridPersistTimer = null;
let gridSyncTimer = null;
let tokenDragSyncTimer = null;
let tokenControlSyncTimer = null;
let viewStatePersistTimer = null;
let pendingDrawStrokes = [];
let lastTokenDragSyncAt = 0;
let currentMapDataUrl = "";
let protectedTokenId = null;
let protectedTokenUntil = 0;
let snapshotApplySeq = 0;
let pendingRemoteFogState = null;
let pendingFirebaseFogHistory = null;
let applyingRemoteMapState = false;
let firebaseFogHistoryBatchCount = 0;
let compactingFirebaseFogHistory = false;
let firebaseFogHistoryCompactPromise = null;
let firebaseFogHistoryApplySeq = 0;
let suppressBeforeUnloadPersist = false;
// 本機暫存還原完成前收到的 token 更新先排隊，避免被還原的舊資料蓋掉。
let localRestorePending = true;
let queuedTokenUpdates = [];
let remoteMapSaveErrorReported = false;

function sanitizeStorageSegment(value) {
  return encodeURIComponent(String(value || "default").trim().slice(0, 80) || "default");
}

function getSyncChannelName() {
  if (IS_FIREBASE_ROOM) return `${DEFAULT_SYNC_CHANNEL_NAME}.room.${sanitizeStorageSegment(FIREBASE_ROOM_ID || "default")}`;
  if (IS_OFFLINE_ROOM) return `${DEFAULT_SYNC_CHANNEL_NAME}.olroom.${OFFLINE_ROOM_KEY}`;
  return DEFAULT_SYNC_CHANNEL_NAME;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
    imageDataUrl: "",
    x: 0,
    y: 0,
    size: TOKEN_DEFAULT_SIZE,
    shape: "square",
    visible: false
  };
}

function normalizeTokenState(state = {}) {
  const imageDataUrl = typeof state.imageDataUrl === "string" ? state.imageDataUrl : "";
  const fallbackX = mapCanvas.width ? mapCanvas.width / 2 : 0;
  const fallbackY = mapCanvas.height ? mapCanvas.height / 2 : 0;
  const x = Number.isFinite(Number(state.x)) ? Number(state.x) : fallbackX;
  const y = Number.isFinite(Number(state.y)) ? Number(state.y) : fallbackY;

  return {
    imageDataUrl,
    x,
    y,
    size: clamp(Number(state.size ?? TOKEN_DEFAULT_SIZE), TOKEN_MIN_SIZE, TOKEN_MAX_SIZE),
    shape: state.shape === "hex" ? "hex" : "square",
    visible: Boolean(state.visible && imageDataUrl)
  };
}

function broadcastMessage(message) {
  syncChannel?.postMessage({ ...message, source: "gm" });
}

function whenFirebaseReady(callback) {
  if (window.MapFogFirebaseSync) {
    callback(window.MapFogFirebaseSync);
    return;
  }

  window.addEventListener("mapfog:firebase-ready", (event) => callback(event.detail), { once: true });
}

function roundCanvasValue(value) {
  return Math.round(value * 10) / 10;
}

function flushPendingDraws() {
  if (!pendingDrawStrokes.length) return;

  const strokes = pendingDrawStrokes;
  pendingDrawStrokes = [];
  broadcastMessage({ type: "drawBatch", strokes });
  firebaseSync?.sendDrawBatch(strokes);
  if (IS_FIREBASE_ROOM) {
    const appendHistory = () => {
      const appendPromise = firebaseSync?.appendFogHistoryBatch?.(strokes);
      if (!appendPromise?.then) return;
      appendPromise
        .then(() => {
          firebaseFogHistoryBatchCount += 1;
          compactFirebaseFogHistoryIfNeeded();
        })
        .catch((error) => console.error("[MapFog Firebase]", error));
    };

    if (compactingFirebaseFogHistory && firebaseFogHistoryCompactPromise?.finally) {
      firebaseFogHistoryCompactPromise.finally(appendHistory);
    } else {
      appendHistory();
    }
  }
}

function clearPendingDraws() {
  pendingDrawStrokes = [];
}

function enqueueDrawSync(stroke) {
  const syncedStroke = { ...stroke };
  for (const key of ["x", "y", "width", "height"]) {
    if (Number.isFinite(Number(syncedStroke[key]))) {
      syncedStroke[key] = roundCanvasValue(Number(syncedStroke[key]));
    }
  }

  pendingDrawStrokes.push(syncedStroke);
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

function createMapState() {
  if (!currentImage) return null;
  return {
    width: mapCanvas.width,
    height: mapCanvas.height,
    mapDataUrl: currentMapDataUrl || mapCanvas.toDataURL("image/png")
  };
}

function createFogState() {
  if (!currentImage) return null;
  return {
    width: fogCanvas.width,
    height: fogCanvas.height,
    fogDataUrl: fogCanvas.toDataURL("image/png")
  };
}

function createSnapshotMessage() {
  const mapState = createMapState();
  if (!mapState) return null;

  const fogState = createFogState();
  return {
    type: "snapshot",
    ...mapState,
    fogDataUrl: fogState?.fogDataUrl || "",
    gridSettings: { ...gridSettings },
    tokenState: getBroadcastTokenState(true)
  };
}

function writeLocalCache(key, value) {
  // Firebase room 不從本機暫存還原，寫了只會占空間。
  if (IS_FIREBASE_ROOM || !localStore) return;
  localStore.set(key, value);
}

function cacheMapState(mapState) {
  if (mapState?.mapDataUrl) writeLocalCache(SHARED_MAP_STORAGE_KEY, mapState);
}

function cacheFogState(fogState) {
  if (fogState?.fogDataUrl) writeLocalCache(SHARED_FOG_STORAGE_KEY, fogState);
}

function reportRemoteMapSaveError(error) {
  console.error("[MapFog Firebase]", error);
  if (remoteMapSaveErrorReported) return;
  remoteMapSaveErrorReported = true;
  window.alert("地圖無法上傳到 room，玩家會看不到這張地圖。\n\n可能是圖片超過 Firebase 單筆 10MB 上限，請改用較小的圖片（例如轉成 JPG 或降低解析度）後重新上傳。");
}

function persistMapState(mapState = createMapState()) {
  if (!mapState?.mapDataUrl) return null;

  cacheMapState(mapState);
  try {
    firebaseSync?.saveMapState?.(mapState)?.catch?.(reportRemoteMapSaveError);
  } catch (error) {
    reportRemoteMapSaveError(error);
  }
  return mapState;
}

function persistFogState(fogState = createFogState()) {
  if (!fogState?.fogDataUrl) return null;

  cacheFogState(fogState);
  if (!IS_FIREBASE_ROOM) firebaseSync?.saveFogState?.(fogState);
  return fogState;
}

function persistSnapshot(options = {}) {
  const remote = options.remote !== false;
  const mapState = remote ? persistMapState() : createMapState();
  if (!mapState) return null;
  if (!remote) cacheMapState(mapState);

  const fogState = IS_FIREBASE_ROOM && remote ? null : (remote ? persistFogState() : createFogState());
  if (!remote) cacheFogState(fogState);
  persistGridSettingsOnly();
  persistTokenState();

  return {
    type: "snapshot",
    ...mapState,
    fogDataUrl: IS_FIREBASE_ROOM && remote ? "" : (fogState?.fogDataUrl || ""),
    gridSettings: { ...gridSettings },
    tokenState: getBroadcastTokenState(true)
  };
}

function scheduleSnapshotPersist() {
  window.clearTimeout(statePersistTimer);
  if (IS_FIREBASE_ROOM) {
    statePersistTimer = null;
    return;
  }
  statePersistTimer = window.setTimeout(persistFogState, SNAPSHOT_PERSIST_DELAY_MS);
}

function broadcastSnapshot(options = {}) {
  flushPendingDraws();
  window.clearTimeout(statePersistTimer);
  statePersistTimer = null;
  const snapshot = persistSnapshot(options);
  if (!snapshot) return;

  broadcastMessage({
    type: "mapUpdate",
    width: snapshot.width,
    height: snapshot.height,
    mapDataUrl: snapshot.mapDataUrl
  });
  broadcastMessage({
    type: "fogUpdate",
    width: snapshot.width,
    height: snapshot.height,
    fogDataUrl: snapshot.fogDataUrl
  });

  if (options.remote === false) {
    broadcastMessage({ type: "gridUpdate", gridSettings: { ...gridSettings } });
    broadcastMessage({ type: "tokenUpdate", tokenState: getBroadcastTokenState(true) });
    return;
  }

  broadcastGridSettings();
  broadcastTokenState(true);
}

function updateBrushLabel() {
  brushSizeValue.textContent = `${brushSize.value}px`;
}

function getFogActionLabel() {
  return mode === "erase" ? "擦除迷霧" : "補上迷霧";
}

function updateModeButton() {
  const actionLabel = getFogActionLabel();
  toggleFogBtn.classList.toggle("active", mode === "fill");
  toggleFogBtn.title = mode === "erase" ? "目前模式：擦除迷霧，點一下改成補霧" : "目前模式：補上迷霧，點一下改成擦霧";

  if (rectFogBtn) {
    const rectActive = drawingTool === "rect";
    rectFogBtn.classList.toggle("active", rectActive);
    rectFogBtn.title = rectActive ? `目前模式：矩形${actionLabel}` : "矩形擦除／補上迷霧";
    rectFogBtn.setAttribute("aria-label", rectActive ? `目前模式：矩形${actionLabel}` : "矩形擦除或補上迷霧模式");
  }
}

function updateModeNote() {
  const actionLabel = getFogActionLabel();
  const drawingLabel = drawingTool === "rect" ? `矩形${actionLabel}模式` : "繪圖模式";

  if (panModeBtn) {
    panModeBtn.classList.toggle("active", isPanMode);
    panModeBtn.title = isPanMode ? "目前是平移模式：拖曳地圖，不會擦除迷霧。" : `目前是${drawingLabel}：左鍵拖曳會${actionLabel}，右鍵拖曳會移動地圖。`;
  }
  modeNote.textContent = isPanMode
    ? "目前是平移模式：拖曳地圖，不會擦除迷霧。"
    : `目前是${drawingLabel}：左鍵拖曳會${actionLabel}，右鍵拖曳會移動地圖。`;
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

function persistGridSettingsOnly() {
  if (!currentImage) return;

  writeSharedState(SHARED_GRID_STORAGE_KEY, { ...gridSettings });
}

function scheduleGridSettingsPersist() {
  window.clearTimeout(gridPersistTimer);
  gridPersistTimer = window.setTimeout(persistGridSettingsOnly, CONTROL_SYNC_DEBOUNCE_MS);
}

function broadcastGridSettings() {
  broadcastMessage({ type: "gridUpdate", gridSettings: { ...gridSettings } });
  firebaseSync?.sendGridSettings({ ...gridSettings });
}

function flushGridSettingsSync() {
  if (gridSyncTimer !== null) {
    window.clearTimeout(gridSyncTimer);
    gridSyncTimer = null;
  }

  broadcastGridSettings();
  scheduleGridSettingsPersist();
}

function scheduleGridSettingsSync() {
  window.clearTimeout(gridSyncTimer);
  gridSyncTimer = window.setTimeout(flushGridSettingsSync, CONTROL_SYNC_DEBOUNCE_MS);
}

function setGridPanelOpen(open) {
  if (!gridPanel || !gridSettingsBtn) return;

  gridPanel.hidden = !open;
  gridSettingsBtn.setAttribute("aria-expanded", String(open));
  gridSettingsBtn.classList.toggle("active", open || gridSettings.enabled);
}

function updateGridControls() {
  if (!gridEnabled) return;

  gridEnabled.checked = gridSettings.enabled;
  gridSquareBtn.classList.toggle("active", gridSettings.type === "square");
  gridHexBtn.classList.toggle("active", gridSettings.type === "hex");
  gridWhiteBtn.classList.toggle("active", gridSettings.color === "white");
  gridBlackBtn.classList.toggle("active", gridSettings.color === "black");
  gridOpacity.value = Math.round(gridSettings.opacity * 100);
  gridOpacityValue.textContent = `${Math.round(gridSettings.opacity * 100)}%`;
  gridSize.value = Math.round(gridSettings.size);
  gridSizeValue.textContent = `${Math.round(gridSettings.size)}px`;
  gridLineWidth.value = Math.round(gridSettings.lineWidth);
  gridLineWidthValue.textContent = `${Math.round(gridSettings.lineWidth)}px`;
  gridOffsetX.value = Math.round(gridSettings.offsetX);
  gridOffsetXValue.textContent = `${Math.round(gridSettings.offsetX)}px`;
  gridOffsetY.value = Math.round(gridSettings.offsetY);
  gridOffsetYValue.textContent = `${Math.round(gridSettings.offsetY)}px`;

  gridSettingsBtn?.classList.toggle("active", !gridPanel?.hidden || gridSettings.enabled);
  gridSettingsBtn?.setAttribute("aria-pressed", String(gridSettings.enabled));
  gridSettingsBtn.title = gridSettings.enabled ? "格線設定（已開啟）" : "格線設定";
  if (saveGridImageBtn) saveGridImageBtn.disabled = !currentImage;
  if (saveAdjustedMapBtn) saveAdjustedMapBtn.disabled = !currentImage;
}

function setGridSettings(nextSettings, options = {}) {
  gridSettings = normalizeGridSettings({ ...gridSettings, ...nextSettings });
  drawGrid();
  updateGridControls();

  if (options.sync !== false) {
    broadcastGridSettings();
    scheduleGridSettingsPersist();
  }
}

function createTokenId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return `token-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function createDefaultTokenState(overrides = {}) {
  return {
    id: overrides.id || createTokenId(), name: "", imageDataUrl: "",
    x: mapCanvas.width ? mapCanvas.width / 2 : 0,
    y: mapCanvas.height ? mapCanvas.height / 2 : 0,
    size: TOKEN_DEFAULT_SIZE, shape: "square", visible: false, ...overrides
  };
}

function normalizeTokenState(state = {}) {
  const imageDataUrl = typeof state.imageDataUrl === "string" ? state.imageDataUrl : "";
  return {
    id: typeof state.id === "string" && state.id ? state.id : createTokenId(),
    name: typeof state.name === "string" ? state.name.trim() : "",
    initiativeLabel: typeof state.initiativeLabel === "string" ? state.initiativeLabel.trim() : "",
    initiativeEntryId: typeof state.initiativeEntryId === "string" ? state.initiativeEntryId : "",
    hpFontSize: clamp(Math.round(Number(state.hpFontSize) || 24), 8, 96),
    imageDataUrl,
    x: Number.isFinite(Number(state.x)) ? Number(state.x) : (mapCanvas.width ? mapCanvas.width / 2 : 0),
    y: Number.isFinite(Number(state.y)) ? Number(state.y) : (mapCanvas.height ? mapCanvas.height / 2 : 0),
    size: clamp(Number(state.size ?? TOKEN_DEFAULT_SIZE), TOKEN_MIN_SIZE, TOKEN_MAX_SIZE),
    shape: state.shape === "hex" ? "hex" : "square",
    visible: Boolean(state.visible && imageDataUrl)
  };
}

function createDefaultTokenCollectionState() { return { tokens: [], selectedTokenId: null }; }

function normalizeTokenCollectionState(state = {}) {
  if (Array.isArray(state.tokens)) {
    const seen = new Set();
    const tokens = state.tokens.map(normalizeTokenState).filter((token) => !seen.has(token.id) && seen.add(token.id));
    const selectedTokenId = tokens.some((t) => t.id === state.selectedTokenId) ? state.selectedTokenId : (tokens[0]?.id || null);
    return { tokens, selectedTokenId };
  }
  if (state && (state.imageDataUrl || state.visible || state.id)) {
    const token = normalizeTokenState(state);
    return { tokens: [token], selectedTokenId: token.id };
  }
  return createDefaultTokenCollectionState();
}

function mergeTokenCollectionState(incoming = {}) {
  const rawTokens = Array.isArray(incoming.tokens) ? incoming.tokens : [];
  const existing = new Map(tokenCollectionState.tokens.map((token) => [token.id, token]));
  const tokens = rawTokens.map((raw) => normalizeTokenState({ ...(existing.get(raw.id) || {}), ...raw }));
  const selectedTokenId = Object.prototype.hasOwnProperty.call(incoming, "selectedTokenId")
    ? incoming.selectedTokenId
    : tokenCollectionState.selectedTokenId;
  return normalizeTokenCollectionState({ tokens, selectedTokenId });
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
  let found = false;
  const tokens = incoming.tokens.map((token) => {
    if (token.id !== tokenId) return token;
    found = true;
    return { ...token, ...localToken, imageDataUrl: localToken.imageDataUrl || token.imageDataUrl };
  });

  if (!found) tokens.push(localToken);

  return {
    tokens,
    selectedTokenId: draggingTokenId || tokenCollectionState.selectedTokenId || incoming.selectedTokenId
  };
}

async function readStoredTokenState() {
  if (IS_FIREBASE_ROOM || !localStore) return null;

  return await localStore.get(TOKEN_STATE_STORAGE_KEY)
    || (IS_OFFLINE_ROOM ? null : await localStore.get(LEGACY_TOKEN_STATE_STORAGE_KEY));
}

function persistTokenState() {
  writeLocalCache(TOKEN_STATE_STORAGE_KEY, tokenCollectionState);
}

function getBroadcastTokenState(includeImage = true) {
  return {
    selectedTokenId: tokenCollectionState.selectedTokenId,
    tokens: tokenCollectionState.tokens.map((token) => {
      if (includeImage) return { ...token };
      const { imageDataUrl, ...lightToken } = token;
      return lightToken;
    })
  };
}

function broadcastTokenState(includeImage = true, changedTokenId = null) {
  broadcastMessage({ type: "tokenUpdate", tokenState: getBroadcastTokenState(includeImage) });
  firebaseSync?.sendTokenState(getBroadcastTokenState(includeImage), includeImage, changedTokenId);
}

function flushTokenDragSync(tokenId = draggingTokenId) {
  if (tokenDragSyncTimer !== null) {
    window.clearTimeout(tokenDragSyncTimer);
    tokenDragSyncTimer = null;
  }

  if (!tokenId) return;
  lastTokenDragSyncAt = Date.now();
  broadcastTokenState(false, tokenId);
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

function flushTokenControlSync(tokenId = getSelectedToken()?.id || null) {
  if (tokenControlSyncTimer !== null) {
    window.clearTimeout(tokenControlSyncTimer);
    tokenControlSyncTimer = null;
  }

  persistTokenState();
  if (tokenId) broadcastTokenState(false, tokenId);
}

function scheduleTokenControlSync(tokenId = getSelectedToken()?.id || null) {
  window.clearTimeout(tokenControlSyncTimer);
  tokenControlSyncTimer = window.setTimeout(() => flushTokenControlSync(tokenId), CONTROL_SYNC_DEBOUNCE_MS);
}

function clampTokenPosition(x, y) {
  // 地圖載入前 canvas 是預設的 300×150，這時夾座標會把所有 token 擠到左上角。
  if (!currentImage || !mapCanvas.width || !mapCanvas.height) return { x, y };
  return { x: clamp(x, 0, mapCanvas.width), y: clamp(y, 0, mapCanvas.height) };
}

function setTokenPanelOpen(open) {
  if (!tokenPanel || !tokenSettingsBtn) return;
  // Fixed settings must escape the stage's stacking context to cover the lower controls.
  if (open && tokenPanel.parentElement !== document.body) document.body.appendChild(tokenPanel);
  tokenPanel.hidden = !open;
  tokenSettingsBtn.setAttribute("aria-expanded", String(open));
  tokenSettingsBtn.classList.toggle("active", open || tokenCollectionState.tokens.length > 0);
}

function updateTokenControls() {
  const selected = getSelectedToken();
  if (tokenSelect) {
    tokenSelect.replaceChildren();
    tokenCollectionState.tokens.forEach((token, index) => {
      const option = document.createElement("option");
      option.value = token.id; option.textContent = token.name || `Token ${index + 1}`; tokenSelect.append(option);
    });
    tokenSelect.disabled = !selected;
    if (selected) tokenSelect.value = selected.id;
  }
  if (tokenSize) { tokenSize.disabled = !selected; tokenSize.value = Math.round(selected?.size ?? TOKEN_DEFAULT_SIZE); }
  if (tokenSizeValue) tokenSizeValue.textContent = `${Math.round(selected?.size ?? TOKEN_DEFAULT_SIZE)}px`;
  const hpFontSize = document.getElementById("tokenHpFontSize");
  if (hpFontSize) { hpFontSize.disabled = !selected; hpFontSize.value = selected?.hpFontSize ?? 24; }
  const hpFontSizeValue = document.getElementById("tokenHpFontSizeValue");
  if (hpFontSizeValue) hpFontSizeValue.textContent = `${selected?.hpFontSize ?? 24}px`;
  tokenSquareBtn?.classList.toggle("active", selected?.shape === "square");
  tokenHexBtn?.classList.toggle("active", selected?.shape === "hex");
  if (tokenSquareBtn) tokenSquareBtn.disabled = !selected;
  if (tokenHexBtn) tokenHexBtn.disabled = !selected;
  if (tokenClearBtn) tokenClearBtn.disabled = !selected;
  tokenSettingsBtn?.classList.toggle("active", !tokenPanel?.hidden || tokenCollectionState.tokens.length > 0);
  if (tokenStatus) tokenStatus.textContent = selected ? `共 ${tokenCollectionState.tokens.length} 個 token；拖曳可同步位置` : "尚未上傳 token";
}

function safeCssEscape(value) {
  if (window.CSS?.escape) return window.CSS.escape(value);
  return String(value).replace(/["\\]/g, "\\$&");
}

function renderTokens() {
  if (!tokenLayer) return;
  const visibleIds = new Set();
  const canShowLayer = Boolean(currentImage && tokenCollectionState.tokens.some((t) => t.visible && t.imageDataUrl));
  tokenLayer.hidden = !canShowLayer;
  for (const token of tokenCollectionState.tokens) {
    if (!(currentImage && token.visible && token.imageDataUrl)) continue;
    visibleIds.add(token.id);
    let element = tokenLayer.querySelector(`[data-token-id="${safeCssEscape(token.id)}"]`);
    if (!element) {
      element = document.createElement("div"); element.className = "map-token square"; element.dataset.tokenId = token.id;
      const image = document.createElement("img"); image.alt = ""; element.append(image); tokenLayer.append(element);
    }
    const image = element.querySelector("img"); if (image && image.src !== token.imageDataUrl) image.src = token.imageDataUrl;
    element.style.width = `${token.size}px`; element.style.height = `${token.size}px`;
    element.style.transform = `translate(${token.x - token.size / 2}px, ${token.y - token.size / 2}px) rotate(var(--token-rotation, 0deg))`;
    element.title = token.name;
    element.classList.toggle("square", token.shape === "square"); element.classList.toggle("hex", token.shape === "hex");
    element.classList.toggle("selected", token.id === tokenCollectionState.selectedTokenId);
  }
  tokenLayer.querySelectorAll(".map-token").forEach((el) => { if (!visibleIds.has(el.dataset.tokenId)) el.remove(); });
  updateTokenControls();
  document.dispatchEvent(new CustomEvent("mapfog:tokens-rendered"));
}

function setTokenCollectionState(nextState, options = {}) {
  tokenCollectionState = options.merge ? mergeTokenCollectionState(nextState) : normalizeTokenCollectionState(nextState);
  if (options.clampPosition !== false) tokenCollectionState.tokens = tokenCollectionState.tokens.map((t) => ({ ...t, ...clampTokenPosition(t.x, t.y) }));
  renderTokens();
  if (options.persist !== false) persistTokenState();
  if (options.sync !== false) broadcastTokenState(options.includeImage !== false, options.changedTokenId || null);
}

function setTokenState(nextState, options = {}) {
  const selected = getSelectedToken(); if (!selected) return;
  protectLocalToken(selected.id);
  const updated = normalizeTokenState({ ...selected, ...nextState });
  setTokenCollectionState({ tokens: tokenCollectionState.tokens.map((t) => t.id === selected.id ? updated : t), selectedTokenId: selected.id }, { ...options, changedTokenId: selected.id });
}

function selectToken(tokenId) {
  if (!tokenCollectionState.tokens.some((t) => t.id === tokenId)) return;
  setTokenCollectionState({ ...tokenCollectionState, selectedTokenId: tokenId }, { includeImage: false, changedTokenId: tokenId });
}

function removeSelectedToken() {
  const selected = getSelectedToken(); if (!selected) return;
  const tokens = tokenCollectionState.tokens.filter((t) => t.id !== selected.id);
  setTokenCollectionState({ tokens, selectedTokenId: tokens[0]?.id || null }, { includeImage: true });
}

function createCenteredTokenDataUrl(sourceDataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      try {
        const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
        if (!sourceSize) throw new Error("圖片尺寸無效");
        const canvas = document.createElement("canvas"); canvas.width = TOKEN_CROP_SIZE; canvas.height = TOKEN_CROP_SIZE;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(image, (image.naturalWidth-sourceSize)/2, (image.naturalHeight-sourceSize)/2, sourceSize, sourceSize, 0, 0, TOKEN_CROP_SIZE, TOKEN_CROP_SIZE);
        resolve(canvas.toDataURL("image/png"));
      } catch (error) { reject(error); }
    };
    image.onerror = () => reject(new Error("無法讀取這張圖片")); image.src = sourceDataUrl;
  });
}

function getInitiativeTokenInitial(name) {
  return name.match(/[A-Za-z\p{Script=Han}]/u)?.[0] || Array.from(name)[0] || "?";
}

function getNextInitiativeTokenLabel(initial) {
  const usedLabels = new Set(tokenCollectionState.tokens.map((token) => {
    // Older initiative tokens have a name but no stored label.
    return token.initiativeLabel || (token.name ? getInitiativeTokenInitial(token.name) : "");
  }));
  let label = initial;
  for (let suffix = 1; usedLabels.has(label); suffix += 1) label = `${initial}${suffix}`;
  return label;
}

function createInitiativeToken(entry, clientPoint = null) {
  if (!currentImage) return { error: "請先上傳地圖，再建立 token。" };

  const point = clientPoint ? eventToCanvasPoint(clientPoint) : { x: mapCanvas.width / 2, y: mapCanvas.height / 2 };
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)
    || point.x < 0 || point.y < 0 || point.x > mapCanvas.width || point.y > mapCanvas.height) {
    return { error: "請將名稱拖曳到地圖範圍內。" };
  }

  const name = String(entry.name || "").trim();
  const label = getNextInitiativeTokenLabel(getInitiativeTokenInitial(name));
  const canvas = document.createElement("canvas");
  canvas.width = TOKEN_CROP_SIZE;
  canvas.height = TOKEN_CROP_SIZE;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = entry.side === "enemy" ? "#b91c1c" : "#15803d";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#ffffff";
  ctx.font = `700 ${TOKEN_CROP_SIZE * 0.64}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  ctx.textAlign = "center";
  const maxTextWidth = TOKEN_CROP_SIZE * 0.84;
  const textWidth = ctx.measureText(label).width;
  if (textWidth > maxTextWidth) {
    ctx.font = `700 ${TOKEN_CROP_SIZE * 0.64 * maxTextWidth / textWidth}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  }
  const metrics = ctx.measureText(label);
  const textY = (TOKEN_CROP_SIZE + metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2;
  ctx.fillText(label, TOKEN_CROP_SIZE / 2, textY);

  const token = normalizeTokenState({
    name,
    initiativeLabel: label,
    initiativeEntryId: typeof entry.id === "string" ? entry.id : "",
    imageDataUrl: canvas.toDataURL("image/png"),
    visible: true,
    x: roundCanvasValue(point.x),
    y: roundCanvasValue(point.y)
  });
  setTokenCollectionState({ tokens: [...tokenCollectionState.tokens, token], selectedTokenId: token.id }, { includeImage: true, changedTokenId: token.id });
  return { token };
}

window.MapFogTokens = {
  createFromInitiative: createInitiativeToken,
  getState: () => tokenCollectionState,
  linkToInitiative(tokenId, entryId, name) {
    if (!tokenCollectionState.tokens.some((token) => token.id === tokenId)) return;
    const tokens = tokenCollectionState.tokens.map((token) => token.id === tokenId
      ? { ...token, initiativeEntryId: entryId, name }
      : token);
    setTokenCollectionState({ tokens, selectedTokenId: tokenId }, { includeImage: false, changedTokenId: tokenId });
  }
};

function loadTokenFromFile(file) {
  if (!file) return;
  if (tokenStatus) tokenStatus.textContent = "正在處理 token 圖片…";
  const reader = new FileReader();
  reader.onload = async (event) => {
    try {
      const imageDataUrl = await createCenteredTokenDataUrl(event.target.result);
      const center = clampTokenPosition(mapCanvas.width / 2, mapCanvas.height / 2);
      const token = normalizeTokenState({ imageDataUrl, visible: true, x: center.x, y: center.y });
      setTokenCollectionState({ tokens: [...tokenCollectionState.tokens, token], selectedTokenId: token.id }, { includeImage: true, changedTokenId: token.id });
    } catch (error) {
      console.error("[Token upload]", error);
      if (tokenStatus) tokenStatus.textContent = "圖片上傳失敗，請改用 PNG、JPG 或 WebP";
    }
  };
  reader.onerror = () => { if (tokenStatus) tokenStatus.textContent = "讀取圖片失敗"; };
  reader.readAsDataURL(file);
}

function beginTokenDrag(event) {
  const element = event.target.closest?.(".map-token"); if (!element || !currentImage) return;
  const token = tokenCollectionState.tokens.find((t) => t.id === element.dataset.tokenId); if (!token) return;
  event.preventDefault(); event.stopPropagation(); tokenCollectionState.selectedTokenId = token.id; renderTokens();
  const point = eventToCanvasPoint(event); tokenDragOffsetX = point.x-token.x; tokenDragOffsetY = point.y-token.y; draggingTokenId = token.id;
  protectLocalToken(token.id);
  element.classList.add("dragging"); element.setPointerCapture?.(event.pointerId);
}

function moveTokenDrag(event) {
  if (!draggingTokenId) return; event.preventDefault(); event.stopPropagation();
  const point = eventToCanvasPoint(event); const pos = clampTokenPosition(point.x-tokenDragOffsetX, point.y-tokenDragOffsetY);
  const tokens = tokenCollectionState.tokens.map((t) => t.id === draggingTokenId ? { ...t, x: roundCanvasValue(pos.x), y: roundCanvasValue(pos.y) } : t);
  setTokenCollectionState({ tokens, selectedTokenId: draggingTokenId }, { persist: false, sync: false });
  protectLocalToken(draggingTokenId);
  scheduleTokenDragSync(draggingTokenId);
}

function endTokenDrag(event) {
  if (!draggingTokenId) return; event.preventDefault(); event.stopPropagation();
  const tokenId = draggingTokenId;
  const element = tokenLayer?.querySelector(`[data-token-id="${safeCssEscape(tokenId)}"]`); element?.classList.remove("dragging"); element?.releasePointerCapture?.(event.pointerId);
  draggingTokenId = null; protectLocalToken(tokenId); persistTokenState(); flushTokenDragSync(tokenId);
}

function getExportFileName(suffix = "grid") {
  const baseName = currentMapFileName
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .trim() || "map";
  return `${baseName}-${suffix}.jpg`;
}

function downloadUrl(url, fileName) {
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function saveMapImageAsJpg(options = {}) {
  if (!currentImage || !mapCanvas.width || !mapCanvas.height) return;

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = mapCanvas.width;
  exportCanvas.height = mapCanvas.height;

  const exportCtx = exportCanvas.getContext("2d");
  exportCtx.fillStyle = "#ffffff";
  exportCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  // The CSS filter on mapCanvas is display-only, so bake the same adjustment into the export pixels.
  try {
    if (mapAdjust) mapAdjust.drawAdjusted(exportCtx, mapCanvas, mapCanvas.width, mapCanvas.height);
    else exportCtx.drawImage(mapCanvas, 0, 0);
  } catch (error) {
    console.error("[MapFog export]", error);
    window.alert("這個瀏覽器無法將地圖調整寫入圖片，已取消下載。");
    return;
  }
  if (options.includeGrid) exportCtx.drawImage(gridCanvas, 0, 0);

  const fileName = getExportFileName(options.suffix);
  exportCanvas.toBlob((blob) => {
    if (!blob) {
      downloadUrl(exportCanvas.toDataURL("image/jpeg", 0.94), fileName);
      return;
    }

    const url = URL.createObjectURL(blob);
    downloadUrl(url, fileName);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/jpeg", 0.94);
}

function saveGridImageAsJpg() {
  saveMapImageAsJpg({ includeGrid: true, suffix: "grid" });
}

function saveAdjustedMapAsJpg() {
  saveMapImageAsJpg({ includeGrid: false, suffix: "adjusted" });
}

function readStoredControlsCollapsed() {
  try {
    return window.localStorage.getItem(CONTROLS_COLLAPSED_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function setControlsCollapsed(collapsed) {
  if (!controlsPanel || !controlsCollapseBtn) return;

  controlsPanel.classList.toggle("collapsed", collapsed);

  const title = collapsed ? "展開上方控制區" : "收起上方控制區";
  controlsCollapseBtn.title = title;
  controlsCollapseBtn.setAttribute("aria-label", title);
  controlsCollapseBtn.setAttribute("aria-expanded", String(!collapsed));

  try {
    window.localStorage.setItem(CONTROLS_COLLAPSED_STORAGE_KEY, collapsed ? "1" : "0");
  } catch {
    // Ignore storage failures and keep the UI usable.
  }
}

function removeLocalStorageByPrefix(prefix) {
  const keys = [];

  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }

    keys.forEach((key) => localStorage.removeItem(key));
  } catch {
    // Clearing local cache is best-effort; the page remains usable if storage is blocked.
  }

  return keys.length;
}

function removeLocalStorageKeys(keys) {
  let removedCount = 0;

  try {
    for (const key of new Set(keys)) {
      if (localStorage.getItem(key) === null) continue;
      localStorage.removeItem(key);
      removedCount += 1;
    }
  } catch {
    // Clearing local cache is best-effort; the page remains usable if storage is blocked.
  }

  return removedCount;
}

function updateOlroomCacheControls() {
  if (clearCurrentOlroomBtn) {
    const canClearCurrentCache = IS_FIREBASE_ROOM || IS_OFFLINE_ROOM || IS_DEFAULT_LOCAL_PAGE;
    clearCurrentOlroomBtn.disabled = !canClearCurrentCache;
    clearCurrentOlroomBtn.textContent = IS_FIREBASE_ROOM
      ? `清除目前 room 暫存`
      : (IS_DEFAULT_LOCAL_PAGE ? "清除預設網頁暫存" : "清除目前 olroom 暫存");
    clearCurrentOlroomBtn.title = IS_FIREBASE_ROOM
      ? `清除目前 Firebase room：${FIREBASE_ROOM_ID || "default"}`
      : (IS_OFFLINE_ROOM
        ? `清除目前 olroom：${OFFLINE_ROOM_ID}`
        : (IS_DEFAULT_LOCAL_PAGE ? "清除沒有 olroom 參數時使用的預設本機暫存" : "目前沒有可清除的房間暫存"));
  }

  if (clearAllOlroomsBtn) {
    clearAllOlroomsBtn.title = "清除這台電腦所有 olroom 本機暫存";
  }

  if (sendPlayersToRoomBtn) {
    // room 模式的玩家在另一台電腦，房間由網址的 room 參數決定。
    sendPlayersToRoomBtn.hidden = IS_FIREBASE_ROOM || !controlChannel;
    sendPlayersToRoomBtn.textContent = "玩家畫面切到此房間";
    sendPlayersToRoomBtn.title = IS_OFFLINE_ROOM
      ? `讓這台電腦上開著的玩家畫面切換到 olroom：${OFFLINE_ROOM_ID}`
      : "讓這台電腦上開著的玩家畫面切換到預設（無 olroom）房間";
  }
}

async function clearCurrentOlroomCache() {
  if (IS_FIREBASE_ROOM) {
    const roomLabel = FIREBASE_ROOM_ID || "default";
    const confirmed = window.confirm(`清除目前 Firebase room「${roomLabel}」的地圖、迷霧、格線與 token 資料？\n\n這會刪除 Firebase 遠端房間狀態，其他正在使用同一 room 的分頁重新整理後也會看不到舊地圖。`);
    if (!confirmed) return;

    if (!firebaseSync?.clearRoomState) {
      window.alert("Firebase 尚未連線完成，請稍後再清除目前 room。");
      return;
    }

    clearCurrentOlroomBtn.disabled = true;
    try {
      await firebaseSync.clearRoomState();
      removeLocalStorageByPrefix(STORAGE_PREFIX);
      await localStore?.removeByPrefix(STORAGE_PREFIX);
      suppressBeforeUnloadPersist = true;
      window.location.reload();
    } catch (error) {
      console.error("[MapFog Firebase]", error);
      clearCurrentOlroomBtn.disabled = false;
      window.alert("清除 Firebase room 失敗，請確認網路連線後再試一次。");
    }
    return;
  }

  if (IS_OFFLINE_ROOM) {
    const confirmed = window.confirm(`清除目前 olroom「${OFFLINE_ROOM_ID}」的本機暫存？\n\n這不會刪除 Firebase，也不會影響其他 olroom。`);
    if (!confirmed) return;

    const prefix = `${OLROOM_STORAGE_PREFIX}${OFFLINE_ROOM_KEY}.`;
    suppressBeforeUnloadPersist = true;
    removeLocalStorageByPrefix(prefix);
    await localStore?.removeByPrefix(prefix);
    // 開著的玩家畫面也要放下舊狀態，否則會把舊 token 寫回已清除的房間。
    broadcastMessage({ type: "roomCacheCleared" });
    window.location.reload();
    return;
  }

  if (IS_DEFAULT_LOCAL_PAGE) {
    const confirmed = window.confirm("清除沒有 olroom 參數時使用的預設本機暫存？\n\n這不會刪除 Firebase，也不會影響任何 olroom。");
    if (!confirmed) return;

    suppressBeforeUnloadPersist = true;
    removeLocalStorageKeys(DEFAULT_LOCAL_CACHE_KEYS);
    await Promise.all(DEFAULT_LOCAL_CACHE_KEYS.map((key) => localStore?.remove(key)));
    broadcastMessage({ type: "roomCacheCleared" });
    window.location.reload();
  }
}

async function clearAllOlroomCaches() {
  const confirmed = window.confirm("清除這台電腦所有 olroom 本機暫存？\n\n這不會刪除 Firebase，也不會清除無參數單機模式的暫存。");
  if (!confirmed) return;

  if (IS_OFFLINE_ROOM) suppressBeforeUnloadPersist = true;
  const removedCount = removeLocalStorageByPrefix(OLROOM_STORAGE_PREFIX)
    + (await localStore?.removeByPrefix(OLROOM_STORAGE_PREFIX) || 0);
  controlChannel?.postMessage({ type: "olroomCachesCleared", source: "gm" });
  if (IS_OFFLINE_ROOM) {
    window.location.reload();
    return;
  }

  window.alert(removedCount > 0 ? `已清除 ${removedCount} 筆 olroom 暫存。` : "目前沒有 olroom 暫存。");
}

function sendPlayersToCurrentRoom() {
  controlChannel?.postMessage({ type: "switchRoom", source: "gm", olroom: OFFLINE_ROOM_ID });
  if (!sendPlayersToRoomBtn) return;
  sendPlayersToRoomBtn.textContent = "已通知玩家畫面";
  window.setTimeout(updateOlroomCacheControls, 1500);
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
    const raw = localStorage.getItem(GM_VIEW_STATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistViewState() {
  if (!currentImage) return;

  try {
    localStorage.setItem(GM_VIEW_STATE_STORAGE_KEY, JSON.stringify(createViewState()));
  } catch {
    // View state is local-only; failing to save should not affect live play.
  }
}

function scheduleViewStatePersist() {
  if (!currentImage) return;

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
  zoomValue.textContent = `${Math.round(scale * 100)}%`;
  zoomRange.value = Math.round(scale * 100);
  scheduleViewStatePersist();
}

function setScale(nextScale, centerClientX = null, centerClientY = null) {
  if (!currentImage) return;
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

function getRotatedDimensions() {
  const rotatedSideways = viewRotation === 90 || viewRotation === 270;
  return {
    width: rotatedSideways ? mapCanvas.height : mapCanvas.width,
    height: rotatedSideways ? mapCanvas.width : mapCanvas.height
  };
}

function centerMap() {
  if (!currentImage) return;
  const viewW = viewport.clientWidth;
  const viewH = viewport.clientHeight;
  const dims = getRotatedDimensions();
  const imgW = dims.width * scale;
  const imgH = dims.height * scale;

  offsetX = (viewW - imgW) / 2;
  offsetY = (viewH - imgH) / 2;
  applyTransform();
}

function fitToViewport() {
  if (!currentImage) return;
  const viewW = viewport.clientWidth;
  const viewH = viewport.clientHeight;
  const dims = getRotatedDimensions();
  const fitScale = Math.min(viewW / dims.width, viewH / dims.height);
  scale = clamp(fitScale, 0.1, 5);
  centerMap();
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

async function applyFogHistoryCheckpoint(checkpoint) {
  if (!checkpoint?.fogDataUrl) {
    return null;
  }

  return loadImage(checkpoint.fogDataUrl);
}

async function applyFirebaseFogHistory(history) {
  if (!IS_FIREBASE_ROOM || !history) return;

  if (!currentImage) {
    pendingFirebaseFogHistory = history;
    return;
  }

  const applySeq = ++firebaseFogHistoryApplySeq;
  pendingFirebaseFogHistory = null;
  firebaseFogHistoryBatchCount = Array.isArray(history.batches) ? history.batches.length : 0;

  if (history.base === "checkpoint") {
    const fogImage = await applyFogHistoryCheckpoint(history.checkpoint);
    if (applySeq !== firebaseFogHistoryApplySeq) return;
    if (fogImage) {
      fogCtx.globalCompositeOperation = "source-over";
      fogCtx.globalAlpha = 1;
      fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
      fogCtx.drawImage(fogImage, 0, 0, fogCanvas.width, fogCanvas.height);
    } else {
      applyFogHistoryBase("covered");
    }
  } else {
    applyFogHistoryBase(history.base);
  }

  const batches = Array.isArray(history.batches) ? history.batches : [];
  for (const batch of batches) {
    drawBatch(batch.strokes);
  }

  compactFirebaseFogHistoryIfNeeded();
}

function applyPendingFirebaseFogHistory() {
  if (!pendingFirebaseFogHistory || !currentImage) return;
  applyFirebaseFogHistory(pendingFirebaseFogHistory).catch((error) => console.error("[MapFog Firebase]", error));
}

function refreshFirebaseFogHistory() {
  if (!IS_FIREBASE_ROOM) return;
  firebaseSync?.loadFogHistory?.()
    .then((history) => applyFirebaseFogHistory(history))
    .catch((error) => console.error("[MapFog Firebase]", error));
}

function setFirebaseFogHistoryBase(base) {
  if (!IS_FIREBASE_ROOM || !firebaseSync?.setFogHistoryBase) return Promise.resolve();

  const writeBase = () => firebaseSync.setFogHistoryBase(base)
    .then(() => {
      firebaseFogHistoryBatchCount = 0;
      pendingFirebaseFogHistory = null;
    })
    .catch((error) => console.error("[MapFog Firebase]", error));

  if (compactingFirebaseFogHistory && firebaseFogHistoryCompactPromise?.finally) {
    return firebaseFogHistoryCompactPromise.finally(writeBase);
  }

  return writeBase();
}

function compactFirebaseFogHistoryIfNeeded() {
  if (!IS_FIREBASE_ROOM || !currentImage || !firebaseSync?.compactFogHistory) return;
  if (compactingFirebaseFogHistory || firebaseFogHistoryBatchCount < FOG_HISTORY_COMPACT_BATCH_LIMIT) return;

  compactingFirebaseFogHistory = true;
  firebaseFogHistoryCompactPromise = firebaseSync.compactFogHistory({
    width: fogCanvas.width,
    height: fogCanvas.height,
    fogDataUrl: fogCanvas.toDataURL("image/png")
  })
    .then(() => {
      firebaseFogHistoryBatchCount = 0;
      pendingFirebaseFogHistory = null;
    })
    .catch((error) => console.error("[MapFog Firebase]", error))
    .finally(() => {
      compactingFirebaseFogHistory = false;
      firebaseFogHistoryCompactPromise = null;
    });
}

function resetFog(options = {}) {
  if (!currentImage) return;
  if (options?.sync !== false) flushPendingDraws();

  fogCtx.globalCompositeOperation = "source-over";
  fogCtx.globalAlpha = 1;
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);
  fogCtx.fillStyle = "rgba(0,0,0,1)";
  fogCtx.fillRect(0, 0, fogCanvas.width, fogCanvas.height);

  if (options?.sync !== false) {
    broadcastMessage({ type: "resetFog" });
    firebaseSync?.sendFogCommand("resetFog");
    setFirebaseFogHistoryBase("covered");
    scheduleSnapshotPersist();
  }
}

function revealAllFog(options = {}) {
  if (!currentImage) return;
  if (options?.sync !== false) flushPendingDraws();

  fogCtx.globalCompositeOperation = "source-over";
  fogCtx.globalAlpha = 1;
  fogCtx.clearRect(0, 0, fogCanvas.width, fogCanvas.height);

  if (options?.sync !== false) {
    broadcastMessage({ type: "revealAllFog" });
    firebaseSync?.sendFogCommand("revealAllFog");
    setFirebaseFogHistoryBase("revealed");
    scheduleSnapshotPersist();
  }
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

function showCanvases() {
  emptyState.hidden = true;
  canvasHolder.hidden = false;
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function readStoredSnapshot() {
  if (IS_FIREBASE_ROOM || !localStore) return null;

  const legacySnapshot = await localStore.get(SHARED_STATE_STORAGE_KEY);
  const mapState = await localStore.get(SHARED_MAP_STORAGE_KEY) || legacySnapshot;
  if (!mapState?.mapDataUrl) return null;

  const fogState = await localStore.get(SHARED_FOG_STORAGE_KEY);
  const gridState = readSharedState(SHARED_GRID_STORAGE_KEY);
  const tokenState = await readStoredTokenState();
  const fogMatchesMap = fogState?.fogDataUrl
    && Number(fogState.width) === Number(mapState.width)
    && Number(fogState.height) === Number(mapState.height);

  return {
    type: "snapshot",
    width: mapState.width,
    height: mapState.height,
    mapDataUrl: mapState.mapDataUrl,
    fogDataUrl: fogMatchesMap ? fogState.fogDataUrl : legacySnapshot?.fogDataUrl,
    gridSettings: gridState || legacySnapshot?.gridSettings,
    tokenState: tokenState || legacySnapshot?.tokenState
  };
}

async function applyRemoteSnapshot(snapshot, options = {}) {
  if (!snapshot?.mapDataUrl) return;

  const applySeq = ++snapshotApplySeq;
  const hadMap = Boolean(currentImage);
  const initialWidth = Number(snapshot.width);
  const initialHeight = Number(snapshot.height);
  const canReuseMap = hadMap
    && currentMapDataUrl === snapshot.mapDataUrl
    && initialWidth === mapCanvas.width
    && initialHeight === mapCanvas.height;
  const mapImage = canReuseMap ? currentImage : await loadImage(snapshot.mapDataUrl);
  if (applySeq !== snapshotApplySeq) return;
  const width = initialWidth || mapImage.naturalWidth;
  const height = initialHeight || mapImage.naturalHeight;

  clearPendingDraws();
  if (!canReuseMap) {
    currentImage = mapImage;
    currentMapDataUrl = snapshot.mapDataUrl;
    mapAdjust?.setMapSource(snapshot.mapDataUrl);
    setCanvasSize(width, height);
    mapCtx.clearRect(0, 0, width, height);
    mapCtx.drawImage(mapImage, 0, 0, width, height);
  }

  if (!options.keepGridSettings) setGridSettings(snapshot.gridSettings ?? createDefaultGridSettings(), { sync: false });
  fogCtx.clearRect(0, 0, width, height);

  if (snapshot.fogDataUrl) {
    const fogImage = await loadImage(snapshot.fogDataUrl);
    if (applySeq !== snapshotApplySeq) return;
    fogCtx.drawImage(fogImage, 0, 0, width, height);
  } else {
    fogCtx.globalCompositeOperation = "source-over";
    fogCtx.globalAlpha = 1;
    fogCtx.fillStyle = "rgba(0,0,0,1)";
    fogCtx.fillRect(0, 0, width, height);
  }

  if (snapshot.tokenState) {
    setTokenCollectionState(preserveProtectedTokenState(snapshot.tokenState), { sync: false, persist: false });
  }

  showCanvases();
  updateGridControls();
  renderTokens();
  cacheMapState({ width, height, mapDataUrl: snapshot.mapDataUrl });
  if (snapshot.fogDataUrl) {
    cacheFogState({ width, height, fogDataUrl: snapshot.fogDataUrl });
  } else {
    cacheFogState({ width, height, fogDataUrl: fogCanvas.toDataURL("image/png") });
  }
  if (snapshot.gridSettings) persistGridSettingsOnly();
  applyPendingFirebaseFogHistory();

  if (options.restoreView && applyStoredViewState()) return;
  if (canReuseMap && options.preserveView !== false) {
    applyTransform();
    return;
  }
  fitToViewport();
}

function fogStateMatchesCurrentMap(fogState) {
  return Boolean(currentImage)
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
  cacheFogState({
    width: fogCanvas.width,
    height: fogCanvas.height,
    fogDataUrl: fogState.fogDataUrl
  });
}

async function applyRemoteMapState(mapState, options = {}) {
  if (!mapState?.mapDataUrl) return;

  const pendingFogMatchesMap = pendingRemoteFogState?.fogDataUrl
    && Number(pendingRemoteFogState.width) === Number(mapState.width)
    && Number(pendingRemoteFogState.height) === Number(mapState.height);
  const fogState = pendingFogMatchesMap ? pendingRemoteFogState : null;
  if (fogState) pendingRemoteFogState = null;

  applyingRemoteMapState = true;
  try {
    await applyRemoteSnapshot({
      type: "snapshot",
      width: mapState.width,
      height: mapState.height,
      mapDataUrl: mapState.mapDataUrl,
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

function loadImageFromDataUrl(dataUrl) {
  const img = new Image();
  img.onload = () => {
    clearPendingDraws();
    currentImage = img;
    currentMapDataUrl = dataUrl;
    mapAdjust?.setMapSource(dataUrl);
    viewRotation = 0;
    setCanvasSize(img.naturalWidth, img.naturalHeight);
    mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    mapCtx.drawImage(img, 0, 0);
    drawGrid();
    resetFog({ sync: false });
    showCanvases();
    updateGridControls();
    renderTokens();
    fitToViewport();
    if (IS_FIREBASE_ROOM && firebaseSync?.setFogHistoryBase) {
      setFirebaseFogHistoryBase("covered").finally(() => broadcastSnapshot());
      return;
    }
    broadcastSnapshot();
  };
  img.src = dataUrl;
}

function loadImageFromFile(file) {
  currentMapFileName = file.name || "map";
  const reader = new FileReader();
  reader.onload = (event) => loadImageFromDataUrl(event.target.result);
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

function clampCanvasPoint(point) {
  return {
    x: clamp(Number(point?.x) || 0, 0, fogCanvas.width),
    y: clamp(Number(point?.y) || 0, 0, fogCanvas.height)
  };
}

function normalizeFogRect(startPoint, endPoint) {
  const start = clampCanvasPoint(startPoint);
  const end = clampCanvasPoint(endPoint);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);

  return {
    x,
    y,
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y)
  };
}

function hideRectFogPreview() {
  if (!rectFogPreview) return;
  rectFogPreview.style.display = "none";
}

function showRectFogPreview(rect, strokeMode = mode) {
  if (!rectFogPreview) return;

  rectFogPreview.style.display = "block";
  rectFogPreview.style.left = `${rect.x}px`;
  rectFogPreview.style.top = `${rect.y}px`;
  rectFogPreview.style.width = `${Math.max(1, rect.width)}px`;
  rectFogPreview.style.height = `${Math.max(1, rect.height)}px`;
  rectFogPreview.classList.toggle("fill", strokeMode === "fill");
}

function drawRectFog(rect, options = {}) {
  if (!currentImage) return false;

  const strokeMode = options.mode ?? rect.mode ?? mode;
  const rawX = Number(rect.x) || 0;
  const rawY = Number(rect.y) || 0;
  const rawRight = rawX + (Number(rect.width) || 0);
  const rawBottom = rawY + (Number(rect.height) || 0);
  const left = clamp(Math.min(rawX, rawRight), 0, fogCanvas.width);
  const top = clamp(Math.min(rawY, rawBottom), 0, fogCanvas.height);
  const right = clamp(Math.max(rawX, rawRight), 0, fogCanvas.width);
  const bottom = clamp(Math.max(rawY, rawBottom), 0, fogCanvas.height);
  const width = right - left;
  const height = bottom - top;

  if (width <= 0 || height <= 0) return false;

  fogCtx.save();
  fogCtx.globalAlpha = 1;
  fogCtx.globalCompositeOperation = strokeMode === "erase" ? "destination-out" : "source-over";
  fogCtx.fillStyle = "rgba(0,0,0,1)";
  fogCtx.fillRect(left, top, width, height);
  fogCtx.restore();

  if (options.sync !== false) {
    enqueueDrawSync({
      type: "rect",
      x: left,
      y: top,
      width,
      height,
      mode: strokeMode
    });
  }

  return true;
}

function drawAt(x, y, options = {}) {
  const strokeMode = options.mode ?? mode;
  const strokeBrushSize = options.brushSize ?? Number(brushSize.value);
  const useSoftBrush = options.softBrush ?? softBrush.checked;
  const radius = Number(strokeBrushSize) / 2;

  fogCtx.save();
  fogCtx.beginPath();
  fogCtx.arc(x, y, radius, 0, Math.PI * 2);

  if (strokeMode === "erase") {
    fogCtx.globalCompositeOperation = "destination-out";
    if (useSoftBrush) {
      const gradient = fogCtx.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, "rgba(0,0,0,1)");
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      fogCtx.fillStyle = gradient;
      fogCtx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    } else {
      fogCtx.fill();
    }
  } else {
    fogCtx.globalCompositeOperation = "source-over";
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
  }

  fogCtx.restore();

  if (options.sync !== false) {
    enqueueDrawSync({
      x,
      y,
      mode: strokeMode,
      brushSize: strokeBrushSize,
      softBrush: useSoftBrush
    });
  }
}

function drawBatch(strokes) {
  if (!Array.isArray(strokes) || !currentImage) return;

  for (const stroke of strokes) {
    if (stroke?.type === "rect") {
      drawRectFog(stroke, { ...stroke, sync: false });
    } else {
      drawAt(stroke.x, stroke.y, { ...stroke, sync: false });
    }
  }

  scheduleSnapshotPersist();
}

function beginPan(clientX, clientY) {
  isPanning = true;
  lastPanX = clientX;
  lastPanY = clientY;
  viewport.classList.add("panning");
}

function movePan(clientX, clientY) {
  if (!isPanning) return;
  offsetX += clientX - lastPanX;
  offsetY += clientY - lastPanY;
  lastPanX = clientX;
  lastPanY = clientY;
  applyTransform();
}

function endPan() {
  isPanning = false;
  viewport.classList.remove("panning");
}

function pointerDown(event) {
  if (!currentImage) return;
  event.preventDefault();

  if (event.button === 2) {
    beginPan(event.clientX, event.clientY);
    fogCanvas.setPointerCapture?.(event.pointerId);
    return;
  }

  if (event.button !== 0) return;

  if (isPanMode) {
    beginPan(event.clientX, event.clientY);
    fogCanvas.setPointerCapture?.(event.pointerId);
    return;
  }

  if (drawingTool === "rect") {
    isDrawing = true;
    const point = eventToCanvasPoint(event);
    rectDrag = {
      pointerId: event.pointerId,
      start: point,
      mode
    };
    fogCanvas.setPointerCapture?.(event.pointerId);
    showRectFogPreview(normalizeFogRect(point, point), mode);
    return;
  }

  isDrawing = true;
  fogCanvas.setPointerCapture?.(event.pointerId);
  const { x, y } = eventToCanvasPoint(event);
  drawAt(x, y);
}

function pointerMove(event) {
  if (!currentImage) return;

  if (isPanning) {
    movePan(event.clientX, event.clientY);
    return;
  }

  if (!isDrawing) return;
  const { x, y } = eventToCanvasPoint(event);
  if (rectDrag) {
    showRectFogPreview(normalizeFogRect(rectDrag.start, { x, y }), rectDrag.mode);
    return;
  }

  drawAt(x, y);
}

function pointerUp(event) {
  const wasDrawing = isDrawing;
  const activeRectDrag = rectDrag;
  isDrawing = false;
  rectDrag = null;
  hideRectFogPreview();
  endPan();
  fogCanvas.releasePointerCapture?.(event.pointerId);
  if (currentImage && activeRectDrag) {
    const rect = normalizeFogRect(activeRectDrag.start, eventToCanvasPoint(event));
    if (drawRectFog(rect, { mode: activeRectDrag.mode })) {
      flushPendingDraws();
      scheduleSnapshotPersist();
    }
    return;
  }

  if (currentImage && wasDrawing) {
    flushPendingDraws();
    scheduleSnapshotPersist();
  }
}

function handleWheelZoom(event) {
  if (!currentImage) return;
  event.preventDefault();
  const delta = event.deltaY < 0 ? 1.1 : 0.9;
  setScale(scale * delta, event.clientX, event.clientY);
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

viewport.addEventListener("touchstart", (event) => {
  if (!currentImage) return;
  if (event.touches.length === 2) {
    event.preventDefault();
    pinchStartDistance = touchDistance(event.touches[0], event.touches[1]);
    pinchStartScale = scale;
    pinchMidStart = touchMidpoint(event.touches[0], event.touches[1]);
    pinchStartOffset = { x: offsetX, y: offsetY };
  }
}, { passive: false });

viewport.addEventListener("touchmove", (event) => {
  if (!currentImage) return;

  if (event.touches.length === 2 && pinchStartDistance) {
    event.preventDefault();
    const newDistance = touchDistance(event.touches[0], event.touches[1]);
    const nextScale = pinchStartScale * (newDistance / pinchStartDistance);

    scale = clamp(nextScale, 0.1, 5);

    const mid = touchMidpoint(event.touches[0], event.touches[1]);
    const dx = mid.x - pinchMidStart.x;
    const dy = mid.y - pinchMidStart.y;
    offsetX = pinchStartOffset.x + dx;
    offsetY = pinchStartOffset.y + dy;

    applyTransform();
  }
}, { passive: false });

viewport.addEventListener("touchend", () => {
  pinchStartDistance = null;
  pinchMidStart = null;
  pinchStartOffset = null;
});

syncChannel?.addEventListener("message", (event) => {
  const message = event.data;

  if (message?.type === "requestSnapshot") {
    broadcastSnapshot({ remote: false });
  }

  if (message?.type === "mapUpdate") {
    applyRemoteMapState(message, { restoreView: !currentImage }).catch((error) => console.error("[MapFog sync]", error));
  }

  if (message?.type === "fogUpdate") {
    applyRemoteFogState(message).catch((error) => console.error("[MapFog sync]", error));
  }

  if (message?.type === "gridUpdate") {
    setGridSettings(message.gridSettings, { sync: false });
    persistGridSettingsOnly();
  }

  if (message?.type === "tokenUpdate" && message.source !== "gm") {
    applyIncomingTokenState(message.tokenState, { merge: true });
  }
});

function applyIncomingTokenState(tokenState, options = {}) {
  if (localRestorePending) {
    queuedTokenUpdates.push({ tokenState, merge: Boolean(options.merge) });
    return;
  }
  setTokenCollectionState(preserveProtectedTokenState(tokenState), { sync: false, merge: Boolean(options.merge) });
}

function flushQueuedTokenUpdates() {
  localRestorePending = false;
  const updates = queuedTokenUpdates;
  queuedTokenUpdates = [];
  for (const update of updates) applyIncomingTokenState(update.tokenState, update);
}

window.addEventListener("storage", (event) => {
  if (IS_FIREBASE_ROOM) return;

  // 地圖、迷霧與 token 存在 IndexedDB，不會觸發 storage 事件；玩家的變更一律經由 BroadcastChannel 傳來。
  try {
    if (!syncChannel && event.key === SHARED_GRID_STORAGE_KEY && event.newValue) {
      setGridSettings(JSON.parse(event.newValue), { sync: false });
    }
  } catch {
    // Ignore malformed fallback state.
  }
});

function attachFirebaseSync(sync) {
  firebaseSync = sync;
  refreshFirebaseFogHistory();

  sync.onSnapshot((snapshot) => {
    applyRemoteSnapshot({
      ...snapshot,
      fogDataUrl: IS_FIREBASE_ROOM ? "" : snapshot.fogDataUrl
    }, { restoreView: !currentImage }).catch((error) => console.error("[MapFog Firebase]", error));
  });

  sync.onMapState?.((mapState) => {
    applyRemoteMapState(mapState, { restoreView: !currentImage }).catch((error) => console.error("[MapFog Firebase]", error));
  });

  if (!IS_FIREBASE_ROOM) sync.onFogState?.((fogState) => {
    applyRemoteFogState(fogState).catch((error) => console.error("[MapFog Firebase]", error));
  });

  sync.onDrawBatch((strokes) => {
    drawBatch(strokes);
  });

  sync.onFogCommand((command) => {
    firebaseFogHistoryApplySeq += 1;
    if (command === "resetFog") resetFog({ sync: false });
    if (command === "revealAllFog") revealAllFog({ sync: false });
    cacheFogState(createFogState());
    pendingFirebaseFogHistory = null;
  });

  sync.onGridSettings((nextGridSettings) => {
    setGridSettings(nextGridSettings, { sync: false });
    persistGridSettingsOnly();
  });

  sync.onTokenState((nextTokenState) => {
    applyIncomingTokenState(nextTokenState);
  });
}

fileInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (file) loadImageFromFile(file);
});

brushSize.addEventListener("input", updateBrushLabel);
zoomRange.addEventListener("input", () => setScale(Number(zoomRange.value) / 100));
resetFogBtn.addEventListener("click", () => resetFog());
revealAllFogBtn.addEventListener("click", () => revealAllFog());
toggleFogBtn.addEventListener("click", () => {
  mode = mode === "erase" ? "fill" : "erase";
  updateModeButton();
  updateModeNote();
});
rectFogBtn?.addEventListener("click", () => {
  drawingTool = drawingTool === "rect" ? "brush" : "rect";
  if (drawingTool === "rect") isPanMode = false;
  rectDrag = null;
  hideRectFogPreview();
  updateModeButton();
  updateModeNote();
});
panModeBtn?.addEventListener("click", () => {
  isPanMode = !isPanMode;
  if (isPanMode) {
    drawingTool = "brush";
    rectDrag = null;
    hideRectFogPreview();
    updateModeButton();
  }
  updateModeNote();
});

rotateBtn?.addEventListener("click", () => {
  flushPendingDraws();
  viewRotation = (viewRotation + 90) % 360;
  centerMap();
});
fitBtn.addEventListener("click", fitToViewport);
actualBtn.addEventListener("click", () => {
  scale = 1;
  centerMap();
});
centerBtn.addEventListener("click", centerMap);

fogCanvas.addEventListener("pointerdown", pointerDown);
fogCanvas.addEventListener("pointermove", pointerMove);
fogCanvas.addEventListener("pointerup", pointerUp);
fogCanvas.addEventListener("pointercancel", pointerUp);
fogCanvas.addEventListener("pointerleave", pointerUp);
tokenLayer?.addEventListener("pointerdown", beginTokenDrag);
tokenLayer?.addEventListener("pointermove", moveTokenDrag);
tokenLayer?.addEventListener("pointerup", endTokenDrag);
tokenLayer?.addEventListener("pointercancel", endTokenDrag);
viewport.addEventListener("contextmenu", (event) => event.preventDefault());

viewport.addEventListener("wheel", handleWheelZoom, { passive: false });
window.addEventListener("resize", () => {
  if (currentImage) applyTransform();
});

window.addEventListener("beforeunload", () => {
  if (suppressBeforeUnloadPersist) return;
  if (!currentImage) return;
  flushPendingDraws();
  persistTokenState();
  persistViewState();
  if (IS_FIREBASE_ROOM) return;
  persistSnapshot();
});

toolbarToggleBtn?.addEventListener("click", () => {
  floatingToolbar?.classList.toggle("collapsed");
  const collapsed = floatingToolbar?.classList.contains("collapsed");
  toolbarToggleBtn.title = collapsed ? "展開工具列" : "收合工具列";
  toolbarToggleBtn.setAttribute("aria-label", collapsed ? "展開工具列" : "收合工具列");
  toolbarToggleBtn.setAttribute("aria-expanded", String(!collapsed));
});

// Keep the native grid/token button and ARIA state in sync with tablet drawers.
document.addEventListener("mapfog:tablet-close-native-panels", (event) => {
  if (!document.body.classList.contains("tablet-layout")) return;
  if (event.detail?.except !== "grid") setGridPanelOpen(false);
  if (event.detail?.except !== "token") setTokenPanelOpen(false);
  if (event.detail?.except !== "mapAdjust") mapAdjust?.setOpen(false);
});

gridSettingsBtn?.addEventListener("click", () => {
  setTokenPanelOpen(false);
  mapAdjust?.setOpen(false);
  setGridPanelOpen(gridPanel?.hidden);
});

gridPanelCloseBtn?.addEventListener("click", () => {
  setGridPanelOpen(false);
});

tokenSettingsBtn?.addEventListener("click", () => {
  setGridPanelOpen(false);
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

document.getElementById("tokenAddInitiativeBtn")?.addEventListener("click", () => {
  const selected = getSelectedToken();
  if (!selected) return;
  setTokenPanelOpen(false);
  document.dispatchEvent(new CustomEvent("mapfog:add-token-to-initiative", {
    detail: { tokenId: selected.id, name: selected.name }
  }));
});

for (const eventName of ["input", "change"]) {
  document.getElementById("tokenHpFontSize")?.addEventListener(eventName, (event) => {
    const tokenId = getSelectedToken()?.id || null;
    setTokenState({ hpFontSize: Number(event.target.value) }, { sync: false, persist: false });
    if (eventName === "change") flushTokenControlSync(tokenId);
    else scheduleTokenControlSync(tokenId);
  });
}

tokenSize?.addEventListener("input", () => {
  const tokenId = getSelectedToken()?.id || null;
  setTokenState({ size: Number(tokenSize.value) }, { sync: false, persist: false });
  scheduleTokenControlSync(tokenId);
});

tokenSize?.addEventListener("change", () => {
  const tokenId = getSelectedToken()?.id || null;
  setTokenState({ size: Number(tokenSize.value) }, { sync: false, persist: false });
  flushTokenControlSync(tokenId);
});

tokenSquareBtn?.addEventListener("click", () => {
  setTokenState({ shape: "square" }, { includeImage: false });
});

tokenHexBtn?.addEventListener("click", () => {
  setTokenState({ shape: "hex" }, { includeImage: false });
});

tokenClearBtn?.addEventListener("click", () => {
  removeSelectedToken();
});

gridEnabled?.addEventListener("change", () => {
  setGridSettings({ enabled: gridEnabled.checked });
});

gridSquareBtn?.addEventListener("click", () => {
  setGridSettings({ type: "square" });
});

gridHexBtn?.addEventListener("click", () => {
  setGridSettings({ type: "hex" });
});

gridWhiteBtn?.addEventListener("click", () => {
  setGridSettings({ color: "white" });
});

gridBlackBtn?.addEventListener("click", () => {
  setGridSettings({ color: "black" });
});

gridOpacity?.addEventListener("input", () => {
  setGridSettings({ opacity: Number(gridOpacity.value) / 100 }, { sync: false });
  scheduleGridSettingsSync();
});

gridOpacity?.addEventListener("change", () => {
  setGridSettings({ opacity: Number(gridOpacity.value) / 100 }, { sync: false });
  flushGridSettingsSync();
});

gridSize?.addEventListener("input", () => {
  setGridSettings({ size: Number(gridSize.value) }, { sync: false });
  scheduleGridSettingsSync();
});

gridSize?.addEventListener("change", () => {
  setGridSettings({ size: Number(gridSize.value) }, { sync: false });
  flushGridSettingsSync();
});

gridLineWidth?.addEventListener("input", () => {
  setGridSettings({ lineWidth: Number(gridLineWidth.value) }, { sync: false });
  scheduleGridSettingsSync();
});

gridLineWidth?.addEventListener("change", () => {
  setGridSettings({ lineWidth: Number(gridLineWidth.value) }, { sync: false });
  flushGridSettingsSync();
});

gridOffsetX?.addEventListener("input", () => {
  setGridSettings({ offsetX: Number(gridOffsetX.value) }, { sync: false });
  scheduleGridSettingsSync();
});

gridOffsetX?.addEventListener("change", () => {
  setGridSettings({ offsetX: Number(gridOffsetX.value) }, { sync: false });
  flushGridSettingsSync();
});

gridOffsetY?.addEventListener("input", () => {
  setGridSettings({ offsetY: Number(gridOffsetY.value) }, { sync: false });
  scheduleGridSettingsSync();
});

gridOffsetY?.addEventListener("change", () => {
  setGridSettings({ offsetY: Number(gridOffsetY.value) }, { sync: false });
  flushGridSettingsSync();
});

gridNudgeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setGridSettings({
      offsetX: gridSettings.offsetX + Number(button.dataset.gridNudgeX ?? 0),
      offsetY: gridSettings.offsetY + Number(button.dataset.gridNudgeY ?? 0)
    });
  });
});

saveGridImageBtn?.addEventListener("click", saveGridImageAsJpg);
saveAdjustedMapBtn?.addEventListener("click", saveAdjustedMapAsJpg);

controlsCollapseBtn?.addEventListener("click", () => {
  const collapsed = controlsPanel?.classList.contains("collapsed");
  setControlsCollapsed(!collapsed);
});

clearCurrentOlroomBtn?.addEventListener("click", clearCurrentOlroomCache);
clearAllOlroomsBtn?.addEventListener("click", clearAllOlroomCaches);
sendPlayersToRoomBtn?.addEventListener("click", sendPlayersToCurrentRoom);

updateBrushLabel();
updateModeButton();
updateModeNote();
updateGridControls();
setGridPanelOpen(false);
updateOlroomCacheControls();
updateTokenControls();
setTokenPanelOpen(false);
whenFirebaseReady(attachFirebaseSync);
setControlsCollapsed(readStoredControlsCollapsed());
applyTransform();

async function restoreLocalState() {
  const storedSnapshot = await readStoredSnapshot();
  if (storedSnapshot) {
    await applyRemoteSnapshot(storedSnapshot, { restoreView: true });
    return;
  }

  const storedTokenState = await readStoredTokenState();
  if (storedTokenState) setTokenCollectionState(storedTokenState, { sync: false, persist: false });
}

restoreLocalState()
  .catch((error) => console.error("[MapFog restore]", error))
  .finally(flushQueuedTokenUpdates);
