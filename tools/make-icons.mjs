// tools/make-icons.mjs：產生 icons/ 底下三張不透明的 PNG（規格 8.3、9.5）。只在換圖示時執行，產物要 commit。
// 執行：npm run icons（需要 Node 22.2 以上，zlib.crc32 從這版才有）
import { deflateSync, crc32 } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SIZES = [180, 192, 512];
const BG = [0x1e, 0x3a, 0x5f];       // #1e3a5f 深藍底
const LINE = [0xff, 0xff, 0xff];     // 白色橫線
const CURSOR = [0x7f, 0xb2, 0xe5];   // #7fb2e5 淺藍游標

// 點 (px, py) 是否落在左上 (x0, y0)、右下 (x1, y1)、圓角半徑 r 的圓角矩形內
function inRoundRect(px, py, x0, y0, x1, y1, r) {
  if (px < x0 || px >= x1 || py < y0 || py >= y1) return false;
  const cx = Math.min(Math.max(px, x0 + r), x1 - r);   // 離 (px, py) 最近的圓角圓心
  const cy = Math.min(Math.max(py, y0 + r), y1 - r);
  return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
}

// 邊長 S 的圖示上，點 (px, py) 的顏色；幾何尺寸照 8.3
function colorAt(px, py, S) {
  const h = 0.08 * S;                                   // 線高
  const r = 0.04 * S;                                   // 圓角半徑
  const left = 0.2 * S;                                 // 三條線的左端
  const lines = [[0.36 * S, 0.6 * S], [0.5 * S, 0.5 * S], [0.64 * S, 0.32 * S]];   // [中心 y, 含圓角的長度]
  for (const [cy, len] of lines) {
    if (inRoundRect(px, py, left, cy - h / 2, left + len, cy + h / 2, r)) return LINE;
  }
  const [cy3, len3] = lines[2];
  const x0 = left + len3 + 0.04 * S;                    // 游標左端距第三條線右端 0.04S
  const y0 = cy3 - 0.08 * S;                            // 游標高 0.16S，垂直置中於第三條線
  if (px >= x0 && px < x0 + 0.04 * S && py >= y0 && py < y0 + 0.16 * S) return CURSOR;
  return BG;
}

// 一個 PNG chunk：長度、類型、資料、CRC32（涵蓋類型與資料）
function chunk(type, data) {
  const typed = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typed));
  return Buffer.concat([len, typed, crc]);
}

function png(S) {
  const stride = 1 + 3 * S;                             // 每列：filter byte 0 加上 S 個 RGB 像素
  const raw = Buffer.alloc(stride * S);
  for (let y = 0; y < S; y++) {
    raw[y * stride] = 0;
    for (let x = 0; x < S; x++) {
      const [r, g, b] = colorAt(x + 0.5, y + 0.5, S);   // 以像素中心判斷，不做反鋸齒
      const i = y * stride + 1 + 3 * x;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(S, 0);                             // 寬
  ihdr.writeUInt32BE(S, 4);                             // 高
  ihdr[8] = 8;                                          // bit depth 8
  ihdr[9] = 2;                                          // 色彩型態 2：RGB，不帶 alpha
  ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;             // 壓縮、filter、interlace 都用預設
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(join(ROOT, 'icons'), { recursive: true });
for (const S of SIZES) {
  writeFileSync(join(ROOT, 'icons', 'icon-' + S + '.png'), png(S));
  console.log('icons/icon-' + S + '.png');
}
