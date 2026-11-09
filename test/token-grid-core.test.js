// token 格子化的計算：尺寸、對齊、換尺寸、方向鍵，以及三處 token 欄位清單是否一致。
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../token-grid-core");
const { createGridModel } = require("../measure-core");

const SQUARE = { enabled: true, tokenSnap: true, type: "square", size: 100, offsetX: 0, offsetY: 0 };
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

test("尺寸名稱：不認得的值一律當成中", () => {
  assert.equal(core.normalizeFootprint("small"), "small");
  assert.equal(core.normalizeFootprint("large"), "large");
  assert.equal(core.normalizeFootprint("toString"), "medium");
  assert.equal(core.normalizeFootprint(undefined), "medium");
});

test("方格：小半格、中一格、大 2×2，「一格 10 呎」不影響大小", () => {
  for (const grid of [SQUARE, { ...SQUARE, tenFoot: true }]) {
    assert.equal(core.pixelSize(grid, "small", "square"), 50);
    assert.equal(core.pixelSize(grid, "medium", "square"), 100);
    assert.equal(core.pixelSize(grid, "large", "square"), 200);
  }
});

test("六角格：六角形 token 貼齊左右頂點，方形 token 不超過上下邊", () => {
  assert.equal(core.pixelSize(HEX, "medium", "hex"), 100);
  assert.equal(core.pixelSize(HEX, "large", "hex"), 200);
  near(core.pixelSize(HEX, "medium", "square"), HEX_HEIGHT);
  near(core.pixelSize(HEX, "small", "square"), HEX_HEIGHT / 2);
  near(core.pixelSize(HEX, "large", "square"), HEX_HEIGHT * 2);
});

test("方格：小與中對齊格子中心，大對齊格線交點", () => {
  const grid = { ...SQUARE, offsetX: 10, offsetY: 20 };
  assert.deepEqual(core.snapPoint(grid, { x: 130, y: 140, footprint: "small" }), { x: 160, y: 170 });
  assert.deepEqual(core.snapPoint(grid, { x: 130, y: 140, footprint: "medium" }), { x: 160, y: 170 });
  assert.deepEqual(core.snapPoint(grid, { x: 130, y: 140, footprint: "large" }), { x: 110, y: 120 });
});

test("placement 回傳畫的位置與大小，不改動 token 本身", () => {
  const token = Object.freeze({ x: 130, y: 140, size: 333, shape: "square", footprint: "large" });
  assert.deepEqual(core.placement(SQUARE, token, BOUNDS), { x: 100, y: 100, size: 200 });
  assert.equal(token.size, 333);
});

test("六角格：對齊格子中心；大對齊三格交會的頂點", () => {
  const model = createGridModel(HEX);
  const medium = core.snapPoint(HEX, { x: 310, y: 400, footprint: "medium" });
  nearPoint(medium, model.center(model.cellAt(310, 400)));

  const large = core.snapPoint(HEX, { x: 310, y: 400, footprint: "large" });
  const touching = new Set();
  for (const [dx, dy] of [[12, 0], [-12, 0], [0, 12], [0, -12], [8, 8], [-8, -8], [8, -8], [-8, 8]]) {
    const cell = model.cellAt(large.x + dx, large.y + dy);
    touching.add(`${cell.col},${cell.row}`);
  }
  assert.equal(touching.size, 3, "頂點周圍應該剛好三格");
});

