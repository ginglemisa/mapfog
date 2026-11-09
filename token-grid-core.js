// token 格子化的純計算：格子化時 token 該畫在哪裡、畫多大，以及方向鍵要走到哪裡。不碰畫面，瀏覽器與 Node 測試共用。
// 格子換算一律用 measure-core.js 的格線模型，這裡不另寫一套。
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const core = factory(isNode ? require("./measure-core.js") : root.MapFogMeasureCore);
  if (isNode) module.exports = core;
  else root.MapFogTokenGrid = core;
})(typeof self !== "undefined" ? self : this, function (measureCore) {
  "use strict";

  const { createGridModel } = measureCore;

  // 尺寸以畫出來的格子為單位，不受「一格 10 呎」影響。
  const FOOTPRINT_SCALE = { small: 0.5, medium: 1, large: 2 };
  const DEFAULT_FOOTPRINT = "medium";
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
    return Object.prototype.hasOwnProperty.call(FOOTPRINT_SCALE, value) ? value : DEFAULT_FOOTPRINT;
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

  function isLarge(footprint) {
    return normalizeFootprint(footprint) === "large";
  }

  // 大的對齊格線交點，其餘對齊格子中心。
  function nearestAnchor(model, point, footprint, bounds) {
    const primary = isLarge(footprint)
      ? model.snapToIntersection(point.x, point.y)
      : model.center(model.cellAt(point.x, point.y));
    if (isInside(primary, bounds)) return primary;
    // 格線有位移時，最近的格子可能在地圖外，改用地圖內最近的對齊點。
    const reach = model.pitch * SEARCH_CELLS;
    const box = { minX: point.x - reach, minY: point.y - reach, maxX: point.x + reach, maxY: point.y + reach };
    let best = null;
    let bestDistance = Infinity;
    model.forEachCellInBox(box, (cell) => {
      for (const anchor of isLarge(footprint) ? model.polygon(cell) : [model.center(cell)]) {
        const distance = Math.hypot(anchor.x - point.x, anchor.y - point.y);
        if (isInside(anchor, bounds) && distance < bestDistance - BOUNDS_EPSILON) {
          best = anchor;
          bestDistance = distance;
        }
      }
    });
    return best || primary;
  }

  // 六角格的「一格」：六角形 token 取左右頂點距離，剛好貼齊格子；方形 token 取上下邊距離，才不會蓋到上下鄰格。
  function pixelSize(grid, footprint, shape) {
    const base = grid.type === "hex" && shape !== "hex" ? createGridModel(grid).pitch : grid.size;
    return base * FOOTPRINT_SCALE[normalizeFootprint(footprint)];
  }

  function snapPoint(grid, token, bounds) {
    const anchor = nearestAnchor(createGridModel(grid), token, token.footprint, bounds);
    return { x: anchor.x, y: anchor.y };
  }

  // 格子化時實際畫出來的位置與大小；token 自己存的 x、y、size 不動，關閉格子化就回到原本的樣子。
  function placement(grid, token, bounds) {
    return { ...snapPoint(grid, token, bounds), size: pixelSize(grid, token.footprint, token.shape) };
  }

  // 換尺寸後的位置：中心與交點互換時固定往左上／右下找，來回切換才不會一路飄走。
  function retarget(grid, token, nextFootprint, bounds) {
    const model = createGridModel(grid);
    const here = nearestAnchor(model, token, token.footprint, bounds);
    const nudge = model.pitch * NUDGE_RATIO;
    let probe = here;
    if (isLarge(nextFootprint) && !isLarge(token.footprint)) probe = { x: here.x - nudge, y: here.y - nudge };
    if (!isLarge(nextFootprint) && isLarge(token.footprint)) probe = { x: here.x + nudge, y: here.y + nudge };
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

  // 按一次方向鍵的目的地；走出地圖回傳 null。
  // 六角格的相鄰欄有上下兩格一樣近，固定選列號相同的那格：連按左右會上下交錯、整體維持水平。
  function step(grid, token, key, rotation, bounds) {
    const screen = ARROW_STEPS[key];
    if (!screen) return null;
    const { dx, dy } = toMapDirection(screen, rotation);
    const model = createGridModel(grid);
    const here = nearestAnchor(model, token, token.footprint, bounds);
    const nudge = isLarge(token.footprint) ? model.pitch * NUDGE_RATIO : 0;
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
    pixelSize,
    snapPoint,
    placement,
    retarget,
    step,
    shouldHandleArrowKey
  };
});
