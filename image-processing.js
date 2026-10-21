/* GM 與玩家共用的圖片輸出，依實際結果判斷 WebP 支援。 */
(() => {
  const TOKEN_SIZE = 256;
  const QUALITY = 0.85;
  const MAP_MAX_SIDE = 4096;
  const MAP_MAX_PIXELS = 16777216;
  const MAP_KEEP_BYTES = 5000000;
  const ROOM_MAX_DATA_URL_BYTES = 9000000;
  const MAP_MAX_ATTEMPTS = 6;

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

  function readDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("讀取圖片失敗，請重新選取檔案。"));
      reader.onabort = () => reject(new Error("圖片讀取已取消，請重新選取檔案。"));
      reader.readAsDataURL(file);
    });
  }

  function formatBytes(bytes) {
    return bytes >= 1000000 ? `${Number((bytes / 1000000).toFixed(2))}MB` : `${Number((bytes / 1000).toFixed(1))}KB`;
  }

  function formatType(type) {
    return ({ "image/jpeg": "JPG", "image/webp": "WebP", "image/png": "PNG", "image/gif": "GIF" })[type] || "圖片";
  }

  function mapResult(file, dataUrl, originalWidth, originalHeight, width, height, preserved, room) {
    const type = dataUrl.slice(5, dataUrl.indexOf(";"));
    const payload = dataUrl.slice(dataUrl.indexOf(",") + 1);
    const bytes = payload.length * 3 / 4 - (payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0);
    const resized = width !== originalWidth || height !== originalHeight;
    const action = preserved ? "已保留原檔" : resized ? "已自動縮小" : "已自動轉存";
    const scale = (Math.min(width / originalWidth, height / originalHeight) * 100).toFixed(1);
    const fallback = !preserved && type === "image/png" ? "；此裝置改用 PNG" : "";
    const roomSize = room ? `；room 傳送資料 ${formatBytes(dataUrl.length)}` : "";
    return {
      dataUrl, width, height,
      summary: `${action}：${originalWidth}×${originalHeight} ${formatType(file.type)} ${formatBytes(file.size)} → ${width}×${height} ${formatType(type)} ${formatBytes(bytes)}（縮放 ${scale}%${fallback}${roomSize}）`
    };
  }

  async function processMap(file, { room = false } = {}) {
    // 使用物件網址解碼原檔，避免大圖還沒縮小就先複製成 base64 字串。
    const sourceUrl = URL.createObjectURL(file);
    let image;
    let canvas;
    try {
      image = await loadImage(sourceUrl);
      const originalWidth = image.naturalWidth;
      const originalHeight = image.naturalHeight;
      const ratio = Math.min(1, MAP_MAX_SIDE / Math.max(originalWidth, originalHeight),
        Math.sqrt(MAP_MAX_PIXELS / (originalWidth * originalHeight)));
      let width = Math.max(1, Math.floor(originalWidth * ratio));
      let height = Math.max(1, Math.floor(originalHeight * ratio));
      if (ratio === 1 && file.size < MAP_KEEP_BYTES && ["image/jpeg", "image/webp"].includes(file.type)) {
        const dataUrl = await readDataUrl(file);
        if (!room || dataUrl.length < ROOM_MAX_DATA_URL_BYTES) {
          return mapResult(file, dataUrl, originalWidth, originalHeight, width, height, true, room);
        }
      }

      canvas = document.createElement("canvas");
      let quality = QUALITY;
      let pngOnly = false;
      for (let attempt = 0; attempt < MAP_MAX_ATTEMPTS; attempt += 1) {
        // 讓處理中提示能先顯示，重試之間也讓瀏覽器有機會回應操作。
        await new Promise(resolve => window.setTimeout(resolve, 0));
        if (attempt === 0 || canvas.width !== width || canvas.height !== height) {
          // 先縮到 1×1，避免寬、高分開設定時短暫配置過大的畫布。
          canvas.width = canvas.height = 1;
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("無法建立地圖畫布，請改用較小的圖片後重試。");
          ctx.drawImage(image, 0, 0, width, height);
        }
        const dataUrl = encodeCanvas(canvas, quality, pngOnly);
        // base64 dataURL 全為 ASCII；字串長度就是送往 Firebase 的 UTF-8 bytes。
        if (!room || dataUrl.length < ROOM_MAX_DATA_URL_BYTES) {
          return mapResult(file, dataUrl, originalWidth, originalHeight, width, height, false, room);
        }
        pngOnly = dataUrl.startsWith("data:image/png;");
        if (!pngOnly && quality > 0.55) {
          quality = quality > 0.7 ? 0.7 : 0.55;
        } else {
          width = Math.max(1, Math.floor(width * 0.75));
          height = Math.max(1, Math.floor(height * 0.75));
        }
      }
      throw new Error("地圖經過 6 次處理後，傳送資料仍達 9MB，尚未套用。請先縮小原圖或裁切不需要的範圍，再重新上傳。");
    } finally {
      if (canvas) canvas.width = canvas.height = 1;
      if (image) image.src = "";
      URL.revokeObjectURL(sourceUrl);
    }
  }

  window.MapFogImageProcessing = { TOKEN_SIZE, encodeCanvas, createCenteredTokenDataUrl, processMap };
})();
