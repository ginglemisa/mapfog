// token 格子化的計算：尺寸、對齊、換尺寸、方向鍵，以及三處 token 欄位清單是否一致。
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../token-grid-core");
const { createGridModel } = require("../measure-core");

const SQUARE = { enabled: true, tokenSnap: true, type: "square", size: 100, offsetX: 0, offsetY: 0 };
const TEN_FOOT = { ...SQUARE, tenFoot: true };
const HEX = { ...SQUARE, type: "hex" };
const BOUNDS = { width: 100000, height: 100000 };
const HEX_HEIGHT = Math.sqrt(3) * 50;

function near(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-6, `${label ?? "值"}：${actual} 應接近 ${expected}`);
}

function nearPoint(actual, expected) {
  near(actual.x, expected.x, "x");
  near(actual.y, expected.y, "y");
}

test("開關：要同時開啟格線與格子化才生效", () => {
  assert.equal(core.isActive(SQUARE), true);
  assert.equal(core.isActive({ ...SQUARE, enabled: false }), false);
  assert.equal(core.isActive({ ...SQUARE, tokenSnap: false }), false);
  assert.equal(core.isActive(undefined), false);
});

test("尺寸名稱：不認得的值一律當成小", () => {
  assert.equal(core.normalizeFootprint("medium"), "medium");
  assert.equal(core.normalizeFootprint("large"), "large");
  assert.equal(core.normalizeFootprint("toString"), "small");
  assert.equal(core.normalizeFootprint(undefined), "small");
});

test("方格一格 5 呎：小 1 格、中 2 格、大 3 格", () => {
  assert.equal(core.pixelSize(SQUARE, "small"), 100);
  assert.equal(core.pixelSize(SQUARE, "medium"), 200);
  assert.equal(core.pixelSize(SQUARE, "large"), 300);
});

test("方格一格 10 呎：小 0.5 格、中 1 格、大 1.5 格", () => {
  assert.equal(core.pixelSize(TEN_FOOT, "small"), 50);
  assert.equal(core.pixelSize(TEN_FOOT, "medium"), 100);
  assert.equal(core.pixelSize(TEN_FOOT, "large"), 150);
});

test("格子化的六角格上一律畫成六角形，token 存的形狀不變", () => {
  for (const footprint of ["small", "medium", "large"]) {
    for (const shape of ["square", "hex"]) {
      const token = Object.freeze({ x: 2010, y: 1730, shape, footprint });
      const placed = core.placement(HEX, token, BOUNDS);
      assert.equal(placed.shape, "hex", shape + " " + footprint);
      assert.equal(token.shape, shape);
    }
  }
});

test("其他情況維持 token 自己的形狀", () => {
  assert.equal(core.placement(SQUARE, { x: 130, y: 140, shape: "square" }).shape, "square");
  assert.equal(core.placement(SQUARE, { x: 130, y: 140, shape: "hex" }).shape, "hex");
  assert.equal(core.displayShape({ ...HEX, tokenSnap: false }, { shape: "square" }), "square");
  assert.equal(core.displayShape({ ...HEX, enabled: false }, { shape: "square" }), "square");
  assert.equal(core.shapeFollowsGrid(HEX), true);
  assert.equal(core.shapeFollowsGrid(SQUARE), false);
  assert.equal(core.shapeFollowsGrid({ ...HEX, tokenSnap: false }), false);
});

test("六角格不支援一格 10 呎：就算設定留著也不換算", () => {
  const grid = { ...HEX, tenFoot: true };
  for (const footprint of ["small", "medium", "large"]) {
    assert.equal(core.placement(grid, { x: 310, y: 400, shape: "hex", footprint }).size, core.placement(HEX, { x: 310, y: 400, shape: "hex", footprint }).size);
    assert.deepEqual(core.snapPoint(grid, { x: 310, y: 400, footprint }), core.snapPoint(HEX, { x: 310, y: 400, footprint }));
  }
});

test("方格一格 5 呎：小與大對齊格子中心，中對齊格線交點", () => {
  const grid = { ...SQUARE, offsetX: 10, offsetY: 20 };
  assert.deepEqual(core.snapPoint(grid, { x: 130, y: 140, footprint: "small" }), { x: 160, y: 170 });
  assert.deepEqual(core.snapPoint(grid, { x: 130, y: 140, footprint: "large" }), { x: 160, y: 170 });
  assert.deepEqual(core.snapPoint(grid, { x: 130, y: 140, footprint: "medium" }), { x: 110, y: 120 });
});

