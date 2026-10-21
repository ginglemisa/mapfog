// LAN 伺服器整合測試：權限、token 同步、迷霧、持久化、重連衝突、房間隔離、靜態檔安全性。
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ADMIN_KEY, startServer, makeImage, makeDataDir, httpGet } = require("./helpers");

const MAP_IMAGE = makeImage(3000);
const TOKEN_IMAGE = makeImage(500);

function token(id, overrides = {}) {
  return { id, imageHash: TOKEN_IMAGE.hash, x: 100, y: 100, size: 96, shape: "square", visible: true, order: 1, locked: false, name: "", ...overrides };
}

function fog(epoch, overrides = {}) {
  return { epoch, seq: 0, base: "covered", checkpointHash: "", mapHash: MAP_IMAGE.hash, width: 800, height: 600, ...overrides };
}

async function setupRoom(t, options = {}) {
  const env = await startServer(t, options);
  const gm = await env.connect({ role: "gm", adminKey: ADMIN_KEY });
  return { ...env, gm };
}

async function gmAddToken(gm, tokenData) {
  await gm.op("putImage", { hash: TOKEN_IMAGE.hash, dataUrl: TOKEN_IMAGE.dataUrl, kind: "token" });
  return gm.op("addToken", { token: tokenData });
}

test("GM 需要管理金鑰；玩家網址與玩家連線都拿不到金鑰", async (t) => {
  const env = await startServer(t);
  const noKey = env.client({ role: "gm" });
  await noKey.open();
  const denied = await noKey.hello();
  assert.equal(denied.ok, false);
  assert.equal(denied.code, "gm-key-required");

  const wrongKey = env.client({ role: "gm", adminKey: "WRONG-KEY" });
  await wrongKey.open();
  assert.equal((await wrongKey.hello()).code, "gm-key-invalid");

  const gm = await env.connect({ role: "gm", adminKey: ADMIN_KEY.toLowerCase().replace(/-/g, " ") });
  assert.equal(gm.auth.role, "gm");
  assert.equal(gm.auth.adminKey, undefined, "已提供金鑰的 GM 不需要再收到金鑰");

  const player = await env.connect({ role: "player" });
  assert.equal(player.auth.role, "player");
  assert.equal(player.auth.adminKey, undefined);
});

test("GM 筆電本機開啟時自動取得 GM 權限與金鑰", async (t) => {
  const env = await startServer(t, { trustLocalGm: true });
  const gm = await env.connect({ role: "gm" });
  assert.equal(gm.auth.role, "gm");
  assert.equal(gm.auth.adminKey, ADMIN_KEY);
  const player = await env.connect({ role: "player" });
  assert.equal(player.auth.adminKey, undefined);
});

test("玩家不能執行 GM 專用操作，也不能偽造 GM 身分", async (t) => {
  const { connect } = await setupRoom(t);
  const player = await connect({ role: "player" });
  for (const [op, payload] of [
    ["saveMapAndFog", { map: { hash: MAP_IMAGE.hash, width: 800, height: 600 }, fog: fog("e1") }],
    ["saveFogState", { fog: fog("e2") }],
    ["appendFogBatch", { epoch: "e1", seq: 1, strokes: [] }],
    ["sendGridSettings", { grid: { enabled: true } }],
    ["sendInitiativeState", { state: { entries: [] } }],
    ["clearRoomState", {}],
    ["deleteImages", { hashes: [MAP_IMAGE.hash] }]
  ]) {
    const ack = await player.op(op, { ...payload, sourceRole: "gm", role: "gm" });
    assert.equal(ack.ok, false, op);
    assert.equal(ack.code, "forbidden", op);
  }
  const mapUpload = await player.op("putImage", { hash: MAP_IMAGE.hash, dataUrl: MAP_IMAGE.dataUrl, kind: "map" });
  assert.equal(mapUpload.code, "forbidden");
});

