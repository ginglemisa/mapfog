// token 格子化的純計算：格子化時 token 該畫在哪裡、畫多大，以及方向鍵要走到哪裡。不碰畫面，瀏覽器與 Node 測試共用。
// 格子換算一律用 measure-core.js 的格線模型，這裡不另寫一套。
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const core = factory(isNode ? require("./measure-core.js") : root.MapFogMeasureCore);
  if (isNode) module.exports = core;
  else root.MapFogTokenGrid = core;
})(typeof self !== "undefined" ? self : this, function (measureCore) {
  "use strict";

  const { createGridModel, createTemplateModel, cellsBoundary } = measureCore;

  // 尺寸是固定的實際大小：方格佔幾個 5 呎格（小 5×5、中 10×10、大 15×15 呎），一格 10 呎的地圖會畫成 0.5、1、1.5 格。
  // 六角格固定每格 5 呎，小中大是 1、3、7 格（DMG 2014 的 Creature Size and Space 表），畫成實際佔的格子組成的形狀。
  const FOOTPRINT_SPAN = { small: 1, medium: 2, large: 3 };
  const DEFAULT_FOOTPRINT = "small";
  const ARROW_STEPS = {
    ArrowUp: { dx: 0, dy: -1 },
    ArrowDown: { dx: 0, dy: 1 },
    ArrowLeft: { dx: -1, dy: 0 },
    ArrowRight: { dx: 1, dy: 0 }
  };
  // 交點同時碰到多個格子，往固定方向偏一點點才知道要看哪一格；四捨五入也不會跨到別格。
  const NUDGE_RATIO = 0.01;
  // 最近的對齊點落在地圖外時，往外找這麼多格內的對齊點。
  const SEARCH_CELLS = 2;
  const BOUNDS_EPSILON = 1e-6;
  const VERTEX_PROBE_RATIO = 0.25;
  // 這些地方方向鍵本來就有用途。勾選框與按鈕沒有，按完開關或尺寸可以直接用方向鍵。
  const ARROW_BLOCKING_SELECTOR = [
    "input:not([type=checkbox]):not([type=button]):not([type=submit]):not([type=reset]):not([type=file]):not([type=color])",
    "textarea",
    "select",
    "[contenteditable]:not([contenteditable=false])",
    "dialog",
    "[role=dialog]",
    "[aria-modal=true]",
    ".mapfog-initiative-panel"
  ].join(",");

  function normalizeFootprint(value) {
    return Object.prototype.hasOwnProperty.call(FOOTPRINT_SPAN, value) ? value : DEFAULT_FOOTPRINT;
  }

  // 沒開格線時開關無效。
  function isActive(grid) {
    return Boolean(grid?.enabled && grid?.tokenSnap);
  }

  function isInside(point, bounds) {
    if (!bounds) return true;
    return point.x >= -BOUNDS_EPSILON && point.y >= -BOUNDS_EPSILON
      && point.x <= bounds.width + BOUNDS_EPSILON && point.y <= bounds.height + BOUNDS_EPSILON;
  }

  // 方格的中佔偶數個 5 呎格，六角格的中佔三格，都以交點為中心；小與大以格子中心為中心。
  function usesIntersection(footprint) {
    return normalizeFootprint(footprint) === "medium";
  }

  function nearestAnchor(model, point, footprint, bounds) {
    const primary = usesIntersection(footprint)
      ? model.snapToIntersection(point.x, point.y)
      : model.center(model.cellAt(point.x, point.y));
    if (isInside(primary, bounds)) return primary;
    // 格線有位移時，最近的格子可能在地圖外，改用地圖內最近的對齊點。
    const reach = model.pitch * SEARCH_CELLS;
    const box = { minX: point.x - reach, minY: point.y - reach, maxX: point.x + reach, maxY: point.y + reach };
    let best = null;
    let bestDistance = Infinity;
    model.forEachCellInBox(box, (cell) => {
      for (const anchor of usesIntersection(footprint) ? model.polygon(cell) : [model.center(cell)]) {
        const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
        if (isInside(anchor, bounds) && distance < bestDistance - BOUNDS_EPSILON) {
          best = anchor;
          bestDistance = distance;
        }
      }
    });
    return best || primary;
  }

  // 格子化的六角格上，token 一律畫成六角形，形狀由格子決定。
  function shapeFollowsGrid(grid) {
    return isActive(grid) && grid.type === "hex";
  }

  function displayShape(grid, token) {
    return shapeFollowsGrid(grid) ? "hex" : token.shape;
  }

  function pixelSize(grid, footprint) {
    return createTemplateModel(grid).pitch * FOOTPRINT_SPAN[normalizeFootprint(footprint)];
  }

  // 六角格的中繞著一個頂點，頂點有一格在左或一格在右兩種方向；往六個方向各探一點就知道實際是哪三格。
  function cellsAroundVertex(model, vertex) {
    const cells = new Map();
    for (let index = 0; index < 6; index += 1) {
      const angle = (Math.PI / 6) * (2 * index + 1);
      const cell = model.cellAt(vertex.x + Math.cos(angle) * model.pitch * VERTEX_PROBE_RATIO, vertex.y + Math.sin(angle) * model.pitch * VERTEX_PROBE_RATIO);
      cells.set(`${cell.col},${cell.row}`, cell);
    }
    return [...cells.values()];
  }

  function cellAndNeighbors(model, center) {
    const point = model.center(center);
    const reach = model.pitch * 1.5;
    const cells = [];
    model.forEachCellInBox({ minX: point.x - reach, minY: point.y - reach, maxX: point.x + reach, maxY: point.y + reach }, (cell) => {
      if (model.distance(cell, center) <= 1) cells.push(cell);
    });
    return cells;
  }

  function hexFootprintCells(model, anchor, footprint) {
    if (usesIntersection(footprint)) return cellsAroundVertex(model, anchor);
    const center = model.cellAt(anchor.x, anchor.y);
    return normalizeFootprint(footprint) === "large" ? cellAndNeighbors(model, center) : [center];
  }

  // 把格子聯集的邊界線段接成一圈，當成裁切外框。
  function unionOutline(model, cells) {
    const keyOf = (point) => `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
    const links = new Map();
    const link = (from, to) => links.set(keyOf(from), [...(links.get(keyOf(from)) || []), to]);
    const segments = cellsBoundary(cells.map((cell) => model.polygon(cell)));
    for (const [a, b] of segments) {
      link(a, b);
      link(b, a);
    }
    const outline = [segments[0][0]];
    let previous = null;
    while (outline.length < segments.length) {
      const current = outline[outline.length - 1];
      const next = links.get(keyOf(current)).find((point) => !previous || keyOf(point) !== keyOf(previous));
      previous = current;
      outline.push(next);
    }
    return outline;
  }

  function hexPlacement(grid, token, anchor) {
    const model = createGridModel(grid);
    const cells = hexFootprintCells(model, anchor, token.footprint);
    const outline = unionOutline(model, cells);
    const xs = outline.map((point) => point.x);
    const ys = outline.map((point) => point.y);
    const box = { minX: Math.min(...xs), minY: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
    return { ...anchor, shape: "hex", size: Math.max(box.width, box.height), cells, outline, box };
  }

  function snapPoint(grid, token, bounds) {
    const anchor = nearestAnchor(createTemplateModel(grid), token, token.footprint, bounds);
    return { x: anchor.x, y: anchor.y };
  }

  // 格子化時實際畫出來的位置、大小與形狀；token 自己存的 x、y、size、shape 不動，關閉格子化就回到原本的樣子。
  function placement(grid, token, bounds) {
    const anchor = snapPoint(grid, token, bounds);
    if (shapeFollowsGrid(grid)) return hexPlacement(grid, token, anchor);
    return { ...anchor, size: pixelSize(grid, token.footprint), shape: displayShape(grid, token) };
  }

  // 拖曳途中整個形狀跟著指標移動，放開才重新對齊。
  function placedAt(placed, x, y) {
    if (!placed.outline) return { ...placed, x, y };
    const dx = x - placed.x;
    const dy = y - placed.y;
    return {
      ...placed,
      x,
      y,
      outline: placed.outline.map((point) => ({ x: point.x + dx, y: point.y + dy })),
      box: { ...placed.box, minX: placed.box.minX + dx, minY: placed.box.minY + dy }
    };
  }

  function toScreenOffset(x, y, rotation) {
    if (rotation === 90) return { x: -y, y: x };
    if (rotation === 180) return { x: -x, y: -y };
    if (rotation === 270) return { x: y, y: -x };
    return { x, y };
  }

  // 元素的方框與裁切外框。token 會反向旋轉維持正向，所以方框與外框都以螢幕方向計算，形狀才會貼齊地圖上的格子。
  function elementFrame(placed, rotation) {
    if (!placed.outline) {
      return { left: placed.x - placed.size / 2, top: placed.y - placed.size / 2, width: placed.size, height: placed.size, clipPath: "" };
    }
    const sideways = rotation % 180 !== 0;
    const width = sideways ? placed.box.height : placed.box.width;
    const height = sideways ? placed.box.width : placed.box.height;
    const centerX = placed.box.minX + placed.box.width / 2;
    const centerY = placed.box.minY + placed.box.height / 2;
    const points = placed.outline.map((point) => {
      const offset = toScreenOffset(point.x - centerX, point.y - centerY, rotation);
      return `${(offset.x + width / 2).toFixed(3)}px ${(offset.y + height / 2).toFixed(3)}px`;
    });
    return { left: centerX - width / 2, top: centerY - height / 2, width, height, clipPath: `polygon(${points.join(", ")})` };
  }

  // 換尺寸後的位置：中心與交點互換時固定往左上／右下找，來回切換才不會一路飄走。
  function retarget(grid, token, nextFootprint, bounds) {
    const model = createTemplateModel(grid);
    const here = nearestAnchor(model, token, token.footprint, bounds);
    const nudge = model.pitch * NUDGE_RATIO;
    let probe = here;
    if (usesIntersection(nextFootprint) && !usesIntersection(token.footprint)) probe = { x: here.x - nudge, y: here.y - nudge };
    if (!usesIntersection(nextFootprint) && usesIntersection(token.footprint)) probe = { x: here.x + nudge, y: here.y + nudge };
    const anchor = nearestAnchor(model, probe, nextFootprint, bounds);
    return { x: anchor.x, y: anchor.y };
  }

  // 畫面順時針轉了 rotation 度，把螢幕上的方向換回地圖上的方向。
  function toMapDirection({ dx, dy }, rotation) {
    if (rotation === 90) return { dx: dy, dy: -dx };
    if (rotation === 180) return { dx: -dx, dy: -dy };
    if (rotation === 270) return { dx: -dy, dy: dx };
    return { dx, dy };
  }

  // 按一次方向鍵的目的地：走一個畫出來的格子，對齊方式不變；走出地圖回傳 null。
  // 六角格的相鄰欄有上下兩格一樣近，固定選列號相同的那格：連按左右會上下交錯、整體維持水平。
  function step(grid, token, key, rotation, bounds) {
    const screen = ARROW_STEPS[key];
    if (!screen) return null;
    const { dx, dy } = toMapDirection(screen, rotation);
    const model = createGridModel(grid);
    const here = nearestAnchor(createTemplateModel(grid), token, token.footprint, bounds);
    const nudge = usesIntersection(token.footprint) ? model.pitch * NUDGE_RATIO : 0;
    const cell = model.cellAt(here.x + nudge, here.y + nudge);
    const from = model.center(cell);
    const to = model.center({ col: cell.col + dx, row: cell.row + dy });
    const next = { x: here.x + to.x - from.x, y: here.y + to.y - from.y };
    return isInside(next, bounds) ? next : null;
  }

  function hasOpenModal(doc) {
    return Array.from(doc.querySelectorAll("dialog[open], [aria-modal=true]")).some((element) => !element.closest("[hidden]"));
  }

  function shouldHandleArrowKey(event, doc) {
    if (!ARROW_STEPS[event.key] || event.defaultPrevented || event.isComposing) return false;
    if (event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return false;
    if (event.target?.closest?.(ARROW_BLOCKING_SELECTOR)) return false;
    return !hasOpenModal(doc);
  }

  return {
    ARROW_BLOCKING_SELECTOR,
    DEFAULT_FOOTPRINT,
    normalizeFootprint,
    isActive,
    shapeFollowsGrid,
    displayShape,
    pixelSize,
    snapPoint,
    placement,
    placedAt,
    elementFrame,
    retarget,
    step,
    shouldHandleArrowKey
  };
});
