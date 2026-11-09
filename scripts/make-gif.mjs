#!/usr/bin/env node
// make-gif.mjs — zero-runtime-dependency animated GIF generator for docs/demo.html.
//
// Pipeline:
//   1. Launch headless Chrome (CDP over Node's built-in fetch/WebSocket).
//   2. Load the offline dashboard at width 800, let its intro animations settle.
//   3. Scroll a fixed viewport from top -> bottom, capturing one PNG per stop.
//   4. Decode PNGs (node:zlib inflate + un-filter), quantize to a shared <=256
//      color palette (median cut), LZW-compress each frame, and assemble a
//      GIF89a with a Netscape infinite-loop extension.
//   5. Structurally verify the bytes and re-load the GIF in Chrome to prove it
//      decodes/renders.
//
// Only writes docs/demo.gif. Chrome profile + debug PNGs live in a temp dir that
// is removed on exit. No ffmpeg / ImageMagick / gifski.

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { inflateSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function findChrome() {
  const override = process.env.CHROME_PATH;
  if (override && existsSync(override)) return override;
  const candidates = process.platform === 'win32'
    ? ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
       'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
       join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe')]
    : process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
       '/Applications/Chromium.app/Contents/MacOS/Chromium']
    : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable',
       '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  for (const c of candidates) if (c && existsSync(c)) return c;
  throw new Error('Chrome/Chromium not found. Set CHROME_PATH to your browser executable.');
}
const CHROME = findChrome();

const DEMO_HTML = join(ROOT, 'docs', 'demo.html');
const OUT_GIF = join(ROOT, 'docs', 'demo.gif');

// ---- tunables -------------------------------------------------------------
const WIDTH = 800;          // GIF / viewport width
const VIEW_H = 520;         // GIF / viewport height (the scrolling "window")
const SCROLL_FRAMES = 12;   // evenly spaced scroll stops (incl. top & bottom)
const TOP_PAUSE_MS = 750;   // dwell on the hero
const BOTTOM_PAUSE_MS = 850;// dwell on the footer
const STEP_DELAY_MS = 120;  // per-scroll-step delay
const SETTLE_MS = 1900;     // wait for intro animations (gauge 1.1s, countUp .9s)
const PALETTE_COLORS = 256;
const MAX_BYTES = 3 * 1024 * 1024;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => process.stdout.write(a.join(' ') + '\n');

// ---------------------------------------------------------------------------
// PNG decoder (8-bit, non-interlaced; color types 0/2/3/4/6) -> RGBA
// ---------------------------------------------------------------------------
function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  let palette = null, trns = null;
  const idat = [];
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      bitDepth = data[8]; colorType = data[9]; interlace = data[12];
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'tRNS') {
      trns = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8) throw new Error('unsupported PNG bit depth ' + bitDepth);
  if (interlace !== 0) throw new Error('interlaced PNG not supported');
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error('unsupported PNG color type ' + colorType);
  const raw = inflateSync(Buffer.concat(idat));
  const bpp = channels; // bytes per pixel (8-bit)
  const stride = width * bpp;
  const out = Buffer.alloc(height * stride);
  let rp = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[rp++];
    const rowStart = y * stride;
    const prevRowStart = (y - 1) * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[rowStart + x - bpp] : 0;         // left
      const b = y > 0 ? out[prevRowStart + x] : 0;               // up
      const c = (x >= bpp && y > 0) ? out[prevRowStart + x - bpp] : 0; // up-left
      let v = raw[rp + x];
      switch (filter) {
        case 0: break;
        case 1: v = (v + a) & 255; break;
        case 2: v = (v + b) & 255; break;
        case 3: v = (v + ((a + b) >> 1)) & 255; break;
        case 4: v = (v + paeth(a, b, c)) & 255; break;
        default: throw new Error('bad PNG filter ' + filter);
      }
      out[rowStart + x] = v;
    }
    rp += stride;
  }
  // expand to RGBA
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, p = 0; i < width * height; i++, p += 4) {
    if (colorType === 6) {
      rgba[p] = out[i * 4]; rgba[p + 1] = out[i * 4 + 1]; rgba[p + 2] = out[i * 4 + 2]; rgba[p + 3] = out[i * 4 + 3];
    } else if (colorType === 2) {
      rgba[p] = out[i * 3]; rgba[p + 1] = out[i * 3 + 1]; rgba[p + 2] = out[i * 3 + 2]; rgba[p + 3] = 255;
    } else if (colorType === 0) {
      const g = out[i]; rgba[p] = g; rgba[p + 1] = g; rgba[p + 2] = g;
      rgba[p + 3] = (trns && i < trns.length / 2) ? (out[i] === trns.readUInt16BE(i * 2) ? 0 : 255) : 255;
    } else if (colorType === 4) {
      const g = out[i * 2]; rgba[p] = g; rgba[p + 1] = g; rgba[p + 2] = g; rgba[p + 3] = out[i * 2 + 1];
    } else if (colorType === 3) {
      const idx = out[i];
      rgba[p] = palette[idx * 3]; rgba[p + 1] = palette[idx * 3 + 1]; rgba[p + 2] = palette[idx * 3 + 2];
      rgba[p + 3] = (trns && idx < trns.length) ? trns[idx] : 255;
    }
  }
  return { width, height, data: rgba };
}
function paeth(a, b, c) {
  const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
}

