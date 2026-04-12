const socket = io();

function fmt(n) { return '$' + Number(n).toFixed(2); }

function render(tab) {
  document.getElementById('tab-name').textContent = tab.name;
  document.getElementById('guest-url').textContent = `${window.location.origin}/tab`;

  const paidCount = tab.guests.filter(g => g.paid).length;
  document.getElementById('progress-fill').style.width =
    (tab.guests.length > 0 ? (paidCount / tab.guests.length) * 100 : 0) + '%';

  document.getElementById('guest-list').innerHTML = tab.guests.map(g => `
    <div class="guest-status-row ${g.paid ? 'paid' : ''}">
      <span class="guest-name">${g.name}</span>
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
  navigator.clipboard.writeText(`${window.location.origin}/tab`)
    .then(() => alert('Link copied!'));
};

socket.on('tab_updated', render);
socket.on('tab_settled', () => document.getElementById('settlement-overlay').classList.add('visible'));
