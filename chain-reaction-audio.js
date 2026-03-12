/**
 * Chain Reaction — Background Music
 * Three looping OGG tracks switched per screen.
 *
 *   audio/menu.ogg          — Main menu + online lobby
 *   audio/singleplayer.ogg  — In-game singleplayer
 *   audio/multiplayer.ogg   — In-game online multiplayer
 */
'use strict';
(function () {
    const TRACKS = {
        menu:         './audio/menu.ogg',
        singleplayer: './audio/singleplayer.ogg',
        multiplayer:  './audio/multiplayer.ogg',
    };
    const FADE_MS = 600;

    function savedMusicVol() {
        try { const s = JSON.parse(localStorage.getItem('cr_settings') || '{}');
              return (s.musicVol !== undefined ? s.musicVol : 50) / 100; }
        catch (e) { return 0.5; }
    }

    let targetVolume = savedMusicVol();
    let currentKey = null, unlocked = false, pendingKey = null;

    const audios = {};
    Object.entries(TRACKS).forEach(([key, src]) => {
        const a = new Audio(); a.src = src; a.loop = true; a.volume = 0; a.preload = 'auto';
        audios[key] = a;
    });

    function fadeTo(audio, toVol, ms, onDone) {
        const steps = 30, interval = ms / steps;
        const from = audio.volume, delta = (toVol - from) / steps;
        let step = 0;
        const t = setInterval(() => {
            step++;
            audio.volume = Math.max(0, Math.min(1, from + delta * step));
            if (step >= steps) { clearInterval(t); audio.volume = toVol; if (onDone) onDone(); }
        }, interval);
    }

    function switchTo(key) {
        if (!key || !audios[key] || key === currentKey) return;
        const incoming = audios[key], outgoing = currentKey ? audios[currentKey] : null;
        if (outgoing) fadeTo(outgoing, 0, FADE_MS, () => { outgoing.pause(); outgoing.currentTime = 0; });
        incoming.currentTime = 0; incoming.volume = 0;
        incoming.play().then(() => fadeTo(incoming, targetVolume, FADE_MS))
                       .catch(() => { pendingKey = key; });
        currentKey = key;
    }

    function screenToKey(s) {
        if (s === 'game-online') return 'multiplayer';
        if (s === 'game-single') return 'singleplayer';
        return 'menu';
    }

    function unlock() {
        if (unlocked) return; unlocked = true;
        if (pendingKey) { const k = pendingKey; pendingKey = null; currentKey = null; switchTo(k); }
    }
    ['touchstart','mousedown','keydown'].forEach(e => document.addEventListener(e, unlock, {once:true,passive:true}));
    window._crAudioUnlock = unlock; // exposed for intro screen

    window.moveMusicPlayer = function (screen) {
        const key = screenToKey(screen);
        if (!unlocked) { pendingKey = key; return; }
        switchTo(key);
    };

    window.setMusicVolume = function (v) {
        targetVolume = Math.max(0, Math.min(1, v));
        if (currentKey && audios[currentKey] && !audios[currentKey].paused)
            audios[currentKey].volume = targetVolume;
    };

    pendingKey = 'menu';
})();
