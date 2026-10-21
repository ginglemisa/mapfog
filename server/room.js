// 一個 LAN 房間的權威狀態：地圖、迷霧、格線、先攻、token 與圖片索引。
// 所有寫入都經過這裡驗證權限與格式，再決定要通知誰；狀態以 debounce＋暫存檔＋rename 寫回硬碟。
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { hashDataUrl } = require("./hash");
const v = require("./validate");

const STATE_VERSION = 1;
const SAVE_DELAY_MS = 400;
// 迷霧壓縮由 GM 端在 200 筆時處理；這裡只是防止異常資料無限累積。
const MAX_FOG_BATCHES = 4000;
const MAX_TOKENS = 500;
const MAX_TOMBSTONES = 2000;
const MAX_RECENT_OPS = 2000;
// 鎖定後這段時間內，仍接受玩家送來的位置（與 app.js 的 TOKEN_LOCK_GRACE_MS 相同）。
const TOKEN_LOCK_GRACE_MS = 10000;

function roomDirName(roomId) {
  // Windows 檔名不分大小寫：加上雜湊，讓 MyGame 與 mygame 不會寫進同一個資料夾。
  const digest = crypto.createHash("sha256").update(roomId).digest("hex").slice(0, 10);
  return `${roomId.toLowerCase()}-${digest}`;
}

function createEmptyState(roomId) {
  return {
    version: STATE_VERSION,
    roomId,
    rev: 0,
    map: null,
    fog: null,
    fogBatches: { epoch: "", items: [] },
    grid: null,
    initiative: null,
    // 每個目標最後一次被誰（clientId）在第幾版改過；斷線重送時用來判斷是否衝突。
    metas: { map: null, fog: null, grid: null, initiative: null },
    tokens: {},
    tokenMetas: {},
    tombstones: {},
    imageIndex: {}
  };
}

function writeFileAtomic(filePath, content) {
  const tempPath = `${filePath}.tmp-${process.pid}-${crypto.randomBytes(4).toString("hex")}`;
  const handle = fs.openSync(tempPath, "w");
  try {
    fs.writeSync(handle, content);
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
  // Windows 上防毒軟體偶爾會短暫鎖住檔案，rename 失敗時稍等再試。
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tempPath, filePath);
      return;
    } catch (error) {
      if (attempt >= 5 || !["EPERM", "EBUSY", "EACCES"].includes(error.code)) {
        try { fs.unlinkSync(tempPath); } catch { /* ignore */ }
        throw error;
      }
      const until = Date.now() + 50 * (attempt + 1);
      while (Date.now() < until) { /* short synchronous back-off */ }
    }
  }
}

function result(ok, extra = {}) {
  return { ok, toSender: [], toOthers: [], toGms: [], ...extra };
}

function reject(code, error, extra = {}) {
  return result(false, { code, error, ...extra });
}

class Room {
  constructor({ roomId, dataDir, log, maxImageChars, maxRoomImageBytes }) {
    this.roomId = roomId;
    this.dir = path.join(dataDir, "rooms", roomDirName(roomId));
    this.imageDir = path.join(this.dir, "images");
    this.statePath = path.join(this.dir, "state.json");
    this.log = log || (() => {});
    this.maxImageChars = maxImageChars;
    this.maxRoomImageBytes = maxRoomImageBytes;
    this.state = createEmptyState(roomId);
    this.images = new Map();
    this.clients = new Set();
    this.sessions = new Map();
    this.recentOps = new Map();
    this.saveTimer = null;
    this.dirty = false;
    this.lastActiveAt = Date.now();
    this.load();
  }

