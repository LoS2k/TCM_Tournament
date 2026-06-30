/* ============================================================
   TANK COMPANY TOURNAMENT — Shared Logic
   Data lives in Firebase Firestore, synced in real-time across
   register/admin/public pages and across all devices.
   ============================================================ */

// ──────────────────────────────────────────────────────────
// FIREBASE CONFIG — your project credentials
// ──────────────────────────────────────────────────────────
const firebaseConfig = {
  apiKey: "AIzaSyBS98TpUmHUJnhwrCe7fC64nAcEjoS-DxY",
  authDomain: "tank-company-tournament.firebaseapp.com",
  projectId: "tank-company-tournament",
  storageBucket: "tank-company-tournament.firebasestorage.app",
  messagingSenderId: "738125909391",
  appId: "1:738125909391:web:433f3492c2c4b70ba78ffa"
};

const DOC_PATH = ['tournaments', 'main']; // single shared tournament document

const DEFAULT_STATE = {
  tournamentName: 'Tank Company Cup #1',
  format: 'SE',          // SE | DE | RR
  bestOf: 3,
  bracketSize: 8,
  status: 'registration', // registration | live | finished
  teams: [],               // {id, name, players[], seed, points, wins, losses}
  matches: [],              // {id, round, idx, team1, team2, score1, score2, status, winner}
  updatedAt: Date.now()
};

// ──────────────────────────────────────────────────────────
// FIREBASE INIT (lazy, via CDN modular SDK)
// ──────────────────────────────────────────────────────────
let _app, _db, _docRef;
let _cachedState = structuredClone(DEFAULT_STATE);
let _ready = false;
let _readyCallbacks = [];

async function initFirebase() {
  if (_ready) return;
  const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js");
  const { getFirestore, doc, onSnapshot, setDoc } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");

  _app = initializeApp(firebaseConfig);
  _db = getFirestore(_app);
  _docRef = doc(_db, DOC_PATH[0], DOC_PATH[1]);

  // store firestore fns for later use
  window._fsApi = { doc, onSnapshot, setDoc, getFirestore };

  // Real-time listener — fires on ANY change from ANY device
  onSnapshot(_docRef, (snap) => {
    if (snap.exists()) {
      _cachedState = snap.data();
    } else {
      _cachedState = structuredClone(DEFAULT_STATE);
      // seed the document so other clients have something to read
      setDoc(_docRef, _cachedState).catch(console.error);
    }
    _ready = true;
    _firstSnapshotReceived = true;
    if (window.onTcStateUpdate) window.onTcStateUpdate(_cachedState);
    _readyCallbacks.forEach(cb => cb(_cachedState));
    _readyCallbacks = [];
  }, (err) => {
    console.error('[Firestore] Sync error:', err);
    showGlobalError('Помилка підключення до Firebase. Перевір конфіг і правила Firestore.');
  });

  _ready = true;
}

function showGlobalError(msg) {
  let bar = document.getElementById('fbErrorBar');
  if (!bar) {
    bar = document.createElement('div');
    bar.id = 'fbErrorBar';
    bar.style.cssText = 'position:fixed;top:0;left:0;right:0;background:#ff5466;color:#1a0508;font-weight:700;text-align:center;padding:8px;font-family:sans-serif;font-size:13px;z-index:999;';
    document.body.prepend(bar);
  }
  bar.textContent = msg;
}

// Kick off connection immediately on script load
const _initPromise = initFirebase();

/* ---------- PUBLIC API (kept same signatures as before) ---------- */

function loadState() {
  // Synchronous snapshot of latest known state (cached from listener)
  return structuredClone(_cachedState);
}

let _firstSnapshotReceived = false;

async function loadStateAsync() {
  await _initPromise;
  if (_firstSnapshotReceived) return structuredClone(_cachedState);
  return new Promise(resolve => {
    _readyCallbacks.push(s => resolve(structuredClone(s)));
  });
}

