const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3200;
const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

let API_KEY = process.env.OPENROUTER_API_KEY || null;
try { API_KEY = API_KEY || fs.readFileSync(path.join(process.env.HOME || '/home/openclaw', 'prototypage_key.config'), 'utf8').trim(); } catch (e) {}
if (!API_KEY) console.warn('No API key - games will use fallback heuristics');

const MODELS = [
  { id: 'anthropic/claude-haiku-4.5', label: 'Claude Haiku 4.5' },
  { id: 'anthropic/claude-sonnet-4.5', label: 'Claude Sonnet 4.5' },
  { id: 'openai/gpt-4o-mini', label: 'GPT-4o Mini' },
  { id: 'openai/gpt-4o', label: 'GPT-4o' },
  { id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash' },
  { id: 'deepseek/deepseek-chat', label: 'DeepSeek V3' },
];

const CONCEPTS = [
  ['elephant','Animal','🐘'],['dolphin','Animal','🐬'],['penguin','Animal','🐧'],['octopus','Animal','🐙'],
  ['giraffe','Animal','🦒'],['eagle','Animal','🦅'],['butterfly','Animal','🦋'],
  ['telescope','Object','🔭'],['compass','Object','🧭'],['microscope','Object','🔬'],['camera','Object','📷'],
  ['guitar','Object','🎸'],['bicycle','Object','🚲'],['keyboard','Object','⌨️'],
  ['volcano','Nature','🌋'],['waterfall','Nature','🏞️'],['rainbow','Nature','🌈'],['coral reef','Nature','🪸'],
  ['glacier','Nature','🧊'],['sunflower','Nature','🌻'],['lightning','Nature','⚡'],
  ['sushi','Food','🍣'],['pizza','Food','🍕'],['watermelon','Food','🍉'],['croissant','Food','🥐'],
  ['chocolate','Food','🍫'],['cheese','Food','🧀'],['taco','Food','🌮'],
  ['beach','Place','🏖️'],['mountain','Place','🏔️'],['desert','Place','🏜️'],['forest','Place','🌲'],
  ['library','Place','📚'],['airport','Place','✈️'],['school','Place','🏫'],
].map(([word, category, emoji]) => ({ word, category, emoji }));

const MAX_TURNS = 20;
const sleep = (ms, signal) => new Promise((res, rej) => {
  if (signal?.aborted) return rej(new Error('aborted'));
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
});

// ── State ───────────────────────────────────────────────────────
let models = { thinker: MODELS[1].id, guesser: MODELS[2].id };
let gs = null;
function fresh() {
  return { status: 'idle', thinkerModel: models.thinker, guesserModel: models.guesser,
    currentTurn: 0, maxTurns: MAX_TURNS, concept: null, history: [], winner: null,
    reason: null, thinking: null, gameCount: gs ? gs.gameCount : 0 };
}
gs = fresh();
let current = null; // { abort }
const clients = new Set();

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) c.write(payload);
}
const publicState = () => ({ ...gs, models: MODELS });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/events', (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  clients.add(res);
  res.write(`event: sync\ndata: ${JSON.stringify(publicState())}\n\n`);
  const ka = setInterval(() => res.write(': ka\n\n'), 15000);
  req.on('close', () => { clearInterval(ka); clients.delete(res); });
});
app.get('/state', (req, res) => res.json(publicState()));
app.get('/models', (req, res) => res.json(MODELS));
app.get('/api/yaml', (req, res) => res.type('text/plain').send(fs.readFileSync(path.join(__dirname, 'game.yaml'), 'utf8')));

