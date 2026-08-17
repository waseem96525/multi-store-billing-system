// USB barcode/label printer via the Web Serial API (ESC/POS raster graphics).
//
// Works on Chromium browsers (Chrome/Edge) over HTTPS or localhost. The user
// picks the serial device once with requestPort(); we remember the grant and
// reconnect automatically next session with getPorts(). Labels are rendered
// to a canvas (product name, CODE128 barcode, price) and sent as 1-bit raster
// bitmaps, so any ESC/POS thermal/label printer can print them regardless of
// its character-code page.
import JsBarcode from 'jsbarcode';

const CFG_KEY = 'barcodePrinter.cfg';
const REMEMBER_KEY = 'barcodePrinter.remembered';

const defaults = { baud: 9600, width: 384, autoUse: true };

function loadConfig() {
  try {
    return { ...defaults, ...(JSON.parse(localStorage.getItem(CFG_KEY)) || {}) };
  } catch {
    return { ...defaults };
  }
}

function saveConfig(cfg) {
  localStorage.setItem(CFG_KEY, JSON.stringify(cfg));
}

export function isSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

let port = null;
let writer = null;
const listeners = new Set();
let writeChain = Promise.resolve();

function getStatus() {
  let name = 'USB Printer';
  if (port) {
    const info = port.getInfo ? port.getInfo() : {};
    if (info.usbVendorId || info.usbProductId) {
      name = `USB ${info.usbVendorId ? '0x' + info.usbVendorId.toString(16) : ''}`;
      if (info.usbProductId) name += `:0x${info.usbProductId.toString(16)}`;
    }
    if (port.device && port.device.productName) name = port.device.productName;
  }
  return { supported: isSupported(), connected: !!port, portName: port ? name : 'Not connected' };
}

function emit() {
  const s = getStatus();
  listeners.forEach((fn) => fn(s));
}

export function subscribe(cb) {
  listeners.add(cb);
  cb(getStatus());
  return () => listeners.delete(cb);
}

export function getConfig() {
  return loadConfig();
}

export function setConfig(patch) {
  const cfg = { ...loadConfig(), ...patch };
  saveConfig(cfg);
  return cfg;
}

export async function connect() {
  if (!isSupported()) throw new Error('Web Serial is not supported in this browser');
  if (!port) {
    port = await navigator.serial.requestPort();
  }
  const cfg = loadConfig();
  await port.open({ baudRate: Number(cfg.baud) || 9600 });
  writer = port.writable.getWriter();
  localStorage.setItem(REMEMBER_KEY, '1');
  if (port.readable) {
    // Drain the input so it does not back up; ignore incoming data.
    port.readable.pipeTo(new WritableStream({ write() {} })).catch(() => {});
  }
  // Reflect disconnects (e.g. cable pulled) without throwing on next print.
  port.addEventListener('disconnect', () => {
    port = null;
    writer = null;
    emit();
  });
  emit();
}

export async function disconnect() {
  try {
    if (writer) {
      writer.releaseLock();
      writer = null;
    }
    if (port) {
      await port.close().catch(() => {});
      port = null;
    }
  } finally {
    localStorage.removeItem(REMEMBER_KEY);
    emit();
  }
}

// Reconnect a previously granted port without prompting (Chrome keeps the grant).
export async function tryAutoConnect() {
  if (!isSupported() || port) return;
  try {
    const ports = await navigator.serial.getPorts();
    if (!ports.length) return;
    port = ports[0];
    const cfg = loadConfig();
    await port.open({ baudRate: Number(cfg.baud) || 9600 });
    writer = port.writable.getWriter();
    port.addEventListener('disconnect', () => {
      port = null;
      writer = null;
      emit();
    });
    emit();
  } catch {
    port = null;
    writer = null;
  }
}

export function isConnected() {
  return !!port && !!writer;
}

// ---- ESC/POS helpers ----

