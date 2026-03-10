/**
 * Chain Reaction — SpessaSynth MIDI Player
 * Playlist edition — Android-optimized
 */

'use strict';

const SPESSA_ESM = './spessasynth_bundle.js';   // fix #3: served locally, no CDN
const WORKLET_URL = './spessasynth_processor.min.js';
const SOUNDFONT_URL = './soundfont.sf3';

const PLAYLIST = [
    { title: 'End of Line', artist: 'Daft Punk', file: './midi/end-of-line.mid' },
    { title: 'Derezzed', artist: 'Daft Punk', file: './midi/Daft_Punk_-_Derezzed_-_midi_by_tutogamer2a.mid' },
    { title: 'Last Chance', artist: 'Vs. Tabi', file: './midi/Fnf_-_Vs_Tabi_-_Last_Chance__except_it_s_only_tabi_singing_it_-_midi_by_tutogamer2a.mid' },
    { title: 'B-Messenger', artist: 'Steins;Gate 0', file: './midi/Steins_Gate_0_-_Messenger_-_midi_by_tutogamer2a.mid' },
    { title: 'Septette for the Dead Princess', artist: 'Touhou 6', file: './midi/Septette For The Dead Princess - Touhou 6 - Midi by tutogamer2a.mid' },
    { title: 'Re:Awake', artist: 'Steins;Gate 0', file: './midi/Steins;Gate 0 - Re awake - midi by tutogamer2a.mid' },
    { title: 'The Young Descendant of Tepes', artist: 'Touhou 6', file: './midi/The Young Descendant of Tepes - touhou font version by tutogamer2a.mid' },
    { title: 'U.N. Owen Was Her?', artist: 'Touhou 6', file: './midi/Touhou - U.N Owen was Her - midi by tutogamer2a - Touhou Font - Final Version.mid' },
    { title: 'The Maid and the Pocket Watch of Blood', artist: 'Touhou 6', file: './midi/Touhou 06 - The Maid and the Pocket Watch of Blood - WIP.mid' },
    { title: 'Lunar Clock ~ Lunar Dial', artist: 'Touhou Luna Nights', file: './midi/Touhou Luna Night - Ost 1 - WIP.mid' },
    { title: 'Killer', artist: "JoJo's Bizarre Adventure", file: "./midi/Yoshikage Kira's Theme - JJBA Diamond is unbreakable - midi by tutogamer2a.mid" },
    { title: 'Ashes on the Fire', artist: 'Attack on Titan', file: './midi/ashes on the fire - snk final season - midi by tutogamer2a.mid' },
    { title: 'Bloody Tears', artist: 'Castlevania', file: './midi/Castlevania - Bloody Tears.mid' },
    { title: 'Abyss Watchers', artist: 'Dark Souls III', file: './midi/Dark Souls III - Abyss Watchers OST - midi by tutogamer2a - updated with new instruments.mid' },
    { title: 'Entrance', artist: 'Deemo', file: './midi/Deemo - Entrance - midi by tutogamer2a.mid' },
];

