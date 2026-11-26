const KEY_STORAGE = 'tabsplitter_admin_key';

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function money(n) {
  return '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function apiCost(n) { return n < 1 ? '$' + Number(n).toFixed(3) : money(n); }
function pct(n) { return n == null ? '—' : Math.round(n * 100) + '%'; }
function num(n, digits = 0) { return n == null ? '—' : Number(n).toFixed(digits); }

function change(cur, prev) {
  if (!prev) return '<span class="delta">— vs prev 7d</span>';
  const p = Math.round(((cur - prev) / prev) * 100);
  const cls = p > 0 ? 'up' : p < 0 ? 'down' : '';
  const arrow = p > 0 ? '▲' : p < 0 ? '▼' : '';
  return `<span class="delta ${cls}">${arrow} ${Math.abs(p)}% vs prev 7d</span>`;
}

function tile(label, value, extra = '') {
  return `<div class="stat"><div class="stat-label">${esc(label)}</div><div class="stat-value">${esc(value)}</div>${extra}</div>`;
}

// Key arrives once via ?key=…, is remembered, and is stripped from the address bar.
function readKey() {
  const fromUrl = new URLSearchParams(window.location.search).get('key');
  if (fromUrl) {
    try { localStorage.setItem(KEY_STORAGE, fromUrl); } catch (e) {}
    history.replaceState(null, '', '/admin');
    return fromUrl;
  }
  try { return localStorage.getItem(KEY_STORAGE); } catch (e) { return null; }
}
let adminKey = readKey();

function showMessage(text) {
  document.getElementById('admin-grid').hidden = true;
  const el = document.getElementById('admin-message');
  el.textContent = text;
  el.hidden = false;
}

function weeklyChart(weeks) {
  const W = 320, H = 130, left = 24, bottom = 18, top = 8;
  const max = Math.max(1, ...weeks.map(w => w.tabs));
  const slot = (W - left) / weeks.length;
  const bars = weeks.map((w, i) => {
    const h = (w.tabs / max) * (H - top - bottom);
    const label = `Week of ${new Date(w.weekStart).toLocaleDateString()}: ${w.tabs} tab${w.tabs === 1 ? '' : 's'}`;
    return `<rect x="${(left + i * slot + 2).toFixed(1)}" y="${(H - bottom - h).toFixed(1)}" width="${(slot - 4).toFixed(1)}" height="${h.toFixed(1)}" rx="2"><title>${esc(label)}</title></rect>`;
  }).join('');
  return `
    <figure class="chart">
      <figcaption>Tabs per week · last 12 weeks</figcaption>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Tabs per week, last 12 weeks">
        <line x1="${left}" y1="${H - bottom}" x2="${W}" y2="${H - bottom}" class="axis"/>
        <text x="${left - 4}" y="${top + 8}" text-anchor="end" class="tick">${max}</text>
        <text x="${left - 4}" y="${H - bottom}" text-anchor="end" class="tick">0</text>
        ${bars}
        <text x="${left}" y="${H - 4}" class="tick">12 wks ago</text>
        <text x="${W}" y="${H - 4}" text-anchor="end" class="tick">this week</text>
      </svg>
    </figure>`;
}

function render(s) {
  const { growth: g, engagement: e, cost: c, tips: t } = s;

  document.getElementById('growth').innerHTML = `
    <div class="stat-row">
      ${tile('Tabs · 7d', g.tabs.last7, change(g.tabs.last7, g.tabs.prev7))}
      ${tile('Guests · 7d', g.guests.last7, change(g.guests.last7, g.guests.prev7))}
      ${tile('$ split · 7d', money(g.split.last7), change(g.split.last7, g.split.prev7))}
    </div>
    <div class="admin-note">All-time: ${g.tabs.allTime} tabs · ${g.guests.allTime} guests · ${money(g.split.allTime)} split</div>
    ${weeklyChart(g.weekly)}`;

  const since = s.scannedSince ? `<div class="stat-sub">since ${esc(new Date(s.scannedSince).toLocaleDateString())}</div>` : '';
  document.getElementById('engagement').innerHTML = `
    <div class="stat-row">
      ${tile('Started from scan', pct(e.scanRate), since)}
      ${tile('Avg guests / tab', num(e.avgGuestsPerTab, 1))}
      ${tile('Guests marked paid', pct(e.paidRate))}
      ${tile('Avg items / tab', num(e.avgItemsPerTab, 1))}
    </div>`;

  const used = Math.min(100, Math.round((c.scansToday / c.scanCap) * 100));
  const ips = c.topIpsToday.length
    ? `<ul class="ip-list">${c.topIpsToday.map(r => `<li><code>${esc(r.ipHash.slice(0, 8))}…</code><span>${r.scans}</span></li>`).join('')}</ul>`
    : '<div class="admin-note">No scans yet today.</div>';
  document.getElementById('cost').innerHTML = `
    <div class="meter-label"><span>Scans today (UTC)</span><span>${c.scansToday} / ${c.scanCap}</span></div>
    <div class="meter"><div class="meter-fill ${used >= 80 ? 'hot' : ''}" style="width:${used}%"></div></div>
    <div class="stat-row">
      ${tile('Blocked today', c.blockedToday)}
      ${tile('Fail rate · 7d', pct(c.failRate7d))}
      ${tile('API cost today', apiCost(c.costTodayUsd))}
      ${tile('API cost this month', apiCost(c.costMonthUsd))}
    </div>
    <div class="admin-subhead">Top IPs today (hashed)</div>
    ${ips}`;

  document.getElementById('tips').innerHTML = `
    <div class="stat-row">
      ${tile('Tip taps · 7d', t.last7)}
      ${tile('Tip taps · all time', t.allTime)}
    </div>
    <div class="admin-note">Taps, not payments — check Venmo for what actually came in.</div>`;

  document.getElementById('admin-meta').textContent = `Updated ${new Date(s.generatedAt).toLocaleTimeString()}`;
  document.getElementById('admin-message').hidden = true;
  document.getElementById('admin-grid').hidden = false;
}

window.loadStats = function () {
  if (!adminKey) return showMessage('Open this page once with ?key=YOUR_ADMIN_TOKEN to sign in.');
  fetch('/api/admin/stats', { headers: { Authorization: `Bearer ${adminKey}` } })
    .then(res => {
      if (res.status === 401) {
        try { localStorage.removeItem(KEY_STORAGE); } catch (e) {}
        adminKey = null;
        throw new Error('That key was not accepted. Open this page again with ?key=YOUR_ADMIN_TOKEN.');
      }
      if (res.status === 404) throw new Error('The dashboard is turned off (ADMIN_TOKEN is not set on the server).');
      if (!res.ok) throw new Error(`Server error ${res.status}`);
      return res.json();
    })
    .then(render)
    .catch(err => showMessage(err.message));
};

loadStats();