test("token 跨連線同步：鎖定、解鎖、玩家移動、禁止欄位與同時移動不同 token", async (t) => {
  const { gm, connect } = await setupRoom(t);
  const p1 = await connect({ role: "player" });
  const p2 = await connect({ role: "player" });

  assert.equal((await gmAddToken(gm, token("tokA", { locked: true }))).ok, true);
  const added = await p1.waitFor((m) => m.t === "tokenAdd" && m.token.id === "tokA");
  assert.equal(added.token.locked, true);
  assert.equal(added.sourceRole, "gm");

  // 鎖定的 token：玩家移動被拒，並收到伺服器的權威版本。
  const denied = await p1.op("updateToken", { tokenId: "tokA", changes: { x: 500 } });
  assert.equal(denied.code, "forbidden");
  const correction = await p1.waitFor((m) => m.t === "token" && m.tokenId === "tokA");
  assert.equal(correction.token.x, 100);
  assert.equal(correction.sourceRole, "server");
  assert.ok(await p2.expectNone((m) => m.t === "tokenPatch"));

  // 解鎖後玩家可以移動，GM 與其他玩家都收到；只送有變的欄位。
  await gm.op("updateToken", { tokenId: "tokA", changes: { locked: false } });
  await p1.waitFor((m) => m.t === "tokenPatch" && m.changes.locked === false);
  assert.equal((await p1.op("updateToken", { tokenId: "tokA", changes: { x: 321, y: 123 } })).ok, true);
  const gmPatch = await gm.waitFor((m) => m.t === "tokenPatch" && m.changes.x === 321);
  assert.deepEqual(gmPatch.changes, { x: 321, y: 123 });
  assert.equal(gmPatch.sourceRole, "player");
  await p2.waitFor((m) => m.t === "tokenPatch" && m.changes.x === 321);

  // 玩家不能改名稱、鎖定或可見度，偽造 sourceRole 也沒用。
  const forged = await p1.op("updateToken", { tokenId: "tokA", changes: { name: "hack", locked: true, visible: false, size: 200 }, sourceRole: "gm" });
  assert.equal(forged.ok, true, "允許的大小欄位仍會套用");
  const forgedPatch = await gm.waitFor((m) => m.t === "tokenPatch" && m.changes.size === 200);
  assert.deepEqual(forgedPatch.changes, { size: 200 });
  const forgedCorrection = await p1.waitFor((m) => m.t === "token" && m.token?.size === 200);
  assert.equal(forgedCorrection.token.name, "");
  assert.equal(forgedCorrection.token.locked, false);

  // 同時移動不同 token 不會互相覆蓋。
  await gmAddToken(gm, token("tokB"));
  await p2.waitFor((m) => m.t === "tokenAdd" && m.token.id === "tokB");
  await Promise.all([
    gm.op("updateToken", { tokenId: "tokA", changes: { x: 10, y: 10 } }),
    p2.op("updateToken", { tokenId: "tokB", changes: { x: 20, y: 20 } })
  ]);
  const late = await connect({ role: "player" });
  const tokens = Object.fromEntries(late.welcome.state.tokens.map((entry) => [entry.token.id, entry.token]));
  assert.equal(tokens.tokA.x, 10);
  assert.equal(tokens.tokB.x, 20);
});

test("玩家新增的 token 一律未鎖定，且圖片必須先上傳", async (t) => {
  const { gm, connect } = await setupRoom(t);
  const player = await connect({ role: "player" });
  const missing = await player.op("addToken", { token: token("tokP", { locked: true, name: "fake" }) });
  assert.equal(missing.code, "missing-image");
  await player.waitFor((m) => m.t === "token" && m.tokenId === "tokP" && m.token === null);

  assert.equal((await player.op("putImage", { hash: TOKEN_IMAGE.hash, dataUrl: TOKEN_IMAGE.dataUrl, kind: "token" })).ok, true);
  assert.equal((await player.op("addToken", { token: token("tokP", { locked: true, name: "fake" }) })).ok, true);
  const added = await gm.waitFor((m) => m.t === "tokenAdd" && m.token.id === "tokP");
  assert.equal(added.token.locked, false);
  assert.equal(added.token.name, "");
  assert.equal(added.sourceRole, "player");

  const badHash = makeImage(100);
  const mismatch = await player.op("putImage", { hash: TOKEN_IMAGE.hash.replace(/.$/, "0"), dataUrl: badHash.dataUrl, kind: "token" });
  assert.equal(mismatch.code, "bad-request");
});

