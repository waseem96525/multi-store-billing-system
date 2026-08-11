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
export function printLabels(items) {
  const dest = document.getElementById('print-root');
  if (!dest) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  const width = 58;
  const height = 27;
  dest.innerHTML = `
    <style>
      .label-sheet { display: flex; flex-wrap: wrap; gap: 4px; }
      .plabel {
        width: 58mm; height: 27mm; border: 1px solid #999; border-radius: 2px;
        padding: 2mm 1mm; text-align: center; font-family: Arial, sans-serif;
        display: flex; flex-direction: column; align-items: center; justify-content: space-between;
      }
      .plabel .pname { font-size: 9px; font-weight: bold; line-height: 1.1; overflow: hidden; }
      .plabel .pprice { font-size: 10px; font-weight: bold; }
      .plabel svg { max-width: 100%; height: 11mm; }
    </style>
    <div class="label-sheet">${items
      .map((it) => {
        svg.setAttribute('width', '');
        svg.setAttribute('height', '');
        svg.innerHTML = '';
        try {
          JsBarcode(svg, it.code, { format: 'CODE128', width: 1, height: 32, fontSize: 8, displayValue: false });
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
                <div class="pprice">${escapeHtml(it.price)}</div>
              </div>`
          )
          .join('');
      })
      .join('')}</div>`;
  window.print();
}

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
