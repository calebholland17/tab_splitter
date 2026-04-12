function fmt(n) { return '$' + Number(n).toFixed(2); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function render(tab) {
  document.getElementById('tab-name').textContent = tab.name;
  document.getElementById('guest-url').textContent = `${window.location.origin}/tab`;

  const paidCount = tab.guests.filter(g => g.paid).length;
  document.getElementById('progress-fill').style.width =
    (tab.guests.length > 0 ? (paidCount / tab.guests.length) * 100 : 0) + '%';

  document.getElementById('guest-list').innerHTML = tab.guests.map(g => `
    <div class="guest-status-row ${g.paid ? 'paid' : ''}">
      <span class="guest-name">${esc(g.name)}</span>
      <span class="guest-owed">${fmt(g.owed)}</span>
      <span class="guest-badge ${g.paid ? 'badge-paid' : 'badge-pending'}">
        ${g.paid ? 'Paid ✓' : 'Pending'}
      </span>
    </div>
  `).join('');

  if (tab.status === 'settled') {
    document.getElementById('settlement-overlay').classList.add('visible');
  }
}

window.copyLink = function() {
  const btn = document.querySelector('.btn-outline');
  navigator.clipboard.writeText(`${window.location.origin}/tab`)
    .then(() => {
      const orig = btn.textContent;
      btn.textContent = 'Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    })
    .catch(() => {
      prompt('Copy this link:', `${window.location.origin}/tab`);
    });
};

// Poll for updates every 2 seconds
function poll() {
  fetch('/api/tab').then(r => r.json()).then(render);
}
poll();
setInterval(poll, 2000);
