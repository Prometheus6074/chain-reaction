'use strict';

/* ══════════════════════════════════════════════════════════════════
   FIREBASE CONFIG
   ──────────────────────────────────────────────────────────────────
   1. Go to https://console.firebase.google.com
   2. Create a project → add a Web app → copy the config below
   3. In the left sidebar: Build → Realtime Database → Create database
   4. Set rules to allow read/write (for development):
        { "rules": { ".read": true, ".write": true } }
   ══════════════════════════════════════════════════════════════════ */
const FIREBASE_CONFIG = {
    apiKey: "AIzaSyDJqnrybe_t1TixObJzKHugd4LdlCzP2K8",
    authDomain: "chainreaction-8485f.firebaseapp.com",
    databaseURL: "https://chainreaction-8485f-default-rtdb.asia-southeast1.firebasedatabase.app/",
    projectId: "chainreaction-8485f",
    storageBucket: "chainreaction-8485f.firebasestorage.app",
    messagingSenderId: "797191537765",
    appId: "1:797191537765:web:792d1ff55fe76791e6328c"
};

/* ══════════════════════════════════════════════════════════════════
   GAME CONSTANTS
   ══════════════════════════════════════════════════════════════════ */
const ALL_COLORS = ['#ff3355', '#2a7fff', '#1fd97a', '#ffcc00', '#cc44ff', '#00ddff', '#ff6633', '#aaff33'];
const ALL_NAMES = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Cyan', 'Orange', 'Lime'];

const ORB_POS = [
    null,
    [[0, 0]],                         // 1 orb: center
    [[-6, -4], [6, 4]],               // 2 orbs: tight cluster
    [[-5, -7], [7, -1], [-2, 8]]      // 3 orbs: tight triangle
];

const FLY_MS = 155;
const SETTLE_MS = 50;

/* ── BALL PICKER STATE ── */
const ballModes = new Array(8).fill(0);
const ballColors = [...ALL_COLORS]; // per-slot chosen color
const ballOrder = [];

let cfg = { rows: 9, cols: 9 };
let S = {};
let history = [];

let PCOLORS = [];
let PNAMES = [];
let IS_AI = [];
let IS_HARD_AI = [];

let turnOrbsBefore = 0;
let comboCount = 0;
let chainCandidates = new Set();
let comboHideTimer = null;

/* ── Game mode flags ── */
let timedMode    = false;   // per-player countdown clock
let timedSeconds = 180;     // default 3 min per player
let playerTimers = [];      // remaining ms per player
let _timedInterval = null;

/* ── Nuclear Reaction Mode ── */
let nuclearMode = false;
let _nrTargeting = null; // { player, abilityId, phase, firstCell }

const NR_METER_MAX    = 100;
const NR_METER_PER_COMBO = 4; // reduced for balance — underdog multiplier and flat bonus compensate

/* Characters indexed by ALL_COLORS position (0=Red … 7=Lime) */
const NR_CHARS = [
    { name: 'Warhead', abilities: ['carpet_bomb',  'airstrike',    'detonation_wave'] },
    { name: 'Tsunami', abilities: ['undertow',     'tidal_wave',   'riptide']         },
    { name: 'Blight',  abilities: ['overgrowth',   'creep',        'pandemic']        },
    { name: 'Voltage', abilities: ['surge',        'static_field', 'blackout']        },
    { name: 'Phantom', abilities: ['phantom_step', 'swap',         'void_rift']       },
    { name: 'Cryo',    abilities: ['permafrost',   'ice_wall',     'absolute_zero']   },
    { name: 'Napalm',  abilities: ['ignite',       'ember',        'encircle']        },
    { name: 'Venom',   abilities: ['corrode',      'infect',       'decay']           },
];

/* Ability metadata: name + targeting mode */
const NR_ABILITIES = {
    airstrike:       { name: 'Airstrike',       targeting: 'cell_any'   },
    carpet_bomb:     { name: 'Carpet Bomb',     targeting: 'row'        },
    detonation_wave: { name: 'Detonation Wave', targeting: 'none'       },
    undertow:        { name: 'Undertow',        targeting: 'none'       },
    riptide:         { name: 'Riptide',         targeting: 'none'       },
    tidal_wave:      { name: 'Tidal Wave',      targeting: 'col'        },
    creep:           { name: 'Creep',           targeting: 'none'       },
    overgrowth:      { name: 'Overgrowth',      targeting: 'cell_any'   },
    pandemic:        { name: 'Pandemic',        targeting: 'none'       },
    surge:           { name: 'Surge',           targeting: 'none'       },
    static_field:    { name: 'Static Field',    targeting: 'none'       },
    blackout:        { name: 'Blackout',        targeting: 'player'     },
    phantom_step:    { name: 'Phantom Step',    targeting: 'cell2_own'  },
    swap:            { name: 'Swap',            targeting: 'cell2_any'  },
    void_rift:       { name: 'Void Rift',       targeting: 'cell_any'   },
    permafrost:      { name: 'Permafrost',      targeting: 'cell_enemy' },
    ice_wall:        { name: 'Ice Wall',        targeting: 'none'       },
    absolute_zero:   { name: 'Absolute Zero',   targeting: 'none'       },
    ignite:          { name: 'Ignite',          targeting: 'cell_any'   },
    ember:           { name: 'Ember',           targeting: 'cell_any'   }, // top-left anchor of 2×2 — marks own cells within area
    encircle:        { name: 'Encircle',        targeting: 'none'       },
    corrode:         { name: 'Corrode',         targeting: 'cell_any'   }, // 2×2 area top-left anchor
    infect:          { name: 'Infect',          targeting: 'cell_enemy' },
    decay:           { name: 'Decay',           targeting: 'cell_enemy' },
};

/* ── Match stats ── */
let matchStats = { totalTurns: 0, maxCombo: 0, maxComboPlayer: -1 };
function resetMatchStats() { matchStats = { totalTurns: 0, maxCombo: 0, maxComboPlayer: -1 }; }

/* ══════════════════════════════════════════════════════════════════
   FIREBASE / ONLINE STATE
   ══════════════════════════════════════════════════════════════════ */
let firebaseApp = null;
let db = null;
let _serverTimeOffset = 0;
function serverNow() { return Date.now() + _serverTimeOffset; }
let onlineMode = false;
let myUid = null;
let myPlayerIndex = -1;
let isHost = false;
let roomCode = null;
let roomRef = null;
let onlineListeners = [];   // { ref, listener, event }
let lastWrittenStateTs = 0; // ts of the last state we wrote, to skip our own echoes
let onlineCfgRows = 9;
let onlineCfgCols = 9;
let onlineNumPlayers = 2;
let onlineRoomPassword = '';
let myUsername = sessionStorage.getItem('cr_username') || localStorage.getItem('cr_username') || '';
let _onlineTurnTimerInterval = null;
let _nrRoundStartOrbs = []; // snapshot of orbCounts at the start of each round for underdog check
let _pendingStateSnap = null; // queued state update received while animating
const TURN_TIMER_MS = 30000; // 30 seconds per turn

/* ── Firebase init (lazy) ── */
function initFirebase() {
    if (firebaseApp) return true;
    if (FIREBASE_CONFIG.apiKey === 'REPLACE_ME') return false;
    try {
        firebaseApp = firebase.initializeApp(FIREBASE_CONFIG);
        db = firebase.database();
        db.ref('/.info/serverTimeOffset').on('value', snap => { _serverTimeOffset = snap.val() || 0; });
        return true;
    } catch (e) {
        console.error('Firebase init failed:', e);
        return false;
    }
}

/* ── Persistent session UID ── */
function getMyUid() {
    let uid = sessionStorage.getItem('cr_uid');
    if (!uid) {
        uid = Math.random().toString(36).slice(2, 12);
        sessionStorage.setItem('cr_uid', uid);
    }
    return uid;
}

/* ── Random 6-char room code ── */
function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/* ══════════════════════════════════════════════════════════════════
   SETUP UI (pass-and-play)
   ══════════════════════════════════════════════════════════════════ */
(function () {
    const bg = document.getElementById('ball-grid');
    ALL_COLORS.forEach((col, i) => {
        const slot = document.createElement('div');
        slot.className = 'ball-slot';
        slot.id = `bs${i}`;
        slot.style.setProperty('--bc', col);
        slot.style.setProperty('--bc66', col + '66');
        slot.innerHTML = `
      <div class="ball-wrap">
        <div class="ball-circle" style="background:${col};"></div>
        <div class="ball-num" id="bn${i}"></div>
        <div class="ai-badge">AI</div>
      </div>
      <div class="ball-label" id="bl${i}">${ALL_NAMES[i]}</div>`;
        slot.addEventListener('click', () => toggleBall(i));
        bg.appendChild(slot);
    });

    const gb = document.getElementById('grid-btns');
    [[6, 6, '6×6'], [7, 7, '7×7'], [8, 8, '8×8'], [9, 9, '9×9'], [10, 10, '10×10']].forEach(([r, c, l]) => {
        const b = document.createElement('button');
        b.className = 'pill'; b.textContent = l;
        b.onclick = () => { cfg.rows = r; cfg.cols = c; syncGridBtns(); };
        gb.appendChild(b);
    });
    syncGridBtns();
})();

function toggleBall(i) {
    const prev = ballModes[i];
    ballModes[i] = (prev + 1) % 4;
    if (prev === 0) ballOrder.push(i);
    else if (ballModes[i] === 0) { const idx = ballOrder.indexOf(i); if (idx !== -1) ballOrder.splice(idx, 1); }
    syncBallGrid();
}

function syncBallGrid() {
    ALL_COLORS.forEach((_, i) => {
        const slot  = document.getElementById(`bs${i}`);
        const num   = document.getElementById(`bn${i}`);
        const label = document.getElementById(`bl${i}`);
        const mode  = ballModes[i];
        const pos   = ballOrder.indexOf(i);
        const col   = ballColors[i];
        slot.className = 'ball-slot ' + (mode === 1 ? 'mode-player' : mode === 2 ? 'mode-ai' : mode === 3 ? 'mode-hard-ai' : '');
        slot.style.setProperty('--bc',   col);
        slot.style.setProperty('--bc66', col + '66');
        if (mode === 1) { num.textContent = pos + 1; label.textContent = `P${pos + 1}`; }
        else if (mode === 2) { num.textContent = 'AI'; label.textContent = 'AI'; }
        else if (mode === 3) { num.textContent = 'H'; label.textContent = 'Hard AI'; }
        else { num.textContent = ''; label.textContent = ALL_NAMES[i]; }
    });
    document.getElementById('start-btn').disabled = ballOrder.length < 2;
}


function syncGridBtns() {
    [6, 7, 8, 9, 10].forEach((sz, i) =>
        document.querySelectorAll('#grid-btns .pill')[i].classList.toggle('active', sz === cfg.rows));
}

/* ══════════════════════════════════════════════════════════════════
   ONLINE LOBBY UI
   ══════════════════════════════════════════════════════════════════ */

/* ── Step-panel helpers ── */
const OL_PANEL_FOCUS = { 'ol-username': 'ol-username-input', 'ol-join-panel': 'ol-code-input' };

function showOlPanel(id) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') {
        document.activeElement.blur();
    }
    ['ol-username', 'ol-mode', 'ol-create', 'ol-join-panel', 'ol-waiting', 'ol-random-join'].forEach(p => {
        const el = document.getElementById(p);
        if (el) el.style.display = p === id ? 'flex' : 'none';
    });
    const focusId = OL_PANEL_FOCUS[id];
    if (focusId) setTimeout(() => { const inp = document.getElementById(focusId); if (inp) inp.focus(); }, 80);
}

function showOnlineLobby() {
    document.getElementById('setup').style.display = 'none';
    document.getElementById('online-lobby').classList.add('show');
    if (window.moveMusicPlayer) window.moveMusicPlayer('online');
    // Show warning if Firebase not configured
    document.getElementById('ol-firebase-warning').style.display =
        FIREBASE_CONFIG.apiKey === 'REPLACE_ME' ? 'block' : 'none';

    if (myUsername) {
        showOlMode();
    } else {
        const input = document.getElementById('ol-username-input');
        if (input) input.value = myUsername;
        document.getElementById('ol-username-error').style.display = 'none';
        showOlPanel('ol-username');
    }
}

function confirmUsername() {
    const input = document.getElementById('ol-username-input');
    const val = (input ? input.value : '').trim();
    if (!val) {
        document.getElementById('ol-username-error').style.display = '';
        return;
    }
    myUsername = val;
    sessionStorage.setItem('cr_username', myUsername);
    try { localStorage.setItem('cr_username', myUsername); } catch(e) {}
    showOlMode();
}

function showOlMode() {
    const tag = document.getElementById('ol-username-tag');
    if (tag) tag.textContent = myUsername || '(unnamed)';
    showOlPanel('ol-mode');
}
function showOlCreate() {
    buildOlCreateUI();
    showOlPanel('ol-create');
}
function showOlJoinPanel() {
    document.getElementById('ol-join-error').style.display = 'none';
    document.getElementById('ol-code-input').value = '';
    document.getElementById('ol-join-password-row').style.display = 'none';
    document.getElementById('ol-join-password-input').value = '';
    showOlPanel('ol-join-panel');
}

/* ── Build Create-Room picker UI ── */
function buildOlCreateUI() {
    // Number of players
    const npRow = document.getElementById('ol-np-btns');
    if (!npRow.children.length) {
        [2, 3, 4].forEach(n => {
            const b = document.createElement('button');
            b.className = 'pill' + (n === 2 ? ' active' : '');
            b.textContent = `${n} Players`;
            b.onclick = () => {
                onlineNumPlayers = n;
                npRow.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p === b));
            };
            npRow.appendChild(b);
        });
    }
    // Grid size
    const gRow = document.getElementById('ol-grid-btns');
    if (!gRow.children.length) {
        [[6, 6, '6×6'], [7, 7, '7×7'], [8, 8, '8×8'], [9, 9, '9×9'], [10, 10, '10×10']].forEach(([r, c, l], idx) => {
            const b = document.createElement('button');
            b.className = 'pill' + (idx === 3 ? ' active' : '');
            b.textContent = l;
            b.onclick = () => {
                onlineCfgRows = r; onlineCfgCols = c;
                gRow.querySelectorAll('.pill').forEach(p => p.classList.toggle('active', p === b));
            };
            gRow.appendChild(b);
        });
        onlineCfgRows = 9; onlineCfgCols = 9;
    }
}

/* ── Create a room in Firebase ── */
async function createRoom() {
    if (!initFirebase()) {
        document.getElementById('ol-firebase-warning').style.display = 'block';
        showOlPanel('ol-mode');
        return;
    }
    myUid = getMyUid();
    isHost = true;
    roomCode = generateRoomCode();
    myPlayerIndex = 0;

    const passwordRaw = (document.getElementById('ol-password-input').value || '').trim();
    onlineRoomPassword = passwordRaw;

    const roomData = {
        config: {
            rows: onlineCfgRows,
            cols: onlineCfgCols,
            numPlayers: onlineNumPlayers,
            timedMode: timedMode,
            timedSeconds: timedSeconds,
            nuclearMode: nuclearMode
        },
        slots: { 0: { uid: myUid, joined: true, name: myUsername, color: ALL_COLORS[0] } },
        hostUid: myUid,
        status: 'lobby',
        state: null,
        hasPassword: passwordRaw.length > 0,
        password: passwordRaw.length > 0 ? passwordRaw : null,
        createdAt: firebase.database.ServerValue.TIMESTAMP
    };

    roomRef = db.ref(`rooms/${roomCode}`);
    await roomRef.set(roomData);

    // Show lock icon in waiting room if password set
    const lockEl = document.getElementById('ol-lock-icon');
    if (lockEl) lockEl.style.display = passwordRaw.length > 0 ? '' : 'none';

    enterWaitingRoom();
}

/* ── Join a room by code ── */
async function joinRoomByCode() {
    const code = document.getElementById('ol-code-input').value.trim().toUpperCase();
    if (code.length < 4) { showJoinError('Please enter a valid room code.'); return; }
    if (!initFirebase()) { showJoinError('Firebase is not configured.'); return; }

    myUid = getMyUid();
    isHost = false;
    roomCode = code;
    roomRef = db.ref(`rooms/${roomCode}`);

    let snap;
    try { snap = await roomRef.once('value'); }
    catch (e) { showJoinError('Could not reach server. Check your connection.'); return; }

    if (!snap.exists()) { showJoinError('Room not found. Check the code and try again.'); return; }

    const room = snap.val();
    if (room.status !== 'lobby') { showJoinError('This game has already started.'); return; }

    // Password check
    if (room.hasPassword) {
        const pwRow = document.getElementById('ol-join-password-row');
        const pwInput = document.getElementById('ol-join-password-input');
        if (pwRow.style.display === 'none') {
            // First attempt — reveal password field and prompt
            pwRow.style.display = '';
            pwInput.focus();
            return;
        }
        const enteredPw = pwInput.value;
        if (enteredPw !== room.password) {
            showJoinError('Incorrect password. Try again.');
            pwInput.value = '';
            pwInput.focus();
            return;
        }
    }

    // Find first empty slot
    const slots = room.slots || {};
    let assignedSlot = -1;
    for (let i = 0; i < room.config.numPlayers; i++) {
        if (!slots[i]) { assignedSlot = i; break; }
    }
    if (assignedSlot === -1) { showJoinError('This room is full!'); return; }

    myPlayerIndex = assignedSlot;
    await roomRef.child(`slots/${assignedSlot}`).set({ uid: myUid, joined: true, name: myUsername, color: ALL_COLORS[assignedSlot] });

    // Show lock icon in waiting room if room has password
    const lockEl = document.getElementById('ol-lock-icon');
    if (lockEl) lockEl.style.display = room.hasPassword ? '' : 'none';

    enterWaitingRoom();
}

function showJoinError(msg) {
    const el = document.getElementById('ol-join-error');
    el.textContent = msg;
    el.style.display = 'block';
}

/* ── Join a random public (no-password) lobby room ── */
async function joinRandomRoom() {
    if (!initFirebase()) {
        document.getElementById('ol-firebase-warning').style.display = 'block';
        return;
    }

    const statusEl = document.getElementById('ol-random-status');
    const btn = document.getElementById('ol-random-btn');
    statusEl.style.display = '';
    statusEl.textContent = 'Searching for open rooms…';
    btn.disabled = true;

    try {
        const snap = await db.ref('rooms').orderByChild('status').equalTo('lobby').once('value');
        if (!snap.exists()) {
            statusEl.textContent = 'No open rooms found. Try creating one!';
            btn.disabled = false;
            return;
        }

        myUid = getMyUid();
        const rooms = snap.val();
        const candidates = [];

        for (const [code, room] of Object.entries(rooms)) {
            if (room.hasPassword) continue; // skip password-protected rooms
            const slots = room.slots || {};
            const filled = Object.keys(slots).length;
            const total = room.config ? room.config.numPlayers : 2;
            if (filled >= total) continue; // full
            // Find open slot
            let openSlot = -1;
            for (let i = 0; i < total; i++) { if (!slots[i]) { openSlot = i; break; } }
            if (openSlot === -1) continue;
            candidates.push({ code, room, openSlot });
        }

        if (candidates.length === 0) {
            statusEl.textContent = 'No public rooms available. Create one!';
            btn.disabled = false;
            return;
        }

        // Pick a random candidate
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        myUid = getMyUid();
        isHost = false;
        roomCode = pick.code;
        roomRef = db.ref(`rooms/${roomCode}`);
        myPlayerIndex = pick.openSlot;

        await roomRef.child(`slots/${pick.openSlot}`).set({ uid: myUid, joined: true, name: myUsername, color: ALL_COLORS[pick.openSlot] });

        statusEl.style.display = 'none';
        btn.disabled = false;

        const lockEl = document.getElementById('ol-lock-icon');
        if (lockEl) lockEl.style.display = 'none';

        enterWaitingRoom();

    } catch (e) {
        console.error('joinRandomRoom error:', e);
        statusEl.textContent = 'Error searching rooms. Please try again.';
        btn.disabled = false;
    }
}

/* ── Waiting room ── */
/* ── Lobby left notice ── */
let _prevSlotKeys = null;
let _prevSlotNames = {};
function showLobbyLeftNotice(name) {
    let toast = document.getElementById('host-left-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'host-left-toast';
        toast.className = 'host-left-toast cr-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> ${name} left the room.`;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
}

function enterWaitingRoom() {
    showOlPanel('ol-waiting');
    document.getElementById('ol-code-text').textContent = roomCode;
    document.getElementById('ol-start-btn').style.display = isHost ? '' : 'none';
    document.getElementById('ol-host-hint').style.display = isHost ? 'none' : '';
    _prevSlotKeys = null;
    _prevSlotNames = {};

    // Listen for room changes
    stopRoomListeners();
    const listener = roomRef.on('value', snap => {
        if (!snap.exists()) {
            // Room deleted (host left lobby before game started)
            if (!isHost) {
                stopRoomListeners();
                resetOnlineState();
                onlineMode = false;
                showOlPanel('ol-mode');
                showHostLeftNotice();
            }
            return;
        }
        const room = snap.val();
        updateWaitingRoomUI(room);

        // Detect if a non-host slot was removed (player left lobby)
        if (_prevSlotKeys) {
            const currentKeys = new Set(Object.keys(room.slots || {}));
            for (const k of _prevSlotKeys) {
                if (!currentKeys.has(k) && parseInt(k) !== myPlayerIndex) {
                    const leftName = _prevSlotNames[k] || ALL_NAMES[parseInt(k)];
                    showLobbyLeftNotice(leftName);
                }
            }
        }
        const currentSlots = room.slots || {};
        _prevSlotKeys = new Set(Object.keys(currentSlots));
        Object.entries(currentSlots).forEach(([k, v]) => { if (v && v.name) _prevSlotNames[k] = v.name; });

        if (room.status === 'playing' && room.state) {
            stopRoomListeners();
            launchOnlineGame(room);
        }
    });
    onlineListeners.push({ ref: roomRef, listener, event: 'value' });
}


/* ── Cycle color for the local player in the online waiting room ── */
async function cycleOnlineColor() {
    if (!roomRef || myPlayerIndex < 0) return;
    const snap = await roomRef.child('slots').once('value');
    const slots = snap.val() || {};
    const used = new Set(Object.entries(slots)
        .filter(([k]) => parseInt(k) !== myPlayerIndex && slots[k].color)
        .map(([, v]) => v.color));
    const cur = ALL_COLORS.indexOf(slots[myPlayerIndex]?.color || ALL_COLORS[myPlayerIndex]);
    let next = (cur + 1) % ALL_COLORS.length, guard = 0;
    while (used.has(ALL_COLORS[next]) && guard++ < ALL_COLORS.length)
        next = (next + 1) % ALL_COLORS.length;
    await roomRef.child(`slots/${myPlayerIndex}/color`).set(ALL_COLORS[next]);
}

function updateWaitingRoomUI(room) {
    const slots = room.slots || {};
    const numJoined = Object.keys(slots).length;
    const numNeeded = room.config.numPlayers;

    const list = document.getElementById('ol-player-list');
    list.innerHTML = '';
    for (let i = 0; i < numNeeded; i++) {
        const filled = !!slots[i];
        const isMe = filled && slots[i].uid === myUid;
        const slotName = filled && slots[i].name ? slots[i].name : ALL_NAMES[i];
        const col = ALL_COLORS[i];
        const div = document.createElement('div');
        div.className = 'ol-player-slot' + (filled ? ' filled' : '');
        const slotColor = (filled && slots[i].color) ? slots[i].color : col;
        div.style.setProperty('--slot-color', slotColor);
        div.innerHTML = `
            <div class="ol-slot-dot ${filled ? 'filled' : ''}" style="color:${slotColor}; background:${filled ? slotColor : 'transparent'}"></div>
            <span style="color:${filled ? slotColor : 'var(--dim)'}">
              ${slotName}${isMe ? '' : filled ? ' — joined' : ' — waiting…'}
            </span>
            ${isMe ? `<span class="ol-me-tag">You</span><button class="ol-color-btn" style="background:${slotColor};box-shadow:0 0 7px ${slotColor}88" onclick="cycleOnlineColor()" title="Change color"></button>` : ''}`;
        list.appendChild(div);
    }

    document.getElementById('ol-status').textContent = `${numJoined} / ${numNeeded} players joined`;
    document.getElementById('ol-status-sub').textContent =
        numJoined >= numNeeded ? 'Room is full — host can start' : 'Waiting for players…';

    // Show timed mode badge
    let timedBadge = document.getElementById('ol-timed-badge');
    if (room.config.timedMode) {
        if (!timedBadge) {
            timedBadge = document.createElement('div');
            timedBadge.id = 'ol-timed-badge';
            timedBadge.className = 'ol-timed-badge';
            const statusEl = document.getElementById('ol-status');
            statusEl.parentNode.insertBefore(timedBadge, statusEl.nextSibling);
        }
        const mins = Math.floor((room.config.timedSeconds || 180) / 60);
        timedBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Timed Mode &nbsp;·&nbsp; ${mins} min per player`;
        timedBadge.style.display = '';
    } else if (timedBadge) {
        timedBadge.style.display = 'none';
    }

    // Show nuclear mode badge
    let nrWaitBadge = document.getElementById('ol-nuclear-badge');
    if (room.config.nuclearMode) {
        if (!nrWaitBadge) {
            nrWaitBadge = document.createElement('div');
            nrWaitBadge.id = 'ol-nuclear-badge';
            nrWaitBadge.className = 'ol-timed-badge';
            nrWaitBadge.style.color = '#cc44ff';
            nrWaitBadge.style.borderColor = 'rgba(204,68,255,0.35)';
            nrWaitBadge.style.background = 'rgba(204,68,255,0.08)';
            const anchor = document.getElementById('ol-timed-badge') || document.getElementById('ol-status');
            anchor.insertAdjacentElement('afterend', nrWaitBadge);
        }
        nrWaitBadge.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="5" x2="12" y2="5.01"/><line x1="12" y1="19" x2="12" y2="19.01"/><line x1="5" y1="5" x2="5" y2="5.01"/><line x1="19" y1="5" x2="19" y2="5.01"/><line x1="5" y1="19" x2="5" y2="19.01"/><line x1="19" y1="19" x2="19" y2="19.01"/></svg> Nuclear Reaction Mode`;
        nrWaitBadge.style.display = '';
    } else if (nrWaitBadge) {
        nrWaitBadge.style.display = 'none';
    }

    if (isHost) {
        const btn = document.getElementById('ol-start-btn');
        btn.disabled = numJoined < 2;
    }
}

/* ── Host starts the game ── */
async function onlineStartGame() {
    if (!isHost) return;
    const snap = await roomRef.once('value');
    const room = snap.val();
    const slots = room.slots || {};
    const numJoined = Object.keys(slots).length;
    if (numJoined < 2) return;

    // Finalise player count (only filled slots)
    const actualCount = numJoined;
    await roomRef.child('config/numPlayers').set(actualCount);

    PCOLORS = Array.from({ length: actualCount }, (_, i) => (slots[i]?.color) || ALL_COLORS[i]);
    await roomRef.child('config/playerColors').set(PCOLORS);
    PNAMES = Array.from({ length: actualCount }, (_, i) => slots[i]?.name || ALL_NAMES[i]);
    IS_AI = new Array(actualCount).fill(false);
    cfg = { rows: room.config.rows, cols: room.config.cols };

    history = [];
    initState();
    // turnDeadline is derived from Firebase server timestamp on deserialize — no local clock needed

    // Store player names in room so all clients can read them
    await roomRef.child('config/playerNames').set(PNAMES);

    // Push initial state then flip status to 'playing'
    // IMPORTANT: capture moveSeq back onto S so P1's first move gets seq=2,
    // not seq=1 which P2 would discard as "already seen".
    const initialState = serializeState(S);
    S.moveSeq = initialState.moveSeq;
    await roomRef.child('state').set(initialState);
    await roomRef.child('status').set('playing');
}

/* ── Copy room code to clipboard ── */
function copyRoomCode() {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode).then(() => {
        const hint = document.querySelector('.ol-copy-hint');
        if (hint) { hint.textContent = 'copied!'; setTimeout(() => { hint.textContent = 'copy'; }, 1500); }
    }).catch(() => {/* ignore */ });
}

