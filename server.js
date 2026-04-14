require('dotenv').config();
const express = require('express');
const path    = require('path');
const multer  = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const {
  createTab, getTabView, claimItem, unclaimItem, markPaid, isSettled,
} = require('./db');

const app    = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Pages
app.get('/',            (req, res) => res.sendFile(path.join(__dirname, 'public/index.html')));
app.get('/host/:tabId', (req, res) => res.sendFile(path.join(__dirname, 'public/host.html')));
app.get('/tab/:tabId',  (req, res) => res.sendFile(path.join(__dirname, 'public/tab.html')));

// Receipt parsing
app.post('/api/receipt/parse', async (req, res) => {
  upload.single('image')(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: 'No image uploaded' });
    try {
      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: req.file.mimetype,
                data: req.file.buffer.toString('base64'),
              },
            },
            {
              type: 'text',
              text: 'Extract all line items from this receipt. Return ONLY a JSON array with no markdown: [{"name": string, "price": number, "qty": number}]. Each unique item type is one entry. If a line says "3 @ $6.50" that is qty=3, price=6.50. Do not include subtotals, taxes, tips, or totals.',
            },
          ],
        }],
      });
      const raw = response.content[0].text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const items = JSON.parse(raw);
      res.json({ items });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
});

// Create tab
app.post('/api/tabs', (req, res) => {
  const { name, paymentHandle, paymentPlatform, charges, guests, items } = req.body || {};
  try {
    const tabId = createTab({ name, paymentHandle, paymentPlatform, charges, guests, items });
    res.json({ tabId });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Get tab state
app.get('/api/tabs/:tabId', (req, res) => {
  const view = getTabView(req.params.tabId);
  if (!view) return res.status(404).json({ error: 'Tab not found' });
  res.json(view);
});

// Claim item
app.post('/api/tabs/:tabId/claim', (req, res) => {
  const { itemId, guestId } = req.body || {};
  try {
    const ok = claimItem(req.params.tabId, itemId, guestId);
    if (!ok) return res.status(409).json({ error: 'Item already claimed or invalid request' });
    res.json(getTabView(req.params.tabId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Unclaim item
app.post('/api/tabs/:tabId/unclaim', (req, res) => {
  const { itemId, guestId } = req.body || {};
  try {
    const ok = unclaimItem(req.params.tabId, itemId, guestId);
    if (!ok) return res.status(409).json({ error: 'Item not claimed by this guest' });
    res.json(getTabView(req.params.tabId));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Mark paid
app.post('/api/tabs/:tabId/paid', (req, res) => {
  const { guestId } = req.body || {};
  try {
    markPaid(req.params.tabId, guestId);
    res.json({ tab: getTabView(req.params.tabId), settled: isSettled(req.params.tabId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`TabSplitter running on http://localhost:${PORT}`));
}

module.exports = app;
