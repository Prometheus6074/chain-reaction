/**
 * Chain Reaction — SpessaSynth MIDI Player
 * Playlist edition
 */

'use strict';

const SPESSA_ESM    = 'https://cdn.jsdelivr.net/npm/spessasynth_lib@latest/+esm';
const WORKLET_URL   = './spessasynth_processor.min.js';
const SOUNDFONT_URL = './soundfont.sf3';

const PLAYLIST = [
    { title: 'End of Line',                    artist: 'Daft Punk',               file: './midi/end-of-line.mid' },
    { title: 'Derezzed',                       artist: 'Daft Punk',               file: './midi/Daft_Punk_-_Derezzed_-_midi_by_tutogamer2a.mid' },
    { title: 'Last Chance',                    artist: 'Vs. Tabi',                file: './midi/Fnf_-_Vs_Tabi_-_Last_Chance__except_it_s_only_tabi_singing_it_-_midi_by_tutogamer2a.mid' },
    { title: 'Messenger',                      artist: 'Steins;Gate 0',           file: './midi/Steins_Gate_0_-_Messenger_-_midi_by_tutogamer2a.mid' },
    { title: 'Septette for the Dead Princess', artist: 'Touhou 6',                file: './midi/Septette For The Dead Princess - Touhou 6 - Midi by tutogamer2a.mid' },
    { title: 'Re:Awake',                       artist: 'Steins;Gate 0',           file: './midi/Steins;Gate 0 - Re awake - midi by tutogamer2a.mid' },
    { title: 'The Young Descendant of Tepes',  artist: 'Touhou',                  file: './midi/The Young Descendant of Tepes - touhou font version by tutogamer2a.mid' },
    { title: 'U.N. Owen Was Her?',             artist: 'Touhou',                  file: './midi/Touhou - U.N Owen was Her - midi by tutogamer2a - Touhou Font - Final Version.mid' },
    { title: 'The Maid and the Pocket Watch',  artist: 'Touhou 6',                file: './midi/Touhou 06 - The Maid and the Pocket Watch of Blood - WIP.mid' },
    { title: 'OST 1',                          artist: 'Touhou Luna Nights',      file: './midi/Touhou Luna Night - Ost 1 - WIP.mid' },
    { title: "Yoshikage Kira's Theme",         artist: "JoJo's Bizarre Adventure",file: "./midi/Yoshikage Kira's Theme - JJBA Diamond is unbreakable - midi by tutogamer2a.mid" },
    { title: 'Ashes on the Fire',              artist: 'Attack on Titan',         file: './midi/ashes on the fire - snk final season - midi by tutogamer2a.mid' },
    { title: 'Bloody Tears',                   artist: 'Castlevania',             file: './midi/Castlevania - Bloody Tears.mid' },
    { title: 'Abyss Watchers',                 artist: 'Dark Souls III',          file: './midi/Dark Souls III - Abyss Watchers OST - midi by tutogamer2a - updated with new instruments.mid' },
    { title: 'Entrance',                       artist: 'Deemo',                   file: './midi/Deemo - Entrance - midi by tutogamer2a.mid' },
];

/* ── SVG icons ── */
const SVG_PLAY  = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 6.998a2 2 0 0 1 .003 3.458l-12 7A2 2 0 0 1 5 19z"/></svg>`;
const SVG_PAUSE = `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>`;
const SVG_PREV  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>`;
const SVG_NEXT  = `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="4" x2="19" y2="20"/></svg>`;
const SVG_BARS  = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="10" width="4" height="10" rx="1"/><rect x="10" y="5" width="4" height="15" rx="1"/><rect x="18" y="1" width="4" height="19" rx="1"/></svg>`;

/* ── State ── */
let audioCtx      = null;
let gainNode      = null;
let synth         = null;
let seq           = null;
let isPlaying     = false;
let isReady       = false;
let isStarting    = false;
let isSwitching   = false;
let volume        = 0.65;
let currentTrack  = 0;

let prefetchedLib    = null;
let prefetchedSfBuf  = null;
let midiBufs         = new Array(PLAYLIST.length).fill(null); // per-track buffers
let prefetchDone     = false;
let prefetchError    = null;

/* ── Styles ── */
(function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
        @keyframes mp-spin { from{transform:rotate(0deg)} to{transform:rotate(360deg)} }
        #mp-play-btn.spinning { animation: mp-spin 3s linear infinite; }
        #mp-play-btn svg, #mp-prev-btn svg, #mp-next-btn svg { display:block; pointer-events:none; }
        .mp-status svg { display:inline-block; vertical-align:middle; margin-right:3px; }
        #mp-prev-btn, #mp-next-btn {
            background: none; border: none; color: inherit;
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
    const t = PLAYLIST[currentTrack];
    const titleEl = document.getElementById('mp-title');
    if (titleEl) titleEl.textContent = t.artist + ' · ' + t.title;
}

/* ── MIDI normalization ── */
/* Walks a raw MIDI ArrayBuffer, finds all note-on velocities,
   returns the peak velocity (0–127). */
