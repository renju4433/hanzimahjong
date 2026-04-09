const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const { WebSocketServer } = require('ws');

const PORT = process.env.PORT || 3000;
const ROOM_CODE_LEN = 6;
const WIN_PAIR_COUNT = 4;
const HAND_BASE = WIN_PAIR_COUNT * 2 - 1;
const DRAW_COUNT = 1;

const app = express();
const publicDir = path.join(__dirname, 'public');

app.use(
  express.static(publicDir, {
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      } else if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
      }
    },
  }),
);

app.get('/', (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/app.js', (_req, res) => {
  res.type('application/javascript; charset=utf-8');
  res.sendFile(path.join(publicDir, 'app.js'));
});

app.get('/style.css', (_req, res) => {
  res.type('text/css; charset=utf-8');
  res.sendFile(path.join(publicDir, 'style.css'));
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function isChineseChar(ch) {
  return /[\u4e00-\u9fff]/.test(ch);
}

function extractChineseChars(text) {
  return [...text].filter(isChineseChar);
}

function loadLexicon(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter(Boolean);
  const words = [];
  const allChars = new Set();

  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i].split('\t');
    const word = (cols[0] || '').trim();
    if (!word) continue;

    const chars = extractChineseChars(word);
    if (chars.length === 0) continue;

    chars.forEach((c) => allChars.add(c));
    if (chars.length === 2) words.push(chars.join(''));
  }

  return {
    twoCharWords: [...new Set(words)],
    allChars: [...allChars],
  };
}

const { twoCharWords, allChars } = loadLexicon(path.join(__dirname, 'ciyu.txt'));

if (twoCharWords.length === 0 || allChars.length === 0) {
  throw new Error('词库加载失败：未提取到有效词语或汉字');
}

const WORD_SET = new Set(twoCharWords);

function countMap(arr) {
  const map = new Map();
  for (const item of arr) {
    map.set(item, (map.get(item) || 0) + 1);
  }
  return map;
}

function canTake(map, a, b) {
  const n1 = map.get(a) || 0;
  const n2 = map.get(b) || 0;
  if (a === b) return n1 >= 2;
  return n1 >= 1 && n2 >= 1;
}

function take(map, a, b) {
  if (!canTake(map, a, b)) return false;
  if (a === b) {
    const n = map.get(a);
    if (n === 2) map.delete(a);
    else map.set(a, n - 2);
    return true;
  }
  const n1 = map.get(a);
  const n2 = map.get(b);
  if (n1 === 1) map.delete(a);
  else map.set(a, n1 - 1);
  if (n2 === 1) map.delete(b);
  else map.set(b, n2 - 1);
  return true;
}

function putBack(map, a, b) {
  map.set(a, (map.get(a) || 0) + 1);
  map.set(b, (map.get(b) || 0) + 1);
}

function allPairsFromKeys(keys) {
  const pairs = [];
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i; j < keys.length; j += 1) {
      const a = keys[i];
      const b = keys[j];
      const w1 = a + b;
      const w2 = b + a;
      if (WORD_SET.has(w1)) pairs.push({ a, b, word: w1 });
      else if (WORD_SET.has(w2)) pairs.push({ a, b, word: w2 });
    }
  }
  return pairs;
}

function findWinningPairs(chars, pairCount = WIN_PAIR_COUNT) {
  if (!Array.isArray(chars) || chars.length !== pairCount * 2) {
    return [];
  }

  const counts = countMap(chars);
  const keys = [...counts.keys()].sort((x, y) => x.localeCompare(y, 'zh-Hans-CN'));
  const candidatePairs = allPairsFromKeys(keys);
  const res = [];
  const seen = new Set();

  function dfs(depth, picked) {
    if (depth === pairCount) {
      const combo = [...picked].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
      const key = combo.join('|');
      if (!seen.has(key)) {
        seen.add(key);
        res.push(combo);
      }
      return;
    }

    for (const p of candidatePairs) {
      if (!take(counts, p.a, p.b)) continue;
      picked.push(p.word);
      dfs(depth + 1, picked);
      picked.pop();
      putBack(counts, p.a, p.b);
    }
  }

  dfs(0, []);
  return res;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function randomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < ROOM_CODE_LEN; i += 1) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

