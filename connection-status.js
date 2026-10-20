// room 模式右下角的連線標示：已連線／已斷線、GM 畫面顯示在線玩家數，同房間有兩個 GM 時提醒。
(function () {
  const query = new URLSearchParams(window.location.search);
  if (!query.get("room") && query.get("sync") !== "firebase") return;

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

  function render(state) {
    badge.classList.toggle("online", state.connected);
    badge.classList.toggle("offline", !state.connected && state.everConnected);
    if (state.connected) {
      line.textContent = state.role === "gm" ? `已連線・玩家 ${state.players} 人在線` : "已連線";
    } else {
      line.textContent = state.everConnected ? "已斷線，網路恢復後會自動重新連線" : "連線中…";
    }
    // 斷線時在線名單可能是舊的，只在連線中才判斷是否有兩個 GM。
    warning.hidden = !(state.role === "gm" && state.connected && state.gms > 1);
  }

  window.addEventListener("mapfog:connection", (event) => render(event.detail));
  window.addEventListener("mapfog:firebase-error", () => {
    badge.classList.add("offline");
    line.textContent = "無法載入同步服務，請檢查網路後重新整理";
  });
  if (window.MapFogFirebaseSync?.getConnectionState) render(window.MapFogFirebaseSync.getConnectionState());
})();
