(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ==================== 1. DISCOVERY DIAL DEMO (MATCHES APP 5-STEP SCALE) ==================== */
  const dialInput = document.querySelector('#discovery-dial');
  const dialLabel = document.querySelector('#dial-mode-label');
  const dialDesc = document.querySelector('#dial-mode-desc');

  if (dialInput && dialLabel && dialDesc) {
    const DIAL_STEPS = [
      {
        label: 'Familiar',
        desc: 'Stays closest to your starting song with favorites, highly rated songs, and artists you already return to most.'
      },
      {
        label: 'Mostly familiar',
        desc: 'Leans on favorites near your starting song, mixing in a few album cuts you have not heard recently.'
      },
      {
        label: 'A mix',
        desc: 'Blends favorite songs near your starting song with unplayed album cuts from related genres. Songs you vote down move to Played less.'
      },
      {
        label: 'Mostly new',
        desc: 'Pulls mostly lesser-played albums and deeper cuts connected to your starting song, anchored by an occasional favorite.'
      },
      {
        label: 'New to you',
        desc: 'Reaches across your collection for rarely played albums, B-sides, and forgotten songs connected to your starting song.'
      }
    ];

    const updateDial = () => {
      const idx = Math.max(0, Math.min(DIAL_STEPS.length - 1, Number(dialInput.value) || 0));
      const step = DIAL_STEPS[idx];
      dialInput.setAttribute('aria-valuetext', step.label);
      dialLabel.textContent = step.label;
      dialDesc.textContent = step.desc;
    };
    dialInput.addEventListener('input', updateDial);
    updateDial();
  }

  /* ==================== 2. INTERACTIVE LIVE EQ VISUALIZER ==================== */
  const canvas = document.querySelector('#eq-visualizer-canvas');
  const canvasWrap = canvas?.closest('.viz-canvas-wrap');
  if (canvas && canvasWrap && canvas.getContext) {
    const ctx = canvas.getContext('2d');
    const readout = document.querySelector('#viz-readout');
    const toggleBtn = document.querySelector('#viz-play-toggle');
    const paletteLabel = document.querySelector('#viz-palette-label');
    const styleButtons = [...document.querySelectorAll('[data-viz-styles] .chip')];
    const paletteButtons = [...document.querySelectorAll('[data-viz-palettes] .chip')];

    // Exact 5-stop color presets matching app/ui/app.css (--heat-0..4) and crates/elysonic-core/src/eq_display.rs
    const PALETTES = {
      elysonic:  { name: 'Elysonic',  stops: ['#3B2C9A', '#8E2A8F', '#E0313B', '#FF8A1F', '#FFE14D'] },
      ocean:     { name: 'Ocean',     stops: ['#1E3A8A', '#1F6FB2', '#1FA6C9', '#5FDDE0', '#D9FFF6'] },
      aurora:    { name: 'Aurora',    stops: ['#3A1F7A', '#2563A8', '#22B59A', '#8EEA7C', '#F2FF8A'] },
      ember:     { name: 'Ember',     stops: ['#5A1414', '#A3201A', '#E2461C', '#FF8A1F', '#FFD98A'] },
      synthwave: { name: 'Synthwave', stops: ['#3A0CA3', '#7209B7', '#D61F8C', '#FF5D8F', '#4CC9F0'] },
      phosphor:  { name: 'Phosphor',  stops: ['#134E2C', '#1B7A3E', '#2BB35A', '#74F08E', '#E0FFE6'] }
    };

    const STYLE_NAMES = {
      'mini-led': 'LED bars',
      classic: 'Classic',
      'analog-vu': 'Analog VU',
      solaris: 'Solaris',
      silk: 'Aurora silk',
      crt: 'CRT',
      'retro-scifi': 'Retro sci-fi',
      pulsar: 'Pulsar'
    };

    let currentStyle = 'mini-led';
    let currentPalette = 'elysonic';
    let isPlaying = !reducedMotion;
    let isVisible = false;
    let rafId = null;
    let logicalW = 960;
    let logicalH = 300;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);

    let time = 1.4;
    const BANDS = 64;
    const LED_ROWS = 20;
    const levels = new Float32Array(BANDS);
    const beforeLevels = new Float32Array(BANDS);
    const peaks = new Float32Array(BANDS);
    const pulsarHistory = [];
    let pulsarPhase = 0;
    let vuPre = 0.35;
    let vuPost = 0.48;
    let vuVelPre = 0;
    let vuVelPost = 0;
    let sphereTurn = 0.4;
    let beatCount = 42;
    let beatPulse = 0;
    let lastBeatTime = 0;

    // Lazy-sized offscreen phosphor buffer for CRT persistence
    let crtPhosphor = null;
    let crtPctx = null;

    function ensureCrtBuffer() {
      if (!crtPhosphor) {
        crtPhosphor = document.createElement('canvas');
        crtPctx = crtPhosphor.getContext('2d');
      }
      if (crtPhosphor.width !== canvas.width || crtPhosphor.height !== canvas.height) {
        crtPhosphor.width = canvas.width;
        crtPhosphor.height = canvas.height;
      }
      crtPctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function hexToRgb(hex) {
      const n = parseInt(hex.slice(1), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    }

    function sampleRamp(stops, t) {
      const p = Math.max(0, Math.min(1, t)) * (stops.length - 1);
      const i = Math.min(stops.length - 2, Math.floor(p));
      const k = p - i;
      const a = hexToRgb(stops[i]);
      const b = hexToRgb(stops[i + 1]);
      return [
        Math.round(a[0] + (b[0] - a[0]) * k),
        Math.round(a[1] + (b[1] - a[1]) * k),
        Math.round(a[2] + (b[2] - a[2]) * k)
      ];
    }

    // Precompute the 20-row RGB lookup table once per palette change (avoids 1,280 parses/frame)
    let ledRowRgb = [];
    function rebuildLedPaletteCache() {
      const stops = PALETTES[currentPalette].stops;
      ledRowRgb = Array.from({ length: LED_ROWS }, (_, r) => sampleRamp(stops, r / (LED_ROWS - 1)));
    }
    rebuildLedPaletteCache();

    function eqCurveShare(norm) {
      const bass = 0.16 * Math.exp(-Math.pow((norm - 0.12) * 4.2, 2));
      const dip = -0.05 * Math.exp(-Math.pow((norm - 0.36) * 5.0, 2));
      const presence = 0.11 * Math.exp(-Math.pow((norm - 0.7) * 4.5, 2));
      const air = -0.06 * Math.pow(Math.max(0, norm - 0.82) / 0.18, 1.5);
      return Math.max(0.08, Math.min(0.92, 0.52 + bass + dip + presence + air));
    }

    function syncCanvasSize() {
      const rect = canvasWrap.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      logicalW = Math.round(rect.width);
      logicalH = Math.round(rect.height);
      const backingW = Math.max(1, Math.round(logicalW * dpr));
      const backingH = Math.max(1, Math.round(logicalH * dpr));
      if (canvas.width !== backingW || canvas.height !== backingH) {
        canvas.width = backingW;
        canvas.height = backingH;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (crtPhosphor) {
        crtPhosphor.width = backingW;
        crtPhosphor.height = backingH;
      }
      renderFrame(0);
    }

    function updateReadoutAndPalettes() {
      const isRetro = currentStyle === 'retro-scifi';
      if (readout) {
        const palLabel = isRetro ? 'Console Film Palette' : `${PALETTES[currentPalette].name} Palette`;
        readout.textContent = `${STYLE_NAMES[currentStyle]} · ${palLabel} · Silent preview`;
      }
      if (paletteLabel) {
        paletteLabel.textContent = isRetro
          ? 'Retro sci-fi uses its own 1970s console palette'
          : 'Pick a color theme (custom themes in the app)';
      }
      for (const btn of paletteButtons) {
        btn.disabled = isRetro;
      }
    }

    styleButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        currentStyle = btn.dataset.style;
        styleButtons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        updateReadoutAndPalettes();
        if (!rafId) renderFrame(0);
      });
    });

    paletteButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        if (btn.disabled) return;
        currentPalette = btn.dataset.palette;
        rebuildLedPaletteCache();
        paletteButtons.forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        updateReadoutAndPalettes();
        if (!rafId) renderFrame(0);
      });
    });

    function syncLoop() {
      const shouldRun = isPlaying && isVisible && !document.hidden;
      if (shouldRun && !rafId) {
        last = performance.now();
        rafId = requestAnimationFrame(loop);
      } else if (!shouldRun && rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
      }
    }

    if (toggleBtn) {
      if (!isPlaying) {
        toggleBtn.textContent = 'Resume motion';
        toggleBtn.setAttribute('aria-pressed', 'false');
      }
      toggleBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        toggleBtn.textContent = isPlaying ? 'Pause motion' : 'Resume motion';
        toggleBtn.setAttribute('aria-pressed', String(isPlaying));
        syncLoop();
      });
    }

    function makeVerticalGradient(h) {
      const grad = ctx.createLinearGradient(0, h, 0, 14);
      const stops = PALETTES[currentPalette].stops;
      stops.forEach((c, idx) => grad.addColorStop(idx / (stops.length - 1), c));
      return grad;
    }

    function stepNeedle(pos, vel, target, dt) {
      const k = target > pos ? 210 : 115;
      const damp = target > pos ? 19 : 15;
      const acc = (target - pos) * k - vel * damp;
      let nv = vel + acc * dt;
      let np = pos + nv * dt;
      if (np < 0) { np = 0; nv = 0; }
      if (np > 1.04) { np = 1.04; nv *= -0.2; }
      return [np, nv];
    }

    function stepSignal(dt) {
      time += dt;
      sphereTurn = (sphereTurn + dt * (Math.PI * 2 / 40)) % (Math.PI * 2);
      const beatWave = Math.sin(time * 3.9);
      if (beatWave > 0.94 && time - lastBeatTime > 0.42) {
        beatCount++;
        beatPulse = 1;
        lastBeatTime = time;
      } else {
        beatPulse = Math.max(0, beatPulse - dt * 4);
      }

      for (let i = 0; i < BANDS; i++) {
        const norm = i / (BANDS - 1);
        const bassWeight = Math.exp(-Math.pow((norm - 0.14) * 3.1, 2));
        const midWeight = Math.exp(-Math.pow((norm - 0.48) * 3.4, 2));
        const highWeight = Math.exp(-Math.pow((norm - 0.8) * 3.8, 2));

        const beat = Math.pow(Math.max(0, Math.sin(time * 3.9 - norm * 1.4)), 2);
        const raw =
          0.14 +
          bassWeight * (0.40 + 0.34 * beat) +
          midWeight * (0.33 + 0.30 * Math.abs(Math.sin(time * 2.6 + i * 0.28))) +
          highWeight * (0.16 + 0.22 * Math.abs(Math.cos(time * 5.2 + i * 0.52))) +
          0.08 * Math.sin(time * 7.1 + i * 0.74);

        const pre = Math.max(0.05, Math.min(0.92, raw));
        const eqDelta = (eqCurveShare(norm) - 0.52) * 0.85;
        const post = Math.max(0.06, Math.min(0.96, pre + eqDelta));
        const k = Math.min(1, dt * 14 || 1);
        beforeLevels[i] += (pre - beforeLevels[i]) * k;
        levels[i] += (post - levels[i]) * k;
        peaks[i] = Math.max(levels[i], peaks[i] - dt * 0.30);
      }

      let sumPre = 0;
      let sumPost = 0;
      for (let i = 0; i < BANDS; i++) {
        sumPre += beforeLevels[i];
        sumPost += levels[i];
      }
      const targetPre = Math.min(0.96, (sumPre / BANDS) * 1.42);
      const targetPost = Math.min(0.98, (sumPost / BANDS) * 1.56);
      if (dt > 0) {
        [vuPre, vuVelPre] = stepNeedle(vuPre, vuVelPre, targetPre, dt);
        [vuPost, vuVelPost] = stepNeedle(vuPost, vuVelPost, targetPost, dt);
        pulsarPhase += dt * 12;
        while (pulsarPhase >= 1) {
          pulsarPhase -= 1;
          pulsarHistory.unshift(Float32Array.from(levels));
          if (pulsarHistory.length > 36) pulsarHistory.pop();
        }
      } else if (pulsarHistory.length === 0) {
        for (let r = 0; r < 36; r++) {
          const snap = new Float32Array(BANDS);
          for (let i = 0; i < BANDS; i++) {
            const norm = i / (BANDS - 1);
            snap[i] = Math.max(0.06, Math.min(0.92, levels[i] * (0.75 + 0.25 * Math.sin(r * 0.5 + norm * 6))));
          }
          pulsarHistory.push(snap);
        }
      }
    }

    function renderFrame(dt) {
      stepSignal(dt);
      const w = logicalW;
      const h = logicalH;
      const stops = PALETTES[currentPalette].stops;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#090a0d';
      ctx.fillRect(0, 0, w, h);

      const padX = Math.max(10, Math.round(w * 0.02));
      const usableW = w - padX * 2;

      if (currentStyle === 'mini-led') {
        const cols = w < 520 ? 32 : 64;
        const rows = LED_ROWS;
        const cellW = usableW / cols;
        const cellH = (h - 20) / rows;
        const gapX = Math.max(1.2, cellW * 0.14);
        const gapY = Math.max(1.2, cellH * 0.14);
        const cw = Math.max(2, cellW - gapX);
        const ch = Math.max(2, cellH - gapY);

        for (let c = 0; c < cols; c++) {
          const norm = c / (cols - 1);
          const bandIdx = Math.round(norm * (BANDS - 1));
          const curveRow = Math.round(eqCurveShare(norm) * (rows - 1));
          const litRows = levels[bandIdx] * rows;
          const peakRow = Math.min(rows - 1, Math.floor(peaks[bandIdx] * rows));
          const preRow = Math.min(rows - 1, Math.floor(beforeLevels[bandIdx] * rows));
          const x = padX + c * cellW + gapX / 2;

          for (let r = 0; r < rows; r++) {
            const y = h - 10 - (r + 1) * cellH + gapY / 2;
            const [R, G, B] = ledRowRgb[r];
            const on = litRows - r;
            if (on >= 1) {
              ctx.fillStyle = `rgba(${R},${G},${B},0.94)`;
            } else if (on > 0) {
              ctx.fillStyle = `rgba(${R},${G},${B},${(0.18 + on * 0.76).toFixed(2)})`;
            } else if (r === peakRow) {
              ctx.fillStyle = `rgba(${R},${G},${B},0.92)`;
            } else {
              const alpha = r <= curveRow ? 0.21 : 0.085;
              ctx.fillStyle = `rgba(${R},${G},${B},${alpha})`;
            }
            ctx.fillRect(x, y, cw, ch);
            if (r === preRow) {
              ctx.fillStyle = on > 0 ? 'rgba(12,12,16,0.7)' : 'rgba(240,240,246,0.58)';
              ctx.fillRect(x, y, cw, ch);
            }
          }
        }
      } else if (currentStyle === 'classic') {
        const grad = makeVerticalGradient(h);
        ctx.strokeStyle = 'rgba(255,255,255,0.045)';
        ctx.lineWidth = 1;
        for (let g = 1; g < 10; g++) {
          const gx = padX + (g / 10) * usableW;
          ctx.beginPath(); ctx.moveTo(gx, 10); ctx.lineTo(gx, h - 12); ctx.stroke();
        }
        for (const t of [0.25, 0.5, 0.75]) {
          ctx.beginPath(); ctx.moveTo(padX, h * t); ctx.lineTo(w - padX, h * t); ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(padX, h - 12);
        for (let i = 0; i < BANDS; i++) {
          const x = padX + (i / (BANDS - 1)) * usableW;
          const y = h - 12 - levels[i] * (h - 28);
          if (i === 0) ctx.lineTo(x, y);
          else {
            const px = padX + ((i - 1) / (BANDS - 1)) * usableW;
            const py = h - 12 - levels[i - 1] * (h - 28);
            ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
          }
        }
        ctx.lineTo(w - padX, h - 12);
        ctx.closePath();
        ctx.save();
        ctx.globalAlpha = 0.36;
        ctx.fillStyle = grad;
        ctx.fill();
        ctx.restore();
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        for (let i = 0; i < BANDS; i++) {
          const x = padX + (i / (BANDS - 1)) * usableW;
          const y = h - 12 - beforeLevels[i] * (h - 28);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(240,240,246,0.45)';
        ctx.lineWidth = 1.25;
        ctx.stroke();

        ctx.beginPath();
        for (let i = 0; i < BANDS; i++) {
          const norm = i / (BANDS - 1);
          const x = padX + norm * usableW;
          const y = h - 12 - eqCurveShare(norm) * (h - 28);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(255,248,242,0.88)';
        ctx.lineWidth = 2.2;
        ctx.stroke();
        for (let b = 0; b < 10; b++) {
          const norm = (b + 0.5) / 10;
          const x = padX + norm * usableW;
          const y = h - 12 - eqCurveShare(norm) * (h - 28);
          ctx.beginPath(); ctx.arc(x, y, 4.2, 0, Math.PI * 2);
          ctx.fillStyle = '#0f1015'; ctx.fill();
          ctx.strokeStyle = stops[stops.length - 2]; ctx.lineWidth = 2; ctx.stroke();
        }
      } else if (currentStyle === 'analog-vu') {
        const ch = ctx.createLinearGradient(0, 0, 0, h);
        ch.addColorStop(0, '#1a1816');
        ch.addColorStop(1, '#0c0b0a');
        ctx.fillStyle = ch;
        ctx.fillRect(0, 0, w, h);

        const pad = Math.max(8, Math.round(Math.min(w, h) * 0.045));
        const gap = pad;
        const mw = (w - pad * 2 - gap) / 2;
        const mh = h - pad * 2;
        const vuAngle = (vu) => -Math.PI / 2 + (Math.max(0, Math.min(1, (vu + 20) / 23)) - 0.5) * 1.42;
        const marks = [[-20, '20'], [-10, '10'], [-7, '7'], [-5, '5'], [-3, '3'], [0, '0'], [1, '+1'], [2, '+2'], [3, '+3']];
        const meters = [
          { title: 'BEFORE EQ', val: vuPre },
          { title: 'WITH EQ', val: vuPost }
        ];
        const fontScale = Math.max(0.62, Math.min(1, mw / 320));
        meters.forEach((m, idx) => {
          const x = pad + idx * (mw + gap);
          const y = pad;
          const cx = x + mw / 2;
          const cy = y + mh * 1.05;
          const R = Math.min(mw * 0.68, mh * 0.84);
          ctx.save();
          ctx.beginPath();
          ctx.roundRect(x, y, mw, mh, 10);
          ctx.clip();

          const lamp = ctx.createRadialGradient(cx, y + mh * 0.12, mw * 0.05, cx, y + mh * 0.42, mw * 0.82);
          lamp.addColorStop(0, '#fff4d4');
          lamp.addColorStop(0.45, '#e7c582');
          lamp.addColorStop(0.85, '#ba8e4a');
          lamp.addColorStop(1, '#8c6630');
          ctx.fillStyle = lamp;
          ctx.fillRect(x, y, mw, mh);

          const vig = ctx.createRadialGradient(cx, y + mh * 0.45, R * 0.25, cx, y + mh * 0.55, Math.max(mw, mh) * 0.78);
          vig.addColorStop(0, 'rgba(0,0,0,0)');
          vig.addColorStop(1, 'rgba(36,22,8,0.34)');
          ctx.fillStyle = vig;
          ctx.fillRect(x, y, mw, mh);

          ctx.beginPath(); ctx.arc(cx, cy, R, vuAngle(-20), vuAngle(0));
          ctx.strokeStyle = '#241a12'; ctx.lineWidth = 2; ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, cy, R, vuAngle(0), vuAngle(3));
          ctx.strokeStyle = '#b82420'; ctx.lineWidth = 4; ctx.stroke();
          ctx.beginPath(); ctx.arc(cx, cy, R * 0.84, vuAngle(-20), vuAngle(0));
          ctx.strokeStyle = 'rgba(36,26,18,0.35)'; ctx.lineWidth = 1.2; ctx.stroke();

          ctx.font = `600 ${Math.round(12 * fontScale)}px "Plus Jakarta Sans", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          for (const [vu, label] of marks) {
            const a = vuAngle(vu);
            const red = vu >= 0;
            const inR = R * (vu === 0 || vu === -10 || vu === -20 || vu === 3 ? 0.88 : 0.92);
            ctx.beginPath();
            ctx.moveTo(cx + Math.cos(a) * inR, cy + Math.sin(a) * inR);
            ctx.lineTo(cx + Math.cos(a) * R * 1.04, cy + Math.sin(a) * R * 1.04);
            ctx.strokeStyle = red ? '#b82420' : '#241a12';
            ctx.lineWidth = vu === 0 ? 2.2 : 1.4;
            ctx.stroke();
            ctx.fillStyle = red ? '#a81d1a' : '#2b1f16';
            ctx.fillText(label, cx + Math.cos(a) * R * 1.15, cy + Math.sin(a) * R * 1.15);
          }

          ctx.font = `700 ${Math.round(24 * fontScale)}px Georgia, serif`;
          ctx.fillStyle = 'rgba(36,24,14,0.52)';
          ctx.fillText('VU', cx, y + mh * 0.56);
          ctx.font = `600 ${Math.round(11 * fontScale)}px "JetBrains Mono", monospace`;
          ctx.fillStyle = 'rgba(36,24,14,0.68)';
          ctx.fillText(m.title, cx, y + mh * 0.72);

          const vuDb = -20 + Math.pow(m.val, 0.78) * 23.2;
          const a = vuAngle(vuDb);
          const x0 = cx + Math.cos(a) * R * 0.22;
          const y0 = cy + Math.sin(a) * R * 0.22;
          const x1 = cx + Math.cos(a) * R * 1.08;
          const y1 = cy + Math.sin(a) * R * 1.08;

          ctx.beginPath(); ctx.moveTo(x0 + 3, y0 + 4); ctx.lineTo(x1 + 3, y1 + 4);
          ctx.strokeStyle = 'rgba(20,12,4,0.28)'; ctx.lineWidth = 3; ctx.lineCap = 'round'; ctx.stroke();
          ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1);
          ctx.strokeStyle = m.val > 0.78 ? '#b51f1b' : '#1b1512'; ctx.lineWidth = 2.2; ctx.stroke();

          ctx.beginPath(); ctx.arc(cx, cy, R * 0.24, Math.PI, Math.PI * 2);
          ctx.fillStyle = '#191512'; ctx.fill();

          const hot = m.val > 0.80;
          ctx.beginPath(); ctx.arc(x + mw - 16, y + 16, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = hot ? stops[stops.length - 1] : 'rgba(40,18,16,0.45)';
          if (hot) { ctx.shadowColor = stops[stops.length - 1]; ctx.shadowBlur = 12; }
          ctx.fill(); ctx.shadowBlur = 0;

          const sheen = ctx.createLinearGradient(0, y, 0, y + mh * 0.45);
          sheen.addColorStop(0, 'rgba(255,255,255,0.16)');
          sheen.addColorStop(1, 'rgba(255,255,255,0)');
          ctx.fillStyle = sheen;
          ctx.fillRect(x, y, mw, mh * 0.45);
          ctx.restore();
        });
      } else if (currentStyle === 'solaris') {
        const cx = w / 2;
        const cy = h / 2;
        const minR = Math.min(w, h);
        const bass = (levels[0] + levels[1] + levels[2] + levels[3]) / 4;
        const baseR = minR * (0.20 + 0.03 * bass);
        const reach = minR * 0.26;

        const bg = ctx.createRadialGradient(cx, cy, minR * 0.05, cx, cy, Math.hypot(w, h) * 0.55);
        bg.addColorStop(0, '#111219');
        bg.addColorStop(1, '#06070a');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        const [r0, g0, b0] = sampleRamp(stops, 0.35);
        const [r1, g1, b1] = sampleRamp(stops, 0.85);
        const aura = ctx.createRadialGradient(cx, cy, 4, cx, cy, minR * 0.44);
        aura.addColorStop(0, `rgba(${r1},${g1},${b1},${(0.24 + 0.32 * bass).toFixed(2)})`);
        aura.addColorStop(0.5, `rgba(${r0},${g0},${b0},0.14)`);
        aura.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = aura;
        ctx.fillRect(0, 0, w, h);

        ctx.save();
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.lineWidth = 1.2;
        const compassR = minR * 0.46;
        for (let i = 0; i < 36; i++) {
          const a = time * 0.16 + (i / 36) * Math.PI * 2;
          const len = i % 3 === 0 ? 7 : 3.5;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * (compassR - len), cy + Math.sin(a) * (compassR - len));
          ctx.lineTo(cx + Math.cos(a) * compassR, cy + Math.sin(a) * compassR);
          ctx.stroke();
        }
        ctx.restore();

        const radial = ctx.createRadialGradient(cx, cy, minR * 0.16, cx, cy, minR * 0.48);
        stops.forEach((c, idx) => radial.addColorStop(idx / (stops.length - 1), c));

        const HALF = 44;
        const RAYS = HALF * 2;
        const pts = [];
        for (let i = 0; i < RAYS; i++) {
          const idx = Math.floor(((i < HALF ? i : RAYS - 1 - i) / (HALF - 1)) * (BANDS - 1));
          const a = Math.PI / 2 + (i / RAYS) * Math.PI * 2;
          const r = baseR + Math.pow(levels[idx], 1.15) * reach;
          pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r, a, levels[idx], idx]);
        }

        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < pts.length; i++) {
          const p0 = pts[i];
          const p1 = pts[(i + 1) % pts.length];
          const mx = (p0[0] + p1[0]) / 2;
          const my = (p0[1] + p1[1]) / 2;
          if (i === 0) {
            const lastP = pts[pts.length - 1];
            ctx.moveTo((lastP[0] + p0[0]) / 2, (lastP[1] + p0[1]) / 2);
          }
          ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
        }
        ctx.closePath();
        ctx.fillStyle = radial;
        ctx.globalAlpha = 0.34;
        ctx.fill();
        ctx.globalAlpha = 0.95;
        ctx.strokeStyle = radial;
        ctx.lineWidth = 2;
        ctx.shadowColor = `rgb(${r1},${g1},${b1})`;
        ctx.shadowBlur = 14;
        ctx.stroke();
        ctx.shadowBlur = 0;

        ctx.beginPath();
        ctx.strokeStyle = radial;
        ctx.lineWidth = 1.6;
        ctx.lineCap = 'round';
        for (const [x, y, a, share] of pts) {
          if (share < 0.05) continue;
          ctx.moveTo(cx + Math.cos(a) * (baseR - 2), cy + Math.sin(a) * (baseR - 2));
          ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.fillStyle = `rgb(${r1},${g1},${b1})`;
        for (let i = 0; i < RAYS; i++) {
          const idx = Math.floor(((i < HALF ? i : RAYS - 1 - i) / (HALF - 1)) * (BANDS - 1));
          const a = Math.PI / 2 + (i / RAYS) * Math.PI * 2;
          const pr = baseR + Math.pow(peaks[idx], 1.15) * reach + 5;
          ctx.beginPath(); ctx.arc(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr, 1.8, 0, Math.PI * 2); ctx.fill();
        }

        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < RAYS; i++) {
          const idx = Math.floor(((i < HALF ? i : RAYS - 1 - i) / (HALF - 1)) * (BANDS - 1));
          const a = Math.PI / 2 + (i / RAYS) * Math.PI * 2;
          const r = baseR + Math.pow(beforeLevels[idx], 1.15) * reach;
          const bx = cx + Math.cos(a) * r;
          const by = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
        }
        ctx.closePath();
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(240,242,250,0.5)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();

        ctx.beginPath(); ctx.arc(cx, cy, baseR * 0.96, 0, Math.PI * 2);
        ctx.fillStyle = '#090a0f'; ctx.fill();
        ctx.strokeStyle = `rgba(${r1},${g1},${b1},0.78)`; ctx.lineWidth = 1.6; ctx.stroke();
        ctx.restore();
      } else if (currentStyle === 'silk') {
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#07080d');
        bg.addColorStop(1, '#0f111a');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);

        const crest = ctx.createLinearGradient(0, 0, w, 0);
        stops.forEach((c, idx) => crest.addColorStop(idx / (stops.length - 1), c));
        const alphas = [0.22, 0.32, 0.44, 0.62];

        for (let layer = 0; layer < 4; layer++) {
          const baseline = h * (0.72 + layer * 0.065);
          const pts = [];
          for (let i = 0; i < BANDS; i++) {
            const t = i / (BANDS - 1);
            const env = Math.sin(t * Math.PI);
            const wave = Math.sin(t * 7.5 + time * (1.1 + layer * 0.35) + layer * 1.9) * 0.055 * env * (0.3 + levels[i]);
            const lift = (Math.pow(levels[i], 1.15) * (0.42 + 0.11 * layer) + wave) * h * 0.86;
            pts.push([t * w, Math.max(10, baseline - lift)]);
          }
          ctx.save();
          ctx.beginPath();
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1];
            const [x1, y1] = pts[i];
            ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
          }
          ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);

          const area = new Path2D();
          area.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < pts.length; i++) {
            const [x0, y0] = pts[i - 1];
            const [x1, y1] = pts[i];
            area.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
          }
          area.lineTo(w, h);
          area.lineTo(0, h);
          area.closePath();

          const fillGrad = ctx.createLinearGradient(0, h, 0, h * 0.12);
          stops.forEach((c, idx) => {
            const [r, g, b] = hexToRgb(c);
            const a = alphas[layer] * (0.35 + 0.65 * (idx / (stops.length - 1)));
            fillGrad.addColorStop(idx / (stops.length - 1), `rgba(${r},${g},${b},${a.toFixed(3)})`);
          });
          ctx.globalCompositeOperation = layer === 0 ? 'source-over' : 'lighter';
          ctx.fillStyle = fillGrad;
          ctx.fill(area);

          ctx.strokeStyle = crest;
          ctx.globalAlpha = 0.35 + layer * 0.2;
          ctx.lineWidth = 1.2 + layer * 0.55;
          ctx.stroke();

          if (layer === 3) {
            ctx.strokeStyle = 'rgba(255,255,255,0.6)';
            ctx.globalAlpha = 0.78;
            ctx.lineWidth = 1.2;
            ctx.stroke();
          }
          ctx.restore();
        }
        ctx.save();
        ctx.beginPath();
        for (let i = 0; i < BANDS; i++) {
          const t = i / (BANDS - 1);
          const lift = Math.pow(beforeLevels[i], 1.15) * 0.75 * h * 0.86;
          const x = t * w;
          const y = Math.max(10, h * 0.915 - lift);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.setLineDash([3, 4]);
        ctx.strokeStyle = 'rgba(240,242,250,0.55)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.restore();
      } else if (currentStyle === 'crt') {
        ensureCrtBuffer();
        const glass = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
        glass.addColorStop(0, '#101413');
        glass.addColorStop(1, '#050706');
        ctx.fillStyle = glass;
        ctx.fillRect(0, 0, w, h);

        const [br, bgc, bb] = sampleRamp(stops, 0.5);
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i <= 80; i++) {
          const norm = i / 80;
          ctx.lineTo(norm * w, h * (1 - eqCurveShare(norm)));
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = `rgba(${br},${bgc},${bb},0.09)`;
        ctx.fill();

        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let g = 1; g < 10; g++) {
          const gx = Math.round((g / 10) * w) + 0.5;
          ctx.moveTo(gx, 0); ctx.lineTo(gx, h);
        }
        for (const t of [0.25, 0.5, 0.75]) {
          const gy = Math.round(h * t) + 0.5;
          ctx.moveTo(0, gy); ctx.lineTo(w, gy);
        }
        ctx.stroke();

        crtPctx.save();
        crtPctx.globalCompositeOperation = 'destination-out';
        crtPctx.fillStyle = `rgba(0,0,0,${dt > 0 ? Math.min(1, dt * 7) : 1})`;
        crtPctx.fillRect(0, 0, w, h);
        crtPctx.restore();

        const coating = crtPctx.createLinearGradient(0, h, 0, 0);
        stops.forEach((c, idx) => coating.addColorStop(idx / (stops.length - 1), c));
        const pts = [];
        for (let i = 0; i < BANDS; i++) {
          pts.push([(i + 0.5) / BANDS * w, h - levels[i] * h * 0.9]);
        }
        crtPctx.beginPath();
        crtPctx.moveTo(0, h);
        crtPctx.lineTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1];
          const [x1, y1] = pts[i];
          crtPctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
        }
        crtPctx.lineTo(w, h);
        crtPctx.closePath();
        crtPctx.globalAlpha = 0.62;
        crtPctx.fillStyle = coating;
        crtPctx.fill();
        crtPctx.globalAlpha = 1;
        crtPctx.strokeStyle = coating;
        crtPctx.lineWidth = 2.4;
        crtPctx.stroke();

        ctx.drawImage(crtPhosphor, 0, 0, w, h);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.globalAlpha = 0.35;
        ctx.drawImage(crtPhosphor, 0, -2, w, h);
        ctx.drawImage(crtPhosphor, 0, 2, w, h);
        ctx.restore();

        ctx.beginPath();
        for (let i = 0; i < BANDS; i++) {
          const x = (i + 0.5) / BANDS * w;
          const y = h - beforeLevels[i] * h * 0.9;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(0,0,0,0.48)'; ctx.stroke();
        ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(240,240,246,0.72)'; ctx.stroke();

        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
        const corners = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.hypot(w, h) / 2);
        corners.addColorStop(0, 'rgba(0,0,0,0)');
        corners.addColorStop(1, 'rgba(0,0,0,0.6)');
        ctx.fillStyle = corners; ctx.fillRect(0, 0, w, h);
        const sheen = ctx.createLinearGradient(0, 0, w * 0.4, h);
        sheen.addColorStop(0, 'rgba(255,255,255,0.07)');
        sheen.addColorStop(0.35, 'rgba(255,255,255,0)');
        ctx.fillStyle = sheen; ctx.fillRect(0, 0, w, h);
      } else if (currentStyle === 'retro-scifi') {
        const C = { back: '#151111', lift: '#1d1716', frame: '#d46a5e', amber: '#e2bd6c', orange: '#d9825f', teal: '#6dcfb1', peak: '#efd592' };
        const ringRamp = [C.frame, C.orange, C.amber, C.peak];
        const meterRamp = [C.peak, C.amber, C.orange, C.frame];

        const room = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
        room.addColorStop(0, C.lift);
        room.addColorStop(1, C.back);
        ctx.fillStyle = room;
        ctx.fillRect(0, 0, w, h);

        const compact = w < 520;
        const meterW = compact ? 26 : 42;
        const meterX = w - meterW - (compact ? 14 : 26);
        const meterY = compact ? 24 : 38;
        const meterBottom = h - 16;
        const areaLeft = compact ? 18 : 28;
        const areaRight = meterX - 12;

        ctx.save();
        ctx.strokeStyle = C.teal;
        ctx.globalAlpha = 0.08;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let gx = areaLeft + 18; gx < areaRight; gx += 32) { ctx.moveTo(gx, 14); ctx.lineTo(gx, h - 14); }
        for (let gy = 18; gy < h - 14; gy += 32) { ctx.moveTo(areaLeft, gy); ctx.lineTo(areaRight, gy); }
        ctx.stroke();
        ctx.restore();

        ctx.save();
        ctx.strokeStyle = C.frame;
        ctx.shadowColor = C.frame;
        ctx.shadowBlur = 10;
        ctx.lineWidth = 1.6;
        const cut = compact ? 16 : 26;
        ctx.beginPath();
        ctx.moveTo(4, 4); ctx.lineTo(w - 4 - cut, 4); ctx.lineTo(w - 4, 4 + cut);
        ctx.lineTo(w - 4, h - 4); ctx.lineTo(4, h - 4); ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(w - 4 - cut - (compact ? 60 : 120), 12); ctx.lineTo(w - 4 - cut - 8, 12);
        ctx.stroke();

        ctx.strokeStyle = C.amber;
        ctx.shadowColor = C.amber;
        ctx.beginPath();
        ctx.moveTo(18, 18); ctx.lineTo(12, 18); ctx.lineTo(12, h - 18); ctx.lineTo(18, h - 18);
        for (let k = 1; k < 8; k++) {
          const sy = 18 + ((h - 36) * k) / 8;
          ctx.moveTo(12, sy); ctx.lineTo(12 + (k === 4 ? 8 : 4), sy);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(meterX, meterY, meterW, meterBottom - meterY, 6);
        ctx.stroke();
        ctx.restore();

        const R = Math.min(h * 0.34, (areaRight - areaLeft) * 0.24);
        const cx = (areaLeft + areaRight) / 2;
        const cy = h / 2 + R * 0.04;
        const TILT = 0.38;
        ctx.save();
        ctx.strokeStyle = C.teal;
        ctx.shadowColor = C.teal;
        ctx.shadowBlur = 6;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(cx, cy - R * 1.28); ctx.lineTo(cx, cy + R * 1.28);
        ctx.moveTo(cx - R * 1.65, cy); ctx.lineTo(cx + R * 1.65, cy);
        ctx.stroke();
        ctx.restore();

        const shareAt = (arr, u) => arr[Math.min(BANDS - 1, Math.max(0, Math.floor(u * (BANDS - 1))))];
        const project = (lat, lon, share) => {
          const rr = R * Math.cos(lat) * (0.72 + 0.6 * share);
          const x = rr * Math.cos(lon);
          const y = R * Math.sin(lat);
          const z = rr * Math.sin(lon);
          const y2 = y * Math.cos(TILT) - z * Math.sin(TILT);
          const z2 = y * Math.sin(TILT) + z * Math.cos(TILT);
          return [cx + x, cy - y2, z2];
        };
        const strokeSplit = (pts, color, alpha, lw) => {
          for (const front of [false, true]) {
            ctx.beginPath();
            let down = false;
            for (const [px, py, pz] of pts) {
              if ((pz >= 0) === front) {
                if (down) ctx.lineTo(px, py); else ctx.moveTo(px, py);
                down = true;
              } else down = false;
            }
            ctx.globalAlpha = alpha * (front ? 1 : 0.3);
            ctx.strokeStyle = color;
            ctx.lineWidth = lw;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        };

        const RINGS = 17;
        const MERIDIANS = 14;
        const STEPS = 36;
        ctx.save();
        for (let i = 0; i < RINGS; i++) {
          const u = (i + 0.5) / RINGS;
          const lat = (u - 0.5) * Math.PI;
          const sh = shareAt(levels, u);
          const pts = [];
          for (let k = 0; k <= STEPS; k++) pts.push(project(lat, sphereTurn + (k / STEPS) * Math.PI * 2, sh));
          const [r, g, b] = sampleRamp(ringRamp, sh);
          strokeSplit(pts, `rgb(${r},${g},${b})`, 0.58 + 0.38 * sh, sh > 0.58 ? 2 : 1.2);
        }
        for (let m = 0; m < MERIDIANS; m++) {
          const lon = sphereTurn + (m / MERIDIANS) * Math.PI * 2;
          const pts = [];
          for (let k = 0; k <= STEPS; k++) {
            const u = k / STEPS;
            pts.push(project((u - 0.5) * Math.PI, lon, shareAt(levels, u)));
          }
          strokeSplit(pts, C.frame, 0.65, 1.1);
        }
        ctx.strokeStyle = C.teal;
        ctx.globalAlpha = 0.62;
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        for (const side of [-1, 1]) {
          for (let k = 0; k <= STEPS; k++) {
            const u = k / STEPS;
            const lat = (u - 0.5) * Math.PI;
            const bx = cx + side * R * Math.cos(lat) * (0.72 + 0.6 * shareAt(beforeLevels, u));
            const by = cy - R * Math.sin(lat) * Math.cos(TILT);
            if (k === 0) ctx.moveTo(bx, by); else ctx.lineTo(bx, by);
          }
        }
        ctx.stroke();
        ctx.restore();

        const topY = cy - R * Math.cos(TILT) - 8;
        ctx.fillStyle = C.amber;
        ctx.beginPath(); ctx.moveTo(cx - 5, topY - 7); ctx.lineTo(cx + 5, topY - 7); ctx.lineTo(cx, topY); ctx.closePath(); ctx.fill();
        ctx.fillRect(cx - 7, topY - 10, 14, 1.5);

        const bars = 16;
        const mPad = 5;
        const innerTop = meterY + mPad;
        const innerBot = meterBottom - mPad;
        const pitch = (innerBot - innerTop) / bars;
        const bh = Math.max(3, pitch * 0.62);
        for (let i = 0; i < bars; i++) {
          const t = (i + 0.5) / bars;
          const [r, g, b] = sampleRamp(meterRamp, t);
          const by = innerBot - (i + 1) * pitch + (pitch - bh) / 2;
          const on = Math.max(0, Math.min(1, vuPost * bars - i));
          ctx.save();
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          ctx.shadowColor = `rgb(${r},${g},${b})`;
          ctx.shadowBlur = on > 0 ? 8 : 0;
          ctx.globalAlpha = 0.14 + 0.84 * on;
          ctx.beginPath(); ctx.roundRect(meterX + mPad, by, meterW - mPad * 2, bh, bh / 2); ctx.fill();
          ctx.restore();
        }

        if (!compact) {
          ctx.save();
          ctx.font = '500 13px "JetBrains Mono", monospace';
          ctx.textAlign = 'right';
          ctx.fillStyle = C.amber;
          ctx.shadowColor = C.amber;
          ctx.shadowBlur = 6;
          const dbVal = (-60 + vuPost * 56).toFixed(2);
          ctx.fillText(`${dbVal} ${String(Math.round(vuPost * bars)).padStart(2, '0')}`, areaRight - 14, 46);
          ctx.fillText(`01.420 09`, areaRight - 14, 64);
          ctx.restore();

          const drawDial = (dx, dy, dr, paint) => {
            ctx.save();
            ctx.translate(dx, dy);
            ctx.shadowColor = C.teal;
            ctx.shadowBlur = 5;
            paint(dr);
            ctx.restore();
          };
          const dialRing = (r, a0, a1, lw, alpha, color = C.teal) => {
            ctx.beginPath(); ctx.arc(0, 0, r, a0, a1);
            ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.globalAlpha = alpha; ctx.stroke();
          };
          const dialLabel = (txt, size = 12) => {
            ctx.font = `500 ${size}px "JetBrains Mono", monospace`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillStyle = C.amber; ctx.shadowColor = C.amber; ctx.shadowBlur = 5; ctx.globalAlpha = 0.95;
            ctx.fillText(txt, 0, 1);
          };
          const up = -Math.PI / 2;
          const whole = Math.PI * 2;
          const dialR = Math.min(34, Math.round(h * 0.115));
          drawDial(92, Math.max(dialR + 24, 68), dialR, (r) => {
            const lit = Math.round(vuPost * 12);
            for (let i = 0; i < 12; i++) {
              const a = up + (i / 12) * whole;
              dialRing(r, a + 0.06, a + whole / 12 - 0.12, 4.5, i < lit ? 0.85 : 0.18, i === lit ? '#f2ede4' : C.teal);
            }
            dialRing(r * 0.68 * (1 + 0.09 * beatPulse), 0, whole, 1.5 + 2.2 * beatPulse, 0.35 + 0.6 * beatPulse);
            dialLabel(String(beatCount).padStart(4, '0'), 11);
          });
          drawDial(92, h - Math.max(dialR + 24, 64), dialR, (r) => {
            dialRing(r, 0, whole, 4.5, 0.16);
            const frac = 1 - ((time % 240) / 240);
            dialRing(r, up, up + whole * frac, 4.5, 0.9);
            const leftSec = Math.max(0, Math.round(240 - (time % 240)));
            dialLabel(`${Math.floor(leftSec / 60)}:${String(leftSec % 60).padStart(2, '0')}`, 12);
          });
          drawDial(areaRight - 64, h - Math.max(dialR + 24, 64), dialR, (r) => {
            const turn = (time * Math.PI * 2 * 118 / 240) % whole;
            dialRing(r, turn, turn + whole * 0.75, 2.2, 0.85);
            for (let i = 0; i < 24; i++) {
              const a = up + (i / 24) * whole;
              ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.62, Math.sin(a) * r * 0.62);
              ctx.lineTo(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82);
              ctx.lineWidth = 2.2; ctx.strokeStyle = C.teal; ctx.globalAlpha = i < 14 ? 0.85 : 0.18; ctx.stroke();
            }
            dialLabel('118', 12);
          });
        }

        ctx.fillStyle = 'rgba(0,0,0,0.36)';
        for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
        ctx.fillStyle = 'rgba(236,200,180,0.045)';
        ctx.fillRect(0, 0, w, h);
      } else if (currentStyle === 'pulsar') {
        ctx.fillStyle = '#0a0c0f';
        ctx.fillRect(0, 0, w, h);
        const lines = 36;
        const pad = 14;
        const amp = h * 0.42;
        const bottom = h - pad;
        const gap = (bottom - pad - amp * 0.2) / (lines - 1);
        const pulsarStops = currentPalette === 'elysonic' ? ['#4a4e54', '#9a9fa5', '#ffffff'] : stops;
        const strokeGrad = ctx.createLinearGradient(0, 0, 0, -amp);
        pulsarStops.forEach((c, idx) => strokeGrad.addColorStop(idx / (pulsarStops.length - 1), c));

        const traceLine = (path, row, base) => {
          const span = w - pad * 2;
          const room = Math.max(1, base - pad);
          path.moveTo(pad, 0);
          let px = pad;
          let py = 0;
          for (let c = 0; c < BANDS; c++) {
            const e = Math.min(1, Math.min(c + 0.5, BANDS - c - 0.5) / (BANDS * 0.1));
            const edge = (1 - Math.cos(Math.PI * e)) / 2;
            const raw = row ? Math.max(0, (row[c] - 0.26) / 0.74) : 0;
            const heightVal = edge * Math.pow(raw, 1.55);
            const x = pad + ((c + 0.5) / BANDS) * span;
            const yy = -room * Math.tanh((amp * heightVal) / room);
            path.quadraticCurveTo(px, py, (px + x) / 2, (py + yy) / 2);
            px = x;
            py = yy;
          }
          path.quadraticCurveTo(px, py, w - pad, 0);
        };

        const drawRow = (row, depth) => {
          const base = bottom - depth * gap;
          const path = new Path2D();
          traceLine(path, row, base);
          const area = new Path2D(path);
          area.lineTo(w - pad, h - base);
          area.lineTo(pad, h - base);
          area.closePath();
          ctx.save();
          ctx.translate(0, base);
          ctx.globalAlpha = Math.max(0, Math.min(1, lines - depth));
          ctx.fillStyle = '#0a0c0f';
          ctx.fill(area);
          ctx.strokeStyle = strokeGrad;
          ctx.lineWidth = 1.4;
          ctx.lineJoin = 'round';
          ctx.stroke(path);
          ctx.restore();
        };

        for (let j = lines - 1; j >= 0; j--) {
          drawRow(pulsarHistory[j] || null, j + pulsarPhase);
        }
        drawRow(levels, 0);

        const prePath = new Path2D();
        traceLine(prePath, beforeLevels, bottom);
        ctx.save();
        ctx.translate(0, bottom);
        ctx.setLineDash([3, 4]);
        ctx.lineWidth = 1.2;
        ctx.strokeStyle = 'rgba(240,240,246,0.45)';
        ctx.stroke(prePath);
        ctx.restore();
      }
    }

    let last = performance.now();
    function loop(now) {
      rafId = null;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      renderFrame(dt);
      syncLoop();
    }

    stepSignal(0.05);
    updateReadoutAndPalettes();
    syncCanvasSize();

    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => syncCanvasSize());
      ro.observe(canvasWrap);
    } else {
      window.addEventListener('resize', syncCanvasSize);
    }

    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((entries) => {
        isVisible = entries.some((entry) => entry.isIntersecting);
        syncLoop();
      }, { rootMargin: '100px 0px' });
      io.observe(canvasWrap);
    } else {
      isVisible = true;
      syncLoop();
    }

    document.addEventListener('visibilitychange', syncLoop);
  }

  /* ==================== 3. LIGHTBOX MODAL ==================== */
  const viewer = document.querySelector('#image-viewer');
  if (viewer && typeof viewer.showModal === 'function') {
    const title = viewer.querySelector('#image-title');
    const enlarged = viewer.querySelector('#image-large');
    const original = viewer.querySelector('#image-original');
    let opener = null;

    document.querySelectorAll('a[data-lightbox]').forEach((link) => {
      link.addEventListener('click', (event) => {
        if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        opener = link;
        title.textContent = link.dataset.title || '';
        const img = link.querySelector('img');
        enlarged.alt = img ? img.alt : '';
        if (img && img.naturalWidth && img.naturalHeight) {
          enlarged.style.aspectRatio = `${img.naturalWidth} / ${img.naturalHeight}`;
        } else {
          enlarged.style.aspectRatio = '';
        }
        enlarged.src = link.href;
        enlarged.hidden = false;
        original.href = link.href;
        viewer.showModal();
      });
    });

    viewer.addEventListener('click', (event) => {
      if (event.target === viewer) viewer.close();
    });

    viewer.addEventListener('close', () => {
      enlarged.hidden = true;
      enlarged.style.aspectRatio = '';
      enlarged.removeAttribute('src');
      opener?.focus({ preventScroll: true });
    });
  }
})();
