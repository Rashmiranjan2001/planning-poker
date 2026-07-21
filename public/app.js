const socket = io();
const app = document.getElementById('app');

const CARDS = [1, 2, 3, 5, 8, 13, 21, '?', '☕'];

const store = {
  screen: 'landing',
  name: localStorage.getItem('pp_name') || '',
  myVote: null,
  state: null,
  editingTicket: false,
};

function render() {
  if (store.screen === 'landing') renderLanding();
  else if (store.screen === 'room') renderRoom();
}

function renderLanding() {
  const tpl = document.getElementById('tpl-landing');
  app.innerHTML = '';
  app.appendChild(tpl.content.cloneNode(true));

  const createName = document.getElementById('createName');
  const joinName = document.getElementById('joinName');
  const joinCode = document.getElementById('joinCode');
  const joinError = document.getElementById('joinError');
  createName.value = store.name;
  joinName.value = store.name;

  const urlCode = new URLSearchParams(location.search).get('room');
  if (urlCode) joinCode.value = urlCode.toUpperCase();

  document.getElementById('createBtn').addEventListener('click', () => {
    const name = createName.value.trim();
    if (!name) { createName.focus(); return; }
    store.name = name;
    localStorage.setItem('pp_name', name);
    socket.emit('createRoom', { name }, (res) => {
      if (res.ok) {
        history.replaceState({}, '', `?room=${res.code}`);
        store.screen = 'room';
        store.myVote = null;
        seenFirstState = false;
        wasRevealed = false;
        render();
      }
    });
  });

  document.getElementById('joinBtn').addEventListener('click', () => {
    const name = joinName.value.trim();
    const code = joinCode.value.trim().toUpperCase();
    joinError.textContent = '';
    if (!name) { joinName.focus(); return; }
    if (!code) { joinCode.focus(); return; }
    store.name = name;
    localStorage.setItem('pp_name', name);
    socket.emit('joinRoom', { name, code }, (res) => {
      if (res.ok) {
        history.replaceState({}, '', `?room=${res.code}`);
        store.screen = 'room';
        store.myVote = null;
        seenFirstState = false;
        wasRevealed = false;
        render();
      } else {
        joinError.textContent = res.error || 'Could not join';
      }
    });
  });

  joinCode.addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase();
  });

  const handleEnter = (btnId) => (e) => { if (e.key === 'Enter') document.getElementById(btnId).click(); };
  createName.addEventListener('keydown', handleEnter('createBtn'));
  joinName.addEventListener('keydown', handleEnter('joinBtn'));
  joinCode.addEventListener('keydown', handleEnter('joinBtn'));
}

function renderRoom() {
  const tpl = document.getElementById('tpl-room');
  app.innerHTML = '';
  app.appendChild(tpl.content.cloneNode(true));

  document.getElementById('leaveBtn').addEventListener('click', () => {
    location.href = location.pathname;
  });

  document.getElementById('copyLink').addEventListener('click', () => {
    const url = `${location.origin}${location.pathname}?room=${store.state?.code || ''}`;
    navigator.clipboard.writeText(url).then(() => {
      const status = document.getElementById('copyStatus');
      status.textContent = 'Copied!';
      setTimeout(() => { status.textContent = ''; }, 1500);
    });
  });

  document.getElementById('setTicketBtn').addEventListener('click', () => {
    const input = document.getElementById('ticketInput');
    const val = input.value.trim();
    if (!val) return;
    socket.emit('setTicket', { ticket: val });
    input.value = '';
    store.myVote = null;
    store.editingTicket = false;
    updateRoomUI();
  });

  document.getElementById('ticketInput').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('setTicketBtn').click();
    if (e.key === 'Escape') { store.editingTicket = false; updateRoomUI(); }
  });

  document.getElementById('editTicketBtn').addEventListener('click', () => {
    store.editingTicket = true;
    updateRoomUI();
    const input = document.getElementById('ticketInput');
    input.value = store.state?.ticket || '';
    input.focus();
    input.select();
  });

  document.getElementById('cancelTicketBtn').addEventListener('click', () => {
    store.editingTicket = false;
    updateRoomUI();
  });

  document.getElementById('revealBtn').addEventListener('click', () => {
    socket.emit('reveal');
  });

  document.getElementById('resetBtn').addEventListener('click', () => {
    socket.emit('reset');
    store.myVote = null;
    store.editingTicket = false;
  });

  renderCards();
  updateRoomUI();
}