// ---------------------------------------------------------------------------
// Median-cut quantization -> global palette (<=256 RGB entries)
// ---------------------------------------------------------------------------
function buildPalette(frames, maxColors) {
  // Histogram into 5-bit/channel buckets, keeping true-color sums + counts so
  // palette entries are accurate averages of the pixels they represent.
  const buckets = new Map(); // key -> {n, r, g, b}
  for (const f of frames) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4 * 3) { // sample every 3rd pixel
      if (d[i + 3] < 128) continue;
      const r = d[i], g = d[i + 1], b = d[i + 2];
      const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
      let e = buckets.get(key);
      if (!e) { e = { n: 0, r: 0, g: 0, b: 0 }; buckets.set(key, e); }
      e.n++; e.r += r; e.g += g; e.b += b;
    }
  }
  // Median cut starts from ONE box holding every sampled color and splits the
  // widest-range box repeatedly until we reach maxColors boxes.
  const mkBox = (colors) => {
    let n = 0, r = 0, g = 0, b = 0;
    for (const c of colors) { n += c.n; r += c.r * c.n; g += c.g * c.n; b += c.b * c.n; }
    return { colors, count: n, r: r / n, g: g / n, b: b / n };
  };
  const allColors = [...buckets.values()].map((e) => ({ r: e.r / e.n, g: e.g / e.n, b: e.b / e.n, n: e.n }));
  let boxes = [mkBox(allColors)];
  // Each box: {colors:[{r,g,b,n}], count}. Split the widest-range box until we
  // have maxColors boxes (or run out of distinct colors).
  const range = (box) => {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (const c of box.colors) {
      if (c.r < rmin) rmin = c.r; if (c.r > rmax) rmax = c.r;
      if (c.g < gmin) gmin = c.g; if (c.g > gmax) gmax = c.g;
      if (c.b < bmin) bmin = c.b; if (c.b > bmax) bmax = c.b;
    }
    return { dr: rmax - rmin, dg: gmax - gmin, db: bmax - bmin };
  };
  while (boxes.length < maxColors) {
    // pick box with greatest (range * count) along its longest channel
    let bi = -1, best = -1, axis = 'r';
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].colors.length < 2) continue;
      const { dr, dg, db } = range(boxes[i]);
      const m = Math.max(dr, dg, db);
      const score = m * Math.log2(boxes[i].count + 1);
      if (m > 0 && score > best) { best = score; bi = i; axis = m === dr ? 'r' : (m === dg ? 'g' : 'b'); }
    }
    if (bi < 0) break;
    const box = boxes[bi];
    box.colors.sort((p, q) => p[axis] - q[axis]);
    const total = box.count;
    let acc = 0, split = 0;
    for (let i = 0; i < box.colors.length; i++) {
      acc += box.colors[i].n;
      if (acc >= total / 2) { split = i; break; }
    }
    split = Math.max(1, Math.min(box.colors.length - 1, split));
    const left = box.colors.slice(0, split);
    const right = box.colors.slice(split);
    boxes.splice(bi, 1, mkBox(left), mkBox(right));
  }
  let pal = boxes.map((b) => [Math.round(b.r), Math.round(b.g), Math.round(b.b)]);
  // GIF color tables must have 2^(N+1) entries; N is the 3-bit size field.
  let size = 2; while (size < pal.length) size <<= 1;
  if (size > 256) size = 256;
  const exp = Math.round(Math.log2(size)) - 1; // GCT/LCT size field (0..7)
  while (pal.length < size) pal.push([0, 0, 0]);
  return { pal, exp, size };
}

