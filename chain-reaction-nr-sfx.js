/**
 * Chain Reaction — Nuclear Reaction Ability SFX
 * All 24 ability sounds synthesized via Web Audio API. Zero audio files.
 *
 * Completely self-contained: shares the AudioContext via window.crAudioCtx /
 * window._sfxCtx but does NOT call functions from chain-reaction-sfx.js,
 * avoiding cross-script gain-node lifecycle issues.
 *
 * Volume is read from window._sfxPendingGain (set by setSfxVolume in sfx.js).
 *
 * Called via:  window.sfxNR(abilId)
 * Hooked in:   nrExecuteAbility() in chain-reaction.js
 */

'use strict';

function _nrGetCtx() {
    if (window.crAudioCtx && window.crAudioCtx.state !== 'closed') return window.crAudioCtx;
    if (!window._sfxCtx || window._sfxCtx.state === 'closed')
        window._sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
    return window._sfxCtx;
}
/* _NR_MASTER normalizes ability peaks (~0.70) down to match base SFX levels
   (sfxPlace 0.18, sfxExplode 0.32) so one SFX slider controls everything. */
const _NR_MASTER = 0.35;
function _nrMakeOut(ctx) {
    const g = ctx.createGain();
    const vol = (typeof window._sfxPendingGain === 'number') ? window._sfxPendingGain : 0.55;
    g.gain.value = vol * _NR_MASTER;
    g.connect(ctx.destination);
    return g;
}
function _nrResume(ctx) {
    if (ctx.state === 'suspended') ctx.resume();
}

/* ── Noise burst through a filter ── */
function _noise(ctx, out, t, dur, filterType, filterFreq, vol) {
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d   = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const flt = ctx.createBiquadFilter();
    flt.type = filterType;
    flt.frequency.value = filterFreq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vol, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(env); env.connect(out);
    src.start(t); src.stop(t + dur + 0.02);
}