async function saveState(state) {
  state.updatedAt = Date.now();
  _cachedState = state; // optimistic local update
  await _initPromise;
  try {
    await window._fsApi.setDoc(_docRef, state);
  } catch (e) {
    console.error('[Firestore] Save error:', e);
    showGlobalError('Не вдалося зберегти зміни. Перевір інтернет-з’єднання.');
  }
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

/* ---------- TEAM MANAGEMENT ---------- */
function addTeam(state, name, players) {
  const team = {
    id: uid(),
    name: name.trim(),
    players: players.filter(p => p.trim()),
    seed: state.teams.length + 1,
    points: 0,
    wins: 0,
    losses: 0
  };
  state.teams.push(team);
  return team;
}

function removeTeam(state, teamId) {
  state.teams = state.teams.filter(t => t.id !== teamId);
}

/* ---------- BRACKET GENERATION ---------- */
function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function nextPow2(n) {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

function generateBracket(state) {
  state.matches = [];
  if (state.format === 'RR') {
    generateRoundRobin(state);
  } else {
    generateSingleElim(state);
  }
  state.status = 'live';
}

function generateSingleElim(state) {
  const teams = shuffle(state.teams);
  const slots = nextPow2(Math.max(teams.length, 2));
  while (teams.length < slots) teams.push(null);

  const totalRounds = Math.log2(slots);

  // Round 1
  for (let i = 0; i < slots; i += 2) {
    const t1 = teams[i];
    const t2 = teams[i + 1];
    const match = {
      id: `R1M${i / 2 + 1}`,
      round: 1,
      idx: i / 2,
      team1: t1 ? t1.name : 'BYE',
      team2: t2 ? t2.name : 'BYE',
      score1: 0, score2: 0,
      status: 'upcoming',
      winner: null,
      bestOf: state.bestOf
    };
    if (!t1) { match.winner = t2 ? t2.name : null; match.status = 'done'; }
    else if (!t2) { match.winner = t1.name; match.status = 'done'; }
    state.matches.push(match);
  }

  // Future rounds (placeholders)
  for (let r = 2; r <= totalRounds; r++) {
    const count = slots / Math.pow(2, r);
    for (let i = 0; i < count; i++) {
      state.matches.push({
        id: `R${r}M${i + 1}`,
        round: r, idx: i,
        team1: '?', team2: '?',
        score1: 0, score2: 0,
        status: 'upcoming', winner: null,
        bestOf: state.bestOf
      });
    }
  }

  // Advance BYE winners
  state.matches.filter(m => m.round === 1 && m.status === 'done')
               .forEach(m => advanceWinner(state, m));
}

function generateRoundRobin(state) {
  const teams = state.teams;
  let id = 1;
  for (let i = 0; i < teams.length; i++) {
    for (let j = i + 1; j < teams.length; j++) {
      state.matches.push({
        id: `RR${id}`,
        round: id,
        idx: id - 1,
        team1: teams[i].name,
        team2: teams[j].name,
        score1: 0, score2: 0,
        status: 'upcoming', winner: null,
        bestOf: state.bestOf
      });
      id++;
    }
  }
}

function advanceWinner(state, completedMatch) {
  if (state.format === 'RR') return;
  const nextRound = completedMatch.round + 1;
  const nextIdx = Math.floor(completedMatch.idx / 2);
  const nextMatch = state.matches.find(m => m.round === nextRound && m.idx === nextIdx);
  if (!nextMatch) return;
  if (completedMatch.idx % 2 === 0) nextMatch.team1 = completedMatch.winner;
  else nextMatch.team2 = completedMatch.winner;
}

/* ---------- RESULTS ---------- */
function submitResult(state, matchId, score1, score2) {
  const match = state.matches.find(m => m.id === matchId);
  if (!match) return;
  match.score1 = score1;
  match.score2 = score2;

  const need = Math.ceil(match.bestOf / 2);
  if (score1 >= need) { match.winner = match.team1; match.status = 'done'; }
  else if (score2 >= need) { match.winner = match.team2; match.status = 'done'; }
  else { match.winner = null; match.status = 'live'; }

  if (match.status === 'done') {
    updateStandings(state, match);
    advanceWinner(state, match);
  }
}

function setMatchLive(state, matchId) {
  state.matches.forEach(m => { if (m.status === 'live') m.status = 'upcoming'; });
  const match = state.matches.find(m => m.id === matchId);
  if (match) match.status = 'live';
}

function updateStandings(state, match) {
  const loserName = match.winner === match.team1 ? match.team2 : match.team1;
  const winner = state.teams.find(t => t.name === match.winner);
  const loser = state.teams.find(t => t.name === loserName);
  if (winner) { winner.wins++; winner.points += 3; }
  if (loser) { loser.losses++; }
}

function getStandings(state) {
  return [...state.teams].sort((a, b) =>
    b.points - a.points || b.wins - a.wins
  );
}

function getRound(state, round) {
  return state.matches.filter(m => m.round === round);
}

function totalRounds(state) {
  return state.matches.length ? Math.max(...state.matches.map(m => m.round)) : 0;
}

/* ---------- CROSS-DEVICE SYNC ----------
   Handled automatically by Firestore onSnapshot() above.
   window.onTcStateUpdate(state) fires on every change, from any device. */

/* ---------- FORMAT HELPERS ---------- */
function formatLabel(fmt) {
  return { SE: 'Single Elimination', DE: 'Double Elimination', RR: 'Round Robin' }[fmt] || fmt;
}
function roundLabel(round, total) {
  if (round === total) return 'Фінал';
  if (round === total - 1) return 'Півфінал';
  if (round === total - 2) return 'Чвертьфінал';
  return `Раунд ${round}`;
}
