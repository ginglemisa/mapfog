// 與 image-store.js 相同的圖片雜湊：伺服器用它確認上傳的圖片內容與雜湊相符。
"use strict";

function cyrb53(text, seed) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function hashDataUrl(dataUrl) {
  const text = String(dataUrl || "");
  return `${cyrb53(text, 1).toString(36).padStart(11, "0")}${cyrb53(text, 0x9e3779b1).toString(36).padStart(11, "0")}`;
}

module.exports = { hashDataUrl };
