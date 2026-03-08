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
let comboHideTimer = null;

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
let myUsername = sessionStorage.getItem('cr_username') || '';
let _onlineTurnTimerInterval = null;
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
        const slot = document.getElementById(`bs${i}`);
        const num = document.getElementById(`bn${i}`);
        const label = document.getElementById(`bl${i}`);
        const mode = ballModes[i];
        const pos = ballOrder.indexOf(i);
        slot.className = 'ball-slot ' + (mode === 1 ? 'mode-player' : mode === 2 ? 'mode-ai' : mode === 3 ? 'mode-hard-ai' : '');
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
function showOlPanel(id) {
    ['ol-username', 'ol-mode', 'ol-create', 'ol-join-panel', 'ol-waiting', 'ol-random-join'].forEach(p => {
        const el = document.getElementById(p);
        if (el) el.style.display = p === id ? 'flex' : 'none';
    });
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
            numPlayers: onlineNumPlayers
        },
        slots: { 0: { uid: myUid, joined: true, name: myUsername } },
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
    await roomRef.child(`slots/${assignedSlot}`).set({ uid: myUid, joined: true, name: myUsername });

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

        await roomRef.child(`slots/${pick.openSlot}`).set({ uid: myUid, joined: true, name: myUsername });

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
function enterWaitingRoom() {
    showOlPanel('ol-waiting');
    document.getElementById('ol-code-text').textContent = roomCode;
    document.getElementById('ol-start-btn').style.display = isHost ? '' : 'none';
    document.getElementById('ol-host-hint').style.display = isHost ? 'none' : '';

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
        if (room.status === 'playing' && room.state) {
            stopRoomListeners();
            launchOnlineGame(room);
        }
    });
    onlineListeners.push({ ref: roomRef, listener, event: 'value' });
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
        div.style.setProperty('--slot-color', col);
        div.innerHTML = `
            <div class="ol-slot-dot ${filled ? 'filled' : ''}" style="color:${col}; background:${filled ? col : 'transparent'}"></div>
            <span style="color:${filled ? col : 'var(--dim)'}">
              ${slotName}${isMe ? '' : filled ? ' — joined' : ' — waiting…'}
            </span>
            ${isMe ? '<span class="ol-me-tag">You</span>' : ''}`;
        list.appendChild(div);
    }

    document.getElementById('ol-status').textContent = `${numJoined} / ${numNeeded} players joined`;
    document.getElementById('ol-status-sub').textContent =
        numJoined >= numNeeded ? 'Room is full — host can start' : 'Waiting for players…';

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

    PCOLORS = Array.from({ length: actualCount }, (_, i) => ALL_COLORS[i]);
    PNAMES = Array.from({ length: actualCount }, (_, i) => slots[i]?.name || ALL_NAMES[i]);
    IS_AI = new Array(actualCount).fill(false);
    cfg = { rows: room.config.rows, cols: room.config.cols };

    history = [];
    initState();
    // turnDeadline is derived from Firebase server timestamp on deserialize — no local clock needed

    // Store player names in room so all clients can read them
    await roomRef.child('config/playerNames').set(PNAMES);

    // Push initial state then flip status to 'playing'
    await roomRef.child('state').set(serializeState(S));
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
        // In lobby as guest — just mark left
        try { roomRef.child(`slots/${myPlayerIndex}/left`).set(true); } catch (e) { /* ignore */ }
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

