/**
 * Chain Reaction — Procedural SFX
 * Piggybacks on the MIDI player's AudioContext (window.crAudioCtx).
 * Falls back to its own context if music hasn't started yet.
 */

'use strict';

/* ── Get or create an AudioContext ── */
function sfxCtx() {
    if (window.crAudioCtx && window.crAudioCtx.state !== 'closed') return window.crAudioCtx;
    if (!window._sfxCtx) window._sfxCtx = new (window.AudioContext || window.webkitAudioContext)();
    return window._sfxCtx;
}

/* ── Master SFX gain (lets user mute SFX independently if desired) ── */
let _sfxMasterGain = null;
function sfxOut() {
    const ctx = sfxCtx();
    if (!_sfxMasterGain || _sfxMasterGain.context !== ctx) {
        _sfxMasterGain = ctx.createGain();
        _sfxMasterGain.gain.value = 0.55;
        _sfxMasterGain.connect(ctx.destination);
    }
    return _sfxMasterGain;
}

/* ── Resume context on first interaction (browser autoplay policy) ── */
function sfxResume() {
    const ctx = sfxCtx();
    if (ctx.state === 'suspended') ctx.resume();
}

/* ════════════════════════════════════════════════════════════════
   SFX 1 — PLACE ORB
   Closed hi-hat: mix of detuned square oscillators through
   a highpass filter — classic metallic transient.
   ════════════════════════════════════════════════════════════════ */
window.sfxPlace = function () {
    sfxResume();
    const ctx = sfxCtx();
    const out = sfxOut();
    const now = ctx.currentTime;

    /* Six detuned square oscillators mixed together = metallic noise */
    const freqs = [205, 310, 412, 518, 723, 989];
    const merge = ctx.createGain();
    merge.gain.value = 1 / freqs.length;
    freqs.forEach(f => {
        const o = ctx.createOscillator();
        o.type = 'square';
        o.frequency.value = f;
        o.connect(merge);
        o.start(now); o.stop(now + 0.06);
    });

    /* Highpass to cut the low rumble and keep it crisp */
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 6000;

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.18, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);

    merge.connect(hp); hp.connect(env); env.connect(out);
};

/* ════════════════════════════════════════════════════════════════
   SFX 2 — EXPLOSION
   Culled: only one instance plays at a time to avoid stacking.
   Bubble pop: short sine pitch drop with soft attack.
   ════════════════════════════════════════════════════════════════ */
let _explodePlaying = false;
window.sfxExplode = function (count = 1) {
    if (_explodePlaying) return;
    _explodePlaying = true;
    sfxResume();
    const ctx = sfxCtx();
    const out = sfxOut();
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'sine';
    /* Pitch drops fast from ~800 Hz down — classic bubble pop shape */
    osc.frequency.setValueAtTime(780, now);
    osc.frequency.exponentialRampToValueAtTime(120, now + 0.08);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(0.32, now + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);
    osc.connect(env); env.connect(out);
    osc.start(now); osc.stop(now + 0.1);
    osc.onended = () => { _explodePlaying = false; };
};

/* ════════════════════════════════════════════════════════════════
   SFX 3 — CHAIN STEP
   Rising pitched ping per combo step. Caps at step 5.
   ════════════════════════════════════════════════════════════════ */
window.sfxChain = function (step = 1) {
    sfxResume();
    const ctx = sfxCtx();
    const out = sfxOut();
    const now = ctx.currentTime;

    /* Cap pitch progression at step 5 */
    const cappedStep = Math.min(step, 5);
    const semitones = (cappedStep - 1) * 3;
    const baseFreq = 330 * Math.pow(2, semitones / 12);
    const decay = Math.max(0.10, 0.22 - cappedStep * 0.012);
    const vol = Math.min(0.50, 0.22 + cappedStep * 0.03);

    /* Main tone */
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 1.6, now + decay * 0.3);
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(vol, now + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);

    /* High-pass to keep it bright */
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass'; hp.frequency.value = 400;

    osc.connect(hp); hp.connect(env); env.connect(out);
    osc.start(now); osc.stop(now + decay + 0.01);

    /* Harmonic shimmer on higher steps */
    if (cappedStep >= 4) {
        const osc2 = ctx.createOscillator();
        const env2 = ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.value = baseFreq * 2.01;
        env2.gain.setValueAtTime(0.0001, now);
        env2.gain.linearRampToValueAtTime(vol * 0.35, now + 0.008);
        env2.gain.exponentialRampToValueAtTime(0.0001, now + decay * 0.7);
        osc2.connect(env2); env2.connect(out);
        osc2.start(now); osc2.stop(now + decay + 0.01);
    }
};

/* ════════════════════════════════════════════════════════════════
   SFX 4 — WIN FANFARE
   Bright ascending arpeggio: C5 → E5 → G5 → C6.
   ════════════════════════════════════════════════════════════════ */
window.sfxWin = function () {
    sfxResume();
    const ctx = sfxCtx();
    const out = sfxOut();

    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5 E5 G5 C6
    const spacing = 0.13;

    notes.forEach((freq, i) => {
        const t = ctx.currentTime + i * spacing;
        const osc  = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const env  = ctx.createGain();

        osc.type  = 'triangle'; osc.frequency.value  = freq;
        osc2.type = 'sine';     osc2.frequency.value = freq * 2;

        const dur = i === notes.length - 1 ? 0.6 : 0.18;
        env.gain.setValueAtTime(0.0001, t);
        env.gain.linearRampToValueAtTime(0.38, t + 0.01);
        env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

        osc.connect(env); osc2.connect(env); env.connect(out);
        osc.start(t);  osc.stop(t + dur + 0.01);
        osc2.start(t); osc2.stop(t + dur + 0.01);
    });
};