test("方格一格 10 呎：以 5 呎小格對齊", () => {
  const point = { x: 130, y: 140 };
  assert.deepEqual(core.snapPoint(TEN_FOOT, { ...point, footprint: "small" }), { x: 125, y: 125 });
  assert.deepEqual(core.snapPoint(TEN_FOOT, { ...point, footprint: "large" }), { x: 125, y: 125 });
  assert.deepEqual(core.snapPoint(TEN_FOOT, { ...point, footprint: "medium" }), { x: 150, y: 150 });
});

test("placement 回傳畫的位置與大小，不改動 token 本身", () => {
  const token = Object.freeze({ x: 130, y: 140, size: 333, shape: "square", footprint: "medium" });
  assert.deepEqual(core.placement(SQUARE, token, BOUNDS), { x: 100, y: 100, size: 200, shape: "square" });
  assert.equal(token.size, 333);
});

function cellKeys(cells) {
  return cells.map((cell) => cell.col + "," + cell.row).sort();
}

function polygonArea(points) {
  return Math.abs(points.reduce((sum, a, index) => {
    const b = points[(index + 1) % points.length];
    return sum + a.x * b.y - b.x * a.y;
  }, 0)) / 2;
}

function insidePolygon(points, point) {
  let inside = false;
  points.forEach((a, index) => {
    const b = points[(index + 1) % points.length];
    if ((a.y > point.y) !== (b.y > point.y) && point.x < a.x + ((point.y - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside;
  });
  return inside;
}

function hexToken(model, point, footprint) {
  return { ...point, shape: "square", footprint };
}

test("六角格的小是一格，對齊格子中心", () => {
  const model = createGridModel(HEX);
  const placed = core.placement(HEX, hexToken(model, model.center({ col: 10, row: 10 }), "small"), BOUNDS);
  assert.deepEqual(cellKeys(placed.cells), ["10,10"]);
  nearPoint(placed, model.center({ col: 10, row: 10 }));
});

test("六角格的中是繞著頂點的三格，兩種頂點方向都正確", () => {
  const model = createGridModel(HEX);
  const corners = model.polygon({ col: 10, row: 10 });
  // 第 0 個頂點在格子右邊：一格在左、兩格在右。
  const oneOnLeft = core.placement(HEX, hexToken(model, corners[0], "medium"), BOUNDS);
  assert.deepEqual(cellKeys(oneOnLeft.cells), ["10,10", "11,10", "11,9"]);
  nearPoint(oneOnLeft, corners[0]);
  // 第 3 個頂點在格子左邊：一格在右、兩格在左。
  const oneOnRight = core.placement(HEX, hexToken(model, corners[3], "medium"), BOUNDS);
  assert.deepEqual(cellKeys(oneOnRight.cells), ["10,10", "9,10", "9,9"]);
  nearPoint(oneOnRight, corners[3]);
});

test("六角格的大是中央一格加周圍六格，奇偶欄都正確", () => {
  const model = createGridModel(HEX);
  const even = core.placement(HEX, hexToken(model, model.center({ col: 10, row: 10 }), "large"), BOUNDS);
  assert.deepEqual(cellKeys(even.cells), ["10,10", "10,11", "10,9", "11,10", "11,9", "9,10", "9,9"]);
  const odd = core.placement(HEX, hexToken(model, model.center({ col: 11, row: 10 }), "large"), BOUNDS);
  assert.deepEqual(cellKeys(odd.cells), ["10,10", "10,11", "11,10", "11,11", "11,9", "12,10", "12,11"]);
});

test("外框與佔的格子完全重合", () => {
  const model = createGridModel(HEX);
  const corners = model.polygon({ col: 10, row: 10 });
  const cases = [
    [model.center({ col: 10, row: 10 }), "small", 1, 6],
    [corners[0], "medium", 3, 12],
    [corners[3], "medium", 3, 12],
    [model.center({ col: 10, row: 10 }), "large", 7, 18],
    [model.center({ col: 11, row: 10 }), "large", 7, 18]
  ];
  for (const [point, footprint, cellCount, cornerCount] of cases) {
    const placed = core.placement(HEX, hexToken(model, point, footprint), BOUNDS);
    assert.equal(placed.cells.length, cellCount, footprint);
    assert.equal(placed.outline.length, cornerCount, footprint);
    // 面積等於格子總和，再加上每個格子中心都在裡面，代表外框就是聯集。
    const cellArea = placed.cells.reduce((sum, cell) => sum + polygonArea(model.polygon(cell)), 0);
    near(polygonArea(placed.outline), cellArea, footprint + " 面積");
    const keys = new Set(cellKeys(placed.cells));
    model.forEachCellInBox({ minX: placed.x - 400, minY: placed.y - 400, maxX: placed.x + 400, maxY: placed.y + 400 }, (cell) => {
      assert.equal(insidePolygon(placed.outline, model.center(cell)), keys.has(cell.col + "," + cell.row), footprint + " " + cell.col + "," + cell.row);
    });
    const xs = placed.outline.map((p) => p.x);
    const ys = placed.outline.map((p) => p.y);
    near(placed.box.minX, Math.min(...xs));
    near(placed.box.minY, Math.min(...ys));
    near(placed.box.width, Math.max(...xs) - Math.min(...xs));
    near(placed.box.height, Math.max(...ys) - Math.min(...ys));
  }
});

// 把 elementFrame 的裁切外框換回地圖座標：元素跟螢幕同方向，以元素中心旋轉回去。
function outlineFromFrame(frame, rotation) {
  const centerX = frame.left + frame.width / 2;
  const centerY = frame.top + frame.height / 2;
  const toMap = { 0: (x, y) => [x, y], 90: (x, y) => [y, -x], 180: (x, y) => [-x, -y], 270: (x, y) => [-y, x] }[rotation];
  return frame.clipPath.replace(/^polygon\(|\)$/g, "").split(", ").map((pair) => {
    const [px, py] = pair.split(" ").map(parseFloat);
    assert.ok(px >= -1e-3 && px <= frame.width + 1e-3 && py >= -1e-3 && py <= frame.height + 1e-3, "外框要在方框內");
    const [dx, dy] = toMap(px - frame.width / 2, py - frame.height / 2);
    return { x: centerX + dx, y: centerY + dy };
  });
}

test("畫面旋轉時方框與外框跟著畫面方向，換回地圖座標仍貼齊格子", () => {
  const model = createGridModel(HEX);
  const corners = model.polygon({ col: 10, row: 10 });
  for (const [point, footprint] of [[model.center({ col: 10, row: 10 }), "small"], [corners[0], "medium"], [corners[3], "medium"], [model.center({ col: 11, row: 10 }), "large"]]) {
    const placed = core.placement(HEX, hexToken(model, point, footprint), BOUNDS);
    for (const rotation of [0, 90, 180, 270]) {
      const frame = core.elementFrame(placed, rotation);
      const sideways = rotation % 180 !== 0;
      near(frame.width, sideways ? placed.box.height : placed.box.width, "寬");
      near(frame.height, sideways ? placed.box.width : placed.box.height, "高");
      const outline = outlineFromFrame(frame, rotation);
      assert.equal(outline.length, placed.outline.length);
      outline.forEach((corner, index) => {
        assert.ok(Math.hypot(corner.x - placed.outline[index].x, corner.y - placed.outline[index].y) < 0.01, footprint + "@" + rotation);
      });
    }
  }
});

test("方格與自由大小的 token 沒有裁切外框", () => {
  const frame = core.elementFrame(core.placement(SQUARE, { x: 130, y: 140, shape: "square", footprint: "medium" }, BOUNDS), 90);
  assert.deepEqual(frame, { left: 0, top: 0, width: 200, height: 200, clipPath: "" });
  assert.deepEqual(core.elementFrame({ x: 100, y: 100, size: 96 }, 0), { left: 52, top: 52, width: 96, height: 96, clipPath: "" });
});

test("拖曳途中整個形狀跟著移動", () => {
  const model = createGridModel(HEX);
  const placed = core.placement(HEX, hexToken(model, model.polygon({ col: 10, row: 10 })[0], "medium"), BOUNDS);
  const moved = core.placedAt(placed, placed.x + 33, placed.y - 21);
  assert.equal(moved.x, placed.x + 33);
  near(moved.box.minX, placed.box.minX + 33);
  near(moved.box.minY, placed.box.minY - 21);
  nearPoint(moved.outline[4], { x: placed.outline[4].x + 33, y: placed.outline[4].y - 21 });
  assert.deepEqual(core.placedAt({ x: 1, y: 2, size: 96 }, 5, 6), { x: 5, y: 6, size: 96 });
});

test("中的三格形狀移動後對應新的頂點", () => {
  const model = createGridModel(HEX);
  const start = model.polygon({ col: 10, row: 10 })[0];
  let token = { ...start, shape: "square", footprint: "medium" };
  for (const key of ["ArrowRight", "ArrowUp", "ArrowLeft", "ArrowDown", "ArrowRight"]) {
    token = { ...token, ...core.step(HEX, token, key, 0, BOUNDS) };
    const placed = core.placement(HEX, token, BOUNDS);
    assert.equal(placed.cells.length, 3, key);
    for (const cell of placed.cells) {
      assert.ok(model.polygon(cell).some((corner) => Math.hypot(corner.x - placed.x, corner.y - placed.y) < 1e-6), key + " 三格都要碰到頂點");
    }
  }
});

test("對齊是冪等的：已對齊的位置不再移動，四捨五入後也一樣", () => {
  for (const grid of [SQUARE, TEN_FOOT, HEX]) {
    for (const footprint of ["small", "medium", "large"]) {
      for (const [x, y] of [[313, 477], [1200, 90], [755.5, 1234.2]]) {
        const once = core.snapPoint(grid, { x, y, footprint }, BOUNDS);
        const twice = core.snapPoint(grid, { ...once, footprint }, BOUNDS);
        nearPoint(twice, once);
        const rounded = { x: Math.round(once.x * 10) / 10, y: Math.round(once.y * 10) / 10, footprint };
        nearPoint(core.snapPoint(grid, rounded, BOUNDS), once);
      }
    }
  }
});

test("格線位移讓最近的格子落在地圖外時，改用地圖內的格子", () => {
  const grid = { ...SQUARE, offsetX: 30, offsetY: 30 };
  const bounds = { width: 500, height: 500 };
  // 最近的格子中心是 (-20, -20)，地圖內最近的是 (80, 80)。
  assert.deepEqual(core.snapPoint(grid, { x: 5, y: 5, footprint: "small" }, bounds), { x: 80, y: 80 });
  assert.deepEqual(core.snapPoint(grid, { x: 5, y: 5, footprint: "small" }), { x: -20, y: -20 });
  // 中對齊交點：(30, 30) 本來就在地圖內。
  assert.deepEqual(core.snapPoint(grid, { x: 5, y: 5, footprint: "medium" }, bounds), { x: 30, y: 30 });
});

test("換尺寸：小→中→小回到同一格，來回不會飄走", () => {
  for (const grid of [SQUARE, TEN_FOOT, HEX]) {
    const model = grid === TEN_FOOT ? createGridModel({ ...SQUARE, size: 50 }) : createGridModel(grid);
    const start = { ...model.center({ col: 7, row: 9 }), shape: "square", footprint: "small" };
    let current = start;
    for (let round = 0; round < 4; round += 1) {
      const medium = { ...current, ...core.retarget(grid, current, "medium", BOUNDS), footprint: "medium" };
      nearPoint(core.snapPoint(grid, medium, BOUNDS), medium);
      current = { ...medium, ...core.retarget(grid, medium, "small", BOUNDS), footprint: "small" };
      nearPoint(current, start);
    }
    // 小與大的中心相同。
    nearPoint(core.retarget(grid, start, "large", BOUNDS), start);
  }
});

test("方向鍵：方格移動一個畫出來的格子，小、中、大都一樣", () => {
  for (const footprint of ["small", "medium", "large"]) {
    const here = core.snapPoint(SQUARE, { x: 510, y: 520, footprint }, BOUNDS);
    const token = { ...here, footprint };
    assert.deepEqual(core.step(SQUARE, token, "ArrowRight", 0, BOUNDS), { x: here.x + 100, y: here.y });
    assert.deepEqual(core.step(SQUARE, token, "ArrowLeft", 0, BOUNDS), { x: here.x - 100, y: here.y });
    assert.deepEqual(core.step(SQUARE, token, "ArrowUp", 0, BOUNDS), { x: here.x, y: here.y - 100 });
    assert.deepEqual(core.step(SQUARE, token, "ArrowDown", 0, BOUNDS), { x: here.x, y: here.y + 100 });
  }
});

test("方向鍵：一格 10 呎的地圖也走一個畫出來的格子，移動後仍對齊 5 呎格", () => {
  for (const footprint of ["small", "medium", "large"]) {
    const here = core.snapPoint(TEN_FOOT, { x: 510, y: 520, footprint }, BOUNDS);
    const next = core.step(TEN_FOOT, { ...here, footprint }, "ArrowRight", 0, BOUNDS);
    assert.deepEqual(next, { x: here.x + 100, y: here.y });
    assert.deepEqual(core.snapPoint(TEN_FOOT, { ...next, footprint }, BOUNDS), next);
  }
});

test("方向鍵：跟著畫面旋轉，按的方向就是螢幕上看到的方向", () => {
  const token = { x: 550, y: 550, footprint: "small" };
  const moved = (key, rotation) => {
    const next = core.step(SQUARE, token, key, rotation, BOUNDS);
    return [next.x - token.x, next.y - token.y];
  };
  // 畫面順時針轉 90°：地圖的 -y 朝向螢幕右邊、+x 朝向螢幕下方。
  assert.deepEqual(moved("ArrowRight", 90), [0, -100]);
  assert.deepEqual(moved("ArrowDown", 90), [100, 0]);
  assert.deepEqual(moved("ArrowLeft", 90), [0, 100]);
  assert.deepEqual(moved("ArrowUp", 90), [-100, 0]);
  assert.deepEqual(moved("ArrowRight", 180), [-100, 0]);
  assert.deepEqual(moved("ArrowUp", 180), [0, 100]);
  assert.deepEqual(moved("ArrowRight", 270), [0, 100]);
  assert.deepEqual(moved("ArrowDown", 270), [-100, 0]);
});

test("方向鍵的旋轉與畫面座標換算一致", () => {
  // 與 app.js／player.js 的 eventToCanvasPoint 相同：螢幕位移換回地圖位移。
  const screenToMap = {
    0: (x, y) => [x, y],
    90: (x, y) => [y, -x],
    180: (x, y) => [-x, -y],
    270: (x, y) => [-y, x]
  };
  const screens = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const token = { x: 550, y: 550, footprint: "small" };
  for (const rotation of [0, 90, 180, 270]) {
    for (const [key, [sx, sy]] of Object.entries(screens)) {
      const next = core.step(SQUARE, token, key, rotation, BOUNDS);
      const [dx, dy] = screenToMap[rotation](sx, sy);
      assert.equal(next.x - token.x, dx * 100 || 0, key + "@" + rotation);
      assert.equal(next.y - token.y, dy * 100 || 0, key + "@" + rotation);
    }
  }
});

test("方向鍵：走出地圖時不移動", () => {
  const bounds = { width: 300, height: 300 };
  const token = { x: 50, y: 50, footprint: "small" };
  assert.equal(core.step(SQUARE, token, "ArrowLeft", 0, bounds), null);
  assert.equal(core.step(SQUARE, token, "ArrowUp", 0, bounds), null);
  assert.deepEqual(core.step(SQUARE, token, "ArrowRight", 0, bounds), { x: 150, y: 50 });
  assert.equal(core.step(SQUARE, token, "Enter", 0, bounds), null);
});

test("六角格方向鍵：上下同一欄，左右走到相鄰欄的最近列", () => {
  const model = createGridModel(HEX);
  for (const footprint of ["small", "large"]) {
    for (const start of [{ col: 10, row: 10 }, { col: 11, row: 10 }]) {
      const token = { ...model.center(start), footprint };
      const cellAfter = (key) => {
        const next = core.step(HEX, token, key, 0, BOUNDS);
        return model.cellAt(next.x, next.y);
      };
      assert.deepEqual(cellAfter("ArrowUp"), { col: start.col, row: start.row - 1 });
      assert.deepEqual(cellAfter("ArrowDown"), { col: start.col, row: start.row + 1 });
      for (const key of ["ArrowLeft", "ArrowRight"]) {
        const cell = cellAfter(key);
        assert.equal(Math.abs(cell.col - start.col), 1, key);
        assert.equal(model.distance(cell, start), 1, key + " 應該走到相鄰的格子");
      }
    }
  }
});

test("六角格方向鍵：連按左右高度維持水平，不會一路往上或往下", () => {
  const model = createGridModel(HEX);
  const start = model.center({ col: 10, row: 10 });
  let token = { ...start, footprint: "small" };
  const heights = [];
  for (let press = 0; press < 8; press += 1) {
    token = { ...token, ...core.step(HEX, token, "ArrowRight", 0, BOUNDS) };
    heights.push(token.y - start.y);
  }
  for (const height of heights) assert.ok(Math.abs(height) <= HEX_HEIGHT / 2 + 1e-6);
  near(heights[1], 0, "走兩步回到同一高度");
  near(token.x - start.x, 8 * 75, "x");
});

test("六角格的中（三格）：沿格子移動後仍在交點上，上下左右都走得回來", () => {
  const model = createGridModel(HEX);
  const here = core.snapPoint(HEX, { x: 2010, y: 1730, footprint: "medium" }, BOUNDS);
  const token = { ...here, footprint: "medium" };
  for (const [go, back] of [["ArrowUp", "ArrowDown"], ["ArrowLeft", "ArrowRight"], ["ArrowRight", "ArrowLeft"]]) {
    const next = { ...token, ...core.step(HEX, token, go, 0, BOUNDS) };
    nearPoint(model.snapToIntersection(next.x, next.y), next);
    assert.ok(Math.hypot(next.x - here.x, next.y - here.y) < HEX_HEIGHT + 1e-6, go + " 應該只走一格");
    if (go === "ArrowUp") nearPoint(core.step(HEX, next, back, 0, BOUNDS), here);
  }
});

function fakeTarget(selector) {
  return { closest: (query) => (selector && query.split(",").includes(selector) ? {} : null) };
}

const noModal = { querySelectorAll: () => [] };

function arrowEvent(overrides = {}) {
  return { key: "ArrowUp", target: fakeTarget(null), defaultPrevented: false, ...overrides };
}

test("鍵盤：只處理沒有組合鍵的方向鍵", () => {
  assert.equal(core.shouldHandleArrowKey(arrowEvent(), noModal), true);
  assert.equal(core.shouldHandleArrowKey(arrowEvent({ key: "a" }), noModal), false);
  for (const modifier of ["ctrlKey", "altKey", "metaKey", "shiftKey", "isComposing"]) {
    assert.equal(core.shouldHandleArrowKey(arrowEvent({ [modifier]: true }), noModal), false, modifier);
  }
  // 先攻清單已經用方向鍵排序時不再移動 token。
  assert.equal(core.shouldHandleArrowKey(arrowEvent({ defaultPrevented: true }), noModal), false);
});

test("鍵盤：焦點在輸入框、下拉選單或對話框裡時不攔截", () => {
  for (const selector of ["textarea", "select", "dialog", "[role=dialog]", "[aria-modal=true]", ".mapfog-initiative-panel"]) {
    assert.equal(core.shouldHandleArrowKey(arrowEvent({ target: fakeTarget(selector) }), noModal), false, selector);
  }
  assert.ok(core.ARROW_BLOCKING_SELECTOR.includes("input:not([type=checkbox])"), "文字框與滑桿不攔截，勾選框可以");
});

test("鍵盤：有開著的對話框時，就算焦點不在裡面也不移動", () => {
  const open = { querySelectorAll: () => [{ closest: () => null }] };
  const hiddenWrapper = { querySelectorAll: () => [{ closest: () => ({}) }] };
  assert.equal(core.shouldHandleArrowKey(arrowEvent(), open), false);
  assert.equal(core.shouldHandleArrowKey(arrowEvent(), hiddenWrapper), true);
});

test("TOKEN_SYNC_KEYS 與玩家可編輯欄位在 GM、玩家與伺服器三處一致", () => {
  const validate = require("../server/validate");
  const read = (file, name) => {
    const text = fs.readFileSync(path.join(__dirname, "..", file), "utf8");
    const match = text.match(new RegExp(`const ${name} = (\\[[^\\]]*\\]);`));
    assert.ok(match, `${file} 找不到 ${name}`);
    return JSON.parse(match[1]);
  };
  assert.deepEqual(read("app.js", "TOKEN_SYNC_KEYS"), validate.TOKEN_SYNC_KEYS);
  assert.deepEqual(read("player.js", "TOKEN_SYNC_KEYS"), validate.TOKEN_SYNC_KEYS);
  assert.deepEqual(read("app.js", "PLAYER_EDITABLE_TOKEN_KEYS"), validate.PLAYER_EDITABLE_TOKEN_KEYS);
  assert.ok(validate.TOKEN_SYNC_KEYS.includes("footprint"));
  assert.ok(validate.PLAYER_EDITABLE_TOKEN_KEYS.includes("footprint"));
});
