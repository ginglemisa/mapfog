// 測量工具的純計算：格子座標、距離、範圍形狀與「蓋到半格」判定。不碰畫面，瀏覽器與 Node 測試共用。
// 規則依 D&D DMG：範圍的原點放在格線交點（發散除外，見 templateShape）；範圍蓋到一格（方格或六角格）至少一半，那一格就算在範圍內。
(function (root, factory) {
  const core = factory();
  if (typeof module === "object" && module.exports) module.exports = core;
  else root.MapFogMeasureCore = core;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MIN_SIZE = 0.5;
  const MAX_SIZE = 100;
  const SIZE_STEP = 0.5;
  const COVERAGE_THRESHOLD = 0.5;
  // 正好蓋到一半的情況很常見（例如 1.5 格方形），浮點誤差不能讓它被判成沒蓋到。
  const COVERAGE_EPSILON = 1e-6;
  const ANGLE_STEP = 5;
  // 曲線要走進新格子的這個範圍內才算數，斜著滑過格角時不會多算旁邊的格子。
  const PATH_ENTER_RATIO = 0.42;
  const PATH_SAMPLES_PER_CELL = 6;

  function parseSize(value) {
    const number = typeof value === "string" ? Number(value.trim() || NaN) : Number(value);
    if (!Number.isFinite(number) || number < MIN_SIZE || number > MAX_SIZE) return null;
    return Math.abs(number / SIZE_STEP - Math.round(number / SIZE_STEP)) < 1e-9 ? number : null;
  }

  function sameCell(a, b) {
    return a.col === b.col && a.row === b.row;
  }

  function distanceBetween(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function createSquareModel(grid) {
    const size = grid.size;
    const ox = grid.offsetX;
    const oy = grid.offsetY;
    const model = {
      type: "square",
      pitch: size,
      unit: size,
      cellAt: (x, y) => ({ col: Math.floor((x - ox) / size), row: Math.floor((y - oy) / size) }),
      center: (cell) => ({ x: ox + (cell.col + 0.5) * size, y: oy + (cell.row + 0.5) * size }),
      polygon(cell) {
        const left = ox + cell.col * size;
        const top = oy + cell.row * size;
        return [{ x: left, y: top }, { x: left + size, y: top }, { x: left + size, y: top + size }, { x: left, y: top + size }];
      },
      snapToIntersection: (x, y) => ({
        x: ox + Math.round((x - ox) / size) * size,
        y: oy + Math.round((y - oy) / size) * size
      }),
      // 從 a 走到 b 要跨幾步（斜走一步算一步）；實際距離的算法見 lineCost。
      distance: (a, b) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row)),
      forEachCellInBox(box, callback) {
        const endCol = Math.floor((box.maxX - ox) / size);
        const endRow = Math.floor((box.maxY - oy) / size);
        for (let col = Math.floor((box.minX - ox) / size); col <= endCol; col += 1) {
          for (let row = Math.floor((box.minY - oy) / size); row <= endRow; row += 1) callback({ col, row });
        }
      }
    };
    return model;
  }

  // 與 app.js／player.js 的 addHexGridPath 相同的排列：平頂六角形、奇數欄往下半格，grid.size 是左右頂點的距離。
  function createHexModel(grid) {
    const radius = grid.size / 2;
    const hexHeight = Math.sqrt(3) * radius;
    const xStep = radius * 1.5;
    const ox = grid.offsetX;
    const oy = grid.offsetY;
    const toCube = (cell) => {
      const q = cell.col;
      const r = cell.row - (q - (q & 1)) / 2;
      return { q, r, s: -q - r };
    };
    const center = (cell) => ({
      x: ox + cell.col * xStep,
      y: oy + ((cell.col & 1) ? hexHeight / 2 : 0) + cell.row * hexHeight
    });
    const polygon = (cell) => {
      const c = center(cell);
      return [0, 1, 2, 3, 4, 5].map((index) => ({
        x: c.x + radius * Math.cos((Math.PI / 3) * index),
        y: c.y + radius * Math.sin((Math.PI / 3) * index)
      }));
    };
    const cellAt = (x, y) => {
      const px = x - ox;
      const py = y - oy;
      const fq = ((2 / 3) * px) / radius;
      const fr = ((-1 / 3) * px + (Math.sqrt(3) / 3) * py) / radius;
      const fs = -fq - fr;
      let q = Math.round(fq);
      let r = Math.round(fr);
      const s = Math.round(fs);
      const dq = Math.abs(q - fq);
      const dr = Math.abs(r - fr);
      const ds = Math.abs(s - fs);
      if (dq > dr && dq > ds) q = -r - s;
      else if (dr > ds) r = -q - s;
      return { col: q, row: r + (q - (q & 1)) / 2 };
    };
    return {
      type: "hex",
      // 六角格的「一格」是相鄰兩格中心的距離，也就是上下兩邊的距離。
      pitch: hexHeight,
      unit: hexHeight,
      cellAt,
      center,
      polygon,
      snapToIntersection(x, y) {
        let best = null;
        let bestDistance = Infinity;
        for (const corner of polygon(cellAt(x, y))) {
          const distance = Math.hypot(corner.x - x, corner.y - y);
          if (distance < bestDistance) {
            best = corner;
            bestDistance = distance;
          }
        }
        return best;
      },
      distance(a, b) {
        const ca = toCube(a);
        const cb = toCube(b);
        return Math.max(Math.abs(ca.q - cb.q), Math.abs(ca.r - cb.r), Math.abs(ca.s - cb.s));
      },
      forEachCellInBox(box, callback) {
        const endCol = Math.ceil((box.maxX - ox) / xStep) + 1;
        for (let col = Math.floor((box.minX - ox) / xStep) - 1; col <= endCol; col += 1) {
          const shift = (col & 1) ? hexHeight / 2 : 0;
          const endRow = Math.ceil((box.maxY - oy - shift) / hexHeight) + 1;
          for (let row = Math.floor((box.minY - oy - shift) / hexHeight) - 1; row <= endRow; row += 1) callback({ col, row });
        }
      }
    };
  }

  function createGridModel(grid) {
    return grid.type === "hex" ? createHexModel(grid) : createSquareModel(grid);
  }

  // 「一格 10 呎」只對方格有效：六角形無法切成四個小六角形。
  function isTenFoot(grid) {
    return Boolean(grid.tenFoot) && grid.type !== "hex";
  }

  // 計算範圍用的格子。一格 10 呎時，判定與吸附都用四分之一大小的小格（5 呎），但輸入的 N 仍以畫出來的大格為單位。
  function createTemplateModel(grid) {
    const base = isTenFoot(grid)
      ? { ...createSquareModel({ ...grid, size: grid.size / 2 }), unit: grid.size }
      : createGridModel(grid);
    return { ...base, houseDiagonal: usesHouseDiagonal(grid) };
  }

  // 斜走房規（5-10-5）只影響方格；六角格沒有斜走。
  function usesHouseDiagonal(grid) {
    return Boolean(grid.diagonalHouseRule) && grid.type !== "hex";
  }

  // 走 longer 步、其中 shorter 步是斜走的 5-10-5 花費：第一步斜走算 1 格、第二步算 2 格，交替下去。
  function houseDiagonalCost(longer, shorter) {
    return longer + Math.floor(shorter / 2);
  }

  // 直線距離（格）。預設斜走一步算一格；勾選房規時採 5-10-5。
  // 房規加一格 10 呎時，每跨一大格的斜走等於走兩個 5 呎小格（5＋10 呎），固定是 1.5 格。
  function lineCost(a, b, model, grid) {
    if (model.type === "hex") return model.distance(a, b);
    const dx = Math.abs(a.col - b.col);
    const dy = Math.abs(a.row - b.row);
    const longer = Math.max(dx, dy);
    const shorter = Math.min(dx, dy);
    if (!usesHouseDiagonal(grid)) return longer;
    return isTenFoot(grid) ? longer + shorter / 2 : houseDiagonalCost(longer, shorter);
  }

  // 曲線距離（格）：依走過的順序累計，斜走的算法和 lineCost 相同。
  function pathCost(cells, model, grid) {
    if (model.type === "hex" || !usesHouseDiagonal(grid)) return cells.length - 1;
    let cost = 0;
    let diagonals = 0;
    for (let index = 1; index < cells.length; index += 1) {
      const isDiagonal = cells[index].col !== cells[index - 1].col && cells[index].row !== cells[index - 1].row;
      if (!isDiagonal) {
        cost += 1;
        continue;
      }
      diagonals += 1;
      if (isTenFoot(grid)) cost += 1.5;
      else cost += diagonals % 2 === 0 ? 2 : 1;
    }
    return cost;
  }

  // a 之後一路走到 b 的相鄰格子（包含 b、不含 a）；滑鼠一次跳過好幾格時用來補上中間的格子。
  function cellsBetween(a, b, model) {
    const steps = model.distance(a, b);
    const from = model.center(a);
    const to = model.center(b);
    const cells = [];
    for (let step = 1; step <= steps; step += 1) {
      const t = step / steps;
      // 微小偏移讓剛好落在格線上的點有固定的歸屬。
      cells.push(model.cellAt(from.x + (to.x - from.x) * t + 1e-3, from.y + (to.y - from.y) * t + 2e-3));
    }
    if (cells.length) cells[cells.length - 1] = b;
    return cells;
  }

  function extendPathAtPoint(path, point, model) {
    const cell = model.cellAt(point.x, point.y);
    const last = path[path.length - 1];
    if (sameCell(cell, last)) return false;
    if (distanceBetween(point, model.center(cell)) > model.pitch * PATH_ENTER_RATIO) return false;
    // 走回上一格視為退回，方便修正路線。
    if (path.length >= 2 && sameCell(cell, path[path.length - 2])) {
      path.pop();
      return true;
    }
    path.push(...cellsBetween(last, cell, model));
    return true;
  }

  // 把滑鼠從 from 移到 to 經過的格子記進 path；path 是格子陣列，至少有起點一格，步數就是 path.length - 1。
  function extendPath(path, from, to, model) {
    const samples = Math.max(1, Math.ceil(distanceBetween(from, to) / (model.pitch / PATH_SAMPLES_PER_CELL)));
    let changed = false;
    for (let index = 1; index <= samples; index += 1) {
      const t = index / samples;
      if (extendPathAtPoint(path, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, model)) changed = true;
    }
    return changed;
  }

  function polygonBox(points) {
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  }

  function signedArea(points) {
    let total = 0;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      total += a.x * b.y - b.x * a.y;
    }
    return total / 2;
  }

  // 把凸多邊形往外推 distance：每條邊平移，轉角用圓弧連接。點的順序要和 model.polygon 相同（面積為正）。
  function bufferConvexPolygon(points, distance, stepsPerQuarter) {
    const edgeNormalAngle = (a, b) => Math.atan2(-(b.x - a.x), b.y - a.y);
    const output = [];
    points.forEach((vertex, index) => {
      const previous = points[(index + points.length - 1) % points.length];
      const next = points[(index + 1) % points.length];
      const from = edgeNormalAngle(previous, vertex);
      const turn = (((edgeNormalAngle(vertex, next) - from) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
      const steps = Math.max(1, Math.ceil((turn / (Math.PI / 2)) * stepsPerQuarter));
      for (let step = 0; step <= steps; step += 1) {
        const angle = from + (turn * step) / steps;
        output.push({ x: vertex.x + distance * Math.cos(angle), y: vertex.y + distance * Math.sin(angle) });
      }
    });
    return output;
  }

  // 發散的原點是生物所在的格子，放在格子中心；其他範圍的原點都在格線交點。
  function snapOrigin(shapeName, x, y, model) {
    return shapeName === "emanation" ? model.center(model.cellAt(x, y)) : model.snapToIntersection(x, y);
  }

  // 範圍形狀。錐形在距離原點 d 處寬度為 d；球形以 N 格為半徑；方形邊長 N 格，原點在一角。
  // 發散的原點是生物（2024 規則），預設不含原點，只處理佔一格的生物。量法規則沒有明文，這裡提供兩種：
  // 預設是從所在格子的邊緣量真實距離；勾選斜走房規時，改用 5-10-5 計算走幾格能到。
  function emanationShape(template, origin, reach, model) {
    const cell = model.cellAt(origin.x, origin.y);
    const shared = { origin, center: origin, rotateHandle: null, excludedCell: cell };
    if (model.houseDiagonal) {
      const steps = reach / model.pitch;
      const inReach = (other) => {
        const dx = Math.abs(other.col - cell.col);
        const dy = Math.abs(other.row - cell.row);
        return houseDiagonalCost(Math.max(dx, dy), Math.min(dx, dy)) <= steps + COVERAGE_EPSILON;
      };
      const extent = (steps + 0.5) * model.pitch;
      return {
        ...shared,
        type: "cells",
        includesCell: inReach,
        containsPoint: (point) => inReach(model.cellAt(point.x, point.y)),
        box: { minX: origin.x - extent, minY: origin.y - extent, maxX: origin.x + extent, maxY: origin.y + extent }
      };
    }
    const polygon = bufferConvexPolygon(model.polygon(cell), reach, Math.ceil(8 + (2 * reach) / model.unit));
    return { ...shared, type: "polygon", polygon, box: polygonBox(polygon) };
  }

  function templateShape(template, model) {
    const origin = snapOrigin(template.shape, template.x, template.y, model);
    const length = template.size * model.unit;
    if (template.shape === "emanation") return emanationShape(template, origin, length, model);
    if (template.shape === "circle") {
      return {
        type: "circle",
        origin,
        radius: length,
        center: origin,
        rotateHandle: null,
        excludedCell: null,
        box: { minX: origin.x - length, minY: origin.y - length, maxX: origin.x + length, maxY: origin.y + length }
      };
    }
    const radians = (template.angle * Math.PI) / 180;
    const u = { x: Math.cos(radians), y: Math.sin(radians) };
    const v = { x: -u.y, y: u.x };
    const at = (along, across) => ({ x: origin.x + u.x * along + v.x * across, y: origin.y + u.y * along + v.y * across });
    if (template.shape === "cone") {
      const polygon = [origin, at(length, -length / 2), at(length, length / 2)];
      return { type: "polygon", origin, polygon, center: at(length * 0.66, 0), rotateHandle: at(length, 0), handleOffset: 0, box: polygonBox(polygon) };
    }
    const polygon = [origin, at(length, 0), at(length, length), at(0, length)];
    return { type: "polygon", origin, polygon, center: at(length / 2, length / 2), rotateHandle: at(length, length), handleOffset: 45, box: polygonBox(polygon) };
  }

  // 依把手位置算出範圍角度，每 5 度一格，同時涵蓋 0／45／90 度這些常用方向。
  function angleFromHandle(shape, point) {
    const degrees = (Math.atan2(point.y - shape.origin.y, point.x - shape.origin.x) * 180) / Math.PI - (shape.handleOffset || 0);
    const snapped = Math.round(degrees / ANGLE_STEP) * ANGLE_STEP;
    return ((snapped % 360) + 360) % 360;
  }

  // Sutherland–Hodgman：把 subject 裁切到凸多邊形 clip 之內，回傳重疊的多邊形。
  function clipPolygon(subject, clip) {
    const orientation = signedArea(clip) >= 0 ? 1 : -1;
    let output = subject;
    for (let index = 0; index < clip.length && output.length; index += 1) {
      const a = clip[index];
      const b = clip[(index + 1) % clip.length];
      const side = (p) => orientation * ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x));
      const input = output;
      output = [];
      for (let i = 0; i < input.length; i += 1) {
        const current = input[i];
        const next = input[(i + 1) % input.length];
        const currentSide = side(current);
        const nextSide = side(next);
        if (currentSide >= 0) output.push(current);
        if ((currentSide > 0 && nextSide < 0) || (currentSide < 0 && nextSide > 0)) {
          const t = currentSide / (currentSide - nextSide);
          output.push({ x: current.x + (next.x - current.x) * t, y: current.y + (next.y - current.y) * t });
        }
      }
    }
    return output;
  }

  // 圓與多邊形重疊的精確面積：把每條邊與圓心組成的三角形，分成圓內的三角形與圓外的扇形加總。
  function circlePolygonArea(center, radius, polygon) {
    const local = polygon.map((point) => ({ x: point.x - center.x, y: point.y - center.y }));
    const cross = (u, w) => u.x * w.y - u.y * w.x;
    const dot = (u, w) => u.x * w.x + u.y * w.y;
    const sector = (u, w) => (radius * radius * Math.atan2(cross(u, w), dot(u, w))) / 2;
    let total = 0;
    for (let index = 0; index < local.length; index += 1) {
      const a = local[index];
      const b = local[(index + 1) % local.length];
      const d = { x: b.x - a.x, y: b.y - a.y };
      const qa = dot(d, d);
      const qb = 2 * dot(a, d);
      const qc = dot(a, a) - radius * radius;
      const discriminant = qb * qb - 4 * qa * qc;
      if (discriminant <= 0) {
        total += sector(a, b);
        continue;
      }
      const root = Math.sqrt(discriminant);
      const t1 = (-qb - root) / (2 * qa);
      const t2 = (-qb + root) / (2 * qa);
      if (t2 <= 0 || t1 >= 1) {
        total += sector(a, b);
        continue;
      }
      const pointAt = (t) => ({ x: a.x + d.x * t, y: a.y + d.y * t });
      const enter = pointAt(Math.max(t1, 0));
      const leave = pointAt(Math.min(t2, 1));
      if (t1 > 0) total += sector(a, enter);
      total += cross(enter, leave) / 2;
      if (t2 < 1) total += sector(leave, b);
    }
    return Math.abs(total);
  }

  function cellCoverage(shape, cellPolygon) {
    const cellArea = Math.abs(signedArea(cellPolygon));
    if (shape.type === "circle") return circlePolygonArea(shape.center, shape.radius, cellPolygon) / cellArea;
    const overlap = clipPolygon(cellPolygon, shape.polygon);
    return overlap.length < 3 ? 0 : Math.abs(signedArea(overlap)) / cellArea;
  }

  // 列出範圍內的格子；bounds（地圖尺寸）之外的格子不計算。
  function coveredCells(template, model, bounds) {
    const shape = templateShape(template, model);
    const box = {
      minX: Math.max(shape.box.minX, 0),
      minY: Math.max(shape.box.minY, 0),
      maxX: Math.min(shape.box.maxX, bounds.width),
      maxY: Math.min(shape.box.maxY, bounds.height)
    };
    const cells = [];
    if (box.minX > box.maxX || box.minY > box.maxY) return cells;
    model.forEachCellInBox(box, (cell) => {
      if (shape.excludedCell && sameCell(cell, shape.excludedCell)) return;
      const polygon = model.polygon(cell);
      const covered = shape.type === "cells"
        ? shape.includesCell(cell)
        : cellCoverage(shape, polygon) >= COVERAGE_THRESHOLD - COVERAGE_EPSILON;
      if (covered) cells.push({ ...cell, polygon });
    });
    return cells;
  }

  // 一群格子的外框線段：只屬於一個格子的邊就是外框。
  function cellsBoundary(polygons) {
    const edges = new Map();
    const keyOf = (point) => `${Math.round(point.x * 100)},${Math.round(point.y * 100)}`;
    for (const polygon of polygons) {
      polygon.forEach((a, index) => {
        const b = polygon[(index + 1) % polygon.length];
        const [first, second] = [keyOf(a), keyOf(b)].sort();
        const key = `${first}|${second}`;
        edges.set(key, edges.has(key) ? null : [a, b]);
      });
    }
    return [...edges.values()].filter(Boolean);
  }

  function pointInShape(shape, point) {
    if (shape.type === "cells") return shape.containsPoint(point);
    if (shape.type === "circle") return distanceBetween(shape.center, point) <= shape.radius;
    const orientation = signedArea(shape.polygon) >= 0 ? 1 : -1;
    return shape.polygon.every((a, index) => {
      const b = shape.polygon[(index + 1) % shape.polygon.length];
      return orientation * ((b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x)) >= 0;
    });
  }

  return {
    MIN_SIZE,
    MAX_SIZE,
    SIZE_STEP,
    parseSize,
    sameCell,
    createGridModel,
    createTemplateModel,
    lineCost,
    pathCost,
    cellsBetween,
    extendPath,
    snapOrigin,
    templateShape,
    angleFromHandle,
    cellCoverage,
    coveredCells,
    cellsBoundary,
    pointInShape
  };
});
