require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { getTab, getTabView, claimItem, unclaimItem, markPaid, isSettled } = require('./tabStore');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Serve HTML pages
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public/host.html')));
app.get('/tab', (req, res) => res.sendFile(path.join(__dirname, 'public/tab.html')));

// REST: get tab state
app.get('/api/tab', (req, res) => res.json(getTabView()));

// Socket.io
io.on('connection', (socket) => {
  // Send current state on connect
  socket.emit('tab_updated', getTabView());

  socket.on('claim_item', ({ itemId, guestId } = {}) => {
    try {
      if (claimItem(itemId, guestId)) io.emit('tab_updated', getTabView());
    } catch (err) { console.error('claim_item error:', err); }
  });

  socket.on('unclaim_item', ({ itemId, guestId } = {}) => {
    try {
      if (unclaimItem(itemId, guestId)) io.emit('tab_updated', getTabView());
    } catch (err) { console.error('unclaim_item error:', err); }
  });

  socket.on('mark_paid', ({ guestId } = {}) => {
    try {
      if (markPaid(guestId)) {
        io.emit('tab_updated', getTabView());
        if (isSettled()) io.emit('tab_settled');
      }
    } catch (err) { console.error('mark_paid error:', err); }
  });
});

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  server.listen(PORT, () => console.log(`TabSplitter running on http://localhost:${PORT}`));
}

module.exports = { app, server };