test("鎖定後 10 秒寬限內仍接受玩家最後的位置，但不接受大小", async (t) => {
  const { gm, connect } = await setupRoom(t);
  const player = await connect({ role: "player" });
  await gmAddToken(gm, token("tokG"));
  await gm.op("updateToken", { tokenId: "tokG", changes: { locked: true } });
  await player.waitFor((m) => m.t === "tokenPatch" && m.changes.locked === true);
  const move = await player.op("updateToken", { tokenId: "tokG", changes: { x: 777, y: 1 } });
  assert.equal(move.ok, true);
  await gm.waitFor((m) => m.t === "tokenPatch" && m.changes.x === 777);
  const resize = await player.op("updateToken", { tokenId: "tokG", changes: { size: 300 } });
  assert.equal(resize.code, "forbidden");
  const removeLocked = await player.op("removeToken", { tokenId: "tokG" });
  assert.equal(removeLocked.code, "forbidden");
  const restored = await player.waitFor((m) => m.t === "token" && m.tokenId === "tokG" && m.token);
  assert.equal(restored.token.locked, true);
});

test("刪除後遲到的座標與新增不會讓 token 復活", async (t) => {
  const { gm, connect } = await setupRoom(t);
  const player = await connect({ role: "player" });
  await gmAddToken(gm, token("tokD"));
  await player.waitFor((m) => m.t === "tokenAdd" && m.token.id === "tokD");
  assert.equal((await player.op("removeToken", { tokenId: "tokD" })).ok, true);
  await gm.waitFor((m) => m.t === "tokenRemove" && m.tokenId === "tokD");

  const latePatch = await gm.op("updateToken", { tokenId: "tokD", changes: { x: 1 } });
  assert.equal(latePatch.code, "gone");
  const lateAdd = await gm.op("addToken", { token: token("tokD") });
  assert.equal(lateAdd.code, "gone");
  const late = await connect({ role: "player" });
  assert.equal(late.welcome.state.tokens.length, 0);
});

test("迷霧 epoch／seq：中途加入取得完整迷霧，舊 epoch 的擦霧不再套用", async (t) => {
  const { gm, connect } = await setupRoom(t);
  const early = await connect({ role: "player" });
  await gm.op("putImage", { hash: MAP_IMAGE.hash, dataUrl: MAP_IMAGE.dataUrl, kind: "map" });
  assert.equal((await gm.op("saveMapAndFog", { map: { hash: MAP_IMAGE.hash, width: 800, height: 600 }, fog: fog("ep1") })).ok, true);
  await early.waitFor((m) => m.t === "map" && m.map.hash === MAP_IMAGE.hash);
  const strokes = [{ x: 10, y: 10, mode: "erase", brushSize: 50, softBrush: true }, { type: "rect", x: 0, y: 0, width: 20, height: 20, mode: "fill" }];
  assert.equal((await gm.op("appendFogBatch", { epoch: "ep1", seq: 1, strokes })).ok, true);
  assert.equal((await gm.op("appendFogBatch", { epoch: "ep1", seq: 2, strokes })).ok, true);
  const batch = await early.waitFor((m) => m.t === "fogBatch" && m.seq === 2);
  assert.equal(batch.strokes.length, 2);
  // 同一筆重送（例如重連補送）不會重複。
  assert.equal((await gm.op("appendFogBatch", { epoch: "ep1", seq: 2, strokes })).ok, true);

  const late = await connect({ role: "player" });
  assert.equal(late.welcome.state.map.hash, MAP_IMAGE.hash);
  assert.equal(late.welcome.state.fog.epoch, "ep1");
  assert.deepEqual(late.welcome.state.fogBatches.items.map((item) => item.seq), [1, 2]);

  assert.equal((await gm.op("saveFogState", { fog: fog("ep2", { base: "revealed" }) })).ok, true);
  const stale = await gm.op("appendFogBatch", { epoch: "ep1", seq: 3, strokes });
  assert.equal(stale.code, "conflict");
  const after = await connect({ role: "player" });
  assert.equal(after.welcome.state.fog.base, "revealed");
  assert.equal(after.welcome.state.fogBatches.items.length, 0);
});

test("先攻只同步公開名稱與敵友，HP 與先攻值不會送到玩家", async (t) => {
  const { gm, connect } = await setupRoom(t);
  const player = await connect({ role: "player" });
  await gm.op("sendInitiativeState", { state: { entries: [{ id: "e1", name: "哥布林", side: "enemy", hp: "12", initiative: 15 }, { id: "a1", name: "勇者", side: "ally", hp: "-3" }] } });
  const message = await player.waitFor((m) => m.t === "initiative");
  assert.deepEqual(message.initiative, { entries: [{ id: "e1", name: "哥布林", side: "enemy" }, { id: "a1", name: "勇者", side: "ally" }] });
  const late = await connect({ role: "player" });
  assert.ok(!JSON.stringify(late.welcome.state).includes("hp"));
});

