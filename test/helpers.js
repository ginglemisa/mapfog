// LAN 伺服器整合測試共用工具：啟動暫存資料夾的伺服器、模擬 GM／玩家的 WebSocket 連線。
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const http = require("http");
const WebSocket = require("ws");
const { createLanServer } = require("../server/lan-app");
const { hashDataUrl } = require("../server/hash");

const ADMIN_KEY = "TEST-KEY1-2345";

function makeDataDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "mapfog-lan-test-"));
}

async function startServer(t, options = {}) {
  const dataDir = options.dataDir || makeDataDir();
  const server = await createLanServer({
    port: 0,
    host: "127.0.0.1",
    rootDir: path.join(__dirname, ".."),
    dataDir,
    adminKey: ADMIN_KEY,
    trustLocalGm: false,
    log: () => {},
    ...options
  });
  const clients = [];
  t.after(async () => {
    for (const client of clients) client.close();
    await server.close();
    if (!options.keepData) fs.rmSync(dataDir, { recursive: true, force: true });
  });
  return {
    server,
    dataDir,
    port: server.port,
    connect: async (clientOptions) => {
      const client = new TestClient(server.port, clientOptions);
      clients.push(client);
      await client.join();
      return client;
    },
    client: (clientOptions) => {
      const client = new TestClient(server.port, clientOptions);
      clients.push(client);
      return client;
    }
  };
}

function makeImage(sizeBytes = 2000, type = "png") {
  const dataUrl = `data:image/${type};base64,${crypto.randomBytes(sizeBytes).toString("base64")}`;
  return { dataUrl, hash: hashDataUrl(dataUrl) };
}

class TestClient {
  constructor(port, { room = "testroom", role = "player", adminKey, clientId, secret, origin, resume } = {}) {
    this.resume = resume;
    this.port = port;
    this.room = room;
    this.role = role;
    this.adminKey = adminKey;
    this.clientId = clientId || crypto.randomBytes(8).toString("hex");
    this.secret = secret || crypto.randomBytes(16).toString("hex");
    this.origin = origin;
    this.messages = [];
    this.waiters = [];
    this.opCounter = 0;
    this.ws = null;
  }

  open() {
    return new Promise((resolve, reject) => {
      const headers = this.origin ? { Origin: this.origin } : {};
      const ws = new WebSocket(`ws://127.0.0.1:${this.port}/lan-ws`, { headers });
      this.ws = ws;
      ws.on("open", resolve);
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
      ws.on("message", (data) => {
        const message = JSON.parse(data.toString("utf8"));
        this.messages.push(message);
        for (const waiter of [...this.waiters]) {
          if (waiter.predicate(message)) {
            this.waiters.splice(this.waiters.indexOf(waiter), 1);
            clearTimeout(waiter.timer);
            waiter.resolve(message);
          }
        }
      });
    });
  }

  waitFor(predicate, timeoutMs = 2000, { includePast = true } = {}) {
    if (includePast) {
      const found = this.messages.find(predicate);
      if (found) return Promise.resolve(found);
    }
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      waiter.timer = setTimeout(() => {
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        reject(new Error("timed out waiting for message"));
      }, timeoutMs);
      this.waiters.push(waiter);
    });
  }

  // 等一小段時間，確認某種訊息「沒有」送到。
  async expectNone(predicate, waitMs = 150) {
    await new Promise((resolve) => setTimeout(resolve, waitMs));
    return !this.messages.some(predicate);
  }

  send(message) {
    this.ws.send(JSON.stringify(message));
  }

  async hello() {
    this.send({
      t: "hello",
      protocol: 1,
      room: this.room,
      role: this.role,
      clientId: this.clientId,
      secret: this.secret,
      ...(this.resume ? { resume: this.resume } : {}),
      ...(this.adminKey ? { adminKey: this.adminKey } : {})
    });
    return this.waitFor((message) => message.t === "auth");
  }

  async join() {
    await this.open();
    const auth = await this.hello();
    if (!auth.ok) throw Object.assign(new Error(auth.message), { auth });
    this.auth = auth;
    this.send({ t: "sync" });
    this.welcome = await this.waitFor((message) => message.t === "welcome");
    return this.welcome;
  }

  op(op, payload = {}, extra = {}) {
    this.opCounter += 1;
    const opId = extra.opId || `${this.clientId.slice(0, 6)}-${this.opCounter}`;
    this.send({ t: "op", op, opId, ...payload, ...extra });
    return this.waitFor((message) => message.t === "ack" && message.opId === opId, 5000, { includePast: false });
  }

  close() {
    try {
      this.ws?.terminate();
    } catch {
      // already closed
    }
  }
}

function httpGet(port, pathname, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get({ host: "127.0.0.1", port, path: pathname, headers }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
  });
}

module.exports = { ADMIN_KEY, startServer, makeImage, makeDataDir, httpGet, TestClient };