  load() {
    for (const candidate of [this.statePath, `${this.statePath}.bak`]) {
      if (!fs.existsSync(candidate)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, "utf8"));
        if (parsed?.version !== STATE_VERSION || parsed.roomId !== this.roomId) continue;
        this.state = { ...createEmptyState(this.roomId), ...parsed };
        this.state.metas = { ...createEmptyState(this.roomId).metas, ...(parsed.metas || {}) };
        if (candidate === this.statePath) {
          // 每次啟動先留一份可讀的備份，主檔損毀時還能退回。
          try { fs.copyFileSync(this.statePath, `${this.statePath}.bak`); } catch { /* best effort */ }
        } else {
          this.log(`[房間 ${this.roomId}] state.json 無法讀取，已改用備份 state.json.bak`);
        }
        this.log(`[房間 ${this.roomId}] 已從硬碟恢復：${Object.keys(this.state.tokens).length} 個 token、${this.state.map ? "有" : "沒有"}地圖`);
        return;
      } catch (error) {
        this.log(`[房間 ${this.roomId}] 讀取 ${path.basename(candidate)} 失敗：${error.message}`);
      }
    }
  }

  scheduleSave() {
    this.dirty = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.saveNow();
    }, SAVE_DELAY_MS);
  }

  saveNow() {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (!this.dirty) return;
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      writeFileAtomic(this.statePath, JSON.stringify(this.state));
      this.dirty = false;
    } catch (error) {
      this.log(`[房間 ${this.roomId}] 寫入硬碟失敗：${error.message}`);
    }
  }

  nextRev() {
    this.state.rev += 1;
    return this.state.rev;
  }

  touch() {
    this.lastActiveAt = Date.now();
  }

  // 同一個畫面（clientId）重新連線時要帶同一把 secret，其他人不能冒用它的身分。
  claimSession(clientId, secret) {
    if (!v.isValidId(clientId) || typeof secret !== "string" || secret.length < 8 || secret.length > 100) return false;
    const digest = crypto.createHash("sha256").update(secret).digest("hex");
    const existing = this.sessions.get(clientId);
    if (existing && existing !== digest) return false;
    this.sessions.set(clientId, digest);
    return true;
  }

  // 重新整理前的分頁身分：secret 對得上才承認，補送的修改視為同一個人做的。
  verifySession(clientId, secret) {
    if (!v.isValidId(clientId) || typeof secret !== "string") return false;
    const existing = this.sessions.get(clientId);
    return Boolean(existing) && existing === crypto.createHash("sha256").update(secret).digest("hex");
  }

  isSelf(client, by) {
    return Boolean(by) && (by === client.clientId || Boolean(client.aliases?.has(by)));
  }

  presence() {
    let players = 0;
    let gms = 0;
    for (const client of this.clients) {
      if (!client.synced) continue;
      if (client.role === "gm") gms += 1;
      else players += 1;
    }
    return { players, gms };
  }

  // 圖片：記憶體 → 硬碟 images/{雜湊}.txt（原樣存 dataURL，雜湊才會一致）。
  getImage(hash) {
    if (!v.isValidHash(hash) || !this.state.imageIndex[hash]) return "";
    if (this.images.has(hash)) return this.images.get(hash);
    try {
      const dataUrl = fs.readFileSync(path.join(this.imageDir, `${hash}.txt`), "utf8");
      this.images.set(hash, dataUrl);
      return dataUrl;
    } catch {
      return "";
    }
  }

  snapshotFor(client) {
    const state = this.state;
    return {
      map: state.map,
      fog: state.fog,
      fogBatches: { epoch: state.fogBatches.epoch, items: state.fogBatches.items },
      grid: state.grid,
      initiative: state.initiative,
      metas: state.metas,
      tokens: Object.values(state.tokens).map((token) => ({ token, ...this.tokenMetaView(token.id) })),
      imageIndex: client.role === "gm" ? state.imageIndex : {},
      presence: this.presence()
    };
  }

  tokenMetaView(tokenId) {
    const meta = this.state.tokenMetas[tokenId] || {};
    return { rev: meta.rev || 0, by: meta.by || "", sourceRole: meta.sourceRole || "player" };
  }

  // 斷線期間累積、重新連線後才送到的修改：只有在這段期間沒有其他人改過同一個目標時才套用。
  isStale(meta, op, client) {
    if (!op.replay) return false;
    if (!meta || !meta.rev) return false;
    if (this.isSelf(client, meta.by)) return false;
    return op.baseRev !== meta.rev;
  }

  // 重新整理後補送的操作記在原本的分頁身分底下，原分頁若還開著再送一次也只會套用一次。
  opOwner(client, op) {
    if (op.restored && client.aliases?.size) return client.aliases.values().next().value;
    return client.clientId;
  }

  rememberOp(client, op) {
    const owner = this.opOwner(client, op);
    let seen = this.recentOps.get(owner);
    if (!seen) {
      seen = new Set();
      this.recentOps.set(owner, seen);
    }
    seen.add(op.opId);
    if (seen.size > MAX_RECENT_OPS) seen.delete(seen.values().next().value);
  }

  hasSeenOp(client, opId) {
    if (this.recentOps.get(client.clientId)?.has(opId)) return true;
    for (const alias of client.aliases || []) if (this.recentOps.get(alias)?.has(opId)) return true;
    return false;
  }

  apply(client, op) {
    this.touch();
    if (!v.isValidId(op.opId)) return reject("bad-request", "缺少 opId");
    if (this.hasSeenOp(client, op.opId)) return result(true, { duplicate: true });
    const handler = OP_HANDLERS[op.op];
    if (!handler) return reject("bad-request", `未知的操作：${op.op}`);
    const gmOnly = GM_ONLY_OPS.has(op.op);
    if (gmOnly && client.role !== "gm") return reject("forbidden", "只有 GM 可以執行這個操作");
    const outcome = handler.call(this, client, op);
    // 衝突或權限拒絕不需要重送；格式錯誤也不會因重送而變好。
    this.rememberOp(client, op);
    return outcome;
  }

  // 斷線補送的修改因衝突被拒絕時，把伺服器目前的版本送回給那個畫面，讓它改回來。
  valueCorrections(...keys) {
    const state = this.state;
    return keys.map((key) => {
      const meta = state.metas[key] || {};
      const base = { correction: true, rev: meta.rev || 0, by: meta.by || "" };
      if (key === "fog") return { t: "fog", fog: state.fog, batches: state.fogBatches.items, ...base };
      return { t: key, [key]: state[key], ...base };
    });
  }

  tokenCorrection(tokenId) {
    const token = this.state.tokens[tokenId] || null;
    return { t: "token", tokenId, token, ...this.tokenMetaView(tokenId), sourceRole: "server" };
  }

  imageInUse() {
    const state = this.state;
    const inUse = new Set();
    if (state.map?.hash) inUse.add(state.map.hash);
    if (state.fog?.checkpointHash) inUse.add(state.fog.checkpointHash);
    for (const token of Object.values(state.tokens)) inUse.add(token.imageHash);
    return inUse;
  }

  deleteImageFiles(hashes) {
    for (const hash of hashes) {
      this.images.delete(hash);
      fs.promises.unlink(path.join(this.imageDir, `${hash}.txt`)).catch(() => {});
    }
  }

  roomImageBytes() {
    let total = 0;
    for (const info of Object.values(this.state.imageIndex)) total += Number(info?.bytes) || 0;
    return total;
  }
}

