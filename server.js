const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3200;

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

let API_KEY = null;
try { API_KEY = fs.readFileSync('/home/openclaw/prototypage_key.config', 'utf8').trim(); } catch(e) {}
if (!API_KEY) console.warn('No API key — games will use fallback heuristics');

// ── 50 concepts ──────────────────────────────────────────────────
const CONCEPTS = [
  // Animals
  { word: 'elephant', category: 'Animal', emoji: '🐘' },
  { word: 'dolphin', category: 'Animal', emoji: '🐬' },
  { word: 'penguin', category: 'Animal', emoji: '🐧' },
  { word: 'octopus', category: 'Animal', emoji: '🐙' },
  { word: 'giraffe', category: 'Animal', emoji: '🦒' },
  { word: 'eagle', category: 'Animal', emoji: '🦅' },
  { word: 'chameleon', category: 'Animal', emoji: '🦎' },
  { word: 'spider', category: 'Animal', emoji: '🕷️' },
  { word: 'kangaroo', category: 'Animal', emoji: '🦘' },
  { word: 'butterfly', category: 'Animal', emoji: '🦋' },
  // Objects
  { word: 'telescope', category: 'Object', emoji: '🔭' },
  { word: 'compass', category: 'Object', emoji: '🧭' },
  { word: 'hourglass', category: 'Object', emoji: '⏳' },
  { word: 'microscope', category: 'Object', emoji: '🔬' },
  { word: 'lighthouse', category: 'Object', emoji: '🏛️' },
  { word: 'camera', category: 'Object', emoji: '📷' },
  { word: 'guitar', category: 'Object', emoji: '🎸' },
  { word: 'anchor', category: 'Object', emoji: '⚓' },
  { word: 'bicycle', category: 'Object', emoji: '🚲' },
  { word: 'keyboard', category: 'Object', emoji: '⌨️' },
  // Nature
  { word: 'volcano', category: 'Nature', emoji: '🌋' },
  { word: 'waterfall', category: 'Nature', emoji: '🏞️' },
  { word: 'rainbow', category: 'Nature', emoji: '🌈' },
  { word: 'coral reef', category: 'Nature', emoji: '🪸' },
  { word: 'aurora', category: 'Nature', emoji: '🌌' },
  { word: 'glacier', category: 'Nature', emoji: '🧊' },
  { word: 'sunflower', category: 'Nature', emoji: '🌻' },
  { word: 'mushroom', category: 'Nature', emoji: '🍄' },
  { word: 'lightning', category: 'Nature', emoji: '⚡' },
  { word: 'tornado', category: 'Nature', emoji: '🌪️' },
  // Food
  { word: 'sushi', category: 'Food', emoji: '🍣' },
  { word: 'pizza', category: 'Food', emoji: '🍕' },
  { word: 'watermelon', category: 'Food', emoji: '🍉' },
  { word: 'croissant', category: 'Food', emoji: '🥐' },
  { word: 'honey', category: 'Food', emoji: '🍯' },
  { word: 'popcorn', category: 'Food', emoji: '🍿' },
  { word: 'chocolate', category: 'Food', emoji: '🍫' },
  { word: 'avocado', category: 'Food', emoji: '🥑' },
  { word: 'cheese', category: 'Food', emoji: '🧀' },
  { word: 'taco', category: 'Food', emoji: '🌮' },
  // Abstract
  { word: 'gravity', category: 'Abstract', emoji: '🌍' },
  { word: 'democracy', category: 'Abstract', emoji: '🗳️' },
  { word: 'infinity', category: 'Abstract', emoji: '♾️' },
  { word: 'friendship', category: 'Abstract', emoji: '🤝' },
  { word: 'time', category: 'Abstract', emoji: '⏰' },
  { word: 'music', category: 'Abstract', emoji: '🎵' },
  { word: 'justice', category: 'Abstract', emoji: '⚖️' },
  { word: 'memory', category: 'Abstract', emoji: '🧠' },
  { word: 'courage', category: 'Abstract', emoji: '🦁' },
  { word: 'dream', category: 'Abstract', emoji: '💭' },
];

// ── State ────────────────────────────────────────────────────────
function freshState() {
  return {
    status: 'idle',
    thinkerModel: 'anthropic/claude-haiku-4.5',
    guesserModel: 'openai/gpt-4o-mini',
    currentTurn: 0,
    maxTurns: 20,
    concept: null,
    history: [],
    winner: null,
    thinking: null,
    gameCount: 0,
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
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  clients.add(res);
  broadcast('sync', gs);
  req.on('close', () => clients.delete(res));
});

