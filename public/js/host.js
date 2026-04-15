const tabId = window.location.pathname.split('/').filter(Boolean).pop();

function fmt(n) { return '$' + Number(n).toFixed(2); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(tab) {
  document.getElementById('tab-name').textContent = tab.name;
  document.getElementById('guest-url').textContent = `${window.location.origin}/tab/${tabId}`;

  const paidCount = tab.guests.filter(g => g.paid).length;
  document.getElementById('progress-fill').style.width =
    (tab.guests.length > 0 ? (paidCount / tab.guests.length) * 100 : 0) + '%';

  document.getElementById('guest-list').innerHTML = tab.guests.map(g => `
    <div class="guest-status-row ${g.paid ? 'paid' : ''}">
      <span class="guest-name">${esc(g.name)}</span>
      <span class="guest-owed">${fmt(g.owed)}</span>
      ${g.paid
        ? `<span class="guest-badge badge-paid">Paid ✓</span>`
        : `<button class="btn-mark-paid" onclick="markPaid('${esc(g.id)}')">Mark Paid</button>`
      }
    </div>
  `).join('');

  if (tab.status === 'settled') {
    document.getElementById('settlement-overlay').classList.add('visible');
  }
}

window.markPaid = function (guestId) {
  fetch(`/api/tabs/${tabId}/paid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId }),
  })
    .then(r => r.json())
    .then(data => { if (data.tab) render(data.tab); })
    .catch(() => {});
};

window.copyLink = function () {
  const btn = document.getElementById('copy-btn');
  navigator.clipboard.writeText(`${window.location.origin}/tab/${tabId}`)
    .then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    })
    .catch(() => prompt('Copy this link:', `${window.location.origin}/tab/${tabId}`));
};

let pollInterval = null;

function poll() {
  fetch(`/api/tabs/${tabId}`)
    .then(r => r.json())
    .then(data => {
      if (data.error) {
        clearInterval(pollInterval);
        document.getElementById('tab-name').textContent = 'Tab not found';
      } else {
        render(data);
      }
    })
    .catch(() => {
      clearInterval(pollInterval);
      document.getElementById('tab-name').textContent = 'Connection error — reload to retry';
    });
}
poll();
pollInterval = setInterval(poll, 2000);
