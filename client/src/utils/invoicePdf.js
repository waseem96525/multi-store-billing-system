// A4 invoice PDF generation (jsPDF) + share/download helpers.
import { jsPDF } from 'jspdf';

const fmt = (n) => `₹${Number(n || 0).toFixed(2)}`;

export function buildInvoicePdf({ store = {}, invoice = {}, items = [], customer = null, cashier = null }) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 15;
  const CW = W - M * 2;
  let y = 18;

  doc.setFillColor(15, 23, 42);
  doc.rect(0, 0, W, 4, 'F');

  // Store header
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(store.name || 'RETAIL SHOP', W / 2, y, { align: 'center' });
  y += 5.5;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(100);
  if (store.address) {
    doc.text(store.address, W / 2, y, { align: 'center' });
    y += 4;
  }
  if (store.phone) {
    doc.text(`Ph: ${store.phone}`, W / 2, y, { align: 'center' });
    y += 4;
  }
  if (store.gstin) {
    doc.text(`GSTIN: ${store.gstin}`, W / 2, y, { align: 'center' });
    y += 4;
  }
  doc.setTextColor(0);
  y += 3;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.text('TAX INVOICE', W / 2, y, { align: 'center' });
  y += 8;
  doc.line(M, y - 4, W - M, y - 4);

  // Meta block: left = invoice info, right = customer
  doc.setFontSize(9.5);
  doc.setFont('helvetica', 'normal');
  const leftRows = [
    ['Invoice No', invoice.invoice_no || '-'],
    ['Date', invoice.created_at ? new Date(invoice.created_at).toLocaleString() : '-'],
    ['Cashier', cashier?.name || '-'],
  ];
  const rightRows = customer
    ? [
        ['Customer', customer.name || '-'],
        ['Phone', customer.phone || '-'],
        ['Email', customer.email || '-'],
      ]
    : [];
  const drawMeta = (rows, x) => {
    let yy = y;
    for (const [k, v] of rows) {
      doc.setFont('helvetica', 'bold');
      doc.text(`${k}:`, x, yy);
      const kw = doc.getTextWidth(`${k}:`) + 2;
      doc.setFont('helvetica', 'normal');
      const wrapped = doc.splitTextToSize(String(v || '-'), CW / 2 - kw);
      doc.text(wrapped, x + kw, yy);
      yy += Math.max(4.5, wrapped.length * 4.5);
    }
    return yy;
  };
  const leftEnd = drawMeta(leftRows, M);
  const rightEnd = rightRows.length ? drawMeta(rightRows, W / 2 + 2) : y;
  y = Math.max(leftEnd, rightEnd) + 3;

  if (invoice.status === 'credit') {
    doc.setTextColor(180, 83, 9);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.text(
      `CREDIT SALE - Balance due: ${fmt((invoice.grand_total || 0) - (invoice.amount_paid || 0))}`,
      W / 2,
      y,
      { align: 'center' }
    );
    doc.setTextColor(0);
    y += 5;
  }
  y += 2;

  // Items table
  const cols = [
    { label: '#', w: 8, align: 'left' },
    { label: 'Item', w: 74, align: 'left' },
    { label: 'Qty', w: 14, align: 'right' },
    { label: 'Price', w: 22, align: 'right' },
    { label: 'Disc', w: 18, align: 'right' },
    { label: 'Tax', w: 16, align: 'right' },
    { label: 'Total', w: 24, align: 'right' },
  ];
  const rowH = 7;
  const drawRow = (cells, x, yy, bold, fill) => {
    if (fill) {
      doc.setFillColor(241, 245, 249);
      doc.rect(x, yy - 4.5, CW, rowH, 'F');
    }
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    let cx = x;
    cells.forEach((c, i) => {
      const col = cols[i];
      doc.text(String(c), cx + (col.align === 'right' ? col.w : 1), yy, {
        align: col.align === 'right' ? 'right' : 'left',
      });
      cx += col.w;
    });
  };

  doc.setFillColor(15, 23, 42);
  doc.rect(M, y - 4.5, CW, rowH, 'F');
  doc.setTextColor(255);
  drawRow(cols.map((c) => c.label), M, y, true);
  doc.setTextColor(0);
  y += rowH;

  const rows = (items || []).map((it, i) => ({
    cells: [
      i + 1,
      '',
      it.qty,
      fmt(it.unit_price),
      it.discount ? fmt(it.discount) : '-',
      it.tax_percent != null ? `${it.tax_percent}%` : '-',
      fmt(it.line_total),
    ],
    name: it.product_name || 'Item',
  }));

  for (const r of rows) {
    if (y > 275) {
      doc.addPage();
      y = 20;
    }
    const nameLines = doc.splitTextToSize(r.name, cols[1].w - 2);
    const h = Math.max(rowH, nameLines.length * 4.5 + 1);
    drawRow(r.cells.map((c, i) => (i === 1 ? '' : c)), M, y + 2.5, false, y % 2 === 0 ? false : false);
    doc.setFont('helvetica', 'normal');
    doc.text(nameLines, M + cols[0].w + 1, y + 2.5);
    doc.setDrawColor(226, 232, 240);
    doc.line(M, y + h - 2, W - M, y + h - 2);
    y += h;
  }

  // Totals
  y += 2;
  const totals = [
    ['Subtotal', fmt(invoice.subtotal)],
    ['Tax', fmt(invoice.tax_total)],
  ];
  if (invoice.item_discount > 0) totals.push(['Item Discount', `-${fmt(invoice.item_discount)}`]);
  totals.push(['Bill Discount', `-${fmt(invoice.discount)}`]);
  totals.push(['GRAND TOTAL', fmt(invoice.grand_total)]);
  for (const [k, v] of totals) {
    doc.setFont('helvetica', k === 'GRAND TOTAL' ? 'bold' : 'normal');
    doc.setFontSize(k === 'GRAND TOTAL' ? 11 : 9.5);
    doc.text(k, W - M - 60, y);
    doc.text(v, W - M, y, { align: 'right' });
    if (k === 'GRAND TOTAL') {
      doc.setDrawColor(15, 23, 42);
      doc.setLineWidth(0.5);
      doc.line(W - M - 60, y + 1.5, W - M, y + 1.5);
      doc.setLineWidth(0.1);
    }
    y += 6;
  }
  y += 2;

  // Payment info
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(80);
  if (invoice.payment_breakdown && invoice.payment_breakdown.length) {
    doc.text(
      `Payment: ${invoice.payment_breakdown.map((b) => `${b.mode} ${fmt(b.amount)}`).join(' + ')}`,
      M,
      y
    );
  } else {
    doc.text(`Payment Mode: ${invoice.payment_mode || '-'}`, M, y);
  }
  y += 5;
  if (invoice.status === 'credit' && invoice.due_date) {
    doc.text(`Due date: ${invoice.due_date}`, M, y);
    y += 5;
  }
  doc.setTextColor(0);

  // Footer
  doc.setFontSize(9);
  const footer = store.receipt_footer || 'Thank you for your purchase!';
  const footLines = doc.splitTextToSize(footer, CW);
  doc.setFont('helvetica', 'italic');
  doc.text(footLines, W / 2, 283 - footLines.length * 4.5, { align: 'center' });

  return doc;
}

export function downloadInvoicePdf(doc, filename) {
  doc.save(filename);
}

// Returns true when the PDF was handed to the system share sheet
// (WhatsApp, Gmail, etc. on mobile / macOS). False when unsupported.
export async function shareInvoicePdf(doc, filename) {
  const file = new File([doc.output('blob')], filename, { type: 'application/pdf' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title: filename });
    return true;
  }
  return false;
}

// Plain-text summary used as the WhatsApp / email body fallback.
export function invoiceSummaryText({ invoice = {}, store = {}, customer = null }) {
  const lines = [
    store.name || 'RETAIL SHOP',
    `Invoice: ${invoice.invoice_no || ''}`,
    `Date: ${invoice.created_at ? new Date(invoice.created_at).toLocaleString() : ''}`,
    `Total: ${fmt(invoice.grand_total)}`,
  ];
  if (customer?.name) lines.push(`Customer: ${customer.name}`);
  if (invoice.status === 'credit') {
    lines.push(`Balance due: ${fmt((invoice.grand_total || 0) - (invoice.amount_paid || 0))}`);
  }
  return lines.join('\n');
}