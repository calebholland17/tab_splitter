// Shared by the guest page (pay the host) and the host page (tip jar).
const isMobile = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);

// Mobile gets a deep link that pre-fills the pay screen; desktop can only open the profile.
// A null/undefined amount leaves the amount blank for the payer to fill in.
function venmoUrl(handle, amount, note, mobile = isMobile) {
  const h = handle.replace(/^@/, '');
  if (mobile) {
    const amt = amount == null ? '' : `&amount=${Number(amount).toFixed(2)}`;
    return `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(h)}${amt}&note=${encodeURIComponent(note)}`;
  }
  return `https://venmo.com/u/${encodeURIComponent(h)}`;
}

if (typeof module !== 'undefined') module.exports = { venmoUrl };