/* ── Handle a player disconnect: eliminate them, wipe orbs, advance turn ── */
function handlePlayerDisconnect(playerIndex) {
    if (!S || S.over) return;
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

    // Check win condition
    const survivors = S.eliminated.map((e, i) => !e ? i : -1).filter(i => i >= 0);
    if (survivors.length === 1) {
        S.over = true;
        renderAll();
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

    renderAll();
    if (onlineMode) {
        pushStateToFirebase();
        updateOnlineInteractivity();
    }
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
    PCOLORS = Array.from({ length: np }, (_, i) => ALL_COLORS[i]);
    const storedNames = room.config.playerNames ? Object.values(room.config.playerNames) : [];
    PNAMES = Array.from({ length: np }, (_, i) => storedNames[i] || ALL_NAMES[i]);
    IS_AI = new Array(np).fill(false);
    IS_HARD_AI = new Array(np).fill(false);
    cfg = { rows: room.config.rows, cols: room.config.cols };

    document.getElementById('online-lobby').classList.remove('show');
    document.getElementById('game').style.display = 'flex';
    if (window.moveMusicPlayer) window.moveMusicPlayer('game');

    S = deserializeState(room.state);
    window._orbAnimEpoch = Date.now();
    history = [];
    buildGridDOM();
    buildPlayerStrip();
    hideCombo(true);
    renderAll();
    syncUndoBtn();
    updateOnlineInteractivity();
    setupChat();

    // Track last applied move sequence to avoid duplicates (clock-skew-proof)
    let lastSeenMoveSeq = room.state?.moveSeq ?? 0;

    // Listen for state changes (other players' moves)
    const stateRef = roomRef.child('state');
    const stateListener = stateRef.on('value', snap => {
        if (!snap.exists() || S.animating) return;
        const data = snap.val();
        if (!data) return;
        const seq = data.moveSeq ?? 0;
        if (seq <= lastSeenMoveSeq) return;
        lastSeenMoveSeq = seq;
        // Skip our own echo — we already animated locally
        if (data.writerUid === myUid) return;
        // If the remote state includes the move coords, animate it; otherwise just snap
        if (data.move && data.move.r != null && data.move.c != null) {
            playRemoteMove(data.move.r, data.move.c, data);
        } else {
            S = deserializeState(data);
            renderAll();
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
        handlePlayerDisconnect(pi);
        // Clear the disconnect signal so it doesn't re-fire on reconnect
        if (isHost) roomRef.child('disconnected').remove().catch(() => {});
    });
    onlineListeners.push({ ref: discRef, listener: discListener, event: 'value' });
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

    // Prefer cells we already own (near-critical first), otherwise any empty cell
    const candidates = [];
    for (let r = 0; r < cfg.rows; r++) {
        for (let c = 0; c < cfg.cols; c++) {
            const cell = S.grid[r][c];
            if (cell.owner !== -1 && cell.owner !== myPlayerIndex) continue;
            const priority = cell.owner === myPlayerIndex
                ? critMass(r, c) - cell.count  // lower gap = higher priority
                : 99;
            candidates.push({ r, c, priority });
        }
    }
    if (!candidates.length) return;

    candidates.sort((a, b) => a.priority - b.priority);
    const { r, c } = candidates[0];

    // Announce in chat
    if (roomRef) {
        roomRef.child('chat').push({
            system: true,
            text: `⏱ ${PNAMES[myPlayerIndex]} ran out of time — move was forced!`
        }).catch(() => {});
    }

    handleClick(r, c);
}



/* ══════════════════════════════════════════════════════════════════
   SCREEN SHAKE
   ══════════════════════════════════════════════════════════════════ */
function triggerShake(comboStep, unstableCount) {
    if (comboStep < 3 && unstableCount < 4) return;
    const grid = document.getElementById('grid-and-combo');
    if (!grid) return;
    const big = comboStep >= 6 || unstableCount >= 8;
    const cls = big ? 'shake-lg' : 'shake-sm';
    grid.classList.remove('shake-sm', 'shake-lg');
    void grid.offsetWidth;
    grid.classList.add(cls);
    setTimeout(() => grid.classList.remove(cls), big ? 320 : 220);
}

/* ══════════════════════════════════════════════════════════════════
   AMBIENT LAYER
   ══════════════════════════════════════════════════════════════════ */
let _ambientFadeTimer = null;
function pulseAmbient(col, intensity) {
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
        grid: state.grid.map(row => row.map(cell => ({ o: cell.owner, c: cell.count }))),
        current: state.current,
        orbCount: state.orbCount,
        hasMoved: state.hasMoved,
        eliminated: state.eliminated,
        over: state.over,
        turn: state.turn,
        moveSeq: (state.moveSeq || 0) + 1,
        writerUid: myUid,
        move: state.pendingMove || null,
        // ts is set by Firebase server — all clients derive turnDeadline from this
        ts: firebase.database.ServerValue.TIMESTAMP
    };
}

function deserializeState(data) {
    // Firebase may coerce arrays to objects with numeric keys — handle both
    const toArr = v => Array.isArray(v) ? v : Object.values(v);
    // data.ts is set by Firebase's ServerValue.TIMESTAMP — true server time, no clock skew
    const serverWriteTime = data.ts || serverNow();
    return {
        grid: toArr(data.grid).map(row =>
            toArr(row).map(cell => ({ owner: cell.o, count: cell.c }))),
        current: data.current,
        orbCount: toArr(data.orbCount),
        hasMoved: toArr(data.hasMoved),
        eliminated: toArr(data.eliminated),
        animating: false,
        over: data.over,
        turn: data.turn || 0,
        moveSeq: data.moveSeq || 0,
        turnDeadline: data.over ? null : serverWriteTime + TURN_TIMER_MS
    };
}

/* ══════════════════════════════════════════════════════════════════
   GAME START / INIT (pass-and-play)
   ══════════════════════════════════════════════════════════════════ */
function startGame() {
    if (ballOrder.length < 2) return;
    PCOLORS = ballOrder.map(i => ALL_COLORS[i]);
    PNAMES = ballOrder.map(i => ALL_NAMES[i]);
    IS_AI = ballOrder.map(i => ballModes[i] === 2 || ballModes[i] === 3);
    IS_HARD_AI = ballOrder.map(i => ballModes[i] === 3);
    onlineMode = false;
    resetOnlineState();

    document.getElementById('setup').style.display = 'none';
    document.getElementById('game').style.display = 'flex';
    if (window.moveMusicPlayer) window.moveMusicPlayer('game');
    history = [];
    initState();
    buildGridDOM();
    buildPlayerStrip();
    hideCombo(true);
    renderAll();
    syncUndoBtn();
    if (IS_AI[0]) scheduleAiTurn();
    else setGridInteractive(true);
}

function initState() {
    gameSession++;
    window._orbAnimEpoch = Date.now();
    S = {
        grid: Array.from({ length: cfg.rows }, () =>
            Array.from({ length: cfg.cols }, () => ({ owner: -1, count: 0 }))),
        current: 0,
        orbCount: new Array(PCOLORS.length).fill(0),
        hasMoved: new Array(PCOLORS.length).fill(false),
        eliminated: new Array(PCOLORS.length).fill(false),
        animating: false,
        over: false,
        turn: 0,
        moveSeq: 0
    };
}

function cloneState() {
    return {
        grid: S.grid.map(row => row.map(cell => ({ ...cell }))),
        current: S.current,
        orbCount: [...S.orbCount],
        hasMoved: [...S.hasMoved],
        eliminated: [...S.eliminated],
        animating: false,
        over: S.over,
        turn: S.turn,
        moveSeq: S.moveSeq || 0
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
        card.innerHTML = `
      <div class="pn" style="color:${PCOLORS[i]}">${PNAMES[i]}${aiChip}${youChip}</div>
      <div class="pc-wrap">
        <span class="pc" id="porbs${i}">0</span>
        <span class="gain-badge" id="gb${i}"></span>
      </div>
      <div class="pl">orbs</div>`;
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
    num.classList.remove('bump'); void num.offsetWidth; num.classList.add('bump');
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
    countEl.classList.remove('pop-count'); void countEl.offsetWidth; countEl.classList.add('pop-count');
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
    orb.style.cssText = `
    width:${sz}px;height:${sz}px;
    background:${col};
    box-shadow:0 0 ${Math.round(sz * .9)}px 1px ${col}, 0 0 ${Math.round(sz * 2.0)}px ${col}dd, 0 0 ${Math.round(sz * 4.0)}px ${col}99;`;
    return orb;
}

/* ══════════════════════════════════════════════════════════════════
   RENDER
   ══════════════════════════════════════════════════════════════════ */
function renderAll() {
    if (!S.grid) return;
    for (let r = 0; r < cfg.rows; r++)
        for (let c = 0; c < cfg.cols; c++)
            renderCell(r, c);
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
    if (surviving <= 0) return;
    const col = PCOLORS[data.owner];
    const cellSz = el.offsetWidth || 40;
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

    if (surviving > 3) {
        const badge = document.createElement('div');
        badge.style.cssText = `position:absolute;right:2px;bottom:2px;font-size:${Math.max(8, Math.floor(cellSz * .16))}px;color:${col};font-family:'Orbitron',sans-serif;font-weight:700;text-shadow:0 0 4px ${col};pointer-events:none;line-height:1;`;
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
        // Crown: show on leader(s) with most orbs (only after first moves)
        let crownEl = card.querySelector('.pc-crown');
        const isLeader = !S.eliminated[i] && S.orbCount[i] > 0 && S.orbCount[i] === maxOrbs;
        if (isLeader) {
            if (!crownEl) {
                crownEl = document.createElement('span');
                crownEl.className = 'pc-crown';
                crownEl.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/></svg>`;
                card.appendChild(crownEl);
            }
        } else {
            if (crownEl) crownEl.remove();
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
    setTimeout(() => {
        if (mySession !== gameSession) return;
        if (S.over || !IS_AI[S.current]) return;
        const move = aiPickMove(S.current);
        if (move) handleClick(move[0], move[1]);
        else setGridInteractive(true);
    }, 350);
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
    renderAll();
    try {
        if (!willExplodeImmediately) await sessionDelay(60, mySession);
        await chainReact(mySession);
    } catch (e) { return; }

    if (mySession !== gameSession) return;
    if (!S.over) checkEliminationsAndWin();

    commitGainBadge(S.current);
    hideCombo();

    // Reconcile to authoritative final state (fixes any drift)
    const authoritative = deserializeState(finalData);
    S = authoritative;

    renderAll();
    S.animating = false;
    updateOnlineInteractivity();
}

/* ══════════════════════════════════════════════════════════════════
   CLICK HANDLER
   ══════════════════════════════════════════════════════════════════ */
async function handleClick(r, c) {
    if (S.animating || S.over) return;

    // Online mode: only allow move on your own turn
    if (onlineMode && S.current !== myPlayerIndex) return;

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
    renderAll();
    try {
        if (!willExplodeImmediately) await sessionDelay(60, mySession);
        await chainReact(mySession);
    } catch (e) { return; } // session ended — stop silently

    if (mySession !== gameSession) return;
    if (!S.over) checkEliminationsAndWin();

    commitGainBadge(S.current);
    hideCombo();

    if (S.over) {
        S.animating = false;
        syncUndoBtn();
        setGridInteractive(false);
        if (onlineMode) { await pushStateToFirebase(); S.pendingMove = null; }
        return;
    }

    // Advance to next non-eliminated player
    let next = (S.current + 1) % PCOLORS.length;
    let guard = 0;
    while (S.eliminated[next] && guard++ < PCOLORS.length)
        next = (next + 1) % PCOLORS.length;
    // Only count a new turn when we've cycled back past the start of the round
    if (next <= S.current) S.turn = (S.turn || 0) + 1;
    S.current = next;

    renderAll();
    S.animating = false;
    syncUndoBtn();

    if (onlineMode) {
        await pushStateToFirebase();
        S.pendingMove = null;
        updateOnlineInteractivity();
    } else if (IS_AI[S.current]) {
        scheduleAiTurn();
    } else {
        setGridInteractive(true);
    }
}

/* ══════════════════════════════════════════════════════════════════
   FLYING ORB ANIMATIONS
   ══════════════════════════════════════════════════════════════════ */
function spawnFlyingOrbs(unstable) {
    unstable.forEach(([r, c]) => {
        const srcEl = cellEl(r, c); if (!srcEl) return;
        const srcRect = srcEl.getBoundingClientRect();
        const col = PCOLORS[S.grid[r][c].owner];
        const sz = Math.max(6, Math.min(Math.floor(srcRect.width * 0.22), 14));
        const sx = srcRect.left + srcRect.width / 2, sy = srcRect.top + srcRect.height / 2;
        neighbors(r, c).forEach(([nr, nc]) => {
            const dstEl = cellEl(nr, nc); if (!dstEl) return;
            const dstRect = dstEl.getBoundingClientRect();
            const dx = dstRect.left + dstRect.width / 2, dy = dstRect.top + dstRect.height / 2;
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
    });
}

/* ══════════════════════════════════════════════════════════════════
   CHAIN REACTION ENGINE
   ══════════════════════════════════════════════════════════════════ */
async function chainReact(session) {
    while (true) {
        if (S.over) break;
        if (session !== undefined && session !== gameSession) throw new Error('stale');
        const unstable = [];
        for (let r = 0; r < cfg.rows; r++)
            for (let c = 0; c < cfg.cols; c++)
                if (S.grid[r][c].count >= critMass(r, c))
                    unstable.push([r, c]);
        if (!unstable.length) break;

        comboCount++;
        showCombo(comboCount, PCOLORS[S.current]);

        unstable.forEach(([r, c]) => {
            const el = cellEl(r, c); if (!el) return;
            el.classList.remove('pop'); void el.offsetWidth; el.classList.add('pop');
            const col = PCOLORS[S.grid[r][c].owner];
            const rip = document.createElement('div');
            rip.className = 'ripple';
            rip.style.cssText = `width:${el.offsetWidth * .45}px;height:${el.offsetWidth * .45}px;background:${col}44;border:1.5px solid ${col};`;
            el.appendChild(rip); setTimeout(() => rip.remove(), 450);
        });
        if (window.sfxExplode) sfxExplode(unstable.length);

        triggerShake(comboCount, unstable.length);
        pulseAmbient(PCOLORS[S.current], comboCount + unstable.length);
        spawnFlyingOrbs(unstable);
        await sessionDelay(FLY_MS + 20, session ?? gameSession);

        if (session !== undefined && session !== gameSession) throw new Error('stale');

        unstable.forEach(([r, c]) => {
            const cell = S.grid[r][c], owner = cell.owner, cm = critMass(r, c);
            cell.count -= cm; S.orbCount[owner] -= cm;
            if (cell.count <= 0) { cell.count = 0; cell.owner = -1; }
            neighbors(r, c).forEach(([nr, nc]) => {
                const ncell = S.grid[nr][nc];
                if (ncell.owner !== -1 && ncell.owner !== owner) { S.orbCount[ncell.owner] -= ncell.count; S.orbCount[owner] += ncell.count; ncell.owner = owner; }
                else if (ncell.owner === -1) { ncell.owner = owner; }
                ncell.count++; S.orbCount[owner]++;
                const nel = cellEl(nr, nc);
                if (nel) { nel.classList.remove('ping'); void nel.offsetWidth; nel.classList.add('ping'); }
            });
        });

        updateGainBadge(S.current, S.orbCount[S.current] - turnOrbsBefore);
        if (checkEliminationsAndWin()) break;

        renderAll();
        await sessionDelay(SETTLE_MS, session ?? gameSession);
    }
}

/* ══════════════════════════════════════════════════════════════════
   ELIMINATION + WIN
   ══════════════════════════════════════════════════════════════════ */
function checkEliminationsAndWin() {
    if (!S.hasMoved.every(Boolean)) return false;
    for (let i = 0; i < PCOLORS.length; i++)
        if (!S.eliminated[i] && S.orbCount[i] <= 0)
            S.eliminated[i] = true;
    const survivors = S.eliminated.map((e, i) => !e ? i : -1).filter(i => i >= 0);
    if (survivors.length === 1) {
        S.over = true; renderAll(); showWin(survivors[0]); return true;
    }
    return false;
}

/* ══════════════════════════════════════════════════════════════════
   UNDO / CHAT TOGGLE
   ══════════════════════════════════════════════════════════════════ */
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
    S = history.pop();
    for (let i = 0; i < PCOLORS.length; i++) updateGainBadge(i, 0);
    hideCombo(true);
    renderAll();
    syncUndoBtn();
    if (!S.over && IS_AI[S.current]) scheduleAiTurn();
    else setGridInteractive(true);
}

/* ══════════════════════════════════════════════════════════════════
   WIN
   ══════════════════════════════════════════════════════════════════ */
function showWin(idx) {
    const col = PCOLORS[idx];
    const wn = document.getElementById('wname');
    const aiTag = IS_AI[idx] ? ' (AI)' : '';
    const youTag = onlineMode && idx === myPlayerIndex ? ' — that\'s you!' : '';
    wn.textContent = `${PNAMES[idx]}${aiTag} wins!${youTag}`;
    wn.style.color = col;
    wn.style.textShadow = `0 0 28px ${col}`;
    const box = document.getElementById('win-box');
    box.style.border = `1px solid ${col}77`;
    box.style.boxShadow = `0 0 36px ${col}33`;
    document.getElementById('win-overlay').classList.add('show');
    if (window.sfxWin) sfxWin();
}

/* ══════════════════════════════════════════════════════════════════
   NAVIGATION
   ══════════════════════════════════════════════════════════════════ */
function restartGame() {
    document.getElementById('win-overlay').classList.remove('show');

    if (onlineMode) {
        leaveRoom();
        return;
    }

    history = [];
    for (let i = 0; i < PCOLORS.length; i++) updateGainBadge(i, 0);
    hideCombo(true);
    initState();
    buildGridDOM();
    buildPlayerStrip();
    renderAll();
    syncUndoBtn();
    if (IS_AI[0]) scheduleAiTurn();
    else setGridInteractive(true);
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

    history = [];
    hideCombo(true);
    ballModes.fill(0);
    ballOrder.length = 0;
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
let rTimer;
window.addEventListener('resize', () => {
    clearTimeout(rTimer);
    rTimer = setTimeout(() => {
        if (document.getElementById('game').style.display !== 'none') {
            buildGridDOM(); renderAll();
        }
    }, 200);
});
