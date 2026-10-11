#!/usr/bin/env node
/**
 * A2A Tic-Tac-Toe — LLM-powered via OpenRouter
 *
 * Player X: openai/gpt-4o-mini
 * Player O: anthropic/claude-3-haiku
 * Referee: JS (validate moves, check win, broadcast state)
 *
 * API key from OPENROUTER_API_KEY env var.
 */

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';
const path = require('path');
const os = require('os');
const keyFile = path.join(os.homedir(), 'prototypage_key.config');
let API_KEY = null;
try { API_KEY = require('fs').readFileSync(keyFile, 'utf8').trim(); } catch(e) {}
if (!API_KEY || API_KEY.length < 10) { console.error('Cannot read API key from', keyFile); process.exit(1); }

const AGENTS = {
  X: { model: 'openai/gpt-4o-mini', name: 'Agent X', provider: 'OpenAI', color: '#58a6ff' },
  O: { model: 'anthropic/claude-3-haiku', name: 'Agent O', provider: 'Anthropic', color: '#3fb950' },
  referee: { name: 'Referee', provider: 'DeepSeek', color: '#d2991d' }
};

function postState(s) {
  fetch('http://localhost:3200/state', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(s)
  }).catch(() => {});
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function broadcast(s) {
  postState(s);
  require('fs').writeFileSync('/tmp/game-state.json', JSON.stringify(s, null, 2));
}

async function askAgent(player, board, lastMove) {
  const a = AGENTS[player];
  const bs = board.map((c, i) => c || '.').join(' ');
  const avail = board.map((c, i) => c ? null : i).filter(x => x !== null);
  const lm = lastMove !== null ? `\nOpponent just played cell ${lastMove}.` : '';
  const strat = player === 'X'
    ? 'You play first. Strategy: center(4) → corners(0,2,6,8) → edges(1,3,5,7).'
    : 'Strategy: 1) Block any X win 2) Take your own win 3) Center 4) Corners 5) Edges.';

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
        messages: [{ role: 'user', content: `Tic-tac-toe board [${bs}]\nYou are ${a.name} (${player}). ${strat}${lm}\nAvailable cells: [${avail}]\n\nRespond with ONLY one digit.` }],
        max_tokens: 5, temperature: 0.1
      })
    });
    const d = await res.json();
    if (d.error) { console.error(`LLM err (${player}):`, d.error.message || d.error); return null; }
    const v = parseInt(d.choices?.[0]?.message?.content?.trim(), 10);
    if (isNaN(v) || v < 0 || v > 8 || board[v]) {
      console.log(`${a.name} bad response: "${d.choices?.[0]?.message?.content}"`);
      return null;
    }
    return v;
  } catch (e) {
    console.error(`API fail (${player}):`, e.message);
    return null;
  }
}

// Deterministic fallbacks
function fallbackX(board) {
  if (!board[4]) return 4;
  for (const c of [0, 2, 6, 8]) if (!board[c]) return c;
  for (const e of [1, 3, 5, 7]) if (!board[e]) return e;
  return -1;
}
function fallbackO(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] === 'X' && board[b] === 'X' && !board[c]) return c;
    if (board[a] === 'X' && board[c] === 'X' && !board[b]) return b;
    if (board[b] === 'X' && board[c] === 'X' && !board[a]) return a;
  }
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] === 'O' && board[b] === 'O' && !board[c]) return c;
    if (board[a] === 'O' && board[c] === 'O' && !board[b]) return b;
    if (board[b] === 'O' && board[c] === 'O' && !board[a]) return a;
  }
  if (!board[4]) return 4;
  for (const c of [0, 2, 6, 8]) if (!board[c]) return c;
  for (const e of [1, 3, 5, 7]) if (!board[e]) return e;
  return -1;
}

function checkWinner(board) {
  for (const [a, b, c] of WIN_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  if (board.every(c => c)) return { winner: 'draw', line: null };
  return null;
}

async function runGame() {
  const board = Array(9).fill(null);
  let turn = 'X';
  const moves = [];

  broadcast({
    board, turn, status: 'starting', thinking: 'referee',
    lastMove: null, winner: null, winLine: null,
    moveHistory: [], agents: AGENTS
  });
  await sleep(1000);

  while (true) {
    broadcast({
      board, turn, status: 'playing', thinking: turn,
      lastMove: null, winner: null, winLine: null,
      moveHistory: [...moves], agents: AGENTS
    });
    await sleep(400);

    const lastMove = moves.length ? moves[moves.length - 1].cell : null;
    let cell = await askAgent(turn, board, lastMove);

    if (cell === null) {
      console.log(`${AGENTS[turn].name} LLM failed, using fallback`);
      cell = turn === 'X' ? fallbackX(board) : fallbackO(board);
      if (cell < 0) break;
    }

    board[cell] = turn;
    moves.push({ player: turn, cell });

    const result = checkWinner(board);
    if (result) {
      broadcast({
        board, turn, status: 'over', thinking: null, lastMove: cell,
        winner: result.winner, winLine: result.line,
        moveHistory: [...moves], agents: AGENTS
      });
      console.log(`Game over: ${result.winner === 'draw' ? 'Draw' : AGENTS[result.winner].name + ' wins'}`);
      return;
    }

    broadcast({
      board, turn, status: 'playing', thinking: null, lastMove: cell,
      winner: null, winLine: null,
      moveHistory: [...moves], agents: AGENTS
    });
    await sleep(500);
    turn = turn === 'X' ? 'O' : 'X';
  }
}

runGame().catch(e => { console.error('Game error:', e); process.exit(1); });