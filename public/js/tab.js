const tabId = window.location.pathname.split('/').filter(Boolean).pop();
let tab = null;
let pendingGuestId = null;

// Restore identity from sessionStorage so a page refresh doesn't reset the picker
const SESSION_KEY = `tab_identity_${tabId}`;
let myGuestId = sessionStorage.getItem(SESSION_KEY) || null;
let identityLocked = !!myGuestId;

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

function renderIdentityPicker() {
  document.getElementById('identity-picker').style.display = 'block';
  document.getElementById('name-bar').style.display = 'none';
  document.getElementById('items-section').style.display = 'none';
  document.getElementById('footer').style.display = 'none';

  document.getElementById('identity-chips').innerHTML = tab.guests.map(g => `
    <div class="chip ${g.id === pendingGuestId ? 'active' : ''} ${g.paid ? 'paid' : ''}"
      onclick="pickGuest('${esc(g.id)}')">
      ${esc(g.name)}${g.paid ? ' ✓' : ''}
    </div>
  `).join('');

  document.getElementById('confirm-identity-btn').disabled = !pendingGuestId;
}

function renderMain() {
  document.getElementById('identity-picker').style.display = 'none';
  document.getElementById('name-bar').style.display = 'flex';
  document.getElementById('items-section').style.display = 'block';

  // Name bar: current user chip active, all others locked
  document.getElementById('name-chips').innerHTML = tab.guests.map(g => {
    const isMe = g.id === myGuestId;
    const cls  = isMe ? `active${g.paid ? ' paid' : ''}` : 'locked';
    return `<div class="chip ${cls}">${esc(g.name)}${g.paid ? ' ✓' : ''}</div>`;
  }).join('');

  // Items
  const groups = groupItems(tab.items);
  document.getElementById('item-list').innerHTML = groups.map(group => {
    const rows = group.items.map(item => {
      const claimer = item.claimedBy ? tab.guests.find(g => g.id === item.claimedBy) : null;
      const isMe    = item.claimedBy === myGuestId;
      const isTaken = item.claimedBy && !isMe;
      const cls     = isMe ? 'claimed-mine' : isTaken ? 'claimed-other' : '';
      const check   = (isMe || isTaken) ? '✓' : '';
      const sub     = isMe ? 'Claimed by you' : (claimer ? esc(claimer.name) : '');
      const onclick = isTaken ? '' : `onclick="toggle('${esc(item.id)}')"`;
      return `<div class="item ${cls}" ${onclick} data-id="${esc(item.id)}">
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

  // Charges
  document.getElementById('charges-section').innerHTML = `
    <div class="charge-row"><span>Subtotal</span><span>${fmt(tab.charges.subtotal)}</span></div>
    <div class="charge-row"><span>Surcharge</span><span>${fmt(tab.charges.surcharge)}</span></div>
    <div class="charge-row"><span>Tax</span><span>${fmt(tab.charges.tax)}</span></div>
    <div class="charge-row"><span>Gratuity</span><span>${fmt(tab.charges.gratuity)}</span></div>
    <div class="charge-row total"><span>Total</span><span>${fmt(tab.charges.total)}</span></div>
  `;

  // Footer
  const me = tab.guests.find(g => g.id === myGuestId);
  if (me) {
    document.getElementById('footer').style.display = 'block';
    document.getElementById('footer-subtotal').textContent = fmt(me.subtotal);
    document.getElementById('footer-fees').textContent = `+ ${fmt(Math.max(0, me.owed - me.subtotal))}`;
    document.getElementById('footer-owed').textContent = fmt(me.owed);

    const venmoHandle = tab.payment.handle.replace(/^@/, '');
    const venmoUrl = `venmo://paycharge?txn=pay&recipients=${encodeURIComponent(venmoHandle)}&amount=${me.owed.toFixed(2)}&note=${encodeURIComponent(tab.name)}`;
    const venmoBtn = document.getElementById('venmo-btn');
    if (me.paid) {
      venmoBtn.removeAttribute('href');
    } else {
      venmoBtn.href = venmoUrl;
    }
    venmoBtn.textContent = me.paid ? '✓ Paid on Venmo' : `Pay ${fmt(me.owed)} on Venmo →`;
    venmoBtn.classList.toggle('btn-disabled', me.paid);

    const settleBtn = document.getElementById('settle-btn');
    settleBtn.disabled = me.paid;
    settleBtn.textContent = me.paid ? '✓ Settled' : "I've Paid ✓";
  } else {
    document.getElementById('footer').style.display = 'none';
  }
}

function render(tabData) {
  tab = tabData;
  document.getElementById('tab-name').textContent = tab.name;
  document.getElementById('tab-meta').textContent =
    `${tab.guests.length} guests · ${fmt(tab.charges.total)} total`;
  document.getElementById('payment-handle').textContent = tab.payment.handle;
  document.getElementById('payment-platform').textContent = tab.payment.platform;

  // Clear pendingGuestId if the guest was removed from the tab
  if (pendingGuestId && !tab.guests.find(g => g.id === pendingGuestId)) {
    pendingGuestId = null;
  }

  if (identityLocked) {
    renderMain();
  } else {
    renderIdentityPicker();
  }

  if (tab.status === 'settled') showSettled();
}

function showSettled() {
  document.getElementById('settlement-overlay').classList.add('visible');
}

window.pickGuest = function (guestId) {
  if (identityLocked) return;
  pendingGuestId = guestId;
  if (tab) renderIdentityPicker();
};

window.confirmIdentity = function () {
  if (!pendingGuestId) return;
  myGuestId = pendingGuestId;
  identityLocked = true;
  sessionStorage.setItem(SESSION_KEY, myGuestId);
  if (tab) renderMain();
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
  if (e.persisted) {
    // Back-navigation (bfcache restore): reset identity so a new person can use the device
    myGuestId = null;
    identityLocked = false;
    pendingGuestId = null;
    sessionStorage.removeItem(SESSION_KEY);
    if (tab) render(tab);
  }
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