/* ── Write disconnect signal to Firebase, then fully exit ── */
async function leaveRoom() {
    if (!roomRef) { _doLocalLeave(); return; }

    if (onlineMode) {
        // Game is running — signal disconnect so others can react
        try {
            await roomRef.child('disconnected').set({ playerIndex: myPlayerIndex, name: PNAMES[myPlayerIndex] || '', ts: Date.now() });
        } catch (e) { /* ignore */ }
    } else if (isHost) {
        // In lobby as host — delete room so guests know
        try { await roomRef.remove(); } catch (e) { /* ignore */ }
    } else if (myPlayerIndex >= 0) {
        // In lobby as guest — remove slot so others see the vacancy immediately
        try { await roomRef.child(`slots/${myPlayerIndex}`).remove(); } catch (e) { /* ignore */ }
    }

    _doLocalLeave();
}

function _doLocalLeave() {
    stopRoomListeners();
    stopOnlineTurnTimer();
    const wasOnline = onlineMode;
    onlineMode = false;
    resetOnlineState();

    teardownChat();
    stopRematchListener();
    closeRematchOverlay();
    releaseWakeLock();

    document.getElementById('win-overlay').classList.remove('show');
    document.getElementById('game').style.display = 'none';
    document.getElementById('online-lobby').classList.remove('show');
    document.getElementById('setup').style.display = 'flex';
    if (window.moveMusicPlayer) window.moveMusicPlayer('setup');
    history = [];
    hideCombo(true);
    syncBallGrid();
}

/* ── Show left-side "X left the game" panel ── */
let leftSideTimer = null;
function showPlayerLeftSide(name, color) {
    const panel = document.getElementById('left-side');
    const nameEl = document.getElementById('left-side-name');
    if (!panel || !nameEl) return;
    nameEl.textContent = name;
    nameEl.style.color = color;
    nameEl.style.textShadow = `0 0 12px ${color}88`;
    panel.classList.add('visible');
    clearTimeout(leftSideTimer);
    leftSideTimer = setTimeout(() => panel.classList.remove('visible'), 3500);
}

/* ── Elimination animation: flash + implode cells before wiping ── */
function animateElimination(playerIndex, onDone) {
    const cells = [];
    for (let r = 0; r < cfg.rows; r++)
        for (let c = 0; c < cfg.cols; c++)
            if (S.grid[r][c].owner === playerIndex) {
                const el = cellEl(r, c);
                if (el) cells.push(el);
            }
    if (!cells.length || lowGfx) { onDone(); return; }
    cells.forEach(el => el.classList.add('elim-flash'));
    setTimeout(() => {
        cells.forEach(el => { el.classList.remove('elim-flash'); el.classList.add('elim-shrink'); });
        setTimeout(() => {
            cells.forEach(el => el.classList.remove('elim-shrink'));
            onDone();
        }, 350);
    }, 280);
}

/* ── Handle a player disconnect: eliminate them, wipe orbs, advance turn ── */
function handlePlayerDisconnect(playerIndex) {
    if (!S || S.over) return;
    window._playerDisconnectedThisGame = true;
    animateElimination(playerIndex, () => {
    // Wipe all their orbs from the board
    for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) {
            if (S.grid[r][c].owner === playerIndex) {
                S.orbCount[playerIndex] -= S.grid[r][c].count;
                S.grid[r][c] = { owner: -1, count: 0 };
            }
        }
    }
    S.orbCount[playerIndex] = 0;
    S.eliminated[playerIndex] = true;
    S.hasMoved[playerIndex] = true; // so elimination check works
    if (nuclearMode && S.nrMeter && S.nrMeter[playerIndex] > 0) nrDistributeMeter(playerIndex);

    // Check win condition
    const survivors = S.eliminated.map((e, i) => !e ? i : -1).filter(i => i >= 0);
    if (survivors.length === 1) {
        S.over = true;
        markAllDirty(); renderAll();
        showWin(survivors[0]);
        if (onlineMode) pushStateToFirebase();
        return;
    }

    // If it was their turn, advance to next alive player
    if (S.current === playerIndex) {
        let next = (playerIndex + 1) % PCOLORS.length;
        let guard = 0;
        while (S.eliminated[next] && guard++ < PCOLORS.length)
            next = (next + 1) % PCOLORS.length;
        S.current = next;
    }

    markAllDirty(); renderAll();
    if (onlineMode) {
        if (!S.over) S.turnDeadline = serverNow() + TURN_TIMER_MS;
        pushStateToFirebase();
        updateOnlineInteractivity();
    }
    }); // end animateElimination callback
}

function resetOnlineState() {
    roomRef = null;
    roomCode = null;
    isHost = false;
    myPlayerIndex = -1;
    lastWrittenStateTs = 0;
    onlineRoomPassword = '';
    _gameLaunched = false;
}

function stopRoomListeners() {
    onlineListeners.forEach(({ ref, listener, event }) => ref.off(event, listener));
    onlineListeners = [];
}

/* ── Show a toast when the host closes the room ── */
function showHostLeftNotice() {
    let toast = document.getElementById('host-left-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'host-left-toast';
        toast.className = 'host-left-toast';
        document.body.appendChild(toast);
    }
    toast.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg> Host left — the room has been closed.';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 4000);
}

/* ══════════════════════════════════════════════════════════════════
   CHAT
   ══════════════════════════════════════════════════════════════════ */
let chatListener = null;
let chatUnreadCount = 0;
let chatOpen = false;

function setupChat() {
    if (!roomRef) return;
    const panel = document.getElementById('chat-panel');
    const toggleBtn = document.getElementById('chat-toggle-btn');

    const isWide = window.innerWidth >= 900;
    chatOpen = isWide;
    panel.classList.toggle('open', isWide);
    toggleBtn.style.display = isWide ? 'none' : 'flex';
    syncUndoBtn();

    // Clear old messages
    document.getElementById('chat-messages').innerHTML = '';
    chatUnreadCount = 0;
    updateChatUnread();

    // Listen for new messages
    const chatRef = roomRef.child('chat');
    chatListener = chatRef.limitToLast(80).on('child_added', snap => {
        const msg = snap.val();
        if (!msg) return;
        appendChatMessage(msg);
        if (!chatOpen) {
            chatUnreadCount++;
            updateChatUnread();
            playChatPing();
        }
    });

    // Show who's in the game locally (no Firebase write needed)
    setTimeout(() => {
        PNAMES.forEach((name, i) => {
            appendChatMessage({ system: true, text: `${name} joined the game.` });
        });
    }, 200);
}

function teardownChat() {
    if (roomRef && chatListener) {
        roomRef.child('chat').off('child_added', chatListener);
        chatListener = null;
    }
    const panel = document.getElementById('chat-panel');
    const toggleBtn = document.getElementById('chat-toggle-btn');
    if (panel) panel.classList.remove('open');
    if (toggleBtn) toggleBtn.style.display = 'none';
    chatUnreadCount = 0;
    chatOpen = false;
    updateChatUnread();
    // Restore undo icon
    const undoIcon = document.getElementById('undo-icon');
    const chatIcon = document.getElementById('chat-icon');
    if (undoIcon) undoIcon.style.display = '';
    if (chatIcon) chatIcon.style.display = 'none';
}

function toggleChat() {
    const panel = document.getElementById('chat-panel');
    chatOpen = !panel.classList.contains('open');
    panel.classList.toggle('open', chatOpen);
    if (chatOpen) {
        chatUnreadCount = 0;
        updateChatUnread();
        // Scroll to bottom
        const msgs = document.getElementById('chat-messages');
        msgs.scrollTop = msgs.scrollHeight;
        document.getElementById('chat-input').focus();
    }
}

let chatFontSize = 13;
function adjustChatFontSize(delta) {
    chatFontSize = Math.max(9, Math.min(22, chatFontSize + delta));
    document.getElementById('chat-messages').style.setProperty('--chat-font-size', chatFontSize + 'px');
}

function updateChatUnread() {
    const badge = document.getElementById('chat-unread');
    if (!badge) return;
    if (chatUnreadCount > 0) {
        badge.textContent = chatUnreadCount > 9 ? '9+' : chatUnreadCount;
        badge.style.display = '';
    } else {
        badge.style.display = 'none';
    }
    // Red dot on the in-game undo/chat toggle button
    const dot = document.getElementById('chat-icon-dot');
    if (dot) dot.style.display = chatUnreadCount > 0 ? 'block' : 'none';
}

function playChatPing() {
    try {
        const s = loadSettings();
        if ((s.sfxVol || 0) === 0) return;
        const ac = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ac.createOscillator();
        const gain = ac.createGain();
        osc.connect(gain); gain.connect(ac.destination);
        osc.frequency.value = 880; osc.type = 'sine';
        gain.gain.setValueAtTime((s.sfxVol / 100) * 0.15, ac.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.2);
        osc.start(); osc.stop(ac.currentTime + 0.2);
    } catch(e) {}
}

function sendChatMessage() {
    if (!roomRef) return;
    const input = document.getElementById('chat-input');
    const text = (input.value || '').trim();
    if (!text) return;
    input.value = '';
    roomRef.child('chat').push({
        playerIndex: myPlayerIndex,
        name: myUsername || PNAMES[myPlayerIndex] || `Player ${myPlayerIndex + 1}`,
        color: PCOLORS[myPlayerIndex] || '#fff',
        text,
        ts: Date.now()
    });
}

function appendChatMessage(msg) {
    const msgs = document.getElementById('chat-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    if (msg.system) {
        div.className = 'chat-msg system';
        div.innerHTML = `<span class="chat-msg-text">${escapeHtml(msg.text)}</span>`;
    } else {
        div.className = 'chat-msg';
        div.innerHTML = `
            <span class="chat-msg-name" style="color:${msg.color}">${escapeHtml(msg.name)}</span>
            <span class="chat-msg-text">${escapeHtml(msg.text)}</span>`;
    }
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
}

function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function addSystemChatMessage(text) {
    if (!document.getElementById('chat-panel')?.classList.contains('open') &&
        document.getElementById('chat-panel')?.style.display !== 'none') {
        chatUnreadCount++;
        updateChatUnread();
    }
    appendChatMessage({ system: true, text });
}

/* ── Launch online game on all clients ── */
let _gameLaunched = false;
function launchOnlineGame(room) {
    if (_gameLaunched) return;
    _gameLaunched = true;
    onlineMode = true;
    const np = room.config.numPlayers;
    const storedNames  = room.config.playerNames  ? Object.values(room.config.playerNames)  : [];
    const storedColors = room.config.playerColors ? Object.values(room.config.playerColors) : [];
    PNAMES  = Array.from({ length: np }, (_, i) => storedNames[i]  || ALL_NAMES[i]);
    PCOLORS = Array.from({ length: np }, (_, i) => storedColors[i] || ALL_COLORS[i]);
    IS_AI = new Array(np).fill(false);
    IS_HARD_AI = new Array(np).fill(false);
    cfg = { rows: room.config.rows, cols: room.config.cols };
    timedMode    = !!room.config.timedMode;
    timedSeconds = room.config.timedSeconds || 180;
    nuclearMode  = !!room.config.nuclearMode;

    document.getElementById('online-lobby').classList.remove('show');
    document.getElementById('game').style.display = 'flex';
    if (window.moveMusicPlayer) window.moveMusicPlayer('game-online');

    window._playerDisconnectedThisGame = false;
    S = deserializeState(room.state);
    window._orbAnimEpoch = Date.now();
    history = [];
    buildGridDOM();
    buildPlayerStrip();
    hideCombo(true);
    markAllDirty(); renderAll();
    syncUndoBtn();
    updateOnlineInteractivity();
    setupChat();
    if (nuclearMode) nrCanvasInit();

    requestWakeLock();
    startPlayerTimer();
    // Track last applied move sequence to avoid duplicates (clock-skew-proof)
    let lastSeenMoveSeq = room.state?.moveSeq ?? 0;
    _pendingStateSnap = null;

    // Listen for state changes (other players' moves)
    const stateRef = roomRef.child('state');
    const stateListener = stateRef.on('value', snap => {
        // Skip if animating — playRemoteMove reconciles to final state at the end anyway
        if (!snap.exists() || S.animating) return;
        const data = snap.val();
        if (!data) return;
        const seq = data.moveSeq ?? 0;

        // Rematch: host flagged this push with rematch:true
        if (data.rematch && data.writerUid !== myUid) {
            lastSeenMoveSeq = seq;
            closeRematchOverlay();
            document.getElementById('win-overlay').classList.remove('show');
            const sp = document.getElementById('summary-panel'); if (sp) sp.style.display = 'none';
            window._playerDisconnectedThisGame = false;
            history = [];
            resetMatchStats();
            if (_nrTargeting) nrExitTargeting();
            S = deserializeState(data);
            buildGridDOM();
            buildPlayerStrip();
            hideCombo(true);
            markAllDirty(); renderAll();
            syncUndoBtn();
            startPlayerTimer();
            updateOnlineInteractivity();
            return;
        }

        if (seq <= lastSeenMoveSeq) return;
        lastSeenMoveSeq = seq; // always update before any early return
        if (data.writerUid === myUid) return; // skip own echo

        if (data.move && data.move.r != null && data.move.c != null) {
            playRemoteMove(data.move.r, data.move.c, data);
        } else {
            // State-only update (NR ability, blackout skip, timer elimination, etc.)
            if (_nrTargeting) nrExitTargeting();
            S = deserializeState(data);
            markAllDirty(); renderAll();
            if (S.over) {
                const winner = S.eliminated.findIndex(e => !e);
                if (winner !== -1) showWin(winner);
                stopPlayerTimer();
            } else {
                startPlayerTimer();
            }
            updateOnlineInteractivity();
        }
    });
    onlineListeners.push({ ref: stateRef, listener: stateListener, event: 'value' });

    // Listen for player disconnects
    let lastDisconnectTs = 0;
    const discRef = roomRef.child('disconnected');
    const discListener = discRef.on('value', snap => {
        if (!snap.exists()) return;
        const disc = snap.val();
        if (!disc || disc.ts <= lastDisconnectTs) return;
        lastDisconnectTs = disc.ts;
        const pi = disc.playerIndex;
        if (pi === myPlayerIndex) return; // we're the one leaving, ignore
        const name = PNAMES[pi] || `Player ${pi + 1}`;
        const color = PCOLORS[pi] || '#fff';
        showPlayerLeftSide(name, color);
        addSystemChatMessage(`${name} left the game.`);
        // Always flag a disconnect so rematch btn is greyed (even if game is already over)
        window._playerDisconnectedThisGame = true;
        const rematchBtn = document.getElementById('rematch-btn');
        if (rematchBtn) {
            rematchBtn.disabled = true;
            rematchBtn.title = 'A player left — rematch unavailable';
        }
        // Also close any pending rematch overlay
        stopRematchListener();
        if (roomRef) roomRef.child('rematch').remove().catch(() => {});
        closeRematchOverlay();
        handlePlayerDisconnect(pi);
        // Clear the disconnect signal so it doesn't re-fire on reconnect
        if (isHost) roomRef.child('disconnected').remove().catch(() => {});
    });
    onlineListeners.push({ ref: discRef, listener: discListener, event: 'value' });

    // All players listen on the rematch node so non-proposers see rematch requests
    const rematchNodeRef = roomRef.child('rematch');
    const rematchNodeListener = rematchNodeRef.on('value', snap => {
        if (!snap.exists() || !snap.val()) return;
        // If we have no listener yet, start one (non-proposer path)
        if (!_rematchListener) {
            listenRematchVotes();
        }
    });
    onlineListeners.push({ ref: rematchNodeRef, listener: rematchNodeListener, event: 'value' });
}

/* ── Enforce turn in online mode ── */
function updateOnlineInteractivity() {
    const hint = document.getElementById('online-turn-hint');
    if (!onlineMode) { hint.textContent = ''; return; }
    if (S.over) {
        setGridInteractive(false);
        hint.textContent = '';
        stopOnlineTurnTimer();
        return;
    }
    const myTurn = S.current === myPlayerIndex && !IS_AI[S.current];
    setGridInteractive(myTurn && !S.animating);
    hint.textContent = myTurn ? '▸ Your turn — click a cell' : IS_AI[S.current] ? '' : `Waiting for ${PNAMES[S.current]}…`;
    hint.className = 'online-turn-hint' + (myTurn ? ' your-turn' : '');
    startOnlineTurnTimer();
}

/* ══════════════════════════════════════════════════════════════════
   ONLINE TURN TIMER
   ══════════════════════════════════════════════════════════════════ */
function startOnlineTurnTimer() {
    stopOnlineTurnTimer();
    if (!onlineMode || !S || S.over) return;

    const deadline = S.turnDeadline;
    const timerEl = document.getElementById('turn-timer');
    const barEl   = document.getElementById('turn-timer-bar');
    const hint    = document.getElementById('online-turn-hint');
    if (!timerEl || !barEl || !deadline) { if (timerEl) timerEl.style.display = 'none'; return; }

    timerEl.style.display = '';
    timerEl.classList.remove('urgent');

    const tick = () => {
        if (!onlineMode || !S || S.over || !S.turnDeadline) { stopOnlineTurnTimer(); return; }

        const remaining = S.turnDeadline - serverNow();
        const fraction  = Math.max(0, Math.min(1, remaining / TURN_TIMER_MS));
        barEl.style.transform = `scaleX(${fraction})`;

        // Color the bar based on the current player's color
        barEl.style.background = PCOLORS[S.current] || '#1fd97a';

        const secs = Math.max(0, Math.ceil(remaining / 1000));
        if (remaining <= 10000) timerEl.classList.add('urgent');
        else timerEl.classList.remove('urgent');

        // Update hint text with countdown
        if (hint && !S.animating) {
            const myTurn = S.current === myPlayerIndex;
            if (myTurn) {
                hint.textContent = `▸ Your turn — ${secs}s`;
            } else {
                hint.textContent = `Waiting for ${PNAMES[S.current]}… (${secs}s)`;
            }
        }

        // Force a move when timer runs out on our turn
        if (remaining <= 0 && S.current === myPlayerIndex && !S.animating) {
            stopOnlineTurnTimer();
            _forceOnlineMove();
        }
    };

    tick(); // paint immediately
    _onlineTurnTimerInterval = setInterval(tick, 200);
}

function stopOnlineTurnTimer() {
    if (_onlineTurnTimerInterval) {
        clearInterval(_onlineTurnTimerInterval);
        _onlineTurnTimerInterval = null;
    }
    const timerEl = document.getElementById('turn-timer');
    if (timerEl) { timerEl.style.display = 'none'; timerEl.classList.remove('urgent'); }
}

function _forceOnlineMove() {
    if (!onlineMode || !S || S.over || S.animating || S.current !== myPlayerIndex) return;

    // Cancel any active NR targeting before forcing a move — otherwise handleClick
    // would route the random cell through nrHandleCellTarget which would fail validation.
    if (_nrTargeting) nrCancelTargeting();

    // Collect cells we own first; fall back to empty cells if we own nothing.
    // Pick randomly — idling should be a punishment, not a free optimal move.
    const owned = [];
    const empty = [];
    for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) {
            const cell = S.grid[r][c];
            if (cell.owner === myPlayerIndex) owned.push({ r, c });
            else if (cell.owner === -1) empty.push({ r, c });
        }
    }
    const candidates = owned.length ? owned : empty;
    if (!candidates.length) return;

    const { r, c } = candidates[Math.floor(Math.random() * candidates.length)];

    // Announce in chat
    if (roomRef) {
        roomRef.child('chat').push({
            system: true,
            text: `${PNAMES[myPlayerIndex]} ran out of time — move was forced.`
        }).catch(() => {});
    }

    handleClick(r, c);
}



/* ══════════════════════════════════════════════════════════════════
   SCREEN SHAKE
   ══════════════════════════════════════════════════════════════════ */
/* ══════════════════════════════════════════════════════════════════
   SETTINGS — persisted to localStorage
   ══════════════════════════════════════════════════════════════════ */
const SETTINGS_KEY = 'cr_settings';
const SETTINGS_DEFAULTS = { musicVol: 50, sfxVol: 55, lowGfx: false, screenShake: true, orbSkin: 'glow' };

function loadSettings() {
    try { return Object.assign({}, SETTINGS_DEFAULTS, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); }
    catch (e) { return Object.assign({}, SETTINGS_DEFAULTS); }
}
function saveSettings(s) {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {}
}
function applySettings(s) {
    lowGfx = !!s.lowGfx;
    screenShake = s.screenShake !== false;
    document.body.classList.toggle('low-gfx', lowGfx);
    document.body.classList.remove('skin-flat', 'skin-numbered');
    if (s.orbSkin === 'flat') document.body.classList.add('skin-flat');
    else if (s.orbSkin === 'numbered') document.body.classList.add('skin-numbered');
    if (window.setMusicVolume) window.setMusicVolume(s.musicVol / 100);
    if (window.setSfxVolume)   window.setSfxVolume(s.sfxVol / 100);
    syncSettingsUI(s);
}
function syncSettingsUI(s) {
    const mv = document.getElementById('s-music-vol');
    const sv = document.getElementById('s-sfx-vol');
    const lg = document.getElementById('s-lowgfx-toggle');
    const ss = document.getElementById('s-shake-toggle');
    const mvv = document.getElementById('s-music-val');
    const svv = document.getElementById('s-sfx-val');
    if (mv)  { mv.value = s.musicVol; mv.style.setProperty('--val', s.musicVol + '%'); }
    if (sv)  { sv.value = s.sfxVol;   sv.style.setProperty('--val', s.sfxVol + '%'); }
    if (lg)  lg.classList.toggle('on', !!s.lowGfx);
    if (ss)  ss.classList.toggle('on', s.screenShake !== false);
    if (mvv) mvv.textContent = s.musicVol;
    if (svv) svv.textContent = s.sfxVol;
    document.querySelectorAll('.orb-skin-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.skin === (s.orbSkin || 'glow')));
}

const _settings = loadSettings();
let lowGfx    = !!_settings.lowGfx;
let screenShake = _settings.screenShake !== false;
document.body.classList.toggle('low-gfx', lowGfx);

function toggleSettings() {
    const panel = document.getElementById('settings-panel');
    const overlay = document.getElementById('settings-overlay');
    if (!panel) return;
    const open = panel.classList.toggle('open');
    if (overlay) overlay.classList.toggle('open', open);
    // Mark active settings buttons
    document.querySelectorAll('.settings-btn').forEach(b => b.classList.toggle('active', open));
    if (open) syncSettingsUI(loadSettings());
}
function onSettingsMusicVol(val) {
    const s = loadSettings(); s.musicVol = +val; saveSettings(s);
    if (window.setMusicVolume) window.setMusicVolume(s.musicVol / 100);
    const el = document.getElementById('s-music-vol'); if (el) el.style.setProperty('--val', val + '%');
    const vEl = document.getElementById('s-music-val'); if (vEl) vEl.textContent = val;
}
function onSettingsSfxVol(val) {
    const s = loadSettings(); s.sfxVol = +val; saveSettings(s);
    if (window.setSfxVolume) window.setSfxVolume(s.sfxVol / 100);
    const el = document.getElementById('s-sfx-vol'); if (el) el.style.setProperty('--val', val + '%');
    const vEl = document.getElementById('s-sfx-val'); if (vEl) vEl.textContent = val;
}
function onSettingsLowGfx() {
    const s = loadSettings(); s.lowGfx = !s.lowGfx; saveSettings(s);
    lowGfx = s.lowGfx;
    document.body.classList.toggle('low-gfx', lowGfx);
    const btn = document.getElementById('s-lowgfx-toggle'); if (btn) btn.classList.toggle('on', lowGfx);
}
function onSettingsScreenShake() {
    const s = loadSettings(); s.screenShake = !s.screenShake; saveSettings(s);
    screenShake = s.screenShake;
    const btn = document.getElementById('s-shake-toggle'); if (btn) btn.classList.toggle('on', screenShake);
}
function toggleLowGfx() { onSettingsLowGfx(); }
function onSettingsOrbSkin(skin) {
    const s = loadSettings(); s.orbSkin = skin; saveSettings(s);
    document.body.classList.remove('skin-flat', 'skin-numbered');
    if (skin === 'flat') document.body.classList.add('skin-flat');
    else if (skin === 'numbered') document.body.classList.add('skin-numbered');
    document.querySelectorAll('.orb-skin-btn').forEach(b => b.classList.toggle('active', b.dataset.skin === skin));
    markAllDirty(); if (S.grid) renderAll();
}



/* ══════════════════════════════════════════════════════════════════
   HAPTIC FEEDBACK
   ══════════════════════════════════════════════════════════════════ */
function triggerHaptic(pattern) {
    try {
        if (navigator.vibrate) navigator.vibrate(pattern);
    } catch (e) {}
}

/* ══════════════════════════════════════════════════════════════════
   KEEP SCREEN AWAKE (Wake Lock API)
   ══════════════════════════════════════════════════════════════════ */
let _wakeLock = null;
async function requestWakeLock() {
    try {
        if (!navigator.wakeLock) return;
        if (_wakeLock) return;
        _wakeLock = await navigator.wakeLock.request('screen');
        _wakeLock.addEventListener('release', () => { _wakeLock = null; });
    } catch (e) { _wakeLock = null; }
}
function releaseWakeLock() {
    if (_wakeLock) { _wakeLock.release().catch(() => {}); _wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && document.getElementById('game').style.display !== 'none') {
        requestWakeLock();
    }
});


function triggerShake(comboStep, unstableCount) {
    if (lowGfx || !screenShake) return;
    if (comboStep < 3 && unstableCount < 4) return;
    const grid = document.getElementById('grid-and-combo');
    if (!grid) return;
    const big = comboStep >= 6 || unstableCount >= 8;
    const cls = big ? 'shake-lg' : 'shake-sm';
    grid.classList.remove('shake-sm', 'shake-lg');
    grid.classList.add(cls);
    setTimeout(() => grid.classList.remove(cls), big ? 320 : 220);
}

/* ══════════════════════════════════════════════════════════════════
   AMBIENT LAYER
   ══════════════════════════════════════════════════════════════════ */
let _ambientFadeTimer = null;
function pulseAmbient(col, intensity) {
    if (lowGfx) return;
    const el = document.getElementById('ambient-layer');
    if (!el) return;
    const alpha = Math.min(0.18, 0.04 + intensity * 0.025);
    el.style.background = `radial-gradient(ellipse at center, ${col}${Math.round(alpha * 255).toString(16).padStart(2,'0')} 0%, transparent 70%)`;
    el.style.opacity = '1';
    clearTimeout(_ambientFadeTimer);
    _ambientFadeTimer = setTimeout(() => { el.style.opacity = '0'; }, 400);
}

/* ── Push final state to Firebase after move ── */
async function pushStateToFirebase() {
    if (!onlineMode || !roomRef) return;
    try {
        // turnDeadline is no longer stored — each client derives it from the server-set ts on read
        const serialized = serializeState(S);
        S.moveSeq = serialized.moveSeq; // keep local state in sync
        await roomRef.child('state').set(serialized);
        if (S.over) await roomRef.child('status').set('over');
    } catch (e) {
        console.error('Firebase write failed:', e);
    }
}