function textLineBitmap(text, fontPx, height, width) {
  const c = document.createElement('canvas');
  c.width = width;
  c.height = height;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${fontPx}px Arial, sans-serif`;
  const safe = String(text || '').slice(0, 64);
  if (safe) ctx.fillText(safe, width / 2, height / 2 + 1);
  return c;
}

function barcodeBitmap(code, width) {
  const tmp = document.createElement('canvas');
  try {
    JsBarcode(tmp, String(code || ''), {
      format: 'CODE128',
      displayValue: true,
      fontSize: 14,
      margin: 4,
      width: 2,
      height: 60,
      lineColor: '#000',
      background: '#fff',
    });
  } catch {
    return null;
  }
  const c = document.createElement('canvas');
  c.width = width;
  const h = Math.max(20, Math.round(tmp.height * (width / Math.max(1, tmp.width))));
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, h);
  ctx.drawImage(tmp, 0, 0, width, h);
  return c;
}

function canvasToRaster(canvas) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const img = ctx.getImageData(0, 0, W, H).data;
  const rowBytes = Math.ceil(W / 8);
  const out = new Uint8Array(rowBytes * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const lum = (img[i] + img[i + 1] + img[i + 2]) / 3;
      if (lum < 128) out[y * rowBytes + (x >> 3)] |= 0x80 >> (x & 7);
    }
  }
  return { rowBytes, W, H, out };
}

function rasterCommand(canvas) {
  const { rowBytes, H, out } = canvasToRaster(canvas);
  const head = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    rowBytes & 0xff, (rowBytes >> 8) & 0xff,
    H & 0xff, (H >> 8) & 0xff,
  ]);
  const full = new Uint8Array(head.length + out.length);
  full.set(head, 0);
  full.set(out, head.length);
  return full;
}

// Build the ESC/POS byte stream for one label.
function buildLabel(product, opts) {
  const width = opts.width || 384;
  const name = textLineBitmap(product.name, 18, 26, width);
  const bc = barcodeBitmap(product.code, width);
  const price = textLineBitmap(product.price, 20, 26, width);
  const parts = [name];
  if (bc) parts.push(bc);
  parts.push(price);
  const totalH = parts.reduce((h, c) => h + c.height, 0);
  const sheet = document.createElement('canvas');
  sheet.width = width;
  sheet.height = totalH;
  const sctx = sheet.getContext('2d');
  sctx.fillStyle = '#fff';
  sctx.fillRect(0, 0, width, totalH);
  let y = 0;
  for (const c of parts) {
    sctx.drawImage(c, 0, y);
    y += c.height;
  }
  const init = new Uint8Array([0x1b, 0x40]); // ESC @
  const center = new Uint8Array([0x1b, 0x61, 0x01]); // ESC a 1
  const feed = new Uint8Array([0x1b, 0x64, 0x03]); // ESC d 3 (feed 3 lines)
  const cut = new Uint8Array([0x1d, 0x56, 0x01]); // GS V 1 (partial cut)
  const chunks = [init, center, rasterCommand(sheet), feed, cut];
  return chunks.reduce((acc, c) => {
    const merged = new Uint8Array(acc.length + c.length);
    merged.set(acc, 0);
    merged.set(c, acc.length);
    return merged;
  }, new Uint8Array(0));
}

function writeBytes(bytes) {
  writeChain = writeChain.then(async () => {
    if (!writer) throw new Error('Printer not connected');
    // Write in chunks to stay within the serial write limit.
    let off = 0;
    while (off < bytes.length) {
      const chunk = bytes.subarray(off, off + 1024);
      await writer.write(chunk);
      off += chunk.length;
    }
  });
  return writeChain;
}

// items: [{ name, price, code, copies }]
export async function printLabels(items, opts = {}) {
  const cfg = { ...loadConfig(), ...opts };
  if (!isConnected()) throw new Error('Printer not connected');
  const width = Math.round((cfg.width || 384) / 8) * 8;
  for (const it of items) {
    const copies = Math.max(1, Number(it.copies) || 1);
    const product = {
      name: it.name,
      price: it.price,
      code: it.code || String(it.id || ''),
    };
    const bytes = buildLabel(product, { width });
    for (let i = 0; i < copies; i++) await writeBytes(bytes);
  }
  await writeChain;
  return items.length;
}

export async function printTestLabel() {
  return printLabels([
    { name: 'TEST LABEL', price: 'Rs 0.00', code: 'TEST12345', copies: 1 },
  ]);
}