function midiPeakVelocity(buf) {
    const u8 = new Uint8Array(buf);
    let i = 0;
    function read(n) { const v = u8.slice(i, i + n); i += n; return v; }
    function readU32() { const v = (u8[i]<<24)|(u8[i+1]<<16)|(u8[i+2]<<8)|u8[i+3]; i+=4; return v>>>0; }
    function readVarLen() {
        let val = 0;
        for (let k = 0; k < 4; k++) {
            const b = u8[i++]; val = (val << 7) | (b & 0x7f);
            if (!(b & 0x80)) break;
        }
        return val;
    }

    // Skip "MThd" header
    i = 8; // skip "MThd" + length (always 6)
    const format = (u8[i]<<8)|u8[i+1]; i+=2;
    const nTracks = (u8[i]<<8)|u8[i+1]; i+=2;
    i += 2; // skip division

    let peak = 0;
    for (let t = 0; t < nTracks; t++) {
        if (i + 8 > u8.length) break;
        const tag = String.fromCharCode(u8[i],u8[i+1],u8[i+2],u8[i+3]); i += 4;
        const chunkLen = readU32();
        const chunkEnd = i + chunkLen;
        if (tag !== 'MTrk') { i = chunkEnd; continue; }

        let runningStatus = 0;
        while (i < chunkEnd) {
            readVarLen(); // delta time
            let status = u8[i];
            if (status & 0x80) { runningStatus = status; i++; }
            else { status = runningStatus; }

            const type = status & 0xf0;
            if (type === 0x90) { // note-on
                i++; // note
                const vel = u8[i++];
                if (vel > 0 && vel > peak) peak = vel;
            } else if (type === 0x80 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
                i += 2;
            } else if (type === 0xc0 || type === 0xd0) {
                i += 1;
            } else if (status === 0xff) { // meta event
                i++; // meta type
                const mLen = readVarLen();
                i += mLen;
            } else if (status === 0xf0 || status === 0xf7) { // sysex
                const sLen = readVarLen();
                i += sLen;
            } else {
                i++; // unknown, skip one byte
            }
        }
        i = chunkEnd;
    }
    return peak;
}

/* Scales every note-on velocity in a MIDI buffer by a ratio.
   Returns a new ArrayBuffer with modified velocities. */
function midiScaleVelocities(buf, scale) {
    const src = new Uint8Array(buf);
    const dst = new Uint8Array(src.length);
    dst.set(src);
    let i = 0;

    function readU32() { const v = (dst[i]<<24)|(dst[i+1]<<16)|(dst[i+2]<<8)|dst[i+3]; i+=4; return v>>>0; }
    function readVarLen() {
        let val = 0;
        for (let k = 0; k < 4; k++) {
            const b = dst[i++]; val = (val << 7) | (b & 0x7f);
            if (!(b & 0x80)) break;
        }
        return val;
    }

    i = 8;
    const nTracks = (dst[i+2]<<8)|dst[i+3]; i += 6;

    for (let t = 0; t < nTracks; t++) {
        if (i + 8 > dst.length) break;
        i += 4; // "MTrk"
        const chunkLen = readU32();
        const chunkEnd = i + chunkLen;

        let runningStatus = 0;
        while (i < chunkEnd) {
            readVarLen();
            let status = dst[i];
            if (status & 0x80) { runningStatus = status; i++; }
            else { status = runningStatus; }

            const type = status & 0xf0;
            if (type === 0x90) {
                i++; // note
                const velIdx = i++;
                const vel = dst[velIdx];
                if (vel > 0) dst[velIdx] = Math.min(127, Math.round(vel * scale));
            } else if (type === 0x80 || type === 0xa0 || type === 0xb0 || type === 0xe0) {
                i += 2;
            } else if (type === 0xc0 || type === 0xd0) {
                i += 1;
            } else if (status === 0xff) {
                i++;
                const mLen = readVarLen();
                i += mLen;
            } else if (status === 0xf0 || status === 0xf7) {
                const sLen = readVarLen();
                i += sLen;
            } else {
                i++;
            }
        }
        i = chunkEnd;
    }
    return dst.buffer;
}

/* Normalize all loaded midiBufs so every track peaks at velocity 110. */
function normalizeMidiBuffers() {
    const TARGET = 110;
    midiBufs = midiBufs.map((buf, i) => {
        try {
            const peak = midiPeakVelocity(buf);
            if (peak <= 0) return buf;
            const scale = TARGET / peak;
            console.log(`[MIDI] Track ${i} "${PLAYLIST[i].title}" peak=${peak} scale=${scale.toFixed(3)}`);
            return midiScaleVelocities(buf, scale);
        } catch (e) {
            console.warn('[MIDI] Normalize failed for track', i, e);
            return buf;
        }
    });
}

