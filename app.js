
'use strict';

const AUDIO_FOLDER = 'audio';


const AUDIO_EXTENSIONS = ['.mp3', '.wav', '.ogg', '.flac'];


const TRACKS = [
  { id: 'rain',    name: 'Rainfall',      emoji: '🌧', tag: 'water'  },
  { id: 'thunder', name: 'Thunder',        emoji: '⛈', tag: 'storm'  },
  { id: 'wind',    name: 'Wind',           emoji: '💨', tag: 'air'    },
  { id: 'fire',    name: 'Fireplace',      emoji: '🔥', tag: 'warmth' },
  { id: 'forest',  name: 'Forest Birds',   emoji: '🌿', tag: 'nature' },
  { id: 'ocean',   name: 'Ocean Waves',    emoji: '🌊', tag: 'water'  },
  { id: 'cafe',    name: 'Café Murmur',    emoji: '☕', tag: 'urban'  },
  { id: 'night',   name: 'Night Crickets', emoji: '🌙', tag: 'night'  },
];


const PRESETS = {
  rain:    { rain:0.80, thunder:0.20, wind:0.40, fire:0.15, forest:0.00, ocean:0.00, cafe:0.10, night:0.00 },
  storm:   { rain:0.70, thunder:0.65, wind:0.80, fire:0.00, forest:0.00, ocean:0.00, cafe:0.00, night:0.00 },
  snow:    { rain:0.00, thunder:0.00, wind:0.50, fire:0.75, forest:0.10, ocean:0.00, cafe:0.35, night:0.00 },
  clear:   { rain:0.00, thunder:0.00, wind:0.20, fire:0.00, forest:0.70, ocean:0.35, cafe:0.20, night:0.00 },
  cloudy:  { rain:0.00, thunder:0.00, wind:0.45, fire:0.30, forest:0.40, ocean:0.25, cafe:0.30, night:0.00 },
  fog:     { rain:0.15, thunder:0.00, wind:0.30, fire:0.50, forest:0.20, ocean:0.10, cafe:0.40, night:0.00 },
  night:   { rain:0.00, thunder:0.00, wind:0.25, fire:0.45, forest:0.15, ocean:0.00, cafe:0.00, night:0.85 },
  coastal: { rain:0.00, thunder:0.00, wind:0.55, fire:0.00, forest:0.15, ocean:0.90, cafe:0.00, night:0.00 },
};

let audioCtx     = null;
let masterGain   = null;
let analyserNode = null;
let isPlaying    = false;

// id → { gainNode, sourceNode }
const trackNodes = {};

// id → 0–1  (current fader value)
const volumes = {};
TRACKS.forEach(t => { volumes[t.id] = 0; });

// id → AudioBuffer (decoded from audio/ files) or null (use synth)
const audioBuffers = {};
TRACKS.forEach(t => { audioBuffers[t.id] = null; });

// Timer
let timerTotal     = 25 * 60;
let timerRemaining = 25 * 60;
let timerInterval  = null;
let timerRunning   = false;


function initAudio() {
  if (audioCtx) return;
  audioCtx     = new (window.AudioContext || window.webkitAudioContext)();
  masterGain   = audioCtx.createGain();
  analyserNode = audioCtx.createAnalyser();
  analyserNode.fftSize = 1024;


  const compressor = audioCtx.createDynamicsCompressor();
  compressor.threshold.value = -18;  
  compressor.knee.value      = 10;   
  compressor.ratio.value     = 4;    
  compressor.attack.value    = 0.003;
  compressor.release.value   = 0.25;

  // Chain: tracks -> masterGain -> compressor -> analyser -> output
  masterGain.connect(compressor);
  compressor.connect(analyserNode);
  analyserNode.connect(audioCtx.destination);

  // Scale down so multiple simultaneous tracks don't overload
  const sliderVal = parseInt(document.getElementById('master-vol-slider').value, 10);
  masterGain.gain.value = (sliderVal / 100) * 0.6;
}


async function loadAudioFile(id) {
  for (const ext of AUDIO_EXTENSIONS) {
    const url = `${AUDIO_FOLDER}/${id}${ext}`;
    try {
      const response = await fetch(url);
      if (!response.ok) continue;              // file not found → try next ext
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      console.log(`✓ Loaded ${url}`);
      return audioBuffer;
    } catch (_) {
      // fetch or decode failed → try next extension
    }
  }
  console.log(`⚠ No audio file found for "${id}" — using synth fallback`);
  return null;
}