function renderCards() {
  const row = document.getElementById('cardRow');
  row.innerHTML = '';
  CARDS.forEach(v => {
    const btn = document.createElement('button');
    btn.className = 'vote-card';
    btn.textContent = v;
    btn.dataset.value = String(v);
    btn.addEventListener('click', () => {
      if (store.state?.revealed) return;
      store.myVote = v;
      socket.emit('vote', { value: v });
      updateRoomUI();
    });
    row.appendChild(btn);
  });
}

function distributeSeats(participants) {
  // Split around the table: top row, right col, bottom row, left col.
  // Top and bottom get most of the seats; sides get fewer (limited vertical space).
  const n = participants.length;
  const zones = { top: [], right: [], bottom: [], left: [] };
  if (n === 0) return zones;
  if (n === 1) { zones.top.push(participants[0]); return zones; }
  if (n === 2) { zones.top.push(participants[0]); zones.bottom.push(participants[1]); return zones; }
  if (n === 3) { zones.top.push(participants[0]); zones.left.push(participants[1]); zones.right.push(participants[2]); return zones; }
  if (n === 4) { zones.top.push(participants[0]); zones.right.push(participants[1]); zones.bottom.push(participants[2]); zones.left.push(participants[3]); return zones; }

  // For 5+: cap sides at 2 each, put the rest on top/bottom evenly.
  const maxSide = 2;
  const sideCount = Math.min(maxSide, Math.floor((n - 2) / 4));
  const remaining = n - 2 * sideCount;
  const topCount = Math.ceil(remaining / 2);
  const bottomCount = remaining - topCount;

  let idx = 0;
  for (let i = 0; i < topCount; i++) zones.top.push(participants[idx++]);
  for (let i = 0; i < sideCount; i++) zones.right.push(participants[idx++]);
  for (let i = 0; i < bottomCount; i++) zones.bottom.push(participants[idx++]);
  for (let i = 0; i < sideCount; i++) zones.left.push(participants[idx++]);
  return zones;
}

function makeSeat(p, mySocketId, revealed) {
  const seat = document.createElement('div');
  seat.className = 'seat';
  if (p.id === mySocketId) seat.classList.add('me');

  const card = document.createElement('div');
  card.className = 'player-card';
  if (!p.hasVoted) card.classList.add('empty');
  if (!p.hasVoted && !revealed) card.classList.add('waiting');
  if (revealed && p.hasVoted) card.classList.add('flipped');

  const back = document.createElement('div');
  back.className = 'card-face-back';
  back.innerHTML = p.hasVoted ? '&spades;' : '&nbsp;';
  const front = document.createElement('div');
  front.className = 'card-face-front';
  front.textContent = p.vote !== null && p.vote !== undefined ? p.vote : '';
  card.appendChild(back);
  card.appendChild(front);

  const name = document.createElement('div');
  name.className = 'seat-name';
  if (p.isHost) {
    const crown = document.createElement('span');
    crown.className = 'host-crown';
    crown.textContent = '♛';
    name.appendChild(crown);
  }
  name.appendChild(document.createTextNode(p.name));

  seat.appendChild(card);
  seat.appendChild(name);
  return seat;
}

