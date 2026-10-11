const express = require('express');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = 3200;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// SSE clients
const clients = new Set();

// Game state
let gameState = {
  board: Array(9).fill(null),
  turn: 'X',
  status: 'waiting',     // waiting | thinking | playing | over
  thinking: null,         // 'X' | 'O' | null
  lastMove: null,         // index
  winner: null,           // 'X' | 'O' | 'draw' | null
  winLine: null,          // [a,b,c] winning indices
  moveHistory: [],
  gameCount: 0
};

function broadcast(event, data) {
  const payload = `data: ${JSON.stringify({ event, ...data })}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

// SSE endpoint
app.get('/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  clients.add(res);

  // Send current state on connect
  res.write(`data: ${JSON.stringify({ event: 'sync', ...gameState })}\n\n`);

  req.on('close', () => {
    clients.delete(res);
  });
});

// POST /state — referee updates game state
app.post('/state', (req, res) => {
  const { board, turn, status, thinking, lastMove, winner, winLine, moveHistory } = req.body;

  gameState = {
    board: board || gameState.board,
    turn: turn || gameState.turn,
    status: status || gameState.status,
    thinking: thinking !== undefined ? thinking : gameState.thinking,
    lastMove: lastMove !== undefined ? lastMove : gameState.lastMove,
    winner: winner !== undefined ? winner : gameState.winner,
    winLine: winLine !== undefined ? winLine : gameState.winLine,
    moveHistory: moveHistory || gameState.moveHistory,
    gameCount: gameState.gameCount
  };

 ;


  const event = status === 'over' ? 'gameover' :
                 thinking ? 'thinking' : 'move';
  broadcast(event, { board: gameState.board, turn: gameState.turn, lastMove: gameState.lastMove, winner: gameState.winner, winnLine: gameState.winLine, thinking: gameState.thinkinng, status: gameState.status, moveHistory: gameState.moveHistory, gameCount: gameState.gameCount });

  res.json({ ok: true });
});

// POST /reset — restart the game
app.post('/reset', (req, res) => {
  gameState = {
    board: Array(9).fill(null),
    turn: 'X',
    status: 'waiting',
    thinking: null,
    lastMove: null,
    winner: null,
    winLine: null,
    moveHistory: [],
    gameCount: gameState.gameCount + 1
  };
  broadcast('reset', gameState);

  // Kill existing runner and start a new one
  if (runnerProcess) {
    runnerProcess.kill();
    runnerProcess = null;
  }
  startGameRunner();

  res.json({ ok: true });
});

let runnerProcess = null;

function startGameRunner() {
  runnerProcess = spawn('node', ['game-runner.js'], {
    cwd: __dirname,
    stdio: ['pipe', 'inherit', 'inherit']
  });

  runnerProcess.on('exit', (code) => {
    if (code !== 0 && runnerProcess) {
      console.log(`Game runner exited with code ${code}`);
    }
    runnerProcess = null;
  });
}

app.listen(PORT, () => {
  console.log(`🎮  Tic-Tac-Toe AI Spectator → http://localhost:${PORT}`);
  // Auto-start first game after a brief delay
  setTimeout(startGameRunner, 500);
});