// 由網址決定同步模式：?room=（Firebase）、?olroom=（同一台電腦的 BroadcastChannel）、?lanroom=（LAN 伺服器）。
// 三種參數只能擇一；同時出現時整頁停止同步並提示，不偷偷選一個，也不同時開兩個同步通道。
(function () {
  const PARAMS = [
    { param: "room", mode: "firebase", label: "Firebase 遠端房間" },
    { param: "olroom", mode: "olroom", label: "單機 olroom" },
    { param: "lanroom", mode: "lan", label: "LAN 區域網路房間" }
  ];

  function parse(search) {
    const query = new URLSearchParams(search || "");
    const found = [];
    for (const { param, mode, label } of PARAMS) {
      const value = query.get(param);
      if (value) found.push({ param, mode, label, roomId: value });
    }
    // ?sync=firebase 不帶 room 時沿用原本的 default 房間。
    if (!found.some((item) => item.mode === "firebase") && query.get("sync") === "firebase") {
      found.push({ param: "sync", mode: "firebase", label: "Firebase 遠端房間", roomId: "default" });
    }
    if (found.length > 1) return { mode: "conflict", roomId: "", conflicts: found };
    if (!found.length) return { mode: "local", roomId: "", conflicts: [] };
    return { mode: found[0].mode, roomId: found[0].roomId, param: found[0].param, conflicts: [] };
  }

  function urlWithOnly(item) {
    const url = new URL(window.location.href);
    for (const { param } of PARAMS) url.searchParams.delete(param);
    url.searchParams.delete("sync");
    if (item.param === "sync") url.searchParams.set("sync", "firebase");
    else url.searchParams.set(item.param, item.roomId);
    return url.toString();
  }

  function showConflict(conflicts) {
    const overlay = document.createElement("div");
    overlay.setAttribute("role", "alertdialog");
    overlay.setAttribute("aria-labelledby", "mapfogSyncConflictTitle");
    overlay.style.cssText = "position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(2,6,23,.94);color:#f8fafc;font:15px/1.6 system-ui,-apple-system,'Segoe UI',sans-serif";
    const box = document.createElement("div");
    box.style.cssText = "max-width:520px;padding:20px;border:1px solid #f59e0b;border-radius:12px;background:#0b1220";
    const title = document.createElement("h2");
    title.id = "mapfogSyncConflictTitle";
    title.style.cssText = "margin:0 0 8px;font-size:18px;color:#fbbf24";
    title.textContent = "網址同時包含多種同步模式";
    const text = document.createElement("p");
    text.style.margin = "0 0 12px";
    text.textContent = `目前網址有：${conflicts.map((item) => `${item.param}=${item.roomId}`).join("、")}。為避免同時啟動多個同步通道、互相覆蓋資料，這個畫面已停止同步。請選擇要使用的模式：`;
    const list = document.createElement("ul");
    list.style.cssText = "margin:0;padding-left:20px";
    for (const item of conflicts) {
      const li = document.createElement("li");
      const link = document.createElement("a");
      link.href = urlWithOnly(item);
      link.style.color = "#38bdf8";
      link.textContent = `只用 ${item.label}（${item.param}=${item.roomId}）`;
      li.append(link);
      list.append(li);
    }
    box.append(title, text, list);
    overlay.append(box);
    document.body.append(overlay);
  }

  const current = parse(window.location.search);
  window.MapFogSyncMode = { ...current, parse, blocked: current.mode === "conflict" };

  if (current.mode === "conflict") {
    console.error("[MapFog] 網址同時包含多種同步模式參數，已停止同步：", current.conflicts);
    if (document.body) showConflict(current.conflicts);
    else document.addEventListener("DOMContentLoaded", () => showConflict(current.conflicts), { once: true });
  }
})();
