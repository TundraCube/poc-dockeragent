const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3200;

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const WIN_LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];

let API_KEY = null;
try { API_KEY = fs.readFileSync('/home/openclaw/prototypage_key.config', 'utf8').trim(); } catch(e) {}
if (!API_KEY) console.warn('No API key — games will use fallback heuristics');

const AGENTS = {
  X: { model: 'openai/gpt-4o-mini', name: 'Agent X', provider: 'OpenAI', color: '#58a6ff' },
  O: { model: 'anthropic/claude-haiku-4.5', name: 'Agent O', provider: 'Anthropic', color: '#3fb950' },
  referee: { name: 'Referee', provider: 'DeepSeek', color: '#d2991d' }
};

function freshState() {
  return {
    board: Array(9).fill(null), turn: 'X', status: 'idle',
    thinking: null, lastMove: null, winner: null, winLine: null,
    moveHistory: [], gameCount: 0, agents: AGENTS
  };
}

let gs = freshState();
const clients = new Set();
let gameRunning = false;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function broadcast(eventName, data) {
  const payload = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(payload);
}

app.get('/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' });
  clients.add(res);
  broadcast('sync', gs);
  req.on('close', () => clients.delete(res));
});

app.get('/state', (req, res) => res.json(gs));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Ask an LLM agent for their move; returns null on failure
async function askAgent(player, board, lastMove) {
  const a = AGENTS[player];
  const bs = board.map((c, i) => c || '.').join(' ');
  const avail = board.map((c, i) => c ? null : i).filter(x => x !== null);
  const lm = lastMove !== null ? `\nOpponent just played cell ${lastMove}.` : '';
  const strat = player === 'X'
    ? 'You play first. Strategy: center(4) → corners(0,2,6,8) → edges(1,3,5,7).'
    : '1) Block any X win 2) Take your win 3) Center 4) Corners 5) Edges.';

  try {
    const res = await fetch(OPENROUTER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`,
        'HTTP-Referer': 'https://github.com/TundraCube/poc-dockeragent',
        'X-Title': 'A2A Tic-Tac-Toe'
      },
      body: JSON.stringify({
        model: a.model,
        messages: [{ role: 'system', content: `You are ${a.name}. Output ONLY one digit (0-8). No explanation. Nothing else.` },
          { role: 'user', content: `Board [${bs}]\nAvailable: [${avail}]\nYour move:` }],
        max_tokens: 5, temperature: 0.1
      })
    });
    if (!res.ok) { console.error(`${player} HTTP ${res.status}`); return null; }
    const d = await res.json();
    if (d.error) { console.error(`${player} err:`, d.error.message); return null; }
    const raw = d.choices?.[0]?.message?.content || '';
    // Extract first digit from response regardless of surrounding text
    const match = raw.match(/\d/);
    const v = match ? parseInt(match[0], 10) : NaN;
    if (isNaN(v) || v < 0 || v > 8 || board[v]) {
      console.log(`${a.name} bad: "${d.choices?.[0]?.message?.content}"`); return null;
    }
    return v;
  } catch (e) { console.error(`${player} fail:`, e.message); return null; }
}

// Deterministic fallbacks
function fallbackX(b) {
  if (!b[4]) return 4;
  for (const c of [0,2,6,8]) if (!b[c]) return c;
  for (const e of [1,3,5,7]) if (!b[e]) return e;
  return -1;
}
function fallbackO(b) {
  for (const [a,c,d] of WIN_LINES) {
    if (b[a]==='X'&&b[c]==='X'&&!b[d]) return d;
    if (b[a]==='X'&&b[d]==='X'&&!b[c]) return c;
    if (b[c]==='X'&&b[d]==='X'&&!b[a]) return a;
  }
  for (const [a,c,d] of WIN_LINES) {
    if (b[a]==='O'&&b[c]==='O'&&!b[d]) return d;
    if (b[a]==='O'&&b[d]==='O'&&!b[c]) return c;
    if (b[c]==='O'&&b[d]==='O'&&!b[a]) return a;
  }
  if (!b[4]) return 4;
  for (const c of [0,2,6,8]) if (!b[c]) return c;
  for (const e of [1,3,5,7]) if (!b[e]) return e;
  return -1;
}

function checkWinner(b) {
  for (const [a,c,d] of WIN_LINES)
    if (b[a] && b[a]===b[c] && b[a]===b[d]) return { winner: b[a], line: [a,c,d] };
  if (b.every(c => c)) return { winner: 'draw', line: null };
  return null;
}

function emit(overrides) {
  Object.assign(gs, overrides);
  const eventName = gs.status === 'over' ? 'gameover'
    : gs.status === 'starting' ? 'reset'
    : gs.thinking ? 'thinking' : 'move';
  broadcast(eventName, {
    board: [...gs.board], turn: gs.turn, status: gs.status,
    thinking: gs.thinking, lastMove: gs.lastMove, winner: gs.winner, winLine: gs.winLine,
    moveHistory: [...gs.moveHistory], gameCount: gs.gameCount, agents: AGENTS
  });
}

async function runGame() {
  if (gameRunning) return;
  gameRunning = true;

  gs.board = Array(9).fill(null);
  gs.turn = 'X'; gs.status = 'starting'; gs.thinking = 'referee';
  gs.lastMove = null; gs.winner = null; gs.winLine = null; gs.moveHistory = [];
  gs.gameCount++;
  emit({});

  await sleep(1200);

  while (gs.status !== 'over') {
    emit({ thinking: gs.turn, lastMove: null, status: 'playing' });
    await sleep(500);

    const lm = gs.moveHistory.length ? gs.moveHistory[gs.moveHistory.length - 1].cell : null;
    let cell = API_KEY ? await askAgent(gs.turn, gs.board, lm) : null;

    if (cell === null) {
      cell = gs.turn === 'X' ? fallbackX(gs.board) : fallbackO(gs.board);
      if (cell < 0) break;
    }

    gs.board[cell] = gs.turn;
    gs.moveHistory.push({ player: gs.turn, cell });

    const result = checkWinner(gs.board);
    if (result) {
      emit({ thinking: null, lastMove: cell, winner: result.winner, winLine: result.line, status: 'over' });
      console.log(`Game: ${result.winner === 'draw' ? 'Draw' : AGENTS[result.winner].name + ' wins'}`);
      break;
    }

    emit({ thinking: null, lastMove: cell });
    await sleep(300);
    gs.turn = gs.turn === 'X' ? 'O' : 'X';
  }
  gameRunning = false;
}

app.post('/start', (req, res) => {
  res.json({ ok: true });
  runGame();
});

app.listen(PORT, () => console.log(`Tic-Tac-Toe → http://localhost:${PORT}`));