// room／lanroom 模式右下角的連線標示：已連線／已斷線、GM 畫面顯示在線玩家數，同房間有兩個 GM 時提醒。
(function () {
  const syncMode = window.MapFogSyncMode?.mode;
  if (syncMode !== "firebase" && syncMode !== "lan") return;
  const isLan = syncMode === "lan";

  const style = document.createElement("style");
  style.textContent = `
    .connection-status {
      position: fixed;
      right: max(12px, env(safe-area-inset-right));
      bottom: max(12px, env(safe-area-inset-bottom));
      z-index: 40;
      display: grid;
      gap: 4px;
      max-width: min(320px, calc(100vw - 24px));
      padding: 6px 10px;
      border: 1px solid rgba(148, 163, 184, 0.36);
      border-radius: 10px;
      background: rgba(11, 18, 32, 0.82);
      color: #f8fafc;
      font-size: 12px;
      font-weight: 700;
      line-height: 1.4;
      pointer-events: none;
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
    }
    .connection-status-line::before {
      content: "";
      display: inline-block;
      width: 8px;
      height: 8px;
      margin-right: 6px;
      border-radius: 50%;
      background: #94a3b8;
      vertical-align: 1px;
    }
    .connection-status.online .connection-status-line::before { background: #22c55e; }
    .connection-status.offline .connection-status-line::before { background: #ef4444; }
    .connection-status-warning { color: #fbbf24; }
    .connection-status-warning[hidden] { display: none; }
  `;
  document.head.appendChild(style);

  const badge = document.createElement("div");
  badge.className = "connection-status";
  badge.setAttribute("role", "status");
  badge.setAttribute("aria-live", "polite");
  const line = document.createElement("span");
  line.className = "connection-status-line";
  line.textContent = "連線中…";
  const warning = document.createElement("span");
  warning.className = "connection-status-warning";
  warning.hidden = true;
  warning.textContent = "⚠ 這個房間還有另一個 GM 畫面開著，兩邊的操作可能互相覆蓋。";
  badge.append(line, warning);
  document.body.appendChild(badge);

  // GM 右下角的模式按鈕疊在這個標示上方，標示變高（多行訊息）時跟著往上推。
  const rootStyle = document.documentElement.style;
  const updateReservedSpace = () => rootStyle.setProperty("--connection-status-space", `${badge.offsetHeight + 8}px`);
  if ("ResizeObserver" in window) new ResizeObserver(updateReservedSpace).observe(badge);
  updateReservedSpace();

  // 開頁後這麼久還連不上，就當成離線並說明畫面是暫存。
  const OFFLINE_HINT_DELAY_MS = 4000;
  const role = document.body.classList.contains("gm-page") ? "gm" : "player";
  let state = { role, connected: false, everConnected: false, players: 0, gms: 0 };
  let cacheShown = false;
  let sdkFailed = false;
  let waitedLong = false;
  let deniedRoomId = "";

  // LAN 模式只看與 LAN 伺服器的連線，跟有沒有網際網路無關。
  function renderLan() {
    const authProblem = state.authProblem;
    const offline = !state.connected && (state.everConnected || waitedLong || Boolean(authProblem));
    badge.classList.toggle("online", state.connected);
    badge.classList.toggle("offline", offline);
    if (authProblem) {
      line.textContent = authProblem.code === "gm-key-required" || authProblem.code === "gm-key-invalid"
        ? `LAN 模式・需要 GM 管理金鑰：${authProblem.message} 請重新整理後輸入 LAN 伺服器視窗顯示的金鑰。`
        : `LAN 模式・無法加入房間：${authProblem.message}`;
    } else if (state.connected) {
      const queued = state.queued ? `・${state.queued} 筆同步中` : "";
      line.textContent = state.role === "gm" ? `LAN 模式・已連線・玩家 ${state.players} 人在線${queued}` : `LAN 模式・已連線${queued}`;
    } else if (!state.everConnected && waitedLong) {
      // 從來沒連上：多半是 LAN 伺服器沒啟動、網址不是 LAN 伺服器提供的，或不在同一個 Wi-Fi。
      const pending = state.queued ? `${state.queued} 筆修改會在連上後送出。` : "";
      line.textContent = `LAN 模式・無法連線至 LAN 伺服器${cacheShown ? "（顯示的是暫存畫面）" : ""}。請確認 GM 筆電已執行 start-lan-server.bat、這台裝置連在同一個 Wi-Fi／熱點，並使用伺服器視窗顯示的網址；會自動重試。${pending}`;
    } else if (state.everConnected) {
      const pending = state.queued ? `，${state.queued} 筆修改會在重新連線後送出` : "";
      line.textContent = `LAN 模式・已斷線，正在重新連線（第 ${Math.max(1, Number(state.attempt) || 0)} 次）${pending}`;
    } else {
      line.textContent = "LAN 模式・連線中…";
    }
    warning.hidden = !(state.role === "gm" && state.connected && state.gms > 1);
  }

  function render() {
    if (isLan) {
      renderLan();
      return;
    }
    const offline = !state.connected && (state.everConnected || sdkFailed || waitedLong);
    badge.classList.toggle("online", state.connected && !deniedRoomId);
    badge.classList.toggle("offline", offline || Boolean(deniedRoomId));
    if (deniedRoomId) {
      // 連得上 Firebase，但這個房間的讀寫被規則擋下，同步完全不會發生。
      line.textContent = `無法使用房間「${deniedRoomId}」：Firebase 拒絕存取。房間名稱需為 8–10 個字元（英文字母、數字或 -），請換一個名稱。`;
    } else if (state.connected) {
      line.textContent = state.role === "gm" ? `已連線・玩家 ${state.players} 人在線` : "已連線";
    } else if (offline && cacheShown) {
      line.textContent = "離線中，顯示的是暫存畫面；恢復連線後會自動更新";
    } else if (sdkFailed) {
      line.textContent = "無法載入同步服務，恢復網路後會自動重試";
    } else {
      line.textContent = state.everConnected ? "已斷線，網路恢復後會自動重新連線" : "連線中…";
    }
    // 斷線時在線名單可能是舊的，只在連線中才判斷是否有兩個 GM。
    warning.hidden = !(state.role === "gm" && state.connected && state.gms > 1);
  }

  window.addEventListener("mapfog:connection", (event) => {
    state = event.detail;
    sdkFailed = false;
    render();
  });
  window.addEventListener("mapfog:firebase-error", () => {
    sdkFailed = true;
    render();
  });
  window.addEventListener("mapfog:firebase-denied", (event) => {
    deniedRoomId = event.detail?.roomId || "default";
    render();
  });
  // GM／玩家畫面從本機暫存還原了地圖。
  window.addEventListener("mapfog:cache-shown", () => {
    cacheShown = true;
    render();
  });
  window.setTimeout(() => {
    waitedLong = true;
    render();
  }, OFFLINE_HINT_DELAY_MS);
  if (window.MapFogSync?.getConnectionState) state = window.MapFogSync.getConnectionState();
  render();
})();