const GM_ONLY_OPS = new Set(["saveMapAndFog", "saveFogState", "appendFogBatch", "sendGridSettings", "sendInitiativeState", "clearRoomState", "deleteImages"]);

const OP_HANDLERS = {
  putImage(client, op) {
    const kind = v.sanitizeImageKind(op.kind);
    if (!kind) return reject("bad-request", "圖片種類錯誤");
    if (client.role !== "gm" && kind !== "token") return reject("forbidden", "玩家只能上傳 token 圖片");
    if (!v.isValidHash(op.hash)) return reject("bad-request", "圖片雜湊格式錯誤");
    if (typeof op.dataUrl !== "string" || op.dataUrl.length > this.maxImageChars) {
      return reject("too-large", `圖片超過 LAN 伺服器上限（${Math.round(this.maxImageChars / 1e6)}MB）`);
    }
    if (!v.isValidImageDataUrl(op.dataUrl, this.maxImageChars)) return reject("bad-request", "只接受 PNG、JPG、WebP、GIF 圖片");
    if (hashDataUrl(op.dataUrl) !== op.hash) return reject("bad-request", "圖片內容與雜湊不符");
    if (this.state.imageIndex[op.hash]) {
      this.images.set(op.hash, op.dataUrl);
      return result(true);
    }
    if (this.roomImageBytes() + op.dataUrl.length > this.maxRoomImageBytes) {
      return reject("too-large", "這個房間的圖片總量已達上限，請先清除不用的地圖或 token");
    }

    // 先放進記憶體：同一條連線接著送來的 token／地圖引用，其他人立刻就能下載到圖片。
    this.images.set(op.hash, op.dataUrl);
    fs.mkdirSync(this.imageDir, { recursive: true });
    try {
      writeFileAtomic(path.join(this.imageDir, `${op.hash}.txt`), op.dataUrl);
    } catch (error) {
      this.log(`[房間 ${this.roomId}] 圖片寫入失敗：${error.message}`);
      this.images.delete(op.hash);
      return reject("server-error", "伺服器無法儲存圖片");
    }
    this.state.imageIndex[op.hash] = { kind, bytes: op.dataUrl.length, addedAt: Date.now() };
    this.scheduleSave();
    return result(true, { toGms: [{ t: "imageIndex", index: this.state.imageIndex }] });
  },

  saveMapAndFog(client, op) {
    const map = v.sanitizeMapState(op.map);
    const fog = v.sanitizeFogState(op.fog);
    if (!map || !fog) return reject("bad-request", "地圖或迷霧資料格式錯誤");
    if (this.isStale(this.state.metas.map, { ...op, baseRev: op.baseRevs?.map }, client)
      || this.isStale(this.state.metas.fog, { ...op, baseRev: op.baseRevs?.fog }, client)) {
      return reject("conflict", "斷線期間其他 GM 已更換地圖或迷霧，以伺服器為準", { toSender: this.valueCorrections("map", "fog") });
    }
    const rev = this.nextRev();
    const meta = { rev, by: client.clientId };
    this.state.map = map;
    this.state.fog = fog;
    this.state.fogBatches = { epoch: fog.epoch, items: [] };
    this.state.metas.map = meta;
    this.state.metas.fog = meta;
    this.scheduleSave();
    return result(true, {
      rev,
      toOthers: [{ t: "map", map, ...meta }, { t: "fog", fog, ...meta }]
    });
  },

  saveFogState(client, op) {
    const fog = v.sanitizeFogState(op.fog);
    if (!fog) return reject("bad-request", "迷霧資料格式錯誤");
    if (this.isStale(this.state.metas.fog, op, client)) {
      return reject("conflict", "斷線期間迷霧已被其他 GM 重設，以伺服器為準", { toSender: this.valueCorrections("fog") });
    }
    const rev = this.nextRev();
    const meta = { rev, by: client.clientId };
    this.state.fog = fog;
    this.state.fogBatches = { epoch: fog.epoch, items: [] };
    this.state.metas.fog = meta;
    this.scheduleSave();
    return result(true, { rev, toOthers: [{ t: "fog", fog, ...meta }] });
  },

  appendFogBatch(client, op) {
    const seq = Math.trunc(Number(op.seq));
    const strokes = v.sanitizeStrokes(op.strokes);
    if (!Number.isFinite(seq) || seq < 1 || !strokes) return reject("bad-request", "擦霧紀錄格式錯誤");
    const batches = this.state.fogBatches;
    if (!this.state.fog || this.state.fog.epoch !== op.epoch || batches.epoch !== op.epoch) {
      // 迷霧已換成新版本（重設、全開或壓縮），舊版本的擦霧不再適用。
      return reject("conflict", "迷霧版本已更新，這筆擦霧不再套用", { toSender: this.valueCorrections("fog") });
    }
    const existing = batches.items.find((item) => item.seq === seq);
    if (existing) {
      if (this.isSelf(client, existing.by)) return result(true);
      return reject("conflict", "這個擦霧序號已被其他 GM 使用", { toSender: this.valueCorrections("fog") });
    }
    if (batches.items.length >= MAX_FOG_BATCHES) return reject("too-large", "擦霧紀錄過多，請重設或全開迷霧");
    const item = { seq, strokes, by: client.clientId };
    batches.items.push(item);
    batches.items.sort((a, b) => a.seq - b.seq);
    this.scheduleSave();
    return result(true, { toOthers: [{ t: "fogBatch", epoch: op.epoch, ...item }] });
  },

  sendGridSettings(client, op) {
    const grid = v.sanitizeGridSettings(op.grid);
    if (!grid) return reject("bad-request", "格線資料格式錯誤");
    if (this.isStale(this.state.metas.grid, op, client)) {
      return reject("conflict", "斷線期間格線已被其他 GM 修改，以伺服器為準", { toSender: this.valueCorrections("grid") });
    }
    const rev = this.nextRev();
    const meta = { rev, by: client.clientId };
    this.state.grid = grid;
    this.state.metas.grid = meta;
    this.scheduleSave();
    return result(true, { rev, toOthers: [{ t: "grid", grid, ...meta }] });
  },

  // GM 的私有先攻（HP、先攻值）只存在 GM 瀏覽器；這裡只收公開的名稱與敵友，GM 為準、不做衝突判斷。
  sendInitiativeState(client, op) {
    const initiative = v.sanitizeInitiativeState(op.state);
    const rev = this.nextRev();
    const meta = { rev, by: client.clientId };
    this.state.initiative = initiative;
    this.state.metas.initiative = meta;
    this.scheduleSave();
    return result(true, { rev, toOthers: [{ t: "initiative", initiative, ...meta }] });
  },

  clearRoomState(client) {
    const now = Date.now();
    const tokenIds = Object.keys(this.state.tokens);
    const imageHashes = Object.keys(this.state.imageIndex);
    const fresh = createEmptyState(this.roomId);
    fresh.rev = this.nextRev();
    // 清除前的 token 都記成已刪除，其他畫面晚到的補送不會把它們救回來。
    fresh.tombstones = { ...this.state.tombstones };
    for (const tokenId of tokenIds) fresh.tombstones[tokenId] = now;
    this.state = fresh;
    this.trimTombstones();
    this.deleteImageFiles(imageHashes);
    this.scheduleSave();
    this.log(`[房間 ${this.roomId}] GM 已清除房間`);
    return result(true, { rev: fresh.rev, toOthers: [{ t: "roomCleared", rev: fresh.rev, by: client.clientId }] });
  },

  deleteImages(client, op) {
    if (!Array.isArray(op.hashes)) return reject("bad-request", "圖片清單格式錯誤");
    // 伺服器再檢查一次：地圖、迷霧 checkpoint 或任何 token 還在用的圖片不刪。
    const inUse = this.imageInUse();
    const removable = op.hashes.filter((hash) => v.isValidHash(hash) && this.state.imageIndex[hash] && !inUse.has(hash));
    if (!removable.length) return result(true);
    for (const hash of removable) delete this.state.imageIndex[hash];
    this.deleteImageFiles(removable);
    this.scheduleSave();
    return result(true, { toGms: [{ t: "imageIndex", index: this.state.imageIndex }] });
  },

  addToken(client, op) {
    const token = v.sanitizeNewToken(op.token, client.role);
    if (!token) return reject("bad-request", "token 資料格式錯誤");
    const state = this.state;
    if (state.tombstones[token.id]) {
      return reject("gone", "這個 token 已被刪除", { toSender: [this.tokenCorrection(token.id)] });
    }
    if (!state.imageIndex[token.imageHash]) {
      return reject("missing-image", "token 圖片尚未上傳到 LAN 伺服器", { toSender: [this.tokenCorrection(token.id)] });
    }
    const existing = state.tokens[token.id];
    if (existing && client.role !== "gm") {
      return reject("forbidden", "玩家不能覆蓋已存在的 token", { toSender: [this.tokenCorrection(token.id)] });
    }
    if (existing && this.isStale(state.tokenMetas[token.id], op, client)) {
      return reject("conflict", "斷線期間這個 token 已被其他人修改，以伺服器為準", { toSender: [this.tokenCorrection(token.id)] });
    }
    if (!existing && Object.keys(state.tokens).length >= MAX_TOKENS) {
      return reject("too-large", `每個房間最多 ${MAX_TOKENS} 個 token`, { toSender: [this.tokenCorrection(token.id)] });
    }
    const rev = this.nextRev();
    const previousMeta = state.tokenMetas[token.id] || {};
    state.tokens[token.id] = token;
    // 只有「原本未鎖定、這次變成鎖定」才開始 10 秒寬限；新增時就鎖定的 token 沒有寬限。
    let lockedAt = 0;
    if (token.locked && existing) lockedAt = existing.locked ? previousMeta.lockedAt || 0 : Date.now();
    state.tokenMetas[token.id] = { rev, by: client.clientId, sourceRole: client.role, lockedAt };
    this.scheduleSave();
    return result(true, {
      rev,
      toOthers: [{ t: "tokenAdd", token, rev, by: client.clientId, sourceRole: client.role }]
    });
  },

  updateToken(client, op) {
    const state = this.state;
    const tokenId = op.tokenId;
    const existing = v.isValidId(tokenId) ? state.tokens[tokenId] : null;
    if (!existing) {
      // 已刪除的 token 不接受晚到的變更，避免被救回來。
      return reject("gone", "這個 token 已不存在", { toSender: v.isValidId(tokenId) ? [this.tokenCorrection(tokenId)] : [] });
    }
    const changes = v.sanitizeTokenChanges(op.changes);
    const meta = state.tokenMetas[tokenId] || {};
    let rejectedKeys = [];
    if (client.role !== "gm") {
      const editable = existing.locked
        ? (meta.lockedAt && Date.now() - meta.lockedAt < TOKEN_LOCK_GRACE_MS ? ["x", "y"] : [])
        : v.PLAYER_EDITABLE_TOKEN_KEYS;
      rejectedKeys = Object.keys(changes).filter((key) => !editable.includes(key));
      for (const key of rejectedKeys) delete changes[key];
    }
    const correction = rejectedKeys.length ? [this.tokenCorrection(tokenId)] : [];
    if (!Object.keys(changes).length) {
      return rejectedKeys.length
        ? reject("forbidden", "這個 token 已鎖定或欄位不允許玩家修改", { toSender: correction })
        : result(true);
    }
    if (this.isStale(meta, op, client)) {
      return reject("conflict", "斷線期間這個 token 已被其他人修改，以伺服器為準", { toSender: [this.tokenCorrection(tokenId)] });
    }
    const rev = this.nextRev();
    const next = { ...existing, ...changes };
    let lockedAt = meta.lockedAt || 0;
    if (next.locked && !existing.locked) lockedAt = Date.now();
    if (!next.locked) lockedAt = 0;
    state.tokens[tokenId] = next;
    state.tokenMetas[tokenId] = { rev, by: client.clientId, sourceRole: client.role, lockedAt };
    this.scheduleSave();
    return result(true, {
      rev,
      toSender: rejectedKeys.length ? [this.tokenCorrection(tokenId)] : [],
      toOthers: [{ t: "tokenPatch", tokenId, changes, rev, by: client.clientId, sourceRole: client.role }]
    });
  },

  removeToken(client, op) {
    const state = this.state;
    const tokenId = op.tokenId;
    if (!v.isValidId(tokenId)) return reject("bad-request", "token id 格式錯誤");
    const existing = state.tokens[tokenId];
    if (!existing) return result(true);
    if (client.role !== "gm" && existing.locked) {
      return reject("forbidden", "鎖定的 token 只有 GM 能刪除", { toSender: [this.tokenCorrection(tokenId)] });
    }
    if (this.isStale(state.tokenMetas[tokenId], op, client)) {
      return reject("conflict", "斷線期間這個 token 已被其他人修改，以伺服器為準", { toSender: [this.tokenCorrection(tokenId)] });
    }
    const rev = this.nextRev();
    delete state.tokens[tokenId];
    delete state.tokenMetas[tokenId];
    state.tombstones[tokenId] = Date.now();
    this.trimTombstones();
    this.scheduleSave();
    return result(true, { rev, toOthers: [{ t: "tokenRemove", tokenId, rev, by: client.clientId, sourceRole: client.role }] });
  },

  diceRoll(client, op) {
    const roll = v.sanitizeDiceRoll(op.roll, client.role);
    if (!roll) return reject("bad-request", "擲骰資料格式錯誤");
    return result(true, { toOthers: [{ t: "dice", roll }] });
  }
};

Room.prototype.trimTombstones = function trimTombstones() {
  const entries = Object.entries(this.state.tombstones);
  if (entries.length <= MAX_TOMBSTONES) return;
  entries.sort((a, b) => a[1] - b[1]);
  this.state.tombstones = Object.fromEntries(entries.slice(-MAX_TOMBSTONES));
};

module.exports = { Room, roomDirName, writeFileAtomic, TOKEN_LOCK_GRACE_MS };
