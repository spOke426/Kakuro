(() => {
  'use strict';

  function create({ soundButton, celebrationHost, settingsKey, isActive }) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    let enabled = true, engaged = false, reminded = false;
    let idleTimer = null, celebrationTimer = null, context = null;
    const voices = new Set();
    try { enabled = JSON.parse(localStorage.getItem(settingsKey) || '{}').soundEnabled !== false; }
    catch { /* Sound controls still work when storage is unavailable. */ }

    function updateButton() {
      soundButton.disabled = !Audio;
      soundButton.setAttribute('aria-pressed', String(Boolean(Audio && enabled)));
      const label = !Audio ? 'Idle music unavailable in this browser' : enabled ? 'Mute idle music' : 'Enable idle music';
      soundButton.setAttribute('aria-label', label);
      soundButton.title = label;
    }

    function unlockAudio() {
      if (!enabled || !Audio) return;
      try {
        if (!context || context.state === 'closed') context = new Audio();
        // Called from a click or key press to comply with browser autoplay rules.
        if (context.state !== 'running') context.resume().catch(() => {});
      } catch { /* Audio restrictions must never interrupt the puzzle. */ }
    }

    function stopSound() {
      for (const voice of voices) {
        try { voice.oscillator.stop(); voice.oscillator.disconnect(); voice.gain.disconnect(); }
        catch { /* A voice may already have ended. */ }
      }
      voices.clear();
    }

    function suspenseMusic() {
      if (!context || context.state !== 'running') return;
      try {
        const origin = context.currentTime;
        function tone(offset, duration, type, from, to, volume, attack = 0.012) {
          const at = origin + offset;
          const oscillator = context.createOscillator(), gain = context.createGain();
          const voice = { oscillator, gain };
          oscillator.type = type;
          oscillator.frequency.setValueAtTime(from, at);
          oscillator.frequency.exponentialRampToValueAtTime(to, at + duration);
          gain.gain.setValueAtTime(0, at);
          gain.gain.linearRampToValueAtTime(volume, at + attack);
          gain.gain.exponentialRampToValueAtTime(0.0001, at + duration);
          oscillator.connect(gain); gain.connect(context.destination);
          oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); voices.delete(voice); };
          voices.add(voice);
          oscillator.start(at); oscillator.stop(at + duration + 0.02);
        }

        // Original four-bar suspense score at 100 BPM: D minor, B-flat, G minor, A7.
        // Arpeggios, bass, and percussion share a musical pulse; the last bar builds tension.
        const hz = midi => 440 * 2 ** ((midi - 69) / 12);
        const step = 0.3, barLength = 2.4;
        const bars = [
          { bass: 38, chord: [50, 53, 57], melody: [62, 65, 69, 65, 62, 65, 69, 72] },
          { bass: 34, chord: [46, 50, 53], melody: [58, 62, 65, 62, 58, 62, 65, 69] },
          { bass: 31, chord: [43, 46, 50], melody: [55, 58, 62, 58, 62, 65, 67, 70] },
          { bass: 33, chord: [45, 49, 52, 55], melody: [57, 61, 64, 67, 69, 73, 76, 79] },
        ];
        bars.forEach((bar, index) => {
          const start = index * barLength;
          for (const note of bar.chord) {
            const frequency = hz(note);
            tone(start, index === 3 ? 2.7 : 2.3, 'sine', frequency, frequency, 0.012, 0.28);
          }
          bar.melody.forEach((note, beat) => {
            const at = start + beat * step, frequency = hz(note);
            const lastNote = index === 3 && beat === 7;
            tone(at, lastNote ? 0.68 : 0.25, 'triangle', frequency, frequency, 0.033 + index * 0.004);
            // Short high percussion adds urgency without overpowering the melody.
            tone(at, 0.055, 'triangle', 5200, 3100, beat % 2 ? 0.008 : 0.005, 0.004);
            if (beat % 2 === 0) {
              tone(at, 0.22, 'sine', 108, 40, beat % 4 === 0 ? 0.11 : 0.08);
              const bass = hz(bar.bass);
              tone(at, 0.5, 'triangle', bass, bass, 0.045);
              if (index >= 2) tone(at + 0.14, 0.13, 'sine', 78, 36, 0.05);
            }
          });
        });
        // The final melody note fades at ten seconds; nothing loops or downloads.
      } catch { stopSound(); }
    }

    function cancelIdle() {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
    }

    function sync() {
      if (!Audio || !enabled || !engaged || !isActive()) {
        cancelIdle(); stopSound(); return;
      }
      if (reminded || idleTimer !== null) return;
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (!enabled || !engaged || !isActive()) return;
        reminded = true;
        suspenseMusic();
      }, 10000);
    }

    function interact() {
      engaged = true;
      unlockAudio(); sync();
    }

    function digitEntered() {
      cancelIdle(); stopSound(); reminded = false;
      interact();
    }

    function clearCelebration() {
      if (celebrationTimer !== null) clearTimeout(celebrationTimer);
      celebrationTimer = null;
      celebrationHost.querySelector('.confetti-layer')?.remove();
    }

    function celebrate() {
      clearCelebration();
      if (document.hidden || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
      const layer = document.createElement('div');
      layer.className = 'confetti-layer'; layer.setAttribute('aria-hidden', 'true');
      const colors = ['#8e78e8', '#e7ac55', '#66b69d', '#dc779f', '#80b7dd', '#b6a2f3'];
      for (let i = 0; i < 96; i++) {
        const piece = document.createElement('i'); piece.className = 'confetti-piece';
        piece.style.left = `${Math.random() * 100}%`;
        piece.style.backgroundColor = colors[i % colors.length];
        piece.style.setProperty('--drift', `${Math.random() * 180 - 90}px`);
        piece.style.setProperty('--spin', `${Math.random() * 1080 - 540}deg`);
        piece.style.setProperty('--fall-time', `${2.6 + Math.random() * 1.4}s`);
        piece.style.setProperty('--delay', `${Math.random() * 0.4}s`);
        if (i % 3 === 0) piece.classList.add('round');
        layer.appendChild(piece);
      }
      // The win dialog is in the browser's top layer; its confetti must be there too.
      celebrationHost.appendChild(layer);
      celebrationTimer = setTimeout(clearCelebration, 4600);
    }

    function reset() {
      cancelIdle(); stopSound(); clearCelebration();
      engaged = false; reminded = false;
    }

    soundButton.addEventListener('click', () => {
      enabled = !enabled;
      try { localStorage.setItem(settingsKey, JSON.stringify({ soundEnabled: enabled })); }
      catch { /* Preference remains available for this visit. */ }
      cancelIdle(); stopSound(); reminded = false;
      updateButton();
      if (enabled) interact();
    });
    celebrationHost.addEventListener('close', clearCelebration);
    updateButton();
    return Object.freeze({ interact, digitEntered, sync, celebrate, clearCelebration, reset });
  }

  globalThis.KakuroFeedback = Object.freeze({ create });
})();
