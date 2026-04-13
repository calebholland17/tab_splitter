const tabId = window.location.pathname.split('/').filter(Boolean).pop();
let tab = null;
let myGuestId = null;

function fmt(n) { return '$' + Number(n).toFixed(2); }

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function groupItems(items) {
  const groups = new Map();
  for (const item of items) {
    if (!groups.has(item.name)) groups.set(item.name, { name: item.name, price: item.price, items: [] });
    groups.get(item.name).items.push(item);
  }
  return [...groups.values()];
}

function render(tabData) {
  tab = tabData;
  document.getElementById('tab-name').textContent = tab.name;
  document.getElementById('tab-meta').textContent =
    `${tab.guests.length} guests · ${fmt(tab.charges.total)} total`;
  document.getElementById('payment-handle').textContent = tab.payment.handle;
  document.getElementById('payment-platform').textContent = tab.payment.platform;

  document.getElementById('name-chips').innerHTML = tab.guests.map(g => `
    <div class="chip ${g.id === myGuestId ? 'active' : ''} ${g.paid ? 'paid' : ''}"
      onclick="selectGuest('${esc(g.id)}')">
      ${esc(g.name)}${g.paid ? ' ✓' : ''}
    </div>
  `).join('');

  const groups = groupItems(tab.items);
  document.getElementById('item-list').innerHTML = groups.map(group => {
    const rows = group.items.map(item => {
      const claimer = item.claimedBy ? tab.guests.find(g => g.id === item.claimedBy) : null;
      const isMe    = myGuestId !== null && item.claimedBy === myGuestId;
      const isTaken = item.claimedBy && !isMe;
      const cls     = isMe ? 'claimed-mine' : isTaken ? 'claimed-other' : (!myGuestId ? 'no-guest' : '');
      const check   = (isMe || isTaken) ? '✓' : '';
      const sub     = isMe ? 'Claimed by you' : (claimer ? esc(claimer.name) : '');
      const onclick = isTaken ? '' : myGuestId
        ? `onclick="toggle('${item.id}')"`
        : `onclick="promptName()"`;
      return `<div class="item ${cls}" ${onclick} data-id="${item.id}">
        <div class="item-check">${check}</div>
        <div class="item-info">
          <div class="item-name">${esc(item.name)}</div>
          ${sub ? `<div class="item-claimer">${sub}</div>` : ''}
        </div>
        <div class="item-price">${fmt(item.price)}</div>
      </div>`;
    }).join('');
    return `<div class="group-header">${esc(group.name)} — ${fmt(group.price)} ea</div>${rows}`;
  }).join('');

  document.getElementById('charges-section').innerHTML = `
    <div class="charge-row"><span>Subtotal</span><span>${fmt(tab.charges.subtotal)}</span></div>
    <div class="charge-row"><span>Surcharge</span><span>${fmt(tab.charges.surcharge)}</span></div>
    <div class="charge-row"><span>Tax</span><span>${fmt(tab.charges.tax)}</span></div>
    <div class="charge-row"><span>Gratuity</span><span>${fmt(tab.charges.gratuity)}</span></div>
    <div class="charge-row total"><span>Total</span><span>${fmt(tab.charges.total)}</span></div>
  `;

  if (myGuestId) {
    const me = tab.guests.find(g => g.id === myGuestId);
    if (me) {
      document.getElementById('footer').style.display = 'block';
      document.getElementById('footer-subtotal').textContent = fmt(me.subtotal);
      document.getElementById('footer-fees').textContent = `+ ${fmt(Math.max(0, me.owed - me.subtotal))}`;
      document.getElementById('footer-owed').textContent = fmt(me.owed);
      const btn = document.getElementById('settle-btn');
      btn.disabled = me.paid;
      btn.textContent = me.paid ? '✓ Paid' : "✓ I've Settled My Tab";
    }
  }

  if (tab.status === 'settled') showSettled();
}

function showSettled() {
  document.getElementById('settlement-overlay').classList.add('visible');
}

window.selectGuest = function (guestId) {
  myGuestId = guestId;
  if (tab) render(tab);
};

let toastTimer = null;
function showToast(msg) {
  let toast = document.getElementById('toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 2500);
}

window.promptName = function () { showToast('Select your name above first'); };

window.toggle = function (itemId) {
  if (!myGuestId || !tab) return;
  const item = tab.items.find(i => i.id === itemId);
  if (!item) return;
  if (item.claimedBy && item.claimedBy !== myGuestId) return;
  const endpoint = item.claimedBy === myGuestId
    ? `/api/tabs/${tabId}/unclaim`
    : `/api/tabs/${tabId}/claim`;
  fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ itemId, guestId: myGuestId }),
  })
    .then(r => r.json())
    .then(data => { if (!data.error) render(data); })
    .catch(() => showToast('Something went wrong, please try again'));
};

document.getElementById('settle-btn').addEventListener('click', () => {
  if (!myGuestId) return;
  fetch(`/api/tabs/${tabId}/paid`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ guestId: myGuestId }),
  })
    .then(r => r.json())
    .then(data => {
      if (data.tab) render(data.tab);
      if (data.settled) showSettled();
    })
    .catch(() => showToast('Something went wrong, please try again'));
});

window.addEventListener('pageshow', (e) => {
  if (e.persisted) { myGuestId = null; if (tab) render(tab); }
});

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
