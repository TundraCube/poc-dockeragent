const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = 3200;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const clients = new Set();

let gameState = {
  board: Array(9).fill(null),
  turn: 'X',
  status: 'idle',      // idle | starting | playing | over
  thinking: null,
  lastMove: null,
  winner: null,
  winLine: null,
  moveHistory: [],
  gameCount: 0,
  agents: {
    X: { name: 'Agent X', strategy: 'Center-First (OpenAI)', color: '#58a6ff' },
    O: { name: 'Agent O', strategy: 'Block-First (Anthropic)', color: '#3fb950' },
    referee: { name: 'Referee', strategy: 'Orchestrator (DeepSeek)', color: '#d2991d' }
  }
};

function broadcast(payload) {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) client.write(line);
}

app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  clients.add(res);
  broadcast({ event: 'sync', ...gameState });
  req.on('close', () => clients.delete(res));
});

app.post('/state', (req, res) => {
  const { board, turn, status, thinking, lastMove, winner, winLine, moveHistory, agents } = req.body;
  Object.assign(gameState, {
    board: board ?? gameState.board,
    turn: turn ?? gameState.turn,
    status: status ?? gameState.status,
    thinking: thinking !== undefined ? thinking : gameState.thinking,
    lastMove: lastMove !== undefined ? lastMove : gameState.lastMove,
    winner: winner !== undefined ? winner : gameState.winner,
    winLine: winLine !== undefined ? winLine : gameState.winLine,
    moveHistory: moveHistory || gameState.moveHistory,
    agents: agents || gameState.agents
  });

  const ev = status === 'over' ? 'gameover'
    : status === 'starting' ? 'thinking'
    : thinking ? 'thinking' : 'move';
  broadcast({ event: ev, ...gameState });
  res.json({ ok: true });
});

let runnerProcess = null;

function startGameRunner() {
  if (runnerProcess) return;
  runnerProcess = spawn('node', ['game-runner.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'inherit', 'inherit'],
    env: { ...process.env }
  });
  runnerProcess.on('exit', () => { runnerProcess = null; });
}

app.post('/start', (req, res) => {
  if(gameState.status === 'playing') {
   return res.json({ error: 'Game already in progress' });
 }
  gameState = {
    board: Array(9).fill(null),
    turn: 'X',
    status: 'starting',
    thinking: 'referee',
    lastMove: null,
    winner: null,
    winLine: null,
    moveHistory: [],
    gameCount: gameState.gameCount + 1,
    agents: gameState.agents
  };
  broadcast({ event: 'reset', ...gameState });
  if (runnerProcess) { runnerProcess.kill(); runnerProcess = null; }
  setTimeout(startGameRunner, 300);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Tic-Tac-Toe A2A -> http://localhost:${PORT}`);
});