/* ── SVG icons ── */
const SVG_PLAY  = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>`;
const SVG_PAUSE = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
const SVG_PREV  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>`;
const SVG_NEXT  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20"/></svg>`;
const SVG_BARS  = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="10" width="4" height="10" rx="1"/><rect x="10" y="5" width="4" height="15" rx="1"/><rect x="18" y="1" width="4" height="19" rx="1"/></svg>`;

/* ── State ── */
let audioCtx        = null;
let gainNode        = null;
let synth           = null;
let seq             = null;
let isPlaying       = false;
let isReady         = false;
let isStarting      = false;
let isSwitching     = false;
let volume          = 0.65;
let currentTrack    = 0;

let prefetchedLib   = null;
let prefetchedSfBuf = null;
let midiBufs        = new Array(PLAYLIST.length).fill(null);
let prefetchDone    = false;
let prefetchError   = null;
let prefetchStarted = false;  // fix #5: only starts on first user tap

/* ── fix #1: Inline Web Worker source for MIDI normalization (off main thread) ── */
const NORMALIZER_WORKER_SRC = `
function midiPeakVelocity(buf) {
    const u8 = new Uint8Array(buf);
    let i = 0;
    function readU32() { const v=(u8[i]<<24)|(u8[i+1]<<16)|(u8[i+2]<<8)|u8[i+3]; i+=4; return v>>>0; }
    function readVarLen() { let val=0; for(let k=0;k<4;k++){const b=u8[i++];val=(val<<7)|(b&0x7f);if(!(b&0x80))break;} return val; }
    i=8; i+=2;
    const nTracks=(u8[i]<<8)|u8[i+1]; i+=2; i+=2;
    let peak=0;
    for(let t=0;t<nTracks;t++){
        if(i+8>u8.length)break;
        const tag=String.fromCharCode(u8[i],u8[i+1],u8[i+2],u8[i+3]); i+=4;
        const chunkLen=readU32(); const chunkEnd=i+chunkLen;
        if(tag!=='MTrk'){i=chunkEnd;continue;}
        let rs=0;
        while(i<chunkEnd){
            readVarLen();
            let s=u8[i]; if(s&0x80){rs=s;i++;}else{s=rs;}
            const type=s&0xf0;
            if(type===0x90){i++;const v=u8[i++];if(v>0&&v>peak)peak=v;}
            else if(type===0x80||type===0xa0||type===0xb0||type===0xe0){i+=2;}
            else if(type===0xc0||type===0xd0){i+=1;}
            else if(s===0xff){i++;const mLen=readVarLen();i+=mLen;}
            else if(s===0xf0||s===0xf7){const sLen=readVarLen();i+=sLen;}
            else{i++;}
        }
        i=chunkEnd;
    }
    return peak;
}
function midiScaleVelocities(buf,scale){
    const src=new Uint8Array(buf); const dst=new Uint8Array(src.length); dst.set(src);
    let i=0;
    function readU32(){const v=(dst[i]<<24)|(dst[i+1]<<16)|(dst[i+2]<<8)|dst[i+3];i+=4;return v>>>0;}
    function readVarLen(){let val=0;for(let k=0;k<4;k++){const b=dst[i++];val=(val<<7)|(b&0x7f);if(!(b&0x80))break;}return val;}
    i=8; const nTracks=(dst[i+2]<<8)|dst[i+3]; i+=6;
    for(let t=0;t<nTracks;t++){
        if(i+8>dst.length)break;
        i+=4; const chunkLen=readU32(); const chunkEnd=i+chunkLen;
        let rs=0;
        while(i<chunkEnd){
            readVarLen();
            let s=dst[i]; if(s&0x80){rs=s;i++;}else{s=rs;}
            const type=s&0xf0;
            if(type===0x90){i++;const vi=i++;const v=dst[vi];if(v>0)dst[vi]=Math.min(127,Math.round(v*scale));}
            else if(type===0x80||type===0xa0||type===0xb0||type===0xe0){i+=2;}
            else if(type===0xc0||type===0xd0){i+=1;}
            else if(s===0xff){i++;const mLen=readVarLen();i+=mLen;}
            else if(s===0xf0||s===0xf7){const sLen=readVarLen();i+=sLen;}
            else{i++;}
        }
        i=chunkEnd;
    }
    return dst.buffer;
}
self.onmessage = function(e) {
    const buf = e.data;
    const TARGET = 110;
    try {
        const peak = midiPeakVelocity(buf);
        if (peak <= 0) { self.postMessage(buf, [buf]); return; }
        const scaled = midiScaleVelocities(buf, TARGET / peak);
        self.postMessage(scaled, [scaled]);
    } catch(err) {
        self.postMessage(buf, [buf]);
    }
};
`;

/* Normalize a single MIDI buffer in a worker. Falls back gracefully if workers are unsupported. */
function normalizeOnWorker(buf) {
    return new Promise((resolve) => {
        try {
            const blob   = new Blob([NORMALIZER_WORKER_SRC], { type: 'application/javascript' });
            const url    = URL.createObjectURL(blob);
            const worker = new Worker(url);
            worker.onmessage = (e) => { URL.revokeObjectURL(url); worker.terminate(); resolve(e.data); };
            worker.onerror   = ()  => { URL.revokeObjectURL(url); worker.terminate(); resolve(buf); };
            const copy = buf.slice(0);
            worker.postMessage(copy, [copy]);
        } catch(e) {
            resolve(buf); // Worker not available, return as-is
        }
    });
}

/* ── Styles ── */
(function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
        @keyframes mp-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        #mp-play-btn.spinning { animation: mp-spin 3s linear infinite; }
        #mp-play-btn svg, #mp-prev-btn svg, #mp-next-btn svg { display:block; pointer-events:none; }
        .mp-status svg { display:inline-block; vertical-align:middle; margin-right:3px; }
        #mp-prev-btn, #mp-next-btn {
            background: none; border: none; color: #cc44ff;
            cursor: pointer; padding: 4px; display: flex;
            align-items: center; justify-content: center;
            opacity: 0.7; transition: opacity 0.15s;
        }
        #mp-prev-btn:hover, #mp-next-btn:hover { opacity: 1; }
    `;
    document.head.appendChild(s);
})();

