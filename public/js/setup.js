function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

let items = [];

const DRAFT_KEY = 'tabsplitter_draft';

function saveState() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      items,
      tabName:       document.getElementById('tab-name').value,
      paymentHandle: document.getElementById('payment-handle').value,
      surcharge:     document.getElementById('charge-surcharge').value,
      tax:           document.getElementById('charge-tax').value,
      gratuity:      document.getElementById('charge-gratuity').value,
      guests:        document.getElementById('guest-names').value,
    }));
  } catch (e) {}
}

function loadState() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const s = JSON.parse(raw);
    if (Array.isArray(s.items))       items = s.items.map(i => ({ ...i, splitMode: !!i.splitMode }));
    if (s.tabName)                    document.getElementById('tab-name').value = s.tabName;
    if (s.paymentHandle)              document.getElementById('payment-handle').value = s.paymentHandle;
    if (s.surcharge != null)          document.getElementById('charge-surcharge').value = s.surcharge;
    if (s.tax != null)                document.getElementById('charge-tax').value = s.tax;
    if (s.gratuity != null)           document.getElementById('charge-gratuity').value = s.gratuity;
    if (s.guests)                     document.getElementById('guest-names').value = s.guests;
  } catch (e) {}
}

window.clearDraft = function () {
  if (!confirm('Start over? This will clear all items and details.')) return;
  localStorage.removeItem(DRAFT_KEY);
  items = [];
  document.getElementById('tab-name').value = '';
  document.getElementById('payment-handle').value = '';
  document.getElementById('charge-surcharge').value = '0';
  document.getElementById('charge-tax').value = '0';
  document.getElementById('charge-gratuity').value = '0';
  document.getElementById('guest-names').value = '';
  document.getElementById('parse-status').textContent = '';
  document.getElementById('parse-status').className = 'parse-status';
  renderItems();
};

function recalcTotal() {
  const subtotal = items.reduce((s, item) => s + (item.splitMode ? item.price : item.price * item.qty), 0);
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
  el.innerHTML = items.map((item, i) => {
    const eachText = item.splitMode && item.qty > 0 && item.price > 0
      ? `= $${(item.price / item.qty).toFixed(2)} each`
      : '';
    return `
    <div class="setup-item">
      <input class="setup-item-name" value="${esc(item.name)}"
        placeholder="Item name" oninput="updateItem(${i},'name',this.value)">
      <input class="setup-item-qty" type="text" inputmode="numeric" value="${item.qty}"
        onkeydown="calcKeydown(event)" onfocus="calcFocus(event,{integer:true,min:1})" onblur="resolveCalcField(this,{integer:true,min:1})"
        oninput="updateItem(${i},'qty',parseFloat(this.value)||0)">
      <button class="setup-item-operator${item.splitMode ? ' split' : ''}" onclick="toggleSplitMode(${i})">${item.splitMode ? '÷' : '×'}</button>
      <input class="setup-item-price" type="text" inputmode="decimal" value="${item.price > 0 ? item.price.toFixed(2) : ''}"
        placeholder="${item.splitMode ? 'Total' : '0.00'}"
        onkeydown="calcKeydown(event)" onfocus="calcFocus(event,{integer:false,min:0})" onblur="resolveCalcField(this,{integer:false,min:0})"
        oninput="updateItem(${i},'price',parseFloat(this.value)||0)">
      <span class="setup-item-each">${eachText}</span>
      <button class="btn-remove" onclick="removeItem(${i})">✕</button>
    </div>
  `;
  }).join('');
  recalcTotal();
}

window.updateItem = (i, field, val) => {
  items[i][field] = val;
  recalcTotal();
  saveState();
  if (items[i].splitMode) {
    const eachEl = document.querySelectorAll('.setup-item')[i]?.querySelector('.setup-item-each');
    if (eachEl) {
      eachEl.textContent = items[i].qty > 0 && items[i].price > 0
        ? `= $${(items[i].price / items[i].qty).toFixed(2)} each`
        : '';
    }
  }
};
window.toggleSplitMode = (i) => { items[i].splitMode = !items[i].splitMode; renderItems(); saveState(); };
window.removeItem = (i) => { items.splice(i, 1); renderItems(); saveState(); };
window.addItem    = () => { items.push({ name: '', price: 0, qty: 1, splitMode: false }); renderItems(); saveState(); };

function calcKeydown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const allowed = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Tab', 'Enter', 'Home', 'End'];
  if (allowed.includes(e.key)) return;
  if (/^[0-9+\-*/.()]$/.test(e.key)) return;
  e.preventDefault();
}

