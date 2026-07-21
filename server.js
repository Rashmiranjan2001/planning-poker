const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

const rooms = new Map();

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function publicState(room) {
  const participants = Array.from(room.participants.values()).map(p => ({
    id: p.id,
    name: p.name,
    isHost: p.isHost,
    role: p.role || 'participant',
    hasVoted: room.votes.has(p.id),
    vote: room.revealed ? (room.votes.get(p.id) ?? null) : null,
  }));

  let average = null;
  let distribution = null;
  if (room.revealed) {
    // Collect only votes from non-spectators for the tally
    const voterVotes = [];
    for (const [pid, v] of room.votes.entries()) {
      const p = room.participants.get(pid);
      if (p && p.role !== 'spectator') voterVotes.push(v);
    }
    const numeric = voterVotes.filter(v => typeof v === 'number');
    if (numeric.length > 0) {
      average = Math.round((numeric.reduce((a, b) => a + b, 0) / numeric.length) * 10) / 10;
    }
    distribution = {};
    for (const v of voterVotes) {
      const key = String(v);
      distribution[key] = (distribution[key] || 0) + 1;
    }
  }

  return {
    code: room.code,
    ticket: room.ticket,
    revealed: room.revealed,
    participants,
    average,
    distribution,
    hostId: room.hostId,
  };
}

function broadcast(code) {
  const room = rooms.get(code);
  if (!room) return;
  io.to(code).emit('state', publicState(room));
}

io.on('connection', (socket) => {
  let joinedCode = null;

  socket.on('createRoom', ({ name, role }, cb) => {
    const trimmed = (name || '').trim().slice(0, 40) || 'Host';
    const safeRole = role === 'spectator' ? 'spectator' : 'participant';
    const code = generateRoomCode();
    const room = {
      code,
      hostId: socket.id,
      ticket: '',
      revealed: false,
      participants: new Map(),
      votes: new Map(),
      createdAt: Date.now(),
    };
    room.participants.set(socket.id, { id: socket.id, name: trimmed, isHost: true, role: safeRole });
    rooms.set(code, room);
    socket.join(code);
    joinedCode = code;
    cb && cb({ ok: true, code });
    broadcast(code);
  });

  socket.on('joinRoom', ({ code, name, role }, cb) => {
    const roomCode = (code || '').trim().toUpperCase();
    const room = rooms.get(roomCode);
    if (!room) {
      cb && cb({ ok: false, error: 'Room not found' });
      return;
    }
    const trimmed = (name || '').trim().slice(0, 40) || 'Anon';
    const safeRole = role === 'spectator' ? 'spectator' : 'participant';
    room.participants.set(socket.id, { id: socket.id, name: trimmed, isHost: false, role: safeRole });
    socket.join(roomCode);
    joinedCode = roomCode;
    cb && cb({ ok: true, code: roomCode });
    broadcast(roomCode);
  });

  socket.on('setTicket', ({ ticket }) => {
    if (!joinedCode) return;
    const room = rooms.get(joinedCode);
    if (!room) return;
    if (!room.participants.has(socket.id)) return;
    room.ticket = (ticket || '').slice(0, 200);
    room.votes.clear();
    room.revealed = false;
    broadcast(joinedCode);
  });

  socket.on('vote', ({ value }) => {
    if (!joinedCode) return;
    const room = rooms.get(joinedCode);
    if (!room) return;
    if (room.revealed) return;
    if (!room.participants.has(socket.id)) return;
    room.votes.set(socket.id, value);
    broadcast(joinedCode);
  });

  socket.on('reveal', () => {
    if (!joinedCode) return;
    const room = rooms.get(joinedCode);
    if (!room) return;
    if (!room.participants.has(socket.id)) return;
    room.revealed = true;
    broadcast(joinedCode);
  });

  socket.on('reset', () => {
    if (!joinedCode) return;
    const room = rooms.get(joinedCode);
    if (!room) return;
    if (!room.participants.has(socket.id)) return;
    room.votes.clear();
    room.revealed = false;
    room.ticket = '';
    broadcast(joinedCode);
  });

  socket.on('disconnect', () => {
    if (!joinedCode) return;
    const room = rooms.get(joinedCode);
    if (!room) return;
    room.participants.delete(socket.id);
    room.votes.delete(socket.id);

    if (room.participants.size === 0) {
      rooms.delete(joinedCode);
      return;
    }

    if (room.hostId === socket.id) {
      const next = room.participants.values().next().value;
      if (next) {
        room.hostId = next.id;
        next.isHost = true;
      }
    }
    broadcast(joinedCode);
  });
});

const IDLE_MS = 6 * 60 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.participants.size === 0 && now - room.createdAt > IDLE_MS) {
      rooms.delete(code);
    }
  }
}, 30 * 60 * 1000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Estimate Me running at http://localhost:${PORT}`);
});