/* ── Serialise / deserialise game state for Firebase ── */
function serializeState(state) {
    return {
        grid: state.grid.map(row => row.map(cell => ({
            o: cell.owner, c: cell.count,
            fr: cell.frozen || 0, inf: cell.infect ?? -1,
            bdr: cell.backdraft ?? -1, ign: cell.ignite || 0,
            cry: cell._cryoFrozen ? 1 : 0, fby: cell.frozenBy ?? -1, igo: cell.igniteOwner ?? -1, azf: cell._absZeroFrozen ? 1 : 0
            // _airstrikeOwner is intentionally excluded — transient, never persisted
        }))),
        current: state.current,
        orbCount: state.orbCount,
        hasMoved: state.hasMoved,
        eliminated: state.eliminated,
        over: state.over,
        turn: state.turn,
        moveSeq: (state.moveSeq || 0) + 1,
        writerUid: myUid,
        move: state.pendingMove || null,
        playerTimers: timedMode ? [...playerTimers] : null,
        nrMeter:      nuclearMode ? [...(state.nrMeter      || [])] : null,
        nrAbilityIdx: nuclearMode ? [...(state.nrAbilityIdx || [])] : null,
        nrBlackout:   nuclearMode ? [...(state.nrBlackout   || [])] : null,
        nrSurge:      nuclearMode ? [...(state.nrSurge      || [])] : null,
        nrIceWall:    nuclearMode ? [...(state.nrIceWall    || [])] : null,
        nrFirestorm:  nuclearMode ? [...(state.nrFirestorm  || [])] : null,
        nrStaticField:nuclearMode ? [...(state.nrStaticField|| [])] : null,
        ts: firebase.database.ServerValue.TIMESTAMP
    };
}

function deserializeState(data) {
    const toArr = v => Array.isArray(v) ? v : Object.values(v);
    const serverWriteTime = data.ts || serverNow();
    if (timedMode && data.playerTimers) {
        const rawTimers = data.playerTimers;
        const arr = Array.isArray(rawTimers) ? rawTimers : Object.values(rawTimers);
        playerTimers = arr.map(v => (typeof v === 'number' ? v : timedSeconds * 1000));
    }
    const np = data.orbCount ? toArr(data.orbCount).length : 2;
    const s = {
        grid: toArr(data.grid).map(row =>
            toArr(row).map(cell => ({
                owner: cell.o, count: cell.c,
                frozen: cell.fr || 0, infect: cell.inf ?? -1,
                backdraft: cell.bdr ?? -1, ignite: cell.ign || 0,
                _cryoFrozen: !!(cell.cry), frozenBy: cell.fby ?? -1, igniteOwner: cell.igo ?? -1, _absZeroFrozen: !!(cell.azf)
            }))),
        current: data.current,
        orbCount: toArr(data.orbCount),
        hasMoved: toArr(data.hasMoved),
        eliminated: toArr(data.eliminated),
        animating: false,
        over: data.over,
        turn: data.turn || 0,
        moveSeq: data.moveSeq || 0,
        turnDeadline: data.over ? null : serverWriteTime + TURN_TIMER_MS,
        nrMeter:      data.nrMeter      ? toArr(data.nrMeter)      : new Array(np).fill(0),
        nrAbilityIdx: data.nrAbilityIdx ? toArr(data.nrAbilityIdx) : new Array(np).fill(0),
        nrBlackout:   data.nrBlackout   ? toArr(data.nrBlackout)   : new Array(np).fill(false),
        nrSurge:      data.nrSurge      ? toArr(data.nrSurge)      : new Array(np).fill(0),
        nrIceWall:    data.nrIceWall    ? toArr(data.nrIceWall)    : new Array(np).fill(false),
        nrFirestorm:  data.nrFirestorm  ? toArr(data.nrFirestorm)  : new Array(np).fill(false),
        nrStaticField:data.nrStaticField? toArr(data.nrStaticField): new Array(np).fill(false),
    };
    return s;
}

/* ══════════════════════════════════════════════════════════════════
   GAME START / INIT (pass-and-play)
   ══════════════════════════════════════════════════════════════════ */
function startGame() {
    if (ballOrder.length < 2) return;
    PCOLORS = ballOrder.map(i => ballColors[i]);
    PNAMES = ballOrder.map(i => ALL_NAMES[i]);
    IS_AI = ballOrder.map(i => ballModes[i] === 2 || ballModes[i] === 3);
    IS_HARD_AI = ballOrder.map(i => ballModes[i] === 3);
    onlineMode = false;
    resetOnlineState();

    document.getElementById('setup').style.display = 'none';
    document.getElementById('game').style.display = 'flex';
    if (window.moveMusicPlayer) window.moveMusicPlayer('game-single');
    history = [];
    resetMatchStats();
    initState();
    buildGridDOM();
    buildPlayerStrip();
    hideCombo(true);
    markAllDirty(); renderAll();
    syncUndoBtn();
    if (nuclearMode) nrCanvasInit();
    if (IS_AI[0]) scheduleAiTurn();
    else setGridInteractive(true);
    requestWakeLock();
    startPlayerTimer();
}

function initState() {
    gameSession++;
    window._orbAnimEpoch = Date.now();
    playerTimers = timedMode ? new Array(PCOLORS.length).fill(timedSeconds * 1000) : [];
    _nrRoundStartOrbs = new Array(PCOLORS.length).fill(0); // all equal at start — no underdog buff round 1
    const np = PCOLORS.length;
    S = {
        grid: Array.from({ length: cfg.rows }, () =>
            Array.from({ length: cfg.cols }, () => ({
                owner: -1, count: 0,
                // NR per-cell fields (always present, ignored when !nuclearMode)
                frozen: 0, infect: -1, backdraft: -1, ignite: 0, _cryoFrozen: false, frozenBy: -1, igniteOwner: -1, _absZeroFrozen: false
            }))),
        current: 0,
        orbCount: new Array(np).fill(0),
        hasMoved: new Array(np).fill(false),
        eliminated: new Array(np).fill(false),
        animating: false,
        over: false,
        turn: 0,
        moveSeq: 0,
        // NR per-player fields
        nrMeter:       new Array(np).fill(0),
        nrAbilityIdx:  new Array(np).fill(0),
        nrBlackout:    new Array(np).fill(false),
        nrSurge:       new Array(np).fill(0),
        nrIceWall:     new Array(np).fill(false),
        nrFirestorm:   new Array(np).fill(false),
        nrStaticField: new Array(np).fill(false),
        _nrSurgeFreeThisTurn: false,
        _nrSurgeUsedThisTurn: 0,
    };
}

function cloneState() {
    return {
        grid: S.grid.map(row => row.map(cell => ({
            owner: cell.owner, count: cell.count,
            frozen: cell.frozen || 0, infect: cell.infect ?? -1,
            backdraft: cell.backdraft ?? -1, ignite: cell.ignite || 0,
            _cryoFrozen: !!cell._cryoFrozen, frozenBy: cell.frozenBy ?? -1, igniteOwner: cell.igniteOwner ?? -1, _absZeroFrozen: !!cell._absZeroFrozen
        }))),
        current: S.current,
        orbCount: [...S.orbCount],
        hasMoved: [...S.hasMoved],
        eliminated: [...S.eliminated],
        animating: false,
        over: S.over,
        turn: S.turn,
        moveSeq: S.moveSeq || 0,
        nrMeter:      [...(S.nrMeter      || [])],
        nrAbilityIdx: [...(S.nrAbilityIdx || [])],
        nrBlackout:   [...(S.nrBlackout   || [])],
        nrSurge:      [...(S.nrSurge      || [])],
        nrIceWall:    [...(S.nrIceWall    || [])],
        nrFirestorm:  [...(S.nrFirestorm  || [])],
        nrStaticField:[...(S.nrStaticField|| [])],
        _nrSurgeFreeThisTurn: false, // never carry free-turn across undo
        _nrSurgeUsedThisTurn: 0,
    };
}

/* ══════════════════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════════════════ */
function critMass(r, c) {
    const er = r === 0 || r === cfg.rows - 1;
    const ec = c === 0 || c === cfg.cols - 1;
    return er && ec ? 2 : er || ec ? 3 : 4;
}
function neighbors(r, c) {
    const n = [];
    if (r > 0) n.push([r - 1, c]);
    if (r < cfg.rows - 1) n.push([r + 1, c]);
    if (c > 0) n.push([r, c - 1]);
    if (c < cfg.cols - 1) n.push([r, c + 1]);
    return n;
}
let gameSession = 0;
function delay(ms) { return new Promise(r => setTimeout(r, ms)); }
function sessionDelay(ms, session) {
    return new Promise(r => setTimeout(r, ms)).then(() => {
        if (session !== gameSession) throw new Error('stale');
    });
}
function cellEl(r, c) { return document.querySelector(`#grid .cell[data-r="${r}"][data-c="${c}"]`); }

/* ══════════════════════════════════════════════════════════════════
   BUILD DOM
   ══════════════════════════════════════════════════════════════════ */
function buildGridDOM() {
    const g = document.getElementById('grid');
    g.innerHTML = '';
    g.classList.add('grid-entering');
    setTimeout(() => g.classList.remove('grid-entering'), 800);
    const maxW = Math.min(window.innerWidth - 24, 720);
    const maxH = window.innerHeight - 230;
    const szW = Math.floor((maxW - 16 - (cfg.cols - 1) * 2) / cfg.cols);
    const szH = Math.floor((maxH - 16 - (cfg.rows - 1) * 2) / cfg.rows);
    const sz = Math.max(28, Math.min(szW, szH, 68));
    g.style.gridTemplateColumns = `repeat(${cfg.cols}, ${sz}px)`;
    for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) {
            const el = document.createElement('div');
            el.className = 'cell';
            el.dataset.r = r; el.dataset.c = c;
            el.style.width = el.style.height = sz + 'px';
            el.innerHTML = '<div class="orb-layer"></div>';
            el.style.animationDelay = `${(r + c) * 22}ms`;
            el.addEventListener('click', () => handleClick(r, c));
            g.appendChild(el);
        }
    }
}

function buildPlayerStrip() {
    const strip = document.getElementById('pstrip');
    strip.innerHTML = '';
    for (let i = 0; i < PCOLORS.length; i++) {
        const card = document.createElement('div');
        card.className = 'pcard alive' + (IS_AI[i] ? ' is-ai' : '');
        card.id = `pc${i}`;
        card.style.setProperty('--pc', PCOLORS[i]);
        const aiChip = IS_HARD_AI[i] ? `<span class="ai-chip hard-ai-chip">Hard AI</span>` : IS_AI[i] ? `<span class="ai-chip">AI</span>` : '';
        const youChip = onlineMode && i === myPlayerIndex ? `<span class="you-chip">You</span>` : '';
        const nrCharIdx = ALL_COLORS.indexOf(PCOLORS[i]);
        const nrCharName = nrCharIdx >= 0 ? NR_CHARS[nrCharIdx].name : '';
        const nrAbilityName = nrCharIdx >= 0 ? NR_ABILITIES[NR_CHARS[nrCharIdx].abilities[0]].name : '';
        card.innerHTML = `
      <div class="pn" style="color:${PCOLORS[i]}">${PNAMES[i]}${aiChip}${youChip}</div>
      <div class="pc-wrap">
        <span class="pc" id="porbs${i}">0</span>
        <span class="gain-badge" id="gb${i}"></span>
      </div>
      <div class="pl">orbs</div>
      <div class="ptimer" id="ptimer${i}" style="display:none"></div>
      <div class="nr-meter-wrap" id="nr-meter-wrap${i}" style="display:none">
        <div class="nr-meter-bar" id="nr-meter-bar${i}"></div>
      </div>
      <div class="nr-char-row" id="nr-char-row${i}" style="display:none">
        <span class="nr-char-name">${nrCharName}</span>
        <span class="nr-ability-name" id="nr-ability-name${i}">${nrAbilityName}</span>
      </div>`;
        if (nuclearMode) {
            card.addEventListener('click', () => onPlayerCardClick(i));
            card.style.cursor = 'pointer';
        }
        strip.appendChild(card);
    }
}

/* ══════════════════════════════════════════════════════════════════
   COMBO DISPLAY
   ══════════════════════════════════════════════════════════════════ */
function showCombo(n, col) {
    const side = document.getElementById('combo-side');
    const num = document.getElementById('combo-num');
    side.classList.add('visible');
    num.textContent = n;
    num.style.color = col;
    num.style.textShadow = `0 0 18px ${col}99, 0 0 36px ${col}55`;
    num.classList.remove('bump');
    setTimeout(() => num.classList.add('bump'), 0);
}
function hideCombo(instant = false) {
    if (instant) {
        clearTimeout(comboHideTimer);
        document.getElementById('combo-side').classList.remove('visible');
        comboCount = 0;
    } else {
        clearTimeout(comboHideTimer);
        comboHideTimer = setTimeout(() => {
            document.getElementById('combo-side').classList.remove('visible');
            comboCount = 0;
        }, 1000);
    }
}

/* ══════════════════════════════════════════════════════════════════
   GAIN BADGE
   ══════════════════════════════════════════════════════════════════ */
function updateGainBadge(playerIdx, gain) {
    const badge = document.getElementById(`gb${playerIdx}`);
    if (!badge) return;
    if (gain > 0) {
        badge.textContent = `+${gain}`;
        badge.classList.remove('commit'); badge.classList.add('visible');
    } else {
        badge.classList.remove('visible'); badge.textContent = '';
    }
}
function commitGainBadge(playerIdx) {
    const badge = document.getElementById(`gb${playerIdx}`);
    const countEl = document.getElementById(`porbs${playerIdx}`);
    if (!badge || !countEl || !badge.classList.contains('visible')) return;
    badge.classList.remove('visible'); badge.classList.add('commit');
    countEl.classList.remove('pop-count');
    setTimeout(() => countEl.classList.add('pop-count'), 0);
    setTimeout(() => { badge.classList.remove('commit'); badge.textContent = ''; }, 600);
}

/* ══════════════════════════════════════════════════════════════════
   ORB FACTORIES
   ══════════════════════════════════════════════════════════════════ */
function makeOrbEl(col, sz, dx, dy, wobbleStagger) {
    const elapsed = Date.now() - (window._orbAnimEpoch || 0);
    const wobbleDelay = -(((elapsed - wobbleStagger) % 2400 + 2400) % 2400);
    const orb = document.createElement('div');
    orb.className = 'orb';
    orb.style.cssText = `
    width:${sz}px;height:${sz}px;
    background:${col};
    transform:translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px));
    box-shadow:0 0 ${Math.round(sz * .9)}px 1px ${col}, 0 0 ${Math.round(sz * 2.0)}px ${col}dd, 0 0 ${Math.round(sz * 4.0)}px ${col}99, 0 0 ${Math.round(sz * 6.5)}px ${col}55;
    animation-delay:${wobbleDelay}ms;`;
    return orb;
}
function makeFlyOrbEl(col, sz) {
    const orb = document.createElement('div');
    orb.className = 'fly-orb';
    const shadow = lowGfx ? '' :
        `box-shadow:0 0 ${Math.round(sz * .9)}px 1px ${col}, 0 0 ${Math.round(sz * 2.0)}px ${col}dd, 0 0 ${Math.round(sz * 4.0)}px ${col}99;`;
    orb.style.cssText = `width:${sz}px;height:${sz}px;background:${col};${shadow}`;
    return orb;
}

/* ══════════════════════════════════════════════════════════════════
   RENDER
   ══════════════════════════════════════════════════════════════════ */
const dirtyGrid = new Set();
function markDirty(r, c) { dirtyGrid.add(r * 100 + c); }
function markAllDirty() { if (!S.grid) return; for (let r = 0; r < cfg.rows; r++) for (let c = 0; c < cfg.cols; c++) dirtyGrid.add(r * 100 + c); }