let activeCalcField = null;
let activeCalcOpts = {};

function calcFocus(e, opts = {}) {
  e.target.dataset.prevValue = e.target.value;
  e.target.select();
  activeCalcField = e.target;
  activeCalcOpts = opts;
  document.getElementById('calc-bar').classList.add('visible');
}

function hideCalcBar() {
  activeCalcField = null;
  document.getElementById('calc-bar').classList.remove('visible');
}

function resolveCalcField(el, { integer = false, min = 0 } = {}) {
  const raw = el.value.trim();
  if (raw === '') {
    hideCalcBar();
    return;
  }
  const result = evalMathExpr(raw);
  if (result === null) {
    el.value = el.dataset.prevValue || '';
  } else {
    const value = Math.max(min, result);
    el.value = integer ? String(Math.round(value)) : value.toFixed(2);
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
  hideCalcBar();
}

function insertAtCursor(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  el.setRangeText(text, start, end, 'end');
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

function backspaceAtCursor(el) {
  const start = el.selectionStart ?? el.value.length;
  const end = el.selectionEnd ?? el.value.length;
  if (start === end) {
    if (start === 0) return;
    el.setRangeText('', start - 1, start, 'end');
  } else {
    el.setRangeText('', start, end, 'end');
  }
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

document.querySelectorAll('.calc-bar-btn[data-op]').forEach(btn => {
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    if (activeCalcField) insertAtCursor(activeCalcField, btn.dataset.op);
  });
});
document.getElementById('calc-bar-backspace').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (activeCalcField) backspaceAtCursor(activeCalcField);
});
document.getElementById('calc-bar-confirm').addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!activeCalcField) return;
  const field = activeCalcField;
  resolveCalcField(field, activeCalcOpts);
  field.blur();
});

window.calcKeydown = calcKeydown;
window.calcFocus = calcFocus;
window.resolveCalcField = resolveCalcField;

window.openHelp = () => {
  document.getElementById('help-overlay').classList.add('visible');
  document.body.style.overflow = 'hidden';
};
window.closeHelp = () => {
  document.getElementById('help-overlay').classList.remove('visible');
  document.body.style.overflow = '';
};

['charge-surcharge', 'charge-tax', 'charge-gratuity'].forEach(id => {
  const field = document.getElementById(id);
  field.addEventListener('input', () => { recalcTotal(); saveState(); });
  field.addEventListener('keydown', calcKeydown);
  field.addEventListener('focus', (e) => calcFocus(e, { integer: false, min: 0 }));
  field.addEventListener('blur', () => resolveCalcField(field, { integer: false, min: 0 }));
});

['tab-name', 'payment-handle', 'guest-names'].forEach(id => {
  document.getElementById(id).addEventListener('input', saveState);
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
    items = data.items.map(i => ({ name: i.name, price: Number(i.price), qty: Number(i.qty), splitMode: false }));

    if (data.charges) {
      document.getElementById('charge-surcharge').value = Number(data.charges.surcharge || 0).toFixed(2);
      document.getElementById('charge-tax').value       = Number(data.charges.tax       || 0).toFixed(2);
      document.getElementById('charge-gratuity').value  = Number(data.charges.gratuity  || 0).toFixed(2);
    }

    renderItems(); // also calls recalcTotal()
    saveState();

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
  if (items.some(item => item.splitMode && item.qty <= 0)) return alert('Split items must have at least 1 person sharing.');
  if (guests.length === 0) return alert('Please add at least one guest name.');

  const itemsToSend = items.map(({ name, qty, price, splitMode }) => ({
    name,
    qty,
    price: splitMode && qty > 0 ? price / qty : price,
  }));
  const subtotal = Math.round(itemsToSend.reduce((s, i) => s + i.price * i.qty, 0) * 100) / 100;
  const total    = Math.round((subtotal + surcharge + tax + gratuity) * 100) / 100;
  const charges  = { subtotal, surcharge, tax, gratuity, total };

  const btn = document.getElementById('create-btn');
  btn.disabled = true;
  btn.textContent = 'Creating…';

  try {
    const res  = await fetch('/api/tabs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, paymentHandle, paymentPlatform, charges, guests, items: itemsToSend }),
    });
    const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
    localStorage.removeItem(DRAFT_KEY);
    window.location.href = `/host/${data.tabId}`;
  } catch (err) {
    alert(`Failed to create tab: ${err.message}`);
    btn.disabled = false;
    btn.textContent = 'Create Tab →';
  }
};

loadState();
renderItems();
