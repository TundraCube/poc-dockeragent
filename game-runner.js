#!/usr/bin/env node
/**
 * A2A Tic-Tac-Toe Game Loop
 *
 * Simulates docker-agent's A2A protocol:
 *   Referee sends board → agent "thinks" → returns move → Referee validates → broadcasts
 *
 * Game state is written to BOTH:
 *   1. /tmp/game-state.json  (for docker-agent compatibility)
 *   2. POST localhost:3200/state  (for real-time SSE streaming to UI)
 */

const fs = require('fs');
const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const STATE_FILE = '/tmp/game-state.json';
const SERVER = 'http://localhost:3200';

// Agent definitions — shown in UI
const AGENTS = {
  X: { name: 'Agent X', strategy: 'Center-First', color: '#58a6ff' },
  O: { name: 'Agent O', strategy: 'Block-First', color: '#3fb950' },
  referee: { name: 'Referee', strategy: 'Orchestrator', color: '#d2991d' }
};

function postState(state) {
  fetch(SERVER + '/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  }).catch(() => {});
}

function writeStateFile(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function broadcast(state) {
  postState(state);
  writeStateFile(state);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// Player X: center-first
function agentX(board) {
  if (!board[4]) return 4;
  for (const c of [0, 2, 6, 8]) if (!board[c]) return c;
  for (const e of [1, 3, 5, 7]) if (!board[e]) return e;
  return -1;
}

// Player O: block + win + center
function agentO(board) {
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

  // Initial state — referee announces game start
  broadcast({
    board, turn, status: 'starting',
    thinking: 'referee', lastMove: null, winner: null,
    winLine: null, moveHistory: [], agents: AGENTS
  });
  await sleep(1200);

  while (true) {
    // Agent "thinking"
    broadcast({
      board, turn, status: 'playing',
      thinking: turn, lastMove: null, winner: null,
      winLine: null, moveHistory: [...moves], agents: AGENTS
    });
    await sleep(1000 + Math.random() * 800);

    const move = turn === 'X' ? agentX(board) : agentO(board);
    if (move < 0) break;

    board[move] = turn;
    moves.push({ player: turn, cell: move });

    const result = checkWinner(board);

    if (result) {
      broadcast({
        board, turn, status: 'over',
        thinking: null, lastMove: move,
        winner: result.winner, winLine: result.line,
        moveHistory: [...moves], agents: AGENTS
      });
      console.log(`Game over: ${result.winner === 'draw' ? 'Draw' : result.winner + ' wins'}`);
      return;
    }

    broadcast({
      board, turn, status: 'playing',
      thinking: null, lastMove: move,
      winner: null, winLine: null,
      moveHistory: [...moves], agents: AGENTS
    });
    await sleep(600);
    turn = turn === 'X' ? 'O' : 'X';
  }

  // Full board = draw
  broadcast({
    board, turn, status: 'over',
    thinking: null, lastMove: null,
    winner: 'draw', winLine: null,
    moveHistory: [...moves], agents: AGENTS
  });
}

runGame().catch(e => {
  console.error('Game error:', e);
  process.exit(1);
});