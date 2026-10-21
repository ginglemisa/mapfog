// LAN 伺服器收到的資料一律重新整理成固定格式：型別不對、超出範圍或多出來的欄位都不會寫進房間。
"use strict";

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const HASH_PATTERN = /^[0-9a-z]{22}$/;
const ID_PATTERN = /^[A-Za-z0-9_.:-]{1,100}$/;
const EPOCH_PATTERN = /^[A-Za-z0-9_-]{1,40}$/;
const IMAGE_DATA_URL_PATTERN = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;
const IMAGE_KINDS = new Set(["map", "token", "fog"]);
const FOG_BASES = new Set(["covered", "revealed", "checkpoint"]);
const COORD_LIMIT = 100000;
const MAP_SIDE_LIMIT = 20000;
const MAX_STROKES_PER_BATCH = 5000;
const MAX_INITIATIVE_ENTRIES = 300;

// 圖片雜湊以外可以修改的 token 欄位，跟 app.js／player.js 的 TOKEN_SYNC_KEYS 一致。
const TOKEN_SYNC_KEYS = ["name", "initiativeLabel", "initiativeEntryId", "hpFontSize", "x", "y", "size", "shape", "visible", "order", "locked"];
// 玩家只能改未鎖定 token 的位置、大小與形狀。
const PLAYER_EDITABLE_TOKEN_KEYS = ["x", "y", "size", "shape"];

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function cleanText(value, maxLength) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function isValidRoomId(value) {
  return typeof value === "string" && ROOM_ID_PATTERN.test(value);
}

function isValidHash(value) {
  return typeof value === "string" && HASH_PATTERN.test(value);
}

function isValidId(value) {
  return typeof value === "string" && ID_PATTERN.test(value);
}

function isValidImageDataUrl(value, maxLength) {
  return typeof value === "string" && value.length <= maxLength && IMAGE_DATA_URL_PATTERN.test(value);
}

function sanitizeImageKind(kind) {
  return IMAGE_KINDS.has(kind) ? kind : null;
}

function sanitizeMapState(map) {
  if (!isPlainObject(map) || !isValidHash(map.hash)) return null;
  const width = Math.trunc(finite(map.width) ?? 0);
  const height = Math.trunc(finite(map.height) ?? 0);
  if (width < 1 || height < 1 || width > MAP_SIDE_LIMIT || height > MAP_SIDE_LIMIT) return null;
  return { hash: map.hash, width, height };
}

function sanitizeFogState(fog) {
  if (!isPlainObject(fog) || typeof fog.epoch !== "string" || !EPOCH_PATTERN.test(fog.epoch)) return null;
  const base = FOG_BASES.has(fog.base) ? fog.base : "covered";
  const checkpointHash = base === "checkpoint" && isValidHash(fog.checkpointHash) ? fog.checkpointHash : "";
  if (base === "checkpoint" && !checkpointHash) return null;
  const width = Math.trunc(finite(fog.width) ?? 0);
  const height = Math.trunc(finite(fog.height) ?? 0);
  return {
    epoch: fog.epoch,
    seq: Math.max(0, Math.trunc(finite(fog.seq) ?? 0)),
    base,
    checkpointHash,
    mapHash: isValidHash(fog.mapHash) ? fog.mapHash : "",
    width: clamp(width, 0, MAP_SIDE_LIMIT),
    height: clamp(height, 0, MAP_SIDE_LIMIT)
  };
}

function sanitizeStroke(stroke) {
  if (!isPlainObject(stroke)) return null;
  const mode = stroke.mode === "fill" ? "fill" : "erase";
  const x = finite(stroke.x);
  const y = finite(stroke.y);
  if (x === null || y === null) return null;
  if (stroke.type === "rect") {
    const width = finite(stroke.width);
    const height = finite(stroke.height);
    if (width === null || height === null) return null;
    return {
      type: "rect",
      x: clamp(x, -COORD_LIMIT, COORD_LIMIT),
      y: clamp(y, -COORD_LIMIT, COORD_LIMIT),
      width: clamp(width, 0, COORD_LIMIT),
      height: clamp(height, 0, COORD_LIMIT),
      mode
    };
  }
  return {
    x: clamp(x, -COORD_LIMIT, COORD_LIMIT),
    y: clamp(y, -COORD_LIMIT, COORD_LIMIT),
    mode,
    brushSize: clamp(finite(stroke.brushSize) ?? 100, 1, 2000),
    softBrush: stroke.softBrush !== false
  };
}

function sanitizeStrokes(strokes) {
  if (!Array.isArray(strokes) || strokes.length > MAX_STROKES_PER_BATCH) return null;
  const cleaned = [];
  for (const stroke of strokes) {
    const next = sanitizeStroke(stroke);
    if (next) cleaned.push(next);
  }
  return cleaned;
}