test("擲骰的身分與總和由伺服器決定", async (t) => {
  const { gm, connect } = await setupRoom(t);
  const player = await connect({ role: "player" });
  await player.op("diceRoll", { roll: { id: "roll-1", role: "GM", nickname: "阿明", formula: "1d20+2", rolls: [7], modifier: 2, modifierText: "+2", total: 99, createdAt: 1 } });
  const roll = await gm.waitFor((m) => m.t === "dice");
  assert.equal(roll.roll.role, "PL");
  assert.equal(roll.roll.total, 9);
  assert.ok(await player.expectNone((m) => m.t === "dice"), "擲骰者自己不會再收到一次");
});

test("伺服器重新啟動後從硬碟恢復房間（含圖片）", async (t) => {
  const dataDir = makeDataDir();
  const first = await startServer(t, { dataDir, keepData: true });
  const gm = await first.connect({ role: "gm", adminKey: ADMIN_KEY });
  await gm.op("putImage", { hash: MAP_IMAGE.hash, dataUrl: MAP_IMAGE.dataUrl, kind: "map" });
  await gm.op("saveMapAndFog", { map: { hash: MAP_IMAGE.hash, width: 800, height: 600 }, fog: fog("ep1") });
  await gm.op("appendFogBatch", { epoch: "ep1", seq: 1, strokes: [{ x: 1, y: 2, mode: "erase", brushSize: 10 }] });
  await gmAddToken(gm, token("tokS", { locked: true, name: "存檔測試" }));
  await gm.op("sendGridSettings", { grid: { enabled: true, type: "hex", size: 50 } });
  await first.server.close();

  const second = await startServer(t, { dataDir });
  const player = await second.connect({ role: "player" });
  const state = player.welcome.state;
  assert.equal(state.map.hash, MAP_IMAGE.hash);
  assert.equal(state.fogBatches.items.length, 1);
  assert.equal(state.tokens[0].token.name, "存檔測試");
  assert.equal(state.grid.type, "hex");
  const image = await httpGet(second.port, `/lan-api/rooms/testroom/images/${MAP_IMAGE.hash}`);
  assert.equal(image.status, 200);
  assert.equal(image.body, MAP_IMAGE.dataUrl);
});

test("不同 LAN 房間互不干擾", async (t) => {
  const env = await startServer(t);
  const gmA = await env.connect({ room: "roomA", role: "gm", adminKey: ADMIN_KEY });
  const playerB = await env.connect({ room: "roomB", role: "player" });
  await gmAddToken(gmA, token("onlyA"));
  assert.ok(await playerB.expectNone((m) => m.t === "tokenAdd"));
  const lateB = await env.connect({ room: "roomB", role: "player" });
  assert.equal(lateB.welcome.state.tokens.length, 0);
  assert.equal((await httpGet(env.port, `/lan-api/rooms/roomB/images/${TOKEN_IMAGE.hash}`)).status, 404);
  assert.equal((await httpGet(env.port, `/lan-api/rooms/roomA/images/${TOKEN_IMAGE.hash}`)).status, 200);
  // 大小寫不同視為不同房間（Windows 資料夾也不會互相覆蓋）。
  const upper = await env.connect({ room: "ROOMA", role: "player" });
  assert.equal(upper.welcome.state.tokens.length, 0);
});