async function loadAllAudioFiles() {
  const promises = TRACKS.map(async t => {
    const buf = await loadAudioFile(t.id);
    audioBuffers[t.id] = buf;
    updateTrackSourceBadge(t.id, buf !== null);
  });
  await Promise.all(promises);
}


function createNoiseSource() {
  const size   = audioCtx.sampleRate * 3;
  const buffer = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
  const data   = buffer.getChannelData(0);
  for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  src.loop   = true;
  return src;
}

function biquad(type, freq, Q = 1) {
  const f = audioCtx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = Q;
  return f;
}

function createLFO(rate, depth, target) {
  const osc = audioCtx.createOscillator();
  const g   = audioCtx.createGain();
  osc.type = 'sine'; osc.frequency.value = rate; g.gain.value = depth;
  osc.connect(g); g.connect(target); osc.start();
  return [osc, g];
}

function buildSynthGraph(id, gainNode) {
  let src; let extras = [];
  switch (id) {
    case 'rain': {
      src = createNoiseSource();
      const lp = biquad('lowpass',3800,1), bp = biquad('bandpass',1100,0.9);
      src.connect(lp); lp.connect(bp); bp.connect(gainNode); extras=[lp,bp]; break;
    }
    case 'thunder': {
      src = createNoiseSource();
      const lp1 = biquad('lowpass',180,1), lp2 = biquad('lowpass',60,1);
      src.connect(lp1); lp1.connect(lp2); lp2.connect(gainNode);
      const [lfo,lfoG] = createLFO(0.08,0.45,gainNode.gain); extras=[lp1,lp2,lfo,lfoG]; break;
    }
    case 'wind': {
      src = createNoiseSource();
      const bp = biquad('bandpass',380,0.5);
      src.connect(bp); bp.connect(gainNode);
      const [lfo,lfoG] = createLFO(0.1,0.35,gainNode.gain); extras=[bp,lfo,lfoG]; break;
    }
    case 'fire': {
      src = createNoiseSource();
      const hp = biquad('highpass',500,1), bp = biquad('bandpass',900,1.8);
      src.connect(hp); hp.connect(bp); bp.connect(gainNode);
      const [lfo,lfoG] = createLFO(0.35,0.18,gainNode.gain); extras=[hp,bp,lfo,lfoG]; break;
    }
    case 'forest': {
      src = createNoiseSource();
      const hp = biquad('highpass',1800,1), bp = biquad('bandpass',2800,2.5);
      src.connect(hp); hp.connect(bp); bp.connect(gainNode);
      const [lfo,lfoG] = createLFO(0.75,0.38,gainNode.gain); extras=[hp,bp,lfo,lfoG]; break;
    }
    case 'ocean': {
      src = createNoiseSource();
      const lp = biquad('lowpass',700,1);
      src.connect(lp); lp.connect(gainNode);
      const [lfo,lfoG] = createLFO(0.14,0.45,gainNode.gain); extras=[lp,lfo,lfoG]; break;
    }
    case 'cafe': {
      src = createNoiseSource();
      const bp = biquad('bandpass',900,0.55);
      src.connect(bp); bp.connect(gainNode);
      const [lfo,lfoG] = createLFO(0.04,0.22,gainNode.gain); extras=[bp,lfo,lfoG]; break;
    }
    case 'night': {
      src = createNoiseSource();
      const hp = biquad('highpass',2400,1), bp = biquad('bandpass',3600,3.5);
      src.connect(hp); hp.connect(bp); bp.connect(gainNode);
      const [lfo,lfoG] = createLFO(1.3,0.42,gainNode.gain); extras=[hp,bp,lfo,lfoG]; break;
    }
    default: {
      src = createNoiseSource(); src.connect(gainNode);
    }
  }
  src.start();
  return { sourceNode: src, extras };
}

/* ═══════════════════════════════════════════════════════════
   BUILD TRACK AUDIO GRAPH
   Uses local file buffer if available, otherwise synth.
   ══════════════════════════════════════════════════════════ */