// ── LLM ─────────────────────────────────────────────────────────
async function callLLM(model, system, user, maxTokens, signal) {
  const res = await fetch(OPENROUTER, {
    method: 'POST', signal,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + API_KEY,
      'HTTP-Referer': 'https://github.com/TundraCube/poc-dockeragent',
      'X-Title': '20 Questions Game',
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0.7,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const d = await res.json().catch(() => ({}));
  if (!res.ok || d.error) throw new Error(`${model}: ${d.error?.message || 'HTTP ' + res.status}`);
  const text = d.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error(`${model}: empty reply`);
  return text;
}

function guessedIt(concept, text) {
  const esc = concept.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\b${esc}s?\\b`, 'i').test(text);
}

// A real final guess names the secret as the ONLY candidate. Hedged questions
// ("a park or a forest?", "like a forest?") just mention it and are answered YES/NO.
function isDirectGuess(concept, text) {
  if (!guessedIt(concept, text)) return false;
  return !/\b(or|like|such as|e\.g\.|for example|including|kind of|type of|related to)\b|\//i.test(text);
}

async function askGuesser(history, turn, model, signal) {
  const log = history.length ? history.map(h => `Q${h.turn}: ${h.question} -> ${h.answer}`).join('\n') : '(none yet)';
  const system = `You are the GUESSER in a game of 20 Questions. The Thinker has secretly chosen ONE concrete thing from these categories: Animal, Object, Nature, Food, Place.
The Thinker's category labels are Animal, Object, Nature, Food, Place, but a question like "is it an object?" is ambiguous for natural things like a volcano or rainbow. Prefer asking about concrete properties (alive? edible? man-made? natural? can you visit it?) over these labels.
Ask one strategic yes/no question per turn, building on previous answers. Start broad, then narrow. Never repeat a question.
Answers come from another AI and are usually right but can occasionally be wrong or debatable. If answers seem to contradict each other, or you've eliminated everything, doubt the most surprising answer and re-test it from another angle instead of giving up on that category.
When you are fairly sure, make a direct guess phrased like "Is it a <thing>?". A wrong guess costs nothing, so start guessing specific candidates from about question 10.
Reply with ONLY the question - one sentence, ending in a question mark.`;
  const left = MAX_TURNS - turn + 1;
  return callLLM(model, system, `Q&A so far:\n${log}\n\nThis is question ${turn} of ${MAX_TURNS} (${left} left${left <= 3 ? ' - time to make a guess!' : ''}).`, 80, signal);
}

async function askThinker(concept, question, model, signal) {
  const system = `You are the THINKER in a game of 20 Questions. Your secret word is "${concept.word}" (${concept.category}).
Judge the Guesser's question about "${concept.word}" using its everyday, most common meaning.
Standard for YES: the property is generally or commonly true of a typical ${concept.word}. It does NOT need to be exclusive or universal. Example: if the secret is "volcano", "Is it found in Asia?" is YES (volcanoes exist there), "Is it man-made?" is NO.
For "located/found in X" questions, answer YES if a ${concept.word} is commonly found in X.
If the question merely mentions several candidates or examples, answer whether the secret fits the described category - do not treat it as a final guess.
First write ONE short sentence of reasoning (max 20 words) about whether the question is true for a ${concept.word}. Then, on a new final line, write exactly "ANSWER: YES" or "ANSWER: NO".
Never reveal the word in your reasoning.`;
  const out = await callLLM(model, system, `Question: ${question}`, 90, signal);
  const m = [...out.matchAll(/ANSWER:\s*(YES|NO)/gi)].pop();
  const answer = m ? m[1].toUpperCase() : (/^\W*N/i.test(out.trim().split('\n').pop()) ? 'NO' : 'YES');
  const why = out.split(/ANSWER:/i)[0].trim().replace(/^reasoning:\s*/i, '').replace(/\s+/g, ' ');
  return { answer, why };
}

// ── Game loop ───────────────────────────────────────────────────
async function runGame(thinkerModel, guesserModel) {
  if (current) current.abort.abort();
  const run = { abort: new AbortController() };
  current = run;
  const { signal } = run.abort;
  const live = () => current === run;

  if (MODELS.some(m => m.id === thinkerModel)) models.thinker = thinkerModel;
  if (MODELS.some(m => m.id === guesserModel)) models.guesser = guesserModel;

  const concept = CONCEPTS[Math.floor(Math.random() * CONCEPTS.length)];
  const count = gs.gameCount + 1;
  gs = fresh();
  gs.gameCount = count;
  gs.status = 'playing';
  gs.thinking = 'thinker';
  broadcast('sync', publicState());

  const finish = (winner, reason) => {
    if (!live()) return;
    gs.status = 'over'; gs.winner = winner; gs.reason = reason; gs.thinking = null;
    gs.concept = concept;
    broadcast('gameover', publicState());
    current = null;
  };

  try {
    await sleep(1200, signal);
    gs.concept = concept;
    broadcast('concept', concept);
    await sleep(2600, signal);

    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      gs.currentTurn = turn;

      gs.thinking = 'guesser';
      broadcast('thinking', { agent: 'guesser', turn });
      const question = API_KEY ? await askGuesser(gs.history, turn, gs.guesserModel, signal)
                               : FALLBACK_Q[(turn - 1) % FALLBACK_Q.length];
      if (!live()) return;
      const entry = { turn, question, answer: null };
      gs.history.push(entry);
      broadcast('question', { turn, question });
      await sleep(900, signal);

      gs.thinking = 'referee';
      broadcast('thinking', { agent: 'referee', turn });
      await sleep(600, signal);

      let answer, why = '';
      if (isDirectGuess(concept, question)) {
        answer = 'CORRECT';
      } else {
        gs.thinking = 'thinker';
        broadcast('thinking', { agent: 'thinker', turn });
        if (API_KEY) ({ answer, why } = await askThinker(concept, question, gs.thinkerModel, signal));
        else answer = fallbackAnswer(concept, question);
      }
      if (!live()) return;
      entry.answer = answer; entry.why = why;
      gs.thinking = null;
      broadcast('answer', { turn, answer, why });

      if (answer === 'CORRECT') { await sleep(1200, signal); return finish('guesser', 'guessed'); }
      await sleep(900, signal);
    }
    finish('thinker', 'turns_exhausted');
  } catch (e) {
    if (e.name === 'AbortError' || e.message === 'aborted' || !live()) return;
    console.error('Game error:', e.message);
    gs.status = 'over'; gs.winner = 'error'; gs.reason = e.message; gs.thinking = null; gs.concept = concept;
    broadcast('gameover', publicState());
    current = null;
  }
}

// ── Fallbacks (no API key) ──────────────────────────────────────
const FALLBACK_Q = ['Is it an animal?','Is it alive?','Is it edible?','Is it a place?','Is it man-made?','Can you hold it?','Is it found in nature?','Is it big?'];
function fallbackAnswer(c, q) {
  q = q.toLowerCase();
  const m = { animal: 'Animal', place: 'Place', edible: 'Food', food: 'Food', nature: 'Nature', 'man-made': 'Object' };
  for (const [k, cat] of Object.entries(m)) if (q.includes(k)) return c.category === cat ? 'YES' : 'NO';
  if (q.includes('alive')) return c.category === 'Animal' ? 'YES' : 'NO';
  return Math.random() < 0.5 ? 'YES' : 'NO';
}

// ── Endpoints ───────────────────────────────────────────────────
const start = (req, res) => {
  const { thinkerModel, guesserModel } = req.body || {};
  res.json({ ok: true });
  runGame(thinkerModel, guesserModel);
};
app.post('/start', start);
app.post('/reset', start);
app.post('/stop', (req, res) => {
  if (current) { current.abort.abort(); current = null; }
  gs = fresh();
  broadcast('reset', publicState());
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`20 Questions -> http://localhost:${PORT}`));
