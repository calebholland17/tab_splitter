require('dotenv').config();
const express = require('express');
const path = require('path');
const { getTabView, claimItem, unclaimItem, markPaid, isSettled } = require('./tabStore');

const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/host.html')));
app.get('/tab', (req, res) => res.sendFile(path.join(__dirname, 'public/tab.html')));

// REST: get tab state
app.get('/api/tab', (req, res) => res.json(getTabView()));

// REST: mutations
app.post('/api/claim', (req, res) => {
  const { itemId, guestId } = req.body || {};
  try {
    claimItem(itemId, guestId);
    res.json(getTabView());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/unclaim', (req, res) => {
  const { itemId, guestId } = req.body || {};
  try {
    unclaimItem(itemId, guestId);
    res.json(getTabView());
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.post('/api/paid', (req, res) => {
  const { guestId } = req.body || {};
  try {
    markPaid(guestId);
    res.json({ tab: getTabView(), settled: isSettled() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`TabSplitter running on http://localhost:${PORT}`));
}

module.exports = app;