function buildTrackGraph(id) {
  const gainNode = audioCtx.createGain();
  gainNode.gain.value = volumes[id] || 0;
  gainNode.connect(masterGain);

  if (audioBuffers[id]) {
    // ── Local audio file ──
    const src  = audioCtx.createBufferSource();
    src.buffer = audioBuffers[id];
    src.loop   = true;
    src.connect(gainNode);
    src.start();
    return { gainNode, sourceNode: src, extras: [] };
  } else {
    // ── Synthesized fallback ──
    const { sourceNode, extras } = buildSynthGraph(id, gainNode);
    return { gainNode, sourceNode, extras };
  }
}

function startAllTracks() {
  initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  TRACKS.forEach(t => {
    if (!trackNodes[t.id]) trackNodes[t.id] = buildTrackGraph(t.id);
    trackNodes[t.id].gainNode.gain.setTargetAtTime(volumes[t.id], audioCtx.currentTime, 0.4);
  });
}

function fadeAllTracks() {
  Object.values(trackNodes).forEach(n => {
    n.gainNode.gain.setTargetAtTime(0, audioCtx.currentTime, 0.4);
  });
}

function applyTrackVolume(id, value) {
  volumes[id] = value;
  if (isPlaying && trackNodes[id]) {
    trackNodes[id].gainNode.gain.setTargetAtTime(value, audioCtx.currentTime, 0.12);
  }
}


let vizAnimId = null;

function startVisualizer() {
  const canvas = document.getElementById('viz-canvas');
  const dctx   = canvas.getContext('2d');
  const buffer = new Uint8Array(analyserNode.frequencyBinCount);

  function resize() { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight; }
  resize();
  window.addEventListener('resize', resize);

  function draw() {
    vizAnimId = requestAnimationFrame(draw);
    analyserNode.getByteTimeDomainData(buffer);
    const W = canvas.width, H = canvas.height;
    dctx.clearRect(0, 0, W, H);
    const sw = W / buffer.length;

    dctx.beginPath(); dctx.lineWidth = 1.5; dctx.strokeStyle = '#4dab6e';
    let x = 0;
    for (let i = 0; i < buffer.length; i++) {
      const y = (buffer[i] / 128) * (H / 2);
      i === 0 ? dctx.moveTo(x, y) : dctx.lineTo(x, y);
      x += sw;
    }
    dctx.stroke();

    dctx.beginPath(); dctx.lineWidth = 1; dctx.strokeStyle = 'rgba(77,171,110,0.18)';
    x = 0;
    for (let i = 0; i < buffer.length; i++) {
      const y = H - (buffer[i] / 128) * (H / 2);
      i === 0 ? dctx.moveTo(x, y) : dctx.lineTo(x, y);
      x += sw;
    }
    dctx.stroke();
  }
  draw();
}

function stopVisualizer() {
  if (vizAnimId) { cancelAnimationFrame(vizAnimId); vizAnimId = null; }
  const c = document.getElementById('viz-canvas');
  c.getContext('2d').clearRect(0, 0, c.width, c.height);
}

/* ═══════════════════════════════════════════════════════════
   TRACK UI
   ══════════════════════════════════════════════════════════ */
function updateTrackSourceBadge(id, isFile) {
  const badge = document.getElementById(`source-${id}`);
  if (!badge) return;
  badge.textContent = isFile ? 'audio file' : 'synth';
  badge.className   = `track-source${isFile ? ' file' : ''}`;
}

function renderTracks() {
  const grid = document.getElementById('tracks-grid');
  grid.innerHTML = '';
  TRACKS.forEach(track => {
    const card = document.createElement('div');
    card.className = 'track-card' + (volumes[track.id] > 0 ? ' active' : '');
    card.id = `card-${track.id}`;
    card.innerHTML = `
      <span class="track-emoji" aria-hidden="true">${track.emoji}</span>
      <div class="track-name">${track.name}</div>
      <div class="track-tag">${track.tag}</div>
      <div class="track-vol-row">
        <input type="range" id="vol-${track.id}" min="0" max="100" step="1"
          value="${Math.round(volumes[track.id] * 100)}"
          aria-label="${track.name} volume" />
        <span class="track-vol-val" id="val-${track.id}">${Math.round(volumes[track.id] * 100)}%</span>
      </div>
      <span class="track-source" id="source-${track.id}">loading…</span>
    `;
    grid.appendChild(card);

    document.getElementById(`vol-${track.id}`).addEventListener('input', e => {
      const pct = parseInt(e.target.value, 10);
      document.getElementById(`val-${track.id}`).textContent = `${pct}%`;
      applyTrackVolume(track.id, pct / 100);
      card.classList.toggle('active', pct > 0);
    });
  });
}

