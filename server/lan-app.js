// MapFog LAN 伺服器：同一個 port 提供網頁靜態檔、圖片下載 API 與 WebSocket 房間同步。
// 完全不需要網際網路；所有房間狀態以這台伺服器為準。
"use strict";

const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { WebSocketServer } = require("ws");
const { Room, roomDirName } = require("./room");
const v = require("./validate");

const PROTOCOL_VERSION = 1;
const WS_PATH = "/lan-ws";
const DEFAULT_MAX_IMAGE_CHARS = 12000000;
const DEFAULT_MAX_ROOM_IMAGE_BYTES = 512 * 1000 * 1000;
const HEARTBEAT_MS = 15000;
const ROOM_IDLE_UNLOAD_MS = 10 * 60 * 1000;
const MAX_ROOMS_IN_MEMORY = 100;
const ADMIN_KEY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json"
};
// 這些資料夾與檔案不對外提供：房間資料、套件、測試與伺服器設定。
const DENIED_SEGMENTS = new Set(["node_modules", "lan-data", "test", "server", "package.json", "package-lock.json"]);

function createAdminKey() {
  const bytes = crypto.randomBytes(12);
  let key = "";
  for (let index = 0; index < bytes.length; index += 1) {
    if (index && index % 4 === 0) key += "-";
    key += ADMIN_KEY_ALPHABET[bytes[index] % ADMIN_KEY_ALPHABET.length];
  }
  return key;
}

function normalizeAdminKey(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function adminKeyMatches(expected, provided) {
  const a = Buffer.from(normalizeAdminKey(expected));
  const b = Buffer.from(normalizeAdminKey(provided));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function loadOrCreateAdminKey(dataDir, log) {
  const keyPath = path.join(dataDir, "admin-key.txt");
  try {
    const stored = fs.readFileSync(keyPath, "utf8").trim();
    if (normalizeAdminKey(stored).length >= 8) return stored;
  } catch { /* create below */ }
  const key = createAdminKey();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(keyPath, `${key}\n`, "utf8");
  log(`已建立新的 GM 管理金鑰，存放在 ${keyPath}`);
  return key;
}

function stripIpv6Prefix(address) {
  return String(address || "").replace(/^::ffff:/i, "");
}

function isPrivateIpv4(address) {
  return /^10\./.test(address)
    || /^192\.168\./.test(address)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(address);
}

// 本機網卡的 IPv4 位址：私有網段（Wi-Fi 分享器、手機熱點）排前面，169.254 自動位址排最後。
function getLanAddresses() {
  const list = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries || []) {
      const family = typeof entry.family === "string" ? entry.family : (entry.family === 4 ? "IPv4" : "IPv6");
      if (family !== "IPv4" || entry.internal) continue;
      list.push({ name, address: entry.address, private: isPrivateIpv4(entry.address), linkLocal: entry.address.startsWith("169.254.") });
    }
  }
  const rank = (item) => (item.private ? 0 : item.linkLocal ? 2 : 1);
  return list.sort((a, b) => rank(a) - rank(b));
}

function getAllLocalAddresses() {
  const set = new Set(["127.0.0.1", "::1"]);
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) set.add(stripIpv6Prefix(entry.address));
  }
  return set;
}

// 從 GM 筆電本身連進來（127.0.0.1 或自己的網卡位址）才算「本機」。
function isLocalAddress(remoteAddress) {
  const address = stripIpv6Prefix(remoteAddress);
  if (/^127\./.test(address) || address === "::1") return true;
  return getAllLocalAddresses().has(address);
}

function hostnameOf(hostHeader) {
  const host = String(hostHeader || "").trim().toLowerCase();
  if (host.startsWith("[")) return host.slice(0, host.indexOf("]") + 1);
  return host.replace(/:\d+$/, "");
}

