/* 地圖調整：只在本機調整 mapCanvas 的亮度／對比／飽和度，不同步、不改動地圖資料。 */
(() => {
  const SETTINGS = [
    { key: "brightness", inputId: "mapBrightness", valueId: "mapBrightnessValue", min: 50, max: 200 },
    { key: "contrast", inputId: "mapContrast", valueId: "mapContrastValue", min: 50, max: 175 },
    { key: "saturation", inputId: "mapSaturation", valueId: "mapSaturationValue", min: 0, max: 200 }
  ];
  const DEFAULT_VALUE = 100;
  const PIXEL_STRIP_HEIGHT = 512;
  let canvasFilterSupported = null;

  function createDefaultValues() {
    return { brightness: DEFAULT_VALUE, contrast: DEFAULT_VALUE, saturation: DEFAULT_VALUE };
  }

  function normalizeValues(values = {}) {
    const next = createDefaultValues();
    for (const setting of SETTINGS) {
      const value = Math.round(Number(values[setting.key]));
      if (Number.isFinite(value)) next[setting.key] = Math.min(setting.max, Math.max(setting.min, value));
    }
    return next;
  }

  function isDefaultValues(values) {
    return SETTINGS.every((setting) => values[setting.key] === DEFAULT_VALUE);
  }

  function toFilter(values) {
    return `brightness(${values.brightness}%) contrast(${values.contrast}%) saturate(${values.saturation}%)`;
  }

  // 用取樣雜湊辨識地圖，避免把整張 data URL 存進 localStorage。
  function createMapKey(dataUrl) {
    const text = String(dataUrl || "");
    if (!text) return "";
    const step = Math.max(1, Math.floor(text.length / 8192));
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += step) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return `${text.length}:${(hash >>> 0).toString(36)}`;
  }

  function supportsCanvasFilter() {
    if (canvasFilterSupported !== null) return canvasFilterSupported;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.filter = "brightness(0%)";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 1, 1);
      canvasFilterSupported = ctx.getImageData(0, 0, 1, 1).data[0] < 128;
    } catch {
      canvasFilterSupported = false;
    }
    return canvasFilterSupported;
  }

  function clampByte(value) {
    return value < 0 ? 0 : (value > 255 ? 255 : value);
  }

  // 不支援 ctx.filter 的瀏覽器：依 CSS Filter Effects 規格逐像素套用相同公式。
  function adjustPixels(data, values) {
    const brightness = values.brightness / 100;
    const contrast = values.contrast / 100;
    const contrastOffset = 127.5 * (1 - contrast);
    const s = values.saturation / 100;
    const rr = 0.213 + 0.787 * s, rg = 0.715 - 0.715 * s, rb = 0.072 - 0.072 * s;
    const gr = 0.213 - 0.213 * s, gg = 0.715 + 0.285 * s, gb = 0.072 - 0.072 * s;
    const br = 0.213 - 0.213 * s, bg = 0.715 - 0.715 * s, bb = 0.072 + 0.928 * s;

    for (let index = 0; index < data.length; index += 4) {
      let r = clampByte(data[index] * brightness);
      let g = clampByte(data[index + 1] * brightness);
      let b = clampByte(data[index + 2] * brightness);
      r = clampByte(r * contrast + contrastOffset);
      g = clampByte(g * contrast + contrastOffset);
      b = clampByte(b * contrast + contrastOffset);
      data[index] = clampByte(rr * r + rg * g + rb * b);
      data[index + 1] = clampByte(gr * r + gg * g + gb * b);
      data[index + 2] = clampByte(br * r + bg * g + bb * b);
    }
  }

  function drawAdjustedPixels(ctx, source, width, height, values) {
    // 分段處理，避免大地圖一次取出整張 ImageData 造成記憶體不足。
    const strip = document.createElement("canvas");
    strip.width = width;
    strip.height = Math.min(PIXEL_STRIP_HEIGHT, height);
    const stripCtx = strip.getContext("2d", { willReadFrequently: true });
    if (!stripCtx) throw new Error("無法建立影像處理畫布");

    for (let y = 0; y < height; y += strip.height) {
      const rows = Math.min(strip.height, height - y);
      stripCtx.clearRect(0, 0, width, strip.height);
      stripCtx.drawImage(source, 0, y, width, rows, 0, 0, width, rows);
      const imageData = stripCtx.getImageData(0, 0, width, rows);
      adjustPixels(imageData.data, values);
      stripCtx.putImageData(imageData, 0, 0);
      ctx.drawImage(strip, 0, 0, width, rows, 0, y, width, rows);
    }
  }

  function stopUiEvent(event) {
    event.stopPropagation();
  }

  function create(options = {}) {
    const canvas = options.canvas;
    const storageKey = options.storageKey;
    const button = document.getElementById("mapAdjustBtn");
    const panel = document.getElementById("mapAdjustPanel");
    const closeButton = document.getElementById("mapAdjustCloseBtn");
    const resetButton = document.getElementById("mapAdjustResetBtn");
    let values = createDefaultValues();
    let mapKey = "";

    function readStored() {
      try {
        const stored = JSON.parse(localStorage.getItem(storageKey) || "null");
        if (!stored) return;
        values = normalizeValues(stored);
        mapKey = typeof stored.mapKey === "string" ? stored.mapKey : "";
      } catch {
        values = createDefaultValues();
      }
    }

    function persist() {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ ...values, mapKey }));
      } catch {
        // 調整值只是本機顯示偏好，儲存失敗不影響遊戲。
      }
    }

    function isOpen() {
      return Boolean(panel && !panel.hidden);
    }

    function updateButton() {
      button?.classList.toggle("active", isOpen() || !isDefaultValues(values));
    }

    function render() {
      if (canvas) canvas.style.filter = isDefaultValues(values) ? "" : toFilter(values);
      for (const setting of SETTINGS) {
        const input = document.getElementById(setting.inputId);
        const label = document.getElementById(setting.valueId);
        if (input) input.value = String(values[setting.key]);
        if (label) label.textContent = `${values[setting.key]}%`;
      }
      if (resetButton) resetButton.disabled = isDefaultValues(values);
      updateButton();
    }

    function setValues(nextValues) {
      values = normalizeValues({ ...values, ...nextValues });
      render();
      persist();
    }

    function setOpen(open) {
      if (!panel || !button) return;
      if (open) options.onOpen?.();
      panel.hidden = !open;
      button.setAttribute("aria-expanded", String(open));
      updateButton();
    }

    // 同一房間換成另一張地圖時恢復 100%；重新整理載入同一張地圖則保留設定。
    function setMapSource(dataUrl) {
      const nextKey = createMapKey(dataUrl);
      if (!nextKey || nextKey === mapKey) return;
      if (mapKey) values = createDefaultValues();
      mapKey = nextKey;
      render();
      persist();
    }

    function drawAdjusted(ctx, source, width, height) {
      if (isDefaultValues(values)) {
        ctx.drawImage(source, 0, 0, width, height);
        return;
      }
      if (supportsCanvasFilter()) {
        ctx.save();
        ctx.filter = toFilter(values);
        ctx.drawImage(source, 0, 0, width, height);
        ctx.restore();
        return;
      }
      drawAdjustedPixels(ctx, source, width, height, values);
    }

    for (const setting of SETTINGS) {
      document.getElementById(setting.inputId)?.addEventListener("input", (event) => {
        setValues({ [setting.key]: event.target.value });
      });
    }
    button?.addEventListener("click", () => setOpen(!isOpen()));
    closeButton?.addEventListener("click", () => setOpen(false));
    resetButton?.addEventListener("click", () => setValues(createDefaultValues()));
    for (const eventName of ["pointerdown", "pointermove", "pointerup", "wheel", "touchstart", "touchmove"]) {
      panel?.addEventListener(eventName, stopUiEvent, { passive: true });
    }

    readStored();
    render();
    setOpen(false);

    return {
      setOpen,
      isOpen,
      setMapSource,
      drawAdjusted,
      isAdjusted: () => !isDefaultValues(values)
    };
  }

  window.MapFogMapAdjust = { create };
})();
