/* GM 與玩家共用的圖片輸出，依實際結果判斷 WebP 支援。 */
(() => {
  const TOKEN_SIZE = 256;
  const QUALITY = 0.85;

  function encodeCanvas(canvas, quality = QUALITY, pngOnly = false) {
    let dataUrl = canvas.toDataURL(pngOnly ? "image/png" : "image/webp", quality);
    if (dataUrl.startsWith("data:image/webp;base64,")) return dataUrl;
    // Safari 可能忽略 WebP 格式要求，直接回傳 PNG。
    if (!dataUrl.startsWith("data:image/png;base64,")) dataUrl = canvas.toDataURL("image/png");
    if (!dataUrl.startsWith("data:image/png;base64,")) {
      throw new Error("無法產生圖片，請改用較小的圖片後重試。");
    }
    return dataUrl;
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => {
        if (!image.naturalWidth || !image.naturalHeight) reject(new Error("圖片尺寸無效"));
        else resolve(image);
      };
      image.onerror = () => reject(new Error("無法讀取圖片，請改用 PNG、JPG 或 WebP。"));
      image.src = src;
    });
  }

  async function createCenteredTokenDataUrl(src) {
    const image = await loadImage(src);
    const canvas = document.createElement("canvas");
    try {
      canvas.width = TOKEN_SIZE;
      canvas.height = TOKEN_SIZE;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("無法建立圖片畫布");
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2,
        side, side, 0, 0, TOKEN_SIZE, TOKEN_SIZE);
      return encodeCanvas(canvas);
    } finally {
      // 主動釋放暫用畫布，避免 Safari 累積畫布記憶體。
      canvas.width = canvas.height = 1;
      image.src = "";
    }
  }

  window.MapFogImageProcessing = { TOKEN_SIZE, encodeCanvas, createCenteredTokenDataUrl };
})();
