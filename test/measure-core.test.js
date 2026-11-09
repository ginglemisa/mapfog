// 測量工具的幾何計算：距離、曲線格數，以及範圍「蓋到至少半格」的判定。
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../measure-core");

const SQUARE = { type: "square", size: 100, offsetX: 0, offsetY: 0 };
const HEX = { type: "hex", size: 100, offsetX: 0, offsetY: 0 };
const BOUNDS = { width: 100000, height: 100000 };
// 放在畫面中間，錐形與圓形才不會被地圖邊界截掉。
const ORIGIN = 5000;

function cellsOf(template, grid = SQUARE) {
  const model = core.createGridModel(grid);
  return core.coveredCells({ angle: 0, x: ORIGIN, y: ORIGIN, ...template }, model, BOUNDS)
    .map((cell) => `${cell.col - ORIGIN / 100},${cell.row - ORIGIN / 100}`)
    .sort();
}

test("數字只接受 0.5 為單位", () => {
  assert.equal(core.parseSize("0.5"), 0.5);
  assert.equal(core.parseSize("1.5"), 1.5);
  assert.equal(core.parseSize(3), 3);
  assert.equal(core.parseSize("0.3"), null);
  assert.equal(core.parseSize("0"), null);
  assert.equal(core.parseSize(""), null);
  assert.equal(core.parseSize("abc"), null);
  assert.equal(core.parseSize("101"), null);
});

const TEN_FOOT = { ...SQUARE, tenFoot: true };
const HOUSE = { ...SQUARE, diagonalHouseRule: true };
const HOUSE_TEN_FOOT = { ...TEN_FOOT, diagonalHouseRule: true };

function line(dx, dy, grid = SQUARE) {
  return core.lineCost({ col: 0, row: 0 }, { col: dx, row: dy }, core.createGridModel(grid), grid);
}

test("直線預設：斜走一步算一格，一格 10 呎也一樣", () => {
  assert.equal(line(5, 0), 5);
  assert.equal(line(3, 3), 3);
  assert.equal(line(3, 4), 4);
  assert.equal(line(2, 2, TEN_FOOT), 2);
});

test("直線 5-10-5 房規：斜走第一步 1 格、第二步 2 格，交替下去", () => {
  assert.equal(line(5, 0, HOUSE), 5);
  assert.equal(line(1, 1, HOUSE), 1);
  assert.equal(line(2, 2, HOUSE), 3);
  assert.equal(line(3, 3, HOUSE), 4);
  assert.equal(line(6, 6, HOUSE), 9);
  assert.equal(line(3, 4, HOUSE), 5);
  assert.equal(line(-3, 4, HOUSE), 5);
});

test("直線房規：一格 10 呎時每跨一大格斜走固定 1.5 格", () => {
  assert.equal(line(3, 0, HOUSE_TEN_FOOT), 3);
  assert.equal(line(1, 1, HOUSE_TEN_FOOT), 1.5);
  assert.equal(line(2, 2, HOUSE_TEN_FOOT), 3);
  assert.equal(line(2, 1, HOUSE_TEN_FOOT), 2.5);
});

test("曲線預設每步一格；房規依走過的順序累計", () => {
  const model = core.createGridModel(SQUARE);
  const cells = (...pairs) => pairs.map(([col, row]) => ({ col, row }));
  assert.equal(core.pathCost(cells([0, 0], [1, 1], [2, 2], [3, 3]), model, SQUARE), 3);
  assert.equal(core.pathCost(cells([0, 0], [1, 1], [2, 2], [3, 3]), model, HOUSE), 4);
  // 中間夾一段直走，第二次斜走仍算 2 格。
  assert.equal(core.pathCost(cells([0, 0], [1, 1], [2, 1], [3, 2]), model, HOUSE), 4);
  assert.equal(core.pathCost(cells([0, 0], [1, 1], [2, 2]), model, HOUSE_TEN_FOOT), 3);
});

function emanationCount(size, grid) {
  const model = core.createTemplateModel(grid);
  const origin = core.snapOrigin("emanation", ORIGIN + 10, ORIGIN + 10, model);
  return core.coveredCells({ shape: "emanation", size, angle: 0, x: origin.x, y: origin.y }, model, BOUNDS).length;
}

test("發散預設：嚴格邊緣距離，15 呎是 44 格", () => {
  assert.deepEqual([1, 2, 3, 4, 6].map((size) => emanationCount(size, SQUARE)), [8, 20, 44, 68, 136]);
});

test("發散勾選房規：用 5-10-5 計格，15 呎是 36 格、20 呎是 60 格", () => {
  assert.deepEqual([1, 2, 3, 4].map((size) => emanationCount(size, HOUSE)), [8, 20, 36, 60]);
});

