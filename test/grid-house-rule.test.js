// 六角格沒有斜走：GM 的格線設定不保留斜走房規，測量面板也不顯示成打勾。
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const test = require("node:test");
const assert = require("node:assert/strict");

// 這兩段程式在瀏覽器頁面的腳本裡，不能直接 require，只取出要測的函式來跑。
function extractFunction(file, name) {
  const lines = fs.readFileSync(path.join(__dirname, "..", file), "utf8").split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().startsWith(`function ${name}(`));
  assert.notEqual(start, -1, `${file} 找不到 ${name}`);
  const closing = `${lines[start].match(/^\s*/)[0]}}`;
  const end = lines.findIndex((line, index) => index > start && line === closing);
  return lines.slice(start, end + 1).join("\n");
}

function loadNormalize() {
  const context = {};
  vm.createContext(context);
  vm.runInContext(["clamp", "createDefaultGridSettings", "normalizeGridSettings"].map((name) => extractFunction("app.js", name)).join("\n"), context);
  return context.normalizeGridSettings;
}

function houseRuleUi(grid, canEdit = true) {
  const context = {
    host: { getGrid: () => grid, ...(canEdit ? { setDiagonalHouseRule() {} } : {}) },
    houseRule: { checked: true, disabled: false },
    houseNote: { textContent: "", hidden: true }
  };
  vm.createContext(context);
  vm.runInContext(`${extractFunction("measure.js", "updateHouseRuleUi")}\nupdateHouseRuleUi();`, context);
  return context;
}

test("切到六角格時關掉斜走房規，切回方格維持未勾選", () => {
  const normalize = loadNormalize();
  const square = normalize({ type: "square", diagonalHouseRule: true });
  assert.equal(square.diagonalHouseRule, true);
  // setGridSettings 的合併方式：舊設定加上這次的變更。
  const hex = normalize({ ...square, type: "hex" });
  assert.equal(hex.diagonalHouseRule, false);
  assert.equal(normalize({ ...hex, type: "square" }).diagonalHouseRule, false);
});

test("六角格的舊資料即使存著房規，也會被清掉", () => {
  assert.equal(loadNormalize()({ type: "hex", diagonalHouseRule: true }).diagonalHouseRule, false);
});

test("測量面板：六角格一律顯示未勾選並保留提示，舊資料也一樣", () => {
  for (const canEdit of [true, false]) {
    const { houseRule, houseNote } = houseRuleUi({ type: "hex", diagonalHouseRule: true }, canEdit);
    assert.equal(houseRule.checked, false);
    assert.equal(houseRule.disabled, true);
    assert.equal(houseNote.textContent, "六角格沒有斜走，這個房規不適用。");
    assert.equal(houseNote.hidden, false);
  }
});

test("測量面板：方格照設定顯示", () => {
  const { houseRule, houseNote } = houseRuleUi({ type: "square", diagonalHouseRule: true });
  assert.equal(houseRule.checked, true);
  assert.equal(houseRule.disabled, false);
  assert.equal(houseNote.hidden, true);
});
