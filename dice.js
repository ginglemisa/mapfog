(function () {
  const PRIMARY_DICE_SIDES = [100];
  const QUICK_DICE_SIDES = [20, 12, 10, 8, 6, 4];
  const HISTORY_LIMIT = 20;
  const AUTO_HIDE_MS = 8000;
  const CHANNEL_NAME = "mapfog.sync.v1";
  const ROLL_STORAGE_KEY = "mapfog.dice.roll";
  const ROLE = document.body.classList.contains("gm-page") ? "GM" : "PL";
  const NICKNAME_STORAGE_KEY = `mapfog.dice.nickname.${ROLE.toLowerCase()}`;
  const clientId = makeId();

  const viewport = document.getElementById("viewport");
  const floatingToolbar = document.getElementById("floatingToolbar");
  const fogCanvas = document.getElementById("fogCanvas");
  if (!viewport || !floatingToolbar) return;

  let firebaseSync = null;
  let diceGroups = [];
  let history = [];
  let seenRollIds = new Set();
  let autoHideTimer = null;
  let isHot = false;
  let suppressLog = false;
  let touchScroll = null;

  const syncChannel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;

  injectDiceStyles();

  const diceToggleBtn = createDiceToggleButton();
  const diceToolbar = createDiceToolbar();
  const diceLogPanel = createDiceLogPanel();
  const diceLogItems = diceLogPanel.querySelector(".dice-log-items");

  const nicknameInput = diceToolbar.querySelector("#diceNicknameInput");
  const modifierInput = diceToolbar.querySelector("#diceModifierInput");
  const rollBtn = diceToolbar.querySelector("#diceRollBtn");
  const clearBtn = diceToolbar.querySelector("#diceClearBtn");
  const diceButtons = Array.from(diceToolbar.querySelectorAll("[data-dice-sides]"));

  floatingToolbar.appendChild(diceToggleBtn);
  viewport.appendChild(diceToolbar);
  viewport.appendChild(diceLogPanel);

  hydrateNickname();
  updateDiceControls();
  renderHistory();
  attachUiEvents();
  attachSyncEvents();
  attachFirebaseWhenReady();

  function makeId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function injectDiceStyles() {
    if (document.getElementById("mapfogDiceStyles")) return;

    const style = document.createElement("style");
    style.id = "mapfogDiceStyles";
    style.textContent = `
      .dice-toolbar {
        position: absolute;
        top: 76px;
        left: 50%;
        z-index: 32;
        display: grid;
        grid-template-rows: repeat(2, 36px);
        gap: 6px;
        max-width: calc(100% - 16px);
        padding: 7px;
        border: 1px solid rgba(148, 163, 184, 0.36);
        border-radius: 14px;
        background: rgba(2, 6, 23, 0.78);
        box-shadow: 0 12px 28px rgba(0, 0, 0, 0.34);
        backdrop-filter: blur(8px);
        -webkit-backdrop-filter: blur(8px);
        overflow-x: auto;
        transform: translateX(-50%);
        touch-action: pan-x;
        scrollbar-width: thin;
      }
      .dice-toolbar-row {
        display: grid;
        gap: 6px;
        align-items: center;
      }
      .dice-toolbar-row-top {
        grid-template-columns: 96px 48px 44px 58px 58px;
      }
      .dice-toolbar-row-bottom {
        grid-template-columns: repeat(6, 48px);
      }
      body:not(.gm-page) .dice-toolbar {
        position: fixed;
        top: 78px;
        right: 14px;
        left: auto;
        transform: none;
      }
      .floating-toolbar.collapsed ~ .dice-toolbar,
      .dice-toolbar[hidden] {
        display: none !important;
      }
      .dice-nickname-input,
      .dice-modifier-input {
        width: 100%;
        min-width: 0;
        height: 36px;
        border: 1px solid rgba(148, 163, 184, 0.36);
        border-radius: 9px;
        background: rgba(15, 23, 42, 0.88);
        color: #f8fafc;
        font-size: 14px;
        font-weight: 700;
        outline: none;
      }
      .dice-nickname-input {
        padding: 0 9px;
      }
      .dice-modifier-input {
        padding: 0 7px;
        text-align: center;
      }
      .dice-nickname-input::placeholder,
      .dice-modifier-input::placeholder {
        color: rgba(203, 213, 225, 0.76);
      }
      .dice-modifier-input.invalid {
        border-color: rgba(239, 68, 68, 0.86);
        box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.22) inset;
      }
      .dice-choice-button,
      .dice-action-button {
        width: 100%;
        min-width: 0;
        height: 36px;
        padding: 0 5px;
        border: 1px solid rgba(148, 163, 184, 0.36);
        border-radius: 9px;
        background: rgba(2, 6, 23, 0.82);
        color: #f8fafc;
        cursor: pointer;
        font-size: 13px;
        font-weight: 800;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .dice-choice-button:hover,
      .dice-action-button:hover {
        border-color: #38bdf8;
        background: rgba(15, 23, 42, 0.92);
      }
      .dice-choice-button.active {
        border-color: rgba(56, 189, 248, 0.82);
        background: rgba(8, 47, 73, 0.88);
      }
      .dice-action-button:disabled {
        cursor: not-allowed;
        opacity: 0.48;
      }
      .dice-clear-button:hover {
        border-color: #ef4444;
      }
      .dice-log-panel {
        position: absolute;
        left: 16px;
        bottom: 16px;
        z-index: 28;
        width: min(360px, calc(100% - 32px));
        max-height: min(260px, 34%);
        padding: 10px;
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 14px;
        background: rgba(2, 6, 23, 0.62);
        color: #f8fafc;
        box-shadow: 0 12px 26px rgba(0, 0, 0, 0.34);
        backdrop-filter: blur(7px);
        -webkit-backdrop-filter: blur(7px);
        opacity: 0;
        visibility: hidden;
        transform: translateY(8px);
        transition: opacity 0.16s ease, transform 0.16s ease, visibility 0.16s ease;
        pointer-events: none;
        user-select: none;
      }
      .dice-log-panel.visible {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
      }
      .dice-log-title {
        margin-bottom: 6px;
        color: rgba(203, 213, 225, 0.9);
        font-size: 12px;
        font-weight: 800;
        letter-spacing: 0.04em;
      }
      .dice-log-items {
        max-height: calc(min(260px, 34vh) - 34px);
        overflow-y: auto;
        overscroll-behavior: contain;
        padding-right: 4px;
        scrollbar-width: thin;
      }
      .dice-log-empty {
        color: rgba(203, 213, 225, 0.78);
        font-size: 13px;
        line-height: 1.5;
      }
      .dice-log-entry {
        padding: 7px 0;
        border-top: 1px solid rgba(148, 163, 184, 0.22);
        font-size: 14px;
        line-height: 1.45;
        white-space: normal;
        word-break: break-word;
      }
      .dice-log-entry:first-child {
        border-top: 0;
        padding-top: 0;
      }
      .dice-log-entry-formula {
        font-weight: 850;
      }
      .dice-log-entry-result {
        color: rgba(248, 250, 252, 0.92);
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      @media (max-width: 700px) {
        .dice-toolbar {
          top: 64px;
          gap: 5px;
          padding: 6px;
          grid-template-rows: repeat(2, 34px);
        }
        body:not(.gm-page) .dice-toolbar {
          top: 68px;
          right: 8px;
        }
        .dice-toolbar-row {
          gap: 5px;
        }
        .dice-toolbar-row-top {
          grid-template-columns: 78px 44px 44px 52px 52px;
        }
        .dice-toolbar-row-bottom {
          grid-template-columns: repeat(6, 44px);
        }
        .dice-choice-button,
        .dice-action-button {
          height: 34px;
          padding: 0 4px;
          font-size: 13px;
        }
        .dice-nickname-input,
        .dice-modifier-input {
          height: 34px;
        }
        .dice-log-panel {
          left: 10px;
          bottom: 10px;
          width: min(320px, calc(100% - 20px));
          max-height: min(240px, 32%);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function createDiceToggleButton() {
    const button = document.createElement("button");
    button.id = "diceToggleBtn";
    button.className = "tool-button";
    button.type = "button";
    button.title = "擲骰工具";
    button.setAttribute("aria-label", "擲骰工具");
    button.setAttribute("aria-expanded", "false");
    button.innerHTML = `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 7.5 12 3l8 4.5v9L12 21l-8-4.5z"/>
        <path d="M4 7.5 12 12l8-4.5"/>
        <path d="M12 12v9"/>
        <circle cx="9" cy="8" r="0.8" fill="currentColor" stroke="none"/>
        <circle cx="15" cy="8" r="0.8" fill="currentColor" stroke="none"/>
        <circle cx="12" cy="15" r="0.8" fill="currentColor" stroke="none"/>
      </svg>
    `;
    return button;
  }

  function createDiceToolbar() {
    const toolbar = document.createElement("div");
    toolbar.id = "diceToolbar";
    toolbar.className = "dice-toolbar";
    toolbar.hidden = true;
    toolbar.setAttribute("aria-label", "擲骰工具列");

    const topRow = document.createElement("div");
    topRow.className = "dice-toolbar-row dice-toolbar-row-top";
    const bottomRow = document.createElement("div");
    bottomRow.className = "dice-toolbar-row dice-toolbar-row-bottom";

    const nickname = document.createElement("input");
    nickname.id = "diceNicknameInput";
    nickname.className = "dice-nickname-input";
    nickname.type = "text";
    nickname.maxLength = 12;
    nickname.placeholder = "暱稱";
    nickname.setAttribute("aria-label", "擲骰暱稱");
    topRow.appendChild(nickname);

    for (const sides of PRIMARY_DICE_SIDES) {
      const button = document.createElement("button");
      button.className = "dice-choice-button";
      button.type = "button";
      button.dataset.diceSides = String(sides);
      button.textContent = String(sides);
      button.title = `加入 d${sides}`;
      button.setAttribute("aria-label", `加入 d${sides}`);
      topRow.appendChild(button);
    }

    const modifier = document.createElement("input");
    modifier.id = "diceModifierInput";
    modifier.className = "dice-modifier-input";
    modifier.type = "text";
    modifier.inputMode = "text";
    modifier.maxLength = 3;
    modifier.placeholder = "+?";
    modifier.setAttribute("aria-label", "擲骰修正值，例如 +5 或 -3");
    topRow.appendChild(modifier);

    const roll = document.createElement("button");
    roll.id = "diceRollBtn";
    roll.className = "dice-action-button";
    roll.type = "button";
    roll.textContent = "丟骰";
    topRow.appendChild(roll);

    const clear = document.createElement("button");
    clear.id = "diceClearBtn";
    clear.className = "dice-action-button dice-clear-button";
    clear.type = "button";
    clear.textContent = "清除";
    topRow.appendChild(clear);

    for (const sides of QUICK_DICE_SIDES) {
      const button = document.createElement("button");
      button.className = "dice-choice-button";
      button.type = "button";
      button.dataset.diceSides = String(sides);
      button.textContent = String(sides);
      button.title = `加入 d${sides}`;
      button.setAttribute("aria-label", `加入 d${sides}`);
      bottomRow.appendChild(button);
    }

    toolbar.appendChild(topRow);
    toolbar.appendChild(bottomRow);

    return toolbar;
  }

  function createDiceLogPanel() {
    const panel = document.createElement("div");
    panel.id = "diceLogPanel";
    panel.className = "dice-log-panel";
    panel.setAttribute("aria-live", "polite");
    panel.innerHTML = `
      <div class="dice-log-title">擲骰紀錄</div>
      <div class="dice-log-items"></div>
    `;
    return panel;
  }

  function hydrateNickname() {
    try {
      const saved = window.localStorage.getItem(NICKNAME_STORAGE_KEY);
      if (saved) nicknameInput.value = saved.slice(0, 12);
    } catch {
      // Ignore localStorage failures.
    }
  }

  function attachUiEvents() {
    diceToggleBtn.addEventListener("click", () => {
      const nextOpen = diceToolbar.hidden;
      diceToolbar.hidden = !nextOpen;
      diceToggleBtn.classList.toggle("active", nextOpen);
      diceToggleBtn.setAttribute("aria-expanded", String(nextOpen));
    });

    diceToolbar.addEventListener("pointerdown", stopUiEvent);
    diceToolbar.addEventListener("pointermove", stopUiEvent);
    diceToolbar.addEventListener("pointerup", stopUiEvent);
    diceToolbar.addEventListener("wheel", stopUiEvent, { passive: false });

    for (const button of diceButtons) {
      button.addEventListener("click", () => addDie(Number(button.dataset.diceSides)));
    }

    nicknameInput.addEventListener("input", () => {
      nicknameInput.value = nicknameInput.value.slice(0, 12);
      try {
        window.localStorage.setItem(NICKNAME_STORAGE_KEY, nicknameInput.value);
      } catch {
        // Ignore localStorage failures.
      }
    });

    modifierInput.addEventListener("input", () => {
      modifierInput.value = modifierInput.value.replace(/[^+\-\d]/g, "").slice(0, 3);
      updateDiceControls();
    });

    rollBtn.addEventListener("click", rollDice);
    clearBtn.addEventListener("click", clearDicePool);

    viewport.addEventListener("mousemove", handleViewportMouseMove, { passive: true });
    viewport.addEventListener("mouseleave", () => {
      isHot = false;
      scheduleAutoHide(500);
    });
    viewport.addEventListener("wheel", handleViewportWheel, { capture: true, passive: false });
    viewport.addEventListener("pointerdown", handleViewportPointerDownCapture, { capture: true, passive: false });
    viewport.addEventListener("pointermove", handleViewportPointerMoveCapture, { capture: true, passive: false });
    viewport.addEventListener("pointerup", handleViewportPointerUpCapture, { capture: true, passive: false });
    viewport.addEventListener("pointercancel", handleViewportPointerUpCapture, { capture: true, passive: false });

    if (fogCanvas) {
      fogCanvas.addEventListener("pointerdown", () => {
        suppressLog = true;
        hideLogPanel();
      }, { capture: true });
      for (const eventName of ["pointerup", "pointercancel", "pointerleave"]) {
        fogCanvas.addEventListener(eventName, () => {
          window.setTimeout(() => {
            suppressLog = false;
          }, 50);
        }, { capture: true });
      }
    }
  }

  function stopUiEvent(event) {
    event.stopPropagation();
  }

  function attachSyncEvents() {
    syncChannel?.addEventListener("message", (event) => {
      const message = event.data;
      if (message?.type !== "diceRoll" || !message.roll || message.clientId === clientId) return;
      receiveRoll(message.roll);
    });

    window.addEventListener("storage", (event) => {
      if (event.key !== ROLL_STORAGE_KEY || !event.newValue) return;
      try {
        const roll = JSON.parse(event.newValue);
        receiveRoll(roll);
      } catch {
        // Ignore malformed dice roll payloads.
      }
    });
  }

  function attachFirebaseWhenReady() {
    const attach = (sync) => {
      firebaseSync = sync;
      if (typeof sync.onDiceRoll === "function") {
        sync.onDiceRoll((roll) => receiveRoll(roll));
      }
    };

    if (window.MapFogFirebaseSync) {
      attach(window.MapFogFirebaseSync);
      return;
    }

    window.addEventListener("mapfog:firebase-ready", (event) => attach(event.detail), { once: true });
  }

  function addDie(sides) {
    const existing = diceGroups.find((group) => group.sides === sides);
    if (existing) {
      existing.count += 1;
    } else {
      diceGroups.push({ sides, count: 1 });
    }
    updateDiceControls();
  }

  function clearDicePool() {
    diceGroups = [];
    modifierInput.value = "";
    updateDiceControls();
  }

  function rollDice() {
    const modifier = parseModifier();
    if (!diceGroups.length || modifier.invalid) {
      updateDiceControls();
      return;
    }

    const rolls = [];
    let total = 0;
    for (const group of diceGroups) {
      for (let i = 0; i < group.count; i += 1) {
        const value = Math.floor(Math.random() * group.sides) + 1;
        rolls.push(value);
        total += value;
      }
    }
    total += modifier.value;

    const roll = {
      id: makeId(),
      role: ROLE,
      nickname: cleanNickname(nicknameInput.value),
      formula: buildFormula(modifier.text),
      rolls,
      modifier: modifier.value,
      modifierText: modifier.text,
      total,
      createdAt: Date.now()
    };

    addRollToHistory(roll, { announce: true });
    broadcastRoll(roll);
    diceGroups = [];
    modifierInput.value = "";
    updateDiceControls();
  }

  function cleanNickname(value) {
    return String(value || "").trim().slice(0, 12);
  }

  function parseModifier() {
    const text = modifierInput.value.trim();
    if (!text) return { text: "", value: 0, invalid: false };
    if (!/^[+-]\d{1,2}$/.test(text)) return { text, value: 0, invalid: true };
    return { text, value: Number(text), invalid: false };
  }

  function buildFormula(modifierText = "") {
    const diceFormula = diceGroups.map((group) => `${group.count}d${group.sides}`).join("+");
    return `${diceFormula}${modifierText}`;
  }

  function updateDiceControls() {
    const modifier = parseModifier();
    const hasDice = diceGroups.length > 0;
    const hasPool = hasDice || modifierInput.value.trim().length > 0;
    const countBySides = new Map(diceGroups.map((group) => [group.sides, group.count]));

    for (const button of diceButtons) {
      const sides = Number(button.dataset.diceSides);
      const count = countBySides.get(sides) || 0;
      button.textContent = count ? `${sides}×${count}` : String(sides);
      button.classList.toggle("active", count > 0);
      button.setAttribute("aria-label", count ? `d${sides}，目前 ${count} 顆` : `加入 d${sides}`);
    }

    modifierInput.classList.toggle("invalid", modifier.invalid);
    rollBtn.disabled = !hasDice || modifier.invalid;
    rollBtn.title = modifier.invalid ? "修正值格式需為 +5 或 -3" : "丟骰";
    clearBtn.disabled = !hasPool;
  }

  function broadcastRoll(roll) {
    const message = {
      type: "diceRoll",
      roll,
      source: ROLE.toLowerCase(),
      clientId
    };
    syncChannel?.postMessage(message);
    if (!syncChannel) {
      try {
        window.localStorage.setItem(ROLL_STORAGE_KEY, JSON.stringify({ ...roll, relayId: makeId() }));
      } catch {
        // Ignore localStorage failures.
      }
    }
    if (typeof firebaseSync?.sendDiceRoll === "function") {
      firebaseSync.sendDiceRoll(roll);
    }
  }

  function receiveRoll(roll) {
    addRollToHistory(roll, { announce: true });
  }

  function addRollToHistory(roll, options = {}) {
    if (!roll || !roll.id || seenRollIds.has(roll.id)) return;
    seenRollIds.add(roll.id);
    history.unshift(normalizeRoll(roll));
    history = history.slice(0, HISTORY_LIMIT);
    if (seenRollIds.size > HISTORY_LIMIT * 3) {
      seenRollIds = new Set(history.map((item) => item.id));
    }
    renderHistory();
    if (options.announce) showLogPanel(AUTO_HIDE_MS);
  }

  function normalizeRoll(roll) {
    const rolls = Array.isArray(roll.rolls) ? roll.rolls.map((value) => Number(value)).filter(Number.isFinite) : [];
    const modifier = Number.isFinite(Number(roll.modifier)) ? Number(roll.modifier) : 0;
    const total = Number.isFinite(Number(roll.total)) ? Number(roll.total) : rolls.reduce((sum, value) => sum + value, 0) + modifier;
    return {
      id: String(roll.id),
      role: roll.role === "GM" ? "GM" : "PL",
      nickname: cleanNickname(roll.nickname),
      formula: String(roll.formula || "?"),
      rolls,
      modifier,
      modifierText: typeof roll.modifierText === "string" ? roll.modifierText : formatModifier(modifier),
      total,
      createdAt: Number(roll.createdAt) || Date.now()
    };
  }

  function formatModifier(value) {
    if (!value) return "";
    return value > 0 ? `+${value}` : String(value);
  }

  function renderHistory() {
    diceLogItems.textContent = "";
    if (!history.length) {
      const empty = document.createElement("div");
      empty.className = "dice-log-empty";
      empty.textContent = "尚無擲骰紀錄";
      diceLogItems.appendChild(empty);
      return;
    }

    for (const roll of history) {
      const entry = document.createElement("div");
      entry.className = "dice-log-entry";

      const formulaLine = document.createElement("div");
      formulaLine.className = "dice-log-entry-formula";
      formulaLine.textContent = `${formatActor(roll)}:[${roll.formula}]`;

      const resultLine = document.createElement("div");
      resultLine.className = "dice-log-entry-result";
      resultLine.textContent = `${roll.rolls.join(",")}${roll.modifierText || ""}=${roll.total}`;

      entry.appendChild(formulaLine);
      entry.appendChild(resultLine);
      diceLogItems.appendChild(entry);
    }
  }

  function formatActor(roll) {
    return roll.nickname ? `${roll.role}(${roll.nickname})` : roll.role;
  }

  function showLogPanel(duration = AUTO_HIDE_MS) {
    if (suppressLog) return;
    diceLogPanel.classList.add("visible");
    if (autoHideTimer) window.clearTimeout(autoHideTimer);
    autoHideTimer = window.setTimeout(() => {
      if (!isHot && !touchScroll && !suppressLog) hideLogPanel();
    }, duration);
  }

  function hideLogPanel() {
    if (autoHideTimer) {
      window.clearTimeout(autoHideTimer);
      autoHideTimer = null;
    }
    isHot = false;
    touchScroll = null;
    diceLogPanel.classList.remove("visible");
  }

  function scheduleAutoHide(delay = AUTO_HIDE_MS) {
    if (autoHideTimer) window.clearTimeout(autoHideTimer);
    autoHideTimer = window.setTimeout(() => {
      if (!isHot && !touchScroll && !suppressLog) hideLogPanel();
    }, delay);
  }

  function pointIsInLogPanel(clientX, clientY) {
    const rect = diceLogPanel.getBoundingClientRect();
    return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
  }

  function pointIsInLogHotZone(clientX, clientY) {
    const rect = diceLogPanel.getBoundingClientRect();
    const width = Math.max(rect.width || 0, 300);
    const height = Math.max(rect.height || 0, 150);
    const left = rect.left || 16;
    const bottom = rect.bottom || window.innerHeight - 16;
    const top = bottom - height;
    const right = left + width;
    return clientX >= left && clientX <= right && clientY >= top && clientY <= bottom;
  }

  function handleViewportMouseMove(event) {
    if (suppressLog) return;
    const hovering = pointIsInLogHotZone(event.clientX, event.clientY);
    if (hovering) {
      isHot = true;
      showLogPanel(AUTO_HIDE_MS);
    } else if (isHot) {
      isHot = false;
      scheduleAutoHide(500);
    }
  }

  function handleViewportWheel(event) {
    if (!diceLogPanel.classList.contains("visible") || !pointIsInLogPanel(event.clientX, event.clientY)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    diceLogItems.scrollTop += event.deltaY;
    isHot = true;
    scheduleAutoHide(AUTO_HIDE_MS);
  }

  function handleViewportPointerDownCapture(event) {
    if (event.pointerType === "mouse") return;

    if (!diceLogPanel.classList.contains("visible")) {
      if (!suppressLog && pointIsInLogHotZone(event.clientX, event.clientY)) showLogPanel(AUTO_HIDE_MS);
      return;
    }

    if (!pointIsInLogPanel(event.clientX, event.clientY)) return;
    touchScroll = {
      pointerId: event.pointerId,
      lastY: event.clientY
    };
    isHot = true;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleViewportPointerMoveCapture(event) {
    if (!touchScroll || event.pointerId !== touchScroll.pointerId) return;
    const dy = event.clientY - touchScroll.lastY;
    touchScroll.lastY = event.clientY;
    diceLogItems.scrollTop -= dy;
    event.preventDefault();
    event.stopImmediatePropagation();
  }

  function handleViewportPointerUpCapture(event) {
    if (!touchScroll || event.pointerId !== touchScroll.pointerId) return;
    touchScroll = null;
    scheduleAutoHide(AUTO_HIDE_MS);
    event.preventDefault();
    event.stopImmediatePropagation();
  }
})();