test("發散房規加一格 10 呎：用 5 呎小格計算，15 呎等於一般地圖的 15 呎", () => {
  assert.equal(emanationCount(1.5, HOUSE_TEN_FOOT), 36);
});

test("六角格的發散不受斜走房規影響", () => {
  assert.equal(emanationCount(3, { ...HEX, diagonalHouseRule: true }), emanationCount(3, HEX));
});

test("房規發散的外框：沿著填色格子的外緣，內部不畫線", () => {
  const model = core.createTemplateModel(HOUSE);
  const template = { shape: "emanation", size: 1, angle: 0, x: 550, y: 550 };
  const shape = core.templateShape(template, model);
  const cells = core.coveredCells(template, model, BOUNDS).map((cell) => cell.polygon);
  // 8 格加上中間自己的格子是 3×3，外框 12 段。
  assert.equal(core.cellsBoundary([...cells, model.polygon(shape.excludedCell)]).length, 12);
});

test("房規發散的點擊判定跟著填色範圍", () => {
  const model = core.createTemplateModel(HOUSE);
  const shape = core.templateShape({ shape: "emanation", size: 2, angle: 0, x: 550, y: 550 }, model);
  assert.equal(core.pointInShape(shape, { x: 550, y: 550 }), true);
  assert.equal(core.pointInShape(shape, { x: 750, y: 650 }), true);
  assert.equal(core.pointInShape(shape, { x: 750, y: 750 }), false);
});

test("六角格沒有斜走，距離不受 5-10-5 與一格 10 呎影響", () => {
  const grid = { ...HEX, tenFoot: true };
  const model = core.createGridModel(grid);
  assert.equal(core.lineCost({ col: 0, row: 0 }, { col: 0, row: 3 }, model, grid), 3);
  assert.equal(core.pathCost([{ col: 0, row: 0 }, { col: 0, row: 1 }], model, grid), 1);
});

test("一格 10 呎：範圍以 5 呎小格判定，N 仍以大格計", () => {
  const model = core.createTemplateModel(TEN_FOOT);
  const count = (template) => core.coveredCells({ angle: 0, x: ORIGIN, y: ORIGIN, ...template }, model, BOUNDS).length;
  assert.equal(count({ shape: "square", size: 0.5 }), 1);
  assert.equal(count({ shape: "square", size: 1 }), 4);
  assert.equal(count({ shape: "square", size: 1.5 }), 9);
  // 每個小格是大格的四分之一。
  const [cell] = core.coveredCells({ shape: "square", size: 0.5, angle: 0, x: ORIGIN, y: ORIGIN }, model, BOUNDS);
  assert.equal(Math.abs(cell.polygon[1].x - cell.polygon[0].x), 50);
});

test("一格 10 呎：原點可以吸附到大格中間的 5 呎交點", () => {
  const model = core.createTemplateModel(TEN_FOOT);
  assert.deepEqual(core.snapOrigin("cone", 548, 512, model), { x: 550, y: 500 });
  assert.deepEqual(core.snapOrigin("emanation", 548, 512, model), { x: 525, y: 525 });
});

test("一格 10 呎的 10 呎發散，涵蓋的小格數和一般地圖的 10 呎發散相同", () => {
  const model = core.createTemplateModel(TEN_FOOT);
  const origin = core.snapOrigin("emanation", ORIGIN + 10, ORIGIN + 10, model);
  assert.equal(core.coveredCells({ shape: "emanation", size: 1, angle: 0, x: origin.x, y: origin.y }, model, BOUNDS).length, 20);
});

test("六角格勾了一格 10 呎也不細分", () => {
  const grid = { ...HEX, tenFoot: true };
  assert.equal(core.createTemplateModel(grid).pitch, core.createGridModel(HEX).pitch);
});

test("沒勾一格 10 呎時，範圍用的格子就是畫出來的格子", () => {
  assert.equal(core.createTemplateModel(SQUARE).pitch, 100);
  assert.equal(core.createTemplateModel(SQUARE).unit, 100);
});

test("方格走法步數：斜走算一步", () => {
  const model = core.createGridModel(SQUARE);
  assert.equal(model.distance({ col: 0, row: 0 }, { col: 3, row: 4 }), 4);
  assert.equal(model.distance({ col: 0, row: 0 }, { col: 5, row: 0 }), 5);
});

test("六角格距離沿用奇數欄下移的排列", () => {
  const model = core.createGridModel(HEX);
  assert.equal(model.distance({ col: 0, row: 0 }, { col: 0, row: 3 }), 3);
  assert.equal(model.distance({ col: 0, row: 0 }, { col: 1, row: 0 }), 1);
  assert.equal(model.distance({ col: 0, row: 0 }, { col: 1, row: -1 }), 1);
  assert.equal(model.distance({ col: 0, row: 0 }, { col: 1, row: 1 }), 2);
  assert.equal(model.distance({ col: 0, row: 0 }, { col: 4, row: 0 }), 4);
});

