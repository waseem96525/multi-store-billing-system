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

// Renders barcode labels (one per product, repeated `copies` times) into
// #print-root and prints them. `items` = [{ name, price, code, copies }]
// Options: { size: '58x27' | '40x25' | '60x40' | '100x50', showCode: bool }
export function printLabels(items, options = {}) {
  const dest = document.getElementById('print-root');
  if (!dest) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const size = SIZES[options.size] || SIZES['58x27'];
  const showCode = !!options.showCode;
  dest.innerHTML = `
    <style>
      .label-sheet { display: flex; flex-wrap: wrap; gap: 4px; }
      .plabel {
        width: ${size.w}mm; height: ${size.h}mm; border: 1px solid #999; border-radius: 2px;
        padding: ${size.pad}mm ${size.padX}mm; text-align: center; font-family: Arial, sans-serif;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
      }
      .plabel .pname { font-size: ${size.name}px; font-weight: bold; line-height: 1.1; overflow: hidden; max-height: ${size.name * 2.2}px; }
      .plabel .pcode { font-size: ${size.code}px; color: #333; letter-spacing: 0.5px; }
      .plabel .pprice { font-size: ${size.price}px; font-weight: bold; }
      .plabel svg { max-width: 100%; height: ${size.bar}mm; }
    </style>
    <div class="label-sheet">${items
      .map((it) => {
        svg.setAttribute('width', '');
        svg.setAttribute('height', '');
        svg.innerHTML = '';
        try {
          JsBarcode(svg, String(it.code || ''), {
            format: 'CODE128',
            width: 1,
            height: 32,
            fontSize: 8,
            displayValue: false,
            margin: 0,
          });
        } catch {
          /* keep empty svg */
        }
        const svgHtml = svg.outerHTML;
        return Array.from({ length: it.copies || 1 })
          .map(
            () =>
              `<div class="plabel">
                <div class="pname">${escapeHtml(it.name)}</div>
                ${svgHtml}
                ${showCode ? `<div class="pcode">${escapeHtml(it.code || '')}</div>` : ''}
                <div class="pprice">${escapeHtml(it.price)}</div>
              </div>`
          )
          .join('');
      })
      .join('')}</div>`;
  window.print();
}

const SIZES = {
  '58x27': { w: 58, h: 27, pad: 2, padX: 1, name: 9, price: 10, code: 7, bar: 11 },
  '40x25': { w: 40, h: 25, pad: 1.5, padX: 1, name: 7, price: 9, code: 6, bar: 9 },
  '60x40': { w: 60, h: 40, pad: 2, padX: 1, name: 11, price: 13, code: 9, bar: 16 },
  '100x50': { w: 100, h: 50, pad: 3, padX: 2, name: 14, price: 18, code: 12, bar: 20 },
};

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
