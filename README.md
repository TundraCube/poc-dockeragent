# Tic-Tac-Toe AI vs AI Spectator

Two AI agents play tic-tac-toe against each other with a referee orchestrating, and a real-time web UI for spectators.

## Architecture

- **Player X** — center-first heuristic
- **Player O** — block-first heuristic (blocks X wins, tries to win, then center/corners/edges)
- **Referee** — game loop, validates moves, checks win conditions, broadcasts state
- **Spectator UI** — dark-themed single-page app with real-time SSE updates

## Quick Start

```bash
npm install
npm start
```

Opens at **http://localhost:3200** — game auto-plays on load.

## How It Works

1. `server.js` starts an Express server that serves the UI and streams game state via Server-Sent Events
2. `game-runner.js` runs the game loop: each "agent" thinks for 1-2 seconds, then posts its move to the server
3. The browser receives state updates in real time and animates the board

## File Structure

```
.
├── server.js         # Express + SSE server
├── game-runner.js    # Game loop with agent strategies
├── game.yaml         # Docker Agent YAML (reference — for full
│                     # docker-agent deployment with separate containers)
├── public/
│   └── index.html    # Spectator UI
└── package.json
```

## UI Features

- 3×3 board with X (blue) and O (green) markings
- Pulsing "thinking" dot next to the current player
- Last move highlighted with a border
- Winning line animation
- Move history log
- "Play Again" button to restart