class LanServer {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || path.join(__dirname, ".."));
    this.dataDir = path.resolve(options.dataDir || path.join(this.rootDir, "lan-data"));
    this.port = Number(options.port ?? 8765);
    this.host = options.host || "0.0.0.0";
    this.log = options.log || ((message) => console.log(`[${new Date().toLocaleTimeString()}] ${message}`));
    this.trustLocalGm = options.trustLocalGm !== false;
    this.allowedHosts = new Set((options.allowedHosts || []).map((host) => String(host).toLowerCase()));
    this.maxImageChars = options.maxImageChars || DEFAULT_MAX_IMAGE_CHARS;
    this.maxRoomImageBytes = options.maxRoomImageBytes || DEFAULT_MAX_ROOM_IMAGE_BYTES;
    fs.mkdirSync(this.dataDir, { recursive: true });
    this.adminKey = options.adminKey || loadOrCreateAdminKey(this.dataDir, this.log);
    this.rooms = new Map();
    this.httpServer = http.createServer((req, res) => this.handleHttp(req, res));
    // 地圖 dataURL 上限 12MB，加上 JSON 外框仍在 16MB 以內。
    this.wss = new WebSocketServer({ noServer: true, maxPayload: this.maxImageChars + 4 * 1024 * 1024 });
    this.httpServer.on("upgrade", (req, socket, head) => this.handleUpgrade(req, socket, head));
    this.wss.on("connection", (ws, req) => this.handleConnection(ws, req));
    this.heartbeatTimer = null;
    this.idleTimer = null;
  }

  listen() {
    return new Promise((resolve, reject) => {
      const onError = (error) => reject(error);
      this.httpServer.once("error", onError);
      this.httpServer.listen(this.port, this.host, () => {
        this.httpServer.off("error", onError);
        this.port = this.httpServer.address().port;
        this.heartbeatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
        this.idleTimer = setInterval(() => this.unloadIdleRooms(), 60000);
        resolve(this);
      });
    });
  }

  async close() {
    clearInterval(this.heartbeatTimer);
    clearInterval(this.idleTimer);
    for (const client of this.wss.clients) client.terminate();
    for (const room of this.rooms.values()) room.saveNow();
    await new Promise((resolve) => this.wss.close(() => resolve()));
    await new Promise((resolve) => this.httpServer.close(() => resolve()));
  }

  saveAll() {
    for (const room of this.rooms.values()) room.saveNow();
  }

  // 只接受 IP、localhost 與本機名稱這類區網網址，擋下 DNS rebinding 之類借用網域名稱連進來的網頁。
  isAllowedHost(hostHeader) {
    const hostname = hostnameOf(hostHeader);
    if (!hostname) return false;
    if (this.allowedHosts.has(hostname)) return true;
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.startsWith("[")) return true;
    if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
    if (!hostname.includes(".")) return true;
    if (/\.(local|lan|home|home\.arpa|internal)$/.test(hostname)) return true;
    return hostname === os.hostname().toLowerCase();
  }

  sendJson(res, status, body, headers = {}) {
    const text = JSON.stringify(body);
    res.writeHead(status, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    });
    res.end(text);
  }

  sendText(res, status, text) {
    res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff", "Cache-Control": "no-store" });
    res.end(text);
  }

  handleHttp(req, res) {
    if (!this.isAllowedHost(req.headers.host)) {
      this.sendText(res, 421, "Host not allowed. Open MapFog with the LAN IP address shown in the server window.");
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      this.sendText(res, 405, "Method not allowed");
      return;
    }
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    } catch {
      this.sendText(res, 400, "Bad request");
      return;
    }
    if (pathname === "/lan-api/info") {
      this.sendJson(res, 200, {
        app: "mapfog-lan",
        protocol: PROTOCOL_VERSION,
        port: this.port,
        requestIsLocal: isLocalAddress(req.socket.remoteAddress),
        addresses: getLanAddresses().map(({ name, address, private: isPrivate, linkLocal }) => ({ name, address, private: isPrivate, linkLocal }))
      });
      return;
    }
    const imageMatch = pathname.match(/^\/lan-api\/rooms\/([^/]+)\/images\/([^/]+)$/);
    if (imageMatch) {
      this.serveImage(res, imageMatch[1], imageMatch[2], req.method === "HEAD");
      return;
    }
    if (pathname.startsWith("/lan-api/")) {
      this.sendText(res, 404, "Not found");
      return;
    }
    this.serveStatic(req, res, pathname);
  }

  serveImage(res, roomId, hash, headOnly) {
    if (!v.isValidRoomId(roomId) || !v.isValidHash(hash)) {
      this.sendText(res, 400, "Bad image request");
      return;
    }
    const room = this.getRoom(roomId, { create: false });
    const dataUrl = room?.getImage(hash) || "";
    if (!dataUrl) {
      this.sendText(res, 404, "Image not found");
      return;
    }
    // 圖片依內容雜湊命名，內容永遠不變，可以讓瀏覽器長期快取。
    res.writeHead(200, {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Length": Buffer.byteLength(dataUrl),
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff"
    });
    res.end(headOnly ? undefined : dataUrl);
  }

  serveStatic(req, res, pathname) {
    const relative = path.posix.normalize(pathname === "/" ? "/index.html" : pathname).replace(/^\/+/, "");
    const segments = relative.split("/");
    // 反斜線、冒號（Windows 磁碟代號與 ::$DATA）一律不接受。
    if (/[\0\\:]/.test(relative) || segments.some((segment) => !segment || segment === ".." || segment.startsWith(".") || DENIED_SEGMENTS.has(segment.toLowerCase()))) {
      this.sendText(res, 404, "Not found");
      return;
    }
    const filePath = path.join(this.rootDir, ...segments);
    const insideRoot = filePath.startsWith(this.rootDir + path.sep);
    const insideData = filePath === this.dataDir || filePath.startsWith(this.dataDir + path.sep);
    const contentType = CONTENT_TYPES[path.extname(filePath).toLowerCase()];
    if (!insideRoot || insideData || !contentType) {
      this.sendText(res, 404, "Not found");
      return;
    }
    fs.stat(filePath, (error, stat) => {
      if (error || !stat.isFile()) {
        this.sendText(res, 404, "Not found");
        return;
      }
      res.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": stat.size,
        // 每次都向伺服器確認，GM 更新程式後玩家重新整理就會拿到新版。
        "Cache-Control": "no-cache",
        "Last-Modified": stat.mtime.toUTCString(),
        "X-Content-Type-Options": "nosniff"
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      fs.createReadStream(filePath).on("error", () => res.destroy()).pipe(res);
    });
  }

  handleUpgrade(req, socket, head) {
    let pathname = "";
    try {
      pathname = new URL(req.url, "http://localhost").pathname;
    } catch { /* rejected below */ }
    const origin = req.headers.origin;
    let originOk = true;
    if (origin) {
      try {
        originOk = new URL(origin).host.toLowerCase() === String(req.headers.host || "").toLowerCase();
      } catch {
        originOk = false;
      }
    }
    if (!pathname.endsWith(WS_PATH) || !this.isAllowedHost(req.headers.host) || !originOk) {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
  }

  getRoom(roomId, { create = true } = {}) {
    let room = this.rooms.get(roomId);
    if (room) return room;
    if (!create && !fs.existsSync(path.join(this.dataDir, "rooms", roomDirName(roomId), "state.json"))) return null;
    if (this.rooms.size >= MAX_ROOMS_IN_MEMORY) this.unloadIdleRooms(0);
    if (this.rooms.size >= MAX_ROOMS_IN_MEMORY) return null;
    room = new Room({
      roomId,
      dataDir: this.dataDir,
      log: this.log,
      maxImageChars: this.maxImageChars,
      maxRoomImageBytes: this.maxRoomImageBytes
    });
    this.rooms.set(roomId, room);
    return room;
  }

  unloadIdleRooms(idleMs = ROOM_IDLE_UNLOAD_MS) {
    const now = Date.now();
    for (const [roomId, room] of this.rooms) {
      if (room.clients.size || now - room.lastActiveAt < idleMs) continue;
      room.saveNow();
      this.rooms.delete(roomId);
    }
  }

  heartbeat() {
    for (const ws of this.wss.clients) {
      if (ws.mapfogAlive === false) {
        ws.terminate();
        continue;
      }
      ws.mapfogAlive = false;
      ws.ping();
    }
  }

  send(client, message) {
    if (client.ws.readyState !== 1) return;
    client.ws.send(JSON.stringify(message));
  }

  broadcast(room, message, filter) {
    const text = JSON.stringify(message);
    for (const client of room.clients) {
      if (!client.synced || client.ws.readyState !== 1 || (filter && !filter(client))) continue;
      client.ws.send(text);
    }
  }

  broadcastPresence(room) {
    this.broadcast(room, { t: "presence", ...room.presence() });
  }

  handleConnection(ws, req) {
    const client = {
      ws,
      clientId: "",
      role: "",
      room: null,
      synced: false,
      isLocal: isLocalAddress(req.socket.remoteAddress),
      remoteAddress: stripIpv6Prefix(req.socket.remoteAddress)
    };
    ws.mapfogAlive = true;
    ws.on("pong", () => { ws.mapfogAlive = true; });
    ws.on("message", (data, isBinary) => {
      ws.mapfogAlive = true;
      if (isBinary) return;
      let message;
      try {
        message = JSON.parse(data.toString("utf8"));
      } catch {
        this.send(client, { t: "error", code: "bad-json", message: "訊息格式錯誤" });
        return;
      }
      if (!v.isPlainObject(message)) return;
      try {
        this.handleMessage(client, message);
      } catch (error) {
        this.log(`處理訊息失敗：${error.stack || error.message}`);
        if (message.t === "op") this.send(client, { t: "ack", opId: message.opId, ok: false, code: "server-error", error: "伺服器處理失敗" });
      }
    });
    ws.on("close", () => this.handleClose(client));
    ws.on("error", () => {});
  }

  handleMessage(client, message) {
    if (message.t === "ping") {
      this.send(client, { t: "pong", serverTime: Date.now() });
      return;
    }
    if (message.t === "hello") {
      this.handleHello(client, message);
      return;
    }
    if (!client.room) {
      this.send(client, { t: "error", code: "not-joined", message: "尚未加入房間" });
      return;
    }
    if (message.t === "sync") {
      const room = client.room;
      client.synced = true;
      this.send(client, { t: "welcome", serverTime: Date.now(), state: room.snapshotFor(client) });
      this.broadcastPresence(room);
      return;
    }
    if (message.t === "op") this.handleOp(client, message);
  }

  handleHello(client, message) {
    const fail = (code, text) => {
      this.send(client, { t: "auth", ok: false, code, message: text });
      client.ws.close(4001, code);
    };
    if (client.room) return;
    if (message.protocol !== PROTOCOL_VERSION) {
      fail("protocol", "網頁與 LAN 伺服器版本不一致，請重新整理網頁或更新伺服器。");
      return;
    }
    if (!v.isValidRoomId(message.room)) {
      fail("bad-room", "LAN 房間名稱只能使用英文字母、數字、- 或 _，長度 1–64 個字元。");
      return;
    }
    const role = message.role === "gm" ? "gm" : "player";
    let returnKey = false;
    if (role === "gm") {
      const keyOk = adminKeyMatches(this.adminKey, message.adminKey);
      if (!keyOk && !(this.trustLocalGm && client.isLocal)) {
        fail(message.adminKey ? "gm-key-invalid" : "gm-key-required",
          message.adminKey ? "GM 管理金鑰不正確。" : "這台裝置需要 GM 管理金鑰才能以 GM 身分加入。");
        this.log(`拒絕 ${client.remoteAddress} 以 GM 身分加入房間 ${message.room}（${message.adminKey ? "金鑰錯誤" : "未提供金鑰"}）`);
        return;
      }
      // GM 筆電本機開啟時自動取得金鑰並記在瀏覽器裡；其他裝置必須自行輸入。
      returnKey = !keyOk;
    }
    const room = this.getRoom(message.room);
    if (!room) {
      fail("busy", "LAN 伺服器同時開啟的房間太多，請稍後再試。");
      return;
    }
    if (!room.claimSession(message.clientId, message.secret)) {
      fail("session", "連線身分驗證失敗，請重新整理網頁。");
      return;
    }
    client.clientId = message.clientId;
    client.role = role;
    client.room = room;
    client.aliases = new Set();
    const resume = message.resume;
    if (v.isPlainObject(resume) && resume.clientId !== message.clientId && room.verifySession(resume.clientId, resume.secret)) {
      client.aliases.add(resume.clientId);
    }
    room.clients.add(client);
    room.touch();
    this.send(client, {
      t: "auth",
      ok: true,
      role,
      roomId: room.roomId,
      clientId: client.clientId,
      serverTime: Date.now(),
      ...(returnKey ? { adminKey: this.adminKey } : {})
    });
  }

  handleOp(client, message) {
    const room = client.room;
    const outcome = room.apply(client, message);
    this.send(client, {
      t: "ack",
      opId: message.opId,
      ok: outcome.ok,
      ...(outcome.code ? { code: outcome.code, error: outcome.error } : {}),
      ...(outcome.rev ? { rev: outcome.rev } : {}),
      ...(outcome.duplicate ? { duplicate: true } : {})
    });
    for (const extra of outcome.toSender) this.send(client, extra);
    for (const extra of outcome.toOthers) this.broadcast(room, extra, (other) => other !== client);
    for (const extra of outcome.toGms) this.broadcast(room, extra, (other) => other.role === "gm");
    if (!outcome.ok && outcome.code !== "conflict") {
      this.log(`[房間 ${room.roomId}] 拒絕 ${client.role} ${client.remoteAddress} 的 ${message.op}：${outcome.error}`);
    }
  }

  handleClose(client) {
    const room = client.room;
    if (!room) return;
    room.clients.delete(client);
    room.touch();
    if (client.synced) this.broadcastPresence(room);
  }
}

async function createLanServer(options) {
  const server = new LanServer(options);
  await server.listen();
  return server;
}

module.exports = { createLanServer, LanServer, getLanAddresses, isLocalAddress, normalizeAdminKey, PROTOCOL_VERSION };
