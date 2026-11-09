// 測量工具（GM 與玩家頁共用）：只有 GM 開啟格線、而且有地圖時才顯示。
// - 直線、曲線：所有人都看得到，每個畫面同時只留一條，量完留著，下一次量或關掉工具時清除。
// - 錐形、圓形、方形：地圖上的範圍，所有人都看得到；移動、旋轉與刪除限放置的人與 GM。
// 線條、文字與把手畫在跟螢幕同尺寸的覆蓋層上，粗細與字級不受地圖縮放影響。
(() => {
  "use strict";
  const host = window.MapFogHost;
  const core = window.MapFogMeasureCore;
  const viewport = document.getElementById("viewport");
  const canvasHolder = document.getElementById("canvasHolder");
  if (!host || !core || !viewport || !canvasHolder) return;

  const LOCAL_STORAGE_KEY = `${host.storagePrefix}measure.v1`;
  const PANEL_STORAGE_KEY = "mapfog.measurePanel.v1";
  // 沒有帳號，「自己放的範圍」以這個瀏覽器記下的清單為準；LAN 伺服器另外用這把鑰匙驗證刪除權限。
  // 同一台電腦的 GM 與玩家視窗共用 localStorage，所以依身分分開存放。
  const isGm = document.body.classList.contains("gm-page");
  const ROLE_SUFFIX = isGm ? "gm" : "player";
  const OWNED_STORAGE_KEY = `${host.storagePrefix}measure.owned.${ROLE_SUFFIX}.v1`;
  const OWNER_TOKEN_STORAGE_KEY = `${host.storagePrefix}measure.ownerToken.${ROLE_SUFFIX}.v1`;
  const MAX_OWNED_IDS = 300;
  const NOTICE_MS = 3000;
  const PUBLISH_INTERVAL_MS = 100;
  const RENDER_FALLBACK_MS = 120;
  const MAX_TEMPLATES = 100;
  const MOUSE_GRIP_REACH = 14;
  const TOUCH_GRIP_REACH = 24;
  const LABEL_FONT = '700 15px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const LABEL_HEIGHT = 26;
  const CIRCLE_LABEL_OFFSET = 26;
  const SHAPES = {
    cone: { label: "錐形", color: "249, 115, 22" },
    emanation: { label: "發散", color: "168, 85, 247" },
    circle: { label: "球形", color: "168, 85, 247" },
    square: { label: "方形", color: "34, 197, 94" }
  };
  const TOOL_COLORS = { line: "56, 189, 248", path: "250, 204, 21" };
  const HINTS = {
    idle: "拖曳範圍可以移動，拖曳 ↻ 可以旋轉，選取後按 Delete 刪除。",
    line: "在地圖上按住，從一格拖到另一格，顯示相距幾格。",
    path: "按住沿路線拖曳，計算走過幾格；往回拖可以退一格。"
  };

  const templates = new Map();
  const ownedIds = new Set(readOwnedIds());
  const ownerToken = readOwnerToken();
  let selectedTemplateId = null;
  let noticeTimer = 0;
  const lastSizes = { cone: "3", circle: "3", square: "3" };
  let sync = null;
  let tool = null;
  // 自己畫的直線或曲線：{ kind: "line", from, to } 或 { kind: "path", cells }（格子座標）。
  let measurement = null;
  // 其他畫面正在顯示的線。這裡沒有帳號，所以「一條線」是對應一個開著的畫面。
  let otherLines = [];
  let lineChannel = null;
  let lastLineText = "null";
  let linePublishTimer = 0;
  const localOwnerId = createTemplateId();
  // 進行中的拖曳：量距離、移動範圍或旋轉範圍。
  let session = null;
  let dirtyTemplateId = null;
  let publishTimer = 0;
  let renderPending = false;
  let modalShape = null;
  // 圓形的放法：emanation 放格子中心（發散），circle 放格線交點（球形）。
  let circleMode = "emanation";
  let lastGridKey = "";
  const cellCache = new Map();

  const button = createToolbarButton();
  const panel = createPanel();
  const modal = createModal();
  const overlay = document.createElement("canvas");
  overlay.className = "measure-overlay";
  overlay.setAttribute("aria-hidden", "true");
  viewport.appendChild(overlay);
  const ctx = overlay.getContext("2d");
  const hint = panel.querySelector("#measureHint");
  const list = panel.querySelector("#measureList");
  const emptyNote = panel.querySelector("#measureEmpty");
  const clearButton = panel.querySelector("#measureClearBtn");
  const toolButtons = [...panel.querySelectorAll("[data-tool]")];
  const houseRule = panel.querySelector("#measureHouseRule");
  const houseNote = panel.querySelector("#measureHouseNote");
  const sizeInput = modal.querySelector("#measureSizeInput");
  const sizeError = modal.querySelector("#measureSizeError");
  const circleModeGroup = modal.querySelector("#measureCircleMode");

  function available() {
    return Boolean(host.getGrid().enabled && host.hasMap());
  }

  function gridKey(grid) {
    return `${grid.type}|${grid.size}|${grid.offsetX}|${grid.offsetY}|${Boolean(grid.tenFoot)}`;
  }

  // 直線與曲線用畫出來的格子。
  function currentModel() {
    return core.createGridModel(host.getGrid());
  }

  // 範圍用的格子；一格 10 呎時是四分之一大小的小格。
  function templateModel() {
    return core.createTemplateModel(host.getGrid());
  }

  function logError(error) {
    console.error("[MapFog 測量]", error);
  }

  // ---- 座標 ----

  function toScreen(point) {
    const { scale, offsetX, offsetY, rotation } = host.getView();
    const { width, height } = host.getMapSize();
    let x = point.x;
    let y = point.y;
    if (rotation === 90) {
      x = height - point.y;
      y = point.x;
    } else if (rotation === 180) {
      x = width - point.x;
      y = height - point.y;
    } else if (rotation === 270) {
      x = point.y;
      y = width - point.x;
    }
    return { x: offsetX + x * scale, y: offsetY + y * scale };
  }

  function clampToMap(point) {
    const { width, height } = host.getMapSize();
    return { x: Math.min(width, Math.max(0, point.x)), y: Math.min(height, Math.max(0, point.y)) };
  }

  function isInsideMap(point) {
    const { width, height } = host.getMapSize();
    return point.x >= 0 && point.y >= 0 && point.x <= width && point.y <= height;
  }

  function isMapSurface(target) {
    return target === viewport || (target instanceof Node && canvasHolder.contains(target));
  }

  // ---- 範圍資料與同步 ----

  function orderedTemplates() {
    return [...templates.values()].sort((a, b) => a.order - b.order);
  }

  function normalizeTemplate(raw) {
    const size = core.parseSize(raw?.size);
    if (!raw?.id || !SHAPES[raw.shape] || size === null) return null;
    return {
      id: String(raw.id),
      shape: raw.shape,
      size,
      x: Number(raw.x) || 0,
      y: Number(raw.y) || 0,
      angle: Number(raw.angle) || 0,
      order: Number(raw.order) || 0
    };
  }

  function createTemplateId() {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    return `tpl-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function writeLocal() {
    try {
      window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(orderedTemplates()));
    } catch {
      // 寫不進去只影響同一台電腦的另一個視窗。
    }
  }

  function readLocal() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  // 收到完整清單：正在拖曳的那個範圍以自己手上的為準。
  function applyTemplateList(rawList) {
    const held = session?.templateId ? templates.get(session.templateId) : null;
    templates.clear();
    for (const raw of rawList || []) {
      const template = normalizeTemplate(raw);
      if (template) templates.set(template.id, template);
    }
    if (held) {
      if (templates.has(held.id)) templates.set(held.id, held);
      else endSession();
    }
    if (selectedTemplateId && !templates.has(selectedTemplateId)) selectedTemplateId = null;
    renderList();
    scheduleRender();
  }

  function readOwnedIds() {
    try {
      const parsed = JSON.parse(window.localStorage.getItem(OWNED_STORAGE_KEY) || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function readOwnerToken() {
    try {
      const saved = window.localStorage.getItem(OWNER_TOKEN_STORAGE_KEY);
      if (saved) return saved;
      const created = `${createTemplateId()}${createTemplateId()}`;
      window.localStorage.setItem(OWNER_TOKEN_STORAGE_KEY, created);
      return created;
    } catch {
      return `${createTemplateId()}${createTemplateId()}`;
    }
  }

  function rememberOwned(templateId) {
    ownedIds.add(templateId);
    try {
      window.localStorage.setItem(OWNED_STORAGE_KEY, JSON.stringify([...ownedIds].slice(-MAX_OWNED_IDS)));
    } catch {
      // 記不住只是重新整理後這個範圍要請 GM 刪除。
    }
  }

  function canModify(template) {
    return isGm || ownedIds.has(template.id);
  }

  function publishAdd(template) {
    if (sync) sync.addMeasureTemplate(template, ownerToken).catch(logError);
    else if (!host.isRemoteRoom) writeLocal();
  }

  function publishRemove(templateId) {
    if (sync) sync.removeMeasureTemplate(templateId, ownerToken).catch(logError);
    else if (!host.isRemoteRoom) writeLocal();
  }

  function flushDragPublish() {
    window.clearTimeout(publishTimer);
    publishTimer = 0;
    const template = dirtyTemplateId ? templates.get(dirtyTemplateId) : null;
    dirtyTemplateId = null;
    if (!template) return;
    if (sync) sync.updateMeasureTemplate(template.id, { x: template.x, y: template.y, angle: template.angle }, ownerToken).catch(logError);
    else if (!host.isRemoteRoom) writeLocal();
  }

  // 拖曳途中也讓其他人看到；範圍只在吸附到新交點或新角度時才變動，流量很小。
  function queueDragPublish(templateId) {
    if (dirtyTemplateId && dirtyTemplateId !== templateId) flushDragPublish();
    dirtyTemplateId = templateId;
    if (!publishTimer) publishTimer = window.setTimeout(flushDragPublish, PUBLISH_INTERVAL_MS);
  }

  // ---- 直線與曲線的同步 ----

  function currentLine() {
    if (!measurement) return null;
    if (measurement.kind === "line") {
      return core.sameCell(measurement.from, measurement.to) ? null : { kind: "line", cells: [measurement.from, measurement.to] };
    }
    return measurement.cells.length >= 2 ? { kind: "path", cells: measurement.cells } : null;
  }

  function publishLine() {
    linePublishTimer = 0;
    const line = currentLine();
    const text = JSON.stringify(line);
    if (text === lastLineText) return;
    lastLineText = text;
    if (sync) sync.sendMeasureLine(line).catch(logError);
    else postLocalLine(line);
  }

  // 畫面每次有變化都會經過這裡；publishLine 只在線真的變了才送出。
  function queueLinePublish() {
    if (!linePublishTimer) linePublishTimer = window.setTimeout(publishLine, PUBLISH_INTERVAL_MS);
  }

  function postLocalLine(line) {
    lineChannel?.postMessage({ type: "line", owner: localOwnerId, line });
  }

  function normalizeLine(raw) {
    if ((raw?.kind !== "line" && raw?.kind !== "path") || !Array.isArray(raw.cells) || raw.cells.length < 2) return null;
    if (!raw.cells.every((cell) => Number.isInteger(cell?.col) && Number.isInteger(cell?.row))) return null;
    return { owner: String(raw.owner), kind: raw.kind, cells: raw.cells };
  }

  function applyOtherLines(rawLines) {
    otherLines = (rawLines || []).map(normalizeLine).filter(Boolean);
    scheduleRender();
  }

  // 單機與 olroom 沒有伺服器：同一台電腦的視窗互相廣播，新開的視窗向其他視窗要目前的線。
  function setupLocalLineChannel() {
    if (!("BroadcastChannel" in window)) return;
    lineChannel = new BroadcastChannel(`${host.storagePrefix}measure-lines`);
    lineChannel.addEventListener("message", ({ data }) => {
      if (data?.type === "request") {
        const line = currentLine();
        if (line) postLocalLine(line);
        return;
      }
      if (data?.type !== "line" || data.owner === localOwnerId) return;
      const others = otherLines.filter((line) => line.owner !== data.owner);
      applyOtherLines(data.line ? [...others, { owner: data.owner, ...data.line }] : others);
    });
    lineChannel.postMessage({ type: "request" });
    window.addEventListener("pagehide", () => postLocalLine(null));
  }

  function createTemplate(shape, size) {
    if (!available() || templates.size >= MAX_TEMPLATES) return;
    const rect = viewport.getBoundingClientRect();
    const center = clampToMap(host.toMapPoint({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    const origin = core.snapOrigin(shape, center.x, center.y, templateModel());
    // 預設朝螢幕右方：畫面旋轉時，地圖上的角度要反過來補償。
    const template = { id: createTemplateId(), shape, size, x: origin.x, y: origin.y, angle: (360 - host.getView().rotation) % 360, order: Date.now() };
    templates.set(template.id, template);
    rememberOwned(template.id);
    selectedTemplateId = template.id;
    publishAdd(template);
    renderList();
    scheduleRender();
  }

  function selectTemplate(templateId) {
    if (selectedTemplateId === templateId) return;
    selectedTemplateId = templateId;
    renderList();
    scheduleRender();
  }

  function removeTemplate(templateId) {
    const template = templates.get(templateId);
    if (!template || !canModify(template)) return;
    templates.delete(templateId);
    if (selectedTemplateId === templateId) selectedTemplateId = null;
    if (session?.templateId === templateId) endSession();
    publishRemove(templateId);
    renderList();
    scheduleRender();
  }

  function clearAllTemplates() {
    for (const templateId of [...templates.keys()]) removeTemplate(templateId);
  }

  // ---- 繪製 ----

  function scheduleRender() {
    queueLinePublish();
    if (renderPending) return;
    renderPending = true;
    // 視窗被蓋住或在背景時 requestAnimationFrame 可能不會執行，玩家畫面仍要跟著更新，所以另外留一個計時器。
    let timer = 0;
    const run = () => {
      if (!renderPending) return;
      window.clearTimeout(timer);
      renderPending = false;
      render();
    };
    timer = window.setTimeout(run, RENDER_FALLBACK_MS);
    window.requestAnimationFrame(run);
  }

  function resizeOverlay() {
    const dpr = window.devicePixelRatio || 1;
    const width = Math.round(viewport.clientWidth * dpr);
    const height = Math.round(viewport.clientHeight * dpr);
    if (overlay.width !== width || overlay.height !== height) {
      overlay.width = width;
      overlay.height = height;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function traceScreenPolygon(points) {
    points.forEach((point, index) => {
      const screen = toScreen(point);
      if (index) ctx.lineTo(screen.x, screen.y);
      else ctx.moveTo(screen.x, screen.y);
    });
    ctx.closePath();
  }

  function coveredCellsOf(template, model) {
    const grid = host.getGrid();
    const size = host.getMapSize();
    const key = `${template.shape}|${template.size}|${template.x}|${template.y}|${template.angle}|${gridKey(grid)}|${Boolean(grid.diagonalHouseRule)}|${size.width}x${size.height}`;
    const cached = cellCache.get(template.id);
    if (cached?.key === key) return cached.cells;
    const cells = core.coveredCells(template, model, size);
    cellCache.set(template.id, { key, cells });
    return cells;
  }

  function traceCellBoundary(template, model, shape) {
    coveredCellsOf(template, model);
    const cached = cellCache.get(template.id);
    if (!cached.boundary) cached.boundary = core.cellsBoundary([...cached.cells.map((cell) => cell.polygon), model.polygon(shape.excludedCell)]);
    for (const [a, b] of cached.boundary) {
      const from = toScreen(a);
      const to = toScreen(b);
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
    }
  }

  function strokeWithHalo(color, width) {
    ctx.lineWidth = width + 3;
    ctx.strokeStyle = "rgba(2, 6, 23, 0.72)";
    ctx.stroke();
    ctx.lineWidth = width;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  function drawTemplateArea(template, model) {
    const { color } = SHAPES[template.shape];
    const shape = core.templateShape(template, model);
    ctx.beginPath();
    for (const cell of coveredCellsOf(template, model)) traceScreenPolygon(cell.polygon);
    ctx.fillStyle = `rgba(${color}, 0.46)`;
    ctx.fill();

    ctx.beginPath();
    if (shape.type === "circle") {
      const center = toScreen(shape.center);
      ctx.arc(center.x, center.y, shape.radius * host.getView().scale, 0, Math.PI * 2);
    } else if (shape.type === "cells") {
      traceCellBoundary(template, model, shape);
    } else {
      traceScreenPolygon(shape.polygon);
    }
    const selected = template.id === selectedTemplateId;
    strokeWithHalo(selected ? "#f8fafc" : `rgb(${color})`, selected ? 3 : 2);
  }

  function drawGrip(point, color, glyph) {
    const screen = toScreen(point);
    ctx.beginPath();
    ctx.arc(screen.x, screen.y, glyph ? 11 : 7, 0, Math.PI * 2);
    ctx.fillStyle = "#f8fafc";
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = `rgb(${color})`;
    ctx.stroke();
    if (!glyph) return;
    ctx.fillStyle = "#0f172a";
    ctx.font = '700 15px system-ui, -apple-system, "Segoe UI", sans-serif';
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(glyph, screen.x, screen.y + 1);
  }

  function drawLabel(text, point) {
    ctx.font = LABEL_FONT;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const width = Math.ceil(ctx.measureText(text).width) + 18;
    // 標籤超出畫面時推回來，手機上也看得到。
    const x = Math.min(viewport.clientWidth - width / 2 - 4, Math.max(width / 2 + 4, point.x));
    const y = Math.min(viewport.clientHeight - LABEL_HEIGHT / 2 - 4, Math.max(LABEL_HEIGHT / 2 + 4, point.y));
    ctx.beginPath();
    const left = x - width / 2;
    const top = y - LABEL_HEIGHT / 2;
    if (ctx.roundRect) ctx.roundRect(left, top, width, LABEL_HEIGHT, 8);
    else ctx.rect(left, top, width, LABEL_HEIGHT);
    ctx.fillStyle = "rgba(2, 6, 23, 0.88)";
    ctx.fill();
    ctx.fillStyle = "#f8fafc";
    ctx.fillText(text, x, y + 1);
  }

  function drawDot(point, color) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(2, 6, 23, 0.85)";
    ctx.stroke();
  }

  function midpointOf(points) {
    const lengths = points.slice(1).map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    for (let index = 0; index < lengths.length; index += 1) {
      if (remaining <= lengths[index]) {
        const t = lengths[index] ? remaining / lengths[index] : 0;
        return { x: points[index].x + (points[index + 1].x - points[index].x) * t, y: points[index].y + (points[index + 1].y - points[index].y) * t };
      }
      remaining -= lengths[index];
    }
    return points[points.length - 1];
  }

  function drawMeasuredLine(line, model) {
    const points = line.cells.map((cell) => toScreen(model.center(cell)));
    const color = `rgb(${TOOL_COLORS[line.kind]})`;
    ctx.beginPath();
    points.forEach((point, index) => {
      if (index) ctx.lineTo(point.x, point.y);
      else ctx.moveTo(point.x, point.y);
    });
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    strokeWithHalo(color, 3);
    drawDot(points[0], color);
    drawDot(points[points.length - 1], color);
    const grid = host.getGrid();
    const count = line.kind === "line"
      ? core.lineCost(line.cells[0], line.cells[1], model, grid)
      : core.pathCost(line.cells, model, grid);
    drawLabel(`${count} 格`, midpointOf(points));
  }

  function render() {
    resizeOverlay();
    ctx.clearRect(0, 0, viewport.clientWidth, viewport.clientHeight);
    if (!available()) return;
    const model = templateModel();
    const { width, height } = host.getMapSize();
    const sorted = orderedTemplates();

    // 填色與外框只畫在地圖範圍內；把手與文字不裁切，才不會被切掉一半。
    ctx.save();
    ctx.beginPath();
    traceScreenPolygon([{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: height }, { x: 0, y: height }]);
    ctx.clip();
    sorted.forEach((template) => drawTemplateArea(template, model));
    ctx.restore();

    for (const template of sorted) {
      const shape = core.templateShape(template, model);
      const { color } = SHAPES[template.shape];
      const labelPoint = toScreen(shape.center);
      // 圓形與發散的中心就是原點把手，標籤往下移開才看得到數字。
      if (!shape.rotateHandle) labelPoint.y += CIRCLE_LABEL_OFFSET;
      drawLabel(`${template.size} 格`, labelPoint);
      if (!canModify(template)) continue;
      drawGrip(shape.origin, color, "");
      if (shape.rotateHandle) drawGrip(shape.rotateHandle, color, "↻");
    }
    const lineModel = currentModel();
    otherLines.forEach((line) => drawMeasuredLine(line, lineModel));
    // 自己正在畫的線：起點與終點重合時還沒有距離，但要讓畫的人看到起點。
    if (measurement) {
      drawMeasuredLine(currentLine() || { kind: measurement.kind, cells: measurement.kind === "line" ? [measurement.from, measurement.to] : measurement.cells }, lineModel);
    }
  }

  // ---- 地圖上的操作 ----

  function findGrip(event) {
    const rect = viewport.getBoundingClientRect();
    const pointer = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    const model = templateModel();
    let best = null;
    let bestDistance = event.pointerType === "mouse" ? MOUSE_GRIP_REACH : TOUCH_GRIP_REACH;
    for (const template of orderedTemplates().filter(canModify)) {
      const shape = core.templateShape(template, model);
      const grips = [{ kind: "move", point: shape.origin }];
      if (shape.rotateHandle) grips.push({ kind: "rotate", point: shape.rotateHandle });
      for (const grip of grips) {
        const screen = toScreen(grip.point);
        const distance = Math.hypot(screen.x - pointer.x, screen.y - pointer.y);
        // 用 <= 讓後放上去（畫在上面）的範圍優先。
        if (distance <= bestDistance) {
          bestDistance = distance;
          best = { kind: grip.kind, template };
        }
      }
    }
    return best;
  }

  function findTemplateBody(point) {
    const model = templateModel();
    return orderedTemplates().filter(canModify).reverse().find((template) => core.pointInShape(core.templateShape(template, model), point)) || null;
  }

  function isOverToken(event) {
    return event.target instanceof Element && Boolean(event.target.closest(".map-token"));
  }

  function beginTemplateSession(kind, template, event) {
    const shape = core.templateShape(template, templateModel());
    const point = host.toMapPoint(event);
    session = {
      kind,
      pointerId: event.pointerId,
      templateId: template.id,
      offsetX: point.x - shape.origin.x,
      offsetY: point.y - shape.origin.y
    };
  }

  function beginMeasure(event) {
    const point = host.toMapPoint(event);
    if (!isInsideMap(point)) return;
    const model = currentModel();
    const cell = model.cellAt(point.x, point.y);
    measurement = tool === "line" ? { kind: "line", from: cell, to: cell } : { kind: "path", cells: [cell] };
    session = { kind: tool, pointerId: event.pointerId, lastPoint: point };
    scheduleRender();
  }

  function moveSession(event) {
    const point = clampToMap(host.toMapPoint(event));
    const model = currentModel();
    if (session.kind === "line") {
      measurement.to = model.cellAt(point.x, point.y);
    } else if (session.kind === "path") {
      core.extendPath(measurement.cells, session.lastPoint, point, model);
      session.lastPoint = point;
    } else {
      const template = templates.get(session.templateId);
      if (!template) return;
      const shapeModel = templateModel();
      if (session.kind === "move") {
        const origin = core.snapOrigin(template.shape, point.x - session.offsetX, point.y - session.offsetY, shapeModel);
        if (origin.x === template.x && origin.y === template.y) return;
        template.x = origin.x;
        template.y = origin.y;
      } else {
        const angle = core.angleFromHandle(core.templateShape(template, shapeModel), point);
        if (angle === template.angle) return;
        template.angle = angle;
      }
      queueDragPublish(template.id);
    }
    scheduleRender();
  }

  // 放開：範圍送出最後位置；原地按一下、沒有拖出距離的量測不留在畫面上。
  function endSession() {
    if (!session) return;
    const finished = session;
    session = null;
    viewport.classList.remove("measure-dragging");
    if (finished.templateId) {
      flushDragPublish();
      return;
    }
    const emptyLine = measurement?.kind === "line" && core.sameCell(measurement.from, measurement.to);
    const emptyPath = measurement?.kind === "path" && measurement.cells.length < 2;
    if (emptyLine || emptyPath) measurement = null;
    scheduleRender();
  }

  // 第二根手指放下表示要雙指縮放：放棄進行中的量測。
  function cancelForPinch() {
    if (!session) return;
    if (!session.templateId) measurement = null;
    endSession();
    scheduleRender();
  }

  function claimPointer(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  function onPointerDown(event) {
    if (!available() || !isMapSurface(event.target)) return;
    if (session) {
      claimPointer(event);
      if (event.pointerType === "touch") cancelForPinch();
      return;
    }
    if (tool) {
      // 右鍵與滾輪照常移動、縮放地圖；工具開著時單指不會擦到霧。
      if (event.button !== 0) return;
      claimPointer(event);
      if (event.isPrimary) beginMeasure(event);
      return;
    }
    if (event.button !== 0 || !event.isPrimary) return;
    const grip = findGrip(event);
    if (grip) {
      claimPointer(event);
      selectTemplate(grip.template.id);
      beginTemplateSession(grip.kind, grip.template, event);
    } else {
      const template = !panel.hidden && !isOverToken(event) ? findTemplateBody(host.toMapPoint(event)) : null;
      if (!template) {
        selectTemplate(null);
        return;
      }
      claimPointer(event);
      selectTemplate(template.id);
      beginTemplateSession("move", template, event);
    }
    viewport.classList.add("measure-dragging");
  }

  function onPointerMove(event) {
    if (session && event.pointerId === session.pointerId) {
      claimPointer(event);
      moveSession(event);
      return;
    }
    if (session || event.pointerType !== "mouse") return;
    const canGrab = available() && !tool && isMapSurface(event.target)
      && Boolean(findGrip(event) || (!panel.hidden && !isOverToken(event) && findTemplateBody(host.toMapPoint(event))));
    viewport.classList.toggle("measure-can-grab", canGrab);
  }

  function onPointerEnd(event) {
    if (!session || event.pointerId !== session.pointerId) return;
    claimPointer(event);
    endSession();
  }

  // ---- 介面 ----

  function createToolbarButton() {
    const element = document.createElement("button");
    element.id = "measureToggleBtn";
    element.className = "tool-button";
    element.type = "button";
    element.title = "測量工具";
    element.hidden = true;
    element.setAttribute("aria-label", "測量工具");
    element.setAttribute("aria-controls", "measurePanel");
    element.setAttribute("aria-expanded", "false");
    element.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="8.5" width="19" height="7" rx="1.2"/><path d="M6.5 8.5v3M10.2 8.5v2M13.8 8.5v3M17.5 8.5v2"/></svg>';
    const host = document.getElementById("sideToolbar") || document.getElementById("floatingToolbar");
    host.insertBefore(element, host.querySelector("#diceToggleBtn") || host.querySelector(":scope > .toolbar-toggle:last-child"));
    return element;
  }

  function createPanel() {
    const element = document.createElement("section");
    element.id = "measurePanel";
    element.className = "measure-panel";
    element.setAttribute("aria-label", "測量工具");
    element.hidden = true;
    element.innerHTML = `
      <div class="measure-panel-header">
        <span class="measure-panel-title">測量工具</span>
        <button id="measureCloseBtn" class="measure-icon-button" type="button" title="收起測量工具" aria-label="收起測量工具">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="measure-tools">
        <button type="button" data-tool="line"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="19" r="2"/><circle cx="19" cy="5" r="2"/><path d="M6.5 17.5l11-11"/></svg><span>直線</span></button>
        <button type="button" data-tool="path"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="4.5" cy="19" r="2"/><circle cx="19.5" cy="5" r="2"/><path d="M6.5 19c7 0 3-10 6-12s3-2 5-2"/></svg><span>曲線</span></button>
        <button type="button" data-tool="cone"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 12L20 4.5v15z"/></svg><span>錐形</span></button>
        <button type="button" data-tool="circle"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/></svg><span>圓形</span></button>
        <button type="button" data-tool="square"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="1"/></svg><span>方形</span></button>
      </div>
      <label class="measure-house-rule" for="measureHouseRule">
        <input id="measureHouseRule" type="checkbox">
        <span>房規：斜走第一格 5 呎、第二格 10 呎</span>
      </label>
      <p id="measureHouseNote" class="measure-house-note" hidden></p>
      <p id="measureHint" class="measure-hint"></p>
      <div class="measure-list-header">
        <span>地圖上的範圍</span>
        <button id="measureClearBtn" class="measure-text-button" type="button">全部清除</button>
      </div>
      <ul id="measureList" class="measure-list"></ul>
      <p id="measureEmpty" class="measure-empty">還沒有範圍。按上面的錐形、圓形或方形新增。</p>`;
    document.body.appendChild(element);
    return element;
  }

  function createModal() {
    const element = document.createElement("div");
    element.id = "measureSizeModal";
    element.className = "measure-modal-backdrop";
    element.hidden = true;
    element.innerHTML = `
      <form class="measure-modal" role="dialog" aria-modal="true" aria-labelledby="measureModalTitle" novalidate>
        <label id="measureModalTitle" class="measure-modal-title" for="measureSizeInput"></label>
        <div class="measure-stepper">
          <button type="button" data-step="-0.5" aria-label="減少 0.5 格">−</button>
          <input id="measureSizeInput" type="number" inputmode="decimal" min="${core.MIN_SIZE}" max="${core.MAX_SIZE}" step="${core.SIZE_STEP}" autocomplete="off">
          <button type="button" data-step="0.5" aria-label="增加 0.5 格">+</button>
        </div>
        <div id="measureCircleMode" class="measure-circle-mode" role="radiogroup" aria-label="圓形的放法">
          <button type="button" role="radio" data-circle-mode="emanation"><b>發散</b><span>放格子中心，從格子邊緣往外算</span></button>
          <button type="button" role="radio" data-circle-mode="circle"><b>球形</b><span>放格線交點，算半徑</span></button>
        </div>
        <p id="measureSizeError" class="measure-modal-error" role="alert"></p>
        <div class="measure-modal-actions">
          <button type="button" class="measure-modal-cancel">取消</button>
          <button type="submit" class="measure-modal-confirm">放到地圖上</button>
        </div>
      </form>`;
    document.body.appendChild(element);
    return element;
  }

  function renderList() {
    list.replaceChildren(...orderedTemplates().map((template) => {
      const item = document.createElement("li");
      const swatch = document.createElement("span");
      swatch.className = "measure-swatch";
      swatch.style.background = `rgb(${SHAPES[template.shape].color})`;
      const name = document.createElement("span");
      name.className = "measure-item-name";
      name.textContent = `${template.size} 格${SHAPES[template.shape].label}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "measure-icon-button";
      remove.title = "移除這個範圍";
      remove.setAttribute("aria-label", `移除 ${name.textContent}`);
      remove.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
      remove.addEventListener("click", () => removeTemplate(template.id));
      item.append(swatch, name);
      if (canModify(template)) item.append(remove);
      item.classList.toggle("selected", template.id === selectedTemplateId);
      item.addEventListener("click", () => selectTemplate(template.id));
      return item;
    }));
    emptyNote.hidden = templates.size > 0;
    clearButton.hidden = !orderedTemplates().some(canModify);
    clearButton.textContent = isGm ? "全部清除" : "清除我的";
  }

  function showNotice(text) {
    hint.textContent = text;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(updateToolUi, NOTICE_MS);
  }

  function isTypingTarget(target) {
    return target instanceof Element
      && Boolean(target.closest('input:not([type="checkbox"]):not([type="range"]), textarea, select, [contenteditable]'));
  }

  // Mac 鍵盤的 delete 鍵送出的是 Backspace，兩個都接受。
  function handleDeleteKey(event) {
    if (!modal.hidden || !available() || isTypingTarget(event.target)) return;
    const template = templates.get(selectedTemplateId);
    if (!template) return;
    event.preventDefault();
    if (canModify(template)) removeTemplate(template.id);
    else showNotice("這個範圍是別人放的，只有放的人或 GM 能刪除。");
  }

  function updateToolUi() {
    for (const element of toolButtons) {
      const active = element.dataset.tool === tool;
      element.classList.toggle("active", active);
      element.setAttribute("aria-pressed", String(active));
    }
    hint.textContent = HINTS[tool || "idle"];
    viewport.classList.toggle("measure-tool-active", Boolean(tool));
  }

  // 範圍的填色是大家共用的，所以房規跟著格線設定走，由 GM 決定；玩家只看得到目前的狀態。
  function updateHouseRuleUi() {
    const grid = host.getGrid();
    const isHex = grid.type === "hex";
    const canEdit = Boolean(host.setDiagonalHouseRule);
    houseRule.checked = !isHex && Boolean(grid.diagonalHouseRule);
    houseRule.disabled = isHex || !canEdit;
    houseNote.textContent = isHex ? "六角格沒有斜走，這個房規不適用。" : (canEdit ? "" : "由 GM 決定。");
    houseNote.hidden = !houseNote.textContent;
  }

  function setTool(next) {
    if (session && !session.templateId) cancelForPinch();
    tool = next;
    measurement = null;
    updateToolUi();
    scheduleRender();
  }

  function setPanelOpen(open) {
    panel.hidden = !open;
  }

  // 面板也會被其他程式關閉（平板版同一側只開一個），所以一律看 hidden 的變化來更新狀態。
  function syncPanelState() {
    const open = !panel.hidden;
    button.classList.toggle("active", open);
    button.setAttribute("aria-expanded", String(open));
    if (open) {
      keepPanelOnScreen();
      return;
    }
    closeModal();
    if (tool) setTool(null);
    viewport.classList.remove("measure-can-grab");
  }

  function openSizeModal(shape) {
    modalShape = shape;
    modal.querySelector("#measureModalTitle").textContent = `${shape === "circle" ? "圓形" : SHAPES[shape].label}要幾格？`;
    circleModeGroup.hidden = shape !== "circle";
    updateCircleModeUi();
    sizeInput.value = lastSizes[shape];
    sizeError.textContent = "";
    modal.hidden = false;
    sizeInput.focus();
    sizeInput.select();
  }

  function closeModal() {
    modal.hidden = true;
    modalShape = null;
  }

  function confirmModal() {
    const size = core.parseSize(sizeInput.value);
    if (size === null) {
      sizeError.textContent = `請輸入 ${core.MIN_SIZE}～${core.MAX_SIZE}，以 ${core.SIZE_STEP} 為單位的數字。`;
      sizeInput.focus();
      return;
    }
    lastSizes[modalShape] = String(size);
    createTemplate(modalShape === "circle" ? circleMode : modalShape, size);
    closeModal();
  }

  function updateCircleModeUi() {
    for (const element of circleModeGroup.querySelectorAll("[data-circle-mode]")) {
      const active = element.dataset.circleMode === circleMode;
      element.classList.toggle("active", active);
      element.setAttribute("aria-checked", String(active));
    }
  }

  function stepModalValue(delta) {
    const current = Number(sizeInput.value);
    const base = Number.isFinite(current) ? Math.round(current * 2) / 2 : core.MIN_SIZE;
    sizeInput.value = String(Math.min(core.MAX_SIZE, Math.max(core.MIN_SIZE, base + delta)));
    sizeError.textContent = "";
  }

  function readPanelPosition() {
    try {
      const saved = JSON.parse(window.localStorage.getItem(PANEL_STORAGE_KEY) || "null");
      return Number.isFinite(saved?.left) && Number.isFinite(saved?.top) ? saved : null;
    } catch {
      return null;
    }
  }

  function placePanel(left, top) {
    const maxLeft = Math.max(8, window.innerWidth - panel.offsetWidth - 8);
    const maxTop = Math.max(8, window.innerHeight - panel.offsetHeight - 8);
    panel.style.left = `${Math.round(Math.min(maxLeft, Math.max(8, left)))}px`;
    panel.style.top = `${Math.round(Math.min(maxTop, Math.max(8, top)))}px`;
    panel.style.right = "auto";
  }

  function keepPanelOnScreen() {
    const saved = readPanelPosition();
    if (saved) placePanel(saved.left, saved.top);
  }

  function setupPanelDrag() {
    const header = panel.querySelector(".measure-panel-header");
    let drag = null;
    header.addEventListener("pointerdown", (event) => {
      if (event.button !== 0 || event.target.closest("button")) return;
      const rect = panel.getBoundingClientRect();
      drag = { pointerId: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top };
      header.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    header.addEventListener("pointermove", (event) => {
      if (drag?.pointerId === event.pointerId) placePanel(event.clientX - drag.dx, event.clientY - drag.dy);
    });
    const finish = (event) => {
      if (drag?.pointerId !== event.pointerId) return;
      drag = null;
      const rect = panel.getBoundingClientRect();
      try {
        window.localStorage.setItem(PANEL_STORAGE_KEY, JSON.stringify({ left: rect.left, top: rect.top }));
      } catch {
        // 位置記不住只是下次回到預設位置。
      }
    };
    header.addEventListener("pointerup", finish);
    header.addEventListener("pointercancel", finish);
  }

  // 地圖換了視角或格線：重新畫；格線被 GM 關掉時，面板與工具一起收起來。
  function refresh() {
    const isAvailable = available();
    button.hidden = !isAvailable;
    updateHouseRuleUi();
    if (!isAvailable) {
      if (!panel.hidden) setPanelOpen(false);
      closeModal();
      if (session) cancelForPinch();
    }
    const key = gridKey(host.getGrid());
    if (key !== lastGridKey) {
      lastGridKey = key;
      // 格子換了，用舊格子記的線已經沒有意義。
      measurement = null;
    }
    scheduleRender();
  }

  button.addEventListener("click", () => setPanelOpen(panel.hidden));
  panel.querySelector("#measureCloseBtn").addEventListener("click", () => setPanelOpen(false));
  clearButton.addEventListener("click", clearAllTemplates);
  houseRule.addEventListener("change", () => host.setDiagonalHouseRule?.(houseRule.checked));
  for (const element of toolButtons) {
    element.addEventListener("click", () => {
      const selected = element.dataset.tool;
      if (SHAPES[selected]) {
        setTool(null);
        openSizeModal(selected);
      } else {
        setTool(tool === selected ? null : selected);
      }
    });
  }
  modal.querySelector("form").addEventListener("submit", (event) => {
    event.preventDefault();
    confirmModal();
  });
  modal.querySelector(".measure-modal-cancel").addEventListener("click", closeModal);
  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeModal();
  });
  for (const element of modal.querySelectorAll("[data-circle-mode]")) {
    element.addEventListener("click", () => {
      circleMode = element.dataset.circleMode;
      updateCircleModeUi();
    });
  }
  for (const element of modal.querySelectorAll("[data-step]")) {
    element.addEventListener("click", () => stepModalValue(Number(element.dataset.step)));
  }
  document.addEventListener("keydown", (event) => {
    if (event.key === "Delete" || event.key === "Backspace") {
      handleDeleteKey(event);
      return;
    }
    if (event.key !== "Escape") return;
    if (!modal.hidden) closeModal();
    else if (tool) setTool(null);
  });

  new MutationObserver(syncPanelState).observe(panel, { attributes: true, attributeFilter: ["hidden"] });
  setupPanelDrag();

  // 捕獲階段搶在迷霧、token 與地圖平移之前；沒有用到的事件照常往下傳。
  viewport.addEventListener("pointerdown", onPointerDown, { capture: true, passive: false });
  window.addEventListener("pointermove", onPointerMove, { capture: true, passive: false });
  window.addEventListener("pointerup", onPointerEnd, { capture: true, passive: false });
  window.addEventListener("pointercancel", onPointerEnd, { capture: true, passive: false });
  window.addEventListener("mapfog:view-change", refresh);
  window.addEventListener("resize", () => {
    if (!panel.hidden) keepPanelOnScreen();
    scheduleRender();
  });
  if ("ResizeObserver" in window) new ResizeObserver(scheduleRender).observe(viewport);
  document.addEventListener("visibilitychange", scheduleRender);

  if (host.isRemoteRoom) {
    host.whenSyncReady((api) => {
      sync = api;
      api.onMeasureTemplates(applyTemplateList);
      api.onMeasureLines(applyOtherLines);
    });
  } else {
    setupLocalLineChannel();
    applyTemplateList(readLocal());
    window.addEventListener("storage", (event) => {
      if (event.key === LOCAL_STORAGE_KEY) applyTemplateList(readLocal());
    });
  }

  window.MapFogMeasure = { clearAllTemplates };
  updateToolUi();
  renderList();
  refresh();
})();