function buildDeck() {
  const deck = [];
  for (const c of allChars) {
    for (let i = 0; i < 4; i += 1) {
      deck.push(c);
    }
  }
  return shuffle(deck);
}

const rooms = new Map();

function createRoom() {
  let code = randomCode();
  while (rooms.has(code)) code = randomCode();

  const room = {
    code,
    players: [],
    deck: [],
    discard: [],
    turn: 0,
    started: false,
    winner: null,
    winWords: null,
  };

  rooms.set(code, room);
  return room;
}

function deal(room) {
  room.deck = buildDeck();
  room.discard = [];
  room.winner = null;
  room.winWords = null;
  room.turn = 0;

  room.players.forEach((p) => {
    p.hand = [];
    for (let i = 0; i < HAND_BASE; i += 1) {
      p.hand.push(room.deck.pop());
    }
  });

  room.started = room.players.length >= 1;
}

function getPlayerIndex(room, ws) {
  return room.players.findIndex((p) => p.ws === ws);
}

function safeSend(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function roomPublicState(room, perspective = -1) {
  const me = perspective >= 0 ? room.players[perspective] : null;
  const opp = perspective >= 0 ? room.players[1 - perspective] : null;
  const myCombos = me ? findWinningPairs(me.hand) : [];

  return {
    type: 'state',
    rule: {
      winPairCount: WIN_PAIR_COUNT,
      handBase: HAND_BASE,
    },
    roomCode: room.code,
    started: room.started,
    turn: room.turn,
    deckLeft: room.deck.length,
    discard: room.discard,
    discardTop: room.discard.length ? room.discard[room.discard.length - 1] : null,
    winner: room.winner,
    winWords: room.winWords,
    players: room.players.map((p, idx) => ({
      idx,
      name: p.name,
      handCount: p.hand.length,
      online: p.ws.readyState === p.ws.OPEN,
    })),
    me: me
      ? {
          idx: perspective,
          name: me.name,
          hand: me.hand,
          canWin: myCombos.length > 0,
          winCombos: myCombos,
          isMyTurn: room.turn === perspective && !room.winner,
        }
      : null,
    opponent: opp
      ? {
          idx: 1 - perspective,
          name: opp.name,
          handCount: opp.hand.length,
        }
      : null,
    waiting: room.players.length < 2 ? '等待另一位玩家加入房间' : null,
  };
}

function broadcastRoom(room) {
  room.players.forEach((p, idx) => {
    safeSend(p.ws, roomPublicState(room, idx));
  });
}

function autoDrawForCurrentTurn(room) {
  if (!room.started || room.winner) return;
  const current = room.players[room.turn];
  if (!current) return;
  if (current.hand.length === HAND_BASE) {
    playerDraw(room, room.turn);
  }
}

function playerDraw(room, idx) {
  if (room.deck.length === 0) {
    room.winner = 'draw';
    room.winWords = null;
    return false;
  }
  for (let i = 0; i < DRAW_COUNT; i += 1) {
    const card = room.deck.pop();
    if (card) room.players[idx].hand.push(card);
  }
  return true;
}

function startIfReady(room) {
  if (room.players.length >= 1 && !room.started) {
    deal(room);
    autoDrawForCurrentTurn(room);
    broadcastRoom(room);
    return;
  }

  if (room.players.length === 2) {
    const bothHaveHand = room.players.every((p) => Array.isArray(p.hand) && p.hand.length > 0);
    if (!bothHaveHand) {
      deal(room);
      autoDrawForCurrentTurn(room);
      broadcastRoom(room);
    }
  }
}

function handleCreate(ws, payload) {
  const name = String(payload.name || '').trim() || '玩家A';
  const room = createRoom();

  room.players.push({ ws, name, hand: [] });
  ws._roomCode = room.code;

  safeSend(ws, { type: 'created', roomCode: room.code });
  startIfReady(room);
}

function handleJoin(ws, payload) {
  const roomCode = String(payload.roomCode || '').trim().toUpperCase();
  const name = String(payload.name || '').trim() || '玩家B';
  const room = rooms.get(roomCode);

  if (!room) return safeSend(ws, { type: 'error', message: '房间不存在' });
  if (room.players.length >= 2) return safeSend(ws, { type: 'error', message: '房间已满' });

  room.players.push({ ws, name, hand: [] });
  ws._roomCode = room.code;

  safeSend(ws, { type: 'joined', roomCode: room.code });
  startIfReady(room);
}

function handleDraw(ws) {
  // 改为自动摸牌后，保留接口兼容但不再执行手动摸牌逻辑。
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  broadcastRoom(room);
}

function handleDiscard(ws, payload) {
  const room = rooms.get(ws._roomCode);
  if (!room || !room.started || room.winner) return;

  const idx = getPlayerIndex(room, ws);
  if (idx < 0 || room.turn !== idx) return;

  const card = String(payload.card || '').trim();
  const my = room.players[idx];
  if (my.hand.length !== HAND_BASE + DRAW_COUNT) return;

  const hit = my.hand.indexOf(card);
  if (hit < 0) return;

  my.hand.splice(hit, 1);
  room.discard.push(card);
  room.turn = room.players.length >= 2 ? 1 - room.turn : 0;
  autoDrawForCurrentTurn(room);

  broadcastRoom(room);
}

function handleWin(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room || !room.started || room.winner) return;

  const idx = getPlayerIndex(room, ws);
  if (idx < 0 || room.turn !== idx) return;

  const my = room.players[idx];
  const combos = findWinningPairs(my.hand);

  if (combos.length === 0) {
    safeSend(ws, { type: 'error', message: `当前手牌未满足${WIN_PAIR_COUNT}对词语` });
    return;
  }

  room.winner = idx;
  room.winWords = combos[0];
  broadcastRoom(room);
}

