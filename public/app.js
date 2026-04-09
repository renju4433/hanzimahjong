const lobbyEl = document.getElementById('lobby');
const tableWrapEl = document.getElementById('tableWrap');

const playerNameEl = document.getElementById('playerName');
const roomCodeEl = document.getElementById('roomCode');

const createRoomBtn = document.getElementById('createRoom');
const joinRoomBtn = document.getElementById('joinRoom');

const roomTextEl = document.getElementById('roomText');
const deckTextEl = document.getElementById('deckText');
const turnTextEl = document.getElementById('turnText');
const discardTextEl = document.getElementById('discardText');
const resultTextEl = document.getElementById('resultText');
const comboTextEl = document.getElementById('comboText');

const oppNameEl = document.getElementById('oppName');
const oppCountEl = document.getElementById('oppCount');
const oppTilesEl = document.getElementById('oppTiles');

const topWallEl = document.getElementById('topWall');
const bottomWallEl = document.getElementById('bottomWall');

const discardAreaEl = document.getElementById('discardArea');
const playerAreaEl = document.getElementById('playerArea');

const winBtn = document.getElementById('winBtn');
const restartBtn = document.getElementById('restartBtn');

const wsUrl = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
const ws = new WebSocket(wsUrl);

function send(action, payload = {}) {
  ws.send(JSON.stringify({ action, ...payload }));
}

function makeTile(char, kind = 'me') {
  const tile = document.createElement('div');
  tile.className = `tile ${kind}`;

  if (kind === 'hidden' || kind === 'wall') return tile;

  const face = document.createElement('div');
  face.className = 'tile-face';
  face.textContent = char;
  tile.appendChild(face);
  return tile;
}

function renderStaticWalls() {
  topWallEl.innerHTML = '';
  bottomWallEl.innerHTML = '';

  for (let i = 0; i < 8; i += 1) {
    topWallEl.appendChild(makeTile('', 'wall'));
    bottomWallEl.appendChild(makeTile('', 'wall'));
  }
}

function updateUI(state) {
  lobbyEl.classList.add('hidden');
  tableWrapEl.classList.remove('hidden');

  const base = state.rule?.handBase ?? 7;

  roomTextEl.textContent = state.roomCode;
  deckTextEl.textContent = String(state.deckLeft);
  discardTextEl.textContent = state.discardTop || '-';

  if (!state.started) {
    turnTextEl.textContent = state.waiting || '等待开局';
  } else {
    turnTextEl.textContent = state.turn === state.me.idx ? '你' : '对家';
  }

  oppNameEl.textContent = state.opponent?.name || '对家';
  oppCountEl.textContent = `手牌 ${state.opponent?.handCount ?? 0}`;

  oppTilesEl.innerHTML = '';
  for (let i = 0; i < (state.opponent?.handCount || 0); i += 1) {
    oppTilesEl.appendChild(makeTile('', 'hidden'));
  }

  playerAreaEl.innerHTML = '';
  const hand = state.me?.hand || [];
  const canDiscard = state.me?.isMyTurn && hand.length === base + 1 && !state.winner;

  hand.forEach((ch) => {
    const tile = makeTile(ch, 'me');
    if (canDiscard) {
      tile.title = '点击打出此牌';
      tile.addEventListener('click', () => send('discard', { card: ch }));
    }
    playerAreaEl.appendChild(tile);
  });

  discardAreaEl.innerHTML = '';
  const list = state.discard || [];
  const maxShow = 48;
  const start = Math.max(0, list.length - maxShow);
  list.slice(start).forEach((ch, idx, arr) => {
    const t = makeTile(ch, 'discard');
    if (idx === arr.length - 1) t.classList.add('flash');
    discardAreaEl.appendChild(t);
  });

  winBtn.disabled = !(state.me?.isMyTurn && state.me?.canWin && !state.winner);
  restartBtn.disabled = !(state.started && state.players?.length === 2);

  const pairN = state.rule?.winPairCount ?? 4;
  comboTextEl.textContent = state.me?.canWin
    ? `可和牌: ${(state.me.winCombos || []).map((c) => c.join(' / ')).join('  ||  ')}`
    : `当前未形成${pairN}对二字词语`;

  if (state.winner === 'draw') {
    resultTextEl.textContent = '流局：牌墙已空';
  } else if (typeof state.winner === 'number') {
    resultTextEl.textContent =
      state.winner === state.me.idx
        ? `你和牌了：${(state.winWords || []).join(' / ')}`
        : `对家和牌：${(state.winWords || []).join(' / ')}`;
  } else {
    resultTextEl.textContent = '';
  }
}

createRoomBtn.addEventListener('click', () => {
  const name = playerNameEl.value.trim() || '玩家A';
  send('createRoom', { name });
});

joinRoomBtn.addEventListener('click', () => {
  const name = playerNameEl.value.trim() || '玩家B';
  const roomCode = roomCodeEl.value.trim().toUpperCase();
  if (!roomCode) return alert('请输入房间码');
  send('joinRoom', { name, roomCode });
});

winBtn.addEventListener('click', () => send('win'));
restartBtn.addEventListener('click', () => send('restart'));

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);

  if (msg.type === 'created' || msg.type === 'joined') {
    roomCodeEl.value = msg.roomCode;
    return;
  }

  if (msg.type === 'state') {
    updateUI(msg);
    return;
  }

  if (msg.type === 'error') {
    alert(msg.message);
  }
});

ws.addEventListener('open', () => {
  renderStaticWalls();
});

ws.addEventListener('close', () => {
  alert('连接已断开，请刷新页面重连');
});