app.get('/state', (req, res) => res.json(gs));

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── LLM helpers ──────────────────────────────────────────────────
async function callLLM(model, system, user, maxTokens = 300) {
  if (!API_KEY) return null;
  try {
    const res = await fetch(OPENROUTER, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
        'HTTP-Referer': 'https://github.com/TundraCube/poc-dockeragent',
        'X-Title': '20 Questions Game',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        max_tokens: maxTokens,
        temperature: 0.7,
      }),
    });
    if (!res.ok) {
      console.error(`LLM ${model} HTTP ${res.status}`);
      return null;
    }
    const d = await res.json();
    if (d.error) {
      console.error(`LLM ${model} err:`, d.error.message);
      return null;
    }
    return d.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error(`LLM ${model} fail:`, e.message);
    return null;
  }
}

async function askGuesser(concept, history, model) {
  const historyText = history.length
    ? history.map(h => `Q${h.turn}: "${h.question}" → ${h.answer}`).join('\n')
    : '(no questions yet)';

  const system = `You are playing 20 Questions as the GUESSER. Your goal is to guess a secret concept that the Thinker has chosen.

ASK STRATEGIC yes/no questions to narrow down the concept. Avoid repeating previous questions.
Be creative — ask about properties, categories, typical locations, materials, sizes, common uses.
Do NOT guess the answer until you are very confident.

The concept belongs to one of these categories: Animal, Object, Nature, Food, Abstract.

Reply with ONLY your question, ending with a question mark. Never include explanations.`;

  const user = `Previous Q&A:\n${historyText}\n\nAsk your next question (question ${history.length + 1} of 20). Be strategic!`;

  return callLLM(model, system, user, 150);
}

async function askThinker(concept, question, model) {
  const system = `You are playing 20 Questions as the THINKER. You have chosen this secret concept:

WORD: "${concept.word}"
CATEGORY: ${concept.category}
EMOJI: ${concept.emoji}

Rules for answering:
1. Answer YES or NO to each question truthfully based on the secret concept.
2. If the question is ambiguous, answer based on the most common interpretation of the secret concept.
3. If the Guesser names the exact word, answer "CORRECT" and nothing else.
4. Keep answers short: just "YES", "NO", or "CORRECT".

Never reveal the word unless the Guesser guesses it exactly. Never give hints beyond yes/no.`;

  const user = `Question: "${question}"\n\nAnswer truthfully with YES, NO, or CORRECT:`;

  const ans = await callLLM(model, system, user, 20);
  if (!ans) return null;
  const upper = ans.toUpperCase().trim();
  if (upper.startsWith('YES')) return 'YES';
  if (upper.startsWith('NO')) return 'NO';
  if (upper.includes('CORRECT')) return 'CORRECT';
  // Best-effort: pick first word
  if (upper === 'Y') return 'YES';
  if (upper === 'N') return 'NO';
  return upper;
}

// ── Game loop ────────────────────────────────────────────────────
async function runGame(thinkerModel, guesserModel) {
  if (gameRunning) return;
  gameRunning = true;

  // Pick random concept
  const concept = CONCEPTS[Math.floor(Math.random() * CONCEPTS.length)];

  gs.status = 'playing';
  gs.thinkerModel = thinkerModel || 'anthropic/claude-haiku-4.5';
  gs.guesserModel = guesserModel || 'openai/gpt-4o-mini';
  gs.currentTurn = 0;
  gs.maxTurns = 20;
  gs.concept = null; // hidden from clients until game over
  gs.history = [];
  gs.winner = null;
  gs.thinking = 'referee';
  gs.gameCount++;

  broadcast('sync', gs);

  // Phase: Thinker picks concept
  gs.thinking = 'thinker';
  broadcast('thinking', { ...gs, agent: 'thinker' });
  await sleep(800);

  // Reveal category (not word) via concept popup
  gs.concept = { category: concept.category, emoji: concept.emoji, word: null };
  broadcast('concept', { category: concept.category, emoji: concept.emoji });
  await sleep(3000); // time for popup animation + display

  gs.thinking = null;
  broadcast('thinking', gs);

  // 20 turns
  for (let turn = 1; turn <= 20; turn++) {
    gs.currentTurn = turn;

    // ── GUESSER ASKS ──
    gs.thinking = 'guesser';
    broadcast('thinking', { ...gs, agent: 'guesser' });
    await sleep(500);

    const question = API_KEY
      ? await askGuesser(concept, gs.history, gs.guesserModel)
      : fallbackQuestions[Math.min(turn - 1, fallbackQuestions.length - 1)];

    if (!question) {
      broadcast('gameover', { ...gs, winner: 'error', concept });
      gameRunning = false;
      return;
    }

    gs.history.push({ turn, question, answer: null });
    broadcast('question', { turn, question, agent: 'guesser' });
    gs.thinking = null;
    await sleep(800);

    // ── THINKER ANSWERS ──
    gs.thinking = 'thinker';
    broadcast('thinking', { ...gs, agent: 'thinker' });
    await sleep(400);

    const answer = API_KEY
      ? await askThinker(concept, question, gs.thinkerModel)
      : fallbackAnswer(concept, question);

    if (!answer) {
      broadcast('gameover', { ...gs, winner: 'error', concept });
      gameRunning = false;
      return;
    }

    gs.history[gs.history.length - 1].answer = answer;
    broadcast('answer', { turn, answer, agent: 'thinker' });
    gs.thinking = null;

    if (answer === 'CORRECT') {
      gs.winner = 'guesser';
      gs.concept = { category: concept.category, emoji: concept.emoji, word: concept.word };
      broadcast('gameover', { ...gs, concept: { category: concept.category, emoji: concept.emoji, word: concept.word } });
      gameRunning = false;
      return;
    }

    await sleep(600);
  }

  // Out of turns — Thinker wins
  gs.winner = 'thinker';
  gs.concept = { category: concept.category, emoji: concept.emoji, word: concept.word };
  broadcast('gameover', { ...gs, concept: { category: concept.category, emoji: concept.emoji, word: concept.word } });
  gameRunning = false;
}

