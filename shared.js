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
const ADMINS_COLLECTION = 'admins'; // doc per admin: admins/{uid} = { email }

const DEFAULT_STATE = {
  tournamentName: 'Tank Company Cup #1',
  format: 'SE',          // SE | DE | RR | GROUP
  mode: 'team',          // team | solo (1v1)
  bestOf: 3,
  bracketSize: 8,
  status: 'registration',
  teams: [],             // {id, name, players[], seed, points, wins, losses}
  matches: [],           // {id, round, idx, team1, team2, score1, score2, status, winner, mapBans[]}
  groups: [],            // [{id, name, teams[], matches[]}] — for GROUP format
  mapPool: [],           // {id, name, imageUrl}
  info: {
    rules: '',
    schedule: '',
    mapRules: '',
    prizePool: { first: '', second: '', third: '' },
    sponsors: []
  },
  home: {
    startsAt: '',
    streamChannels: [],
    news: [],
    discordUrl: ''
  },
  pastTournaments: [],   // [{id, name, date, format, mode, winner, runnerUp, thirdPlace, teams, prizePool}]
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
  const { getFirestore, doc, onSnapshot, setDoc, getDoc } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  const { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } =
    await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");

  _app = initializeApp(firebaseConfig);
  _db = getFirestore(_app);
  _docRef = doc(_db, DOC_PATH[0], DOC_PATH[1]);
  const _auth = getAuth(_app);

  // store firestore + auth fns for later use
  window._fsApi = { doc, onSnapshot, setDoc, getDoc, getFirestore, db: _db };
  window._authApi = { auth: _auth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged };

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

/* ---------- AUTH (admin login via Google, admin status via Firestore) ---------- */

let _currentUser = null;
let _isCurrentUserAdmin = false;

async function checkIsAdmin(uid) {
  if (!uid) return false;
  try {
    const adminDocRef = window._fsApi.doc(window._fsApi.db, ADMINS_COLLECTION, uid);
    const snap = await window._fsApi.getDoc(adminDocRef);
    return snap.exists();
  } catch (e) {
    console.error('[Auth] Admin check failed:', e);
    return false;
  }
}

async function watchAuth(callback) {
  await _initPromise;
  window._authApi.onAuthStateChanged(window._authApi.auth, async (user) => {
    _currentUser = user;
    _isCurrentUserAdmin = await checkIsAdmin(user?.uid);
    callback(user, _isCurrentUserAdmin);
  });
}

function isAdmin(user) {
  // Synchronous check against last-known result (set by watchAuth)
  return !!user && _isCurrentUserAdmin;
}

async function signInAdmin() {
  await _initPromise;
  const provider = new window._authApi.GoogleAuthProvider();
  try {
    const result = await window._authApi.signInWithPopup(window._authApi.auth, provider);
    const admin = await checkIsAdmin(result.user.uid);
    _isCurrentUserAdmin = admin;
    if (!admin) {
      await window._authApi.signOut(window._authApi.auth);
      throw new Error('NOT_ADMIN');
    }
    return result.user;
  } catch (e) {
    if (e.message === 'NOT_ADMIN') {
      throw new Error('Цей акаунт не має прав адміністратора.');
    }
    throw new Error('Помилка входу: ' + (e.message || 'спробуй ще раз'));
  }
}

async function signOutAdmin() {
  await _initPromise;
  await window._authApi.signOut(window._authApi.auth);
}

function getCurrentUser() {
  return _currentUser;
}

/* ---------- MAP POOL ---------- */

function ensureMapPool(state) {
  if (!state.mapPool) state.mapPool = [];
  return state.mapPool;
}

function addMap(state, name, imageUrl) {
  ensureMapPool(state);
  state.mapPool.push({ id: uid(), name: name.trim(), imageUrl: imageUrl || '' });
}

function removeMap(state, mapId) {
  state.mapPool = (state.mapPool || []).filter(m => m.id !== mapId);
}

function getBannedMaps(match) {
  if (!match || !match.mapBans) return [];
  return match.mapBans.filter(b => b.phase === 'ban').map(b => b.mapName);
}

function getPickedMaps(match) {
  if (!match || !match.mapBans) return [];
  return match.mapBans.filter(b => b.phase === 'pick').map(b => b.mapName);
}

/* ---------- GROUP STAGE ---------- */

function generateGroupStage(state, groupCount = 2) {
  state.matches = [];
  state.groups = [];

  const teams = shuffle([...state.teams]);
  const size = Math.ceil(teams.length / groupCount);

  for (let g = 0; g < groupCount; g++) {
    const groupTeams = teams.slice(g * size, (g + 1) * size);
    const groupMatches = [];
    let matchIdx = 0;

    for (let i = 0; i < groupTeams.length; i++) {
      for (let j = i + 1; j < groupTeams.length; j++) {
        const m = {
          id: `G${g + 1}M${matchIdx + 1}`,
          round: matchIdx + 1,
          idx: matchIdx,
          group: g,
          team1: groupTeams[i].name,
          team2: groupTeams[j].name,
          score1: 0, score2: 0,
          status: 'upcoming', winner: null,
          bestOf: state.bestOf,
          mapBans: []
        };
        groupMatches.push(m);
        state.matches.push(m);
        matchIdx++;
      }
    }

    state.groups.push({
      id: `G${g + 1}`,
      name: `Group ${String.fromCharCode(65 + g)}`,
      teams: groupTeams.map(t => t.name),
      matches: groupMatches.map(m => m.id)
    });
  }
}

function getGroupStandings(state, groupId) {
  const group = (state.groups || []).find(g => g.id === groupId);
  if (!group) return [];

  const stats = {};
  group.teams.forEach(name => { stats[name] = { name, wins: 0, losses: 0, points: 0, played: 0 }; });

  state.matches
    .filter(m => m.group !== undefined && `G${m.group + 1}` === groupId && m.status === 'done')
    .forEach(m => {
      if (!stats[m.winner]) return;
      const loser = m.winner === m.team1 ? m.team2 : m.team1;
      stats[m.winner].wins++;
      stats[m.winner].points += 3;
      stats[m.winner].played++;
      if (stats[loser]) { stats[loser].losses++; stats[loser].played++; }
    });

  return Object.values(stats).sort((a, b) => b.points - a.points || b.wins - a.wins);
}

/* ---------- SEEDING ---------- */

function applySeeds(state) {
  state.teams.forEach((t, i) => { t.seed = i + 1; });
}

function shuffleSeeds(state) {
  const shuffled = shuffle([...state.teams]);
  shuffled.forEach((t, i) => { t.seed = i + 1; });
  state.teams = shuffled;
}

/* ---------- PAST TOURNAMENTS (Hall of Fame) ---------- */

function ensurePastTournaments(state) {
  if (!state.pastTournaments) state.pastTournaments = [];
  return state.pastTournaments;
}

function archiveCurrentTournament(state) {
  ensurePastTournaments(state);
  const standings = getStandings(state);

  const record = {
    id: uid(),
    name: state.tournamentName,
    date: new Date().toISOString().split('T')[0],
    format: state.format || 'SE',
    mode: state.mode || 'team',
    bestOf: state.bestOf,
    teams: state.teams.length,
    winner:     standings[0]?.name || '—',
    runnerUp:   standings[1]?.name || '—',
    thirdPlace: standings[2]?.name || '—',
    prizePool: state.info?.prizePool || { first: '', second: '', third: '' },
  };

  state.pastTournaments.unshift(record); // newest first
  return record;
}

function removePastTournament(state, id) {
  ensurePastTournaments(state);
  state.pastTournaments = state.pastTournaments.filter(t => t.id !== id);
}

/* ---------- TOURNAMENT INFO HELPERS ---------- */

function ensureInfo(state) {
  if (!state.info) {
    state.info = structuredClone(DEFAULT_STATE.info);
  }
  if (!state.info.prizePool) state.info.prizePool = { first: '', second: '', third: '' };
  if (!state.info.sponsors) state.info.sponsors = [];
  return state.info;
}

function addSponsor(state, name, url) {
  ensureInfo(state);
  state.info.sponsors.push({ id: uid(), name: name.trim(), url: url.trim() });
}

function removeSponsor(state, sponsorId) {
  ensureInfo(state);
  state.info.sponsors = state.info.sponsors.filter(s => s.id !== sponsorId);
}

/* ---------- HOME PAGE FEATURES ---------- */

function ensureHome(state) {
  if (!state.home) state.home = structuredClone(DEFAULT_STATE.home);
  if (!state.home.streamChannels) state.home.streamChannels = [];
  if (!state.home.news) state.home.news = [];
  return state.home;
}

function extractYouTubeId(url) {
  if (!url) return null;
  const patterns = [
    /youtube\.com\/watch\?v=([\w-]+)/,
    /youtu\.be\/([\w-]+)/,
    /youtube\.com\/live\/([\w-]+)/,
    /youtube\.com\/channel\/([\w-]+)/,
    /youtube\.com\/@([\w-]+)/,
    /youtube\.com\/c\/([\w-]+)/
  ];
  for (const p of patterns) {
    const m = url.match(p);
    if (m) return m[1];
  }
  return null;
}

function addStreamChannel(state, name, youtubeUrl) {
  ensureHome(state);
  state.home.streamChannels.push({ id: uid(), name: name.trim(), youtubeUrl: youtubeUrl.trim() });
}

function removeStreamChannel(state, channelId) {
  ensureHome(state);
  state.home.streamChannels = state.home.streamChannels.filter(c => c.id !== channelId);
}

function addNews(state, text) {
  ensureHome(state);
  state.home.news.unshift({ id: uid(), text: text.trim(), createdAt: Date.now() });
  // keep only the latest 20
  state.home.news = state.home.news.slice(0, 20);
}

function removeNews(state, newsId) {
  ensureHome(state);
  state.home.news = state.home.news.filter(n => n.id !== newsId);
}

function getTopTeams(state, count = 3) {
  return getStandings(state).slice(0, count);
}

function getNextMatch(state) {
  return state.matches.find(m => m.status === 'live') ||
         state.matches.find(m => m.status === 'upcoming' && m.team1 !== '?' && m.team2 !== '?' && m.team1 !== 'BYE' && m.team2 !== 'BYE');
}
