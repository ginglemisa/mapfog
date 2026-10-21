#!/usr/bin/env node
// MapFog LAN 伺服器啟動程式：node lan-server.js [--port 8765] [--data 資料夾] [--admin-key 金鑰] [--no-local-gm]
"use strict";

const path = require("path");
const { createLanServer, getLanAddresses } = require("./server/lan-app");

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => argv[++index];
    if (arg === "--port" || arg === "-p") options.port = Number(next());
    else if (arg === "--host") options.host = next();
    else if (arg === "--data") options.dataDir = next();
    else if (arg === "--admin-key") options.adminKey = next();
    else if (arg === "--allow-host") (options.allowedHosts ||= []).push(next());
    else if (arg === "--no-local-gm") options.trustLocalGm = false;
    else if (arg === "--help" || arg === "-h") options.help = true;
  }
  return options;
}

function printHelp() {
  console.log(`MapFog LAN 伺服器

用法：node lan-server.js [選項]

  --port <數字>        連接埠，預設 8765（或環境變數 MAPFOG_PORT）
  --host <位址>        監聽位址，預設 0.0.0.0（同一個區網的裝置都能連線）
  --data <資料夾>      房間資料存放位置，預設 ./lan-data（或 MAPFOG_DATA_DIR）
  --admin-key <金鑰>   指定 GM 管理金鑰（或 MAPFOG_ADMIN_KEY）；未指定時自動產生並存在資料夾內
  --no-local-gm        GM 筆電本機開啟 gm.html 時也必須輸入管理金鑰
  --allow-host <名稱>  額外允許的網域名稱（預設只接受 IP、localhost 與本機名稱）
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  const port = Number.isFinite(args.port) ? args.port : Number(process.env.MAPFOG_PORT || 8765);
  const server = await createLanServer({
    port,
    host: args.host || process.env.MAPFOG_HOST || "0.0.0.0",
    rootDir: __dirname,
    dataDir: args.dataDir || process.env.MAPFOG_DATA_DIR || path.join(__dirname, "lan-data"),
    adminKey: args.adminKey || process.env.MAPFOG_ADMIN_KEY || undefined,
    trustLocalGm: args.trustLocalGm ?? process.env.MAPFOG_LOCAL_GM !== "0",
    allowedHosts: args.allowedHosts || []
  }).catch((error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`\n無法啟動：連接埠 ${port} 已被其他程式使用（例如 start-server.bat 或另一個 MapFog LAN 伺服器）。`);
      console.error(`請先關掉那個視窗，或改用其他連接埠：node lan-server.js --port 8766\n`);
    } else {
      console.error("\n無法啟動 MapFog LAN 伺服器：", error.message);
    }
    process.exit(1);
  });

  const addresses = getLanAddresses();
  const lines = [
    "",
    "==============================================",
    " MapFog LAN 伺服器已啟動（不需要網際網路）",
    "==============================================",
    "",
    " GM 在這台電腦開啟：",
    `   http://127.0.0.1:${server.port}/gm.html?lanroom=mygame01`,
    ""
  ];
  if (addresses.length) {
    lines.push(" 其他裝置（同一個 Wi-Fi／手機熱點）可用：");
    for (const item of addresses) {
      const note = item.linkLocal ? "（自動位址，通常無法連線）" : item.private ? "" : "（非私有網段）";
      lines.push(`   http://${item.address}:${server.port}/pl.html?lanroom=mygame01   [${item.name}]${note}`);
    }
  } else {
    lines.push(" ⚠ 找不到區網 IPv4 位址：請確認這台電腦已連上 Wi-Fi 分享器或手機熱點。");
  }
  lines.push(
    "",
    ` GM 管理金鑰：${server.adminKey}`,
    "   （GM 用其他裝置開 gm.html 時需要輸入；不要給玩家，也不會出現在玩家 QR Code 裡）",
    ` 房間資料：${server.dataDir}`,
    "",
    " 按 Ctrl+C 停止伺服器（會先把房間資料寫入硬碟）。",
    ""
  );
  console.log(lines.join("\n"));

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log("\n正在儲存房間資料並關閉…");
    server.close().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  process.on("SIGBREAK", stop);
}

main();