function updateRoomUI() {
  const s = store.state;
  if (!s) return;

  document.getElementById('roomCode').textContent = s.code;

  const me = s.participants.find(p => p.id === socket.id);
  const inRoom = !!me;

  const ticketDisplay = document.getElementById('ticketDisplay');
  const ticketEditor = document.getElementById('ticketEditor');
  const editBtn = document.getElementById('editTicketBtn');
  const cancelBtn = document.getElementById('cancelTicketBtn');

  const shouldEdit = inRoom && (store.editingTicket || !s.ticket);

  if (s.ticket) {
    ticketDisplay.textContent = s.ticket;
    ticketDisplay.classList.remove('empty');
  } else {
    ticketDisplay.textContent = 'No story set yet — enter one to start.';
    ticketDisplay.classList.add('empty');
  }

  ticketDisplay.classList.toggle('hidden', shouldEdit);
  ticketEditor.classList.toggle('hidden', !shouldEdit);
  editBtn.classList.toggle('hidden', !s.ticket || shouldEdit);
  cancelBtn.classList.toggle('hidden', !s.ticket);

  // Seats — distributed across 4 zones so they never overlap
  const zones = distributeSeats(s.participants);
  const zoneEls = {
    top: document.getElementById('seatsTop'),
    right: document.getElementById('seatsRight'),
    bottom: document.getElementById('seatsBottom'),
    left: document.getElementById('seatsLeft'),
  };
  for (const key of Object.keys(zoneEls)) {
    const el = zoneEls[key];
    el.innerHTML = '';
    zones[key].forEach(p => el.appendChild(makeSeat(p, socket.id, s.revealed)));
  }

  // Table center: status vs results
  const tableStatus = document.getElementById('tableStatus');
  if (s.revealed) {
    const dist = s.distribution || {};
    const entries = Object.entries(dist).sort((a, b) => {
      const na = Number(a[0]), nb = Number(b[0]);
      if (isNaN(na) && isNaN(nb)) return a[0].localeCompare(b[0]);
      if (isNaN(na)) return 1;
      if (isNaN(nb)) return -1;
      return na - nb;
    });
    tableStatus.innerHTML = `
      <div class="result-display">
        <div class="avg-label">Average</div>
        <div class="avg-value">${s.average !== null ? s.average : '—'}</div>
        <div class="distribution">
          ${entries.length === 0 ? '<span style="opacity:0.6">No votes</span>' : entries.map(([v, c]) => `<span class="dist-item">${v}<span class="count">×${c}</span></span>`).join('')}
        </div>
      </div>
    `;
  } else {
    const votedCount = s.participants.filter(p => p.hasVoted).length;
    const total = s.participants.length;
    const statusText = total === 0
      ? 'Waiting for players…'
      : votedCount === total
        ? 'All in — ready to reveal'
        : `${votedCount} of ${total} voted`;
    tableStatus.innerHTML = `
      <div class="table-title">The Table</div>
      <div class="table-status">${statusText}</div>
    `;
  }

  // Vote cards
  document.querySelectorAll('.vote-card').forEach(btn => {
    const val = btn.dataset.value;
    const myVal = store.myVote !== null && store.myVote !== undefined ? String(store.myVote) : null;
    btn.classList.toggle('selected', myVal === val);
    btn.disabled = s.revealed;
  });

  document.getElementById('handLabel').textContent = s.revealed ? 'Round complete' : 'Your hand';

  const hostControls = document.getElementById('hostControls');
  hostControls.classList.toggle('hidden', !inRoom);
  document.getElementById('revealBtn').disabled = s.revealed;
}

let wasRevealed = false;
let seenFirstState = false;
socket.on('state', (state) => {
  const justRevealed = seenFirstState && state.revealed && !wasRevealed;
  wasRevealed = state.revealed;
  seenFirstState = true;
  store.state = state;
  if (store.screen === 'room') updateRoomUI();
  const me = state.participants.find(p => p.id === socket.id);
  if (!me?.hasVoted) store.myVote = null;
  if (justRevealed) celebrate();
});

function celebrate() {
  launchConfetti();
  launchPoppers();
  launchTableGlow();
  launchBanner();
  launchFireworks();
  // A second wave of confetti a beat later for a longer show
  setTimeout(launchConfetti, 900);
  setTimeout(launchFireworks, 700);
  setTimeout(launchFireworks, 1500);
}