function applyPreset(presetKey) {
  const preset = PRESETS[presetKey] || PRESETS.clear;
  Object.entries(preset).forEach(([id, vol]) => {
    volumes[id] = vol;
    const slider = document.getElementById(`vol-${id}`);
    const valEl  = document.getElementById(`val-${id}`);
    const card   = document.getElementById(`card-${id}`);
    if (slider) slider.value = Math.round(vol * 100);
    if (valEl)  valEl.textContent = `${Math.round(vol * 100)}%`;
    if (card)   card.classList.toggle('active', vol > 0);
    if (isPlaying && trackNodes[id]) {
      trackNodes[id].gainNode.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.8);
    }
  });
}

/* 
   WEATHER — Geolocation API + Open-Meteo API*/
function decodeWeather(code, isNight) {
  if (isNight)    return { preset:'night',   icon:'🌙', label:'Clear night'   };
  if (code===0)   return { preset:'clear',   icon:'☀️', label:'Clear sky'     };
  if (code<=2)    return { preset:'cloudy',  icon:'⛅', label:'Partly cloudy' };
  if (code===3)   return { preset:'cloudy',  icon:'☁️', label:'Overcast'      };
  if (code<=49)   return { preset:'fog',     icon:'🌫', label:'Foggy'         };
  if (code<=67)   return { preset:'rain',    icon:'🌧', label:'Rainy'         };
  if (code<=77)   return { preset:'snow',    icon:'🌨', label:'Snowy'         };
  if (code<=82)   return { preset:'rain',    icon:'🌦', label:'Rain showers'  };
  if (code>=95)   return { preset:'storm',   icon:'⛈', label:'Thunderstorm'  };
  return                 { preset:'cloudy',  icon:'🌫', label:'Mixed weather' };
}

function setWeatherUI(icon, condition, detail, statusText, statusClass) {
  document.getElementById('wx-icon').textContent      = icon;
  document.getElementById('wx-condition').textContent = condition;
  document.getElementById('wx-detail').textContent    = detail;
  const s = document.getElementById('wx-status');
  s.textContent = statusText; s.className = `weather-status ${statusClass}`;
  const pill = document.getElementById('weather-pill');
  pill.classList.toggle('loaded', statusClass === 'ok');
  pill.classList.toggle('error',  statusClass === 'err');
}