test("斷線補送：別人改過的目標以伺服器為準，沒人改過才套用", async (t) => {
  const { gm, connect } = await setupRoom(t);
  const player = await connect({ role: "player" });
  await gmAddToken(gm, token("tokR"));
  const addEvent = await player.waitFor((m) => m.t === "tokenAdd" && m.token.id === "tokR");
  const baseRev = addEvent.rev;

  // 玩家「斷線」期間 GM 移動了這個 token；玩家重連後補送舊的修改 → 衝突，收到伺服器版本。
  await gm.op("updateToken", { tokenId: "tokR", changes: { x: 400 } });
  const stale = await player.op("updateToken", { tokenId: "tokR", changes: { x: 5 }, baseRev }, { replay: true });
  assert.equal(stale.code, "conflict");
  const correction = await player.waitFor((m) => m.t === "token" && m.tokenId === "tokR" && m.token?.x === 400);
  assert.equal(correction.sourceRole, "server");

  // 以最新版本為基準的補送可以套用；自己剛改過的目標，連續補送也能套用。
  const latest = correction.rev;
  assert.equal((await player.op("updateToken", { tokenId: "tokR", changes: { x: 6 }, baseRev: latest }, { replay: true })).ok, true);
  assert.equal((await player.op("updateToken", { tokenId: "tokR", changes: { x: 7 }, baseRev: latest }, { replay: true })).ok, true);
  // 沒有任何基準（從沒連上過就做的修改）而伺服器已有別人的版本 → 衝突。
  await gm.op("updateToken", { tokenId: "tokR", changes: { y: 9 } });
  assert.equal((await player.op("updateToken", { tokenId: "tokR", changes: { x: 8 }, baseRev: null }, { replay: true })).code, "conflict");

  // 地圖：GM 斷線期間另一個 GM 換了地圖，舊的換地圖補送被拒並收到更正。
  const otherGm = await connect({ role: "gm", adminKey: ADMIN_KEY });
  await otherGm.op("putImage", { hash: MAP_IMAGE.hash, dataUrl: MAP_IMAGE.dataUrl, kind: "map" });
  await otherGm.op("saveMapAndFog", { map: { hash: MAP_IMAGE.hash, width: 800, height: 600 }, fog: fog("epX") });
  const replayMap = await gm.op("saveMapAndFog", { map: { hash: MAP_IMAGE.hash, width: 801, height: 600 }, fog: fog("epY"), baseRevs: { map: 0, fog: 0 } }, { replay: true });
  assert.equal(replayMap.code, "conflict");
  const mapFix = await gm.waitFor((m) => m.t === "map" && m.correction);
  assert.equal(mapFix.map.width, 800);
});

test("重新整理後補送：驗證過的舊分頁身分視為同一人，原分頁再送一次也只套用一次", async (t) => {
  const { gm, connect } = await setupRoom(t);
  const before = await connect({ role: "player" });
  await gmAddToken(gm, token("tokF"));
  const added = await before.waitFor((m) => m.t === "tokenAdd" && m.token.id === "tokF");
  assert.equal((await before.op("updateToken", { tokenId: "tokF", changes: { x: 11 } })).ok, true);

  // 新分頁帶著舊分頁的身分補送：舊分頁是最後修改者，所以以舊版本為基準的補送仍可套用。
  const reloaded = await connect({ role: "player", resume: { clientId: before.clientId, secret: before.secret } });
  const restoredOp = { tokenId: "tokF", changes: { x: 22 }, baseRev: added.rev };
  assert.equal((await reloaded.op("updateToken", restoredOp, { replay: true, restored: true, opId: "restored-1" })).ok, true);
  assert.equal((await before.op("updateToken", restoredOp, { replay: true, opId: "restored-1" })).duplicate, true);

  // 偽造的舊身分（secret 不對）不會被承認。
  const forged = await connect({ role: "player", resume: { clientId: gm.clientId, secret: "not-the-secret-123" } });
  await gm.op("updateToken", { tokenId: "tokF", changes: { y: 5 } });
  assert.equal((await forged.op("updateToken", { tokenId: "tokF", changes: { x: 99 }, baseRev: 1 }, { replay: true, restored: true })).code, "conflict");
});

test("同一個 opId 重送只會套用一次；重連必須帶同一把 secret", async (t) => {
  const { gm, connect, client } = await setupRoom(t);
  const player = await connect({ role: "player" });
  await gmAddToken(gm, token("tokO"));
  await player.op("removeToken", { tokenId: "tokO" }, { opId: "same-op" });
  const again = await player.op("removeToken", { tokenId: "tokO" }, { opId: "same-op" });
  assert.equal(again.duplicate, true);

  const hijack = client({ role: "player", clientId: player.clientId, secret: "different-secret-123" });
  await hijack.open();
  assert.equal((await hijack.hello()).code, "session");
  const resume = await connect({ role: "player", clientId: player.clientId, secret: player.secret });
  assert.equal(resume.auth.ok, true);
});

test("大型地圖圖片（約 8MB）可上傳並以 HTTP 下載", async (t) => {
  const { gm, port } = await setupRoom(t);
  const big = makeImage(6 * 1000 * 1000, "webp");
  assert.ok(big.dataUrl.length > 7900000);
  const ack = await gm.op("putImage", { hash: big.hash, dataUrl: big.dataUrl, kind: "map" });
  assert.equal(ack.ok, true);
  const download = await httpGet(port, `/lan-api/rooms/testroom/images/${big.hash}`);
  assert.equal(download.status, 200);
  assert.equal(download.body.length, big.dataUrl.length);
  assert.equal(download.body, big.dataUrl);

  const tooBig = makeImage(9600000);
  const rejected = await gm.op("putImage", { hash: tooBig.hash, dataUrl: tooBig.dataUrl, kind: "map" });
  assert.equal(rejected.code, "too-large");
});