/* ── UI helpers ── */
function setStatus(html, cls) {
    const el = document.getElementById('mp-status');
    if (!el) return;
    el.innerHTML = html;
    el.className = 'mp-status' + (cls ? ' ' + cls : '');
}
function setIcon(playing) {
    const btn = document.getElementById('mp-play-btn');
    if (!btn) return;
    btn.innerHTML = playing ? SVG_PAUSE : SVG_PLAY;
    playing ? btn.classList.add('spinning') : btn.classList.remove('spinning');
}
function updateTrackDisplay() {
    const titleEl = document.getElementById('mp-title');
    if (titleEl) titleEl.textContent = PLAYLIST[currentTrack].artist;
}

/* ── fix #2: Fetch and normalize a single track on demand ── */
async function fetchTrack(index) {
    if (midiBufs[index] !== null) return; // already loaded
    const track = PLAYLIST[index];
    const res = await fetch(track.file);
    if (!res.ok) throw new Error(track.title + ' HTTP ' + res.status);
    const raw = await res.arrayBuffer();
    midiBufs[index] = await normalizeOnWorker(raw);
    console.log('[MIDI] Loaded & normalized track', index, track.title);
}

/* Background-fetch all remaining tracks after the essential ones are ready */
async function backgroundFetchRemaining() {
    for (let i = 0; i < PLAYLIST.length; i++) {
        if (midiBufs[i] === null) {
            try { await fetchTrack(i); } catch(e) { console.warn('[MIDI] BG fetch failed for track', i, e); }
        }
    }
    console.log('[MIDI] Background fetch complete');
}

/* ── Phase 1: prefetch — deferred until first user tap (fix #5) ── */
async function prefetchAssets() {
    if (prefetchStarted) return;
    prefetchStarted = true;

    try {
        setStatus('Loading…', 'loading');

        /* SpessaSynth — now local, no CDN (fix #3) */
        const lib = await import(SPESSA_ESM);
        prefetchedLib = { WorkletSynthesizer: lib.WorkletSynthesizer, Sequencer: lib.Sequencer };

        /* Soundfont */
        const sfRes = await fetch(SOUNDFONT_URL);
        if (!sfRes.ok) throw new Error('soundfont HTTP ' + sfRes.status);
        prefetchedSfBuf = await sfRes.arrayBuffer();

        /* fix #2: only fetch current track + next 2 eagerly */
        setStatus('Loading tracks…', 'loading');
        const eager = [...new Set([
            currentTrack,
            (currentTrack + 1) % PLAYLIST.length,
            (currentTrack + 2) % PLAYLIST.length,
        ])];
        await Promise.all(eager.map(i => fetchTrack(i)));

        prefetchDone = true;
        console.log('[MIDI] Essential prefetch complete');
        setStatus('Ready');

        /* Fetch remaining tracks quietly in the background */
        backgroundFetchRemaining();

    } catch (e) {
        prefetchError = e;
        console.error('[MIDI] Prefetch failed:', e);
        setStatus('ERR: ' + e.message, 'err');
    }
}