// Build a 5-bit/channel lookup table mapping any RGB -> nearest palette index.
function buildLUT(pal) {
  const lut = new Uint8Array(32768);
  for (let key = 0; key < 32768; key++) {
    const r = ((key >> 10) & 31) << 3, g = ((key >> 5) & 31) << 3, b = (key & 31) << 3;
    let best = 0, bd = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const dr = r - pal[i][0], dg = g - pal[i][1], db = b - pal[i][2];
      const d = dr * dr + dg * dg + db * db;
      if (d < bd) { bd = d; best = i; }
    }
    lut[key] = best;
  }
  return lut;
}
function quantize(rgba, lut) {
  const n = rgba.length / 4;
  const idx = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    idx[i] = lut[((rgba[p] >> 3) << 10) | ((rgba[p + 1] >> 3) << 5) | (rgba[p + 2] >> 3)];
  }
  return idx;
}

// ---------------------------------------------------------------------------
// GIF LZW compression (variable code size, LSB-first). Encoder order matches
// the GIF spec / omggif: emit at current size, then bump, then assign.
// ---------------------------------------------------------------------------
function lzwEncode(minCodeSize, indices) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let next = eoi + 1;
  let dict = new Map();
  const out = [];
  let cur = 0, curBits = 0;
  const emit = (code) => {
    cur |= code << curBits;
    curBits += codeSize;
    while (curBits >= 8) { out.push(cur & 255); cur >>>= 8; curBits -= 8; }
  };
  emit(clear);
  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) { prefix = found; continue; }
    emit(prefix);
    if (next === 4096) {
      emit(clear);
      dict = new Map();
      next = eoi + 1;
      codeSize = minCodeSize + 1;
    } else {
      if (next >= (1 << codeSize) && codeSize < 12) codeSize++;
      dict.set(key, next++);
    }
    prefix = k;
  }
  emit(prefix);
  emit(eoi);
  if (curBits > 0) out.push(cur & 255);
  return out;
}