/* ── Oscillator tone with attack/decay. freq=[start,end] for pitch sweep ── */
function _tone(ctx, out, t, freq, type, vol, attack, decay) {
    const osc  = ctx.createOscillator();
    const env  = ctx.createGain();
    const isArr = Array.isArray(freq);
    osc.type            = isArr ? 'sine' : type;
    osc.frequency.value = isArr ? freq[0] : freq;
    if (isArr) {
        osc.frequency.setValueAtTime(freq[0], t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(freq[1], 0.01), t + attack + decay);
    }
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(vol, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(env); env.connect(out);
    osc.start(t); osc.stop(t + attack + decay + 0.03);
}

/* RED — Warhead */
function _sfxCarpetBomb(ctx, out, t) {
    for (let i = 0; i < 5; i++) {
        const ti = t + i * 0.07;
        _tone (ctx, out, ti, [110, 35], 'sine', 0.45, 0.005, 0.10);
        _noise(ctx, out, ti, 0.05, 'bandpass', 800 + i * 100, 0.18);
    }
}
function _sfxAirstrike(ctx, out, t) {
    _tone (ctx, out, t,        [1400, 200], 'sine', 0.22, 0.01,  0.22);
    _tone (ctx, out, t + 0.20, [180,   35], 'sine', 0.70, 0.005, 0.28);
    _noise(ctx, out, t + 0.20, 0.09, 'lowpass', 3000, 0.35);
}
function _sfxDetonationWave(ctx, out, t) {
    _tone (ctx, out, t,        [60,  140], 'sawtooth', 0.35, 0.01,  0.16);
    _tone (ctx, out, t + 0.14, [140,  40], 'sine',     0.50, 0.005, 0.30);
    _noise(ctx, out, t,        0.12, 'bandpass', 1800, 0.25);
    _noise(ctx, out, t + 0.06, 0.18, 'lowpass',   600, 0.20);
}

/* BLUE — Tsunami */
function _sfxUndertow(ctx, out, t) {
    _noise(ctx, out, t, 0.35, 'bandpass', 900, 0.26);
    _tone (ctx, out, t, [180, 80], 'sine', 0.22, 0.02, 0.32);
}
function _sfxTidalWave(ctx, out, t) {
    _noise(ctx, out, t,        0.50, 'bandpass', 600, 0.30);
    _tone (ctx, out, t,        [80, 280], 'sine', 0.45, 0.04, 0.42);
    _tone (ctx, out, t + 0.08, [120, 60], 'sine', 0.28, 0.02, 0.38);
}
function _sfxRiptide(ctx, out, t) {
    _noise(ctx, out, t,        0.55, 'bandpass', 700,  0.24);
    _tone (ctx, out, t,        [100, 320], 'sine', 0.32, 0.06, 0.50);
    _noise(ctx, out, t + 0.48, 0.12, 'lowpass', 2000,  0.38);
    _tone (ctx, out, t + 0.48, [280,  50], 'sine', 0.45, 0.005, 0.18);
}

/* GREEN — Blight */
function _sfxOvergrowth(ctx, out, t) {
    [220, 277, 330, 415, 494].forEach((f, i) => {
        _tone(ctx, out, t + i * 0.055, f,       'sine',     0.17, 0.015, 0.22);
        _tone(ctx, out, t + i * 0.055, f * 1.5, 'triangle', 0.07, 0.015, 0.18);
    });
}
function _sfxCreep(ctx, out, t) {
    for (let i = 0; i < 4; i++) {
        const ti = t + i * 0.06;
        _tone (ctx, out, ti, [160 + i * 30, 80 + i * 20], 'triangle', 0.18, 0.01, 0.14);
        _noise(ctx, out, ti, 0.06, 'bandpass', 400 + i * 80, 0.10);
    }
}
function _sfxPandemic(ctx, out, t) {
    [110, 131, 165].forEach(f => _tone(ctx, out, t, f, 'sawtooth', 0.11, 0.02, 0.55));
    _noise(ctx, out, t + 0.05, 0.44, 'highpass', 3500, 0.13);
    _tone (ctx, out, t, [55, 45], 'sine', 0.28, 0.03, 0.50);
}

/* YELLOW — Voltage */
function _sfxSurge(ctx, out, t) {
    for (let i = 0; i < 6; i++)
        _noise(ctx, out, t + i * 0.032, 0.025, 'bandpass', 2000 + i * 400, 0.18);
    _tone(ctx, out, t,       [300, 1200], 'sawtooth', 0.16, 0.04, 0.22);
    _tone(ctx, out, t + 0.1, [600, 2400], 'square',   0.09, 0.02, 0.12);
}
function _sfxStaticField(ctx, out, t) {
    _noise(ctx, out, t,        0.05, 'highpass', 4000, 0.32);
    _tone (ctx, out, t + 0.04,  180, 'sawtooth', 0.11, 0.01, 0.30);
    _tone (ctx, out, t + 0.04,  183, 'sawtooth', 0.11, 0.01, 0.30);
}
function _sfxBlackout(ctx, out, t) {
    _noise(ctx, out, t, 0.06, 'highpass', 5000, 0.38);
    _tone (ctx, out, t, [800, 60], 'sawtooth', 0.26, 0.005, 0.35);
    for (let i = 0; i < 3; i++)
        _noise(ctx, out, t + 0.08 + i * 0.05, 0.03, 'bandpass', 2500 - i * 400, 0.16);
}

/* PURPLE — Phantom */
function _sfxPhantomStep(ctx, out, t) {
    _tone (ctx, out, t,        [600, 100], 'sine',     0.28, 0.003, 0.10);
    _noise(ctx, out, t,        0.06, 'bandpass', 1200, 0.20);
    _tone (ctx, out, t + 0.12, [100, 500], 'sine',     0.23, 0.005, 0.12);
    _noise(ctx, out, t + 0.12, 0.06, 'bandpass', 1500, 0.18);
    _tone (ctx, out, t + 0.10,  880, 'triangle',  0.11, 0.01, 0.20);
    _tone (ctx, out, t + 0.14, 1108, 'triangle',  0.07, 0.01, 0.16);
}
function _sfxSwap(ctx, out, t) {
    _tone (ctx, out, t,        [400,  80], 'sine', 0.26, 0.004, 0.10);
    _noise(ctx, out, t,        0.05, 'bandpass',  900, 0.17);
    _tone (ctx, out, t + 0.10, [ 80, 400], 'sine', 0.26, 0.004, 0.10);
    _noise(ctx, out, t + 0.10, 0.05, 'bandpass', 1400, 0.17);
}
function _sfxVoidRift(ctx, out, t) {
    _tone (ctx, out, t,        [ 50, 180], 'sawtooth', 0.38, 0.01, 0.38);
    _tone (ctx, out, t,        [ 75, 270], 'sawtooth', 0.22, 0.01, 0.38);
    _tone (ctx, out, t + 0.06, [1600,400], 'sine',     0.13, 0.01, 0.28);
    _noise(ctx, out, t + 0.02, 0.28, 'bandpass',  600, 0.18);
    _noise(ctx, out, t + 0.30, 0.10, 'lowpass',  2000, 0.28);
}

/* CYAN — Cryo */
function _sfxPermafrost(ctx, out, t) {
    [1200, 1600, 2100, 2800].forEach((f, i) =>
        _tone(ctx, out, t + i * 0.04, f, 'triangle', 0.15, 0.005, 0.08));
    _noise(ctx, out, t, 0.28, 'highpass', 5000, 0.13);
}
function _sfxIceWall(ctx, out, t) {
    _tone (ctx, out, t,        [320, 80], 'triangle', 0.32, 0.005, 0.18);
    _tone (ctx, out, t,         2400,     'triangle', 0.11, 0.008, 0.22);
    _tone (ctx, out, t + 0.02,  3200,     'triangle', 0.07, 0.008, 0.18);
    _noise(ctx, out, t + 0.05, 0.32, 'highpass', 4000, 0.09);
}
function _sfxAbsoluteZero(ctx, out, t) {
    _tone(ctx, out, t, [180, 60], 'sine', 0.42, 0.01, 0.55);
    for (let i = 0; i < 8; i++)
        _tone(ctx, out, t + i * 0.04, 800 + i * 220, 'triangle', 0.11, 0.003, 0.06);
    _noise(ctx, out, t + 0.10, 0.50, 'highpass', 6000, 0.11);
}

/* ORANGE — Napalm */
function _sfxIgnite(ctx, out, t) {
    _tone (ctx, out, t,        [280, 80], 'sine', 0.42, 0.008, 0.18);
    _noise(ctx, out, t + 0.02, 0.25, 'bandpass', 1200, 0.20);
    _noise(ctx, out, t + 0.08, 0.18, 'highpass', 3000, 0.13);
}
function _sfxEmber(ctx, out, t) {
    _tone (ctx, out, t, [380, 180], 'triangle', 0.28, 0.005, 0.12);
    _tone (ctx, out, t,  760,       'triangle', 0.11, 0.005, 0.08);
    _noise(ctx, out, t + 0.05, 0.22, 'bandpass', 800, 0.13);
}
function _sfxEncircle(ctx, out, t) {
    _noise(ctx, out, t, 0.45, 'bandpass', 700, 0.26);
    _tone (ctx, out, t, [120, 280], 'sawtooth', 0.20, 0.03, 0.42);
    for (let i = 0; i < 4; i++)
        _noise(ctx, out, t + i * 0.07, 0.06, 'bandpass', 1500 + i * 300, 0.15);
}

/* LIME — Venom */
function _sfxCorrode(ctx, out, t) {
    _noise(ctx, out, t,        0.30, 'bandpass', 2500, 0.28);
    _noise(ctx, out, t + 0.05, 0.22, 'highpass', 4000, 0.18);
    for (let i = 0; i < 4; i++)
        _tone(ctx, out, t + i * 0.05, [300 - i * 40, 150 - i * 20], 'sine', 0.13, 0.006, 0.06);
}
function _sfxInfect(ctx, out, t) {
    _tone (ctx, out, t,        [200, 70], 'sine',     0.30, 0.005, 0.15);
    _noise(ctx, out, t,        0.08, 'bandpass',  600, 0.20);
    _noise(ctx, out, t + 0.06, 0.32, 'bandpass', 1800, 0.15);
    _tone (ctx, out, t + 0.04, [900, 400], 'triangle', 0.09, 0.01, 0.25);
}
function _sfxDecay(ctx, out, t) {
    _tone (ctx, out, t,       [240, 60], 'sawtooth', 0.38, 0.005, 0.22);
    _noise(ctx, out, t,        0.10, 'lowpass', 2000, 0.26);
    for (let i = 0; i < 6; i++) {
        const ti = t + 0.06 + i * 0.045;
        _noise(ctx, out, ti, 0.05, 'bandpass', 1400 + i * 180, 0.14);
        _tone (ctx, out, ti, [180 - i * 15, 60], 'sine', 0.11, 0.005, 0.08);
    }
}

/* ── Dispatch ── */
const _NR_SFX = {
    carpet_bomb: _sfxCarpetBomb,   airstrike: _sfxAirstrike,     detonation_wave: _sfxDetonationWave,
    undertow:    _sfxUndertow,     tidal_wave: _sfxTidalWave,    riptide:         _sfxRiptide,
    overgrowth:  _sfxOvergrowth,   creep:      _sfxCreep,        pandemic:        _sfxPandemic,
    surge:       _sfxSurge,        static_field: _sfxStaticField, blackout:       _sfxBlackout,
    phantom_step: _sfxPhantomStep, swap:       _sfxSwap,         void_rift:       _sfxVoidRift,
    permafrost:  _sfxPermafrost,   ice_wall:   _sfxIceWall,      absolute_zero:   _sfxAbsoluteZero,
    ignite:      _sfxIgnite,       ember:      _sfxEmber,        encircle:        _sfxEncircle,
    corrode:     _sfxCorrode,      infect:     _sfxInfect,       decay:           _sfxDecay,
};

window.sfxNR = function (abilId) {
    const fn = _NR_SFX[abilId];
    if (!fn) return;
    const ctx = _nrGetCtx();
    _nrResume(ctx);
    const out = _nrMakeOut(ctx);
    fn(ctx, out, ctx.currentTime);
};