test("對齊是冪等的：已對齊的位置不再移動，四捨五入後也一樣", () => {
  for (const grid of [SQUARE, HEX]) {
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
  assert.deepEqual(core.snapPoint(grid, { x: 5, y: 5, footprint: "medium" }, bounds), { x: 80, y: 80 });
  assert.deepEqual(core.snapPoint(grid, { x: 5, y: 5, footprint: "medium" }), { x: -20, y: -20 });
  // 大的對齊交點：(30, 30) 本來就在地圖內。
  assert.deepEqual(core.snapPoint(grid, { x: 5, y: 5, footprint: "large" }, bounds), { x: 30, y: 30 });
});

test("換尺寸：中→大→中回到同一格，來回不會飄走", () => {
  for (const grid of [SQUARE, HEX]) {
    const model = createGridModel(grid);
    const start = { ...model.center({ col: 7, row: 9 }), shape: "square", footprint: "medium" };
    let current = start;
    for (let round = 0; round < 4; round += 1) {
      const large = { ...current, ...core.retarget(grid, current, "large", BOUNDS), footprint: "large" };
      current = { ...large, ...core.retarget(grid, large, "medium", BOUNDS), footprint: "medium" };
      nearPoint(current, start);
    }
    // 小與中的位置相同。
    nearPoint(core.retarget(grid, start, "small", BOUNDS), start);
  }
});

test("方向鍵：方格移動一格，小、中、大都一樣", () => {
  for (const footprint of ["small", "medium", "large"]) {
    const here = core.snapPoint(SQUARE, { x: 510, y: 520, footprint }, BOUNDS);
    const token = { ...here, footprint };
    assert.deepEqual(core.step(SQUARE, token, "ArrowRight", 0, BOUNDS), { x: here.x + 100, y: here.y });
    assert.deepEqual(core.step(SQUARE, token, "ArrowLeft", 0, BOUNDS), { x: here.x - 100, y: here.y });
    assert.deepEqual(core.step(SQUARE, token, "ArrowUp", 0, BOUNDS), { x: here.x, y: here.y - 100 });
    assert.deepEqual(core.step(SQUARE, token, "ArrowDown", 0, BOUNDS), { x: here.x, y: here.y + 100 });
  }
});

test("方向鍵：跟著畫面旋轉，按的方向就是螢幕上看到的方向", () => {
  const token = { x: 550, y: 550, footprint: "medium" };
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
  const token = { x: 550, y: 550, footprint: "medium" };
  for (const rotation of [0, 90, 180, 270]) {
    for (const [key, [sx, sy]] of Object.entries(screens)) {
      const next = core.step(SQUARE, token, key, rotation, BOUNDS);
      const [dx, dy] = screenToMap[rotation](sx, sy);
      assert.equal(next.x - token.x, dx * 100 || 0, `${key}@${rotation}`);
      assert.equal(next.y - token.y, dy * 100 || 0, `${key}@${rotation}`);
    }
  }
});

test("方向鍵：走出地圖時不移動", () => {
  const bounds = { width: 300, height: 300 };
  const token = { x: 50, y: 50, footprint: "medium" };
  assert.equal(core.step(SQUARE, token, "ArrowLeft", 0, bounds), null);
  assert.equal(core.step(SQUARE, token, "ArrowUp", 0, bounds), null);
  assert.deepEqual(core.step(SQUARE, token, "ArrowRight", 0, bounds), { x: 150, y: 50 });
  assert.equal(core.step(SQUARE, token, "Enter", 0, bounds), null);
});

test("六角格方向鍵：上下同一欄，左右走到相鄰欄的最近列", () => {
  const model = createGridModel(HEX);
  for (const start of [{ col: 10, row: 10 }, { col: 11, row: 10 }]) {
    const token = { ...model.center(start), footprint: "medium" };
    const cellAfter = (key) => {
      const next = core.step(HEX, token, key, 0, BOUNDS);
      return model.cellAt(next.x, next.y);
    };
    assert.deepEqual(cellAfter("ArrowUp"), { col: start.col, row: start.row - 1 });
    assert.deepEqual(cellAfter("ArrowDown"), { col: start.col, row: start.row + 1 });
    for (const key of ["ArrowLeft", "ArrowRight"]) {
      const cell = cellAfter(key);
      assert.equal(Math.abs(cell.col - start.col), 1, key);
      assert.equal(model.distance(cell, start), 1, `${key} 應該走到相鄰的格子`);
    }
  }
});

test("六角格方向鍵：連按左右高度維持水平，不會一路往上或往下", () => {
  const model = createGridModel(HEX);
  const start = model.center({ col: 10, row: 10 });
  let token = { ...start, footprint: "medium" };
  const heights = [];
  for (let press = 0; press < 8; press += 1) {
    token = { ...token, ...core.step(HEX, token, "ArrowRight", 0, BOUNDS) };
    heights.push(token.y - start.y);
  }
  for (const height of heights) assert.ok(Math.abs(height) <= HEX_HEIGHT / 2 + 1e-6);
  near(heights[1], 0, "走兩步回到同一高度");
  near(token.x - start.x, 8 * 75, "x");
});

test("六角格的大：沿格子移動後仍在交點上，上下左右都走得回來", () => {
  const model = createGridModel(HEX);
  const here = core.snapPoint(HEX, { x: 2010, y: 1730, footprint: "large" }, BOUNDS);
  const token = { ...here, footprint: "large" };
  for (const [go, back] of [["ArrowUp", "ArrowDown"], ["ArrowLeft", "ArrowRight"], ["ArrowRight", "ArrowLeft"]]) {
    const next = { ...token, ...core.step(HEX, token, go, 0, BOUNDS) };
    nearPoint(model.snapToIntersection(next.x, next.y), next);
    assert.ok(Math.hypot(next.x - here.x, next.y - here.y) < HEX_HEIGHT + 1e-6, `${go} 應該只走一格`);
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
