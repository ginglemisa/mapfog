// GM 專用：將目前 room 轉成玩家網址與 QR Code，無須讀取 Firebase。
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

  if (![openButton, dialog, roomLabel, qrContainer, urlInput, status, copyButton, closeButton].every(Boolean)) return;

  openButton.addEventListener("click", () => {
    // 每次點擊都重新讀取目前網址，不使用暫存或額外產生房號。
    const room = new URLSearchParams(window.location.search).get("room");
    if (!room) {
      window.alert("目前網址沒有 room 參數，請先使用 gm.html?room=房間名稱 開啟房間。");
      return;
    }

    // 保留目前網站的來源及部署路徑，並改成玩家入口。
    const playerUrl = new URL("pl.html", window.location.href);
    playerUrl.searchParams.set("room", room);

    roomLabel.textContent = room;
    urlInput.value = playerUrl.toString();
    status.textContent = "";
    qrContainer.replaceChildren();
    dialog.showModal();

    if (typeof window.QRCode !== "function") {
      status.textContent = "QR Code 元件未載入，仍可複製下方玩家網址。";
      return;
    }

    try {
      new window.QRCode(qrContainer, {
        text: urlInput.value,
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
  });

  copyButton.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(urlInput.value);
      status.textContent = "玩家網址已複製。";
    } catch {
      urlInput.focus();
      urlInput.select();
      status.textContent = "無法自動複製，請手動複製已選取的網址。";
    }
  });

  closeButton.addEventListener("click", () => dialog.close());
})();
