// Reliable printing: clone the on-screen receipt into a dedicated #print-root
// container and print only that, instead of fighting with visibility tricks
// inside fixed/overlay modals (which often print blank).
import JsBarcode from 'jsbarcode';

export function printReceipt() {
  const src = document.getElementById('receipt');
  const dest = document.getElementById('print-root');
  if (src && dest) {
    dest.innerHTML = src.innerHTML;
    window.print();
  } else {
    window.print();
  }
}

// ---- Barcode labels ----
// A label = { name, price, code, mrp?, copies? }. `price` may be a number
// (formatted with `pricePrefix`) or an already-formatted string.
// Options: { size, copies, showName, showPrice, showCode, showMrp,
//            pricePrefix, incrementCode }

export const LABEL_SIZES = {
  '58x27': { w: 58, h: 27, pad: 2, padX: 1, name: 9, price: 10, code: 7, bar: 11 },
  '40x25': { w: 40, h: 25, pad: 1.5, padX: 1, name: 7, price: 9, code: 6, bar: 9 },
  '60x40': { w: 60, h: 40, pad: 2, padX: 1, name: 11, price: 13, code: 9, bar: 16 },
  '100x50': { w: 100, h: 50, pad: 3, padX: 2, name: 14, price: 18, code: 12, bar: 20 },
};

export const DEFAULT_LABEL_OPTIONS = {
  size: '58x27',
  copies: 1,
  showName: true,
  showPrice: true,
  showCode: false,
  showMrp: false,
  pricePrefix: 'Rs ',
  incrementCode: false,
};

export function labelOptions(patch) {
  const size = LABEL_SIZES[patch?.size] ? patch.size : DEFAULT_LABEL_OPTIONS.size;
  return { ...DEFAULT_LABEL_OPTIONS, ...(patch || {}), size };
}

function formatMoney(value, prefix) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value || '');
  return `${prefix}${n.toFixed(2)}`;
}

// Increments the trailing digits of a numeric barcode (8901234567890 -> ...891)
// so a run of labels can carry unique serial numbers. Non-numeric codes and
// codes that would overflow are left untouched.
function bumpCode(code, step) {
  const s = String(code || '');
  const m = s.match(/(\d+)(\D*)$/);
  if (!m) return s;
  const digits = m[1];
  const next = (BigInt(digits) + BigInt(step)).toString();
  if (next.length > digits.length) return s;
  return s.slice(0, s.length - m[2].length - digits.length) + next + m[2];
}

// Flattens label definitions into one entry per physical label, applying the
// copy count and (optionally) sequential barcode numbering.
export function expandLabels(items, options) {
  const opts = labelOptions(options);
  const out = [];
  (items || []).forEach((it) => {
    const copies = Math.max(1, Number(it.copies ?? opts.copies) || 1);
    for (let i = 0; i < copies; i++) {
      const code = opts.incrementCode ? bumpCode(it.code, i) : String(it.code || '');
      out.push({
        name: it.name,
        price: typeof it.price === 'number' ? formatMoney(it.price, opts.pricePrefix) : it.price,
        mrp: it.mrp,
        code,
      });
    }
  });
  return out;
}

function barcodeSvg(code) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  if (!code) return '';
  try {
    JsBarcode(svg, String(code), {
      format: 'CODE128',
      width: 1,
      height: 32,
      fontSize: 8,
      displayValue: false,
      margin: 0,
    });
  } catch {
    return '';
  }
  return svg.outerHTML;
}

// CSS for a label sheet. `scope` prefixes every selector so the same markup
// can be rendered both into #print-root (printing) and into an on-screen
// preview without the styles leaking into the app.
export function labelSheetCss(sizeKey, scope = '') {
  const size = LABEL_SIZES[sizeKey] || LABEL_SIZES[DEFAULT_LABEL_OPTIONS.size];
  const s = scope ? `${scope} ` : '';
  return `
    ${s}.label-sheet { display: flex; flex-wrap: wrap; gap: 4px; }
    ${s}.plabel {
      width: ${size.w}mm; height: ${size.h}mm; border: 1px solid #999; border-radius: 2px;
      padding: ${size.pad}mm ${size.padX}mm; text-align: center; font-family: Arial, sans-serif;
      display: flex; flex-direction: column; align-items: center; justify-content: space-between;
      background: #fff; color: #000; box-sizing: border-box; overflow: hidden;
    }
    ${s}.plabel .pname { font-size: ${size.name}px; font-weight: bold; line-height: 1.1; overflow: hidden; max-height: ${size.name * 2.2}px; }
    ${s}.plabel .pcode { font-size: ${size.code}px; color: #333; letter-spacing: 0.5px; }
    ${s}.plabel .pprice { font-size: ${size.price}px; font-weight: bold; }
    ${s}.plabel .pmrp { font-size: ${Math.max(6, size.price - 3)}px; color: #444; text-decoration: line-through; }
    ${s}.plabel svg { max-width: 100%; height: ${size.bar}mm; }
  `;
}

// Builds the full sheet (style tag + labels). Reused by the on-screen preview
// so what you see is exactly what prints.
export function buildLabelSheet(items, options, scope = '') {
  const opts = labelOptions(options);
  const labels = expandLabels(items, opts);
  const body = labels
    .map(
      (l) => `<div class="plabel">
        ${opts.showName ? `<div class="pname">${escapeHtml(l.name)}</div>` : ''}
        ${barcodeSvg(l.code)}
        ${opts.showCode ? `<div class="pcode">${escapeHtml(l.code)}</div>` : ''}
        ${opts.showMrp && l.mrp ? `<div class="pmrp">${escapeHtml(formatMoney(l.mrp, opts.pricePrefix))}</div>` : ''}
        ${opts.showPrice ? `<div class="pprice">${escapeHtml(l.price)}</div>` : ''}
      </div>`
    )
    .join('');
  return {
    html: `<style>${labelSheetCss(opts.size, scope)}</style><div class="label-sheet">${body}</div>`,
    total: labels.length,
  };
}

export function printLabels(items, options) {
  const dest = document.getElementById('print-root');
  if (!dest) return 0;
  const { html, total } = buildLabelSheet(items, options);
  if (!total) return 0;
  dest.innerHTML = html;
  window.print();
  return total;
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}