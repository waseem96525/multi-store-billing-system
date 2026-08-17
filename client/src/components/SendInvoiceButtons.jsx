import { useState } from 'react';
import {
  buildInvoicePdf,
  downloadInvoicePdf,
  shareInvoicePdf,
  invoiceSummaryText,
} from '../utils/invoicePdf';

// Share / download buttons for an invoice detail (used in the POS receipt
// modal and the Sales/Invoices detail modal).
//
// - "Share" uses the system share sheet with the PDF attached when the
//   browser supports it (WhatsApp / email on phones), otherwise it downloads
//   the PDF and opens the best available channel (WhatsApp or email).
// - Dedicated WhatsApp / Email buttons open the channel with a summary text.
export default function SendInvoiceButtons({ detail, className = '' }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  const d = detail || {};
  const invoice = d.invoice || {};
  const customer = d.customer || null;
  const filename = `${invoice.invoice_no || 'invoice'}.pdf`;

  const build = () =>
    buildInvoicePdf({
      store: d.store,
      invoice,
      items: d.items || [],
      customer,
      cashier: d.cashier,
    });

  const phoneDigits = customer?.phone ? String(customer.phone).replace(/\D/g, '') : null;
  const waLink = phoneDigits
    ? `https://wa.me/${phoneDigits}?text=${encodeURIComponent(invoiceSummaryText(d))}`
    : null;
  const mailLink = customer?.email
    ? `mailto:${customer.email}?subject=${encodeURIComponent(
        `Invoice ${invoice.invoice_no || ''}`
      )}&body=${encodeURIComponent(invoiceSummaryText(d))}`
    : null;

  const onShare = async () => {
    setBusy(true);
    setNote('');
    try {
      const ok = await shareInvoicePdf(build(), filename);
      if (!ok) {
        downloadInvoicePdf(build(), filename);
        if (waLink) {
          window.open(waLink, '_blank');
          setNote('PDF downloaded — WhatsApp will open with the invoice summary.');
        } else if (mailLink) {
          window.location.href = mailLink;
          setNote('PDF downloaded — your email app will open with the invoice summary.');
        } else {
          setNote('PDF downloaded. Add phone / email to the customer to send it directly.');
        }
      }
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      setNote('Sharing failed. Use Download PDF instead.');
    } finally {
      setBusy(false);
    }
  };

  const onDownload = () => {
    downloadInvoicePdf(build(), filename);
    setNote('');
  };

  return (
    <div className={`space-y-2 ${className}`}>
      <div className="flex gap-2">
        <button
          onClick={onShare}
          disabled={busy}
          className="flex-1 bg-emerald-600 text-white py-2 rounded hover:bg-emerald-700 disabled:opacity-50 text-sm"
          title="Send the invoice PDF via WhatsApp, email or any installed app"
        >
          {busy ? 'Preparing…' : '📤 Share PDF'}
        </button>
        <button
          onClick={onDownload}
          className="flex-1 border py-2 rounded hover:bg-slate-50 text-sm"
        >
          ⬇ Download PDF
        </button>
      </div>
      {(waLink || mailLink) && (
        <div className="flex gap-2 text-sm">
          {waLink && (
            <a
              href={waLink}
              target="_blank"
              rel="noreferrer"
              className="flex-1 bg-green-500 text-white py-1.5 rounded hover:bg-green-600 text-center"
            >
              WhatsApp
            </a>
          )}
          {mailLink && (
            <a
              href={mailLink}
              className="flex-1 bg-slate-700 text-white py-1.5 rounded hover:bg-slate-600 text-center"
            >
              Email
            </a>
          )}
        </div>
      )}
      {note && <div className="text-xs text-slate-500">{note}</div>}
    </div>
  );
}