/* ── Phase 1: prefetch all assets (no AudioContext needed) ── */
async function prefetchAssets() {
    try {
        setStatus('Loading…', 'loading');

        /* SpessaSynth ESM */
        const lib = await import(SPESSA_ESM);
        prefetchedLib = { WorkletSynthesizer: lib.WorkletSynthesizer, Sequencer: lib.Sequencer };

        /* Soundfont */
        const sfRes = await fetch(SOUNDFONT_URL);
        if (!sfRes.ok) throw new Error('soundfont HTTP ' + sfRes.status);
        prefetchedSfBuf = await sfRes.arrayBuffer();

        /* All MIDI files in parallel */
        setStatus('Loading tracks…', 'loading');
        await Promise.all(PLAYLIST.map(async (track, i) => {
            const res = await fetch(track.file);
            if (!res.ok) throw new Error(track.title + ' HTTP ' + res.status);
            midiBufs[i] = await res.arrayBuffer();
            console.log('[MIDI] Fetched track', i, track.title, midiBufs[i].byteLength, 'bytes');
        }));

        /* Normalize all tracks to the same peak velocity */
        normalizeMidiBuffers();

        prefetchDone = true;
        console.log('[MIDI] All prefetch complete');
        setStatus('Ready');
    } catch (e) {
        prefetchError = e;
        console.error('[MIDI] Prefetch failed:', e);
        setStatus('ERR: ' + e.message, 'err');
    }
}

/* ── Phase 2: init AudioContext + synth (first play only) ── */
async function startAudio() {
    if (isReady || isStarting) return;
    if (!prefetchDone) { setStatus('Still loading…', 'loading'); return; }
    if (prefetchError) { setStatus('ERR: ' + prefetchError.message, 'err'); return; }

    isStarting = true;
    setStatus('Starting…', 'loading');

    try {
        const { WorkletSynthesizer, Sequencer } = prefetchedLib;

        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
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

        seq = new (prefetchedLib.Sequencer)(synth);
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
    const buf = midiBufs[index].slice(0);
    seq.loadNewSongList([{ binary: buf, altName: PLAYLIST[index].file }]);
    /* seq.onended fires when the sequencer finishes the song */
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
        // reset seek bar for new track
        const seekEl = document.getElementById('mp-seek');
        if (seekEl) { seekEl.value = 0; seekEl.style.setProperty('--seek', '0%'); }
        const elCur = document.getElementById('mp-time-cur');
        const elDur = document.getElementById('mp-time-end');
        if (elCur) elCur.textContent = '0:00';
        if (elDur) elDur.textContent = '0:00';
    } catch(e) {
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
        setStatus('Paused');
        setIcon(false);
    } else {
        audioCtx.resume().then(() => {
            seq.play();
            isPlaying = true;
            setStatus(SVG_BARS + PLAYLIST[currentTrack].title, 'playing');
            setIcon(true);
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
let seekInterval = null;

function formatTime(s) {
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60);
    const ss = String(s % 60).padStart(2, '0');
    return m + ':' + ss;
}

function updateSeekUI() {
    if (!isReady || seekDragging) return;
    const dur = seq.duration ?? 0;
    const cur = seq.currentTime ?? 0;
    const pct = dur > 0 ? cur / dur : 0;
    const el = document.getElementById('mp-seek');
    if (el) {
        el.value = Math.round(pct * 1000);
        el.style.setProperty('--seek', (pct * 100).toFixed(1) + '%');
    }
    const elCur = document.getElementById('mp-time-cur');
    const elDur = document.getElementById('mp-time-dur');
    if (elCur) elCur.textContent = formatTime(cur);
    if (elDur) elDur.textContent = formatTime(dur);

    // Fallback: if the song has reached its end and we're still marked as playing, advance
    if (isPlaying && !isSwitching && dur > 0 && cur >= dur - 0.6) {
        skipTrack(1);
    }
}

function startSeekTicker() {
    if (seekInterval) clearInterval(seekInterval);
    seekInterval = setInterval(updateSeekUI, 500);
}

/* ── Build widget ── */
function buildWidget() {
    if (document.getElementById('music-player')) return;
    const mp = document.createElement('div');
    mp.id = 'music-player';
    mp.innerHTML = `
        <div class="mp-top-row">
            <button id="mp-prev-btn" title="Previous">${SVG_PREV}</button>
            <button id="mp-play-btn" class="mp-btn" title="Play / Pause">${SVG_PLAY}</button>
            <button id="mp-next-btn" title="Next">${SVG_NEXT}</button>
            <div class="mp-info">
                <div id="mp-title" class="mp-title">${PLAYLIST[0].artist} · ${PLAYLIST[0].title}</div>
                <div id="mp-status" class="mp-status">Loading…</div>
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
    seekEl.addEventListener('mousedown',  () => { seekDragging = true; });
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
        else { await startAudio(); }
    });
    document.getElementById('mp-next-btn').addEventListener('click', async () => {
        if (isReady) skipTrack(1);
        else { await startAudio(); }
    });

    prefetchAssets();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', buildWidget);
} else {
    buildWidget();
}

/* ── Move player between setup and game slots ── */
window.moveMusicPlayer = function(screen) {
    const mp = document.getElementById('music-player');
    if (!mp) return;
    const slotId = screen === 'game' ? 'music-player-slot'
                 : screen === 'online' ? 'music-player-slot-online'
                 : 'music-player-slot-setup';
    const slot = document.getElementById(slotId);
    if (slot && mp.parentElement !== slot) slot.appendChild(mp);
};
