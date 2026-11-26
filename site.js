(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ==================== 1. GENERIC ACCESSIBLE TABS ==================== */
  function initTabGroup(tabSelector, panelSelector, dataAttr) {
    const tabs = [...document.querySelectorAll(tabSelector)];
    const panels = [...document.querySelectorAll(panelSelector)];
    if (!tabs.length || !panels.length) return;

    function activate(tab) {
      const target = tab.getAttribute(dataAttr);
      for (const item of tabs) {
        const active = item === tab;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-selected', String(active));
      }
      for (const panel of panels) {
        const match = panel.getAttribute(dataAttr.replace('tab', 'panel')) === target;
        panel.hidden = !match;
        panel.classList.toggle('is-active', match);
      }
    }

    tabs.forEach((tab, index) => {
      tab.addEventListener('click', () => activate(tab));
      tab.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const nextIndex = (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
        tabs[nextIndex].focus();
        activate(tabs[nextIndex]);
      });
    });
  }

  initTabGroup('[data-stage-tab]', '[data-stage-panel]', 'data-stage-tab');
  initTabGroup('[data-w-tab]', '[data-w-panel]', 'data-w-tab');

  /* ==================== 2. EQ INHERITANCE EXPLAINER ==================== */
  const cascadeNotes = {
    song: 'Active rule: Song EQ wins first, even if you save a flat curve to tame one bright track.',
    album: 'Active rule: Album EQ applies to every track on the record unless a specific song overrides it.',
    output: 'Active rule: Output EQ follows your speakers, DAC, or headphones automatically when you switch devices.',
    all: 'Active rule: All Music is your baseline default whenever no song, album, or output override is saved.'
  };
  const cascadeNodes = [...document.querySelectorAll('[data-cascade]')];
  const cascadeNoteEl = document.querySelector('#cascade-note');

  cascadeNodes.forEach((node) => {
    node.addEventListener('click', () => {
      for (const item of cascadeNodes) item.classList.toggle('is-active', item === node);
      if (cascadeNoteEl) cascadeNoteEl.textContent = cascadeNotes[node.dataset.cascade] || '';
    });
  });

  /* ==================== 3. DISCOVERY DIAL DEMO ==================== */
  const dialInput = document.querySelector('#discovery-dial');
  const dialLabel = document.querySelector('#dial-mode-label');
  const dialDesc = document.querySelector('#dial-mode-desc');

  if (dialInput && dialLabel && dialDesc) {
    const updateDial = () => {
      const val = Number(dialInput.value);
      if (val < 34) {
        dialLabel.textContent = 'Familiar Favorites';
        dialDesc.textContent = 'Stays close to your seed with highly rated songs, hearted tracks, and artists you already return to often.';
      } else if (val < 68) {
        dialLabel.textContent = 'Balanced Mix';
        dialDesc.textContent = 'Blends loved tracks near your seed with unplayed album cuts from adjacent genres. Downvoted songs move to Played less.';
      } else {
        dialLabel.textContent = 'Deep Cuts & Rediscovery';
        dialDesc.textContent = 'Pushes further across your collection to pull in rarely played albums, B-sides, and forgotten tracks connected to your seed.';
      }
    };
    dialInput.addEventListener('input', updateDial);
  }

  /* ==================== 4. COMPLETE FEATURE INDEX FILTER ==================== */
  const filterButtons = [...document.querySelectorAll('[data-spec-filters] [data-filter]')];
  const specCards = [...document.querySelectorAll('[data-specs-grid] .spec-card')];

  filterButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const selected = btn.dataset.filter;
      for (const item of filterButtons) {
        const active = item === btn;
        item.classList.toggle('is-active', active);
        item.setAttribute('aria-pressed', String(active));
      }
      for (const card of specCards) {
        card.hidden = selected !== 'all' && card.dataset.category !== selected;
      }
    });
  });

  /* ==================== 5. INTERACTIVE LIVE EQ VISUALIZER ==================== */
  const canvas = document.querySelector('#eq-visualizer-canvas');
  if (canvas && canvas.getContext) {
    const ctx = canvas.getContext('2d');
    const readout = document.querySelector('#viz-readout');
    const bpmPill = document.querySelector('#viz-bpm-pill');
    const toggleBtn = document.querySelector('#viz-play-toggle');

    const PALETTES = {
      elysonic: { name: 'Elysonic', stops: ['#6237c9', '#c83b8c', '#ff6e4d', '#f6c36d'] },
      ocean:    { name: 'Ocean',    stops: ['#0d3b66', '#167d9c', '#30c5d2', '#a8f9ff'] },
      aurora:   { name: 'Aurora',   stops: ['#2a1f6b', '#1b8a7e', '#4ee69f', '#d3ff8c'] },
      ember:    { name: 'Ember',    stops: ['#5e1418', '#b82a23', '#f26422', '#ffcf6b'] },
      synthwave:{ name: 'Synthwave',stops: ['#3a1c71', '#9c27b0', '#ff2a85', '#36e2ff'] },
      phosphor: { name: 'Phosphor', stops: ['#0c3818', '#1b7a34', '#41d968', '#b8ffca'] }
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
    let time = 1.4;
    const BANDS = 64;
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

    // Offscreen phosphor buffer for CRT persistence
    const crtPhosphor = document.createElement('canvas');
    crtPhosphor.width = canvas.width;
    crtPhosphor.height = canvas.height;
    const crtPctx = crtPhosphor.getContext('2d');

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
    // Simulated EQ curve (warm bass lift, crisp upper-mid presence, gentle top roll-off)
    function eqCurveShare(norm) {
      const bass = 0.16 * Math.exp(-Math.pow((norm - 0.12) * 4.2, 2));
      const dip = -0.05 * Math.exp(-Math.pow((norm - 0.36) * 5.0, 2));
      const presence = 0.11 * Math.exp(-Math.pow((norm - 0.7) * 4.5, 2));
      const air = -0.06 * Math.pow(Math.max(0, norm - 0.82) / 0.18, 1.5);
      return Math.max(0.08, Math.min(0.92, 0.52 + bass + dip + presence + air));
    }

    function updateReadout() {
      if (readout) {
        const palLabel = currentStyle === 'retro-scifi' ? 'Console Film Palette' : `${PALETTES[currentPalette].name} Palette`;
        readout.textContent = `${STYLE_NAMES[currentStyle]} · ${palLabel} · 48 kHz / 24-bit`;
      }
      if (bpmPill) {
        bpmPill.hidden = true;
      }
    }

    document.querySelectorAll('[data-viz-styles] .chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentStyle = btn.dataset.style;
        document.querySelectorAll('[data-viz-styles] .chip').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        updateReadout();
        if (!isPlaying) renderFrame(0);
      });
    });

    document.querySelectorAll('[data-viz-palettes] .chip').forEach((btn) => {
      btn.addEventListener('click', () => {
        currentPalette = btn.dataset.palette;
        document.querySelectorAll('[data-viz-palettes] .chip').forEach((b) => {
          const active = b === btn;
          b.classList.toggle('is-active', active);
          b.setAttribute('aria-pressed', String(active));
        });
        updateReadout();
        if (!isPlaying) renderFrame(0);
      });
    });

    if (toggleBtn) {
      if (!isPlaying) {
        toggleBtn.textContent = 'Animate spectrum';
        toggleBtn.setAttribute('aria-pressed', 'false');
      }
      toggleBtn.addEventListener('click', () => {
        isPlaying = !isPlaying;
        toggleBtn.textContent = isPlaying ? 'Pause spectrum' : 'Animate spectrum';
        toggleBtn.setAttribute('aria-pressed', String(isPlaying));
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
      const w = canvas.width;
      const h = canvas.height;
      const stops = PALETTES[currentPalette].stops;
      const grad = makeVerticalGradient(h);

      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#090a0d';
      ctx.fillRect(0, 0, w, h);

      const padX = 20;
      const usableW = w - padX * 2;

      if (currentStyle === 'mini-led') {
        // Real Elysonic LED bars: square grid, dim unlit cells, brighter EQ curve backlight,
        // lit post-EQ bars, peak caps, and pale before-EQ marker cells.
        const cols = 64;
        const rows = 20;
        const cellW = usableW / cols;
        const cellH = (h - 24) / rows;
        const gapX = Math.max(1.5, cellW * 0.14);
        const gapY = Math.max(1.5, cellH * 0.14);
        for (let c = 0; c < cols; c++) {
          const norm = c / (cols - 1);
          const curveRow = Math.round(eqCurveShare(norm) * (rows - 1));
          const litRows = levels[c] * rows;
          const peakRow = Math.min(rows - 1, Math.floor(peaks[c] * rows));
          const preRow = Math.min(rows - 1, Math.floor(beforeLevels[c] * rows));
          const x = padX + c * cellW + gapX / 2;
          const cw = Math.max(2, cellW - gapX);
          const ch = Math.max(2, cellH - gapY);
          for (let r = 0; r < rows; r++) {
            const y = h - 12 - (r + 1) * cellH + gapY / 2;
            const [R, G, B] = sampleRamp(stops, r / (rows - 1));
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
        // Real Elysonic Classic: subtle band grid, smooth filled spectrum + pale before-EQ line + crisp EQ response curve.
        ctx.strokeStyle = 'rgba(255,255,255,0.045)';
        ctx.lineWidth = 1;
        for (let g = 1; g < 10; g++) {
          const gx = padX + (g / 10) * usableW;
          ctx.beginPath(); ctx.moveTo(gx, 10); ctx.lineTo(gx, h - 12); ctx.stroke();
        }
        for (const t of [0.25, 0.5, 0.75]) {
          ctx.beginPath(); ctx.moveTo(padX, h * t); ctx.lineTo(w - padX, h * t); ctx.stroke();
        }
        // Filled post-EQ spectrum
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

        // Pale before-EQ trace
        ctx.beginPath();
        for (let i = 0; i < BANDS; i++) {
          const x = padX + (i / (BANDS - 1)) * usableW;
          const y = h - 12 - beforeLevels[i] * (h - 28);
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.strokeStyle = 'rgba(240,240,246,0.45)';
        ctx.lineWidth = 1.25;
        ctx.stroke();

        // Smooth EQ curve + 10 band handles
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
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = '#0f1015'; ctx.fill();
          ctx.strokeStyle = stops[stops.length - 2]; ctx.lineWidth = 2; ctx.stroke();
        }
      } else if (currentStyle === 'analog-vu') {
        const ch = ctx.createLinearGradient(0, 0, 0, h);
        ch.addColorStop(0, '#1a1816');
        ch.addColorStop(1, '#0c0b0a');
        ctx.fillStyle = ch;
        ctx.fillRect(0, 0, w, h);

        const pad = 14;
        const gap = 14;
        const mw = (w - pad * 2 - gap) / 2;
        const mh = h - pad * 2;
        const vuAngle = (vu) => -Math.PI / 2 + (Math.max(0, Math.min(1, (vu + 20) / 23)) - 0.5) * 1.42;
        const marks = [[-20, '20'], [-10, '10'], [-7, '7'], [-5, '5'], [-3, '3'], [0, '0'], [1, '+1'], [2, '+2'], [3, '+3']];
        const meters = [
          { title: 'BEFORE EQ', val: vuPre },
          { title: 'WITH EQ', val: vuPost }
        ];
        meters.forEach((m, idx) => {
          const x = pad + idx * (mw + gap);
          const y = pad;
          const cx = x + mw / 2;
          const cy = y + mh * 1.05;
          const R = Math.min(mw * 0.72, mh * 0.86);
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

          ctx.font = '600 12px "Plus Jakarta Sans", sans-serif';
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

          ctx.font = '700 26px Georgia, serif';
          ctx.fillStyle = 'rgba(36,24,14,0.52)';
          ctx.fillText('VU', cx, y + mh * 0.56);
          ctx.font = '600 11px "JetBrains Mono", monospace';
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
          ctx.beginPath(); ctx.arc(x + mw - 18, y + 18, 5, 0, Math.PI * 2);
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

        // Rotating astronomical compass ticks
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

        // Individual luminous rays
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

        // Orbiting peak-hold starlight dots
        ctx.fillStyle = `rgb(${r1},${g1},${b1})`;
        for (let i = 0; i < RAYS; i++) {
          const idx = Math.floor(((i < HALF ? i : RAYS - 1 - i) / (HALF - 1)) * (BANDS - 1));
          const a = Math.PI / 2 + (i / RAYS) * Math.PI * 2;
          const pr = baseR + Math.pow(peaks[idx], 1.15) * reach + 5;
          ctx.beginPath(); ctx.arc(cx + Math.cos(a) * pr, cy + Math.sin(a) * pr, 1.8, 0, Math.PI * 2); ctx.fill();
        }

        // Before-EQ dashed ring
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

        // Dark inner core disc with glowing rim
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
        // Before-EQ dashed horizon trace
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
        // Real Elysonic CRT: phosphor spectrum tube with afterglow, faint EQ curve burn,
        // band grid, pale before-EQ line, 3px scanlines, dark corners, and glass sheen.
        const glass = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
        glass.addColorStop(0, '#101413');
        glass.addColorStop(1, '#050706');
        ctx.fillStyle = glass;
        ctx.fillRect(0, 0, w, h);

        // Burned-in EQ curve glow
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

        // Faint tube grid
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

        // Phosphor persistence decay + new filled spectrum
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

        ctx.drawImage(crtPhosphor, 0, 0);
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        ctx.filter = 'blur(8px)';
        ctx.globalAlpha = 0.55;
        ctx.drawImage(crtPhosphor, 0, 0);
        ctx.restore();

        // Pale before-EQ trace with dark edge
        ctx.beginPath();
        for (let i = 0; i < BANDS; i++) {
          const x = (i + 0.5) / BANDS * w;
          const y = h - beforeLevels[i] * h * 0.9;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.lineWidth = 3.2; ctx.strokeStyle = 'rgba(0,0,0,0.48)'; ctx.stroke();
        ctx.lineWidth = 1.4; ctx.strokeStyle = 'rgba(240,240,246,0.72)'; ctx.stroke();

        // Scanlines, dark corners, glass sheen
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
        // Real Elysonic Retro sci-fi: 1970s film computer console with turning 3D wireframe sphere,
        // 3 corner dials (beat counter, time left, BPM), right-side loudness meter, and cut-corner coral frame.
        const C = { back: '#151111', lift: '#1d1716', frame: '#d46a5e', amber: '#e2bd6c', orange: '#d9825f', teal: '#6dcfb1', peak: '#efd592' };
        const ringRamp = [C.frame, C.orange, C.amber, C.peak];
        const meterRamp = [C.peak, C.amber, C.orange, C.frame];

        const room = ctx.createRadialGradient(w / 2, h * 0.45, 0, w / 2, h / 2, Math.hypot(w, h) / 2);
        room.addColorStop(0, C.lift);
        room.addColorStop(1, C.back);
        ctx.fillStyle = room;
        ctx.fillRect(0, 0, w, h);

        const meterX = w - 68;
        const meterW = 42;
        const meterY = 38;
        const meterBottom = h - 18;
        const areaLeft = 28;
        const areaRight = meterX - 16;

        // Faint teal grid
        ctx.save();
        ctx.strokeStyle = C.teal;
        ctx.globalAlpha = 0.08;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let gx = areaLeft + 18; gx < areaRight; gx += 32) { ctx.moveTo(gx, 14); ctx.lineTo(gx, h - 14); }
        for (let gy = 18; gy < h - 14; gy += 32) { ctx.moveTo(areaLeft, gy); ctx.lineTo(areaRight, gy); }
        ctx.stroke();
        ctx.restore();

        // Cut-corner coral frame
        ctx.save();
        ctx.strokeStyle = C.frame;
        ctx.shadowColor = C.frame;
        ctx.shadowBlur = 10;
        ctx.lineWidth = 1.6;
        const cut = 26;
        ctx.beginPath();
        ctx.moveTo(4, 4); ctx.lineTo(w - 4 - cut, 4); ctx.lineTo(w - 4, 4 + cut);
        ctx.lineTo(w - 4, h - 4); ctx.lineTo(4, h - 4); ctx.closePath();
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(w - 4 - cut - 120, 12); ctx.lineTo(w - 4 - cut - 8, 12);
        ctx.stroke();

        // Amber left scale & right meter bezel
        ctx.strokeStyle = C.amber;
        ctx.shadowColor = C.amber;
        ctx.beginPath();
        ctx.moveTo(22, 18); ctx.lineTo(14, 18); ctx.lineTo(14, h - 18); ctx.lineTo(22, h - 18);
        for (let k = 1; k < 8; k++) {
          const sy = 18 + ((h - 36) * k) / 8;
          ctx.moveTo(14, sy); ctx.lineTo(14 + (k === 4 ? 9 : 5), sy);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.roundRect(meterX, meterY, meterW, meterBottom - meterY, 6);
        ctx.stroke();
        ctx.restore();

        // Teal crosshair behind sphere
        const R = Math.min(h * 0.35, w * 0.16);
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
        ctx.moveTo(cx - R * 1.85, cy); ctx.lineTo(cx + R * 1.85, cy);
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

        // 17 latitude rings swollen by frequency level
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
        // 14 rotating meridians
        for (let m = 0; m < MERIDIANS; m++) {
          const lon = sphereTurn + (m / MERIDIANS) * Math.PI * 2;
          const pts = [];
          for (let k = 0; k <= STEPS; k++) {
            const u = k / STEPS;
            pts.push(project((u - 0.5) * Math.PI, lon, shareAt(levels, u)));
          }
          strokeSplit(pts, C.frame, 0.65, 1.1);
        }
        // Before-EQ teal side silhouette
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

        // Top amber marker
        const topY = cy - R * Math.cos(TILT) - 8;
        ctx.fillStyle = C.amber;
        ctx.beginPath(); ctx.moveTo(cx - 5, topY - 7); ctx.lineTo(cx + 5, topY - 7); ctx.lineTo(cx, topY); ctx.closePath(); ctx.fill();
        ctx.fillRect(cx - 7, topY - 10, 14, 1.5);

        // Right loudness meter (16 rounded bars)
        const bars = 16;
        const mPad = 6;
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

        // Amber numeric readout top right
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

        // Three console dials (Beats, Time Left, BPM)
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
        // Top-left: Beats
        drawDial(92, 68, 34, (r) => {
          const lit = Math.round(vuPost * 12);
          for (let i = 0; i < 12; i++) {
            const a = up + (i / 12) * whole;
            dialRing(r, a + 0.06, a + whole / 12 - 0.12, 4.5, i < lit ? 0.85 : 0.18, i === lit ? '#f2ede4' : C.teal);
          }
          dialRing(r * 0.68 * (1 + 0.09 * beatPulse), 0, whole, 1.5 + 2.2 * beatPulse, 0.35 + 0.6 * beatPulse);
          dialLabel(String(beatCount).padStart(4, '0'), 11);
        });
        // Bottom-left: Time left
        drawDial(92, h - 64, 34, (r) => {
          dialRing(r, 0, whole, 4.5, 0.16);
          const frac = 1 - ((time % 240) / 240);
          dialRing(r, up, up + whole * frac, 4.5, 0.9);
          const leftSec = Math.max(0, Math.round(240 - (time % 240)));
          dialLabel(`${Math.floor(leftSec / 60)}:${String(leftSec % 60).padStart(2, '0')}`, 12);
        });
        // Bottom-right: Tempo (BPM)
        drawDial(areaRight - 64, h - 64, 34, (r) => {
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

        // Film scanlines & worn-print haze
        ctx.fillStyle = 'rgba(0,0,0,0.36)';
        for (let y = 0; y < h; y += 3) ctx.fillRect(0, y, w, 1);
        ctx.fillStyle = 'rgba(236,200,180,0.045)';
        ctx.fillRect(0, 0, w, h);
      } else if (currentStyle === 'pulsar') {
        // Real Elysonic Pulsar: 36 stacked scrolling ridgelines, raised-cosine tapered edges,
        // soft tanh top squeeze, default gray-to-white (or chosen palette), dashed before-EQ line.
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

        // Dashed before-EQ trace on the front line
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

    stepSignal(0.05);
    renderFrame(0);
    updateReadout();

    let last = performance.now();
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (isPlaying) renderFrame(dt);
      requestAnimationFrame(loop);
    }
    requestAnimationFrame(loop);
  }

  /* ==================== 6. LIGHTBOX MODAL ==================== */
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
      enlarged.removeAttribute('src');
      opener?.focus({ preventScroll: true });
    });
  }
})();