let _renderCellSz = 0; /* cached for duration of one renderAll pass */
function renderAll() {
    if (!S.grid) return;
    if (dirtyGrid.size === 0) { renderStrip(); renderBanner(); return; }
    /* Read cell size once from first available cell, reuse for all others */
    const anyCellKey = dirtyGrid.values().next().value;
    const sampleEl = anyCellKey !== undefined ? cellEl((anyCellKey / 100) | 0, anyCellKey % 100) : null;
    _renderCellSz = (sampleEl && sampleEl.offsetWidth) ? sampleEl.offsetWidth : 0;
    for (const key of dirtyGrid) { const r = (key / 100) | 0, c = key % 100; renderCell(r, c); }
    _renderCellSz = 0;
    dirtyGrid.clear();
    renderStrip();
    renderBanner();
}
function renderCell(r, c) {
    if (!S.grid || !S.grid[r]) return;
    const data = S.grid[r][c];
    const el = cellEl(r, c);
    if (!el) return;
    const layer = el.querySelector('.orb-layer');
    layer.innerHTML = '';
    el.classList.remove('near-crit', 'cell-glow');
    el.style.removeProperty('--cell-glow-color');

    if (data.count <= 0) return;
    const cm = critMass(r, c);
    const surviving = data.count >= cm ? data.count - cm : data.count;
    // NR cell status indicators — rendered BEFORE surviving check so they show on critMass cells too
    if (nuclearMode) {
        el.classList.toggle('nr-frozen', !!(data.frozen > 0));

        let frzBadge = el.querySelector('.nr-badge-frozen');
        if (data.frozen > 0) {
            if (!frzBadge) { frzBadge = document.createElement('div'); frzBadge.className = 'nr-badge nr-badge-frozen'; el.appendChild(frzBadge); }
            frzBadge.textContent = `FRZ${data.frozen > 1 ? '×' + data.frozen : ''}`;
        } else if (frzBadge) { frzBadge.remove(); }

        let infectBadge = el.querySelector('.nr-badge-infect');
        if (data.infect >= 0) {
            if (!infectBadge) { infectBadge = document.createElement('div'); infectBadge.className = 'nr-badge nr-badge-infect'; infectBadge.textContent = 'NFCT'; el.appendChild(infectBadge); }
        } else if (infectBadge) { infectBadge.remove(); }

        let embrBadge = el.querySelector('.nr-badge-ember');
        if (data.backdraft >= 0 && data.backdraft === data.owner) {
            if (!embrBadge) { embrBadge = document.createElement('div'); embrBadge.className = 'nr-badge nr-badge-ember'; embrBadge.textContent = 'EMBR'; el.appendChild(embrBadge); }
        } else if (embrBadge) { embrBadge.remove(); }

        let ignBadge = el.querySelector('.nr-badge-ignite');
        if (data.ignite > 0) {
            if (!ignBadge) { ignBadge = document.createElement('div'); ignBadge.className = 'nr-badge nr-badge-ignite'; el.appendChild(ignBadge); }
            ignBadge.textContent = `IGN×${data.ignite}`;
        } else if (ignBadge) { ignBadge.remove(); }
    }

    if (surviving <= 0) return;
    const col = PCOLORS[data.owner];
    const cellSz = _renderCellSz || el.offsetWidth || 40;
    const orbSz = Math.max(7, Math.min(Math.floor(cellSz * 0.26), 17));
    const show = Math.min(surviving, 3);

    // Rotating ring container — anchored at exact cell center
    const ring = document.createElement('div');
    ring.className = 'orb-ring';
    const elapsed = Date.now() - (window._orbAnimEpoch || 0);
    const ringSpinDelay = -(elapsed % 4000);
    ring.style.animationDelay = `${ringSpinDelay}ms`;

    // Scale orbit positions to always stay within cell bounds
    const rawPositions = ORB_POS[show];
    const maxRawRadius = Math.max(...rawPositions.map(([dx, dy]) => Math.sqrt(dx * dx + dy * dy)), 0.001);
    const maxAllowedRadius = Math.max(1, (cellSz / 2) - (orbSz / 2) - 2);
    const posScale = Math.min(1, maxAllowedRadius / maxRawRadius);

    const wobbleStagger = [0, 200, 400];
    rawPositions.forEach(([dx, dy], i) =>
        ring.appendChild(makeOrbEl(col, orbSz, dx * posScale, dy * posScale, wobbleStagger[i])));
    layer.appendChild(ring);

    {
        const badge = document.createElement('div');
        badge.className = 'orb-count-badge' + (surviving > 3 ? ' always-show' : '');
        badge.style.cssText = `font-size:${Math.max(8, Math.floor(cellSz * .18))}px;color:${col};font-family:'Orbitron',sans-serif;font-weight:700;text-shadow:0 0 4px ${col};pointer-events:none;line-height:1;`;
        badge.textContent = surviving;
        layer.appendChild(badge);
    }
    if (surviving === cm - 1) el.classList.add('near-crit');

    // Cell glow for current player's owned cells
    if (!S.over && data.owner === S.current) {
        el.classList.add('cell-glow');
        el.style.setProperty('--cell-glow-color', col);
    }

}
function renderStrip() {
    // Find max orbs among alive players
    const maxOrbs = Math.max(...S.orbCount.filter((_, i) => !S.eliminated[i]));
    for (let i = 0; i < PCOLORS.length; i++) {
        const card = document.getElementById(`pc${i}`);
        const orbs = document.getElementById(`porbs${i}`);
        if (!card || !orbs) continue;
        orbs.textContent = S.orbCount[i];
        card.classList.toggle('current', i === S.current && !S.over);
        card.classList.toggle('dead', S.eliminated[i]);
        card.classList.toggle('alive', !S.eliminated[i]);
        // Crown
        let crownEl = card.querySelector('.pc-crown');
        const isLeader = !S.eliminated[i] && S.orbCount[i] > 0 && S.orbCount[i] === maxOrbs;
        if (!crownEl) {
            crownEl = document.createElement('span');
            crownEl.className = 'pc-crown';
            crownEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/></svg>`;
            card.appendChild(crownEl);
        }
        crownEl.style.display = isLeader ? '' : 'none';
        // NR meter
        if (nuclearMode && !S.eliminated[i]) {
            const meterWrap = document.getElementById(`nr-meter-wrap${i}`);
            const meterBar  = document.getElementById(`nr-meter-bar${i}`);
            const charRow   = document.getElementById(`nr-char-row${i}`);
            const abilName  = document.getElementById(`nr-ability-name${i}`);
            if (meterWrap) meterWrap.style.display = '';
            if (charRow)   charRow.style.display   = '';
            const meter = (S.nrMeter && S.nrMeter[i]) || 0;
            const ready = meter >= NR_METER_MAX;
            if (meterBar) {
                meterBar.style.width = Math.min(100, meter) + '%';
                meterBar.style.background = PCOLORS[i];
            }
            card.classList.toggle('nr-ready', ready);
            // Update ability name label
            const charIdx = ALL_COLORS.indexOf(PCOLORS[i]);
            if (abilName && charIdx >= 0) {
                const abilIdx = (S.nrAbilityIdx && S.nrAbilityIdx[i]) || 0;
                const abilId  = NR_CHARS[charIdx].abilities[abilIdx];
                abilName.textContent = NR_ABILITIES[abilId].name;
            }
            // Surge active indicator
            let surgeIndicator = card.querySelector('.nr-surge-indicator');
            const surgeActive = S.nrSurge && S.nrSurge[i] > 0;
            if (surgeActive) {
                if (!surgeIndicator) {
                    surgeIndicator = document.createElement('div');
                    surgeIndicator.className = 'nr-surge-indicator';
                    card.appendChild(surgeIndicator);
                }
                surgeIndicator.textContent = `Surge ×${S.nrSurge[i]}`;
                surgeIndicator.style.color = PCOLORS[i];
                surgeIndicator.style.display = '';
            } else if (surgeIndicator) {
                surgeIndicator.style.display = 'none';
            }
        }
    }
}
function renderBanner() {
    const b = document.getElementById('turn-banner');
    if (S.over) {
        b.textContent = 'Game Over';
        b.style.color = b.style.borderColor = '#fff';
        b.style.textShadow = 'none';
    } else {
        const col = PCOLORS[S.current];
        const turnLabel = `Turn ${(S.turn || 0) + 1}`;
        const aiLabel = IS_HARD_AI[S.current] ? ' (Hard AI)' : IS_AI[S.current] ? ' (AI)' : '';
        b.textContent = `${PNAMES[S.current]}${aiLabel} — ${turnLabel}`;
        b.style.color = col;
        b.style.borderColor = col + 'aa';
        b.style.textShadow = `0 0 10px ${col}77`;
    }
    // Timed mode badge beneath banner
    let tmBadge = document.getElementById('ingame-timed-badge');
    if (timedMode) {
        if (!tmBadge) {
            tmBadge = document.createElement('div');
            tmBadge.id = 'ingame-timed-badge';
            tmBadge.className = 'ingame-timed-badge';
            b.insertAdjacentElement('afterend', tmBadge);
        }
        const mins = Math.floor(timedSeconds / 60);
        const secs = timedSeconds % 60;
        const timeStr = secs === 0 ? `${mins} min` : `${mins}m ${secs}s`;
        tmBadge.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> Timed Mode · ${timeStr}/player`;
        tmBadge.style.display = '';
    } else if (tmBadge) {
        tmBadge.style.display = 'none';
    }
    // Nuclear Mode badge
    let nrBadge = document.getElementById('ingame-nr-badge');
    if (nuclearMode) {
        if (!nrBadge) {
            nrBadge = document.createElement('div');
            nrBadge.id = 'ingame-nr-badge';
            nrBadge.className = 'ingame-timed-badge ingame-nr-badge';
            const anchor = document.getElementById('ingame-timed-badge') || b;
            anchor.insertAdjacentElement('afterend', nrBadge);
        }
        nrBadge.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="12" y1="5" x2="12" y2="5.01"/><line x1="12" y1="19" x2="12" y2="19.01"/><line x1="5" y1="5" x2="5" y2="5.01"/><line x1="19" y1="5" x2="19" y2="5.01"/><line x1="5" y1="19" x2="5" y2="19.01"/><line x1="19" y1="19" x2="19" y2="19.01"/></svg> Nuclear Reaction Mode`;
        nrBadge.style.display = '';
    } else if (nrBadge) {
        nrBadge.style.display = 'none';
    }
}
function syncUndoBtn() {
    const btn = document.getElementById('undo-btn');
    const undoIcon = document.getElementById('undo-icon');
    const chatIcon = document.getElementById('chat-icon');
    if (onlineMode) {
        btn.disabled = false;
        btn.title = chatOpen ? 'Close Chat' : 'Open Chat';
        if (undoIcon) undoIcon.style.display = 'none';
        if (chatIcon) chatIcon.style.display = '';
    } else {
        btn.disabled = history.length === 0 || S.animating;
        btn.title = 'Undo';
        if (undoIcon) undoIcon.style.display = '';
        if (chatIcon) chatIcon.style.display = 'none';
    }
}
function setGridInteractive(on) {
    document.getElementById('grid').querySelectorAll('.cell')
        .forEach(el => el.classList.toggle('no-interact', !on));
}

/* ══════════════════════════════════════════════════════════════════
   AI — SYNCHRONOUS SIMULATION ENGINE
   ══════════════════════════════════════════════════════════════════ */
function simCrit(r, c) {
    const er = r === 0 || r === cfg.rows - 1, ec = c === 0 || c === cfg.cols - 1;
    return er && ec ? 2 : er || ec ? 3 : 4;
}
function simNeighbors(r, c) {
    const n = [];
    if (r > 0) n.push([r - 1, c]);
    if (r < cfg.rows - 1) n.push([r + 1, c]);
    if (c > 0) n.push([r, c - 1]);
    if (c < cfg.cols - 1) n.push([r, c + 1]);
    return n;
}
function simClone(grid, orbCount, eliminated, hasMoved) {
    return {
        grid: grid.map(row => row.map(cell => ({ ...cell }))),
        orbCount: [...orbCount],
        eliminated: [...eliminated],
        hasMoved: [...hasMoved]
    };
}
function simApplyMove(grid, orbCount, eliminated, hasMoved, player, r, c) {
    const s = simClone(grid, orbCount, eliminated, hasMoved);
    const np = orbCount.length;
    s.grid[r][c].owner = player; s.grid[r][c].count++; s.orbCount[player]++; s.hasMoved[player] = true;
    let iters = 0;
    while (iters++ < 800) {
        const unstable = [];
        for (let rr = 0; rr < cfg.rows; rr++)
            for (let cc = 0; cc < cfg.cols; cc++)
                if (s.grid[rr][cc].count >= simCrit(rr, cc)) unstable.push([rr, cc]);
        if (!unstable.length) break;
        unstable.forEach(([rr, cc]) => {
            const owner = s.grid[rr][cc].owner, cm = simCrit(rr, cc);
            s.grid[rr][cc].count -= cm; s.orbCount[owner] -= cm;
            if (s.grid[rr][cc].count <= 0) { s.grid[rr][cc].count = 0; s.grid[rr][cc].owner = -1; }
            simNeighbors(rr, cc).forEach(([nr, nc]) => {
                const ncell = s.grid[nr][nc];
                if (ncell.owner !== -1 && ncell.owner !== owner) { s.orbCount[ncell.owner] -= ncell.count; s.orbCount[owner] += ncell.count; ncell.owner = owner; }
                else if (ncell.owner === -1) { ncell.owner = owner; }
                ncell.count++; s.orbCount[owner]++;
            });
        });
        if (s.hasMoved.every(Boolean))
            for (let i = 0; i < np; i++) if (!s.eliminated[i] && s.orbCount[i] <= 0) s.eliminated[i] = true;
    }
    return s;
}
function simHeuristic(orbCount, eliminated, aiIdx) {
    if (eliminated[aiIdx]) return -Infinity;
    const survivors = eliminated.filter(e => !e).length;
    if (survivors <= 1) return Infinity;
    let score = orbCount[aiIdx] * 3;
    for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) {
            const cell = S.grid[r][c];
            if (cell.owner === aiIdx) {
                const cm = simCrit(r, c);
                if (cell.count === cm - 1) score += 8; else if (cell.count === cm - 2) score += 3;
                simNeighbors(r, c).forEach(([nr, nc]) => {
                    const n = S.grid[nr][nc];
                    if (n.owner !== -1 && n.owner !== aiIdx && n.count >= simCrit(nr, nc) - 1) score -= 6;
                });
            }
        }
    }
    const otherOrbs = orbCount.reduce((s, v, i) => (!eliminated[i] && i !== aiIdx) ? s + v : s, 0);
    score -= otherOrbs; score += 40;
    return score;
}
function simCandidates(grid, orbCount, player, maxMoves) {
    const scored = [];
    for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) {
            const cell = grid[r][c];
            if (cell.owner !== -1 && cell.owner !== player) continue;
            let score = 0; const cm = simCrit(r, c);
            if (cell.owner === player) score += 8;
            if (cell.count === cm - 1) score += 30; else if (cell.count === cm - 2) score += 12; else score += cell.count * 2;
            simNeighbors(r, c).forEach(([nr, nc]) => {
                const ncell = grid[nr][nc];
                if (ncell.owner !== -1 && ncell.owner !== player) { score += 3; if (ncell.count >= simCrit(nr, nc) - 1) score += 5; }
            });
            simNeighbors(r, c).forEach(([nr, nc]) => {
                const ncell = grid[nr][nc];
                if (ncell.owner !== -1 && ncell.owner !== player && ncell.count >= simCrit(nr, nc) - 1) score -= 4;
            });
            scored.push({ r, c, score });
        }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxMoves).map(m => [m.r, m.c]);
}
function simNextPlayer(current, eliminated) {
    const n = eliminated.length; let next = (current + 1) % n, guard = 0;
    while (eliminated[next] && guard++ < n) next = (next + 1) % n;
    return next;
}
function minimax(grid, orbCount, eliminated, hasMoved, aiIdx, turnPlayer, depth, alpha, beta, memo) {
    const key = `${turnPlayer}|${depth}|${orbCount}|${eliminated}|` + grid.map(row => row.map(c => `${c.owner},${c.count}`).join(':')).join('|');
    if (memo.has(key)) return memo.get(key);
    const survivors = eliminated.map((e, i) => !e ? i : -1).filter(i => i >= 0);
    if (survivors.length <= 1) { const val = (survivors.length === 1 && survivors[0] === aiIdx) ? Infinity : -Infinity; memo.set(key, val); return val; }
    if (depth === 0) { const val = simHeuristic(orbCount, eliminated, aiIdx); memo.set(key, val); return val; }
    const MAX_BRANCH = 12;
    const moves = simCandidates(grid, orbCount, turnPlayer, MAX_BRANCH);
    if (!moves.length) { const val = simHeuristic(orbCount, eliminated, aiIdx); memo.set(key, val); return val; }
    if (turnPlayer === aiIdx) {
        let best = -Infinity;
        for (const [r, c] of moves) {
            const s = simApplyMove(grid, orbCount, eliminated, hasMoved, turnPlayer, r, c);
            const next = simNextPlayer(turnPlayer, s.eliminated);
            const val = minimax(s.grid, s.orbCount, s.eliminated, s.hasMoved, aiIdx, next, depth - 1, alpha, beta, memo);
            if (val > best) best = val; if (best > alpha) alpha = best; if (beta <= alpha) break;
        }
        memo.set(key, best); return best;
    } else {
        let bestOppVal = -Infinity, bestR = moves[0][0], bestC = moves[0][1];
        for (const [r, c] of moves) {
            const s = simApplyMove(grid, orbCount, eliminated, hasMoved, turnPlayer, r, c);
            const opp = simHeuristic(s.orbCount, s.eliminated, turnPlayer);
            if (opp > bestOppVal) { bestOppVal = opp; bestR = r; bestC = c; }
        }
        const s = simApplyMove(grid, orbCount, eliminated, hasMoved, turnPlayer, bestR, bestC);
        const next = simNextPlayer(turnPlayer, s.eliminated);
        const val = minimax(s.grid, s.orbCount, s.eliminated, s.hasMoved, aiIdx, next, depth - 1, alpha, beta, memo);
        memo.set(key, val); return val;
    }
}
function aiPickMove(aiIdx) {
    const { grid, orbCount, eliminated, hasMoved } = S;
    const isHard = IS_HARD_AI[aiIdx];
    const depth = isHard
        ? (cfg.rows * cfg.cols <= 49 ? 4 : 3)
        : (cfg.rows * cfg.cols <= 49 ? 2 : 1);
    const memo = new Map(), MAX_BRANCH = isHard ? 8 : 12;
    const moves = simCandidates(grid, orbCount, aiIdx, MAX_BRANCH);
    if (!moves.length) return null;
    let bestScore = -Infinity, bestMove = moves[0];
    for (const [r, c] of moves) {
        const s = simApplyMove(grid, orbCount, eliminated, hasMoved, aiIdx, r, c);
        const next = simNextPlayer(aiIdx, s.eliminated);
        const score = depth >= 2
            ? minimax(s.grid, s.orbCount, s.eliminated, s.hasMoved, aiIdx, next, depth - 1, -Infinity, Infinity, memo)
            : simHeuristic(s.orbCount, s.eliminated, aiIdx);
        if (score > bestScore) { bestScore = score; bestMove = [r, c]; }
    }
    return bestMove;
}
function scheduleAiTurn() {
    if (S.over) return;
    setGridInteractive(false);
    const mySession = gameSession;
    const aiIdx = S.current;
    const payload = {
        grid:       S.grid.map(row => row.map(c => ({ owner: c.owner, count: c.count }))),
        orbCount:   S.orbCount.slice(),
        eliminated: S.eliminated.slice(),
        hasMoved:   S.hasMoved.slice(),
        aiIdx,
        isHard:     IS_HARD_AI[aiIdx],
        rows:       cfg.rows,
        cols:       cfg.cols
    };
    const worker = new Worker('./ai-worker.js');
    worker.onmessage = (e) => {
        worker.terminate();
        if (mySession !== gameSession) return;
        if (S.over || !IS_AI[S.current]) return;
        const move = e.data.move;
        if (move) handleClick(move[0], move[1]);
        else setGridInteractive(true);
    };
    worker.onerror = () => {
        worker.terminate();
        if (mySession !== gameSession) return;
        if (S.over || !IS_AI[S.current]) return;
        const move = aiPickMove(S.current);
        if (move) handleClick(move[0], move[1]);
        else setGridInteractive(true);
    };
    worker.postMessage(payload);
}

/* ══════════════════════════════════════════════════════════════════
   TIMED MODE — per-player countdown clocks
   ══════════════════════════════════════════════════════════════════ */
/* ── Eliminate a player who ran out of time ── */
function eliminateTimedOutPlayer(playerIndex) {
    if (!S || S.over || S.eliminated[playerIndex]) return;
    animateElimination(playerIndex, () => {
        // Wipe their orbs
        for (let r = 0; r < cfg.rows; r++)
            for (let c = 0; c < cfg.cols; c++)
                if (S.grid[r][c].owner === playerIndex) {
                    S.orbCount[playerIndex] -= S.grid[r][c].count;
                    S.grid[r][c] = { owner: -1, count: 0 };
                }
        S.orbCount[playerIndex] = 0;
        S.eliminated[playerIndex] = true;
        S.hasMoved[playerIndex] = true;
        if (nuclearMode && S.nrMeter && S.nrMeter[playerIndex] > 0) nrDistributeMeter(playerIndex);

        const survivors = S.eliminated.map((e, i) => !e ? i : -1).filter(i => i >= 0);
        if (survivors.length === 1) {
            S.over = true;
            markAllDirty(); renderAll();
            if (onlineMode) pushStateToFirebase();
            showWin(survivors[0]);
            return;
        }
        // Advance turn if it was their turn
        if (S.current === playerIndex) {
            let next = (playerIndex + 1) % PCOLORS.length, guard = 0;
            while (S.eliminated[next] && guard++ < PCOLORS.length)
                next = (next + 1) % PCOLORS.length;
            S.current = next;
        }
        markAllDirty(); renderAll();
        startPlayerTimer();
        if (onlineMode) pushStateToFirebase();
    });
}

function startPlayerTimer() {
    stopPlayerTimer();
    if (!timedMode || S.over) return;
    const idx = S.current;
    let last = Date.now();
    _timedInterval = setInterval(() => {
        if (S.animating) { last = Date.now(); return; }
        const now = Date.now();
        playerTimers[idx] = Math.max(0, (playerTimers[idx] || 0) - (now - last));
        last = now;
        renderPlayerTimers();
        if (playerTimers[idx] <= 0) {
            stopPlayerTimer();
            if (onlineMode) {
                // Only the player whose timer ran out handles their own timeout
                if (S.current === myPlayerIndex) eliminateTimedOutPlayer(idx);
            } else {
                eliminateTimedOutPlayer(idx);
            }
        }
    }, 100);
}
function stopPlayerTimer() {
    if (_timedInterval) { clearInterval(_timedInterval); _timedInterval = null; }
}
function renderPlayerTimers() {
    for (let i = 0; i < PCOLORS.length; i++) {
        const el = document.getElementById(`ptimer${i}`);
        if (!el) continue;
        if (!timedMode) { el.style.display = 'none'; continue; }
        const ms = playerTimers[i] ?? (timedSeconds * 1000);
        const totalSec = Math.ceil(ms / 1000);
        const m  = Math.floor(totalSec / 60);
        const ss = String(totalSec % 60).padStart(2, '0');
        el.textContent = `${m}:${ss}`;
        el.style.display = '';
        el.style.color = ms < 10000 ? '#ff3355' : ms < 30000 ? '#ffcc00' : PCOLORS[i];
        el.classList.toggle('timer-urgent', ms < 10000);
    }
}

/* ── Game mode setters (called from HTML) ── */
function setTimedMode(on) {
    timedMode = on;
    const row = document.getElementById('timed-seconds-row');
    if (row) row.style.display = on ? 'flex' : 'none';
}
function setTimedSeconds(val) {
    timedSeconds = parseInt(val) || 180;
    const lbl = document.getElementById('timed-seconds-label');
    if (lbl) {
        const m = Math.floor(timedSeconds / 60), s = timedSeconds % 60;
        lbl.textContent = s === 0 ? `${m} min` : `${m}m ${s}s`;
    }
}
/* ══════════════════════════════════════════════════════════════════
   REMOTE MOVE PLAYBACK (online: animate other players' moves)
   ══════════════════════════════════════════════════════════════════ */
async function playRemoteMove(r, c, finalData) {
    if (S.animating) return;
    S.animating = true;
    setGridInteractive(false);

    const mySession = gameSession;

    turnOrbsBefore = S.orbCount[S.current];
    comboCount = 0;
    hideCombo(true);

    const cell = S.grid[r][c];
    cell.owner = S.current;
    cell.count++;
    S.orbCount[S.current]++;
    S.hasMoved[S.current] = true;

    updateGainBadge(S.current, S.orbCount[S.current] - turnOrbsBefore);

    const willExplodeImmediately = cell.count >= critMass(r, c);
    chainCandidates = new Set(); if (willExplodeImmediately) chainCandidates.add(r * 100 + c);
    markDirty(r, c); renderAll();
    try {
        if (!willExplodeImmediately) await sessionDelay(60, mySession);
        await chainReact(mySession);
    } catch (e) { return; }

    if (mySession !== gameSession) {
        if (onlineMode) { S.animating = false; updateOnlineInteractivity(); }
        return;
    }
    if (!S.over) checkEliminationsAndWin();

    commitGainBadge(S.current);
    hideCombo();

    // Reconcile to authoritative final state (fixes any local drift)
    S = deserializeState(finalData);

    markAllDirty(); renderAll();
    S.animating = false;
    if (S.over) {
        const winner = S.eliminated.findIndex(e => !e);
        if (winner !== -1) showWin(winner);
        stopPlayerTimer();
    } else {
        startPlayerTimer();
    }
    updateOnlineInteractivity();
}

/* ══════════════════════════════════════════════════════════════════
   CLICK HANDLER
   ══════════════════════════════════════════════════════════════════ */
async function handleClick(r, c) {
    if (S.animating || S.over) return;

    // Online mode: only allow move on your own turn
    if (onlineMode && S.current !== myPlayerIndex) return;

    // NR targeting intercept
    if (_nrTargeting) { nrHandleCellTarget(r, c); return; }

    // Frozen cells cannot be clicked
    if (nuclearMode && S.grid[r][c].frozen > 0) return;

    const cell = S.grid[r][c];
    if (cell.owner !== -1 && cell.owner !== S.current) return;

    history.push(cloneState());
    syncUndoBtn();
    S.animating = true;
    S.pendingMove = { r, c };
    setGridInteractive(false);

    const mySession = gameSession;

    turnOrbsBefore = S.orbCount[S.current];
    comboCount = 0;
    hideCombo(true);

    cell.owner = S.current;
    cell.count++;
    S.orbCount[S.current]++;
    S.hasMoved[S.current] = true;

    const willExplodeImmediately = cell.count >= critMass(r, c);
    if (window.sfxPlace && !willExplodeImmediately) sfxPlace();
    triggerHaptic(12);
    chainCandidates = new Set(); if (willExplodeImmediately) chainCandidates.add(r * 100 + c);
    markDirty(r, c); renderAll();
    try {
        if (!willExplodeImmediately) await sessionDelay(60, mySession);
        await chainReact(mySession);
    } catch (e) { return; } // session ended — stop silently

    if (mySession !== gameSession) {
        if (onlineMode) { S.animating = false; updateOnlineInteractivity(); }
        return;
    }
    if (!S.over) checkEliminationsAndWin();

    commitGainBadge(S.current);
    hideCombo();

    if (S.over) {
        S.animating = false;
        stopPlayerTimer();
        syncUndoBtn();
        setGridInteractive(false);
        if (onlineMode) { await pushStateToFirebase(); S.pendingMove = null; }
        return;
    }

    // Passive Surge: if Voltage earned a free turn this move, stay on their turn
    if (nuclearMode && S._nrSurgeFreeThisTurn) {
        S._nrSurgeFreeThisTurn = false;
        markAllDirty(); renderAll();
        S.animating = false;
        syncUndoBtn();
        startPlayerTimer();
        if (onlineMode) {
            await pushStateToFirebase();
            S.pendingMove = null;
            if (!S.over) S.turnDeadline = serverNow() + TURN_TIMER_MS;
            updateOnlineInteractivity();
        } else if (IS_AI[S.current]) {
            scheduleAiTurn();
        } else {
            setGridInteractive(true);
        }
        return;
    }

    // Advance to next non-eliminated player
    let next = (S.current + 1) % PCOLORS.length;
    let guard = 0;
    while (S.eliminated[next] && guard++ < PCOLORS.length)
        next = (next + 1) % PCOLORS.length;
    // Reset surge-used flag whenever the turn actually moves to a new player
    if (nuclearMode) S._nrSurgeUsedThisTurn = 0;
    // Only count a new turn when we've cycled back past the start of the round
    if (next <= S.current) {
        S.turn = (S.turn || 0) + 1;
        // NR: decrement frozen cells and Surge counter once per full round
        if (nuclearMode) {
            // Snapshot orb counts NOW (end of round = start of next round) for underdog check
            _nrRoundStartOrbs = [...S.orbCount];
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const cell = S.grid[r2][c2];
                    if (cell.frozen > 0) {
                        cell.frozen--;
                        if (cell.frozen === 0) {
                            if (cell._absZeroFrozen) {
                                // Shatter: Absolute Zero cell explodes in Cryo's color when freeze expires
                                const shatterOwner = cell.frozenBy;
                                cell._airstrikeOwner = shatterOwner;
                                const cm = critMass(r2, c2);
                                if (cell.count < cm) {
                                    const countOwner = cell.owner >= 0 ? cell.owner : shatterOwner;
                                    S.orbCount[countOwner] += (cm - cell.count);
                                    cell.count = cm;
                                    if (cell.owner < 0) cell.owner = countOwner;
                                }
                                cell._cryoFrozen = false;
                                cell._absZeroFrozen = false;
                                cell.frozenBy = -1;
                                cell.ignite = 1;
                                cell.igniteOwner = shatterOwner;
                            } else {
                                // Permafrost: just thaw normally, no shatter
                                cell.frozenBy = -1; cell._cryoFrozen = false; cell._absZeroFrozen = false;
                            }
                        }
                        markDirty(r2, c2);
                    }
                }
            }
            // Absolute Zero: re-freeze any enemy that is now at critMass - 1 while an Abs Zero freeze is active
            const cryoActive = (() => {
                for (let r2 = 0; r2 < cfg.rows; r2++)
                    for (let c2 = 0; c2 < cfg.cols; c2++)
                        if (S.grid[r2][c2].frozen > 0 && S.grid[r2][c2]._absZeroFrozen) return S.grid[r2][c2].frozenBy;
                return -1;
            })();
            if (cryoActive >= 0) {
                for (let r2 = 0; r2 < cfg.rows; r2++)
                    for (let c2 = 0; c2 < cfg.cols; c2++) {
                        const cell = S.grid[r2][c2];
                        if (cell.owner !== -1 && cell.owner !== cryoActive && cell.frozen === 0
                            && cell.count >= critMass(r2, c2) - 1) {
                            cell.frozen = 1;
                            cell._cryoFrozen = true;
                            cell.frozenBy = cryoActive;
                            markDirty(r2, c2);
                        }
                    }
            }
            if (S.nrSurge) {
                for (let si = 0; si < S.nrSurge.length; si++) {
                    if (S.nrSurge[si] > 0) S.nrSurge[si]--;
                }
            }
            // Flat meter bonus per round — scaled by orb count vs average (catchup mechanic)
            if (S.nrMeter) {
                const alive = S.orbCount.filter((_, i) => !S.eliminated[i]);
                const avgOrbs = alive.length ? alive.reduce((a, b) => a + b, 0) / alive.length : 0;
                for (let pi = 0; pi < PCOLORS.length; pi++) {
                    if (S.eliminated[pi]) continue;
                    const bonus = S.orbCount[pi] < avgOrbs ? 8 : 3;
                    S.nrMeter[pi] = Math.min(NR_METER_MAX, (S.nrMeter[pi] || 0) + bonus);
                }
            }
        }
    }
    S.current = next;

    markAllDirty(); renderAll();
    S.animating = false;
    syncUndoBtn();

    startPlayerTimer();
    // NR turn-start effects: ice wall expires, process ignite/frozen on new current player
    if (nuclearMode) {
        if (S.nrIceWall)     S.nrIceWall[S.current]     = false; // ice wall lasted one turn
        if (S.nrStaticField) S.nrStaticField[S.current] = false; // static field lasted one turn
        // Check blackout — skip this player's turn
        if (S.nrBlackout && S.nrBlackout[S.current]) {
            S.nrBlackout[S.current] = false;
            markAllDirty(); renderAll();
            if (onlineMode) {
                await pushStateToFirebase();
                S.pendingMove = null;
                if (!S.over) S.turnDeadline = serverNow() + TURN_TIMER_MS;
                updateOnlineInteractivity();
            } else {
                // Advance again past the blacked-out player
                let next2 = (S.current + 1) % PCOLORS.length;
                let g2 = 0;
                while (S.eliminated[next2] && g2++ < PCOLORS.length)
                    next2 = (next2 + 1) % PCOLORS.length;
                S.current = next2;
                markAllDirty(); renderAll();
                if (IS_AI[S.current]) scheduleAiTurn();
                else setGridInteractive(true);
            }
            return;
        }
        // Decrement frozen cells and process ignite auto-explosions
        await nrProcessTurnStartCells(gameSession);
        if (gameSession !== mySession) return;
    }
    if (onlineMode) {
        await pushStateToFirebase();
        S.pendingMove = null;
        if (!S.over) S.turnDeadline = serverNow() + TURN_TIMER_MS;
        updateOnlineInteractivity();
    } else if (IS_AI[S.current]) {
        scheduleAiTurn();
    } else {
        setGridInteractive(true);
    }
}

/* ══════════════════════════════════════════════════════════════════
   NR CANVAS ANIMATION LAYER
   A single overlay canvas sits above the grid. Canvas animations
   are short-lived and run at a capped 60fps to stay lightweight.
   ══════════════════════════════════════════════════════════════════ */
const NR_CANVAS_FPS  = 60;
const NR_CANVAS_FRAME = 1000 / NR_CANVAS_FPS;

let _nrCanvas    = null;
let _nrCtx       = null;
let _nrAnimations = []; // active animation objects
let _nrRafId     = null;
let _nrRafLast   = null;

function nrCanvasInit() {
    if (_nrCanvas) return;
    const gridEl = document.getElementById('grid');
    if (!gridEl) return;
    _nrCanvas = document.createElement('canvas');
    _nrCanvas.id = 'nr-canvas';
    _nrCanvas.style.cssText = `
        position: absolute; inset: 0;
        width: 100%; height: 100%;
        pointer-events: none;
        z-index: 10;
    `;
    // Canvas parent needs position:relative — grid-and-combo already has it typically
    const parent = gridEl.parentElement;
    if (parent) {
        parent.style.position = 'relative';
        parent.appendChild(_nrCanvas);
    }
    _nrCtx = _nrCanvas.getContext('2d');
    _resizeNrCanvas();
    window.addEventListener('resize', _resizeNrCanvas);
}

function _resizeNrCanvas() {
    if (!_nrCanvas) return;
    const parent = _nrCanvas.parentElement;
    if (!parent) return;
    const rect = parent.getBoundingClientRect();
    _nrCanvas.width  = rect.width  * (window.devicePixelRatio || 1);
    _nrCanvas.height = rect.height * (window.devicePixelRatio || 1);
    _nrCanvas.style.width  = rect.width  + 'px';
    _nrCanvas.style.height = rect.height + 'px';
    if (_nrCtx) _nrCtx.scale(window.devicePixelRatio || 1, window.devicePixelRatio || 1);
}

/* Add a canvas animation. drawFn(ctx, progress 0→1, elapsed ms) returns false when done. */
function nrCanvasAnim(drawFn, duration) {
    if (lowGfx) return; // canvas animations disabled in low-GFX mode
    nrCanvasInit();
    const anim = { drawFn, duration, start: null };
    _nrAnimations.push(anim);
    if (!_nrRafId) _nrCanvasLoop();
}

function _nrCanvasLoop(now) {
    if (!now) now = performance.now();
    // FPS cap
    if (_nrRafLast !== null && now - _nrRafLast < NR_CANVAS_FRAME) {
        _nrRafId = requestAnimationFrame(_nrCanvasLoop);
        return;
    }
    _nrRafLast = now;

    if (!_nrCtx || !_nrCanvas) { _nrRafId = null; return; }
    const w = _nrCanvas.width  / (window.devicePixelRatio || 1);
    const h = _nrCanvas.height / (window.devicePixelRatio || 1);
    _nrCtx.clearRect(0, 0, w, h);

    _nrAnimations = _nrAnimations.filter(anim => {
        if (!anim.start) anim.start = now;
        const elapsed  = now - anim.start;
        const progress = Math.min(elapsed / anim.duration, 1);
        const keepGoing = anim.drawFn(_nrCtx, progress, elapsed, w, h);
        return keepGoing && progress < 1;
    });

    if (_nrAnimations.length > 0) {
        _nrRafId = requestAnimationFrame(_nrCanvasLoop);
    } else {
        _nrRafId = null;
        _nrRafLast = null;
    }
}

/* Helper: get a cell's center position in canvas-local coordinates */
function nrCellCenter(r, c) {
    const el = cellEl(r, c);
    if (!el || !_nrCanvas) return null;
    const cellRect   = el.getBoundingClientRect();
    const canvasRect = _nrCanvas.getBoundingClientRect();
    return {
        x: cellRect.left + cellRect.width  / 2 - canvasRect.left,
        y: cellRect.top  + cellRect.height / 2 - canvasRect.top,
        w: cellRect.width,
        h: cellRect.height
    };
}

/* ── NR ability animation helpers ── */
function nrFlashCell(r, c, cls, delay = 0) {
    const el = cellEl(r, c); if (!el) return;
    setTimeout(() => {
        el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
        setTimeout(() => el.classList.remove(cls), 750);
    }, delay);
}
function nrFlashRow(row, cls) {
    for (let c = 0; c < cfg.cols; c++) nrFlashCell(row, c, cls, c * 30);
}
function nrFlashCol(col, cls, color) {
    for (let r = 0; r < cfg.rows; r++) nrFlashCell(r, col, cls, r * 30);
}
function nrFlashArea(centerR, centerC, radius, cls) {
    for (let dr = -radius; dr <= radius; dr++)
        for (let dc = -radius; dc <= radius; dc++)
            nrFlashCell(centerR + dr, centerC + dc, cls, (Math.abs(dr) + Math.abs(dc)) * 25);
}
function nrFlashBoard(filterFn, cls) {
    for (let r = 0; r < cfg.rows; r++)
        for (let c = 0; c < cfg.cols; c++)
            if (filterFn(r, c)) nrFlashCell(r, c, cls, (r + c) * 18);
}
function nrFlashCard(playerIdx, cls) {
    const card = document.getElementById(`pc${playerIdx}`);
    if (!card) return;
    card.classList.remove(cls); void card.offsetWidth; card.classList.add(cls);
    setTimeout(() => card.classList.remove(cls), 750);
}

function nrPlayAbilityAnim(playerIdx, abilId, target, secondTarget) {
    switch (abilId) {
        case 'carpet_bomb': {
            if (!target) break;
            nrFlashRow(target.r, 'nr-row-flash');
            // Canvas: horizontal sweep line crossing the row
            const cbColor = PCOLORS[playerIdx];
            const leftCell  = nrCellCenter(target.r, 0);
            const rightCell = nrCellCenter(target.r, cfg.cols - 1);
            if (leftCell && rightCell) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const y  = leftCell.y;
                const x0 = leftCell.x  - leftCell.w * 0.5;
                const x1 = rightCell.x + rightCell.w * 0.5;
                const sweepX = x0 + (x1 - x0) * Math.min(progress * 1.6, 1);
                const alpha  = Math.max(0, 1 - progress * 1.1);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = cbColor;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(x0, y); ctx.lineTo(sweepX, y);
                ctx.stroke();
                // Bright leading tip
                ctx.globalAlpha = alpha * 1.4;
                ctx.lineWidth = 4;
                const tipLen = leftCell.w * 0.6;
                ctx.beginPath();
                ctx.moveTo(Math.max(x0, sweepX - tipLen), y);
                ctx.lineTo(sweepX, y);
                ctx.stroke();
                ctx.restore();
                return progress < 1;
            }, 480);
            break;
        }
        case 'detonation_wave': {
            // CSS flash
            nrFlashBoard((r, c) => {
                const cell = S.grid[r][c];
                return cell.owner !== -1 && cell.owner !== playerIdx && cell.count === critMass(r, c) - 1;
            }, 'nr-detwave-flash');
            // Canvas: expanding shockwave ring from each target cell
            const dwTargets = [];
            for (let r = 0; r < cfg.rows; r++)
                for (let c = 0; c < cfg.cols; c++) {
                    const cell = S.grid[r][c];
                    if (cell.owner !== -1 && cell.owner !== playerIdx && cell.count === critMass(r, c) - 1) {
                        const center = nrCellCenter(r, c);
                        if (center) dwTargets.push(center);
                    }
                }
            const dwColor = PCOLORS[playerIdx];
            nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                dwTargets.forEach(center => {
                    const maxR = center.w * 1.1;
                    const radius = maxR * progress;
                    const alpha = Math.max(0, 1 - progress * 1.3);
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = dwColor;
                    ctx.lineWidth = 2.5 * (1 - progress * 0.7);
                    ctx.beginPath();
                    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                    ctx.stroke();
                    // Inner ring slightly behind
                    ctx.globalAlpha = alpha * 0.5;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.arc(center.x, center.y, radius * 0.6, 0, Math.PI * 2);
                    ctx.stroke();
                    ctx.restore();
                });
                return progress < 1;
            }, 500);
            break;
        }
        case 'riptide': {
            // CSS flash
            nrFlashBoard((r, c) => {
                const er = r === 0 || r === cfg.rows - 1 || c === 0 || c === cfg.cols - 1;
                return er && neighbors(r, c).some(([nr, nc]) => S.grid[nr][nc].owner === playerIdx);
            }, 'nr-riptide-flash');
            // Canvas: 3 wave lines sweep inward from each of the 4 edges
            const rtColor = PCOLORS[playerIdx];
            nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const waves = 3;
                for (let w = 0; w < waves; w++) {
                    const offset = (progress - w * 0.12) * 1.3;
                    if (offset <= 0) continue;
                    const alpha = Math.max(0, (1 - offset) * 0.7);
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = rtColor;
                    ctx.lineWidth = 1.8;
                    // Top edge → inward
                    const ty = H * offset * 0.5;
                    ctx.beginPath(); ctx.moveTo(0, ty); ctx.lineTo(W, ty); ctx.stroke();
                    // Bottom edge → inward
                    const by = H - H * offset * 0.5;
                    ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(W, by); ctx.stroke();
                    // Left edge → inward
                    const lx = W * offset * 0.5;
                    ctx.beginPath(); ctx.moveTo(lx, 0); ctx.lineTo(lx, H); ctx.stroke();
                    // Right edge → inward
                    const rx = W - W * offset * 0.5;
                    ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx, H); ctx.stroke();
                    ctx.restore();
                }
                return progress < 1;
            }, 600);
            break;
        }
        case 'blackout': {
            if (target && target.targetPlayer !== undefined) nrFlashCard(target.targetPlayer, 'nr-blackout-hit');
            // DOM darkness overlay
            const gameEl = document.getElementById('game');
            if (gameEl) {
                const overlay = document.createElement('div');
                overlay.className = 'nr-blackout-overlay';
                gameEl.appendChild(overlay);
                setTimeout(() => overlay.remove(), 700);
            }
            // Canvas: lightning bolt from activating player's card to target card
            const srcCard = document.getElementById(`pc${playerIdx}`);
            const dstCard = target && target.targetPlayer !== undefined
                ? document.getElementById(`pc${target.targetPlayer}`) : null;
            if (srcCard && dstCard && _nrCanvas) {
                nrCanvasInit();
                const canvasRect = _nrCanvas.getBoundingClientRect();
                const sRect = srcCard.getBoundingClientRect();
                const dRect = dstCard.getBoundingClientRect();
                const sx = sRect.left + sRect.width / 2 - canvasRect.left;
                const sy = sRect.top  + sRect.height / 2 - canvasRect.top;
                const dx = dRect.left + dRect.width / 2 - canvasRect.left;
                const dy = dRect.top  + dRect.height / 2 - canvasRect.top;
                // Build jagged lightning path once
                const segments = 8;
                const pts = [{ x: sx, y: sy }];
                for (let i = 1; i < segments; i++) {
                    const t = i / segments;
                    const mx = sx + (dx - sx) * t + (Math.random() - 0.5) * 40;
                    const my = sy + (dy - sy) * t + (Math.random() - 0.5) * 40;
                    pts.push({ x: mx, y: my });
                }
                pts.push({ x: dx, y: dy });
                const bkColor = PCOLORS[playerIdx];
                nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                    if (progress > 0.5) return false; // flash only at start
                    const alpha = Math.max(0, 1 - progress * 2.5);
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = bkColor;
                    ctx.lineWidth = 2.5;
                    ctx.shadowColor = bkColor;
                    ctx.shadowBlur = 8;
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
                    ctx.stroke();
                    ctx.lineWidth = 1;
                    ctx.strokeStyle = '#fff';
                    ctx.globalAlpha = alpha * 0.6;
                    ctx.beginPath();
                    ctx.moveTo(pts[0].x, pts[0].y);
                    pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
                    ctx.stroke();
                    ctx.restore();
                    return true;
                }, 400);
            }
            break;
        }
        case 'void_rift': {
            // CSS flashes
            if (target)
                for (let dr = 0; dr <= 1; dr++)
                    for (let dc = 0; dc <= 1; dc++) {
                        const r2 = target.r + dr, c2 = target.c + dc;
                        if (r2 < 0 || r2 >= cfg.rows || c2 < 0 || c2 >= cfg.cols) continue;
                        const cls = S.grid[r2][c2].owner === playerIdx ? 'nr-voidrift-boost' : 'nr-voidrift-erase';
                        nrFlashCell(r2, c2, cls, (dr + dc) * 40);
                    }
            // Canvas: particles spiral inward from surrounding area to 2×2 center
            if (!target) break;
            const vrCenterCell = nrCellCenter(target.r, target.c);
            if (!vrCenterCell) break;
            const vrCx = vrCenterCell.x + vrCenterCell.w / 2;
            const vrCy = vrCenterCell.y + vrCenterCell.h / 2;
            const vrColor = PCOLORS[playerIdx];
            const vrParticles = [];
            const pCount = 28;
            for (let i = 0; i < pCount; i++) {
                const angle = (i / pCount) * Math.PI * 2;
                const dist  = 60 + Math.random() * 35;
                vrParticles.push({
                    startX: vrCx + Math.cos(angle) * dist,
                    startY: vrCy + Math.sin(angle) * dist,
                    angle,
                    spinSpeed: 2.5 + Math.random() * 1.5,
                    r: 2 + Math.random() * 1.5
                });
            }
            nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const t = elapsed / 1000;
                vrParticles.forEach(p => {
                    const inward = progress * progress; // ease-in
                    const curAngle = p.angle + t * p.spinSpeed;
                    const dist = (1 - inward) * 60;
                    const x = vrCx + Math.cos(curAngle) * dist;
                    const y = vrCy + Math.sin(curAngle) * dist;
                    const alpha = Math.max(0, 1 - progress * 1.1);
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = vrColor;
                    ctx.beginPath();
                    ctx.arc(x, y, p.r * (1 - progress * 0.6), 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                });
                return progress < 1;
            }, 600);
            break;
        }
        case 'absolute_zero': {
            // CSS staggered freeze flashes
            const azCr = cfg.rows / 2, azCc = cfg.cols / 2;
            for (let r = 0; r < cfg.rows; r++)
                for (let c = 0; c < cfg.cols; c++) {
                    const cell = S.grid[r][c];
                    if (cell.owner !== -1 && cell.owner !== playerIdx && cell.count >= critMass(r, c) - 1) {
                        const dist = Math.abs(r - azCr) + Math.abs(c - azCc);
                        nrFlashCell(r, c, 'nr-absz-flash', dist * 40);
                    }
                }
            // Canvas: ice shards — 16 spike lines radiating from board center
            const azColor = PCOLORS[playerIdx];
            nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const cx = W / 2, cy = H / 2;
                const maxLen = Math.max(W, H) * 0.7 * progress;
                const spikes = 16;
                const alpha = Math.max(0, 1 - progress * 1.1);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = azColor;
                for (let i = 0; i < spikes; i++) {
                    const angle = (i / spikes) * Math.PI * 2;
                    const len = maxLen * (0.7 + 0.3 * ((i % 2 === 0) ? 1 : 0.65));
                    const ex = cx + Math.cos(angle) * len;
                    const ey = cy + Math.sin(angle) * len;
                    ctx.lineWidth = (i % 2 === 0 ? 2 : 1) * (1 - progress * 0.6);
                    ctx.beginPath();
                    ctx.moveTo(cx, cy);
                    ctx.lineTo(ex, ey);
                    ctx.stroke();
                    // Small perpendicular cross-bar at 60% length
                    if (i % 2 === 0) {
                        const mx = cx + Math.cos(angle) * len * 0.6;
                        const my = cy + Math.sin(angle) * len * 0.6;
                        const blen = len * 0.12;
                        ctx.lineWidth = 1;
                        ctx.beginPath();
                        ctx.moveTo(mx - Math.sin(angle) * blen, my + Math.cos(angle) * blen);
                        ctx.lineTo(mx + Math.sin(angle) * blen, my - Math.cos(angle) * blen);
                        ctx.stroke();
                    }
                }
                // Central burst circle
                ctx.lineWidth = 1.5;
                ctx.beginPath();
                ctx.arc(cx, cy, Math.max(W, H) * 0.06 * (1 + progress), 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                return progress < 1;
            }, 700);
            break;
        }
        case 'encircle': {
            // CSS flash for qualifying cells
            nrFlashBoard((r, c) => {
                const cell = S.grid[r][c];
                if (cell.owner === -1 || cell.owner === playerIdx) return false;
                return neighbors(r, c).filter(([nr, nc]) => S.grid[nr][nc].owner === playerIdx).length >= 2;
            }, 'nr-encircle-hit');
            // Canvas: closing fire ring around each qualifying enemy cell
            const encTargets = [];
            for (let r = 0; r < cfg.rows; r++)
                for (let c = 0; c < cfg.cols; c++) {
                    const cell = S.grid[r][c];
                    if (cell.owner === -1 || cell.owner === playerIdx) continue;
                    const n = neighbors(r, c).filter(([nr, nc]) => S.grid[nr][nc].owner === playerIdx).length;
                    if (n >= 2) {
                        const center = nrCellCenter(r, c);
                        if (center) encTargets.push(center);
                    }
                }
            const encColor = PCOLORS[playerIdx];
            nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                encTargets.forEach(center => {
                    // Ring starts large, closes inward
                    const startR = center.w * 1.4;
                    const endR   = center.w * 0.3;
                    const radius = startR - (startR - endR) * progress;
                    const alpha  = progress < 0.8 ? 1 : Math.max(0, 1 - (progress - 0.8) * 5);
                    // Draw arc sweep completing as ring closes
                    const sweep  = Math.min(progress * 1.4, 1) * Math.PI * 2;
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = encColor;
                    ctx.lineWidth = 2.5 - progress * 1.5;
                    ctx.beginPath();
                    ctx.arc(center.x, center.y, radius, -Math.PI / 2, -Math.PI / 2 + sweep);
                    ctx.stroke();
                    // Ember sparks at arc tip
                    const tipAngle = -Math.PI / 2 + sweep;
                    const tx = center.x + Math.cos(tipAngle) * radius;
                    const ty = center.y + Math.sin(tipAngle) * radius;
                    ctx.fillStyle = encColor;
                    ctx.globalAlpha = alpha * 0.9;
                    ctx.beginPath();
                    ctx.arc(tx, ty, 3, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                });
                return progress < 1;
            }, 650);
            break;
        }
        case 'undertow': {
            // Collect drain pairs BEFORE state mutation
            const drainPairs = [];
            for (let r2 = 0; r2 < cfg.rows; r2++)
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const cell = S.grid[r2][c2];
                    if (cell.owner !== -1 && cell.owner !== playerIdx && cell.count > 0) {
                        const adjOwn = neighbors(r2, c2).filter(([nr, nc]) => S.grid[nr][nc].owner === playerIdx);
                        if (!adjOwn.length) continue;
                        adjOwn.sort((a, b) => S.grid[a[0]][a[1]].count - S.grid[b[0]][b[1]].count);
                        drainPairs.push({ from: [r2, c2], to: adjOwn[0] });
                    }
                }
            // Flash cells
            drainPairs.forEach(({ from: [r2, c2], to: [tr, tc] }) => {
                nrFlashCell(r2, c2, 'nr-undertow-drain', (r2 + c2) * 20);
            });
            // Canvas arcs — bezier curve with travelling dot from each enemy to its target
            const color = PCOLORS[playerIdx];
            nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                drainPairs.forEach(({ from: [fr, fc], to: [tr, tc] }) => {
                    const src = nrCellCenter(fr, fc);
                    const dst = nrCellCenter(tr, tc);
                    if (!src || !dst) return;
                    // Control point arcs inward toward board centre
                    const cx = (src.x + dst.x) / 2 + (dst.y - src.y) * 0.35;
                    const cy = (src.y + dst.y) / 2 - (dst.x - src.x) * 0.35;
                    // Draw arc trail (fades as progress advances)
                    const trailAlpha = Math.max(0, 0.45 - progress * 0.45);
                    ctx.save();
                    ctx.strokeStyle = color.replace(')', `, ${trailAlpha})`).replace('rgb', 'rgba').replace('#', 'rgba(').replace('rgba(', 'rgba(');
                    // simpler: use globalAlpha
                    ctx.globalAlpha = trailAlpha;
                    ctx.strokeStyle = color;
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(src.x, src.y);
                    ctx.quadraticCurveTo(cx, cy, dst.x, dst.y);
                    ctx.stroke();
                    ctx.setLineDash([]);
                    // Travelling dot along the bezier
                    const t = Math.min(progress * 1.4, 1);
                    const bx = (1-t)*(1-t)*src.x + 2*(1-t)*t*cx + t*t*dst.x;
                    const by = (1-t)*(1-t)*src.y + 2*(1-t)*t*cy + t*t*dst.y;
                    ctx.globalAlpha = Math.max(0, 1 - progress * 1.1);
                    ctx.fillStyle = color;
                    ctx.beginPath();
                    ctx.arc(bx, by, 3.5, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                });
                return progress < 1;
            }, 520);
            break;
        }
        case 'pandemic': {
            // Wave radiates outward from each Blight cell
            const ownCells = [];
            for (let r = 0; r < cfg.rows; r++)
                for (let c = 0; c < cfg.cols; c++)
                    if (S.grid[r][c].owner === playerIdx) ownCells.push([r, c]);
            // CSS staggered flash
            for (let r = 0; r < cfg.rows; r++)
                for (let c = 0; c < cfg.cols; c++) {
                    if (S.grid[r][c].owner === -1 || S.grid[r][c].owner === playerIdx) continue;
                    const minDist = ownCells.reduce((m, [or, oc]) => Math.min(m, Math.abs(r - or) + Math.abs(c - oc)), 999);
                    nrFlashCell(r, c, 'nr-pandemic-drain', minDist * 45);
                }
            // Canvas particles: burst of 7 dots from each own cell outward
            const pColor = PCOLORS[playerIdx];
            const particles = [];
            ownCells.forEach(([r, c]) => {
                const center = nrCellCenter(r, c);
                if (!center) return;
                const count = 7;
                for (let i = 0; i < count; i++) {
                    const angle = (i / count) * Math.PI * 2;
                    const speed = 38 + Math.random() * 28;
                    particles.push({ x: center.x, y: center.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, r: 2.5 + Math.random() });
                }
            });
            nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const t = elapsed / 1000;
                particles.forEach(p => {
                    const x = p.x + p.vx * t;
                    const y = p.y + p.vy * t;
                    const alpha = Math.max(0, 1 - progress * 1.2);
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = pColor;
                    ctx.beginPath();
                    ctx.arc(x, y, p.r * (1 - progress * 0.5), 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                });
                return progress < 1;
            }, 700);
            break;
        }
        case 'airstrike': {
            if (!target) break;
            nrFlashCell(target.r, target.c, 'nr-airstrike-target');
            const asCenter = nrCellCenter(target.r, target.c);
            const asColor  = PCOLORS[playerIdx];
            if (asCenter) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const { x, y, w } = asCenter;
                const arm = w * (2.8 - progress * 2.3);
                const gap = w * 0.22;
                const alpha = Math.max(0, 1 - progress * 1.1);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = asColor;
                ctx.lineWidth = 2.5;
                ctx.beginPath();
                ctx.moveTo(x - arm - gap, y); ctx.lineTo(x - gap, y);
                ctx.moveTo(x + gap, y);       ctx.lineTo(x + arm + gap, y);
                ctx.moveTo(x, y - arm - gap); ctx.lineTo(x, y - gap);
                ctx.moveTo(x, y + gap);       ctx.lineTo(x, y + arm + gap);
                ctx.stroke();
                ctx.lineWidth = 2;
                const tk = w * 0.35;
                [[x-gap,y-gap,-1,-1],[x+gap,y-gap,1,-1],[x-gap,y+gap,-1,1],[x+gap,y+gap,1,1]].forEach(([cx2,cy2,sx,sy]) => {
                    ctx.beginPath();
                    ctx.moveTo(cx2,cy2-sy*tk*0.5); ctx.lineTo(cx2,cy2); ctx.lineTo(cx2+sx*tk*0.5,cy2); ctx.stroke();
                });
                if (progress > 0.5) {
                    const rp = (progress - 0.5) / 0.5;
                    ctx.globalAlpha = alpha * (1 - rp);
                    ctx.lineWidth = 2.5;
                    ctx.beginPath();
                    ctx.arc(x, y, w * 0.4 + w * 1.2 * rp, 0, Math.PI * 2);
                    ctx.stroke();
                }
                ctx.restore();
                return progress < 1;
            }, 550);
            break;
        }
        case 'tidal_wave': {
            if (!target) break;
            nrFlashCol(target.c, 'nr-col-flash');
            // Canvas: wave ripple expanding horizontally from the column
            const twColor = PCOLORS[playerIdx];
            const twC = nrCellCenter(0, target.c);
            if (twC) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const cx = twC.x;
                const spread = W * progress * 0.9;
                const alpha = Math.max(0, 1 - progress * 1.1);
                for (let i = 0; i < 3; i++) {
                    const off = i * 0.12;
                    const p2 = Math.max(0, progress - off);
                    ctx.save();
                    ctx.globalAlpha = alpha * (1 - i * 0.28);
                    ctx.strokeStyle = twColor;
                    ctx.lineWidth = 2 - i * 0.5;
                    ctx.beginPath();
                    ctx.moveTo(cx - W * p2 * 0.9, 0);
                    ctx.lineTo(cx - W * p2 * 0.9, H);
                    ctx.stroke();
                    ctx.beginPath();
                    ctx.moveTo(cx + W * p2 * 0.9, 0);
                    ctx.lineTo(cx + W * p2 * 0.9, H);
                    ctx.stroke();
                    ctx.restore();
                }
                return progress < 1;
            }, 550);
            break;
        }
        case 'overgrowth': {
            if (!target) break;
            for (let dr = -1; dr <= 1; dr++)
                for (let dc = -1; dc <= 1; dc++)
                    nrFlashCell(target.r + dr, target.c + dc, 'nr-overgrowth-bloom', (Math.abs(dr) + Math.abs(dc)) * 25);
            const ogColor = PCOLORS[playerIdx];
            const spores = [];
            // Collect owned cells in area; if none, use the target cell itself as origin
            const origins = [];
            for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
                const r2 = target.r + dr, c2 = target.c + dc;
                if (r2 < 0 || r2 >= cfg.rows || c2 < 0 || c2 >= cfg.cols) continue;
                if (S.grid[r2][c2].owner === playerIdx) {
                    const center = nrCellCenter(r2, c2);
                    if (center) origins.push(center);
                }
            }
            if (!origins.length) {
                const fallback = nrCellCenter(target.r, target.c);
                if (fallback) origins.push(fallback);
            }
            origins.forEach(center => {
                for (let i = 0; i < 8; i++) {
                    const angle = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
                    spores.push({ x: center.x, y: center.y, angle, speed: 30 + Math.random() * 25, r: 2 + Math.random() * 1.5 });
                }
            });
            if (spores.length) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const t = elapsed / 1000;
                spores.forEach(s => {
                    const x = s.x + Math.cos(s.angle) * s.speed * t;
                    const y = s.y + Math.sin(s.angle) * s.speed * t;
                    ctx.save();
                    ctx.globalAlpha = Math.max(0, 1 - progress * 1.3);
                    ctx.fillStyle = ogColor;
                    ctx.beginPath();
                    ctx.arc(x, y, s.r * (1 - progress * 0.5), 0, Math.PI * 2);
                    ctx.fill();
                    ctx.restore();
                });
                return progress < 1;
            }, 550);
            break;
        }
        case 'static_field': {
            nrFlashBoard((r, c) => S.grid[r][c].owner === playerIdx, 'nr-staticfield-shield');
            // Canvas: electric arcs between adjacent own cells
            const sfColor = PCOLORS[playerIdx];
            const sfCells = [];
            for (let r = 0; r < cfg.rows; r++)
                for (let c = 0; c < cfg.cols; c++)
                    if (S.grid[r][c].owner === playerIdx) sfCells.push([r, c]);
            const arcs = [];
            sfCells.forEach(([r, c]) => {
                neighbors(r, c).forEach(([nr, nc]) => {
                    if (S.grid[nr][nc].owner !== playerIdx || nr * 100 + nc < r * 100 + c) return;
                    const a = nrCellCenter(r, c), b = nrCellCenter(nr, nc);
                    if (a && b) arcs.push({ a, b, jitter: Math.random() * 6 - 3 });
                });
            });
            if (arcs.length) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const alpha = Math.max(0, Math.sin(progress * Math.PI) * 0.85);
                arcs.forEach(({ a, b, jitter }) => {
                    const mx = (a.x + b.x) / 2 + jitter * Math.sin(elapsed * 0.03);
                    const my = (a.y + b.y) / 2 + jitter * Math.cos(elapsed * 0.03);
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = sfColor;
                    ctx.lineWidth = 1.2;
                    ctx.beginPath();
                    ctx.moveTo(a.x, a.y);
                    ctx.quadraticCurveTo(mx, my, b.x, b.y);
                    ctx.stroke();
                    ctx.restore();
                });
                return progress < 1;
            }, 500);
            break;
        }
        case 'phantom_step': {
            if (secondTarget && target) {
                const srcEl = cellEl(secondTarget.r, secondTarget.c);
                const dstEl = cellEl(target.r, target.c);
                nrFlashCell(secondTarget.r, secondTarget.c, 'nr-phantom-src');
                nrFlashCell(target.r, target.c, 'nr-phantom-dst');
                if (srcEl && dstEl && !lowGfx) {
                    const srcRect = srcEl.getBoundingClientRect();
                    const dstRect = dstEl.getBoundingClientRect();
                    const ghost = document.createElement('div');
                    ghost.className = 'nr-phantom-ghost';
                    ghost.style.cssText = `position:fixed;left:${srcRect.left+srcRect.width/2}px;top:${srcRect.top+srcRect.height/2}px;width:${srcRect.width*0.45}px;height:${srcRect.width*0.45}px;background:${PCOLORS[playerIdx]}55;border:1.5px solid ${PCOLORS[playerIdx]};border-radius:50%;pointer-events:none;z-index:999;transform:translate(-50%,-50%);transition:left 280ms ease-in-out,top 280ms ease-in-out,opacity 280ms;`;
                    document.body.appendChild(ghost);
                    requestAnimationFrame(() => requestAnimationFrame(() => {
                        ghost.style.left = `${dstRect.left+dstRect.width/2}px`;
                        ghost.style.top  = `${dstRect.top+dstRect.height/2}px`;
                        ghost.style.opacity = '0';
                    }));
                    setTimeout(() => ghost.remove(), 400);
                }
                // Canvas: 24 ghost orb circles fading along the path
                const psColor = PCOLORS[playerIdx];
                const psSrc = nrCellCenter(secondTarget.r, secondTarget.c);
                const psDst = nrCellCenter(target.r, target.c);
                if (psSrc && psDst) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                    const steps = 24;
                    for (let i = 0; i < steps; i++) {
                        const t = i / (steps - 1);
                        // Stagger reveal: each circle appears as progress sweeps past it
                        const revealAt = t * 0.6;
                        if (progress < revealAt) continue;
                        const localProgress = Math.min((progress - revealAt) / 0.4, 1);
                        const x = psSrc.x + (psDst.x - psSrc.x) * t;
                        const y = psSrc.y + (psDst.y - psSrc.y) * t;
                        const baseAlpha = 1 - t * 0.65; // trail fades toward destination
                        const alpha = Math.max(0, baseAlpha * (1 - localProgress * 1.2));
                        const r = psSrc.w * 0.22 * (1 - t * 0.4) * (1 - localProgress * 0.5);
                        ctx.save();
                        ctx.globalAlpha = alpha;
                        ctx.strokeStyle = psColor;
                        ctx.lineWidth = 1.5;
                        ctx.beginPath();
                        ctx.arc(x, y, r, 0, Math.PI * 2);
                        ctx.stroke();
                        ctx.restore();
                    }
                    return progress < 1;
                }, 480);
            }
            break;
        }
        case 'swap': {
            if (secondTarget) nrFlashCell(secondTarget.r, secondTarget.c, 'nr-swap-flash');
            if (target)       nrFlashCell(target.r, target.c, 'nr-swap-flash');
            // Canvas: 24 ghost circles on each path — two trails crossing each other
            const swColor = PCOLORS[playerIdx];
            const swA = secondTarget ? nrCellCenter(secondTarget.r, secondTarget.c) : null;
            const swB = target        ? nrCellCenter(target.r, target.c)             : null;
            if (swA && swB) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const steps = 24;
                for (let i = 0; i < steps; i++) {
                    const t = i / (steps - 1);
                    const revealAt = t * 0.6;
                    if (progress < revealAt) continue;
                    const localProgress = Math.min((progress - revealAt) / 0.4, 1);
                    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t;
                    // Trail A: swA → swB (curves one way)
                    const ax = swA.x + (swB.x - swA.x) * ease + (swB.y - swA.y) * 0.4 * Math.sin(t * Math.PI);
                    const ay = swA.y + (swB.y - swA.y) * ease - (swB.x - swA.x) * 0.4 * Math.sin(t * Math.PI);
                    // Trail B: swB → swA (curves other way)
                    const bx = swB.x + (swA.x - swB.x) * ease - (swA.y - swB.y) * 0.4 * Math.sin(t * Math.PI);
                    const by = swB.y + (swA.y - swB.y) * ease + (swA.x - swB.x) * 0.4 * Math.sin(t * Math.PI);
                    const alpha = Math.max(0, (1 - t * 0.5) * (1 - localProgress * 1.2));
                    const r = swA.w * 0.2 * (1 - t * 0.3) * (1 - localProgress * 0.5);
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = swColor;
                    ctx.lineWidth = 1.5;
                    ctx.beginPath(); ctx.arc(ax, ay, r, 0, Math.PI * 2); ctx.stroke();
                    ctx.globalAlpha = alpha * 0.75;
                    ctx.beginPath(); ctx.arc(bx, by, r, 0, Math.PI * 2); ctx.stroke();
                    ctx.restore();
                }
                return progress < 1;
            }, 500);
            break;
        }
        case 'permafrost': {
            if (!target) break;
            nrFlashCell(target.r, target.c, 'nr-permafrost-hit');
            neighbors(target.r, target.c).forEach(([nr, nc]) => nrFlashCell(nr, nc, 'nr-permafrost-hit', 80));
            // Canvas: ice crystal shards radiate from target, smaller secondary burst on each neighbor
            const pfColor = PCOLORS[playerIdx];
            const pfCenter = nrCellCenter(target.r, target.c);
            if (pfCenter) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const { x, y, w } = pfCenter;
                const alpha = Math.max(0, 1 - progress * 1.1);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = pfColor;
                // 8 shards from center
                for (let i = 0; i < 8; i++) {
                    const angle = (i / 8) * Math.PI * 2;
                    const len = w * 0.7 * progress;
                    ctx.lineWidth = i % 2 === 0 ? 1.8 : 1;
                    ctx.beginPath();
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len);
                    ctx.stroke();
                }
                // Expanding ring
                ctx.lineWidth = 1.2;
                ctx.beginPath();
                ctx.arc(x, y, w * 0.55 * progress, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
                return progress < 1;
            }, 500);
            break;
        }
        case 'ice_wall': {
            nrFlashBoard((r, c) => S.grid[r][c].owner === playerIdx, 'nr-icewall-shimmer');
            // Canvas: shield hexagonal pulse expanding from each own cell
            const iwColor = PCOLORS[playerIdx];
            const iwCells = [];
            for (let r = 0; r < cfg.rows; r++)
                for (let c = 0; c < cfg.cols; c++)
                    if (S.grid[r][c].owner === playerIdx) iwCells.push(nrCellCenter(r, c));
            nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const alpha = Math.max(0, Math.sin(progress * Math.PI) * 0.8);
                iwCells.forEach(center => {
                    if (!center) return;
                    const r = center.w * (0.5 + progress * 0.4);
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.strokeStyle = iwColor;
                    ctx.lineWidth = 1.5;
                    // Hexagon
                    ctx.beginPath();
                    for (let i = 0; i < 6; i++) {
                        const a = (i / 6) * Math.PI * 2 - Math.PI / 6;
                        i === 0 ? ctx.moveTo(center.x + Math.cos(a)*r, center.y + Math.sin(a)*r)
                                : ctx.lineTo(center.x + Math.cos(a)*r, center.y + Math.sin(a)*r);
                    }
                    ctx.closePath();
                    ctx.stroke();
                    ctx.restore();
                });
                return progress < 1;
            }, 550);
            break;
        }
        case 'ignite': {
            if (target) nrFlashCell(target.r, target.c, 'nr-ignite-mark');
            // Canvas: fire sparks burst upward from target cell
            const igColor = PCOLORS[playerIdx];
            const igCenter = target ? nrCellCenter(target.r, target.c) : null;
            if (igCenter) {
                const sparks = [];
                for (let i = 0; i < 10; i++) {
                    sparks.push({
                        x: igCenter.x + (Math.random() - 0.5) * igCenter.w * 0.4,
                        y: igCenter.y,
                        vx: (Math.random() - 0.5) * 22,
                        vy: -(28 + Math.random() * 30),
                        r: 2 + Math.random() * 1.5
                    });
                }
                nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                    const t = elapsed / 1000;
                    sparks.forEach(s => {
                        const x = s.x + s.vx * t;
                        const y = s.y + s.vy * t + 60 * t * t; // gravity pulls back
                        const alpha = Math.max(0, 1 - progress * 1.2);
                        ctx.save();
                        ctx.globalAlpha = alpha;
                        ctx.fillStyle = igColor;
                        ctx.beginPath();
                        ctx.arc(x, y, s.r * (1 - progress * 0.6), 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                    });
                    return progress < 1;
                }, 500);
            }
            break;
        }
        case 'ember': {
            if (target)
                for (let dr = 0; dr <= 1; dr++)
                    for (let dc = 0; dc <= 1; dc++)
                        nrFlashCell(target.r + dr, target.c + dc, 'nr-ember-mark', (dr + dc) * 60);
            // Canvas: flame lick rising from each marked own cell
            const emColor = PCOLORS[playerIdx];
            const emCells = [];
            if (target)
                for (let dr = 0; dr <= 1; dr++) for (let dc = 0; dc <= 1; dc++) {
                    const r2 = target.r + dr, c2 = target.c + dc;
                    if (r2 >= cfg.rows || c2 >= cfg.cols) continue;
                    if (S.grid[r2][c2].owner === playerIdx) { const c = nrCellCenter(r2, c2); if (c) emCells.push(c); }
                }
            if (emCells.length) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const t = elapsed / 1000;
                emCells.forEach(center => {
                    for (let i = 0; i < 4; i++) {
                        const phase = (t * 2 + i * 0.4) % 1;
                        const x = center.x + (i - 1.5) * center.w * 0.18;
                        const y = center.y - center.h * 0.3 - phase * center.h * 0.7;
                        const alpha = Math.max(0, (1 - phase) * (1 - progress * 1.1));
                        ctx.save();
                        ctx.globalAlpha = alpha;
                        ctx.fillStyle = emColor;
                        ctx.beginPath();
                        ctx.arc(x, y, (1 - phase) * 3.5, 0, Math.PI * 2);
                        ctx.fill();
                        ctx.restore();
                    }
                });
                return progress < 1;
            }, 550);
            break;
        }
        case 'infect': {
            if (target) nrFlashCell(target.r, target.c, 'nr-infect-mark-flash');
            // Canvas: pulsing ring that expands and contracts on target cell
            const inColor = PCOLORS[playerIdx];
            const inCenter = target ? nrCellCenter(target.r, target.c) : null;
            if (inCenter) nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const { x, y, w } = inCenter;
                const pulse = Math.sin(progress * Math.PI * 3);
                const r = w * (0.35 + pulse * 0.15);
                const alpha = Math.max(0, 1 - progress * 1.1);
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.strokeStyle = inColor;
                ctx.lineWidth = 1.8;
                ctx.setLineDash([3, 3]);
                ctx.beginPath();
                ctx.arc(x, y, r, 0, Math.PI * 2);
                ctx.stroke();
                ctx.setLineDash([]);
                // Dots at 4 points of the ring
                ctx.fillStyle = inColor;
                for (let i = 0; i < 4; i++) {
                    const a = (i / 4) * Math.PI * 2 + progress * Math.PI * 2;
                    ctx.beginPath();
                    ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, 2, 0, Math.PI * 2);
                    ctx.fill();
                }
                ctx.restore();
                return progress < 1;
            }, 550);
            break;
        }
        case 'corrode': {
            // CSS flash on the 2×2 area
            if (target)
                for (let dr = 0; dr <= 1; dr++)
                    for (let dc = 0; dc <= 1; dc++)
                        nrFlashCell(target.r + dr, target.c + dc, 'nr-corrode-hit', (dr + dc) * 40);
            // Canvas drip: 3 droplets fall downward from each enemy cell in the 2×2
            const cColor = PCOLORS[playerIdx];
            const drips = [];
            if (target) {
                for (let dr = 0; dr <= 1; dr++) {
                    for (let dc = 0; dc <= 1; dc++) {
                        const r2 = target.r + dr, c2 = target.c + dc;
                        if (r2 >= cfg.rows || c2 >= cfg.cols) continue;
                        const cell = S.grid[r2][c2];
                        if (cell.owner === -1 || cell.owner === playerIdx) continue;
                        const center = nrCellCenter(r2, c2);
                        if (!center) continue;
                        const count = 3;
                        for (let i = 0; i < count; i++) {
                            drips.push({
                                x: center.x + (Math.random() - 0.5) * center.w * 0.5,
                                y: center.y,
                                speed: 45 + Math.random() * 35,
                                r: 2 + Math.random() * 1.5,
                                delay: i * 0.08 + dr * 0.06 + dc * 0.06
                            });
                        }
                    }
                }
            }
            nrCanvasAnim((ctx, progress, elapsed, W, H) => {
                const t = elapsed / 1000;
                drips.forEach(d => {
                    const localT = Math.max(0, t - d.delay);
                    if (localT <= 0) return;
                    const localP = Math.min(localT / 0.55, 1);
                    const y = d.y + d.speed * localT + 60 * localT * localT; // gravity
                    const alpha = Math.max(0, 1 - localP * 1.1);
                    const radius = d.r * (1 + localP * 0.4);
                    ctx.save();
                    ctx.globalAlpha = alpha;
                    ctx.fillStyle = cColor;
                    // Teardrop shape: circle with a point at top
                    ctx.beginPath();
                    ctx.arc(d.x, y, radius, 0, Math.PI * 2);
                    ctx.fill();
                    // Elongated tail
                    ctx.beginPath();
                    ctx.moveTo(d.x - radius * 0.5, y - radius);
                    ctx.lineTo(d.x + radius * 0.5, y - radius);
                    ctx.lineTo(d.x, y - radius * 3.5);
                    ctx.closePath();
                    ctx.fill();
                    ctx.restore();
                });
                return progress < 1;
            }, 650);
            break;
        }
        case 'decay':
            // Per-cell BFS animation handled inside the ability case
            break;
    }
}

/* ── Helper: get character ability ID for player i at their current queue slot ── */
function nrCurrentAbilityId(playerIdx) {
    const charIdx = ALL_COLORS.indexOf(PCOLORS[playerIdx]);
    if (charIdx < 0) return null;
    const abilIdx = (S.nrAbilityIdx && S.nrAbilityIdx[playerIdx]) || 0;
    return NR_CHARS[charIdx].abilities[abilIdx];
}

/* ── Advance ability queue for a player after use ── */
function nrAdvanceAbility(playerIdx) {
    if (!S.nrAbilityIdx) return;
    const charIdx = ALL_COLORS.indexOf(PCOLORS[playerIdx]);
    if (charIdx < 0) return;
    S.nrAbilityIdx[playerIdx] = (S.nrAbilityIdx[playerIdx] + 1) % NR_CHARS[charIdx].abilities.length;
    S.nrMeter[playerIdx] = 0;
}

/* ── Player card click → try to activate ability ── */
function onPlayerCardClick(playerIdx) {
    if (!nuclearMode || S.over || S.animating) return;
    // If we're in player-targeting mode, route to that handler
    if (_nrTargeting && NR_ABILITIES[_nrTargeting.abilId].targeting === 'player') {
        nrHandlePlayerTarget(playerIdx);
        return;
    }
    if (onlineMode && playerIdx !== myPlayerIndex) return;
    if (playerIdx !== S.current) return;
    if (!S.nrMeter || S.nrMeter[playerIdx] < NR_METER_MAX) return;

    const abilId   = nrCurrentAbilityId(playerIdx);
    if (!abilId) return;
    const abilMeta = NR_ABILITIES[abilId];

    if (abilMeta.targeting === 'none') {
        // Execute immediately, no targeting needed
        nrExecuteAbility(playerIdx, abilId, null, null);
    } else if (abilMeta.targeting === 'player') {
        nrEnterTargeting(playerIdx, abilId, 1, null);
        nrHighlightPlayerTargets(playerIdx);
    } else {
        nrEnterTargeting(playerIdx, abilId, 1, null);
        nrHighlightCellTargets(playerIdx, abilId, 1);
    }
}

/* ── Targeting mode ── */
function nrEnterTargeting(player, abilId, phase, firstCell) {
    _nrTargeting = { player, abilId, phase, firstCell };
    document.getElementById('grid').classList.add('nr-targeting');
    const bar = document.getElementById('nr-targeting-bar');
    const label = document.getElementById('nr-targeting-label');
    const cancelBtn = document.getElementById('nr-cancel-btn');
    const t = NR_ABILITIES[abilId].targeting;
    const abilName = NR_ABILITIES[abilId].name;
    if (label) {
        const hints = {
            airstrike:       'Airstrike — click any cell to force it to explode in your color',
            carpet_bomb:     'Carpet Bomb — hover to highlight the row, click to destroy 1 orb from every enemy cell in it',
            detonation_wave: null,
            undertow:        null,
            riptide:         null,
            tidal_wave:      'Tidal Wave — hover to highlight the column, click to convert all 1–2 orb enemies in it',
            creep:           null,
            overgrowth:      'Overgrowth — hover to preview the 3×3 area; only valid if it contains one of your cells. Claims empty cells and adds +1 to your cells below near-critical',
            pandemic:        null,
            surge:           'Surge — activate for 3 rounds: hitting a 5+ chain grants a free extra turn, up to 2 per turn',
            static_field:    'Static Field — activate to absorb enemy chains this turn. Immune to Pandemic — gains +1 orb instead of losing one',
            blackout:        'Blackout — click an opponent\'s player card to skip their next turn, activate Surge for 3 rounds, and immediately play another turn',
            phantom_step:    phase === 1 ? 'Phantom Step — click one of your cells to move it' : 'Phantom Step — click an empty cell as the destination',
            swap:            phase === 1 ? 'Swap — click the first cell to swap' : 'Swap — click the second cell (triggers explosion check)',
            void_rift:       'Void Rift — hover to preview the 2×2 area. Erases all enemy orbs inside and adds +2 to each of your own cells (triggers explosion check)',
            permafrost:      'Permafrost — click an enemy cell to freeze it and its neighbors for 2 rounds. Your chains can thaw them and detonate in your color',
            ice_wall:        'Ice Wall — activate to make your cells unconvertible until your next turn',
            absolute_zero:   null,
            ignite:          'Ignite — click your own cell: 2 auto-explosions in your color. Click an enemy cell: 1 forced explosion in your color next turn. If a chain touches it first, it immediately explodes in your color',
            ember:           'Ember — hover for 2×2 preview; click to permanently mark your cells in the area as traps. Each marked cell repels the next enemy chain that hits it, then the mark is consumed',
            encircle:        null,
            corrode:         'Corrode — hover to preview the 2×2 area, click to reduce every enemy cell inside it to 1 orb',
            infect:          'Infect — click an enemy cell to mark it; when it explodes the spread converts to your color',
            decay:           'Decay — click any enemy cell: converts it to 2 orbs of yours, then BFS spreads to every connected enemy cell — 1-orb cells convert to 2-orb Venom cells, 2+ orb cells lose 1 orb. Spread never stops',
        };
        label.textContent = hints[abilId] || `${NR_ABILITIES[abilId].name} — select a target`;
    }
    if (bar) bar.style.display = '';
    if (cancelBtn) cancelBtn.style.display = '';
    setGridInteractive(true);
    if (abilId === 'void_rift') {
        document.querySelectorAll('.cell').forEach(el => {
            el.addEventListener('mouseenter', _nrVoidRiftHover);
            el.addEventListener('mouseleave', _nrVoidRiftUnhover);
        });
    }
    if (abilId === 'overgrowth') {
        document.querySelectorAll('.cell').forEach(el => {
            el.addEventListener('mouseenter', _nrOvergrowthHover);
            el.addEventListener('mouseleave', _nrOvergrowthUnhover);
        });
    }
    if (abilId === 'ember') {
        document.querySelectorAll('.cell').forEach(el => {
            el.addEventListener('mouseenter', _nrEmberHover);
            el.addEventListener('mouseleave', _nrEmberUnhover);
        });
    }
    if (abilId === 'corrode') {
        document.querySelectorAll('.cell').forEach(el => {
            el.addEventListener('mouseenter', _nrCorredeHover);
            el.addEventListener('mouseleave', _nrCorredeUnhover);
        });
    }
    if (abilId === 'carpet_bomb') {
        document.querySelectorAll('.cell').forEach(el => {
            el.addEventListener('mouseenter', _nrRowHover);
            el.addEventListener('mouseleave', _nrRowUnhover);
        });
    }
    if (abilId === 'tidal_wave') {
        document.querySelectorAll('.cell').forEach(el => {
            el.addEventListener('mouseenter', _nrColHover);
            el.addEventListener('mouseleave', _nrColUnhover);
        });
    }
}

function _nrVoidRiftHover(e) {
    _nrVoidRiftUnhover();
    const r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
    // 2×2 starting from clicked cell (top-left)
    for (let dr = 0; dr <= 1; dr++)
        for (let dc = 0; dc <= 1; dc++) {
            const el = cellEl(r + dr, c + dc);
            if (el) el.classList.add('nr-void-preview');
        }
}
function _nrVoidRiftUnhover() {
    document.querySelectorAll('.cell.nr-void-preview').forEach(el => el.classList.remove('nr-void-preview'));
}

function _nrOvergrowthHover(e) {
    _nrOvergrowthUnhover();
    const r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
    // 3×3 centered on hovered cell
    for (let dr = -1; dr <= 1; dr++)
        for (let dc = -1; dc <= 1; dc++) {
            const el = cellEl(r + dr, c + dc);
            if (el) el.classList.add('nr-overgrowth-preview');
        }
}
function _nrOvergrowthUnhover() {
    document.querySelectorAll('.cell.nr-overgrowth-preview').forEach(el => el.classList.remove('nr-overgrowth-preview'));
}

function _nrEmberHover(e) {
    _nrEmberUnhover();
    const r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
    for (let dr = 0; dr <= 1; dr++)
        for (let dc = 0; dc <= 1; dc++) {
            const el = cellEl(r + dr, c + dc);
            if (el) el.classList.add('nr-ember-preview');
        }
}
function _nrEmberUnhover() {
    document.querySelectorAll('.cell.nr-ember-preview').forEach(el => el.classList.remove('nr-ember-preview'));
}

function _nrCorredeHover(e) {
    _nrCorredeUnhover();
    const r = +e.currentTarget.dataset.r, c = +e.currentTarget.dataset.c;
    for (let dr = 0; dr <= 1; dr++)
        for (let dc = 0; dc <= 1; dc++) {
            const el = cellEl(r + dr, c + dc);
            if (el) el.classList.add('nr-corrode-preview');
        }
}
function _nrCorredeUnhover() {
    document.querySelectorAll('.cell.nr-corrode-preview').forEach(el => el.classList.remove('nr-corrode-preview'));
}

function _nrRowHover(e) {
    _nrRowUnhover();
    const r = +e.currentTarget.dataset.r;
    for (let c = 0; c < cfg.cols; c++) {
        const el = cellEl(r, c);
        if (el) el.classList.add('nr-row-preview');
    }
}
function _nrRowUnhover() {
    document.querySelectorAll('.cell.nr-row-preview').forEach(el => el.classList.remove('nr-row-preview'));
}

function _nrColHover(e) {
    _nrColUnhover();
    const c = +e.currentTarget.dataset.c;
    for (let r = 0; r < cfg.rows; r++) {
        const el = cellEl(r, c);
        if (el) el.classList.add('nr-col-preview');
    }
}
function _nrColUnhover() {
    document.querySelectorAll('.cell.nr-col-preview').forEach(el => el.classList.remove('nr-col-preview'));
}

function nrExitTargeting() {
    _nrTargeting = null;
    document.getElementById('grid').classList.remove('nr-targeting');
    document.querySelectorAll('.cell').forEach(el => {
        el.classList.remove('nr-valid', 'nr-invalid', 'nr-selected', 'nr-void-preview', 'nr-ember-preview', 'nr-row-preview', 'nr-col-preview', 'nr-overgrowth-preview', 'nr-corrode-preview');
        el.removeEventListener('mouseenter', _nrVoidRiftHover);
        el.removeEventListener('mouseleave', _nrVoidRiftUnhover);
        el.removeEventListener('mouseenter', _nrOvergrowthHover);
        el.removeEventListener('mouseleave', _nrOvergrowthUnhover);
        el.removeEventListener('mouseenter', _nrEmberHover);
        el.removeEventListener('mouseleave', _nrEmberUnhover);
        el.removeEventListener('mouseenter', _nrCorredeHover);
        el.removeEventListener('mouseleave', _nrCorredeUnhover);
        el.removeEventListener('mouseenter', _nrRowHover);
        el.removeEventListener('mouseleave', _nrRowUnhover);
        el.removeEventListener('mouseenter', _nrColHover);
        el.removeEventListener('mouseleave', _nrColUnhover);
    });
    for (let i = 0; i < PCOLORS.length; i++) {
        const card = document.getElementById(`pc${i}`);
        if (card) card.classList.remove('nr-valid-player');
    }
    const bar = document.getElementById('nr-targeting-bar');
    const cancelBtn = document.getElementById('nr-cancel-btn');
    if (bar) bar.style.display = 'none';
    if (cancelBtn) cancelBtn.style.display = 'none';
}

function nrCancelTargeting() {
    nrExitTargeting();
    // Restore normal interactivity
    const myTurn = !onlineMode || S.current === myPlayerIndex;
    setGridInteractive(myTurn && !S.animating && !S.over);
}

function nrHighlightCellTargets(playerIdx, abilId, phase) {
    document.querySelectorAll('.cell').forEach(el => {
        const r = +el.dataset.r, c = +el.dataset.c;
        const cell = S.grid[r][c];
        // Frozen cells are never valid targets
        if (nuclearMode && cell.frozen > 0) {
            el.classList.add('nr-invalid');
            el.classList.remove('nr-valid');
            return;
        }
        let valid = false;
        const t = NR_ABILITIES[abilId].targeting;
        if (t === 'cell_any')    valid = true;
        if (t === 'cell_enemy')  valid = cell.owner !== -1 && cell.owner !== playerIdx;
        if (t === 'cell_own')    valid = cell.owner === playerIdx;
        if (t === 'row')         valid = true;
        if (t === 'col')         valid = true;
        if (t === 'cell2_own')   valid = phase === 1 ? cell.owner === playerIdx : cell.owner === -1;
        if (t === 'cell2_any')   valid = true;
        // Ignite: only occupied cells (own or enemy), not empty
        if (abilId === 'ignite' && valid) valid = cell.owner !== -1;
        // Corrode: only valid if the 2×2 area from this cell contains at least one enemy
        if (abilId === 'corrode' && valid) {
            let hasEnemy = false;
            for (let dr = 0; dr <= 1 && !hasEnemy; dr++)
                for (let dc = 0; dc <= 1 && !hasEnemy; dc++) {
                    const r2 = r + dr, c2 = c + dc;
                    if (r2 < cfg.rows && c2 < cfg.cols && S.grid[r2][c2].owner !== -1 && S.grid[r2][c2].owner !== playerIdx)
                        hasEnemy = true;
                }
            valid = hasEnemy;
        }
        // Overgrowth special: only valid if 3×3 area around this cell contains at least one owned cell
        if (abilId === 'overgrowth' && valid) {
            let hasOwned = false;
            for (let dr = -1; dr <= 1 && !hasOwned; dr++)
                for (let dc = -1; dc <= 1 && !hasOwned; dc++) {
                    const r2 = r + dr, c2 = c + dc;
                    if (r2 >= 0 && r2 < cfg.rows && c2 >= 0 && c2 < cfg.cols)
                        if (S.grid[r2][c2].owner === playerIdx) hasOwned = true;
                }
            valid = hasOwned;
        }
        el.classList.toggle('nr-valid',   valid);
        el.classList.toggle('nr-invalid', !valid);
    });
}

function nrHighlightPlayerTargets(playerIdx) {
    // Highlight enemy player cards
    for (let i = 0; i < PCOLORS.length; i++) {
        const card = document.getElementById(`pc${i}`);
        if (!card) continue;
        const valid = i !== playerIdx && !S.eliminated[i];
        card.classList.toggle('nr-valid-player', valid);
    }
}

/* ── Cell click during targeting ── */
function nrHandleCellTarget(r, c) {
    if (!_nrTargeting) return;
    const { player, abilId, phase, firstCell } = _nrTargeting;
    const t = NR_ABILITIES[abilId].targeting;
    const cell = S.grid[r][c];

    // Validate target
    let valid = false;
    if (t === 'cell_any')    valid = true;
    if (t === 'cell_enemy')  valid = cell.owner !== -1 && cell.owner !== player;
    if (t === 'cell_own')    valid = cell.owner === player;
    if (t === 'row')         valid = true;
    if (t === 'col')         valid = true;
    if (t === 'cell2_own')   valid = phase === 1 ? cell.owner === player : cell.owner === -1;
    if (t === 'cell2_any')   valid = true;
    if (abilId === 'ignite' && valid) valid = cell.owner !== -1;
    // Overgrowth: reject if no owned cell in 3×3 area
    if (abilId === 'overgrowth' && valid) {
        let hasOwned = false;
        for (let dr = -1; dr <= 1 && !hasOwned; dr++)
            for (let dc = -1; dc <= 1 && !hasOwned; dc++) {
                const r2 = r + dr, c2 = c + dc;
                if (r2 >= 0 && r2 < cfg.rows && c2 >= 0 && c2 < cfg.cols)
                    if (S.grid[r2][c2].owner === player) hasOwned = true;
            }
        valid = hasOwned;
    }
    // Corrode: reject if 2×2 area has no enemy cells
    if (abilId === 'corrode' && valid) {
        let hasEnemy = false;
        for (let dr = 0; dr <= 1 && !hasEnemy; dr++)
            for (let dc = 0; dc <= 1 && !hasEnemy; dc++) {
                const r2 = r + dr, c2 = c + dc;
                if (r2 < cfg.rows && c2 < cfg.cols && S.grid[r2][c2].owner !== -1 && S.grid[r2][c2].owner !== player)
                    hasEnemy = true;
            }
        valid = hasEnemy;
    }

    if (!valid) return;

    if ((t === 'cell2_own' || t === 'cell2_any') && phase === 1) {
        // Mark first cell, await second
        document.querySelectorAll('.cell').forEach(el => el.classList.remove('nr-valid', 'nr-invalid', 'nr-selected'));
        const el = cellEl(r, c); if (el) el.classList.add('nr-selected');
        nrEnterTargeting(player, abilId, 2, { r, c });
        nrHighlightCellTargets(player, abilId, 2);
        return;
    }

    nrExitTargeting();
    nrExecuteAbility(player, abilId, { r, c }, firstCell);
}

/* ── Player card click during Blackout targeting ── */
function nrHandlePlayerTarget(targetIdx) {
    if (!_nrTargeting || NR_ABILITIES[_nrTargeting.abilId].targeting !== 'player') return;
    const { player, abilId } = _nrTargeting;
    if (targetIdx === player || S.eliminated[targetIdx]) return;
    // Clear player highlights
    for (let i = 0; i < PCOLORS.length; i++) {
        const card = document.getElementById(`pc${i}`);
        if (card) card.classList.remove('nr-valid-player');
    }
    nrExitTargeting();
    nrExecuteAbility(player, abilId, { targetPlayer: targetIdx }, null);
}

/* ── Execute ability ── */
function nrExecuteAbility(playerIdx, abilId, target, secondTarget) {
    // Save state before every ability so undo can restore it.
    // (Normal moves push via handleClick; abilities intercept before that push, so we do it here.)
    if (!onlineMode) {
        history.push(cloneState());
        syncUndoBtn();
    }
    // Centralized pre-ability animations
    if (nuclearMode) nrPlayAbilityAnim(playerIdx, abilId, target, secondTarget);
    switch (abilId) {

        /* RED — WARHEAD */
        case 'airstrike': {
            const { r, c } = target;
            const cell = S.grid[r][c];
            // Remove any infect mark — Airstrike overrides Infect
            cell.infect = -1;
            cell.backdraft = -1;
            // Force explosion in the activating player's color
            if (cell.count === 0) { cell.count = 1; cell.owner = playerIdx; S.orbCount[playerIdx]++; }
            // Tag cell so chainReact knows to use playerIdx as owner for spread
            cell._airstrikeOwner = playerIdx;
            // Push it over critical mass by forcing count = critMass
            const cm = critMass(r, c);
            const delta = cm - cell.count;
            if (delta > 0) { cell.count += delta; S.orbCount[cell.owner] += delta; }
            markDirty(r, c);
            chainCandidates = new Set();
            chainCandidates.add(r * 100 + c);
            nrPostAbility(playerIdx);
            nrRunChainAfterAbility(playerIdx);
            break;
        }

        case 'carpet_bomb': {
            const row = target.r;
            for (let c2 = 0; c2 < cfg.cols; c2++) {
                const cell = S.grid[row][c2];
                if (cell.count > 0 && cell.owner !== playerIdx) {
                    S.orbCount[cell.owner]--;
                    cell.count--;
                    if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }
                    markDirty(row, c2);
                }
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'detonation_wave': {
            const detTargets = [];
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const cell = S.grid[r2][c2];
                    if (cell.owner !== -1 && cell.owner !== playerIdx && cell.count === critMass(r2, c2) - 1) {
                        S.orbCount[cell.owner] -= cell.count;
                        cell.count--;
                        if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }
                        else { cell.owner = playerIdx; S.orbCount[playerIdx] += cell.count; }
                        markDirty(r2, c2);
                        detTargets.push([r2, c2]);
                    }
                }
            }
            detTargets.forEach(([r2, c2]) => nrFlashCell(r2, c2, 'nr-detwave-flash', (r2 + c2) * 15));
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        /* BLUE — TSUNAMI */
        case 'undertow': {
            // Drain 1 from each adjacent enemy cell, transfer into bordering own cell
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const cell = S.grid[r2][c2];
                    if (cell.owner !== -1 && cell.owner !== playerIdx && cell.count > 0) {
                        const adjOwn = neighbors(r2, c2).filter(([nr, nc]) => S.grid[nr][nc].owner === playerIdx);
                        if (adjOwn.length === 0) continue;
                        adjOwn.sort((a, b) => S.grid[a[0]][a[1]].count - S.grid[b[0]][b[1]].count);
                        const [tr, tc] = adjOwn[0];
                        S.orbCount[cell.owner]--;
                        cell.count--;
                        if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }
                        S.grid[tr][tc].count++;
                        S.orbCount[playerIdx]++;
                        if (S.grid[tr][tc].count >= critMass(tr, tc)) chainCandidates.add(tr * 100 + tc);
                        markDirty(r2, c2); markDirty(tr, tc);
                        nrFlashCell(tr, tc, 'nr-undertow-gain', (tr + tc) * 20);
                    }
                }
            }
            nrPostAbility(playerIdx);
            if (chainCandidates.size > 0) nrRunChainAfterAbility(playerIdx);
            else { renderAll(); nrFinishAbilityTurn(playerIdx); }
            break;
        }

        case 'riptide': {
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const isEdge = r2 === 0 || r2 === cfg.rows - 1 || c2 === 0 || c2 === cfg.cols - 1;
                    if (!isEdge) continue;
                    const cell = S.grid[r2][c2];
                    if (cell.owner === playerIdx) continue;
                    const adjOwn = neighbors(r2, c2).some(([nr, nc]) => S.grid[nr][nc].owner === playerIdx);
                    if (!adjOwn) continue;
                    // Transfer orb counts cleanly
                    if (cell.owner !== -1) S.orbCount[cell.owner] -= cell.count;
                    if (cell.count === 0) { cell.count = 1; }
                    S.orbCount[playerIdx] += cell.count;
                    cell.owner = playerIdx;
                    markDirty(r2, c2);
                }
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'tidal_wave': {
            const col = target.c;
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                const cell = S.grid[r2][col];
                if (cell.owner !== -1 && cell.owner !== playerIdx && cell.count <= 2) {
                    S.orbCount[cell.owner] -= cell.count;
                    S.orbCount[playerIdx]  += cell.count;
                    cell.owner = playerIdx;
                    markDirty(r2, col);
                }
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        /* GREEN — BLIGHT */
        case 'creep': {
            // Claim empty cells AND 1-orb enemy cells adjacent to any of your cells
            const toCreep = [];
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const cell = S.grid[r2][c2];
                    const isTarget = cell.owner === -1 || (cell.owner !== playerIdx && cell.count === 1);
                    if (!isTarget) continue;
                    const adjOwn = neighbors(r2, c2).some(([nr, nc]) => S.grid[nr][nc].owner === playerIdx);
                    if (adjOwn) toCreep.push([r2, c2]);
                }
            }
            // Build own-cell list for distance calculation before mutations
            const ownForCreep = [];
            for (let r2 = 0; r2 < cfg.rows; r2++)
                for (let c2 = 0; c2 < cfg.cols; c2++)
                    if (S.grid[r2][c2].owner === playerIdx) ownForCreep.push([r2, c2]);
            for (const [r2, c2] of toCreep) {
                const cell = S.grid[r2][c2];
                if (cell.owner !== -1 && cell.owner !== playerIdx) {
                    S.orbCount[cell.owner] -= cell.count;
                }
                cell.owner = playerIdx;
                cell.count = 1;
                S.orbCount[playerIdx]++;
                const minDist = ownForCreep.reduce((m, [or, oc]) => Math.min(m, Math.abs(r2 - or) + Math.abs(c2 - oc)), 999);
                nrFlashCell(r2, c2, 'nr-creep-claim', minDist * 40);
                markDirty(r2, c2);
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'overgrowth': {
            // 3×3 square centered on target cell — only works if area contains at least 1 owned cell
            const { r: or, c: oc } = target;
            const hasOwned = (() => {
                for (let dr = -1; dr <= 1; dr++)
                    for (let dc = -1; dc <= 1; dc++) {
                        const r2 = or + dr, c2 = oc + dc;
                        if (r2 >= 0 && r2 < cfg.rows && c2 >= 0 && c2 < cfg.cols)
                            if (S.grid[r2][c2].owner === playerIdx) return true;
                    }
                return false;
            })();
            if (!hasOwned) { renderAll(); nrFinishAbilityTurn(playerIdx); break; }
            for (let dr = -1; dr <= 1; dr++) {
                for (let dc = -1; dc <= 1; dc++) {
                    const r2 = or + dr, c2 = oc + dc;
                    if (r2 < 0 || r2 >= cfg.rows || c2 < 0 || c2 >= cfg.cols) continue;
                    const cell = S.grid[r2][c2];
                    if (cell.owner === playerIdx) {
                        if (cell.count < critMass(r2, c2) - 1) {
                            cell.count++;
                            S.orbCount[playerIdx]++;
                            markDirty(r2, c2);
                        }
                    } else if (cell.owner === -1) {
                        cell.owner = playerIdx;
                        cell.count = 1;
                        S.orbCount[playerIdx]++;
                        markDirty(r2, c2);
                    }
                }
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'pandemic': {
            // Phase 1: enemy cells lose 1 orb — Static Field owners are immune (gain +1 instead)
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const cell = S.grid[r2][c2];
                    if (cell.owner === -1 || cell.owner === playerIdx) continue;
                    if (nuclearMode && S.nrStaticField && S.nrStaticField[cell.owner]) {
                        // Static Field immunity: absorb the pandemic as an orb boost
                        cell.count++;
                        S.orbCount[cell.owner]++;
                        if (cell.count >= critMass(r2, c2)) chainCandidates.add(r2 * 100 + c2);
                        markDirty(r2, c2);
                    } else if (cell.count > 0) {
                        S.orbCount[cell.owner]--;
                        cell.count--;
                        if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }
                        markDirty(r2, c2);
                    }
                }
            }
            // Phase 2: own cells gain 1 orb — skip near-critical cells (count >= critMass - 1)
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const cell = S.grid[r2][c2];
                    if (cell.owner === playerIdx && cell.count < critMass(r2, c2) - 1) {
                        cell.count++;
                        S.orbCount[playerIdx]++;
                        markDirty(r2, c2);
                    }
                }
            }
            nrPostAbility(playerIdx);
            if (chainCandidates.size > 0) nrRunChainAfterAbility(playerIdx);
            else { renderAll(); nrFinishAbilityTurn(playerIdx); }
            break;
        }

        /* YELLOW — VOLTAGE */
        case 'surge': {
            if (S.nrSurge) S.nrSurge[playerIdx] = 3; // passive active for 3 full rounds
            // Advance ability queue and reset meter, but do NOT advance the turn —
            // Voltage keeps their turn to make a normal move after activating Surge.
            nrAdvanceAbility(playerIdx);
            checkEliminationsAndWin();
            markAllDirty(); renderAll();
            if (onlineMode) {
                S.pendingMove = null;
                if (!S.over) S.turnDeadline = serverNow() + TURN_TIMER_MS;
                pushStateToFirebase();
                updateOnlineInteractivity();
            } else if (IS_AI[playerIdx]) {
                scheduleAiTurn();
            } else {
                setGridInteractive(true);
            }
            break;
        }

        case 'static_field': {
            if (S.nrStaticField) S.nrStaticField[playerIdx] = true;
            nrPostAbility(playerIdx);
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'blackout': {
            const t2 = target.targetPlayer;
            if (t2 !== undefined && !S.eliminated[t2]) {
                S.nrBlackout[t2] = true; // immediate skip handled in nrFinishAbilityTurn
            }
            // Blackout activates Surge passive for 3 rounds
            if (S.nrSurge) S.nrSurge[playerIdx] = 3;
            nrPostAbility(playerIdx);
            // Give Voltage a free turn — same as Surge passive trigger
            S._nrSurgeFreeThisTurn = true;
            S._nrSurgeUsedThisTurn++;
            markAllDirty(); renderAll();
            if (onlineMode) {
                S.pendingMove = null;
                if (!S.over) S.turnDeadline = serverNow() + TURN_TIMER_MS;
                pushStateToFirebase();
                updateOnlineInteractivity();
            } else if (IS_AI[playerIdx]) {
                scheduleAiTurn();
            } else {
                setGridInteractive(true);
            }
            break;
        }

        /* PURPLE — PHANTOM */
        case 'phantom_step': {
            const src = secondTarget, dst = target;
            if (!src || !dst) break;
            const srcCell = S.grid[src.r][src.c];
            const dstCell = S.grid[dst.r][dst.c];
            if (srcCell.owner !== playerIdx || dstCell.owner !== -1) break;
            dstCell.owner     = srcCell.owner;
            dstCell.count     = srcCell.count;
            dstCell.infect    = srcCell.infect;
            dstCell.backdraft = srcCell.backdraft;
            dstCell.ignite    = srcCell.ignite;
            srcCell.owner = -1; srcCell.count = 0;
            srcCell.infect = -1; srcCell.backdraft = -1; srcCell.ignite = 0;
            markDirty(src.r, src.c); markDirty(dst.r, dst.c);
            // Explosion check on destination
            chainCandidates = new Set();
            if (dstCell.count >= critMass(dst.r, dst.c)) chainCandidates.add(dst.r * 100 + dst.c);
            nrPostAbility(playerIdx);
            if (chainCandidates.size > 0) nrRunChainAfterAbility(playerIdx);
            else { renderAll(); nrFinishAbilityTurn(playerIdx); }
            break;
        }

        case 'swap': {
            const cellA = S.grid[secondTarget.r][secondTarget.c];
            const cellB = S.grid[target.r][target.c];
            const tmpOwner = cellA.owner, tmpCount = cellA.count;
            const tmpInfect = cellA.infect, tmpBdr = cellA.backdraft, tmpIgn = cellA.ignite;
            cellA.owner = cellB.owner; cellA.count = cellB.count;
            cellA.infect = cellB.infect; cellA.backdraft = cellB.backdraft; cellA.ignite = cellB.ignite;
            cellB.owner = tmpOwner; cellB.count = tmpCount;
            cellB.infect = tmpInfect; cellB.backdraft = tmpBdr; cellB.ignite = tmpIgn;
            // Recalculate orbCounts for both affected owners
            S.orbCount.fill(0);
            for (let r2 = 0; r2 < cfg.rows; r2++)
                for (let c2 = 0; c2 < cfg.cols; c2++)
                    if (S.grid[r2][c2].owner >= 0) S.orbCount[S.grid[r2][c2].owner] += S.grid[r2][c2].count;
            markDirty(secondTarget.r, secondTarget.c); markDirty(target.r, target.c);
            // Check if either cell is now at or past crit mass → chain react
            chainCandidates = new Set();
            [[secondTarget.r, secondTarget.c], [target.r, target.c]].forEach(([r2, c2]) => {
                if (S.grid[r2][c2].count >= critMass(r2, c2)) chainCandidates.add(r2 * 100 + c2);
            });
            nrPostAbility(playerIdx);
            if (chainCandidates.size > 0) nrRunChainAfterAbility(playerIdx);
            else { renderAll(); nrFinishAbilityTurn(playerIdx); }
            break;
        }

        case 'void_rift': {
            // 2×2 area: target cell is top-left anchor
            for (let dr = 0; dr <= 1; dr++) {
                for (let dc = 0; dc <= 1; dc++) {
                    const r2 = target.r + dr, c2 = target.c + dc;
                    if (r2 < 0 || r2 >= cfg.rows || c2 < 0 || c2 >= cfg.cols) continue;
                    const cell = S.grid[r2][c2];
                    if (cell.owner !== -1 && cell.owner !== playerIdx) {
                        S.orbCount[cell.owner] -= cell.count;
                        cell.count = 0; cell.owner = -1;
                        cell.infect = -1; cell.backdraft = -1;
                        markDirty(r2, c2);
                    } else if (cell.owner === playerIdx) {
                        cell.count += 2;
                        S.orbCount[playerIdx] += 2;
                        if (cell.count >= critMass(r2, c2)) chainCandidates.add(r2 * 100 + c2);
                        markDirty(r2, c2);
                    }
                }
            }
            nrPostAbility(playerIdx);
            if (chainCandidates.size > 0) nrRunChainAfterAbility(playerIdx);
            else { renderAll(); nrFinishAbilityTurn(playerIdx); }
            break;
        }

        /* CYAN — CRYO */
        case 'permafrost': {
            const { r: pr, c: pc } = target;
            const toFreeze = [[pr, pc], ...neighbors(pr, pc)];
            toFreeze.forEach(([r2, c2]) => {
                const cell = S.grid[r2][c2];
                if (cell.owner !== -1 && cell.owner !== playerIdx) {
                    cell.frozen = 2;
                    cell._cryoFrozen = true;
                    cell.frozenBy = playerIdx;
                    markDirty(r2, c2);
                }
            });
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'ice_wall': {
            S.nrIceWall[playerIdx] = true; // checked during chain reaction spread
            nrPostAbility(playerIdx);
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'absolute_zero': {
            // Freeze every enemy cell at critMass - 1 for 3 turns
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const cell = S.grid[r2][c2];
                    if (cell.owner !== -1 && cell.owner !== playerIdx && cell.count >= critMass(r2, c2) - 1) {
                        cell.frozen = 3;
                        cell._cryoFrozen = true;
                        cell._absZeroFrozen = true;
                        cell.frozenBy = playerIdx;
                        markDirty(r2, c2);
                    }
                }
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        /* ORANGE — NAPALM */
        case 'ignite': {
            const { r: ir, c: ic } = target;
            const igCell = S.grid[ir][ic];
            if (igCell.owner === playerIdx) {
                // Own cell: explodes for 2 turns in Napalm's color, locked from incoming orbs
                igCell.ignite = 2;
                igCell.igniteOwner = playerIdx;
                markDirty(ir, ic);
            } else if (igCell.owner !== -1) {
                // Enemy cell: explodes for 1 turn in Napalm's color, locked from incoming orbs
                igCell.ignite = 1;
                igCell.igniteOwner = playerIdx;
                markDirty(ir, ic);
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'ember': {
            // Mark a 2×2 area starting at the clicked own cell (top-left anchor)
            const anchorR = target.r, anchorC = target.c;
            for (let dr = 0; dr <= 1; dr++) {
                for (let dc = 0; dc <= 1; dc++) {
                    const r2 = anchorR + dr, c2 = anchorC + dc;
                    if (r2 >= cfg.rows || c2 >= cfg.cols) continue;
                    const cell = S.grid[r2][c2];
                    if (cell.owner === playerIdx) cell.backdraft = playerIdx; // ember mark on own cells
                    markDirty(r2, c2);
                }
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'encircle': {
            const cm_convert = {};  // 3+ neighbors → convert + ignite 2 turns
            const cm_ignite1  = {}; // 2 neighbors → ignite 1 turn only (no conversion)
            for (let r2 = 0; r2 < cfg.rows; r2++) {
                for (let c2 = 0; c2 < cfg.cols; c2++) {
                    const cell = S.grid[r2][c2];
                    if (cell.owner === -1 || cell.owner === playerIdx) continue;
                    const napalmNeighbors = neighbors(r2, c2).filter(([nr, nc]) => S.grid[nr][nc].owner === playerIdx).length;
                    if (napalmNeighbors >= 3) cm_convert[r2 * 100 + c2] = true;
                    else if (napalmNeighbors === 2) cm_ignite1[r2 * 100 + c2] = true;
                }
            }
            // 3+ neighbors: convert to Napalm and set ignite 2 turns
            for (const key of Object.keys(cm_convert)) {
                const r2 = (parseInt(key) / 100) | 0, c2 = parseInt(key) % 100;
                const cell = S.grid[r2][c2];
                S.orbCount[cell.owner] -= cell.count;
                cell.owner = playerIdx;
                S.orbCount[playerIdx] += cell.count;
                cell.ignite = 2;
                cell.igniteOwner = playerIdx;
                markDirty(r2, c2);
            }
            // 2 neighbors: enemy cell locked and set to explode in Napalm's color for 1 turn
            for (const key of Object.keys(cm_ignite1)) {
                if (cm_convert[key]) continue;
                const r2 = (parseInt(key) / 100) | 0, c2 = parseInt(key) % 100;
                const cell = S.grid[r2][c2];
                cell.ignite = 1;
                cell.igniteOwner = playerIdx;
                markDirty(r2, c2);
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        /* LIME — VENOM */
        case 'corrode': {
            // 2×2 area from top-left anchor — reduce each enemy cell to 1 orb
            for (let dr = 0; dr <= 1; dr++) {
                for (let dc = 0; dc <= 1; dc++) {
                    const r2 = target.r + dr, c2 = target.c + dc;
                    if (r2 >= cfg.rows || c2 >= cfg.cols) continue;
                    const cell = S.grid[r2][c2];
                    if (cell.owner !== -1 && cell.owner !== playerIdx && cell.count > 1) {
                        const remove = cell.count - 1;
                        S.orbCount[cell.owner] -= remove;
                        cell.count = 1;
                        markDirty(r2, c2);
                    }
                }
            }
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'infect': {
            const { r: inr, c: inc } = target;
            const cell = S.grid[inr][inc];
            if (cell.owner !== -1 && cell.owner !== playerIdx) cell.infect = playerIdx;
            nrPostAbility(playerIdx);
            renderAll();
            nrFinishAbilityTurn(playerIdx);
            break;
        }

        case 'decay': {
            // Venom ultimate: BFS through ALL connected enemy cells.
            // 1-orb cells: convert to Venom and give +1 (becomes 2 orbs). Spreading continues from them.
            // 2+ orb cells: drain 1 orb, stay enemy. Spreading STILL continues from them.
            // Spread never stops — visits every reachable enemy cell.
            const { r: dr, c: dc } = target;
            const startCell = S.grid[dr][dc];
            if (startCell.owner === -1 || startCell.owner === playerIdx) break;

            const visited = new Set([dr * 100 + dc]);
            const queue = [[dr, dc, 0]]; // [r, c, depth]
            const flashMap = new Map(); // key → depth for animation

            // Always convert the initial target, give +1 (2 orbs total)
            S.orbCount[startCell.owner] -= startCell.count;
            startCell.owner = playerIdx;
            startCell.count = 2;
            S.orbCount[playerIdx] += 2;
            markDirty(dr, dc);
            flashMap.set(dr * 100 + dc, 0);

            while (queue.length > 0) {
                const [cr, cc, depth] = queue.shift();
                neighbors(cr, cc).forEach(([nr, nc]) => {
                    const key = nr * 100 + nc;
                    if (visited.has(key)) return;
                    const ncell = S.grid[nr][nc];
                    if (ncell.owner === -1 || ncell.owner === playerIdx) return;
                    visited.add(key);
                    flashMap.set(key, depth + 1);
                    queue.push([nr, nc, depth + 1]); // always keep spreading
                    if (ncell.count === 1) {
                        S.orbCount[ncell.owner]--;
                        ncell.owner = playerIdx;
                        ncell.count = 2;
                        S.orbCount[playerIdx] += 2;
                    } else {
                        S.orbCount[ncell.owner]--;
                        ncell.count--;
                    }
                    markDirty(nr, nc);
                });
            }

            // Animate — stagger flash by BFS depth from origin
            flashMap.forEach((depth, key) => {
                const r2 = (key / 100) | 0, c2 = key % 100;
                nrFlashCell(r2, c2, 'nr-decay-hit', depth * 55);
            });
            nrPostAbility(playerIdx);
            // Explosion check — converted cells at critMass (e.g. corner cells at 2 orbs) chain immediately
            for (const key of visited) {
                const r2 = (key / 100) | 0, c2 = key % 100;
                const cell = S.grid[r2][c2];
                if (cell.owner === playerIdx && cell.count >= critMass(r2, c2))
                    chainCandidates.add(key);
            }
            if (chainCandidates.size > 0) nrRunChainAfterAbility(playerIdx);
            else { renderAll(); nrFinishAbilityTurn(playerIdx); }
            break;
        }
    }
}

/* ── Post-ability bookkeeping ── */
function nrPostAbility(playerIdx) {
    nrAdvanceAbility(playerIdx);
    checkEliminationsAndWin();
    renderAll();
}

/* ── Run chain reactions after an ability that creates instability ── */
function nrRunChainAfterAbility(playerIdx) {
    S.animating = true;
    const mySession = gameSession;
    turnOrbsBefore = S.orbCount[playerIdx];
    comboCount = 0;
    hideCombo(true);
    setGridInteractive(false);
    chainReact(mySession).then(() => {
        if (mySession !== gameSession) {
            S.animating = false;
            if (onlineMode) updateOnlineInteractivity();
            return;
        }
        if (!S.over) checkEliminationsAndWin();
        commitGainBadge(playerIdx);
        hideCombo();
        S.animating = false;
        if (S.over) {
            stopPlayerTimer();
            markAllDirty(); renderAll();
            if (onlineMode) pushStateToFirebase();
            return;
        }
        nrFinishAbilityTurn(playerIdx);
    }).catch(() => {
        // Chain was interrupted — unblock UI
        S.animating = false;
        if (onlineMode) updateOnlineInteractivity();
        else setGridInteractive(true);
    });
}

/* ── After ability completes: push state + hand back control ── */
async function nrFinishAbilityTurn(playerIdx) {
    if (S.over) {
        if (onlineMode) await pushStateToFirebase();
        return;
    }
    // Ability use costs your turn — advance to next player
    let next = (S.current + 1) % PCOLORS.length;
    let guard = 0;
    while (S.eliminated[next] && guard++ < PCOLORS.length)
        next = (next + 1) % PCOLORS.length;
    if (next <= S.current) {
        S.turn = (S.turn || 0) + 1;
        // NOTE: frozen/surge decrements and meter bonuses are handled by advanceTurn only.
        // nrFinishAbilityTurn must NOT also decrement them — that would double-count.
    }
    S.current = next;
    if (S.nrIceWall)     S.nrIceWall[S.current]     = false;
    if (S.nrStaticField) S.nrStaticField[S.current]  = false;
    // Blackout: skip immediately if the next player is blacked out
    if (nuclearMode && S.nrBlackout && S.nrBlackout[S.current]) {
        S.nrBlackout[S.current] = false;
        // Advance one more time
        let skip = (S.current + 1) % PCOLORS.length, gs = 0;
        while (S.eliminated[skip] && gs++ < PCOLORS.length) skip = (skip + 1) % PCOLORS.length;
        // Handle round boundary
        if (skip <= S.current) {
            S.turn = (S.turn || 0) + 1;
        }
        S.current = skip;
        if (S.nrIceWall)     S.nrIceWall[S.current]     = false;
        if (S.nrStaticField) S.nrStaticField[S.current]  = false;
    }
    markAllDirty(); renderAll();
    S.animating = false;
    syncUndoBtn();
    startPlayerTimer();
    // NOTE: nrProcessTurnStartCells (ignite/frozen) is intentionally NOT called here.
    // Ignite fires at the start of the next player's turn via handleClick, giving a full
    // turn of delay — calling it here would fire ignite immediately after the ability.
    if (onlineMode) {
        S.pendingMove = null;
        if (!S.over) S.turnDeadline = serverNow() + TURN_TIMER_MS;
        await pushStateToFirebase();
        updateOnlineInteractivity();
    } else if (IS_AI[S.current]) {
        scheduleAiTurn();
    } else {
        setGridInteractive(true);
    }
}

/* ── Turn-start: process ignite auto-explosions ── */
async function nrProcessTurnStartCells(session) {
    if (!nuclearMode) return;
    let hasIgnite = false;
    for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) {
            const cell = S.grid[r][c];
            if (cell.ignite > 0) {
                cell.ignite--;
                // Set spread color — use igniteOwner (Napalm) if set, otherwise current owner
                const fireOwner = cell.igniteOwner >= 0 ? cell.igniteOwner : cell.owner;
                cell._airstrikeOwner = fireOwner;
                // Pre-fill to critMass so chainReact can actually explode it
                const cm = critMass(r, c);
                if (cell.count < cm) {
                    // Add orbs to whoever currently "owns" the count for orbCount tracking
                    const countOwner = cell.owner >= 0 ? cell.owner : fireOwner;
                    S.orbCount[countOwner] += (cm - cell.count);
                    cell.count = cm;
                    if (cell.owner < 0) cell.owner = countOwner;
                }
                // Clear igniteOwner when fully consumed
                if (cell.ignite === 0) cell.igniteOwner = -1;
                hasIgnite = true;
                chainCandidates.add(r * 100 + c);
                markDirty(r, c);
            }
        }
    }
    if (hasIgnite) {
        S.animating = true;
        try { await chainReact(session); } catch (e) { return; }
        S.animating = false;
        if (!S.over) checkEliminationsAndWin();
        renderAll();
    }
}

/* ── Hook into chainReact: frozen cells can't receive orbs ── */
/* This patches the orb-spread to skip frozen cells and handle infect/backdraft marks */
/* Note: Ice Wall immunity (S.nrIceWall) and Backdraft/Firestorm are phase-2 chain hooks */

/* ── Setup toggle ── */
function setNuclearMode(on) {
    nuclearMode = on;
}

/* ══════════════════════════════════════════════════════════════════
   FLYING ORB ANIMATIONS
   ══════════════════════════════════════════════════════════════════ */
function spawnFlyingOrbs(unstable) {
    // Batch all rect reads first to avoid interleaved layout thrashing
    const orbData = [];
    unstable.forEach(([r, c]) => {
        const srcEl = cellEl(r, c); if (!srcEl) return;
        const srcRect = srcEl.getBoundingClientRect();
        const col = PCOLORS[S.grid[r][c].owner];
        const sz = Math.max(6, Math.min(Math.floor(srcRect.width * 0.22), 14));
        const sx = srcRect.left + srcRect.width / 2, sy = srcRect.top + srcRect.height / 2;
        neighbors(r, c).forEach(([nr, nc]) => {
            const dstEl = cellEl(nr, nc); if (!dstEl) return;
            const dstRect = dstEl.getBoundingClientRect();
            orbData.push({ col, sz, sx, sy, dx: dstRect.left + dstRect.width / 2, dy: dstRect.top + dstRect.height / 2 });
        });
    });
    // Now create and animate all DOM nodes in one pass
    orbData.forEach(({ col, sz, sx, sy, dx, dy }) => {
        const fly = makeFlyOrbEl(col, sz);
        fly.style.left = `${sx}px`; fly.style.top = `${sy}px`;
        fly.style.transition = `left ${FLY_MS}ms cubic-bezier(.25,.46,.45,.94), top ${FLY_MS}ms cubic-bezier(.25,.46,.45,.94), transform ${FLY_MS}ms`;
        document.body.appendChild(fly);
        requestAnimationFrame(() => requestAnimationFrame(() => {
            fly.style.left = `${dx}px`; fly.style.top = `${dy}px`;
            fly.style.transform = 'translate(-50%,-50%) scale(1.25)';
        }));
        setTimeout(() => { fly.style.transform = 'translate(-50%,-50%) scale(0)'; setTimeout(() => fly.remove(), 100); }, FLY_MS);
    });
}

/* ══════════════════════════════════════════════════════════════════
   CHAIN REACTION ENGINE
   ══════════════════════════════════════════════════════════════════ */
async function chainReact(session) {
    while (true) {
        if (S.over) break;
        if (session !== undefined && session !== gameSession) throw new Error('stale');
        // Use candidate set instead of full grid scan
        if (!chainCandidates.size) break;
        const unstable = [];
        for (const key of chainCandidates) {
            const r = (key / 100) | 0, c = key % 100;
            if (S.grid[r][c].count >= critMass(r, c)) unstable.push([r, c]);
        }
        chainCandidates = new Set();
        if (!unstable.length) break;

        comboCount++;
        showCombo(comboCount, PCOLORS[S.current]);
        if (comboCount > matchStats.maxCombo) { matchStats.maxCombo = comboCount; matchStats.maxComboPlayer = S.current; }
        // Nuclear mode: fill meter proportional to combo depth
        if (nuclearMode && S.nrMeter) {
            // Underdog Multiplier: 1.5× if player had fewer orbs than every opponent at round start
            const snapOrbs = _nrRoundStartOrbs.length ? _nrRoundStartOrbs : S.orbCount;
            const mySnap = snapOrbs[S.current] || 0;
            const isUnderdog = !S.eliminated[S.current] && S.orbCount.every((_, i) =>
                i === S.current || S.eliminated[i] || mySnap < (snapOrbs[i] || 0));
            const multiplier = isUnderdog ? 1.5 : 1;
            const gain = Math.round(comboCount * NR_METER_PER_COMBO * multiplier);
            S.nrMeter[S.current] = Math.min(NR_METER_MAX, (S.nrMeter[S.current] || 0) + gain);
        }
        // Passive Surge: if active (counter > 0) and 5+ chain, Voltage gets a free extra turn
        if (nuclearMode && comboCount === 5) {
            const charIdx = ALL_COLORS.indexOf(PCOLORS[S.current]);
            if (charIdx >= 0 && NR_CHARS[charIdx].name === 'Voltage'
                && S.nrSurge && S.nrSurge[S.current] > 0
                && S._nrSurgeUsedThisTurn < 2) {
                S._nrSurgeFreeThisTurn = true;
                S._nrSurgeUsedThisTurn++; // max 2 free turns per turn
                let surgeEl = document.getElementById('nr-surge-label');
                if (!surgeEl) {
                    surgeEl = document.createElement('div');
                    surgeEl.id = 'nr-surge-label';
                    surgeEl.className = 'nr-surge-label';
                    document.getElementById('grid-and-combo')?.appendChild(surgeEl);
                }
                surgeEl.textContent = 'Surge!';
                surgeEl.style.color = PCOLORS[S.current];
                surgeEl.classList.remove('nr-surge-visible');
                void surgeEl.offsetWidth;
                surgeEl.classList.add('nr-surge-visible');
                setTimeout(() => surgeEl.classList.remove('nr-surge-visible'), 1800);
            }
        }

        unstable.forEach(([r, c]) => {
            const el = cellEl(r, c); if (!el) return;
            el.classList.remove('pop'); el.classList.add('pop');
            const col = PCOLORS[S.grid[r][c].owner];
            if (!lowGfx) {
            const rip = document.createElement('div');
            rip.className = 'ripple';
            rip.style.cssText = `width:${el.offsetWidth * .45}px;height:${el.offsetWidth * .45}px;background:${col}44;border:1.5px solid ${col};`;
            el.appendChild(rip); setTimeout(() => rip.remove(), 450);
            }
        });
        if (window.sfxExplode) sfxExplode(unstable.length);
        triggerHaptic(22);

        triggerShake(comboCount, unstable.length);
        pulseAmbient(PCOLORS[S.current], comboCount + unstable.length);
        spawnFlyingOrbs(unstable);
        await sessionDelay(FLY_MS + 20, session ?? gameSession);

        if (session !== undefined && session !== gameSession) throw new Error('stale');

        unstable.forEach(([r, c]) => {
            const cell = S.grid[r][c], cm = critMass(r, c);
            // Airstrike overrides spread color; Infect hijacks it
            let spreadOwner = (nuclearMode && cell._airstrikeOwner != null)
                ? cell._airstrikeOwner
                : (nuclearMode && cell.infect >= 0) ? cell.infect : cell.owner;
            cell._airstrikeOwner = null; // consume
            cell.infect = -1; // consume
            const owner = cell.owner;
            // _cryoFrozen: when this cell explodes, leave 1 orb for spreadOwner instead of emptying
            const leaveCryo = nuclearMode && cell._cryoFrozen;
            cell._cryoFrozen = false;
            cell._absZeroFrozen = false;
            cell.frozen = 0;
            cell.frozenBy = -1;
            cell.count -= cm; S.orbCount[owner] -= cm;
            if (leaveCryo && cell.count <= 0) {
                cell.count = 1; cell.owner = spreadOwner; S.orbCount[spreadOwner]++;
            } else if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }
            else if (cell.count >= critMass(r, c)) chainCandidates.add(r * 100 + c);
            markDirty(r, c);

            const allNeighbors = neighbors(r, c);
            allNeighbors.forEach(([nr, nc]) => {
                const ncell = S.grid[nr][nc];
                // Frozen cells block incoming orbs — EXCEPT when Cryo's own chain reaches
                // a _cryoFrozen cell they placed: receive the orb normally, lift the freeze
                if (nuclearMode && ncell.frozen > 0) {
                    if (ncell._cryoFrozen && ncell.frozenBy === spreadOwner) {
                        // Lift the freeze — keep _cryoFrozen so the explosion step
                        // knows to leave 1 orb behind when this cell detonates
                        ncell.frozen = 0;
                        ncell.frozenBy = -1;
                        ncell._absZeroFrozen = false;
                    } else {
                        return; // all other frozen cells still block
                    }
                }
                // Static Field: incoming orbs into Voltage's cells are absorbed without converting
                if (nuclearMode && S.nrStaticField && ncell.owner !== -1 && ncell.owner !== spreadOwner && S.nrStaticField[ncell.owner]) {
                    // Orb lands but ownership doesn't change — absorbed silently
                    ncell.count++; S.orbCount[ncell.owner]++;
                    markDirty(nr, nc);
                    if (ncell.count >= critMass(nr, nc)) chainCandidates.add(nr * 100 + nc);
                    const nel = cellEl(nr, nc);
                    if (nel) { nel.classList.remove('ping'); nel.classList.add('ping'); }
                    return;
                }
                // Ember (Napalm): if an enemy chain tries to convert an Ember-marked own cell,
                // it explodes in the owner's color instead of converting — backdraft is NOT
                // consumed here so it fires for every hit this round; it clears at round end.
                if (nuclearMode && ncell.backdraft >= 0 && ncell.backdraft === ncell.owner && ncell.owner !== spreadOwner) {
                    // Detonate in place — consume the mark so it fires exactly once per trigger
                    ncell.backdraft = -1;
                    ncell.count++;
                    S.orbCount[ncell.owner]++;
                    if (ncell.count >= critMass(nr, nc)) chainCandidates.add(nr * 100 + nc);
                    markDirty(nr, nc);
                    const nel = cellEl(nr, nc);
                    if (nel) { nel.classList.remove('ping'); nel.classList.add('ping'); }
                    return; // skip normal conversion
                }
                // Ice Wall: own cells cannot be converted
                if (nuclearMode && S.nrIceWall && ncell.owner !== -1 && ncell.owner !== spreadOwner && S.nrIceWall[ncell.owner]) return;
                // Ignite lock: cell is untouchable — block all incoming orbs from any source
                if (nuclearMode && ncell.ignite > 0) return;
                if (ncell.owner !== -1 && ncell.owner !== spreadOwner) { S.orbCount[ncell.owner] -= ncell.count; S.orbCount[spreadOwner] += ncell.count; ncell.owner = spreadOwner; }
                else if (ncell.owner === -1) { ncell.owner = spreadOwner; }
                ncell.count++; S.orbCount[spreadOwner]++;
                markDirty(nr, nc);
                if (ncell.count >= critMass(nr, nc)) chainCandidates.add(nr * 100 + nc);
                const nel = cellEl(nr, nc);
                if (nel) { nel.classList.remove('ping'); nel.classList.add('ping'); }
            });
        });

        updateGainBadge(S.current, S.orbCount[S.current] - turnOrbsBefore);
        if (checkEliminationsAndWin()) break;

        markAllDirty(); renderAll();
        await sessionDelay(SETTLE_MS, session ?? gameSession);
    }
}

/* ══════════════════════════════════════════════════════════════════
   ELIMINATION + WIN
   ══════════════════════════════════════════════════════════════════ */
function checkEliminationsAndWin() {
    if (!S.hasMoved.every(Boolean)) return false;
    for (let i = 0; i < PCOLORS.length; i++) {
        if (!S.eliminated[i] && S.orbCount[i] <= 0) {
            S.eliminated[i] = true;
            // Desperation Meter: distribute eliminated player's meter to survivors below the leader
            if (nuclearMode && S.nrMeter && S.nrMeter[i] > 0) {
                nrDistributeMeter(i);
            }
        }
    }
    const survivors = S.eliminated.map((e, i) => !e ? i : -1).filter(i => i >= 0);
    if (survivors.length === 1) {
        S.over = true; markAllDirty(); renderAll(); showWin(survivors[0]); return true;
    }
    return false;
}

/* ── Desperation Meter: distribute a eliminated player's meter to survivors below the leader ── */
function nrDistributeMeter(eliminatedIdx) {
    if (!S.nrMeter) return;
    const meter = S.nrMeter[eliminatedIdx];
    if (meter <= 0) return;
    S.nrMeter[eliminatedIdx] = 0;
    // Find the leader's orb count among survivors
    const survivors = S.orbCount.filter((_, i) => !S.eliminated[i]);
    if (!survivors.length) return;
    const maxOrbs = Math.max(...survivors);
    // Recipients: alive players who have fewer orbs than the leader
    const recipients = [];
    for (let i = 0; i < PCOLORS.length; i++) {
        if (!S.eliminated[i] && S.orbCount[i] < maxOrbs) recipients.push(i);
    }
    // If everyone is tied (no one below leader) give to all survivors
    const targets = recipients.length ? recipients : S.orbCount.map((_, i) => !S.eliminated[i] ? i : -1).filter(i => i >= 0);
    const share = Math.floor(meter / targets.length);
    if (share <= 0) return;
    for (const i of targets) {
        S.nrMeter[i] = Math.min(NR_METER_MAX, (S.nrMeter[i] || 0) + share);
    }
}
function undoOrToggleChat() {
    if (onlineMode) {
        toggleChat();
        syncUndoBtn();
    } else {
        undoMove();
    }
}

function undoMove() {
    if (history.length === 0 || S.animating || onlineMode) return;
    // If in NR targeting mode, exit targeting then undo the ability that started it
    // (the ability pushed to history just before entering targeting).
    if (_nrTargeting) nrExitTargeting();
    // Pop back past all consecutive AI moves so the human gets to re-decide.
    // We stop as soon as the state belongs to a human player's turn.
    do {
        S = history.pop();
    } while (history.length > 0 && IS_AI[S.current]);
    for (let i = 0; i < PCOLORS.length; i++) updateGainBadge(i, 0);
    hideCombo(true);
    markAllDirty(); renderAll();
    syncUndoBtn();
    setGridInteractive(!IS_AI[S.current]);
    if (IS_AI[S.current]) scheduleAiTurn();
}



/* ══════════════════════════════════════════════════════════════════
   GAME SUMMARY SCREEN
   ══════════════════════════════════════════════════════════════════ */
function showSummary(winnerIdx) {
    const el = document.getElementById('summary-panel');
    if (!el) return;
    const wc = PCOLORS[winnerIdx] || '#ffffff';
    el.style.border = `1px solid ${wc}66`;
    document.getElementById('sum-turns').textContent = (S.turn || 0) + 1;
    const mcp = matchStats.maxComboPlayer;
    if (matchStats.maxCombo > 0 && mcp >= 0) {
        document.getElementById('sum-combo').textContent = matchStats.maxCombo + 'x';
        const nameEl = document.getElementById('sum-combo-who');
        nameEl.textContent = 'by ' + (PNAMES[mcp] || '');
        nameEl.style.color  = PCOLORS[mcp] || '#fff';
    } else {
        document.getElementById('sum-combo').textContent = '—';
        document.getElementById('sum-combo-who').textContent = '';
    }
    el.style.display = 'flex';
}

/* ══════════════════════════════════════════════════════════════════
   WIN
   ══════════════════════════════════════════════════════════════════ */
function showWin(idx) {
    const col = PCOLORS[idx];
    const wn = document.getElementById('wname');
    const aiTag = IS_AI[idx] ? ' (AI)' : '';
    wn.textContent = `${PNAMES[idx]}${aiTag} wins!`;
    wn.style.color = col;
    wn.style.textShadow = `0 0 28px ${col}`;
    const box = document.getElementById('win-box');
    box.style.border = `1px solid ${col}77`;
    box.style.boxShadow = `0 0 36px ${col}33`;
    document.getElementById('win-overlay').classList.add('show');
    if (window.sfxWin) sfxWin();
    triggerHaptic([60, 40, 120]);
    showSummary(idx);
    // Grey out rematch if someone disconnected during the game
    const rematchBtn = document.getElementById('rematch-btn');
    if (rematchBtn && onlineMode) {
        const disabled = !!window._playerDisconnectedThisGame;
        rematchBtn.disabled = disabled;
        rematchBtn.title = disabled ? 'A player left — rematch unavailable' : '';
    }
}

/* ══════════════════════════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════════════════════════ */
function onRematchClick() {
    if (onlineMode) {
        proposeRematch();
    } else {
        restartGame();
    }
}

function restartGame() {
    document.getElementById('win-overlay').classList.remove('show');
    const sp = document.getElementById('summary-panel'); if (sp) sp.style.display = 'none';
    closeRematchOverlay();

    if (onlineMode) {
        leaveRoom();
        return;
    }

    history = [];
    resetMatchStats();
    for (let i = 0; i < PCOLORS.length; i++) updateGainBadge(i, 0);
    hideCombo(true);
    initState();
    buildGridDOM();
    buildPlayerStrip();
    markAllDirty(); renderAll();
    syncUndoBtn();
    if (IS_AI[0]) scheduleAiTurn();
    else setGridInteractive(true);
    startPlayerTimer();
}


/* ══════════════════════════════════════════════════════════════════
   ONLINE REMATCH
   ══════════════════════════════════════════════════════════════════ */
let _rematchListener = null;

function proposeRematch() {
    if (!roomRef || !onlineMode) return;
    showRematchOverlay('Waiting for all players…', false);
    // Write own vote
    roomRef.child(`rematch/${myPlayerIndex}`).set('yes');
    // Listen for all votes
    listenRematchVotes();
}

function voteRematch(accept) {
    if (!roomRef) return;
    roomRef.child(`rematch/${myPlayerIndex}`).set(accept ? 'yes' : 'no');
    if (!accept) {
        // Decline immediately visible to all via Firebase listener
        closeRematchOverlay();
    }
}

function listenRematchVotes() {
    if (!roomRef) return;
    if (_rematchListener) return; // already attached
    const ref = roomRef.child('rematch');
    _rematchListener = ref.on('value', snap => {
        const votes = snap.val() || {};
        const numPlayers = PCOLORS.length;
        const allVoted = Object.keys(votes).length >= numPlayers;
        const anyNo = Object.values(votes).includes('no');
        const allYes = allVoted && !anyNo;

        // Update status list
        const lines = [];
        for (let i = 0; i < numPlayers; i++) {
            const v = votes[i];
            const icon = v === 'yes' ? '✓' : v === 'no' ? '✗' : '…';
            lines.push(`<span style="color:${PCOLORS[i]}">${PNAMES[i]}</span> ${icon}`);
        }
        const statusEl = document.getElementById('rematch-status');
        if (statusEl) statusEl.innerHTML = lines.join('<br>');

        if (anyNo) {
            // Find who declined
            const decliner = Object.entries(votes).find(([,v]) => v === 'no');
            const name = decliner ? (PNAMES[parseInt(decliner[0])] || 'A player') : 'A player';
            stopRematchListener();
            if (roomRef) roomRef.child('rematch').remove().catch(()=>{});
            closeRematchOverlay();
            showRematchToast(`${name} declined the rematch.`);
            return;
        }

        if (allYes) {
            stopRematchListener();
            if (roomRef) roomRef.child('rematch').remove().catch(()=>{});
            closeRematchOverlay();
            if (isHost) {
                doOnlineRematch();
            }
            // Non-hosts wait for new state via the existing state listener
            return;
        }

        // Show prompt to players who haven't voted yet
        if (!votes[myPlayerIndex]) {
            const proposer = Object.entries(votes).find(([,v]) => v === 'yes');
            const pName = proposer ? (PNAMES[parseInt(proposer[0])] || 'Someone') : 'Someone';
            showRematchOverlay(`${pName} wants a rematch!`, true);
        }
    });
    onlineListeners.push({ ref, listener: _rematchListener, event: 'value' });
}

async function doOnlineRematch() {
    if (!isHost || !roomRef) return;
    window._playerDisconnectedThisGame = false;
    resetMatchStats();

    // CRITICAL: save the current moveSeq BEFORE we restore history[0],
    // so the sequence never resets to 1 and all clients' seq guards keep working.
    const currentSeq = S.moveSeq || 0;

    // Restore the pre-first-move state (history[0]) — blank board, turn 0.
    // If nobody moved yet (history empty), fall back to initState.
    if (history.length > 0) {
        S = history[0];
    } else {
        initState();
    }
    history = [];
    S.animating = false;
    S.over = false;
    S.moveSeq = currentSeq; // restore sequence so serializeState increments from here
    // Reset per-player timers to full for the new game
    playerTimers = timedMode ? new Array(PCOLORS.length).fill(timedSeconds * 1000) : [];
    // Reset Nuclear Reaction per-player state
    if (nuclearMode && S.nrMeter) {
        const np = PCOLORS.length;
        S.nrMeter       = new Array(np).fill(0);
        S.nrAbilityIdx  = new Array(np).fill(0);
        S.nrBlackout    = new Array(np).fill(false);
        S.nrSurge       = new Array(np).fill(0);
        S.nrIceWall     = new Array(np).fill(false);
        S.nrFirestorm   = new Array(np).fill(false);
        S.nrStaticField = new Array(np).fill(false);
    }

    // Close win screen
    document.getElementById('win-overlay').classList.remove('show');
    const sp = document.getElementById('summary-panel'); if (sp) sp.style.display = 'none';
    buildGridDOM();
    buildPlayerStrip();
    hideCombo(true);
    markAllDirty(); renderAll();
    syncUndoBtn();

    // Serialize with rematch:true flag — moveSeq continues from currentSeq+1
    const payload = serializeState(S);
    payload.rematch = true;
    S.moveSeq = payload.moveSeq; // keep host's local seq in sync

    await roomRef.child('state').set(payload);
    await roomRef.child('status').set('playing');
    S.turnDeadline = serverNow() + TURN_TIMER_MS;
    startPlayerTimer();
    updateOnlineInteractivity();
}

function stopRematchListener() {
    if (_rematchListener && roomRef) {
        const cb = _rematchListener;
        roomRef.child('rematch').off('value', cb);
        onlineListeners = onlineListeners.filter(l => l.listener !== cb);
    }
    _rematchListener = null;
}

let _rematchCountdown = null;

function showRematchOverlay(msg, showBtns) {
    const overlay = document.getElementById('rematch-overlay');
    const msgEl   = document.getElementById('rematch-msg');
    const btnsEl  = document.getElementById('rematch-btns');
    if (!overlay) return;
    if (msgEl) msgEl.textContent = msg;
    if (btnsEl) btnsEl.style.display = showBtns ? 'flex' : 'none';
    overlay.classList.add('show');
    if (showBtns) startRematchCountdown();
    else stopRematchCountdown();
}

function startRematchCountdown() {
    stopRematchCountdown();
    let secs = 10;
    const timerEl = document.getElementById('rematch-timer');
    if (timerEl) timerEl.textContent = `Auto-declining in ${secs}s`;
    _rematchCountdown = setInterval(() => {
        secs--;
        if (timerEl) timerEl.textContent = secs > 0 ? `Auto-declining in ${secs}s` : 'Declining…';
        if (secs <= 0) {
            stopRematchCountdown();
            voteRematch(false);
        }
    }, 1000);
}

function stopRematchCountdown() {
    if (_rematchCountdown) { clearInterval(_rematchCountdown); _rematchCountdown = null; }
    const timerEl = document.getElementById('rematch-timer');
    if (timerEl) timerEl.textContent = '';
}

function closeRematchOverlay() {
    stopRematchCountdown();
    const overlay = document.getElementById('rematch-overlay');
    if (overlay) overlay.classList.remove('show');
    const statusEl = document.getElementById('rematch-status');
    if (statusEl) statusEl.innerHTML = '';
}

function showRematchToast(msg) {
    let toast = document.getElementById('rematch-toast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'rematch-toast';
        toast.className = 'cr-toast host-left-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = msg;
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
}

function goSetup() {
    if (onlineMode) {
        leaveRoom(); // handles disconnect signal + cleanup
        return;
    }
    gameSession++; // invalidate any in-flight AI turns, chain reactions, delays
    document.getElementById('win-overlay').classList.remove('show');
    document.getElementById('game').style.display = 'none';
    document.getElementById('online-lobby').classList.remove('show');
    document.getElementById('setup').style.display = 'flex';
    if (window.moveMusicPlayer) window.moveMusicPlayer('setup');

    releaseWakeLock();
    stopPlayerTimer();
    nrExitTargeting();
    // Fully clear surge label
    const surgeLabel = document.getElementById('nr-surge-label');
    if (surgeLabel) {
        surgeLabel.classList.remove('nr-surge-visible');
        surgeLabel.textContent = '';
    }
    // Cancel any running canvas animations
    if (_nrRafId) { cancelAnimationFrame(_nrRafId); _nrRafId = null; }
    _nrAnimations = [];
    if (_nrCtx && _nrCanvas) _nrCtx.clearRect(0, 0, _nrCanvas.width, _nrCanvas.height);
    nuclearMode = false;
    const nmToggle = document.getElementById('nuclear-mode-toggle');
    if (nmToggle) nmToggle.classList.remove('on');
    history = [];
    hideCombo(true);
    ballModes.fill(0);
    ballOrder.length = 0;
    ballColors.forEach((_, i) => { ballColors[i] = ALL_COLORS[i]; });
    syncBallGrid();
}

let _newGameConfirmTimer = null;
function confirmNewGame(btn) {
    if (btn.dataset.confirming === '1') {
        // Confirmed — clear timer and go
        clearTimeout(_newGameConfirmTimer);
        btn.dataset.confirming = '';
        btn.textContent = btn.dataset.origText || 'New Game';
        btn.classList.remove('confirm-danger');
        goSetup();
        return;
    }
    // First press — enter confirm state
    btn.dataset.origText = btn.textContent;
    btn.dataset.confirming = '1';
    btn.textContent = 'Confirm?';
    btn.classList.add('confirm-danger');
    // Auto-reset after 3 seconds if not confirmed
    _newGameConfirmTimer = setTimeout(() => {
        btn.dataset.confirming = '';
        btn.textContent = btn.dataset.origText || 'New Game';
        btn.classList.remove('confirm-danger');
    }, 3000);
}

/* ══════════════════════════════════════════════════════════════════
   COLOR UTILS
   ══════════════════════════════════════════════════════════════════ */
function hexToRgb(h) {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}
function lighten(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgb(${Math.min(255, r + Math.round((255 - r) * a))},${Math.min(255, g + Math.round((255 - g) * a))},${Math.min(255, b + Math.round((255 - b) * a))})`;
}
function darken(hex, a) {
    const [r, g, b] = hexToRgb(hex);
    return `rgb(${Math.round(r * (1 - a))},${Math.round(g * (1 - a))},${Math.round(b * (1 - a))})`;
}

/* ══════════════════════════════════════════════════════════════════
   RESPONSIVE
   ══════════════════════════════════════════════════════════════════ */
/* ── Android keyboard dismiss ── */
(function () {
    const lobby = document.getElementById('online-lobby');
    if (!lobby) return;
    lobby.addEventListener('touchstart', function (e) {
        const active = document.activeElement;
        if (!active || active.tagName !== 'INPUT') return;
        if (!active.contains(e.target) && active !== e.target) active.blur();
    }, { passive: true });
})();


/* ══════════════════════════════════════════════════════════════════
   BACK BUTTON / LEAVE CONFIRM
   ══════════════════════════════════════════════════════════════════ */
(function () {
    // Push a dummy history entry so we intercept the Android/browser back gesture
    if (window.history && window.history.pushState) {
        window.history.pushState({ cr: true }, '');
    }
    window.addEventListener('popstate', function () {
        handleBackButton();
        if (window.history && window.history.pushState) {
            window.history.pushState({ cr: true }, '');
        }
    });
    // Capacitor Android native back button
    document.addEventListener('backbutton', function (e) {
        if (e && e.preventDefault) e.preventDefault();
        handleBackButton();
    }, false);
})();

function handleBackButton() {
    const game   = document.getElementById('game');
    const lobby  = document.getElementById('online-lobby');
    const inGame = game && game.style.display !== 'none';
    const inLobby = lobby && lobby.classList.contains('show');

    if (inGame && !S.over) {
        const msg = onlineMode
            ? 'Leave the game? You will disconnect from the room.'
            : 'Leave the game? Your progress will be lost.';
        if (window.confirm(msg)) {
            if (onlineMode) leaveRoom();
            else goSetup();
        }
    } else if (inGame && S.over) {
        goSetup();
    } else if (inLobby) {
        leaveRoom();
    }
}

/* ── Apply saved settings on load ── */
(function () {
    function go() { applySettings(loadSettings()); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
})();

let rTimer;
window.addEventListener('resize', () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => {
        if (document.getElementById('game').style.display !== 'none') {
            buildGridDOM(); markAllDirty(); renderAll();
        }
    }, 200);
});
