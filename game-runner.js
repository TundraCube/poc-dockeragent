/**
 * Game Runner - orchestrates the A2A-style tic-tac-toe match.
 *
 * Simulates docker-agent A2A protocol:
 *   Referee sends board state to player agent -> agent "thinks" -> returns move
 *
 * In full docker-agent mode each agent would be a separate container.
 * Here, agent logic is inlined for the POC.
 */

const WIN_LINES = [
  [0, 1, 2], [3, 4, 5], [6, 7, 8],
  [0, 3, 6], [1, 4, 7], [2, 5, 8],
  [0, 4, 8], [2, 4, 6]
];

const SERVER = 'http://localhost:3200';

function postState(state) {
  return fetch(SERVER + '/state', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(state)
  });
}

function sleep(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

// ---- Player X: center-first heuristic ----
function agentX(board) {
  if (!board[4]) return 4;
  var corners = [0, 2, 6, 8].filter(function (i) { return !board[i]; });
  if (corners.length) return corners[0];
  var edges = [1, 3, 5, 7].filter(function (i) { return !board[i]; });
  return edges.length ? edges[0] : -1;
}

// ---- Player O: block-first heuristic ----
function agentO(board) {
  // Block X win
  for (var w = 0; w < WIN_LINES.length; w++) {
    var a = WIN_LINES[w][0], b = WIN_LINES[w][1], c = WIN_LINES[w][2];
    if (board[a] === 'X' && board[b] === 'X' && !board[c]) return c;
    if (board[a] === 'X' && board[c] === 'X' && !board[b]) return b;
    if (board[b] === 'X' && board[c] === 'X' && !board[a]) return a;
  }
  // Try to win
  for (var w2 = 0; w2 < WIN_LINES.length; w2++) {
    var a2 = WIN_LINES[w2][0], b2 = WIN_LINES[w2][1], c2 = WIN_LINES[w2][2];
    if (board[a2] === 'O' && board[b2] === 'O' && !board[c2]) return c2;
    if (board[a2] === 'O' && board[c2] === 'O' && !board[b2]) return b2;
    if (board[b2] === 'O' && board[c2] === 'O' && !board[a2]) return a2;
  }
  // Center
  if (!board[4]) return 4;
  // Corners
  var corners = [0, 2, 6, 8].filter(function (i) { return !board[i]; });
  if (corners.length) return corners[0];
  // Edges
  var edges = [1, 3, 5, 7].filter(function (i) { return !board[i]; });
  return edges.length ? edges[0] : -1;
}

function checkWinner(board) {
  for (var w = 0; w < WIN_LINES.length; w++) {
    var a = WIN_LINES[w][0], b = WIN_LINES[w][1], c = WIN_LINES[w][2];
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] };
    }
  }
  var full = board.every(function (c) { return c; });
  if (full) return { winner: 'draw', line: null };
  return null;
}

// ---- Main game loop ----
async function runGame() {
  var board = Array(9).fill(null);
  var turn = 'X';
  var moveHistory = [];

  while (true) {
    await postState({
      board: board, turn: turn, status: 'playing',
      thinking: turn, lastMove: null, winner: null,
      winLine: null, moveHistory: moveHistory
    });

    var thinkMs = 1000 + Math.random() * 1000;
    await sleep(thinkMs);

    var move = turn === 'X' ? agentX(board) : agentO(board);

    if (move < 0) break;

    board[move] = turn;
    moveHistory.push({ player: turn, cell: move });

    var result = checkWinner(board);

    if (result) {
      await postState({
        board: board, turn: turn, status: 'over',
        thinking: null, lastMove: move,
        winner: result.winner, winLine: result.line,
        moveHistory: moveHistory
      });
      return;
    }

    await postState({
      board: board, turn: turn, status: 'playing',
      thinking: null, lastMove: move,
      winner: null, winLine: null,
      moveHistory: moveHistory
    });

    turn = turn === 'X' ? 'O' : 'X';
  }

  // Draw (board full, no winner caught above)
  await postState({
    board: board, turn: turn, status: 'over',
    thinking: null, lastMove: null,
    winner: 'draw', winLine: null,
    moveHistory: moveHistory
  });
}

runGame().catch(function (e) {
  console.error('Game runner error:', e);
  process.exit(1);
});