test("清除房間：其他畫面收到通知，被清掉的 token 不會被補回；沒人用的圖片才刪", async (t) => {
  const { gm, connect, port } = await setupRoom(t);
  const player = await connect({ role: "player" });
  await gm.op("putImage", { hash: MAP_IMAGE.hash, dataUrl: MAP_IMAGE.dataUrl, kind: "map" });
  await gm.op("saveMapAndFog", { map: { hash: MAP_IMAGE.hash, width: 800, height: 600 }, fog: fog("ep1") });
  await gmAddToken(gm, token("tokC", { locked: true }));
  const unused = makeImage(100);
  await gm.op("putImage", { hash: unused.hash, dataUrl: unused.dataUrl, kind: "token" });
  await gm.op("deleteImages", { hashes: [MAP_IMAGE.hash, TOKEN_IMAGE.hash, unused.hash] });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const index = gm.messages.filter((m) => m.t === "imageIndex").at(-1);
  assert.equal(index.index[unused.hash], undefined, "沒人用的圖片要刪掉");
  assert.ok(index.index[MAP_IMAGE.hash], "地圖還在用，不能刪");
  assert.ok(index.index[TOKEN_IMAGE.hash], "token 還在用，不能刪");

  assert.equal((await gm.op("clearRoomState", {})).ok, true);
  await player.waitFor((m) => m.t === "roomCleared");
  assert.equal((await gm.op("addToken", { token: token("tokC", { locked: true }) })).code, "gone");
  assert.equal((await httpGet(port, `/lan-api/rooms/testroom/images/${MAP_IMAGE.hash}`)).status, 404);
});

test("在線人數與兩個 GM 的提示", async (t) => {
  const { gm, connect } = await setupRoom(t);
  await connect({ role: "player" });
  const p = await gm.waitFor((m) => m.t === "presence" && m.players === 1);
  assert.equal(p.gms, 1);
  const second = await connect({ role: "gm", adminKey: ADMIN_KEY });
  await gm.waitFor((m) => m.t === "presence" && m.gms === 2);
  second.close();
  await gm.waitFor((m) => m.t === "presence" && m.gms === 1 && m.players === 1, 2000, { includePast: false });
});

test("房間名稱與訊息格式驗證", async (t) => {
  const env = await startServer(t);
  for (const room of ["../etc", "a/b", "", "x".repeat(65), "有中文"]) {
    const client = env.client({ room, role: "player" });
    await client.open();
    const auth = await client.hello();
    assert.equal(auth.ok, false, room);
    assert.equal(auth.code, "bad-room", room);
  }
  const player = await env.connect({ role: "player" });
  player.ws.send("not json");
  await player.waitFor((m) => m.t === "error" && m.code === "bad-json");
  const unknown = await player.op("dropDatabase", {});
  assert.equal(unknown.code, "bad-request");
});

test("靜態網頁與 API：只提供網頁檔案，擋下路徑穿越、資料夾與外部網域", async (t) => {
  const { port, connect } = await setupRoom(t);
  assert.equal((await httpGet(port, "/gm.html")).status, 200);
  assert.equal((await httpGet(port, "/")).status, 200);
  assert.equal((await httpGet(port, "/vendor/qrcode.min.js")).status, 200);
  for (const blocked of ["/lan-data/admin-key.txt", "/server/room.js", "/package.json", "/node_modules/ws/package.json", "/.git/config", "/%2e%2e/%2e%2e/windows/win.ini", "/..%5c..%5cwindows%5cwin.ini", "/test/helpers.js"]) {
    const response = await httpGet(port, blocked);
    assert.equal(response.status, 404, blocked);
    assert.ok(!response.body.includes(ADMIN_KEY), blocked);
  }
  assert.equal((await httpGet(port, "/gm.html", { Host: "evil.example.com" })).status, 421);
  const info = await httpGet(port, "/lan-api/info");
  const body = JSON.parse(info.body);
  assert.equal(body.app, "mapfog-lan");
  assert.ok(Array.isArray(body.addresses));
  assert.ok(!info.body.includes(ADMIN_KEY));

  await assert.rejects(() => connect({ role: "player", origin: "http://evil.example.com" }), /403/);
});