test("點到格子再換回中心點是同一格（含負座標與奇數欄）", () => {
  for (const grid of [SQUARE, HEX, { ...HEX, offsetX: 37, offsetY: -12 }]) {
    const model = core.createGridModel(grid);
    for (const cell of [{ col: 0, row: 0 }, { col: 3, row: 2 }, { col: -3, row: -2 }, { col: -1, row: 5 }]) {
      const center = model.center(cell);
      assert.deepEqual(model.cellAt(center.x, center.y), cell);
    }
  }
});

test("六角形原點吸附到頂點", () => {
  const model = core.createGridModel(HEX);
  // 第 0 欄第 0 列的右頂點在 (50, 0)。
  const snapped = model.snapToIntersection(53, 4);
  assert.ok(Math.abs(snapped.x - 50) < 1e-9 && Math.abs(snapped.y) < 1e-9);
});

test("曲線：滑過幾格算幾格，斜滑過格角不多算", () => {
  const model = core.createGridModel(SQUARE);
  const center = (col, row) => model.center({ col, row });
  const straight = [{ col: 0, row: 0 }];
  core.extendPath(straight, center(0, 0), center(4, 0), model);
  assert.equal(straight.length - 1, 4);

  const diagonal = [{ col: 0, row: 0 }];
  core.extendPath(diagonal, center(0, 0), center(3, 3), model);
  assert.equal(diagonal.length - 1, 3);

  const bent = [{ col: 0, row: 0 }];
  core.extendPath(bent, center(0, 0), center(2, 0), model);
  core.extendPath(bent, center(2, 0), center(2, 3), model);
  assert.equal(bent.length - 1, 5);
});

test("曲線：往回拖會退一格", () => {
  const model = core.createGridModel(SQUARE);
  const path = [{ col: 0, row: 0 }];
  core.extendPath(path, model.center({ col: 0, row: 0 }), model.center({ col: 3, row: 0 }), model);
  core.extendPath(path, model.center({ col: 3, row: 0 }), model.center({ col: 2, row: 0 }), model);
  assert.equal(path.length - 1, 2);
});

test("曲線：六角格一次跳很遠也會補上中間的格子", () => {
  const model = core.createGridModel(HEX);
  const path = [{ col: 0, row: 0 }];
  core.extendPath(path, model.center({ col: 0, row: 0 }), model.center({ col: 0, row: 5 }), model);
  assert.equal(path.length - 1, 5);
});

test("方形：整數邊長完整蓋住 N×N 格", () => {
  assert.deepEqual(cellsOf({ shape: "square", size: 2 }), ["0,0", "0,1", "1,0", "1,1"]);
});

test("方形 1.5 格：剛好蓋到一半的格子算在內，只蓋到四分之一的不算", () => {
  assert.deepEqual(cellsOf({ shape: "square", size: 1.5 }), ["0,0", "0,1", "1,0"]);
});

test("方形 0.5 格：只蓋到四分之一格，沒有格子算在內", () => {
  assert.deepEqual(cellsOf({ shape: "square", size: 0.5 }), []);
});

test("圓形：半徑 1 格從交點涵蓋周圍四格", () => {
  assert.deepEqual(cellsOf({ shape: "circle", size: 1 }), ["-1,-1", "-1,0", "0,-1", "0,0"]);
});

test("圓形半徑 2 格：每象限三格，對角那格只蓋到約三成不算", () => {
  const cells = cellsOf({ shape: "circle", size: 2 });
  assert.equal(cells.length, 12);
  assert.ok(cells.includes("1,0"));
  assert.ok(!cells.includes("1,1"));
});

// 發散以格子為單位，測試資料放在格子中心。
function emanationCells(size, grid = SQUARE) {
  const model = core.createGridModel(grid);
  const origin = model.center(model.cellAt(ORIGIN + 10, ORIGIN + 10));
  return core.coveredCells({ shape: "emanation", size, angle: 0, x: origin.x, y: origin.y }, model, BOUNDS);
}

test("發散：原點吸附到格子中心，不是交點", () => {
  const model = core.createGridModel(SQUARE);
  assert.deepEqual(core.snapOrigin("emanation", 523, 590, model), { x: 550, y: 550 });
  assert.deepEqual(core.snapOrigin("circle", 523, 590, model), { x: 500, y: 600 });
});

test("發散 1 格：周圍八格，所在的格子不算", () => {
  const cells = emanationCells(1).map((cell) => `${cell.col - 50},${cell.row - 50}`).sort();
  assert.deepEqual(cells, ["-1,-1", "-1,0", "-1,1", "0,-1", "0,1", "1,-1", "1,0", "1,1"]);
});

