(function () {
  const DEFAULT_SYNC_CHANNEL_NAME = "mapfog.sync.v1";
  const DEFAULT_GM_STATE_STORAGE_KEY = "mapfog.initiative.gm.v1";
  const DEFAULT_PUBLIC_STATE_STORAGE_KEY = "mapfog.initiative.public.v1";
  // v2：面板改窄，舊版記住的寬度不沿用。
  const DEFAULT_GM_PANEL_LAYOUT_STORAGE_KEY = "mapfog.initiative.panel.gm.v2";
  const OLROOM_STORAGE_PREFIX = "mapfog.olroom.";
  const INITIATIVE_SYNC_TYPE = "initiativeUpdate";
  const INITIATIVE_REQUEST_TYPE = "requestInitiative";
  const MAX_NAME_LENGTH = 40;
  const MAX_HP_DIGITS = 3;
  const MAX_INITIATIVE_ABS = 999;
  const PANEL_MIN_WIDTH = 280;
  const PANEL_MIN_HEIGHT = 240;
  const PANEL_MARGIN = 8;
  const DEFAULT_GM_HINT = "Enter 敵 · ⇧Enter 友";

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
  const GM_STATE_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS
    ? `${STORAGE_PREFIX}initiative.gm.v1`
    : DEFAULT_GM_STATE_STORAGE_KEY;
  const PUBLIC_STATE_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS
    ? `${STORAGE_PREFIX}initiative.public.v1`
    : DEFAULT_PUBLIC_STATE_STORAGE_KEY;
  const GM_PANEL_LAYOUT_STORAGE_KEY = USE_NAMESPACED_STORAGE_KEYS
    ? `${STORAGE_PREFIX}initiative.panel.gm.v2`
    : DEFAULT_GM_PANEL_LAYOUT_STORAGE_KEY;
  const SYNC_CHANNEL_NAME = getSyncChannelName();
  const syncChannel = "BroadcastChannel" in window ? new BroadcastChannel(SYNC_CHANNEL_NAME) : null;
  const isGmPage = document.body.classList.contains("gm-page");

  const viewport = document.getElementById("viewport");
  const floatingToolbar = document.getElementById("floatingToolbar");
  if (!viewport || !floatingToolbar) return;

  let firebaseSync = null;
  let initiativeState = createDefaultGmState();
  let publicState = createDefaultPublicState();
  let draggedEntryId = "";
  let draggedTokenEntryId = "";
  let pendingTokenEntryId = "";
  let activeHpEntryId = "";
  let activePanelInteraction = null;
  let gmHintResetTimer = 0;

  injectInitiativeStyles();
  const ui = isGmPage ? createGmUi() : createPlayerUi();
  attachSharedUiEvents(ui.panel);
  attachSyncEvents();
  attachFirebaseWhenReady();

  if (isGmPage) {
    const storedGmState = readStoredGmState();
    setGmState(storedGmState || createDefaultGmState(), { persist: false, sync: false });
    if (storedGmState) broadcastPublicInitiativeState({ remote: false });
  } else {
    setPublicState(readStoredPublicState() || createDefaultPublicState(), { persist: false });
    requestInitiativeState();
  }

  function sanitizeStorageSegment(value) {
    return encodeURIComponent(String(value || "default").trim().slice(0, 80) || "default");
  }

  function getSyncChannelName() {
    if (IS_FIREBASE_ROOM) return `${DEFAULT_SYNC_CHANNEL_NAME}.room.${sanitizeStorageSegment(FIREBASE_ROOM_ID || "default")}`;
    if (IS_OFFLINE_ROOM) return `${DEFAULT_SYNC_CHANNEL_NAME}.olroom.${OFFLINE_ROOM_KEY}`;
    return DEFAULT_SYNC_CHANNEL_NAME;
  }

  function createId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `initiative-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function createDefaultGmState() {
    return { entries: [], isManualOrder: false, showTokenHp: false };
  }

  function createDefaultPublicState() {
    return { entries: [] };
  }

  function normalizeSide(side) {
    return side === "enemy" ? "enemy" : "ally";
  }

  function cleanName(value) {
    return String(value || "").trim().slice(0, MAX_NAME_LENGTH);
  }

  function sanitizeUnsignedValue(value) {
    return String(value).replace(/\D/g, "").slice(0, MAX_HP_DIGITS);
  }

  function sanitizeSignedHpValue(value, allowIncomplete = false) {
    const rawValue = String(value).trim();
    const isNegative = rawValue.startsWith("-");
    const digits = rawValue.replace(/\D/g, "").slice(0, MAX_HP_DIGITS);

    if (!digits) {
      return allowIncomplete && isNegative ? "-" : "";
    }

    return `${isNegative ? "-" : ""}${digits}`;
  }

  function normalizeHpValue(value) {
    const hpValue = sanitizeSignedHpValue(value);
    if (!hpValue) return "";

    const hpNumber = Number(hpValue);
    if (!Number.isFinite(hpNumber)) return "";

    return String(clamp(hpNumber, -MAX_INITIATIVE_ABS, MAX_INITIATIVE_ABS));
  }

  function getHpNumber(value) {
    const hpValue = normalizeHpValue(value);
    return hpValue ? Number(hpValue) : 0;
  }

  function formatHpDisplay(value) {
    const hpValue = normalizeHpValue(value);
    if (!hpValue) return "";
    return String(Math.abs(Number(hpValue)));
  }

  function isNegativeHp(value) {
    return getHpNumber(value) < 0;
  }

  function normalizeInitiative(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return null;
    return clamp(Math.trunc(number), -MAX_INITIATIVE_ABS, MAX_INITIATIVE_ABS);
  }

  function normalizeGmEntry(entry = {}, index = 0) {
    const name = cleanName(entry.name);
    if (!name) return null;

    const initiative = normalizeInitiative(entry.initiative);
    if (initiative === null) return null;

    return {
      id: typeof entry.id === "string" && entry.id ? entry.id : createId(),
      name,
      initiative,
      hp: normalizeHpValue(entry.hp),
      side: normalizeSide(entry.side),
      createdAt: Number.isFinite(Number(entry.createdAt)) ? Number(entry.createdAt) : Date.now() + index / 1000
    };
  }

  function sortEntries(entries) {
    entries.sort((a, b) => {
      if (b.initiative !== a.initiative) return b.initiative - a.initiative;
      return a.createdAt - b.createdAt;
    });
  }

  function normalizeGmState(state = {}) {
    const seen = new Set();
    const entries = Array.isArray(state.entries)
      ? state.entries
          .map(normalizeGmEntry)
          .filter((entry) => entry && !seen.has(entry.id) && seen.add(entry.id))
      : [];
    const normalized = {
      entries,
      isManualOrder: Boolean(state.isManualOrder),
      showTokenHp: Boolean(state.showTokenHp)
    };

    if (!normalized.isManualOrder) sortEntries(normalized.entries);
    return normalized;
  }

  function normalizePublicEntry(entry = {}, index = 0) {
    const name = cleanName(entry.name);
    if (!name) return null;

    return {
      id: typeof entry.id === "string" && entry.id ? entry.id : `public-${index}`,
      name,
      side: normalizeSide(entry.side)
    };
  }

  function normalizePublicState(state = {}) {
    const seen = new Set();
    const entries = Array.isArray(state.entries)
      ? state.entries
          .map(normalizePublicEntry)
          .filter((entry) => entry && !seen.has(entry.id) && seen.add(entry.id))
      : [];
    return { entries };
  }

  function createPublicStateFromGm() {
    return {
      entries: initiativeState.entries.map((entry) => ({
        id: entry.id,
        name: entry.name,
        side: entry.side
      }))
    };
  }

  function readJson(key) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function writeJson(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  function readStoredGmState() {
    const storedState = readJson(GM_STATE_STORAGE_KEY);
    return storedState ? normalizeGmState(storedState) : null;
  }

  function readStoredPublicState() {
    const storedState = readJson(PUBLIC_STATE_STORAGE_KEY);
    return storedState ? normalizePublicState(storedState) : null;
  }

  function persistGmState() {
    writeJson(GM_STATE_STORAGE_KEY, initiativeState);
    renderTokenHp();
  }

  function persistPublicState(state = publicState) {
    writeJson(PUBLIC_STATE_STORAGE_KEY, normalizePublicState(state));
  }

  function setGmState(nextState, options = {}) {
    initiativeState = normalizeGmState(nextState);
    renderGmList();

    if (options.persist !== false) persistGmState();
    if (options.sync !== false) broadcastPublicInitiativeState();
  }

  function setPublicState(nextState, options = {}) {
    publicState = normalizePublicState(nextState);
    renderPublicList();
    if (options.persist !== false) persistPublicState(publicState);
  }

  function broadcastPublicInitiativeState(options = {}) {
    publicState = normalizePublicState(createPublicStateFromGm());
    if (options.persist !== false) persistPublicState(publicState);
    syncChannel?.postMessage({
      type: INITIATIVE_SYNC_TYPE,
      source: "gm",
      initiativeState: publicState
    });
    if (options.remote !== false && typeof firebaseSync?.sendInitiativeState === "function") {
      firebaseSync.sendInitiativeState(publicState);
    }
  }

  function requestInitiativeState() {
    syncChannel?.postMessage({
      type: INITIATIVE_REQUEST_TYPE,
      source: "player"
    });
  }

  function attachSyncEvents() {
    syncChannel?.addEventListener("message", (event) => {
      const message = event.data;
      if (!message) return;

      if (isGmPage && message.type === INITIATIVE_REQUEST_TYPE) {
        broadcastPublicInitiativeState({ persist: false, remote: false });
        return;
      }

      if (!isGmPage && message.type === INITIATIVE_SYNC_TYPE && message.source === "gm") {
        setPublicState(message.initiativeState);
      }
    });

    window.addEventListener("storage", (event) => {
      if (!event.newValue) return;

      try {
        if (isGmPage && event.key === GM_STATE_STORAGE_KEY) {
          setGmState(JSON.parse(event.newValue), { persist: false, sync: false });
        }

        if (!isGmPage && event.key === PUBLIC_STATE_STORAGE_KEY) {
          setPublicState(JSON.parse(event.newValue), { persist: false });
        }
      } catch {
        // Ignore malformed cross-tab state.
      }
    });
  }

  function attachFirebaseWhenReady() {
    const attach = (sync) => {
      firebaseSync = sync;
      if (typeof sync.onInitiativeState === "function") {
        sync.onInitiativeState((nextPublicState) => {
          if (!isGmPage) setPublicState(nextPublicState);
        });
      }
      if (isGmPage && initiativeState.entries.length) {
        broadcastPublicInitiativeState();
      }
    };

    if (window.MapFogFirebaseSync) {
      attach(window.MapFogFirebaseSync);
      return;
    }

    window.addEventListener("mapfog:firebase-ready", (event) => attach(event.detail), { once: true });
  }

  function createToolbarButton() {
    const button = document.createElement("button");
    button.id = isGmPage ? "initiativePanelBtn" : "initiativePublicPanelBtn";
    button.className = "tool-button initiative-tool-button active";
    button.type = "button";
    button.title = "先攻順序";
    button.setAttribute("aria-label", "先攻順序");
    button.setAttribute("aria-expanded", "true");
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M8 6h13"/>
        <path d="M8 12h13"/>
        <path d="M8 18h13"/>
        <path d="M3 6h1"/>
        <path d="M3 12h1"/>
        <path d="M3 18h1"/>
      </svg>
    `;
    // GM 放在右上角遊戲工具列：Token、先攻、骰子、收合按鈕。玩家頁放在工具列最右邊的收合按鈕前面。
    const sideToolbar = document.getElementById("sideToolbar");
    if (sideToolbar) {
      sideToolbar.insertBefore(button, sideToolbar.querySelector("#diceToggleBtn") || sideToolbar.querySelector(".toolbar-toggle"));
    } else {
      floatingToolbar.insertBefore(button, floatingToolbar.querySelector(":scope > .toolbar-toggle:last-child"));
    }
    return button;
  }

  function setPanelOpen(button, panel, open) {
    panel.hidden = !open;
    button.classList.toggle("active", open);
    button.setAttribute("aria-expanded", String(open));
  }

  function createGmUi() {
    const button = createToolbarButton();
    const panel = document.createElement("section");
    panel.id = "initiativePanel";
    panel.className = "mapfog-initiative-panel gm-initiative-panel";
    panel.setAttribute("aria-label", "先攻管理");
    panel.innerHTML = `
      <div class="initiative-panel-header" data-panel-drag-handle="true" title="拖曳移動先攻管理">
        <div class="initiative-heading">
          <div class="initiative-panel-title">先攻</div>
          <div id="initiativeCount" class="initiative-panel-meta">0 位</div>
        </div>
        <div class="initiative-header-actions">
          <button id="initiativeSortBtn" class="initiative-secondary-button" type="button" title="依先攻值重新排序">排序</button>
          <button id="initiativeClearBtn" class="initiative-secondary-button danger" type="button">清空</button>
          <button id="initiativeTokenHpBtn" class="initiative-secondary-button" type="button" aria-label="顯示 Token HP" aria-pressed="false" title="顯示 Token HP（僅 GM 可見）">HP</button>
          <button id="initiativeCloseBtn" class="initiative-icon-button" type="button" title="收起先攻管理" aria-label="收起先攻管理">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
          </button>
        </div>
      </div>

      <form id="initiativeForm" class="initiative-form" novalidate>
        <div class="initiative-form-grid">
          <label class="initiative-compact-field initiative-name-field">
            <span class="initiative-visually-hidden">名稱</span>
            <input id="initiativeNameInput" type="text" maxlength="40" autocomplete="off" placeholder="名稱" aria-label="名稱" required>
          </label>
          <label class="initiative-compact-field">
            <span class="initiative-visually-hidden">先攻</span>
            <input id="initiativeValueInput" type="number" min="-999" max="999" step="1" placeholder="先攻" aria-label="先攻" required>
          </label>
          <label class="initiative-compact-field">
            <span class="initiative-visually-hidden">HP</span>
            <input id="initiativeHpInput" type="text" inputmode="numeric" maxlength="4" pattern="-?[0-9]{0,3}" placeholder="HP" aria-label="HP">
          </label>
          <button class="initiative-add-button enemy" type="submit" data-add-side="enemy" title="新增敵人（Enter）" aria-label="新增敵人">敵</button>
          <button class="initiative-add-button ally" type="submit" data-add-side="ally" title="新增友方（Shift+Enter）" aria-label="新增友方">友</button>
        </div>
        <div id="initiativeHint" class="initiative-hint" aria-live="polite">Enter 敵 · ⇧Enter 友</div>
      </form>

      <div id="initiativeGmList" class="initiative-list gm-list" role="list" aria-label="GM 先攻列表"></div>
    `;

    const modal = document.createElement("div");
    modal.id = "initiativeHpModal";
    modal.className = "initiative-modal-backdrop";
    modal.hidden = true;
    modal.innerHTML = `
      <div class="initiative-hp-modal" role="dialog" aria-modal="true" aria-labelledby="initiativeHpModalTitle">
        <div class="initiative-modal-header">
          <div>
            <div id="initiativeHpModalTarget" class="initiative-modal-target">HP</div>
            <div id="initiativeHpModalTitle" class="initiative-modal-title">傷害計算</div>
          </div>
          <button id="initiativeHpModalClose" class="initiative-icon-button" type="button" aria-label="關閉">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
          </button>
        </div>
        <div class="initiative-damage-grid">
          <label>
            <span>正常</span>
            <input id="initiativeNormalDamage" type="text" inputmode="numeric" maxlength="3" pattern="[0-9]{0,3}">
          </label>
          <label>
            <span>減半</span>
            <input id="initiativeHalfDamage" type="text" inputmode="numeric" maxlength="3" pattern="[0-9]{0,3}">
          </label>
          <label>
            <span>易傷</span>
            <input id="initiativeVulnerableDamage" type="text" inputmode="numeric" maxlength="3" pattern="[0-9]{0,3}">
          </label>
        </div>
        <div class="initiative-modal-footer">
          <div class="initiative-damage-total">
            <span>合計</span>
            <strong id="initiativeDamageTotal">0</strong>
          </div>
          <div class="initiative-modal-actions">
            <button id="initiativeHealBtn" class="initiative-calc-button heal" type="button">+</button>
            <button id="initiativeDamageBtn" class="initiative-calc-button damage" type="button">-</button>
          </div>
        </div>
      </div>
    `;

    viewport.appendChild(panel);
    appendResizeHandles(panel);
    document.body.appendChild(modal);

    const gmUi = {
      button,
      panel,
      closeButton: panel.querySelector("#initiativeCloseBtn"),
      form: panel.querySelector("#initiativeForm"),
      nameInput: panel.querySelector("#initiativeNameInput"),
      initiativeInput: panel.querySelector("#initiativeValueInput"),
      hpInput: panel.querySelector("#initiativeHpInput"),
      hint: panel.querySelector("#initiativeHint"),
      count: panel.querySelector("#initiativeCount"),
      list: panel.querySelector("#initiativeGmList"),
      sortButton: panel.querySelector("#initiativeSortBtn"),
      clearButton: panel.querySelector("#initiativeClearBtn"),
      tokenHpButton: panel.querySelector("#initiativeTokenHpBtn"),
      modal,
      modalTarget: modal.querySelector("#initiativeHpModalTarget"),
      modalClose: modal.querySelector("#initiativeHpModalClose"),
      damageInputs: [
        modal.querySelector("#initiativeNormalDamage"),
        modal.querySelector("#initiativeHalfDamage"),
        modal.querySelector("#initiativeVulnerableDamage")
      ],
      damageTotal: modal.querySelector("#initiativeDamageTotal"),
      healButton: modal.querySelector("#initiativeHealBtn"),
      damageButton: modal.querySelector("#initiativeDamageBtn")
    };

    button.addEventListener("click", () => setPanelOpen(button, panel, panel.hidden));
    gmUi.closeButton.addEventListener("click", () => {
      pendingTokenEntryId = "";
      setPanelOpen(button, panel, false);
    });
    attachFloatingPanelControls(panel);
    attachGmEvents(gmUi);
    return gmUi;
  }

  function createPlayerUi() {
    const button = createToolbarButton();
    const panel = document.createElement("section");
    panel.id = "initiativePublicPanel";
    panel.className = "mapfog-initiative-panel public-initiative-panel";
    panel.setAttribute("aria-label", "先攻順序");
    panel.innerHTML = `
      <div class="initiative-panel-header compact">
        <div>
          <div class="initiative-panel-title">先攻順序</div>
          <div id="initiativePublicCount" class="initiative-panel-meta">0 位</div>
        </div>
        <button id="initiativePublicCloseBtn" class="initiative-icon-button" type="button" title="收起先攻順序" aria-label="收起先攻順序">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
        </button>
      </div>
      <div id="initiativePublicList" class="initiative-list public-list" role="list" aria-label="玩家先攻順序"></div>
    `;
    viewport.appendChild(panel);

    const playerUi = {
      button,
      panel,
      closeButton: panel.querySelector("#initiativePublicCloseBtn"),
      count: panel.querySelector("#initiativePublicCount"),
      list: panel.querySelector("#initiativePublicList")
    };

    button.addEventListener("click", () => setPanelOpen(button, panel, panel.hidden));
    playerUi.closeButton.addEventListener("click", () => setPanelOpen(button, panel, false));
    return playerUi;
  }

  function attachSharedUiEvents(panel) {
    for (const eventName of ["pointerdown", "pointermove", "pointerup", "wheel", "touchstart", "touchmove"]) {
      panel.addEventListener(eventName, stopUiEvent, { passive: false });
    }
  }

  function stopUiEvent(event) {
    event.stopPropagation();
  }

  function appendResizeHandles(panel) {
    const handles = ["n", "e", "s", "w", "ne", "nw", "se", "sw"];
    for (const edge of handles) {
      const handle = document.createElement("div");
      handle.className = `initiative-resize-handle resize-${edge}`;
      handle.dataset.resizeEdge = edge;
      handle.setAttribute("aria-hidden", "true");
      panel.appendChild(handle);
    }
  }

  function readStoredPanelLayout() {
    const layout = readJson(GM_PANEL_LAYOUT_STORAGE_KEY);
    if (!layout || typeof layout !== "object") return null;
    return normalizePanelLayout(layout);
  }

  function persistPanelLayout(panel) {
    const rect = panel.getBoundingClientRect();
    writeJson(GM_PANEL_LAYOUT_STORAGE_KEY, {
      left: Math.round(rect.left),
      top: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    });
  }

  function normalizePanelLayout(layout = {}) {
    const viewportWidth = viewport.clientWidth || window.innerWidth;
    const viewportHeight = viewport.clientHeight || window.innerHeight;
    const maxWidth = Math.max(PANEL_MIN_WIDTH, viewportWidth - PANEL_MARGIN * 2);
    const maxHeight = Math.max(PANEL_MIN_HEIGHT, viewportHeight - PANEL_MARGIN * 2);
    const width = clamp(Number(layout.width) || 308, PANEL_MIN_WIDTH, maxWidth);
    const height = clamp(Number(layout.height) || 420, PANEL_MIN_HEIGHT, maxHeight);

    return {
      width,
      height,
      left: clamp(Number(layout.left) || PANEL_MARGIN, PANEL_MARGIN, Math.max(PANEL_MARGIN, viewportWidth - width - PANEL_MARGIN)),
      top: clamp(Number(layout.top) || 72, PANEL_MARGIN, Math.max(PANEL_MARGIN, viewportHeight - height - PANEL_MARGIN))
    };
  }

  function applyPanelLayout(panel, layout) {
    const normalized = normalizePanelLayout(layout);
    panel.style.left = `${normalized.left}px`;
    panel.style.top = `${normalized.top}px`;
    panel.style.width = `${normalized.width}px`;
    panel.style.height = `${normalized.height}px`;
  }

  function getPanelLayoutFromRect(rect) {
    return normalizePanelLayout({
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height
    });
  }

  function attachFloatingPanelControls(panel) {
    const storedLayout = readStoredPanelLayout();
    if (storedLayout) applyPanelLayout(panel, storedLayout);

    const dragHandle = panel.querySelector("[data-panel-drag-handle]");
    dragHandle?.addEventListener("pointerdown", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button,input,textarea,select,a")) return;
      startPanelInteraction(panel, event, "move");
    });
    dragHandle?.addEventListener("mousedown", (event) => {
      const target = event.target;
      if (target instanceof HTMLElement && target.closest("button,input,textarea,select,a")) return;
      startPanelInteraction(panel, event, "move");
    });

    panel.querySelectorAll("[data-resize-edge]").forEach((handle) => {
      handle.addEventListener("pointerdown", (event) => {
        startPanelInteraction(panel, event, "resize", handle.dataset.resizeEdge || "");
      });
      handle.addEventListener("mousedown", (event) => {
        startPanelInteraction(panel, event, "resize", handle.dataset.resizeEdge || "");
      });
    });

    window.addEventListener("resize", () => {
      // 收起時量不到大小，不能拿來覆蓋記住的位置（平板開關鍵盤也會觸發 resize）。
      if (panel.hidden) return;
      const rect = panel.getBoundingClientRect();
      applyPanelLayout(panel, getPanelLayoutFromRect(rect));
      persistPanelLayout(panel);
    });
  }

  function startPanelInteraction(panel, event, type, edge = "") {
    if (activePanelInteraction) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = panel.getBoundingClientRect();
    const layout = getPanelLayoutFromRect(rect);
    applyPanelLayout(panel, layout);
    activePanelInteraction = {
      panel,
      type,
      edge,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: layout.left,
      startTop: layout.top,
      startWidth: layout.width,
      startHeight: layout.height,
      inputType: event.type === "mousedown" ? "mouse" : "pointer"
    };
    panel.classList.add(type === "resize" ? "resizing" : "dragging-window");
    if (activePanelInteraction.inputType === "mouse") {
      window.addEventListener("mousemove", movePanelInteraction, { capture: true });
      window.addEventListener("mouseup", endPanelInteraction, { capture: true, once: true });
    } else {
      window.addEventListener("pointermove", movePanelInteraction, { capture: true });
      window.addEventListener("pointerup", endPanelInteraction, { capture: true, once: true });
      window.addEventListener("pointercancel", endPanelInteraction, { capture: true, once: true });
    }
  }

  function movePanelInteraction(event) {
    if (!activePanelInteraction) return;
    event.preventDefault();
    event.stopPropagation();

    const interaction = activePanelInteraction;
    const dx = event.clientX - interaction.startX;
    const dy = event.clientY - interaction.startY;
    let nextLayout = {
      left: interaction.startLeft,
      top: interaction.startTop,
      width: interaction.startWidth,
      height: interaction.startHeight
    };

    if (interaction.type === "move") {
      nextLayout.left += dx;
      nextLayout.top += dy;
    } else {
      if (interaction.edge.includes("e")) nextLayout.width += dx;
      if (interaction.edge.includes("s")) nextLayout.height += dy;
      if (interaction.edge.includes("w")) {
        nextLayout.left += dx;
        nextLayout.width -= dx;
      }
      if (interaction.edge.includes("n")) {
        nextLayout.top += dy;
        nextLayout.height -= dy;
      }
    }

    applyPanelLayout(interaction.panel, nextLayout);
  }

  function endPanelInteraction(event) {
    if (!activePanelInteraction) return;
    event?.preventDefault?.();
    event?.stopPropagation?.();
    activePanelInteraction.panel.classList.remove("dragging-window", "resizing");
    persistPanelLayout(activePanelInteraction.panel);
    const inputType = activePanelInteraction.inputType;
    activePanelInteraction = null;
    if (inputType === "mouse") {
      window.removeEventListener("mousemove", movePanelInteraction, { capture: true });
      window.removeEventListener("mouseup", endPanelInteraction, { capture: true });
    } else {
      window.removeEventListener("pointermove", movePanelInteraction, { capture: true });
      window.removeEventListener("pointerup", endPanelInteraction, { capture: true });
      window.removeEventListener("pointercancel", endPanelInteraction, { capture: true });
    }
  }

  function attachGmEvents(gmUi) {
    gmUi.hpInput.addEventListener("input", () => {
      gmUi.hpInput.value = sanitizeSignedHpValue(gmUi.hpInput.value, true);
    });

    gmUi.form.addEventListener("submit", (event) => {
      event.preventDefault();
      const submitter = event.submitter;
      const side = submitter instanceof HTMLElement ? submitter.dataset.addSide : "enemy";
      addEntry(side || "enemy");
    });

    gmUi.form.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || event.isComposing) return;
      if (event.target instanceof HTMLButtonElement) return;
      event.preventDefault();
      addEntry(event.shiftKey ? "ally" : "enemy");
    });

    gmUi.sortButton.addEventListener("click", () => {
      initiativeState.isManualOrder = false;
      sortEntries(initiativeState.entries);
      showGmHint("已依先攻值排序。");
      setGmState(initiativeState);
    });

    gmUi.clearButton.addEventListener("click", () => {
      if (!initiativeState.entries.length) return;
      initiativeState = { ...createDefaultGmState(), showTokenHp: initiativeState.showTokenHp };
      pendingTokenEntryId = "";
      showGmHint("列表已清空。");
      setGmState(initiativeState);
    });

    gmUi.tokenHpButton.addEventListener("click", () => {
      initiativeState.showTokenHp = !initiativeState.showTokenHp;
      setGmState(initiativeState);
    });
    document.addEventListener("mapfog:tokens-rendered", renderTokenHp);
    document.addEventListener("mapfog:add-token-to-initiative", (event) => {
      const token = window.MapFogTokens?.getState().tokens.find((token) => token.id === event.detail?.tokenId);
      if (!token) return;
      pendingTokenEntryId = token.id;
      gmUi.form.reset();
      gmUi.nameInput.value = token.name;
      if (gmUi.panel.hidden) gmUi.button.click();
      showGmHint("填入名稱、先攻與 HP，再選擇敵／友，將此 Token 加入先攻。", 0);
      gmUi.nameInput.focus();
    });

    gmUi.list.addEventListener("click", handleGmListClick);
    gmUi.list.addEventListener("input", handleGmListInput);
    gmUi.list.addEventListener("focusin", handleGmListFocusIn);
    gmUi.list.addEventListener("focusout", handleGmListFocusOut);
    gmUi.list.addEventListener("keydown", handleGmListKeydown);
    gmUi.list.addEventListener("dragstart", handleGmDragStart);
    gmUi.list.addEventListener("dragover", handleGmDragOver);
    gmUi.list.addEventListener("dragleave", handleGmDragLeave);
    gmUi.list.addEventListener("drop", handleGmDrop);
    gmUi.list.addEventListener("dragend", clearDragState);
    viewport.addEventListener("dragover", handleTokenDragOver);
    viewport.addEventListener("drop", handleTokenDrop);

    gmUi.damageInputs.forEach((input) => {
      input.addEventListener("input", () => {
        input.value = sanitizeUnsignedValue(input.value);
        updateDamageTotal();
      });
      input.addEventListener("keydown", (event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        applyHpDelta(event.shiftKey ? 1 : -1);
      });
    });

    gmUi.healButton.addEventListener("click", () => applyHpDelta(1));
    gmUi.damageButton.addEventListener("click", () => applyHpDelta(-1));
    gmUi.modalClose.addEventListener("click", closeHpModal);
    gmUi.modal.addEventListener("click", (event) => {
      if (event.target === gmUi.modal) closeHpModal();
    });
    for (const eventName of ["pointerdown", "pointermove", "pointerup", "wheel"]) {
      gmUi.modal.addEventListener(eventName, stopUiEvent, { passive: false });
    }
    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !gmUi.modal.hidden) closeHpModal();
    });
  }

  function showGmHint(message, resetDelay = 1600) {
    const hint = ui?.hint;
    if (!hint) return;

    if (gmHintResetTimer) {
      window.clearTimeout(gmHintResetTimer);
      gmHintResetTimer = 0;
    }

    hint.textContent = message || DEFAULT_GM_HINT;
    if (!message || resetDelay <= 0) return;

    gmHintResetTimer = window.setTimeout(() => {
      if (ui?.hint) ui.hint.textContent = DEFAULT_GM_HINT;
      gmHintResetTimer = 0;
    }, resetDelay);
  }

  function addEntry(side) {
    const name = cleanName(ui.nameInput.value);
    const initiative = normalizeInitiative(ui.initiativeInput.value);
    const hp = normalizeHpValue(ui.hpInput.value);
    ui.hpInput.value = hp;

    if (!name) {
      showGmHint("請輸入名稱。", 2200);
      ui.nameInput.focus();
      return;
    }

    if (initiative === null) {
      showGmHint("請輸入有效的先攻值。", 2200);
      ui.initiativeInput.focus();
      return;
    }

    const entryId = createId();
    const nextState = normalizeGmState({
      ...initiativeState,
      entries: [
        ...initiativeState.entries,
        {
          id: entryId,
          name,
          initiative,
          hp,
          side: normalizeSide(side),
          createdAt: Date.now() + Math.random()
        }
      ]
    });

    if (initiativeState.isManualOrder) nextState.isManualOrder = true;
    if (!nextState.isManualOrder) sortEntries(nextState.entries);

    ui.form.reset();
    showGmHint("已新增。");
    setGmState(nextState);
    if (pendingTokenEntryId) {
      window.MapFogTokens?.linkToInitiative(pendingTokenEntryId, entryId, name);
      pendingTokenEntryId = "";
    }
    ui.nameInput.focus();
  }

  function getEntryById(id) {
    return initiativeState.entries.find((entry) => entry.id === id) || null;
  }

  function handleGmListClick(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const tokenButton = target.closest("[data-create-token]");
    if (tokenButton instanceof HTMLElement) {
      createEntryToken(tokenButton.dataset.id || "");
      return;
    }

    const hpButton = target.closest("[data-hp-action]");
    if (hpButton instanceof HTMLElement) {
      openHpModal(hpButton.dataset.id || "");
      return;
    }

    const removeButton = target.closest("[data-remove-entry]");
    if (!(removeButton instanceof HTMLElement)) return;

    const id = removeButton.dataset.id || "";
    removeEntryById(id);
  }

  function handleGmListInput(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const id = target.dataset.id || "";
    const entry = getEntryById(id);
    if (!entry) return;

    if (target.classList.contains("initiative-hp-input")) {
      const hpValue = sanitizeSignedHpValue(target.value, true);
      target.value = hpValue;
      if (hpValue !== "-") {
        entry.hp = normalizeHpValue(hpValue);
        persistGmState();
      }
      target.closest(".initiative-hp-field")?.classList.toggle("negative", isNegativeHp(entry.hp));
    }

    if (target.classList.contains("initiative-score-input")) {
      target.value = target.value.replace(/[^\-\d]/g, "").slice(0, 4);
    }
  }

  function handleGmListFocusIn(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || !target.classList.contains("initiative-hp-input")) return;

    const entry = getEntryById(target.dataset.id || "");
    if (!entry) return;
    target.value = normalizeHpValue(entry.hp);
  }

  function handleGmListFocusOut(event) {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;

    const entry = getEntryById(target.dataset.id || "");
    if (!entry) return;

    if (target.classList.contains("initiative-hp-input")) {
      entry.hp = normalizeHpValue(target.value);
      target.value = formatHpDisplay(entry.hp);
      target.closest(".initiative-hp-field")?.classList.toggle("negative", isNegativeHp(entry.hp));
      persistGmState();
      return;
    }

    if (target.classList.contains("initiative-score-input")) {
      const nextInitiative = normalizeInitiative(target.value);
      if (nextInitiative === null) {
        target.value = String(entry.initiative);
        return;
      }
      entry.initiative = nextInitiative;
      if (!initiativeState.isManualOrder) sortEntries(initiativeState.entries);
      setGmState(initiativeState);
    }
  }

  function handleGmListKeydown(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.matches("input, button, textarea, select")) return;

    const entryElement = target.closest(".initiative-entry");
    if (!(entryElement instanceof HTMLElement)) return;

    const entryId = entryElement.dataset.id || "";
    if (!entryId) return;

    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openHpModal(entryId);
      return;
    }

    if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      removeEntryById(entryId, { focusNeighbor: true });
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveEntryByOffset(entryId, -1);
      return;
    }

    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveEntryByOffset(entryId, 1);
      return;
    }

    if (event.key === "Home") {
      event.preventDefault();
      focusEntryAtIndex(0);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      focusEntryAtIndex(initiativeState.entries.length - 1);
    }
  }

  function handleGmDragStart(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const entryElement = target.closest(".initiative-entry");
    if (!(entryElement instanceof HTMLElement)) return;

    if (target.closest("[data-create-token]")) {
      clearDragState();
      draggedTokenEntryId = entryElement.dataset.id || "";
      if (!draggedTokenEntryId) return;
      target.classList.add("dragging-token");
      if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = "copy";
        event.dataTransfer.setData("application/x-mapfog-initiative-token", draggedTokenEntryId);
      }
      return;
    }

    draggedEntryId = entryElement.dataset.id || "";
    if (!draggedEntryId) return;

    entryElement.classList.add("dragging");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedEntryId);
    }
  }

  function handleGmDragOver(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !draggedEntryId) return;

    const entryElement = target.closest(".initiative-entry");
    if (!(entryElement instanceof HTMLElement) || entryElement.dataset.id === draggedEntryId) return;

    event.preventDefault();
    clearDragHighlights();
    entryElement.classList.add("drag-over");
  }

  function handleGmDragLeave(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    target.closest(".initiative-entry")?.classList.remove("drag-over");
  }

  function handleGmDrop(event) {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const entryElement = target.closest(".initiative-entry");
    if (!(entryElement instanceof HTMLElement)) return;

    event.preventDefault();
    const targetId = entryElement.dataset.id || "";
    moveEntry(draggedEntryId, targetId);
    draggedEntryId = "";
  }

  function isTokenDropTarget(target) {
    return target instanceof Element
      && (target === viewport || Boolean(target.closest("#canvasHolder, #emptyState")));
  }

  function handleTokenDragOver(event) {
    if (!draggedTokenEntryId || !isTokenDropTarget(event.target)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  }

  function handleTokenDrop(event) {
    if (!draggedTokenEntryId || !isTokenDropTarget(event.target)) return;
    event.preventDefault();
    const entryId = draggedTokenEntryId;
    clearDragState();
    createEntryToken(entryId, { clientX: event.clientX, clientY: event.clientY });
  }

  function createEntryToken(entryId, clientPoint = null) {
    const entry = getEntryById(entryId);
    if (!entry) return;
    const result = window.MapFogTokens?.createFromInitiative(entry, clientPoint);
    showGmHint(result?.error || (result?.token ? `已建立 ${entry.name} token。` : "目前無法建立 token。"), 2200);
  }

  function clearDragHighlights() {
    ui.list?.querySelectorAll(".dragging, .drag-over, .dragging-token").forEach((entry) => {
      entry.classList.remove("dragging", "drag-over", "dragging-token");
    });
  }

  function clearDragState() {
    clearDragHighlights();
    draggedEntryId = "";
    draggedTokenEntryId = "";
  }

  function removeEntryById(entryId, options = {}) {
    const index = initiativeState.entries.findIndex((entry) => entry.id === entryId);
    if (index === -1) return;

    initiativeState.entries.splice(index, 1);
    showGmHint("已移除。");
    const nextFocusIndex = Math.min(index, initiativeState.entries.length - 1);
    setGmState(initiativeState);

    if (options.focusNeighbor && nextFocusIndex >= 0) {
      focusEntryAtIndex(nextFocusIndex);
    } else if (options.focusNeighbor) {
      ui.nameInput?.focus();
    }
  }

  function moveEntry(draggedId, targetId) {
    if (!draggedId || !targetId || draggedId === targetId) return;

    const fromIndex = initiativeState.entries.findIndex((entry) => entry.id === draggedId);
    const toIndex = initiativeState.entries.findIndex((entry) => entry.id === targetId);
    if (fromIndex === -1 || toIndex === -1) return;

    const [draggedEntry] = initiativeState.entries.splice(fromIndex, 1);
    initiativeState.entries.splice(toIndex, 0, draggedEntry);
    initiativeState.isManualOrder = true;
    showGmHint("已改為手動排序。");
    setGmState(initiativeState);
  }

  function moveEntryByOffset(entryId, offset) {
    const fromIndex = initiativeState.entries.findIndex((entry) => entry.id === entryId);
    if (fromIndex === -1) return;

    const toIndex = clamp(fromIndex + offset, 0, initiativeState.entries.length - 1);
    if (toIndex === fromIndex) return;

    const [entry] = initiativeState.entries.splice(fromIndex, 1);
    initiativeState.entries.splice(toIndex, 0, entry);
    initiativeState.isManualOrder = true;
    showGmHint("已改為手動排序。");
    setGmState(initiativeState);
    focusEntryById(entryId);
  }

  function safeCssEscape(value) {
    if (window.CSS?.escape) return window.CSS.escape(value);
    return String(value).replace(/["\\]/g, "\\$&");
  }

  function focusEntryById(entryId) {
    window.requestAnimationFrame(() => {
      const entryElement = ui.list?.querySelector(`[data-id="${safeCssEscape(entryId)}"]`);
      if (!(entryElement instanceof HTMLElement)) return;
      entryElement.focus();
      entryElement.scrollIntoView({ block: "nearest" });
    });
  }

  function focusEntryAtIndex(index) {
    const entry = initiativeState.entries[index];
    if (entry) focusEntryById(entry.id);
  }

  function calculateDamageTotal() {
    const [normalInput, halfInput, vulnerableInput] = ui.damageInputs;
    const normalDamage = Number(sanitizeUnsignedValue(normalInput.value)) || 0;
    const halfDamage = Number(sanitizeUnsignedValue(halfInput.value)) || 0;
    const vulnerableDamage = Number(sanitizeUnsignedValue(vulnerableInput.value)) || 0;
    return normalDamage + Math.floor(halfDamage / 2) + vulnerableDamage * 2;
  }

  function updateDamageTotal() {
    ui.damageTotal.textContent = String(calculateDamageTotal());
  }

  function clearDamageInputs() {
    ui.damageInputs.forEach((input) => {
      input.value = "";
    });
    updateDamageTotal();
  }

  function openHpModal(entryId) {
    const entry = getEntryById(entryId);
    if (!entry) return;

    activeHpEntryId = entryId;
    ui.modalTarget.textContent = `${entry.name} HP ${formatHpDisplay(entry.hp) || "0"}`;
    ui.modalTarget.classList.toggle("negative", isNegativeHp(entry.hp));
    clearDamageInputs();
    ui.modal.hidden = false;
    ui.damageInputs[0].focus();
  }

  function closeHpModal() {
    ui.modal.hidden = true;
    activeHpEntryId = "";
  }

  function applyHpDelta(direction) {
    const entry = getEntryById(activeHpEntryId);
    if (!entry) return;

    const nextHp = getHpNumber(entry.hp) + direction * calculateDamageTotal();
    entry.hp = String(clamp(nextHp, -MAX_INITIATIVE_ABS, MAX_INITIATIVE_ABS));
    closeHpModal();
    renderGmList();
    persistGmState();
  }

  function getTokenInitiativeEntry(token) {
    if (token.initiativeEntryId) return getEntryById(token.initiativeEntryId);
    // Match older tokens only when the complete name identifies one entry.
    const matches = initiativeState.entries.filter((entry) => entry.name === token.name);
    return matches.length === 1 ? matches[0] : null;
  }

  function renderTokenHp() {
    if (!isGmPage) return;
    const tokenLayer = document.getElementById("tokenLayer");
    const tokenState = window.MapFogTokens?.getState();
    if (!tokenLayer || !tokenState) return;
    const selected = tokenState.tokens.find((token) => token.id === tokenState.selectedTokenId);
    const addButton = document.getElementById("tokenAddInitiativeBtn");
    if (addButton) {
      const linked = selected && getTokenInitiativeEntry(selected);
      addButton.disabled = !selected || Boolean(linked);
      addButton.textContent = linked ? "已加入先攻" : "加入先攻";
    }

    const visibleIds = new Set();
    const anchors = new Map(Array.from(tokenLayer.querySelectorAll(".token-hp-anchor"))
      .map((anchor) => [anchor.dataset.hpTokenId, anchor]));
    for (const token of tokenState.tokens) {
      const entry = getTokenInitiativeEntry(token);
      if (!initiativeState.showTokenHp || !entry || !token.visible || !token.imageHash) continue;
      visibleIds.add(token.id);
      let anchor = anchors.get(token.id);
      if (!anchor) {
        anchor = document.createElement("span");
        anchor.className = "token-hp-anchor";
        anchor.dataset.hpTokenId = token.id;
        const label = document.createElement("span");
        label.className = "token-hp-label";
        anchor.appendChild(label);
        tokenLayer.appendChild(anchor);
      }
      anchor.classList.toggle("enemy", entry.side === "enemy");
      anchor.classList.toggle("selected", token.id === tokenState.selectedTokenId);
      anchor.style.transform = `translate(${token.x}px, ${token.y}px) rotate(var(--token-rotation, 0deg))`;
      const label = anchor.firstElementChild;
      label.textContent = String(getHpNumber(entry.hp));
      label.style.fontSize = `${token.hpFontSize || 24}px`;
      label.style.bottom = `${token.size / 2 + 4}px`;
      label.setAttribute("aria-label", `${entry.name} HP ${getHpNumber(entry.hp)}`);
    }
    tokenLayer.querySelectorAll(".token-hp-anchor").forEach((anchor) => {
      if (!visibleIds.has(anchor.dataset.hpTokenId)) anchor.remove();
    });
  }

  function renderGmList() {
    if (!isGmPage || !ui?.list) return;

    ui.count.textContent = `${initiativeState.entries.length} 位`;
    ui.sortButton.classList.toggle("active", !initiativeState.isManualOrder && initiativeState.entries.length > 1);
    ui.tokenHpButton.classList.toggle("active", initiativeState.showTokenHp);
    ui.tokenHpButton.setAttribute("aria-pressed", String(initiativeState.showTokenHp));
    ui.tokenHpButton.title = `${initiativeState.showTokenHp ? "隱藏" : "顯示"} Token HP（僅 GM 可見）`;
    renderTokenHp();
    ui.list.replaceChildren();

    if (!initiativeState.entries.length) {
      const empty = document.createElement("div");
      empty.className = "initiative-empty";
      empty.textContent = "目前沒有單位。";
      ui.list.appendChild(empty);
      return;
    }

    initiativeState.entries.forEach((entry, index) => {
      ui.list.appendChild(createGmEntryElement(entry, index));
    });
  }

  function createGmEntryElement(entry, index) {
    const article = document.createElement("article");
    article.className = `initiative-entry gm-entry ${entry.side}`;
    article.dataset.id = entry.id;
    article.draggable = true;
    article.tabIndex = 0;
    article.setAttribute("role", "listitem");
    article.setAttribute("aria-label", `第 ${index + 1} 位，${entry.name}，先攻 ${entry.initiative}，HP ${formatHpDisplay(entry.hp) || "0"}`);

    const order = document.createElement("div");
    order.className = "initiative-order";
    order.textContent = `#${index + 1}`;
    order.title = "拖曳排序；列取得焦點後可用方向鍵上下移動";

    const name = document.createElement("button");
    name.type = "button";
    name.className = "initiative-name initiative-token-name";
    name.dataset.id = entry.id;
    name.dataset.createToken = "true";
    name.draggable = true;
    name.textContent = entry.name;
    name.title = `${entry.name}：拖曳到地圖建立 token；點擊放在地圖中央`;
    name.setAttribute("aria-label", `建立 ${entry.name} token（點擊放在地圖中央，或拖曳到地圖）`);

    const initiativeField = document.createElement("label");
    initiativeField.className = "initiative-stat-field";
    const initiativeLabel = document.createElement("span");
    initiativeLabel.className = "initiative-visually-hidden";
    initiativeLabel.textContent = `${entry.name} 先攻`;
    const initiativeInput = document.createElement("input");
    initiativeInput.className = "initiative-score-input";
    initiativeInput.type = "number";
    initiativeInput.min = "-999";
    initiativeInput.max = "999";
    initiativeInput.step = "1";
    initiativeInput.value = String(entry.initiative);
    initiativeInput.dataset.id = entry.id;
    initiativeInput.setAttribute("aria-label", `${entry.name} 先攻`);
    initiativeField.append(initiativeLabel, initiativeInput);

    const hpField = document.createElement("div");
    hpField.className = `initiative-hp-field${isNegativeHp(entry.hp) ? " negative" : ""}`;
    const hpButton = document.createElement("button");
    hpButton.className = "initiative-hp-button";
    hpButton.type = "button";
    hpButton.dataset.id = entry.id;
    hpButton.dataset.hpAction = "true";
    hpButton.textContent = "HP";
    hpButton.title = `開啟 ${entry.name} HP 計算`;
    hpButton.setAttribute("aria-label", `開啟 ${entry.name} HP 計算`);
    const hpInput = document.createElement("input");
    hpInput.className = "initiative-hp-input";
    hpInput.type = "text";
    hpInput.inputMode = "numeric";
    hpInput.maxLength = 4;
    hpInput.pattern = "-?[0-9]{0,3}";
    hpInput.value = formatHpDisplay(entry.hp);
    hpInput.dataset.id = entry.id;
    hpInput.setAttribute("aria-label", `${entry.name} HP`);
    hpField.append(hpButton, hpInput);

    const remove = document.createElement("button");
    remove.className = "initiative-remove-button";
    remove.type = "button";
    remove.dataset.id = entry.id;
    remove.dataset.removeEntry = "true";
    remove.title = `移除 ${entry.name}`;
    remove.setAttribute("aria-label", `移除 ${entry.name}`);
    remove.textContent = "×";

    article.append(order, name, initiativeField, hpField, remove);
    return article;
  }

  function renderPublicList() {
    if (isGmPage || !ui?.list) return;

    ui.count.textContent = `${publicState.entries.length} 位`;
    ui.list.replaceChildren();

    if (!publicState.entries.length) {
      const empty = document.createElement("div");
      empty.className = "initiative-empty";
      empty.textContent = "等待 GM 更新先攻。";
      ui.list.appendChild(empty);
      return;
    }

    publicState.entries.forEach((entry, index) => {
      const row = document.createElement("div");
      row.className = `initiative-entry public-entry ${entry.side}`;
      row.setAttribute("role", "listitem");
      row.setAttribute("aria-label", `第 ${index + 1} 位，${entry.name}`);

      const order = document.createElement("div");
      order.className = "initiative-order";
      order.textContent = String(index + 1);

      const name = document.createElement("div");
      name.className = "initiative-name";
      name.textContent = entry.name;
      name.title = entry.name;

      row.append(order, name);
      ui.list.appendChild(row);
    });
  }

  function injectInitiativeStyles() {
    if (document.getElementById("mapfogInitiativeStyles")) return;

    const style = document.createElement("style");
    style.id = "mapfogInitiativeStyles";
    style.textContent = `
      .token-hp-anchor {
        position: absolute;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        transform-origin: 0 0;
        pointer-events: none;
        z-index: 0;
      }
      .token-hp-anchor.selected { z-index: 2; }
      .token-hp-label {
        position: absolute;
        left: 0;
        transform: translateX(-50%);
        color: #4ade80;
        font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
        font-weight: 800;
        line-height: 1.15;
        white-space: nowrap;
        text-shadow: -1px -1px 2px #020617, 1px 1px 2px #020617, 0 0 4px #020617;
      }
      .token-hp-anchor.enemy .token-hp-label { color: #f87171; }
      .gm-page .token-panel { z-index: 36; overflow-y: auto; }
      .gm-page .token-panel > * { flex-shrink: 0; }
      .token-hp-help { color: #cbd5e1; font-size: 12px; }
      .mapfog-initiative-panel {
        position: absolute;
        box-sizing: border-box;
        top: 72px;
        left: 12px;
        z-index: 33;
        /* 名稱欄約 6 個中文字，過長以「…」截斷；拉寬面板時名稱欄跟著變寬。 */
        width: min(308px, calc(100vw - 16px));
        min-width: 280px;
        min-height: 240px;
        max-height: calc(100svh - 88px);
        display: grid;
        grid-template-rows: auto auto minmax(0, 1fr);
        gap: 6px;
        padding: 8px;
        border: 1px solid rgba(148, 163, 184, 0.34);
        border-radius: 8px;
        background: rgba(11, 18, 32, 0.92);
        color: #f8fafc;
        box-shadow: 0 16px 34px rgba(0, 0, 0, 0.38);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        overflow: hidden;
      }
      .gm-initiative-panel.dragging-window,
      .gm-initiative-panel.resizing {
        user-select: none;
        -webkit-user-select: none;
      }
      .mapfog-initiative-panel[hidden],
      .initiative-modal-backdrop[hidden] {
        display: none !important;
      }
      .public-initiative-panel {
        width: min(292px, calc(100vw - 28px));
        grid-template-rows: auto minmax(0, 1fr);
      }
      .initiative-panel-header,
      .initiative-entry-top,
      .initiative-list-actions,
      .initiative-modal-header,
      .initiative-modal-footer {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
      }
      .gm-initiative-panel .initiative-panel-header {
        position: relative;
        z-index: 7;
        cursor: move;
        touch-action: none;
      }
      .gm-initiative-panel .initiative-panel-header button {
        cursor: pointer;
      }
      .initiative-heading,
      .initiative-header-actions {
        display: flex;
        align-items: center;
      }
      .initiative-heading {
        min-width: 0;
        gap: 7px;
      }
      .initiative-header-actions {
        flex: 0 0 auto;
        gap: 4px;
      }
      .initiative-visually-hidden {
        position: absolute !important;
        width: 1px !important;
        height: 1px !important;
        padding: 0 !important;
        margin: -1px !important;
        overflow: hidden !important;
        clip: rect(0, 0, 0, 0) !important;
        white-space: nowrap !important;
        border: 0 !important;
      }
      .initiative-resize-handle {
        position: absolute;
        z-index: 8;
        background: transparent;
        touch-action: none;
      }
      .initiative-resize-handle::after {
        content: "";
        position: absolute;
        inset: 0;
        opacity: 0;
        transition: opacity 0.12s ease;
      }
      .initiative-resize-handle:hover::after,
      .gm-initiative-panel.resizing .initiative-resize-handle::after {
        opacity: 1;
      }
      .resize-n,
      .resize-s {
        left: 12px;
        right: 12px;
        height: 8px;
        cursor: ns-resize;
      }
      .resize-n { top: 0; }
      .resize-s { bottom: 0; }
      .resize-e,
      .resize-w {
        top: 12px;
        bottom: 12px;
        width: 8px;
        cursor: ew-resize;
      }
      .resize-e { right: 0; }
      .resize-w { left: 0; }
      .resize-ne,
      .resize-nw,
      .resize-se,
      .resize-sw {
        width: 16px;
        height: 16px;
      }
      .resize-ne {
        top: 0;
        right: 0;
        cursor: nesw-resize;
      }
      .resize-nw {
        top: 0;
        left: 0;
        cursor: nwse-resize;
      }
      .resize-se {
        right: 0;
        bottom: 0;
        cursor: nwse-resize;
      }
      .resize-sw {
        left: 0;
        bottom: 0;
        cursor: nesw-resize;
      }
      .resize-s::after,
      .resize-se::after,
      .resize-sw::after {
        border-bottom: 2px solid rgba(56, 189, 248, 0.72);
      }
      .resize-e::after,
      .resize-ne::after,
      .resize-se::after {
        border-right: 2px solid rgba(56, 189, 248, 0.72);
      }
      .resize-n::after,
      .resize-ne::after,
      .resize-nw::after {
        border-top: 2px solid rgba(56, 189, 248, 0.72);
      }
      .resize-w::after,
      .resize-nw::after,
      .resize-sw::after {
        border-left: 2px solid rgba(56, 189, 248, 0.72);
      }
      .initiative-panel-title {
        font-size: 14px;
        font-weight: 900;
        letter-spacing: 0;
      }
      .initiative-panel-meta,
      .initiative-hint {
        color: rgba(203, 213, 225, 0.82);
        font-size: 11px;
        line-height: 1.25;
      }
      .initiative-hint {
        min-height: 14px;
        padding-inline: 2px;
      }
      .initiative-icon-button {
        width: 28px;
        height: 28px;
        min-width: 28px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 1px solid rgba(148, 163, 184, 0.36);
        border-radius: 8px;
        background: rgba(2, 6, 23, 0.7);
        color: #f8fafc;
        cursor: pointer;
      }
      .initiative-icon-button:hover,
      .initiative-secondary-button:hover,
      .initiative-add-button:hover {
        border-color: #38bdf8;
      }
      .initiative-icon-button:focus-visible,
      .initiative-secondary-button:focus-visible,
      .initiative-add-button:focus-visible,
      .initiative-remove-button:focus-visible,
      .initiative-hp-button:focus-visible,
      .initiative-calc-button:focus-visible,
      .initiative-entry:focus-visible,
      .initiative-tool-button:focus-visible {
        outline: none;
        border-color: rgba(56, 189, 248, 0.95);
        box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.24), 0 8px 18px rgba(0, 0, 0, 0.24);
      }
      .initiative-icon-button svg {
        width: 16px;
        height: 16px;
        stroke: currentColor;
        fill: none;
        stroke-width: 2;
        stroke-linecap: round;
        stroke-linejoin: round;
        pointer-events: none;
      }
      .initiative-form {
        display: grid;
        gap: 3px;
      }
      .initiative-form-grid {
        display: grid;
        grid-template-columns: minmax(72px, 1fr) 52px 52px 34px 34px;
        gap: 4px;
        align-items: center;
      }
      .initiative-compact-field,
      .initiative-stat-field,
      .initiative-damage-grid label {
        display: grid;
        min-width: 0;
      }
      .initiative-damage-grid label {
        gap: 5px;
      }
      .initiative-damage-grid span {
        color: rgba(203, 213, 225, 0.82);
        font-size: 12px;
        font-weight: 750;
      }
      .initiative-form input,
      .initiative-score-input,
      .initiative-hp-input,
      .initiative-damage-grid input {
        width: 100%;
        min-width: 0;
        height: 30px;
        border: 1px solid rgba(148, 163, 184, 0.32);
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.88);
        color: #f8fafc;
        font: inherit;
        font-size: 13px;
        font-weight: 750;
        outline: none;
      }
      .initiative-form input,
      .initiative-score-input {
        padding: 0 7px;
      }
      .initiative-hp-input,
      .initiative-damage-grid input {
        padding: 0 5px;
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .initiative-form input::placeholder {
        color: rgba(203, 213, 225, 0.5);
      }
      .initiative-form input[type="number"] {
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .initiative-form input:focus,
      .initiative-score-input:focus,
      .initiative-hp-input:focus,
      .initiative-damage-grid input:focus {
        border-color: rgba(56, 189, 248, 0.82);
        box-shadow: 0 0 0 1px rgba(56, 189, 248, 0.22) inset;
      }
      .initiative-add-button,
      .initiative-secondary-button {
        width: 100%;
        min-width: 0;
        min-height: 30px;
        border: 1px solid rgba(148, 163, 184, 0.34);
        border-radius: 6px;
        color: #f8fafc;
        cursor: pointer;
        font: inherit;
        font-size: 12px;
        font-weight: 850;
      }
      .initiative-header-actions .initiative-secondary-button {
        width: auto;
        min-height: 28px;
        padding: 0 7px;
        font-size: 11px;
      }
      .initiative-add-button.enemy,
      .initiative-entry.enemy {
        border-color: rgba(248, 113, 113, 0.42);
        background: linear-gradient(135deg, rgba(127, 29, 29, 0.84), rgba(15, 23, 42, 0.82));
      }
      .initiative-add-button.ally,
      .initiative-entry.ally {
        border-color: rgba(74, 222, 128, 0.42);
        background: linear-gradient(135deg, rgba(20, 83, 45, 0.84), rgba(15, 23, 42, 0.82));
      }
      .initiative-secondary-button {
        background: rgba(2, 6, 23, 0.68);
      }
      .initiative-secondary-button.active {
        border-color: rgba(56, 189, 248, 0.58);
      }
      .initiative-secondary-button.danger:hover {
        border-color: #ef4444;
      }
      .initiative-list {
        min-height: 0;
        overflow: auto;
        display: grid;
        /* 面板高度固定時（平板、拉過大小）：列數少不要把每列撐高，列數多不要把每列壓扁到重疊。 */
        align-content: start;
        grid-auto-rows: max-content;
        gap: 4px;
        padding-right: 2px;
        overscroll-behavior: contain;
        scrollbar-width: thin;
      }
      .initiative-entry {
        min-width: 0;
        border: 1px solid rgba(148, 163, 184, 0.3);
        border-radius: 6px;
        box-shadow: 0 6px 14px rgba(0, 0, 0, 0.2);
      }
      .gm-entry {
        display: grid;
        grid-template-columns: 27px minmax(64px, 1fr) 46px 68px 24px;
        gap: 4px;
        align-items: center;
        min-height: 36px;
        padding: 3px 5px;
        box-shadow: none;
      }
      .initiative-entry.dragging {
        opacity: 0.58;
      }
      .initiative-entry.drag-over {
        border-color: rgba(56, 189, 248, 0.9);
        box-shadow: inset 0 0 0 1px rgba(56, 189, 248, 0.34), 0 8px 18px rgba(0, 0, 0, 0.24);
      }
      .initiative-order {
        flex: 0 0 auto;
        min-width: 27px;
        height: 24px;
        display: inline-grid;
        place-items: center;
        border-radius: 5px;
        background: rgba(2, 6, 23, 0.58);
        color: rgba(248, 250, 252, 0.94);
        font-size: 12px;
        font-weight: 900;
        font-variant-numeric: tabular-nums;
      }
      .initiative-name {
        min-width: 0;
        flex: 1 1 auto;
        overflow: hidden;
        color: #f8fafc;
        font-size: 14px;
        font-weight: 850;
        line-height: 1.25;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .initiative-token-name {
        padding: 3px 4px;
        border: 1px solid transparent;
        border-radius: 4px;
        background: transparent;
        font-family: inherit;
        text-align: left;
        cursor: grab;
      }
      .initiative-token-name:hover,
      .initiative-token-name:focus-visible {
        border-color: rgba(248, 250, 252, 0.65);
        background: rgba(248, 250, 252, 0.1);
      }
      .initiative-token-name:focus-visible {
        outline: 2px solid #38bdf8;
        outline-offset: 1px;
      }
      .initiative-token-name:active,
      .initiative-token-name.dragging-token {
        cursor: grabbing;
        opacity: 0.65;
      }
      .initiative-remove-button {
        width: 24px;
        height: 26px;
        min-width: 24px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 5px;
        background: rgba(2, 6, 23, 0.2);
        color: rgba(248, 250, 252, 0.66);
        cursor: pointer;
        font-size: 15px;
        font-weight: 850;
        line-height: 1;
      }
      .initiative-remove-button:hover {
        border-color: rgba(248, 113, 113, 0.72);
        color: #fecaca;
      }
      .initiative-stat-field,
      .initiative-hp-field {
        min-width: 0;
      }
      .initiative-hp-field {
        display: grid;
        grid-template-columns: 27px minmax(0, 1fr);
        gap: 2px;
        align-items: center;
        padding: 1px;
        border: 1px solid rgba(148, 163, 184, 0.16);
        border-radius: 6px;
        background: rgba(2, 6, 23, 0.2);
      }
      .initiative-hp-field.negative {
        border-color: rgba(248, 113, 113, 0.56);
        background: rgba(127, 29, 29, 0.32);
      }
      .initiative-hp-button {
        height: 26px;
        padding: 0;
        border: 0;
        border-radius: 5px;
        background: rgba(15, 23, 42, 0.76);
        color: rgba(203, 213, 225, 0.78);
        cursor: pointer;
        font-size: 10px;
        font-weight: 900;
      }
      .gm-entry .initiative-score-input,
      .gm-entry .initiative-hp-input {
        height: 28px;
        border-radius: 5px;
        font-size: 12px;
        padding-inline: 4px;
      }
      .initiative-hp-button:hover {
        color: #38bdf8;
      }
      .public-entry {
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 40px;
        padding: 8px;
      }
      .public-entry .initiative-order {
        min-width: 28px;
        height: 26px;
      }
      .public-entry.enemy {
        background: linear-gradient(90deg, rgba(127, 29, 29, 0.9), rgba(15, 23, 42, 0.78));
      }
      .public-entry.ally {
        background: linear-gradient(90deg, rgba(20, 83, 45, 0.9), rgba(15, 23, 42, 0.78));
      }
      .initiative-empty {
        display: grid;
        min-height: 54px;
        place-items: center;
        border: 1px dashed rgba(148, 163, 184, 0.34);
        border-radius: 8px;
        color: rgba(203, 213, 225, 0.8);
        font-size: 13px;
        text-align: center;
      }
      .initiative-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 80;
        display: grid;
        place-items: center;
        padding: 16px;
        background: rgba(2, 6, 23, 0.62);
      }
      .initiative-hp-modal {
        width: min(460px, 100%);
        display: grid;
        gap: 14px;
        padding: 14px;
        border: 1px solid rgba(148, 163, 184, 0.42);
        border-radius: 8px;
        background: rgba(11, 18, 32, 0.96);
        color: #f8fafc;
        box-shadow: 0 24px 70px rgba(0, 0, 0, 0.42);
      }
      .initiative-modal-target {
        color: rgba(203, 213, 225, 0.86);
        font-size: 13px;
        font-weight: 800;
      }
      .initiative-modal-target.negative {
        color: #fca5a5;
      }
      .initiative-modal-title {
        margin-top: 2px;
        font-size: 16px;
        font-weight: 900;
      }
      .initiative-damage-grid {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
      }
      .initiative-damage-grid input {
        height: 48px;
        font-size: 20px;
        font-weight: 900;
      }
      .initiative-damage-total {
        display: grid;
        gap: 2px;
      }
      .initiative-damage-total span {
        color: rgba(203, 213, 225, 0.84);
        font-size: 12px;
        font-weight: 800;
      }
      .initiative-damage-total strong {
        font-size: 24px;
        font-variant-numeric: tabular-nums;
      }
      .initiative-modal-actions {
        display: flex;
        gap: 8px;
      }
      .initiative-calc-button {
        width: 58px;
        height: 44px;
        border: 0;
        border-radius: 8px;
        color: #fff;
        cursor: pointer;
        font-size: 24px;
        font-weight: 900;
      }
      .initiative-calc-button.heal {
        background: #15803d;
      }
      .initiative-calc-button.damage {
        background: #b91c1c;
      }
      @media (max-width: 700px) {
        .mapfog-initiative-panel {
          top: 64px;
          left: 8px;
          width: min(308px, calc(100vw - 16px));
          max-height: calc(100svh - 76px);
        }
        .public-initiative-panel {
          top: 62px;
          width: min(292px, calc(100vw - 16px));
          max-height: 42svh;
        }
        .initiative-form-grid {
          grid-template-columns: minmax(64px, 1fr) 48px 48px 32px 32px;
        }
      }
      @media (max-width: 430px) {
        .initiative-damage-grid {
          grid-template-columns: 1fr;
        }
        .gm-entry {
          grid-template-columns: 25px minmax(58px, 1fr) 44px 64px 22px;
          gap: 3px;
          padding-inline: 4px;
        }
        .initiative-header-actions .initiative-secondary-button {
          padding-inline: 5px;
        }
      }
    `;
    document.head.appendChild(style);
  }
})();
