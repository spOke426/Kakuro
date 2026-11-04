(() => {
  'use strict';

  function create({ soundButton, celebrationHost, musicHost, musicStatus, musicButton, settingsKey, isActive }) {
    const videoId = 'SP0RCMtfm4o';
    const canEmbed = /^https?:$/.test(location.protocol);
    let enabled = true, engaged = false, reminded = false;
    let idleTimer = null, celebrationTimer = null, clipTimer = null, loadTimer = null, startTimer = null;
    let player = null, apiScript = null, generation = 0;
    let ready = false, loading = false, failed = false, wanted = false, clipStarted = false;
    try { enabled = JSON.parse(localStorage.getItem(settingsKey) || '{}').soundEnabled !== false; }
    catch { /* Sound controls still work when storage is unavailable. */ }

    function updateButton() {
      soundButton.disabled = !canEmbed;
      soundButton.setAttribute('aria-pressed', String(Boolean(canEmbed && enabled)));
      const label = !canEmbed ? 'Open the hosted game to enable music' : enabled ? 'Mute idle music' : 'Enable idle music';
      soundButton.setAttribute('aria-label', label);
      soundButton.title = label;
    }

    function showStatus() {
      musicButton.hidden = !failed || !enabled;
      musicButton.textContent = 'Retry music';
      musicStatus.textContent = !canEmbed ? 'Music needs the hosted game or local preview server.'
        : !enabled ? 'Idle music is muted. Use the speaker button to enable it.'
        : failed ? 'YouTube could not load this track. Retry or open the link below.'
        : loading ? 'Loading your soundtrack from YouTube…'
        : 'Starts after 10 seconds without a digit. Plays for up to 10 seconds.';
    }

    function stopSound() {
      wanted = false; clipStarted = false;
      clearTimeout(clipTimer); clearTimeout(startTimer);
      clipTimer = null; startTimer = null;
      try { if (ready) player.pauseVideo(); }
      catch { /* A disconnected player must not interrupt the puzzle. */ }
      showStatus();
    }

    function failMusic() {
      generation++; failed = true; loading = false;
      clearTimeout(loadTimer); loadTimer = null;
      stopSound(); ready = false;
      try { player?.destroy(); } catch { /* The iframe may already be gone. */ }
      player = null; apiScript?.remove(); apiScript = null;
      musicHost.textContent = 'Soundtrack unavailable';
    }

    function blockedPlayback() {
      clearTimeout(startTimer); startTimer = null;
      if (!wanted || !enabled || !isActive()) return;
      musicStatus.textContent = 'Your browser needs a tap to play sound. Press Play music or the video’s play button.';
      musicButton.textContent = 'Play music'; musicButton.hidden = false;
    }

    function playMusic() {
      if (!wanted || !ready || !enabled || !isActive()) return;
      try {
        musicStatus.textContent = 'Starting The Dark Night…'; musicButton.hidden = true;
        clearTimeout(startTimer);
        startTimer = setTimeout(blockedPlayback, 15000);
        player.seekTo(0, true); player.unMute(); player.playVideo();
      } catch { failMusic(); }
    }

    function loadMusic() {
      if (!canEmbed || !enabled || ready || loading || failed) return;
      loading = true; showStatus();
      const request = ++generation;
      let mounted = false;
      loadTimer = setTimeout(() => { if (request === generation) failMusic(); }, 20000);
      function mountPlayer() {
        if (request !== generation || mounted) return;
        mounted = true;
        try {
          const frame = document.createElement('iframe');
          frame.id = 'idle-music-player'; frame.title = 'The Dark Night — YouTube music player';
          frame.width = '320'; frame.height = '220';
          frame.allow = 'autoplay; encrypted-media; picture-in-picture; fullscreen';
          frame.allowFullscreen = true;
          // Preserve an origin referrer for YouTube's embedded-player identification.
          frame.referrerPolicy = 'strict-origin-when-cross-origin';
          const url = new URL(`https://www.youtube.com/embed/${videoId}`);
          url.search = new URLSearchParams({ enablejsapi: '1', origin: location.origin, autoplay: '0', playsinline: '1', rel: '0' });
          frame.src = url.href;
          musicHost.replaceChildren(frame);
          player = new window.YT.Player(frame, { events: {
            onReady(event) {
              if (request !== generation) return;
              player = event.target; ready = true; loading = false;
              clearTimeout(loadTimer); loadTimer = null;
              showStatus();
              if (wanted) playMusic();
            },
            onStateChange(event) {
              if (request !== generation) return;
              if (event.data === 1) {
                // Late playback after a digit, mute, pause, or completion must stay silent.
                if (!wanted || !enabled || !isActive()) { stopSound(); return; }
                clearTimeout(startTimer); startTimer = null;
                musicButton.hidden = true; musicStatus.textContent = 'Playing The Dark Night. Enter a digit to stop.';
                if (!clipStarted) {
                  clipStarted = true;
                  clipTimer = setTimeout(stopSound, 10000);
                }
              } else if (event.data === 0 || (event.data === 2 && clipStarted)) {
                stopSound();
              }
            },
            onAutoplayBlocked() { if (request === generation) blockedPlayback(); },
            onError() { if (request === generation) failMusic(); },
          } });
        } catch { failMusic(); }
      }
      if (window.YT?.Player) { mountPlayer(); return; }
      window.onYouTubeIframeAPIReady = mountPlayer;
      apiScript = document.createElement('script');
      apiScript.src = 'https://www.youtube.com/iframe_api'; apiScript.async = true;
      apiScript.onerror = () => { if (request === generation) failMusic(); };
      document.head.appendChild(apiScript);
    }

    function cancelIdle() {
      if (idleTimer !== null) clearTimeout(idleTimer);
      idleTimer = null;
    }

    function sync() {
      if (!canEmbed || !enabled || !engaged || !isActive()) {
        cancelIdle(); stopSound(); return;
      }
      if (reminded || idleTimer !== null) return;
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (!enabled || !engaged || !isActive()) return;
        reminded = true;
        if (failed) return;
        wanted = true;
        playMusic();
      }, 10000);
    }

    function interact() {
      engaged = true;
      loadMusic(); sync();
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
    musicButton.addEventListener('click', () => {
      if (failed) { failed = false; reminded = false; cancelIdle(); loadMusic(); sync(); }
      else playMusic();
    });
    celebrationHost.addEventListener('close', clearCelebration);
    updateButton(); showStatus();
    return Object.freeze({ interact, digitEntered, sync, celebrate, clearCelebration, reset });
  }

  globalThis.KakuroFeedback = Object.freeze({ create });
})();