function handleRestart(ws) {
  const room = rooms.get(ws._roomCode);
  if (!room) return;
  if (room.players.length < 1) {
    safeSend(ws, { type: 'error', message: '房间为空，无法重开' });
    return;
  }

  deal(room);
  autoDrawForCurrentTurn(room);
  broadcastRoom(room);
}

function removeClient(ws) {
  const code = ws._roomCode;
  if (!code) return;

  const room = rooms.get(code);
  if (!room) return;

  room.players = room.players.filter((p) => p.ws !== ws);

  if (room.players.length === 0) {
    rooms.delete(code);
    return;
  }

  room.started = false;
  room.winner = null;
  room.winWords = null;
  room.players.forEach((p) => {
    p.hand = [];
  });

  broadcastRoom(room);
}

wss.on('connection', (ws) => {
  safeSend(ws, { type: 'hello', message: '连接成功' });

  ws.on('message', (raw) => {
    let payload;
    try {
      payload = JSON.parse(String(raw));
    } catch {
      return safeSend(ws, { type: 'error', message: '消息格式错误' });
    }

    if (payload.action === 'createRoom') return handleCreate(ws, payload);
    if (payload.action === 'joinRoom') return handleJoin(ws, payload);
    if (payload.action === 'draw') return handleDraw(ws);
    if (payload.action === 'discard') return handleDiscard(ws, payload);
    if (payload.action === 'win') return handleWin(ws);
    if (payload.action === 'restart') return handleRestart(ws);

    safeSend(ws, { type: 'error', message: '未知操作' });
  });

  ws.on('close', () => {
    removeClient(ws);
  });
});

server.listen(PORT, () => {
  console.log(`汉字麻将服务已启动: http://localhost:${PORT}`);
  console.log(`规则: ${WIN_PAIR_COUNT}对二字词语和牌`);
  console.log(`二字词语数量: ${twoCharWords.length}`);
  console.log(`汉字牌库种类: ${allChars.length}`);
});
