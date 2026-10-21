// GM 專用：將目前 room／lanroom 轉成玩家網址與 QR Code，無須讀取 Firebase。
(() => {
  "use strict";

  const openButton = document.getElementById("playerQrBtn");
  const dialog = document.getElementById("playerQrDialog");
  const roomLabel = document.getElementById("playerQrRoom");
  const qrContainer = document.getElementById("playerQrCode");
  const urlInput = document.getElementById("playerQrUrl");
  const status = document.getElementById("playerQrStatus");
  const copyButton = document.getElementById("copyPlayerQrUrl");
  const closeButton = document.getElementById("closePlayerQr");
  // LAN 模式、GM 用 localhost 開啟時才出現：選擇玩家要連的區網位址。
  const hostPicker = document.getElementById("playerQrHostPicker");
  const hostSelect = document.getElementById("playerQrHost");
  const hostManual = document.getElementById("playerQrHostManual");
  const hostHint = document.getElementById("playerQrHostHint");

  if (![openButton, dialog, roomLabel, qrContainer, urlInput, status, copyButton, closeButton].every(Boolean)) return;

  const LAN_HOST_STORAGE_KEY = "mapfog.lan.playerHost.v1";
  const MANUAL_OPTION = "__manual__";
  const VIRTUAL_ADAPTER_PATTERN = /vEthernet|VirtualBox|VMware|Hyper-V|WSL|docker|Loopback|Bluetooth|Tailscale|ZeroTier/i;
  let lanRequest = 0;
  let lanRoom = "";

  function renderQr(text) {
    qrContainer.replaceChildren();
    if (!text) return;
    if (typeof window.QRCode !== "function") {
      status.textContent = "QR Code 元件未載入，仍可複製下方玩家網址。";
      return;
    }

    try {
      new window.QRCode(qrContainer, {
        text,
        width: 220,
        height: 220,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: window.QRCode.CorrectLevel.M
      });
    } catch (error) {
      console.error("[MapFog 玩家 QR]", error);
      qrContainer.replaceChildren();
      status.textContent = "無法產生 QR Code，請改用下方玩家網址。";
    }
  }

  // QR Code 與下方文字一律使用同一個字串。
  function showPlayerUrl(text) {
    urlInput.value = text;
    renderQr(text);
  }

  function isLoopbackHost(hostname) {
    const host = hostname.toLowerCase();
    return host === "localhost" || host.endsWith(".localhost") || /^127\./.test(host) || host === "[::1]" || host === "::1";
  }

  function isValidHostInput(value) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(value) && value.split(".").every((part) => Number(part) <= 255)
      || /^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/.test(value);
  }

  // 保留目前的協定、port 與部署路徑，只換成玩家入口；房間參數只留 lanroom。
  function buildLanPlayerUrl(room, hostname) {
    const playerUrl = new URL("pl.html", window.location.href);
    playerUrl.search = "";
    playerUrl.hash = "";
    if (hostname) playerUrl.hostname = hostname;
    playerUrl.searchParams.set("lanroom", room);
    return playerUrl.toString();
  }

  function readStoredHost() {
    try {
      return window.localStorage.getItem(LAN_HOST_STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function storeHost(host) {
    try {
      window.localStorage.setItem(LAN_HOST_STORAGE_KEY, host);
    } catch {
      // 記不住只會讓下次再選一次。
    }
  }

  function applyChosenHost() {
    const manual = hostSelect.value === MANUAL_OPTION;
    hostManual.hidden = !manual;
    const host = manual ? hostManual.value.trim() : hostSelect.value;
    if (!host) {
      showPlayerUrl("");
      status.textContent = manual ? "請輸入玩家裝置可以連到的 IP，例如 192.168.43.100。" : "請先選擇玩家裝置所在網路的位址。";
      return;
    }
    if (!isValidHostInput(host)) {
      showPlayerUrl("");
      status.textContent = "位址格式不正確：只要輸入 IP（例如 192.168.43.100），不需要 http:// 或 port。";
      return;
    }
    storeHost(host);
    showPlayerUrl(buildLanPlayerUrl(lanRoom, host));
    status.textContent = "請確認玩家裝置與這台電腦連在同一個 Wi-Fi／熱點。";
  }

  function fillHostOptions(addresses) {
    hostSelect.replaceChildren();
    const placeholder = new Option("請選擇…", "");
    hostSelect.append(placeholder);
    for (const item of addresses) {
      const tags = [item.name];
      if (VIRTUAL_ADAPTER_PATTERN.test(item.name)) tags.push("虛擬網卡");
      if (item.linkLocal) tags.push("自動位址，通常無法連線");
      hostSelect.append(new Option(`${item.address}（${tags.join("，")}）`, item.address));
    }
    hostSelect.append(new Option("手動輸入…", MANUAL_OPTION));
  }

  async function openLanDialog(room) {
    lanRoom = room;
    const requestId = ++lanRequest;
    roomLabel.textContent = room;
    status.textContent = "";
    if (hostPicker) hostPicker.hidden = true;

    // GM 已用其他裝置連得到的位址開啟：直接沿用，不必查詢。
    if (!isLoopbackHost(window.location.hostname)) {
      showPlayerUrl(buildLanPlayerUrl(room, ""));
      dialog.showModal();
      return;
    }

    // localhost 只代表這台電腦本身，其他裝置用不了：改用 GM 筆電的區網位址。
    showPlayerUrl("");
    dialog.showModal();
    if (!hostPicker || !hostSelect || !hostManual || !hostHint) {
      status.textContent = "目前用 localhost 開啟，其他裝置無法使用這個網址。請改用 LAN 伺服器視窗顯示的區網網址開啟 GM 畫面。";
      return;
    }
    hostPicker.hidden = false;
    hostManual.hidden = true;
    hostHint.textContent = "正在查詢這台電腦的區網位址…";

    let addresses = [];
    try {
      const response = await fetch(new URL("lan-api/info", window.location.href), { cache: "no-store" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      addresses = (await response.json()).addresses || [];
    } catch (error) {
      console.warn("[MapFog 玩家 QR] 無法取得區網位址", error);
      if (requestId !== lanRequest) return;
      fillHostOptions([]);
      hostSelect.value = MANUAL_OPTION;
      hostManual.value = readStoredHost();
      hostHint.textContent = "⚠ 無法向 LAN 伺服器查詢位址（是否用 start-lan-server.bat 開啟？）。請手動輸入這台電腦的區網 IP。";
      applyChosenHost();
      return;
    }
    if (requestId !== lanRequest) return;

    fillHostOptions(addresses);
    const stored = readStoredHost();
    const likely = addresses.filter((item) => item.private && !item.linkLocal && !VIRTUAL_ADAPTER_PATTERN.test(item.name));
    if (stored && addresses.some((item) => item.address === stored)) {
      hostSelect.value = stored;
      hostHint.textContent = "沿用上次選擇的位址；網路換過的話請重新確認。";
    } else if (!addresses.length) {
      hostSelect.value = MANUAL_OPTION;
      hostManual.value = "";
      hostHint.textContent = "⚠ 找不到這台電腦的區網位址：請確認已連上 Wi-Fi 分享器或手機熱點，或手動輸入 IP。";
    } else if (likely.length === 1) {
      hostSelect.value = likely[0].address;
      hostHint.textContent = "只找到一個區網位址，已自動選用；請確認玩家裝置連在同一個網路。";
    } else {
      hostSelect.value = "";
      hostHint.textContent = "⚠ 這台電腦有多個網路位址，無法確定玩家用哪一個：請選擇與玩家同一個 Wi-Fi／熱點的位址（可在 Windows 的 Wi-Fi 內容查看 IPv4 位址）。";
    }
    applyChosenHost();
  }

  hostSelect?.addEventListener("change", () => {
    if (hostSelect.value === MANUAL_OPTION && !hostManual.value) hostManual.value = readStoredHost();
    applyChosenHost();
    if (hostSelect.value === MANUAL_OPTION) hostManual.focus();
  });
  hostManual?.addEventListener("input", applyChosenHost);

  openButton.addEventListener("click", () => {
    // 每次點擊都重新讀取目前網址，不使用暫存或額外產生房號。
    const syncMode = window.MapFogSyncMode?.parse?.(window.location.search);
    if (syncMode?.mode === "conflict") {
      window.alert("目前網址同時包含多種房間參數（room／olroom／lanroom），請只保留一個後再產生玩家 QR Code。");
      return;
    }
    if (syncMode?.mode === "lan") {
      openLanDialog(syncMode.roomId);
      return;
    }

    const room = new URLSearchParams(window.location.search).get("room");
    if (!room) {
      window.alert("目前網址沒有 room 或 lanroom 參數，請先使用 gm.html?room=房間名稱（Firebase）或 gm.html?lanroom=房間名稱（LAN）開啟房間。");
      return;
    }

    // 保留目前網站的來源及部署路徑，並改成玩家入口。
    const playerUrl = new URL("pl.html", window.location.href);
    playerUrl.searchParams.set("room", room);

    lanRequest += 1;
    if (hostPicker) hostPicker.hidden = true;
    roomLabel.textContent = room;
    urlInput.value = playerUrl.toString();
    status.textContent = "";
    qrContainer.replaceChildren();
    dialog.showModal();
    renderQr(urlInput.value);
  });

  copyButton.addEventListener("click", async () => {
    if (!urlInput.value) {
      status.textContent = "還沒有可複製的玩家網址。";
      return;
    }
    try {
      await navigator.clipboard.writeText(urlInput.value);
      status.textContent = "玩家網址已複製。";
    } catch {
      // 區網 http 網址不是安全來源，瀏覽器不提供 clipboard API：改用舊的複製方式，再不行就請 GM 手動複製。
      urlInput.focus();
      urlInput.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch {
        copied = false;
      }
      status.textContent = copied ? "玩家網址已複製。" : "無法自動複製，請手動複製已選取的網址。";
    }
  });

  closeButton.addEventListener("click", () => dialog.close());
})();