function sanitizeGridSettings(settings) {
  if (!isPlainObject(settings)) return null;
  return {
    enabled: Boolean(settings.enabled),
    type: settings.type === "hex" ? "hex" : "square",
    color: settings.color === "black" ? "black" : "white",
    opacity: clamp(finite(settings.opacity) ?? 0.45, 0, 1),
    size: clamp(finite(settings.size) ?? 80, 24, 240),
    lineWidth: clamp(finite(settings.lineWidth) ?? 1, 1, 20),
    offsetX: clamp(finite(settings.offsetX) ?? 0, -240, 240),
    offsetY: clamp(finite(settings.offsetY) ?? 0, -240, 240)
  };
}

// 玩家看得到的先攻只有名稱與敵友；就算 GM 端送來 HP 或先攻值也不會存下或轉送。
function sanitizeInitiativeState(state) {
  const entries = [];
  const seen = new Set();
  const rawEntries = isPlainObject(state) && Array.isArray(state.entries) ? state.entries : [];
  for (const entry of rawEntries.slice(0, MAX_INITIATIVE_ENTRIES)) {
    if (!isPlainObject(entry)) continue;
    const name = cleanText(entry.name, 40);
    const id = isValidId(entry.id) ? entry.id : "";
    if (!name || !id || seen.has(id)) continue;
    seen.add(id);
    entries.push({ id, name, side: entry.side === "enemy" ? "enemy" : "ally" });
  }
  return { entries };
}

function sanitizeTokenField(key, value) {
  switch (key) {
    case "name": return cleanText(value, 80);
    case "initiativeLabel": return cleanText(value, 20);
    case "initiativeEntryId": return typeof value === "string" && (value === "" || isValidId(value)) ? value : "";
    case "hpFontSize": return clamp(Math.round(finite(value) ?? 24), 8, 96);
    case "x":
    case "y": {
      const number = finite(value);
      return number === null ? undefined : clamp(number, -COORD_LIMIT, COORD_LIMIT);
    }
    case "size": return clamp(finite(value) ?? 96, 16, 800);
    case "shape": return value === "hex" ? "hex" : "square";
    case "visible": return Boolean(value);
    case "order": return finite(value) ?? 0;
    case "locked": return Boolean(value);
    default: return undefined;
  }
}

function sanitizeTokenChanges(changes) {
  if (!isPlainObject(changes)) return {};
  const cleaned = {};
  for (const key of TOKEN_SYNC_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(changes, key)) continue;
    const value = sanitizeTokenField(key, changes[key]);
    if (value !== undefined) cleaned[key] = value;
  }
  return cleaned;
}

// 新增 token：id 與圖片雜湊必填；玩家新增的 token 一律未鎖定，也不能帶名稱或先攻連結。
function sanitizeNewToken(token, role) {
  if (!isPlainObject(token) || !isValidId(token.id) || !isValidHash(token.imageHash)) return null;
  const defaults = { name: "", initiativeLabel: "", initiativeEntryId: "", hpFontSize: 24, x: 0, y: 0, size: 96, shape: "square", visible: true, order: 0, locked: false };
  const fields = sanitizeTokenChanges(token);
  const result = { id: token.id, imageHash: token.imageHash, ...defaults, ...fields };
  if (role !== "gm") {
    result.locked = false;
    result.name = "";
    result.initiativeLabel = "";
    result.initiativeEntryId = "";
    result.hpFontSize = 24;
    result.visible = true;
  }
  return result;
}

function sanitizeDiceRoll(roll, role) {
  if (!isPlainObject(roll) || !isValidId(roll.id)) return null;
  const rolls = Array.isArray(roll.rolls)
    ? roll.rolls.slice(0, 100).map((value) => Math.trunc(finite(value) ?? 0)).map((value) => clamp(value, 0, 1000))
    : [];
  const modifier = clamp(Math.trunc(finite(roll.modifier) ?? 0), -99, 99);
  return {
    id: roll.id,
    // 顯示的身分由伺服器依連線權限決定，玩家不能把自己的擲骰標成 GM。
    role: role === "gm" ? "GM" : "PL",
    nickname: cleanText(roll.nickname, 12),
    formula: cleanText(roll.formula, 120),
    rolls,
    modifier,
    modifierText: /^[+-]\d{1,2}$/.test(roll.modifierText || "") ? roll.modifierText : "",
    total: rolls.reduce((sum, value) => sum + value, 0) + modifier,
    createdAt: finite(roll.createdAt) ?? Date.now()
  };
}

module.exports = {
  TOKEN_SYNC_KEYS,
  PLAYER_EDITABLE_TOKEN_KEYS,
  isPlainObject,
  isValidRoomId,
  isValidHash,
  isValidId,
  isValidImageDataUrl,
  sanitizeImageKind,
  sanitizeMapState,
  sanitizeFogState,
  sanitizeStrokes,
  sanitizeGridSettings,
  sanitizeInitiativeState,
  sanitizeTokenChanges,
  sanitizeNewToken,
  sanitizeDiceRoll
};