/* ── Phase 2: init AudioContext + synth on first play ── */
async function startAudio() {
    if (isReady || isStarting) return;

    /* Kick off prefetch on first tap if not already started (fix #5) */
    if (!prefetchStarted) {
        prefetchAssets(); // intentionally not awaited — runs in parallel
    }

    /* If prefetch is still in progress, wait a moment and retry */
    if (!prefetchDone) {
        if (prefetchError) { setStatus('ERR: ' + prefetchError.message, 'err'); return; }
        setStatus('Still loading…', 'loading');
        setTimeout(async () => { if (!isReady && !isStarting) await startAudio(); }, 800);
        return;
    }
    if (prefetchError) { setStatus('ERR: ' + prefetchError.message, 'err'); return; }

    isStarting = true;
    setStatus('Starting…', 'loading');

    try {
        const { WorkletSynthesizer, Sequencer } = prefetchedLib;

        /* fix #4: latencyHint 'playback' trades low-latency for stability on Android WebView */
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
        window.crAudioCtx = audioCtx;
        await audioCtx.resume();
        await audioCtx.audioWorklet.addModule(WORKLET_URL);

        synth = new WorkletSynthesizer(audioCtx);
        await synth.isReady;

        await synth.soundBankManager.addSoundBank(prefetchedSfBuf.slice(0), 'main');
        await synth.isReady;

        gainNode = audioCtx.createGain();
        gainNode.gain.value = volume;
        gainNode.connect(audioCtx.destination);

        if (synth.output && synth.output.connect) synth.output.connect(gainNode);
        else if (synth.connect) synth.connect(gainNode);

        seq = new Sequencer(synth);
        seq.loop = false;

        await loadTrack(currentTrack, true);

        isReady    = true;
        isPlaying  = true;
        isStarting = false;
        updateTrackDisplay();
        setStatus(SVG_BARS + PLAYLIST[currentTrack].title, 'playing');
        setIcon(true);
        startSeekTicker();

    } catch (e) {
        console.error('[MIDI] startAudio failed:', e);
        setStatus('ERR: ' + e.message, 'err');
        isStarting = false;
    }
}

/* ── Load a track into the sequencer ── */
async function loadTrack(index, play) {
    /* If the user skipped to a track not yet fetched, grab it now */
    if (!midiBufs[index]) {
        setStatus('Loading…', 'loading');
        await fetchTrack(index);
    }
    const buf = midiBufs[index].slice(0);
    seq.loadNewSongList([{ binary: buf, altName: PLAYLIST[index].file }]);
    seq.onended = () => skipTrack(1);
    if (play) seq.play(true);
}

/* ── Skip forward/backward ── */
async function skipTrack(dir) {
    if (!isReady || isSwitching) return;
    isSwitching = true;

    currentTrack = (currentTrack + dir + PLAYLIST.length) % PLAYLIST.length;
    updateTrackDisplay();
    setStatus('Loading…', 'loading');

    try {
        await loadTrack(currentTrack, true);
        isPlaying = true;
        setStatus(SVG_BARS + PLAYLIST[currentTrack].title, 'playing');
        setIcon(true);
        const seekEl = document.getElementById('mp-seek');
        if (seekEl) { seekEl.value = 0; seekEl.style.setProperty('--seek', '0%'); }
        const elCur = document.getElementById('mp-time-cur');
        const elDur = document.getElementById('mp-time-end');
        if (elCur) elCur.textContent = '0:00';
        if (elDur) elDur.textContent = '0:00';
    } catch (e) {
        setStatus('ERR: ' + e.message, 'err');
    }

    isSwitching = false;
}

/* ── Toggle play/pause ── */
function togglePlay() {
    if (!isReady) return;
    if (isPlaying) {
        seq.pause();
        isPlaying = false;
        stopSeekTicker();
        setStatus('Paused');
        setIcon(false);
    } else {
        audioCtx.resume().then(() => {
            seq.play();
            isPlaying = true;
            setStatus(SVG_BARS + PLAYLIST[currentTrack].title, 'playing');
            setIcon(true);
            startSeekTicker();
        });
    }
}

/* ── Volume ── */
function changeVolume(v) {
    volume = Math.max(0, Math.min(1, v));
    if (gainNode) gainNode.gain.value = volume;
    const el = document.getElementById('mp-vol');
    if (el) {
        el.value = Math.round(volume * 100);
        el.style.setProperty('--val', Math.round(volume * 100) + '%');
    }
}

/* ── Seek ── */
let seekDragging = false;
let seekRafId    = null;
let lastSeekTick = 0;

