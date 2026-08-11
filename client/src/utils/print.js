// Reliable printing: clone the on-screen receipt into a dedicated #print-root
// container and print only that, instead of fighting with visibility tricks
// inside fixed/overlay modals (which often print blank).
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
