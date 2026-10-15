const DEFAULT_SYNC_CHANNEL_NAME = "mapfog.sync.v1";
const DEFAULT_SHARED_STATE_STORAGE_KEY = "mapfog.shared.state";
const DEFAULT_SHARED_MAP_STORAGE_KEY = "mapfog.shared.map.v1";
const DEFAULT_SHARED_FOG_STORAGE_KEY = "mapfog.shared.fog.v1";
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

const DEFAULT_TOKEN_STATE_STORAGE_KEY = "mapfog.tokens.state.v2";
const LEGACY_TOKEN_STATE_STORAGE_KEY = "mapfog.token.state";
const DEFAULT_PLAYER_VIEW_STATE_STORAGE_KEY = "mapfog.view.player.v1";
const OLROOM_STORAGE_PREFIX = "mapfog.olroom.";
const TOKEN_DEFAULT_SIZE = 96;
const TOKEN_MIN_SIZE = 16;
const TOKEN_MAX_SIZE = 800;
const TOKEN_CROP_SIZE = 512;
const CONTROL_SYNC_DEBOUNCE_MS = 300;
const TOKEN_SYNC_THROTTLE_MS = 300;
const VIEW_STATE_PERSIST_DELAY_MS = 300;
const LOCAL_TOKEN_PROTECTION_MS = 2000;
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
const SHARED_STATE_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}shared.state.v1` : DEFAULT_SHARED_STATE_STORAGE_KEY;
const SHARED_MAP_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}map.v1` : DEFAULT_SHARED_MAP_STORAGE_KEY;
const SHARED_FOG_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}fog.v1` : DEFAULT_SHARED_FOG_STORAGE_KEY;
const SHARED_GRID_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}grid.v1` : DEFAULT_SHARED_GRID_STORAGE_KEY;
const TOKEN_STATE_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}tokens.v2` : DEFAULT_TOKEN_STATE_STORAGE_KEY;
const PLAYER_VIEW_STATE_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS ? `${STORAGE_PREFIX}playerView.v1` : DEFAULT_PLAYER_VIEW_STATE_STORAGE_KEY;
const syncChannel = "BroadcastChannel" in window ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;

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
let protectedTokenId = null;
let protectedTokenUntil = 0;
let snapshotApplySeq = 0;
let pendingRemoteFogState = null;
let pendingFirebaseFogHistory = null;
let applyingRemoteMapState = false;
let firebaseFogHistoryApplySeq = 0;

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

function cacheMapState(mapState) {
  if (mapState?.mapDataUrl) writeSharedState(SHARED_MAP_STORAGE_KEY, mapState);
}

function cacheFogState(fogState) {
  if (fogState?.fogDataUrl) writeSharedState(SHARED_FOG_STORAGE_KEY, fogState);
}

function cacheGridSettings() {
  writeSharedState(SHARED_GRID_STORAGE_KEY, { ...gridSettings });
}

function cacheCurrentFogState() {
  if (!hasMap) return;
  cacheFogState({
    width: fogCanvas.width,
    height: fogCanvas.height,
    fogDataUrl: fogCanvas.toDataURL("image/png")
  });
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

function readStoredTokenState() {
  if (IS_FIREBASE_ROOM) return null;

  try {
    const raw = localStorage.getItem(TOKEN_STATE_STORAGE_KEY)
      || (IS_OFFLINE_ROOM ? null : localStorage.getItem(LEGACY_TOKEN_STATE_STORAGE_KEY));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function persistTokenState() {
  try { localStorage.setItem(TOKEN_STATE_STORAGE_KEY, JSON.stringify(tokenCollectionState)); }
  catch { /* live sync still works */ }
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
  syncChannel?.postMessage({ type: "tokenUpdate", source: "player", tokenState: getBroadcastTokenState(includeImage) });
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
  if (!mapCanvas.width || !mapCanvas.height) return { x, y };
  return { x: clamp(x, 0, mapCanvas.width), y: clamp(y, 0, mapCanvas.height) };
}

function setTokenPanelOpen(open) {
  if (!tokenPanel || !tokenSettingsBtn) return;
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
  const canShowLayer = Boolean(hasMap && tokenCollectionState.tokens.some((t) => t.visible && t.imageDataUrl));
  tokenLayer.hidden = !canShowLayer;
  for (const token of tokenCollectionState.tokens) {
    if (!(hasMap && token.visible && token.imageDataUrl)) continue;
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
    const image = element.querySelector("img"); if (image && image.src !== token.imageDataUrl) image.src = token.imageDataUrl;
    element.style.width = `${token.size}px`; element.style.height = `${token.size}px`;
    element.style.transform = `translate(${token.x - token.size / 2}px, ${token.y - token.size / 2}px) rotate(var(--token-rotation, 0deg))`;
    element.title = token.name;
    element.classList.toggle("square", token.shape === "square"); element.classList.toggle("hex", token.shape === "hex");
    element.classList.toggle("selected", token.id === tokenCollectionState.selectedTokenId);
  }
  tokenLayer.querySelectorAll(".map-token").forEach((el) => { if (!visibleIds.has(el.dataset.tokenId)) el.remove(); });
  updateTokenControls();
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
  setTokenCollectionState({ ...tokenCollectionState, selectedTokenId: tokenId }, { includeImage: false });
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
  if (!token) return;

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
  persistTokenState();
  // 確保放開時再送出一次最終位置，即使最後一個 pointermove 沒有成功送出。
  flushTokenDragSync(tokenId);
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
  const canReuseMap = hasMap
    && currentMapDataUrl === snapshot.mapDataUrl
    && initialWidth === mapCanvas.width
    && initialHeight === mapCanvas.height;
  const mapImage = canReuseMap ? null : await loadImage(snapshot.mapDataUrl);
  if (applySeq !== snapshotApplySeq) return;
  const width = initialWidth || mapImage.naturalWidth;
  const height = initialHeight || mapImage.naturalHeight;

  if (!canReuseMap) {
    setCanvasSize(width, height);
    mapCtx.clearRect(0, 0, width, height);
    mapCtx.drawImage(mapImage, 0, 0, width, height);
    currentMapDataUrl = snapshot.mapDataUrl;
  }

  setGridSettings(snapshot.gridSettings ?? createDefaultGridSettings());
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
    setTokenCollectionState(preserveProtectedTokenState(snapshot.tokenState), { sync: false });
  } else {
    renderTokens();
  }
  cacheMapState({ width, height, mapDataUrl: snapshot.mapDataUrl });
  if (snapshot.fogDataUrl) {
    cacheFogState({ width, height, fogDataUrl: snapshot.fogDataUrl });
  } else {
    cacheFogState({ width, height, fogDataUrl: fogCanvas.toDataURL("image/png") });
  }
  applyPendingFirebaseFogHistory();

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
    await applySnapshot({
      type: "snapshot",
      width: mapState.width,
      height: mapState.height,
      mapDataUrl: mapState.mapDataUrl,
      fogDataUrl: fogState?.fogDataUrl || "",
      gridSettings
    }, options);
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

async function applyFogHistoryCheckpoint(checkpoint) {
  if (!checkpoint?.fogDataUrl) {
    return null;
  }

  return loadImage(checkpoint.fogDataUrl);
}

async function applyFirebaseFogHistory(history) {
  if (!IS_FIREBASE_ROOM || !history) return;

  if (!hasMap) {
    pendingFirebaseFogHistory = history;
    return;
  }

  const applySeq = ++firebaseFogHistoryApplySeq;
  pendingFirebaseFogHistory = null;

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
}

function applyPendingFirebaseFogHistory() {
  if (!pendingFirebaseFogHistory || !hasMap) return;
  applyFirebaseFogHistory(pendingFirebaseFogHistory).catch((error) => console.error("[MapFog Firebase]", error));
}

function refreshFirebaseFogHistory() {
  if (!IS_FIREBASE_ROOM) return;
  firebaseSync?.loadFogHistory?.()
    .then((history) => applyFirebaseFogHistory(history))
    .catch((error) => console.error("[MapFog Firebase]", error));
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

function readStoredSnapshot() {
  if (IS_FIREBASE_ROOM) return null;

  const legacySnapshot = readSharedState(SHARED_STATE_STORAGE_KEY);
  const mapState = readSharedState(SHARED_MAP_STORAGE_KEY) || legacySnapshot;
  if (!mapState?.mapDataUrl) return null;

  const fogState = readSharedState(SHARED_FOG_STORAGE_KEY);
  const gridState = readSharedState(SHARED_GRID_STORAGE_KEY);
  const tokenState = readStoredTokenState();
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

syncChannel?.addEventListener("message", (event) => {
  const message = event.data;
  if (!message || message.source !== "gm") return;

  if (message.type === "snapshot") applySnapshot(message);
  if (message.type === "mapUpdate") applyRemoteMapState(message, { restoreView: !hasMap }).catch((error) => console.error("[MapFog sync]", error));
  if (message.type === "fogUpdate") applyRemoteFogState(message).catch((error) => console.error("[MapFog sync]", error));
  if (message.type === "draw") drawAt(message.x, message.y, message);
  if (message.type === "drawBatch") drawBatch(message.strokes);
  if (message.type === "resetFog") {
    resetFog();
    cacheCurrentFogState();
  }
  if (message.type === "revealAllFog") {
    revealAllFog();
    cacheCurrentFogState();
  }
  if (message.type === "gridUpdate") setGridSettings(message.gridSettings);
  if (message.type === "tokenUpdate") setTokenCollectionState(preserveProtectedTokenState(message.tokenState), { sync: false, merge: true });
});

if (!syncChannel) {
  window.addEventListener("storage", (event) => {
    if (IS_FIREBASE_ROOM) return;

    try {
      if (event.key === SHARED_STATE_STORAGE_KEY && event.newValue) {
        applySnapshot(JSON.parse(event.newValue));
      }

      if (event.key === SHARED_MAP_STORAGE_KEY && event.newValue) {
        applyRemoteMapState(JSON.parse(event.newValue), { restoreView: !hasMap }).catch((error) => console.error("[MapFog storage]", error));
      }

      if (event.key === SHARED_FOG_STORAGE_KEY && event.newValue) {
        applyRemoteFogState(JSON.parse(event.newValue)).catch((error) => console.error("[MapFog storage]", error));
      }

      if (event.key === SHARED_GRID_STORAGE_KEY && event.newValue) {
        setGridSettings(JSON.parse(event.newValue), { cache: false });
      }
    } catch {
      // Ignore malformed fallback state.
    }
  });
}

window.addEventListener("storage", (event) => {
  if (IS_FIREBASE_ROOM) return;
  if (event.key !== TOKEN_STATE_STORAGE_KEY || !event.newValue) return;

  try {
    setTokenCollectionState(preserveProtectedTokenState(JSON.parse(event.newValue)), { sync: false, persist: false });
  } catch {
    // Ignore malformed token fallback state.
  }
});

function attachFirebaseSync(sync) {
  firebaseSync = sync;
  refreshFirebaseFogHistory();

  sync.onSnapshot((snapshot) => {
    applySnapshot({
      ...snapshot,
      fogDataUrl: IS_FIREBASE_ROOM ? "" : snapshot.fogDataUrl
    }, { restoreView: !hasMap }).catch((error) => console.error("[MapFog Firebase]", error));
  });

  sync.onMapState?.((mapState) => {
    applyRemoteMapState(mapState, { restoreView: !hasMap }).catch((error) => console.error("[MapFog Firebase]", error));
  });

  if (!IS_FIREBASE_ROOM) sync.onFogState?.((fogState) => {
    applyRemoteFogState(fogState).catch((error) => console.error("[MapFog Firebase]", error));
  });

  sync.onDrawBatch((strokes) => {
    drawBatch(strokes);
  });

  sync.onFogCommand((command) => {
    firebaseFogHistoryApplySeq += 1;
    if (command === "resetFog") resetFog();
    if (command === "revealAllFog") revealAllFog();
    cacheCurrentFogState();
    pendingFirebaseFogHistory = null;
  });

  sync.onGridSettings((nextGridSettings) => {
    setGridSettings(nextGridSettings);
  });

  sync.onTokenState((nextTokenState) => {
    setTokenCollectionState(preserveProtectedTokenState(nextTokenState), { sync: false });
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

window.addEventListener("beforeunload", () => {
  if (!hasMap) return;
  persistTokenState();
  persistViewState();
});

const storedTokenState = readStoredTokenState();
if (storedTokenState) {
  setTokenCollectionState(storedTokenState, { sync: false, persist: false });
} else {
  updateTokenControls();
}
setTokenPanelOpen(false);
whenFirebaseReady(attachFirebaseSync);

const storedSnapshot = readStoredSnapshot();
if (storedSnapshot) {
  if (storedTokenState) storedSnapshot.tokenState = storedTokenState;
  applySnapshot(storedSnapshot, { restoreView: true }).catch((error) => console.error("[MapFog restore]", error));
}
syncChannel?.postMessage({ type: "requestSnapshot", source: "player" });