test("發散 2 格（10 呎，一格 5 呎）：從格子邊緣往外算到第二圈，只少四個角", () => {
  const cells = emanationCells(2).map((cell) => `${cell.col - 50},${cell.row - 50}`);
  assert.equal(cells.length, 20);
  assert.ok(cells.includes("2,0"));
  assert.ok(cells.includes("2,1"));
  assert.ok(!cells.includes("2,2"));
  assert.ok(!cells.includes("0,0"));
});

test("發散 1 格在六角格：周圍六格", () => {
  assert.equal(emanationCells(1, HEX).length, 6);
});

test("發散沒有旋轉把手", () => {
  const model = core.createGridModel(SQUARE);
  assert.equal(core.templateShape({ shape: "emanation", size: 2, angle: 0, x: 550, y: 550 }, model).rotateHandle, null);
});

test("錐形 3 格朝右：只有蓋到至少半格的格子算在內", () => {
  assert.deepEqual(cellsOf({ shape: "cone", size: 3 }), ["1,-1", "1,0", "2,-1", "2,0"]);
});

test("旋轉 90 度的錐形等於把朝右的結果轉 90 度", () => {
  assert.deepEqual(cellsOf({ shape: "cone", size: 3, angle: 90 }), ["-1,1", "-1,2", "0,1", "0,2"]);
});

test("旋轉 45 度的方形會改變涵蓋的格子", () => {
  assert.notDeepEqual(cellsOf({ shape: "square", size: 2, angle: 45 }), cellsOf({ shape: "square", size: 2 }));
});

test("原點不在交點時會吸附到最近的交點", () => {
  assert.deepEqual(cellsOf({ shape: "square", size: 2, x: ORIGIN + 20, y: ORIGIN - 30 }), ["0,0", "0,1", "1,0", "1,1"]);
});

test("六角格：圓形半徑 1 格的面積判定使用六角格的格距", () => {
  const model = core.createGridModel(HEX);
  const origin = model.snapToIntersection(ORIGIN, ORIGIN);
  const cells = core.coveredCells({ shape: "circle", size: 1, angle: 0, x: origin.x, y: origin.y }, model, BOUNDS);
  // 頂點相接的三格蓋到超過一半，外圈的格子都不到一半。
  assert.equal(cells.length, 3);
  for (const cell of cells) {
    assert.ok(core.cellCoverage(core.templateShape({ shape: "circle", size: 1, angle: 0, x: origin.x, y: origin.y }, model), cell.polygon) >= 0.5);
  }
});

test("圓的面積計算：格子完全在圓內時是 100%，完全在圓外時是 0", () => {
  const model = core.createGridModel(SQUARE);
  const shape = core.templateShape({ shape: "circle", size: 3, angle: 0, x: 500, y: 500 }, model);
  assert.ok(Math.abs(core.cellCoverage(shape, model.polygon({ col: 5, row: 5 })) - 1) < 1e-9);
  assert.equal(core.cellCoverage(shape, model.polygon({ col: 20, row: 20 })), 0);
});

test("地圖範圍之外的格子不計算", () => {
  const model = core.createGridModel(SQUARE);
  const cells = core.coveredCells({ shape: "circle", size: 2, angle: 0, x: 0, y: 0 }, model, { width: 1000, height: 1000 });
  assert.ok(cells.every((cell) => cell.col >= 0 && cell.row >= 0));
  assert.ok(cells.length > 0);
});

test("旋轉把手：角度每 5 度一格，方形把手在對角所以差 45 度", () => {
  const model = core.createGridModel(SQUARE);
  const cone = core.templateShape({ shape: "cone", size: 3, angle: 0, x: 500, y: 500 }, model);
  assert.equal(core.angleFromHandle(cone, { x: 500, y: 800 }), 90);
  assert.equal(core.angleFromHandle(cone, { x: 800, y: 511 }), 0);
  const square = core.templateShape({ shape: "square", size: 3, angle: 0, x: 500, y: 500 }, model);
  assert.equal(core.angleFromHandle(square, square.rotateHandle), 0);
  assert.equal(core.angleFromHandle(square, { x: 500, y: 800 }), 45);
});

test("點擊判定：點在形狀內外", () => {
  const model = core.createGridModel(SQUARE);
  const cone = core.templateShape({ shape: "cone", size: 3, angle: 0, x: 500, y: 500 }, model);
  assert.equal(core.pointInShape(cone, { x: 700, y: 500 }), true);
  assert.equal(core.pointInShape(cone, { x: 550, y: 700 }), false);
  const circle = core.templateShape({ shape: "circle", size: 1, angle: 0, x: 500, y: 500 }, model);
  assert.equal(core.pointInShape(circle, { x: 550, y: 550 }), true);
  assert.equal(core.pointInShape(circle, { x: 620, y: 500 }), false);
});