// ── Fallbacks (no API key) ───────────────────────────────────────
const fallbackQuestions = [
  'Is it an animal?',
  'Is it an object?',
  'Is it found in nature?',
  'Is it edible?',
  'Is it larger than a breadbox?',
  'Can it fly?',
  'Is it alive?',
  'Is it man-made?',
  'Is it used by humans daily?',
  'Does it have moving parts?',
  'Is it electronic?',
  'Is it a mammal?',
  'Does it live in water?',
  'Is it a plant?',
  'Is it a type of food?',
  'Is it an abstract concept?',
  'Can you hold it in your hand?',
  'Is it made of metal?',
  'Is it a musical instrument?',
  'Is it a natural phenomenon?',
];

function fallbackAnswer(concept, question) {
  const q = question.toLowerCase();
  const w = concept.word.toLowerCase();

  // Exact guess check
  if (q.includes(w)) return 'CORRECT';

  const animalChecks = {
    'animal': true, 'alive': true, 'mammal': ['elephant','dolphin','giraffe','kangaroo'].includes(w),
    'fly': ['eagle','butterfly'].includes(w), 'water': ['dolphin','penguin','octopus'].includes(w),
  };
  const objectChecks = {
    'object': true, 'man-made': true, 'hold': ['compass','camera','guitar','keyboard'].includes(w),
    'electronic': ['camera','keyboard','microscope'].includes(w), 'metal': ['anchor','compass','bicycle','guitar'].includes(w),
    'moving parts': ['bicycle','camera','telescope','microscope','hourglass'].includes(w),
  };
  const natureChecks = {
    'nature': true, 'plant': ['sunflower','mushroom'].includes(w),
    'natural phenomenon': ['volcano','waterfall','rainbow','aurora','lightning','tornado'].includes(w),
  };
  const foodChecks = {
    'food': true, 'edible': true,
  };
  const abstractChecks = {
    'abstract': true,
  };

  const cat = concept.category;
  let checks = {};
  if (cat === 'Animal') checks = animalChecks;
  else if (cat === 'Object') checks = objectChecks;
  else if (cat === 'Nature') checks = natureChecks;
  else if (cat === 'Food') checks = { ...foodChecks, ...natureChecks };
  else if (cat === 'Abstract') checks = abstractChecks;

  for (const [key, val] of Object.entries(checks)) {
    if (q.includes(key)) {
      if (typeof val === 'boolean') return val ? 'YES' : 'NO';
      return val ? 'YES' : 'NO';
    }
  }

  // size
  if (q.includes('larger') || q.includes('bigger') || q.includes('breadbox')) {
    return ['elephant','giraffe','volcano','waterfall','lighthouse','glacier','tornado','aurora','rainbow','democracy','infinity','gravity','time'].includes(w) ? 'YES' : 'NO';
  }
  if (q.includes('daily')) return ['camera','keyboard','bicycle','time','music','memory','chocolate','cheese','pizza'].includes(w) ? 'YES' : 'NO';

  return 'NO';
}

// ── Endpoints ────────────────────────────────────────────────────
app.post('/start', (req, res) => {
  const { thinkerModel, guesserModel } = req.body || {};
  res.json({ ok: true });
  runGame(thinkerModel, guesserModel);
});

app.post('/reset', (req, res) => {
  const { thinkerModel, guesserModel } = req.body || {};
  res.json({ ok: true });
  runGame(thinkerModel, guesserModel);
});

app.listen(PORT, () => console.log(`20 Questions → http://localhost:${PORT}`));