async function loadWeatherForCoords(lat, lon) {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}`
      + `&current=temperature_2m,weathercode,windspeed_10m&timezone=auto&forecast_days=1`;
    const res  = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const cur  = data.current;
    const hour = new Date(cur.time).getHours();
    const { preset, icon, label } = decodeWeather(cur.weathercode, hour < 6 || hour >= 20);
    setWeatherUI(icon, label, `${Math.round(cur.temperature_2m)}°C · Wind ${Math.round(cur.windspeed_10m)} km/h`, label, 'ok');
    applyPreset(preset);
  } catch (err) {
    console.warn('Weather fetch failed:', err);
    setWeatherUI('—', 'Weather unavailable', 'Using default sounds', 'Offline', 'err');
    applyPreset('clear');
  }
}

function initWeather() {
  if (!('geolocation' in navigator)) {
    setWeatherUI('—', 'Geolocation not supported', 'Using default sounds', 'No GPS', 'err');
    applyPreset('clear');
    return;
  }
  setWeatherUI('◌', 'Detecting location…', '', '…', '');
  navigator.geolocation.getCurrentPosition(
    pos => loadWeatherForCoords(pos.coords.latitude, pos.coords.longitude),
    err => {
      console.warn('Geolocation denied:', err.message);
      setWeatherUI('—', 'Location access denied', 'Using default sounds', 'No location', 'err');
      applyPreset('clear');
    },
    { timeout: 10000 }
  );
}

/* ═══════════════════════════════════════════════════════════
   FOCUS TIMER
   ══════════════════════════════════════════════════════════ */
function formatTime(s) {
  return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function updateTimerUI() {
  document.getElementById('timer-digits').textContent = formatTime(timerRemaining);
  const pct = timerTotal > 0 ? (timerRemaining / timerTotal) * 100 : 100;
  const bar  = document.getElementById('timer-bar');
  bar.style.width = `${pct}%`;
  bar.classList.toggle('urgent', pct <= 15);
}
function timerDone() {
  clearInterval(timerInterval); timerInterval=null; timerRunning=false; timerRemaining=0;
  document.getElementById('timer-btn').textContent = 'Start';
  document.getElementById('timer-btn').classList.remove('running');
  const s = document.getElementById('timer-status');
  s.textContent='Session complete!'; s.className='timer-status done';
  updateTimerUI();
  if (audioCtx) {
    const osc=audioCtx.createOscillator(), g=audioCtx.createGain();
    osc.type='sine'; osc.frequency.value=528; g.gain.value=0.18;
    osc.connect(g); g.connect(audioCtx.destination); osc.start();
    g.gain.setTargetAtTime(0, audioCtx.currentTime+0.2, 0.3);
    osc.stop(audioCtx.currentTime+1.5);
  }
}

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    timerTotal = parseInt(btn.dataset.min, 10) * 60;
    timerRemaining = timerTotal;
    if (timerRunning) {
      clearInterval(timerInterval); timerInterval=null; timerRunning=false;
      document.getElementById('timer-btn').textContent='Start';
      document.getElementById('timer-btn').classList.remove('running');
    }
    const s = document.getElementById('timer-status');
    s.textContent=`${btn.dataset.min} min session`; s.className='timer-status';
    updateTimerUI();
  });
});

document.getElementById('timer-btn').addEventListener('click', () => {
  const btn = document.getElementById('timer-btn');
  if (timerRunning) {
    clearInterval(timerInterval); timerInterval=null; timerRunning=false;
    btn.textContent='Resume'; btn.classList.remove('running');
    const s=document.getElementById('timer-status'); s.textContent='Paused'; s.className='timer-status';
  } else {
    if (timerRemaining<=0) { timerRemaining=timerTotal; updateTimerUI(); }
    timerRunning=true; btn.textContent='Pause'; btn.classList.add('running');
    const s=document.getElementById('timer-status'); s.textContent='Focus session running…'; s.className='timer-status running';
    timerInterval=setInterval(()=>{ timerRemaining--; updateTimerUI(); if(timerRemaining<=0) timerDone(); },1000);
  }
});

document.getElementById('timer-reset-btn').addEventListener('click', () => {
  clearInterval(timerInterval); timerInterval=null; timerRunning=false; timerRemaining=timerTotal;
  document.getElementById('timer-btn').textContent='Start';
  document.getElementById('timer-btn').classList.remove('running');
  const s=document.getElementById('timer-status'); s.textContent='Reset'; s.className='timer-status';
  updateTimerUI();
});

/* ═══════════════════════════════════════════════════════════
   MASTER PLAY / STOP
   ══════════════════════════════════════════════════════════ */
document.getElementById('play-btn').addEventListener('click', async () => {
  const btn      = document.getElementById('play-btn');
  const labelEl  = document.getElementById('play-label');
  const vizLabel = document.getElementById('viz-label');

  if (!isPlaying) {
    // First play: init AudioContext, load files, then start
    initAudio();
    if (audioCtx.state === 'suspended') await audioCtx.resume();

    // Load audio files on first press (requires AudioContext to decode)
    const anyLoaded = Object.values(audioBuffers).some(b => b !== null);
    if (!anyLoaded) {
      vizLabel.textContent = 'Loading audio files…';
      await loadAllAudioFiles();
    }

    startAllTracks();
    startVisualizer();
    isPlaying = true;
    btn.classList.add('playing'); btn.setAttribute('aria-pressed','true');
    labelEl.textContent  = 'Stop';
    vizLabel.textContent = 'Live audio';
  } else {
    fadeAllTracks();
    stopVisualizer();
    isPlaying = false;
    btn.classList.remove('playing'); btn.setAttribute('aria-pressed','false');
    labelEl.textContent  = 'Play';
    vizLabel.textContent = 'Press play to begin';
  }
});

document.getElementById('master-vol-slider').addEventListener('input', e => {
  const pct = parseInt(e.target.value, 10);
  document.getElementById('master-vol-readout').textContent = `${pct}%`;
  if (masterGain) masterGain.gain.setTargetAtTime((pct / 100) * 0.6, audioCtx.currentTime, 0.05);
});

renderTracks();
updateTimerUI();
initWeather();