function formatTime(s) {
    s = Math.max(0, Math.floor(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function updateSeekUI() {
    if (!isReady || seekDragging) return;
    const dur = seq.duration    ?? 0;
    const cur = seq.currentTime ?? 0;
    const pct = dur > 0 ? cur / dur : 0;
    const el  = document.getElementById('mp-seek');
    if (el) {
        el.value = Math.round(pct * 1000);
        el.style.setProperty('--seek', (pct * 100).toFixed(1) + '%');
    }
    const elCur = document.getElementById('mp-time-cur');
    const elDur = document.getElementById('mp-time-dur');
    if (elCur) elCur.textContent = formatTime(cur);
    if (elDur) elDur.textContent = formatTime(dur);

    if (isPlaying && !isSwitching && dur > 0 && cur >= dur - 0.6) {
        skipTrack(1);
    }
}

/* fix #6: rAF-based ticker — zero cost when paused or page is hidden */
function seekTick(ts) {
    if (!isPlaying) { seekRafId = null; return; }
    if (ts - lastSeekTick >= 500) { updateSeekUI(); lastSeekTick = ts; }
    seekRafId = requestAnimationFrame(seekTick);
}
function startSeekTicker() {
    if (seekRafId) cancelAnimationFrame(seekRafId);
    lastSeekTick = 0;
    seekRafId = requestAnimationFrame(seekTick);
}
function stopSeekTicker() {
    if (seekRafId) { cancelAnimationFrame(seekRafId); seekRafId = null; }
}

/* ── Build widget ── */
function buildWidget() {
    if (document.getElementById('music-player')) return;
    const mp = document.createElement('div');
    mp.id = 'music-player';
    mp.innerHTML = `
        <div class="mp-top-row">
            <div class="mp-controls">
                <button id="mp-prev-btn" title="Previous">${SVG_PREV}</button>
                <button id="mp-play-btn" class="mp-btn" title="Play / Pause">${SVG_PLAY}</button>
                <button id="mp-next-btn" title="Next">${SVG_NEXT}</button>
            </div>
            <div class="mp-info">
                <div id="mp-title" class="mp-title">${PLAYLIST[0].artist}</div>
                <div id="mp-status" class="mp-status">Tap to play</div>
            </div>
            <div class="mp-vol-wrap" title="Volume">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"/>
                </svg>
                <input id="mp-vol" type="range" min="0" max="100" value="65" class="mp-vol-slider">
            </div>
        </div>
        <div class="mp-seek-row">
            <span id="mp-time-cur" class="mp-time">0:00</span>
            <input id="mp-seek" type="range" min="0" max="1000" value="0" class="mp-seek-slider">
            <span id="mp-time-end" class="mp-time mp-time-end">0:00</span>
        </div>`;
    const slot = document.getElementById('music-player-slot-setup') || document.body;
    slot.appendChild(mp);

    const volEl = document.getElementById('mp-vol');
    volEl.style.setProperty('--val', '65%');
    volEl.addEventListener('input', e => changeVolume(e.target.value / 100));

    const seekEl = document.getElementById('mp-seek');
    seekEl.style.setProperty('--seek', '0%');
    seekEl.addEventListener('mousedown', () => { seekDragging = true; });
    seekEl.addEventListener('touchstart', () => { seekDragging = true; });
    seekEl.addEventListener('input', () => {
        if (!isReady) return;
        const pct = seekEl.value / 1000;
        const dur = seq.duration ?? 0;
        const elCur = document.getElementById('mp-time-cur');
        if (elCur) elCur.textContent = formatTime(pct * dur);
        seekEl.style.setProperty('--seek', (pct * 100).toFixed(1) + '%');
    });
    seekEl.addEventListener('change', () => {
        if (!isReady) return;
        const pct = seekEl.value / 1000;
        seq.currentTime = pct * (seq.duration ?? 0);
        seekDragging = false;
    });
    seekEl.addEventListener('mouseup',  () => { seekDragging = false; });
    seekEl.addEventListener('touchend', () => { seekDragging = false; });

    document.getElementById('mp-play-btn').addEventListener('click', async () => {
        if (isReady) togglePlay();
        else await startAudio();
    });
    document.getElementById('mp-prev-btn').addEventListener('click', async () => {
        if (isReady) skipTrack(-1);
        else await startAudio();
    });
    document.getElementById('mp-next-btn').addEventListener('click', async () => {
        if (isReady) skipTrack(1);
        else await startAudio();
    });

    /* fix #5: prefetchAssets() intentionally NOT called here.
       It fires on the first button tap to keep initial page load fast. */
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildWidget);
} else {
    buildWidget();
}

/* ── Move player between setup and game slots ── */
window.moveMusicPlayer = function (screen) {
    const mp = document.getElementById('music-player');
    if (!mp) return;
    const slotId = screen === 'game'   ? 'music-player-slot'
                 : screen === 'online' ? 'music-player-slot-online'
                                       : 'music-player-slot-setup';
    const slot = document.getElementById(slotId);
    if (slot && mp.parentElement !== slot) slot.appendChild(mp);
};