function launchConfetti() {
  const colors = [
    '#f0c95a', '#d4af37', '#f5e0a0', '#fafafa',
    '#8b1a1a', '#e04141', '#147a53', '#0f5a3f',
    '#5b8def', '#c04ee0', '#ff8a1e', '#2ee06b',
  ];
  const shapes = ['', 'circle', 'strip', 'star'];
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const N = 300;
  for (let i = 0; i < N; i++) {
    const piece = document.createElement('div');
    const shape = shapes[Math.floor(Math.random() * shapes.length)];
    piece.className = `confetti-piece ${shape}`;
    piece.style.left = `${Math.random() * 100}%`;
    const color = colors[Math.floor(Math.random() * colors.length)];
    if (shape === 'star') {
      piece.style.background = color;
    } else {
      piece.style.background = color;
    }
    piece.style.animationDelay = `${Math.random() * 1.2}s`;
    piece.style.animationDuration = `${3.5 + Math.random() * 2.5}s`;
    const drift = (Math.random() - 0.5) * 500;
    const spin = (Math.random() * 8 + 4) * 360 * (Math.random() < 0.5 ? -1 : 1);
    piece.style.setProperty('--drift', `${drift}px`);
    piece.style.setProperty('--spin', `${spin}deg`);
    container.appendChild(piece);
  }

  setTimeout(() => container.remove(), 7500);
}

function launchPoppers() {
  const positions = [
    { cls: 'left', emoji: '🎉' },
    { cls: 'right', emoji: '🎊' },
    { cls: 'top-left', emoji: '🥳' },
    { cls: 'top-right', emoji: '🎈' },
    { cls: 'bottom-left', emoji: '✨' },
    { cls: 'bottom-right', emoji: '🌟' },
  ];
  const nodes = [];
  positions.forEach((p, i) => {
    const el = document.createElement('div');
    el.className = `popper ${p.cls}`;
    el.textContent = p.emoji;
    el.style.animationDelay = `${i * 0.15}s`;
    document.body.appendChild(el);
    nodes.push(el);
  });
  setTimeout(() => nodes.forEach(n => n.remove()), 3200);
}

function launchTableGlow() {
  const table = document.querySelector('.poker-table');
  if (!table) return;
  const glow = document.createElement('div');
  glow.className = 'reveal-glow';
  table.appendChild(glow);
  setTimeout(() => glow.remove(), 2600);
}

function launchBanner() {
  const messages = [
    '🎉 GG! 🎉',
    '🌟 VOTES IN! 🌟',
    '🎊 REVEAL! 🎊',
    '✨ CONSENSUS! ✨',
    '🎉 NICE! 🎉',
  ];
  const banner = document.createElement('div');
  banner.className = 'celebration-banner';
  banner.textContent = messages[Math.floor(Math.random() * messages.length)];
  document.body.appendChild(banner);
  setTimeout(() => banner.remove(), 2800);
}

function launchFireworks() {
  const colors = ['#f0c95a', '#e04141', '#5b8def', '#2ee06b', '#c04ee0', '#ff8a1e', '#fafafa'];
  const bursts = 5;
  for (let b = 0; b < bursts; b++) {
    setTimeout(() => {
      const cx = 10 + Math.random() * 80; // vw
      const cy = 10 + Math.random() * 50; // vh
      const color = colors[Math.floor(Math.random() * colors.length)];
      const particles = 24;
      for (let p = 0; p < particles; p++) {
        const dot = document.createElement('div');
        dot.className = 'firework-particle';
        dot.style.left = `${cx}vw`;
        dot.style.top = `${cy}vh`;
        dot.style.background = color;
        dot.style.color = color;
        const angle = (Math.PI * 2 * p) / particles;
        const dist = 90 + Math.random() * 80;
        dot.style.setProperty('--fx', `${Math.cos(angle) * dist}px`);
        dot.style.setProperty('--fy', `${Math.sin(angle) * dist}px`);
        document.body.appendChild(dot);
        setTimeout(() => dot.remove(), 1500);
      }
    }, b * 180);
  }
}

socket.on('disconnect', () => {
  if (store.screen === 'room') {
    alert('Disconnected from server. Reloading…');
    location.href = location.pathname;
  }
});

render();