function subBlocks(bytes) {
  const parts = [];
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.subarray ? bytes.subarray(i, i + 255) : bytes.slice(i, i + 255);
    parts.push(Buffer.from([chunk.length]), Buffer.from(chunk));
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

// ---------------------------------------------------------------------------
// GIF89a assembly
// ---------------------------------------------------------------------------
function encodeGIF(frames, palette, delays, width, height) {
  const { pal, exp, size } = palette;
  const lut = buildLUT(pal.slice(0, size));
  const chunks = [];
  // Header
  chunks.push(Buffer.from('GIF89a', 'ascii'));
  // Logical Screen Descriptor
  const lsd = Buffer.alloc(7);
  lsd.writeUInt16LE(width, 0); lsd.writeUInt16LE(height, 2);
  lsd[4] = 0x80 | (7 << 4) | exp; // GCT flag, color res=7, size=exp
  lsd[5] = 0; lsd[6] = 0;
  chunks.push(lsd);
  // Global Color Table
  const gct = Buffer.alloc(size * 3);
  for (let i = 0; i < size; i++) { gct[i * 3] = pal[i][0]; gct[i * 3 + 1] = pal[i][1]; gct[i * 3 + 2] = pal[i][2]; }
  chunks.push(gct);
  // Netscape looping extension (0 = infinite)
  chunks.push(Buffer.from([0x21, 0xFF, 0x0B, ...Buffer.from('NETSCAPE2.0', 'ascii'), 0x03, 0x01, 0x00, 0x00, 0x00]));
  // Frames
  for (let f = 0; f < frames.length; f++) {
    const idx = quantize(frames[f].data, lut);
    const cs = Math.round(delays[f] / 10);
    // Graphic Control Extension: disposal=1 (do not dispose), no transparency
    chunks.push(Buffer.from([0x21, 0xF9, 0x04, 0x04, cs & 255, (cs >> 8) & 255, 0x00, 0x00]));
    // Image Descriptor
    const id = Buffer.alloc(10);
    id[0] = 0x2C; id.writeUInt16LE(0, 1); id.writeUInt16LE(0, 3);
    id.writeUInt16LE(width, 5); id.writeUInt16LE(height, 7); id[9] = 0x00;
    chunks.push(id);
    // LZW min code size + image data
    const minCodeSize = Math.max(2, exp + 1);
    chunks.push(Buffer.from([minCodeSize]));
    chunks.push(subBlocks(lzwEncode(minCodeSize, idx)));
  }
  chunks.push(Buffer.from([0x3B]));
  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Structural GIF parse (verification)
// ---------------------------------------------------------------------------
function parseGIF(buf) {
  const sig = buf.toString('ascii', 0, 6);
  const width = buf.readUInt16LE(6), height = buf.readUInt16LE(8);
  const packed = buf[10];
  const gctSize = (packed & 0x80) ? 2 << (packed & 7) : 0;
  let pos = 13 + gctSize * 3;
  let frames = 0, loop = null, gceDelays = [];
  while (pos < buf.length) {
    const b = buf[pos];
    if (b === 0x3B) break; // trailer
    if (b === 0x21) { // extension
      const label = buf[pos + 1];
      pos += 2;
      if (label === 0xFF) { // application extension
        const appLen = buf[pos];
        const app = buf.toString('ascii', pos + 1, pos + 1 + appLen);
        pos += 1 + appLen;
        // read sub-blocks
        const data = [];
        while (buf[pos] !== 0) { const n = buf[pos]; data.push(...buf.subarray(pos + 1, pos + 1 + n)); pos += 1 + n; }
        pos++; // terminator
        if (app.startsWith('NETSCAPE')) loop = data.length >= 3 ? (data[1] | (data[2] << 8)) : -1;
      } else if (label === 0xF9) { // graphic control
        const n = buf[pos]; const blk = buf.subarray(pos + 1, pos + 1 + n);
        gceDelays.push(blk.readUInt16LE(1));
        pos += 1 + n;
        while (buf[pos] !== 0) { pos += 1 + buf[pos]; }
        pos++;
      } else {
        pos++; // block size
        while (buf[pos] !== 0) { pos += 1 + buf[pos]; }
        pos++;
      }
    } else if (b === 0x2C) { // image descriptor
      frames++;
      const ipacked = buf[pos + 9];
      const lctSize = (ipacked & 0x80) ? 2 << (ipacked & 7) : 0;
      pos += 10;
      if (lctSize) pos += lctSize * 3;
      pos++; // LZW min code size
      while (buf[pos] !== 0) { pos += 1 + buf[pos]; }
      pos++;
    } else {
      throw new Error('unexpected GIF byte 0x' + b.toString(16) + ' at ' + pos);
    }
  }
  return { sig, width, height, frames, loop, gceDelays, bytes: buf.length };
}

// ---------------------------------------------------------------------------
// CDP helpers
// ---------------------------------------------------------------------------
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => resolve(p)); });
    srv.on('error', reject);
  });
}
async function waitForTarget(port, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch { /* not up yet */ }
    await sleep(150);
  }
  throw new Error('Chrome page target never appeared');
}
function connectWS(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const pending = new Map();
    let idc = 0;
    const to = setTimeout(() => reject(new Error('WS open timeout')), 10000);
    ws.addEventListener('message', (ev) => {
      let msg; try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id != null && pending.has(msg.id)) {
        const { res, rej, timer } = pending.get(msg.id);
        pending.delete(msg.id); clearTimeout(timer);
        if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
      }
    });
    ws.addEventListener('open', () => {
      clearTimeout(to);
      resolve({
        send(method, params = {}) {
          return new Promise((res, rej) => {
            const id = ++idc;
            const timer = setTimeout(() => { pending.delete(id); rej(new Error('CDP timeout: ' + method)); }, 20000);
            pending.set(id, { res, rej, timer });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
        close() { try { ws.close(); } catch { /* ignore */ } },
      });
    });
    ws.addEventListener('error', () => { clearTimeout(to); reject(new Error('WS error')); });
  });
}
async function evalJS(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails));
  return r.result.value; // double .result per CDP shape
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const port = await freePort();
  const profile = mkdtempSync(join(tmpdir(), 'gitvitals-gif-'));
  const fileUrl = pathToFileURL(DEMO_HTML).href;
  log(`Launching Chrome (port ${port}) -> ${fileUrl}`);
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-color-profile=srgb',
    `--user-data-dir=${profile}`,
    `--window-size=${WIDTH},${VIEW_H}`,
    fileUrl,
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let chromeErr = '';
  chrome.stderr.on('data', (d) => { chromeErr += d.toString(); });
  chrome.on('error', (e) => { chromeErr += String(e); });

  let cdp;
  try {
    const target = await waitForTarget(port);
    cdp = await connectWS(target.webSocketDebuggerUrl);
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: VIEW_H, deviceScaleFactor: 1, mobile: false,
    });
    // Wait for document complete, then let intro animations finish.
    for (let i = 0; i < 60; i++) {
      const rs = await evalJS(cdp, 'document.readyState');
      if (rs === 'complete') break;
      await sleep(150);
    }
    // Deterministic scrolling + hidden scrollbars.
    await evalJS(cdp, `(() => {
      const s = document.createElement('style');
      s.textContent = 'html{scroll-behavior:auto!important;scrollbar-width:none!important}::-webkit-scrollbar{width:0!important;height:0!important;display:none!important}';
      document.head.appendChild(s);
      document.documentElement.style.scrollBehavior = 'auto';
      return true;
    })()`);
    await sleep(SETTLE_MS);

    const metrics = await evalJS(cdp, `(() => ({
      scrollH: document.documentElement.scrollHeight,
      innerH: window.innerHeight,
      bodyH: document.body.scrollHeight
    }))()`);
    const scrollH = metrics.scrollH;
    const maxY = Math.max(0, scrollH - VIEW_H);
    log(`Page scrollHeight=${scrollH}, viewport=${WIDTH}x${VIEW_H}, maxScrollY=${maxY}`);

    // Build scroll positions: top pause, evenly spaced steps, bottom pause.
    const positions = [];
    for (let i = 0; i < SCROLL_FRAMES; i++) positions.push(Math.round(maxY * i / (SCROLL_FRAMES - 1)));
    const delays = positions.map((_, i) =>
      i === 0 ? TOP_PAUSE_MS : (i === positions.length - 1 ? BOTTOM_PAUSE_MS : STEP_DELAY_MS));

    const frames = [];
    for (let i = 0; i < positions.length; i++) {
      const y = positions[i];
      await evalJS(cdp, `window.scrollTo(0, ${y})`);
      await sleep(140); // allow repaint after instant scroll
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      const png = Buffer.from(shot.data, 'base64');
      const decoded = decodePNG(png);
      if (decoded.width !== WIDTH || decoded.height !== VIEW_H) {
        throw new Error(`unexpected frame size ${decoded.width}x${decoded.height} (want ${WIDTH}x${VIEW_H})`);
      }
      frames.push(decoded);
      if (i === 0) writeFileSync(join(profile, 'frame0.png'), png); // debug, removed with profile
      log(`  frame ${i}: scrollY=${y} delay=${delays[i]}ms png=${png.length}B`);
    }

    // Distinct-frame sanity (scroll must actually change the image).
    const h0 = frames[0].data.subarray(0, 4000).toString('base64');
    const hLast = frames[frames.length - 1].data.subarray(0, 4000).toString('base64');
    if (h0 === hLast) throw new Error('first and last frames identical — scroll did not take effect');

    log('Quantizing + encoding GIF...');
    const palette = buildPalette(frames, PALETTE_COLORS);
    log(`  palette: ${palette.pal.length} used entries, table size ${palette.size} (exp ${palette.exp})`);
    const gif = encodeGIF(frames, palette, delays, WIDTH, VIEW_H);
    writeFileSync(OUT_GIF, gif);

    const info = parseGIF(readFileSync(OUT_GIF));
    log('Structural parse:', JSON.stringify({
      signature: info.sig, width: info.width, height: info.height,
      frames: info.frames, loop: info.loop, delaysCs: info.gceDelays, bytes: info.bytes,
    }));
    if (info.sig !== 'GIF89a') throw new Error('bad GIF signature');
    if (info.frames !== frames.length) throw new Error('frame count mismatch');
    if (info.loop !== 0) throw new Error('missing infinite-loop extension');
    if (info.bytes > MAX_BYTES) log(`WARNING: GIF is ${info.bytes}B (> ${MAX_BYTES}B target). Consider fewer frames / smaller height.`);

    // ---- Chrome decode verification: load the GIF and screenshot it ----
    log('Verifying GIF decodes in Chrome...');
    const gifUrl = pathToFileURL(OUT_GIF).href;
    await cdp.send('Page.navigate', { url: gifUrl });
    for (let i = 0; i < 40; i++) {
      const rs = await evalJS(cdp, 'document.readyState').catch(() => 'loading');
      if (rs === 'complete') break;
      await sleep(120);
    }
    await sleep(400);
    const nat = await evalJS(cdp, `(() => {
      const img = document.querySelector('img');
      return img ? { w: img.naturalWidth, h: img.naturalHeight, complete: img.complete } : null;
    })()`);
    log('  Chrome <img> natural size:', JSON.stringify(nat));
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: WIDTH, height: VIEW_H, deviceScaleFactor: 1, mobile: false,
    });
    const vshot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const vpng = Buffer.from(vshot.data, 'base64');
    writeFileSync(join(profile, 'verify.png'), vpng);
    const vdec = decodePNG(vpng);
    // Count distinct colors in the rendered verification screenshot.
    const seen = new Set();
    for (let i = 0; i < vdec.data.length; i += 4 * 17) {
      seen.add((vdec.data[i] << 16) | (vdec.data[i + 1] << 8) | vdec.data[i + 2]);
      if (seen.size > 500) break;
    }
    log(`  verify render: ${vdec.width}x${vdec.height}, distinct sampled colors=${seen.size}`);
    if (!nat || nat.w !== WIDTH || nat.h !== VIEW_H || !nat.complete) {
      throw new Error('GIF did not decode to expected dimensions in Chrome');
    }
    if (seen.size < 8) throw new Error('GIF rendered blank/near-blank in Chrome (decode failure)');

    // Keep debug images for inspection outside the repo, then clean the profile.
    log(`Debug PNGs written to ${profile} (frame0.png, verify.png)`);
    log(`DONE: ${OUT_GIF} — ${info.frames} frames, ${info.width}x${info.height}, ${info.bytes} bytes (${(info.bytes / 1024).toFixed(1)} KB)`);
    // Move debug images to a stable scratch location before removing profile.
    try {
      const scratch = join(ROOT, '.scratch');
      writeFileSync(join(scratch, 'gif-frame0.png'), readFileSync(join(profile, 'frame0.png')));
      writeFileSync(join(scratch, 'gif-verify.png'), readFileSync(join(profile, 'verify.png')));
    } catch { /* scratch optional */ }
    cdp.close();
  } catch (err) {
    log('ERROR:', err && err.stack ? err.stack : String(err));
    if (chromeErr) log('Chrome stderr (tail):', chromeErr.slice(-1500));
    process.exitCode = 1;
  } finally {
    try { if (cdp) cdp.close(); } catch { /* ignore */ }
    try { chrome.kill(); } catch { /* ignore */ }
    // Give Chrome a moment to exit, then remove the temp profile.
    await sleep(300);
    try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

main();