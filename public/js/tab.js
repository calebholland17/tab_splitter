const socket = io();
let tab = null;
let myGuestId = null;

function fmt(n) { return '$' + Number(n).toFixed(2); }

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

  // Name chips
  document.getElementById('name-chips').innerHTML = tab.guests.map(g => `
    <div class="chip ${g.id === myGuestId ? 'active' : ''} ${g.paid ? 'paid' : ''}"
      onclick="selectGuest('${g.id}')">
      ${g.name}${g.paid ? ' ✓' : ''}
    </div>
  `).join('');

  // Items grouped by name
  const groups = groupItems(tab.items);
  document.getElementById('item-list').innerHTML = groups.map(group => {
    const rows = group.items.map(item => {
      const claimer = item.claimedBy ? tab.guests.find(g => g.id === item.claimedBy) : null;
      const isMe = item.claimedBy === myGuestId;
      const isTaken = item.claimedBy && !isMe;
      const cls = isMe ? 'claimed-mine' : isTaken ? 'claimed-other' : '';
      const check = (isMe || isTaken) ? '✓' : '';
      const sub = isMe ? 'Claimed by you' : (claimer ? claimer.name : '');
      const onclick = (!isTaken && myGuestId) ? `onclick="toggle('${item.id}')"` : '';
      return `<div class="item ${cls}" ${onclick} data-id="${item.id}">
        <div class="item-check">${check}</div>
        <div class="item-info">
          <div class="item-name">${item.name}</div>
          ${sub ? `<div class="item-claimer">${sub}</div>` : ''}
        </div>
        <div class="item-price">${fmt(item.price)}</div>
      </div>`;
    }).join('');
    return `<div class="group-header">${group.name} — ${fmt(group.price)} ea</div>${rows}`;
  }).join('');

  // Charges
  document.getElementById('charges-section').innerHTML = `
    <div class="charge-row"><span>Subtotal</span><span>${fmt(tab.charges.subtotal)}</span></div>
    <div class="charge-row"><span>Surcharge</span><span>${fmt(tab.charges.surcharge)}</span></div>
    <div class="charge-row"><span>Tax</span><span>${fmt(tab.charges.tax)}</span></div>
    <div class="charge-row"><span>Gratuity (20%)</span><span>${fmt(tab.charges.gratuity)}</span></div>
    <div class="charge-row total"><span>Total</span><span>${fmt(tab.charges.total)}</span></div>
  `;

  // Footer
  if (myGuestId) {
    const me = tab.guests.find(g => g.id === myGuestId);
    if (me) {
      document.getElementById('footer').style.display = 'block';
      document.getElementById('footer-subtotal').textContent = fmt(me.subtotal);
      document.getElementById('footer-fees').textContent = `+ ${fmt(Math.max(0, me.owed - me.subtotal))}`;
      document.getElementById('footer-owed').textContent = fmt(me.owed);
      const btn = document.getElementById('settle-btn');
      btn.disabled = me.paid;
      btn.textContent = me.paid ? '✓ Paid' : '✓  I\'ve Settled My Tab';
    }
  }

  if (tab.status === 'settled') showSettled();
}

function showSettled() {
  document.getElementById('settlement-overlay').classList.add('visible');
}

window.selectGuest = function(guestId) {
  myGuestId = guestId;
  render(tab);
};

window.toggle = function(itemId) {
  if (!myGuestId || !tab) return;
  const item = tab.items.find(i => i.id === itemId);
  if (!item) return;
  if (item.claimedBy === myGuestId) {
    socket.emit('unclaim_item', { itemId, guestId: myGuestId });
  } else if (!item.claimedBy) {
    socket.emit('claim_item', { itemId, guestId: myGuestId });
  }
};

document.getElementById('settle-btn').addEventListener('click', () => {
  if (myGuestId) socket.emit('mark_paid', { guestId: myGuestId });
});

socket.on('tab_updated', render);
socket.on('tab_settled', showSettled);
