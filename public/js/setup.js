function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let items = [];

function recalcTotal() {
  const subtotal = items.reduce((s, item) => s + item.price * item.qty, 0);
  const surcharge = parseFloat(document.getElementById('charge-surcharge').value) || 0;
  const tax       = parseFloat(document.getElementById('charge-tax').value) || 0;
  const gratuity  = parseFloat(document.getElementById('charge-gratuity').value) || 0;
  document.getElementById('charge-total').value =
    (Math.round((subtotal + surcharge + tax + gratuity) * 100) / 100).toFixed(2);
}

function renderItems() {
  const el = document.getElementById('item-editor');
  if (items.length === 0) {
    el.innerHTML = '<div class="item-empty">No items yet — scan a receipt or add manually.</div>';
    recalcTotal();
    return;
  }
  el.innerHTML = items.map((item, i) => `
    <div class="setup-item">
      <input class="setup-item-name" value="${esc(item.name)}"
        placeholder="Item name" oninput="updateItem(${i},'name',this.value)">
      <input class="setup-item-qty" type="number" value="${item.qty}" min="1"
        oninput="updateItem(${i},'qty',+this.value)">
      <span class="setup-item-x">×</span>
      <input class="setup-item-price" type="number" value="${item.price > 0 ? item.price.toFixed(2) : ''}"
        step="0.01" min="0" inputmode="decimal" placeholder="0.00"
        oninput="updateItem(${i},'price',+this.value)" onfocus="this.select()">
      <button class="btn-remove" onclick="removeItem(${i})">✕</button>
    </div>
  `).join('');
  recalcTotal();
}

window.updateItem = (i, field, val) => { items[i][field] = val; recalcTotal(); };
window.removeItem = (i) => { items.splice(i, 1); renderItems(); };
window.addItem    = () => { items.push({ name: '', price: 0, qty: 1 }); renderItems(); };

['charge-surcharge', 'charge-tax', 'charge-gratuity'].forEach(id => {
  document.getElementById(id).addEventListener('input', recalcTotal);
});

let receiptParsing = false;

async function handleReceiptFile(file) {
  if (!file || receiptParsing) return;
  const status = document.getElementById('parse-status');
  if (file.type && !file.type.startsWith('image/')) {
    status.textContent = 'Please select an image file.';
    status.className = 'parse-status error';
    return;
  }
  receiptParsing = true;
  status.textContent = 'Scanning receipt…';
  status.className = 'parse-status';
  const form = new FormData();
  form.append('image', file);
  try {
    const res  = await fetch('/api/receipt/parse', { method: 'POST', body: form });
    const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    items = data.items.map(i => ({ name: i.name, price: Number(i.price), qty: Number(i.qty) }));

    if (data.charges) {
      document.getElementById('charge-surcharge').value = Number(data.charges.surcharge || 0).toFixed(2);
      document.getElementById('charge-tax').value       = Number(data.charges.tax       || 0).toFixed(2);
      document.getElementById('charge-gratuity').value  = Number(data.charges.gratuity  || 0).toFixed(2);
    }

    renderItems(); // also calls recalcTotal()

    let msg = `✓ Found ${items.length} item type${items.length === 1 ? '' : 's'}`;
    if (data.receiptTotal) {
      const ourTotal = parseFloat(document.getElementById('charge-total').value);
      const diff = Math.abs(ourTotal - data.receiptTotal);
      if (diff < 0.02) {
        msg += ` · Total matches receipt ($${ourTotal.toFixed(2)}) ✓`;
        status.className = 'parse-status success';
      } else {
        msg += ` · Total mismatch: we got $${ourTotal.toFixed(2)}, receipt shows $${data.receiptTotal.toFixed(2)} — check items/charges`;
        status.className = 'parse-status warning';
      }
    } else {
      status.className = 'parse-status success';
    }
    status.textContent = msg;
  } catch (err) {
    status.textContent = `Scan failed: ${err.message}. Add items manually below.`;
    status.className = 'parse-status error';
  } finally {
    receiptParsing = false;
  }
}

['receipt-camera', 'receipt-library'].forEach(id => {
  document.getElementById(id).addEventListener('change', e => {
    handleReceiptFile(e.target.files[0]);
    e.target.value = '';
  });
});

window.createTab = async () => {
  const name            = document.getElementById('tab-name').value.trim();
  const paymentHandle   = document.getElementById('payment-handle').value.trim();
  const paymentPlatform = 'Venmo';
  const surcharge = parseFloat(document.getElementById('charge-surcharge').value) || 0;
  const tax       = parseFloat(document.getElementById('charge-tax').value) || 0;
  const gratuity  = parseFloat(document.getElementById('charge-gratuity').value) || 0;
  const guestText = document.getElementById('guest-names').value;
  const guests    = guestText.split(/[\n,]/).map(s => s.trim()).filter(Boolean);

  if (!name)             return alert('Please enter a tab name.');
  if (!paymentHandle)   return alert('Please enter a payment handle (e.g. @Caleb-Holland-3).');
  if (items.length === 0) return alert('Please add at least one item.');
  if (guests.length === 0) return alert('Please add at least one guest name.');

  const subtotal = Math.round(items.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  const total    = Math.round((subtotal + surcharge + tax + gratuity) * 100) / 100;
  const charges  = { subtotal, surcharge, tax, gratuity, total };

  const btn = document.getElementById('create-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const res  = await fetch('/api/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, paymentHandle, paymentPlatform, charges, guests, items }),
    });
    const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    window.location.href = `/host/${data.tabId}`;
  } catch (err) {
    alert(`Failed to create tab: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Create Tab →';
  }
};

renderItems();
