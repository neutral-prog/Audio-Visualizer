lucide.createIcons();

const elements = {
  canvas: document.getElementById('visualizer-canvas'),
  startBtn: document.getElementById('start-btn'),
  stopBtn: document.getElementById('stop-btn'),
  modeSelect: document.getElementById('mode-select'),
  colorSelect: document.getElementById('color-select'),
  statusMsg: document.getElementById('status-message'),
  mainUi: document.getElementById('main-ui'),
  freqVal: document.getElementById('freq-val'),
  energyVal: document.getElementById('energy-val'),
  waveVal: document.getElementById('wave-val'),
  sessionList: document.getElementById('session-list'),
  sessionsPanel: document.getElementById('sessions-panel'),
  physicsPanel: document.getElementById('physics-panel'),
  reviewOverlay: document.getElementById('review-overlay'),
  reviewTitle: document.getElementById('review-title'),
  exitReviewBtn: document.getElementById('exit-review-btn'),
  tabLive: document.getElementById('tab-live'),
  tabRecorded: document.getElementById('tab-recorded'),
  tabFrequency: document.getElementById('tab-frequency'),
  frequencyPanel: document.getElementById('frequency-panel'),
  targetFreqInput: document.getElementById('target-freq'),
  freqToleranceInput: document.getElementById('freq-tolerance'),
  startFreqBtn: document.getElementById('start-freq-btn'),
  stopFreqBtn: document.getElementById('stop-freq-btn'),
  freqStatusMsg: document.getElementById('freq-status-message'),
  menuToggle: document.getElementById('menu-toggle'),
  appMenu: document.getElementById('app-menu'),
  quickViewContainer: document.getElementById('quick-view-container'),
  quickViewBtn: document.getElementById('quick-view-btn'),
  
  // AI Elements
  aiSubtitlesToggle: document.getElementById('ai-subtitles-toggle'),
  aiSubtitlesContainer: document.getElementById('ai-subtitles'),
  aiSoundClass: document.getElementById('ai-sound-class'),
  insightOverlay: document.getElementById('insight-overlay'),
  insightContent: document.getElementById('insight-content'),
  closeInsightBtn: document.getElementById('close-insight-btn'),
  askAiBtn: document.getElementById('ask-ai-btn'),
  
  // Auth Elements
  logoutBtn: document.getElementById('logout-btn'),
  loginOverlay: document.getElementById('login-overlay'),
  loginAccount: document.getElementById('login-account'),
  loginPassword: document.getElementById('login-password'),
  loginBtn: document.getElementById('login-btn'),
  loginError: document.getElementById('login-error')
};

const ctx = elements.canvas.getContext('2d');
const PLANCK_CONSTANT = 6.62607015e-34; // J s
const SPEED_OF_LIGHT = 299792458; // m/s
const NOISE_GATE = 15; // Minimum amplitude to register as valid sound

let audioContext, analyser, source, stream, animationId;
let frequencyData, timeDomainData, bufferLength;

// Session State Layer
let isRecording = false;
let isReviewing = false;
let sessions = []; // Array of saved recordings
let currentSession = null; // Holds data stream for the current active recording
let sleepTimeout = null; // Waking UI timeout

let isFrequencyMode = false;
let autoRecordSilenceTimeout = null;

// AI Features State
let textRecognition = null;
let subtitleFadeTimeout = null;
let aiReviewTargetId = null;

// Auth State
let loggedInUser = null;
const userCredentials = {
    "2008": "2008-nit",
    "1974": "1974-nar",
    "1987": "1987-ana",
    "2012": "2012-pra"
};

function saveSessions() {
    if (!loggedInUser) return;
    try { localStorage.setItem(`sonicbloom_data_${loggedInUser}`, JSON.stringify(sessions)); } catch(e){}
}

function loadSessions() {
    if (!loggedInUser) return;
    try {
        const stored = localStorage.getItem(`sonicbloom_data_${loggedInUser}`);
        sessions = stored ? JSON.parse(stored) : [];
        renderSessionList();
    } catch(e) {}
}

// Initialization & Resize
function resize() {
  elements.canvas.width = window.innerWidth;
  elements.canvas.height = window.innerHeight;
}
window.addEventListener('resize', resize);
resize();

function getColor(value, index, total, theme) {
  if (theme === 'rainbow') return `hsl(${((index / total) * 360 + Date.now() / 20) % 360}, 100%, 60%)`;
  if (theme === 'cyberpunk') {
    const ratio = value / 255;
    return `rgb(${Math.floor(255 - ratio * 100)}, ${Math.floor(ratio * 50)}, ${Math.floor(150 + ratio * 105)})`;
  }
  if (theme === 'fire') return `hsl(${(value / 255) * 60}, 100%, ${40 + (value / 255) * 20}%)`;
}

// ---------------------------
// AUDIO SYSTEM
// ---------------------------
async function startAudio(autoRecord = false) {
  if (isReviewing) exitReviewMode();

  try {
    const msgEl = autoRecord ? elements.freqStatusMsg : elements.statusMsg;
    msgEl.innerText = "Requesting microphone...";
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 512; 
    analyser.smoothingTimeConstant = 0.85; 

    source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);

    bufferLength = analyser.frequencyBinCount; // 256 bins
    frequencyData = new Uint8Array(bufferLength);
    timeDomainData = new Uint8Array(analyser.fftSize); // 512 points for oscilloscope

    if (!autoRecord) {
      elements.startBtn.classList.add('hidden');
      elements.stopBtn.classList.remove('hidden');
      elements.mainUi.classList.add('minimal');
      elements.statusMsg.innerText = "Listening. Speak or play music!";
      
      currentSession = {
        id: Date.now(),
        name: `Recording ${sessions.length + 1}`,
        dataFrames: [], 
        waveformMap: [] 
      };
    } else {
      elements.startFreqBtn.classList.add('hidden');
      elements.stopFreqBtn.classList.remove('hidden');
      elements.frequencyPanel.classList.add('minimal');
      elements.freqStatusMsg.innerText = `Listening for ${elements.targetFreqInput.value}Hz...`;
      elements.quickViewContainer.classList.add('hidden');
      currentSession = null; // Created later automatically
    }
    
    // Start AI Subtitles (Speech Recognition) Phase 1
    if (elements.aiSubtitlesToggle.checked && (window.SpeechRecognition || window.webkitSpeechRecognition)) {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!textRecognition) {
          textRecognition = new SpeechRecognition();
          textRecognition.continuous = true;
          textRecognition.interimResults = true;
          textRecognition.onresult = (event) => {
              let text = "";
              for (let i = event.resultIndex; i < event.results.length; ++i) {
                  text += event.results[i][0].transcript;
              }
              elements.aiSubtitlesContainer.innerText = text;
              elements.aiSubtitlesContainer.classList.remove('hidden');
              handleSentiment(text);
              
              if (subtitleFadeTimeout) clearTimeout(subtitleFadeTimeout);
              subtitleFadeTimeout = setTimeout(() => {
                  elements.aiSubtitlesContainer.classList.add('hidden');
              }, 4000); // fade out after 4 seconds of silence
          };
      }
      try { textRecognition.start(); } catch(e) {}
    }
    
    isRecording = true;
    draw();
  } catch (err) {
    const msgEl = autoRecord ? elements.freqStatusMsg : elements.statusMsg;
    msgEl.innerText = "Error accessing microphone. Check permissions.";
  }
}

function stopAudio() {
  if (stream) stream.getTracks().forEach(track => track.stop());
  if (audioContext) audioContext.close();
  
  cancelAnimationFrame(animationId);
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height); 
  
  if (sleepTimeout) clearTimeout(sleepTimeout);
  elements.startBtn.classList.remove('hidden');
  elements.stopBtn.classList.add('hidden');
  elements.mainUi.classList.remove('minimal');
  elements.statusMsg.innerText = "Stopped & Saved.";

  elements.startFreqBtn.classList.remove('hidden');
  elements.stopFreqBtn.classList.add('hidden');
  elements.frequencyPanel.classList.remove('minimal');
  elements.freqStatusMsg.innerText = "Detection stopped.";

  if (autoRecordSilenceTimeout) {
      clearTimeout(autoRecordSilenceTimeout);
      autoRecordSilenceTimeout = null;
  }

  // Save the record
  if (isRecording && currentSession) {
    isRecording = false;
    if (currentSession.dataFrames.length > 0) {
      sessions.push(currentSession);
      saveSessions();
      renderSessionList();
    }
  }

  // Phase 1: Clean up AI recognition
  if (textRecognition) {
      try { textRecognition.stop(); } catch(e){}
      elements.aiSubtitlesContainer.classList.add('hidden');
  }
}

// ---------------------------
// AI SYSTEM LOGIC
// ---------------------------
function handleSentiment(text) {
    const raw = text.toLowerCase();
    if (raw.includes("fire") || raw.includes("angry") || raw.includes("hot") || raw.includes("burn") || raw.includes("danger")) {
        elements.colorSelect.value = "fire";
    } else if (raw.includes("cyber") || raw.includes("hack") || raw.includes("robot") || raw.includes("neon") || raw.includes("system") || raw.includes("matrix")) {
        elements.colorSelect.value = "cyberpunk";
    } else if (raw.includes("rainbow") || raw.includes("happy") || raw.includes("color") || raw.includes("magic") || raw.includes("joy") || raw.includes("beautiful")) {
        elements.colorSelect.value = "rainbow";
    }
}

function analyzeAudioSourceLight(freq, amp, waveform) {
    if (amp < NOISE_GATE + 5) return "Silence / Idle";
    
    let zeroCrossings = 0;
    for(let i = 1; i < waveform.length; i++) {
        if ((waveform[i-1] >= 128 && waveform[i] < 128) || (waveform[i-1] < 128 && waveform[i] >= 128)) {
            zeroCrossings++;
        }
    }
    
    if (zeroCrossings > 150) return "White Noise / Fan 🌬️";
    if (freq > 85 && freq < 300 && zeroCrossings > 20 && zeroCrossings < 80) return "Human Speech 🗣️";
    if (freq > 260 && freq < 2000 && zeroCrossings < 50) return "Melodic / Music 🎵";
    if (freq > 3000) return "High Pitch / Whistle 🔔";
    if (amp > 220) return "Loud Percussion 🥁";
    
    return "Ambient Sounds 📻";
}

function generateAIInsights(sess) {
    if (!sess || sess.dataFrames.length === 0) return "No data recorded to analyze.";
    
    const valid = sess.dataFrames.filter(d => d.freq > 0);
    if (valid.length === 0) return "The recording is pure silence. The AI detects no energy signatures.";
    
    const maxEnergy = Math.max(...valid.map(v => v.energy));
    const avgFreq = valid.reduce((a, b) => a + b.freq, 0) / valid.length;
    
    let report = `<strong><br>Analysis Duration:</strong> ${(sess.waveformMap.length / 60).toFixed(1)}s<br>`;
    report += `<strong>Peak Photon Energy:</strong> ${maxEnergy.toExponential(2)} J<br><br>`;
    
    if (avgFreq > 80 && avgFreq < 300) {
        report += `The primary frequency signature centers around ${avgFreq.toFixed(0)}Hz, highly characteristic of human speech or low-mid instrumentation. The varying waveform amplitudes suggest vocal modulation or rhythmic patterns. `;
    } else if (avgFreq > 1000) {
        report += `This is a high-frequency signature (${avgFreq.toFixed(0)}Hz). The sharp peaks identify this as mechanical noise, whistling, or electronic synthesizers. `;
    } else {
        report += `The signature reveals a mixed mid-range frequency distribution, typical for music or complex ambient environments. `;
    }
    
    const variance = valid.reduce((acc, v) => acc + Math.pow(v.freq - avgFreq, 2), 0) / valid.length;
    if (variance < 100) {
        report += `<br><br><em>Note: Based on the low frequency variance (${Math.round(variance)}), this represents a highly stable, uniform acoustic tone.</em>`;
    } else {
        report += `<br><br><em>Note: The variance is exceptionally high (${Math.round(variance)}), showing rapid chaotic frequency shifts or multiple overlapping sound sources.</em>`;
    }
    
    return report;
}

// ---------------------------
// RENDER LOOP (LIVE)
// ---------------------------
function draw() {
  if (!isRecording) return;
  animationId = requestAnimationFrame(draw);

  analyser.getByteFrequencyData(frequencyData);
  analyser.getByteTimeDomainData(timeDomainData); // Gets waveform instead of frequencies

  // 1. Math & Noise Gating
  let maxAmp = 0;
  let peakIndex = 0;
  
  // Find peak volume in frequency domain
  for (let i = 0; i < bufferLength; i++) {
    if (frequencyData[i] > maxAmp) {
      maxAmp = frequencyData[i];
      peakIndex = i;
    }
  }

  // Calculate actual frequency of the peak bin accurately
  const nyquist = audioContext.sampleRate / 2;
  let actualFrequency = 0, energy = 0, wavelength = 0;

  // Noise Gate: Ignore if below threshold
  if (maxAmp > NOISE_GATE && peakIndex > 2) { 
    actualFrequency = (peakIndex * nyquist) / bufferLength;
    energy = PLANCK_CONSTANT * actualFrequency;
    wavelength = (PLANCK_CONSTANT * SPEED_OF_LIGHT) / energy;
  }

  // Update UI & Log Data
  updatePhysicsUI(actualFrequency, energy, wavelength);
  
  // Phase 2: Update AI Audio Classifier (every 10 frames to optimize performance)
  if (animationId % 10 === 0) {
      elements.aiSoundClass.innerText = analyzeAudioSourceLight(actualFrequency, maxAmp, timeDomainData);
  }

  if (isFrequencyMode && isRecording) {
      const targetFreq = parseFloat(elements.targetFreqInput.value) || 0;
      let tolerance = parseFloat(elements.freqToleranceInput.value) || 0;
      
      const nyquist = audioContext.sampleRate / 2;
      const binWidth = nyquist / bufferLength;
      if (tolerance < binWidth) tolerance = binWidth; 
      
      const isActive = actualFrequency > NOISE_GATE && maxAmp > (NOISE_GATE + 5); 
      const isMatch = isActive && Math.abs(actualFrequency - targetFreq) <= tolerance;
      
      if (isMatch) {
          if (!currentSession) {
              currentSession = {
                  id: Date.now(),
                  name: `Auto ${targetFreq}Hz (${sessions.length + 1})`,
                  dataFrames: [],
                  waveformMap: []
              };
              elements.freqStatusMsg.innerText = "🎯 Frequency Detected! Recording...";
              elements.frequencyPanel.classList.remove('minimal');
          }
          
          if (autoRecordSilenceTimeout) clearTimeout(autoRecordSilenceTimeout);
          
          autoRecordSilenceTimeout = setTimeout(() => {
              if (currentSession) {
                  const savedId = currentSession.id;
                  sessions.push(currentSession);
                  saveSessions();
                  renderSessionList();
                  currentSession = null;
                  
                  elements.freqStatusMsg.innerHTML = `<span style="color:#10b981">✅ Captured and Saved!</span> Listening for ${targetFreq}Hz...`;
                  elements.quickViewContainer.classList.remove('hidden');
                  elements.quickViewBtn.onclick = () => { viewSession(savedId); };
                  
                  elements.frequencyPanel.classList.add('minimal');
              }
          }, 2000);
      }
  }
  
  // Push to current active recording session
  if (currentSession) {
    // We sample a subset of timeDomain points for the static review waveform
    const sampleWavePoint = timeDomainData[Math.floor(timeDomainData.length / 2)];
    currentSession.dataFrames.push({ freq: actualFrequency, energy, wavelength, amp: maxAmp });
    currentSession.waveformMap.push(sampleWavePoint);
  }

  // 2. Visual Drawing
  ctx.fillStyle = 'rgba(5, 5, 16, 0.4)'; // Fade trail
  ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);

  const mode = elements.modeSelect.value;
  const theme = elements.colorSelect.value;

  if (mode === 'bars') {
    // Standard Neon Bars
    const barWidth = (elements.canvas.width / bufferLength) * 2;
    let x = 0;
    for (let i = 0; i < bufferLength; i++) {
      const barHeight = (frequencyData[i] / 255) * (elements.canvas.height * 0.7);
      if(barHeight > 5) { // Only draw if active
        ctx.fillStyle = getColor(frequencyData[i], i, bufferLength, theme);
        ctx.shadowBlur = 15; ctx.shadowColor = ctx.fillStyle;
        ctx.fillRect(x, elements.canvas.height / 2 - barHeight / 2, barWidth, barHeight);
      }
      x += barWidth + 1;
    }
    ctx.shadowBlur = 0;

  } else if (mode === 'radial') {
    // **NEW Smooth Big Round Radial Wave** using TimeDomain
    const cX = elements.canvas.width / 2;
    const cY = elements.canvas.height / 2;
    const baseRadius = Math.min(cX, cY) * 0.4; // very large circle
    
    ctx.beginPath();
    
    const waveLength = timeDomainData.length;
    for (let i = 0; i < waveLength; i++) {
        // v ranges from 0 to ~2 (1 is silence)
        const v = timeDomainData[i] / 128.0; 
        
        // Push radius outward perfectly smoothly
        const r = baseRadius * (0.8 + (v * 0.2));
        
        // Wrap 360 degrees
        const angle = (i / (waveLength - 1)) * Math.PI * 2; 
        
        const x = cX + Math.cos(angle) * r;
        const y = cY + Math.sin(angle) * r;
        
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    
    ctx.closePath();
    
    // Solid styling
    ctx.lineWidth = 6;
    // Base the circle color off the dominant frequency peak
    ctx.strokeStyle = getColor(maxAmp, peakIndex, bufferLength, theme); 
    ctx.shadowBlur = 30;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.stroke();
    
    // Fill slightly
    ctx.fillStyle = ctx.strokeStyle.replace('rgb', 'rgba').replace('hsl', 'hsla').replace(')', ', 0.1)');
    ctx.fill();
    ctx.shadowBlur = 0;
  }
}

// ---------------------------
// DATA FORMATTING & UI
// ---------------------------
function updatePhysicsUI(f, e, w) {
  if (f <= 0) {
    elements.freqVal.innerText = "0 Hz (Idle)";
    elements.energyVal.innerText = "0 J";
    elements.waveVal.innerText = "0 m";
    return;
  }
  elements.freqVal.innerText = f.toFixed(1) + " Hz";
  elements.energyVal.innerText = e.toExponential(3) + " J";
  elements.waveVal.innerText = (w > 1000 ? (w / 1000).toFixed(1) + " km" : w.toFixed(1) + " m");
}

// ---------------------------
// SESSIONS MANAGEMENT
// ---------------------------
function renderSessionList() {
  elements.sessionList.innerHTML = '';
  if (sessions.length === 0) {
    elements.sessionList.innerHTML = '<li class="empty-msg">No recordings yet.</li>';
    return;
  }

  sessions.forEach((sess, index) => {
    // Generate averages over the session
    const validFrames = sess.dataFrames.filter(d => d.freq > 0);
    const avgFreq = validFrames.length > 0 ? (validFrames.reduce((acc, curr) => acc + curr.freq, 0) / validFrames.length).toFixed(0) : 0;
    const duration = (sess.waveformMap.length / 60).toFixed(1); // approx seconds assuming 60fps

    const li = document.createElement('li');
    li.className = 'session-item';
    li.innerHTML = `
      <div class="session-info">
        <span class="session-name">${sess.name}</span>
        <span class="session-meta">⏱ ${duration}s | Avg ${avgFreq}Hz</span>
      </div>
      <div class="session-actions">
        <button class="icon-btn view-btn" title="View Waveform"><i data-lucide="eye"></i></button>
        <button class="icon-btn delete delete-btn" title="Delete"><i data-lucide="trash-2"></i></button>
      </div>
    `;

    // Events
    li.querySelector('.view-btn').addEventListener('click', () => viewSession(sess.id));
    li.querySelector('.delete-btn').addEventListener('click', () => deleteSession(sess.id));
    
    elements.sessionList.appendChild(li);
  });
  lucide.createIcons();
}

function deleteSession(id) {
  sessions = sessions.filter(s => s.id !== id);
  saveSessions();
  renderSessionList();
  if (isReviewing) exitReviewMode(); // exit if deleted active review
}

function viewSession(id) {
  const sess = sessions.find(s => s.id === id);
  if (!sess) return;
  
  if (isRecording) stopAudio(); // Ensure mic is free

  isReviewing = true;
  aiReviewTargetId = id;
  elements.mainUi.classList.add('hidden');
  elements.sessionsPanel.classList.add('hidden');
  elements.physicsPanel.classList.remove('hidden');
  elements.reviewOverlay.classList.remove('hidden');
  elements.reviewTitle.innerText = sess.name;

  // Render static waveform onto canvas
  ctx.fillStyle = '#050510';
  ctx.fillRect(0, 0, elements.canvas.width, elements.canvas.height);

  ctx.beginPath();
  const width = elements.canvas.width;
  const height = elements.canvas.height;
  const cY = height / 2;
  
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#3b82f6';
  ctx.shadowBlur = 10;
  ctx.shadowColor = '#3b82f6';

  for (let i = 0; i < sess.waveformMap.length; i++) {
    const x = (i / sess.waveformMap.length) * width;
    const v = sess.waveformMap[i] / 128.0; // 1 is center
    const y = cY + (v - 1) * (height * 0.4);

    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Update Physics to show Session averages
  const validFrames = sess.dataFrames.filter(d => d.freq > 0);
  if (validFrames.length > 0) {
    const avgFreq = validFrames.reduce((acc, curr) => acc + curr.freq, 0) / validFrames.length;
    const avgEnergy = validFrames.reduce((acc, curr) => acc + curr.energy, 0) / validFrames.length;
    const avgWave = validFrames.reduce((acc, curr) => acc + curr.wavelength, 0) / validFrames.length;
    updatePhysicsUI(avgFreq, avgEnergy, avgWave);
  } else {
    updatePhysicsUI(0, 0, 0); // Was pure silence
  }
}

function exitReviewMode() {
  isReviewing = false;
  aiReviewTargetId = null;
  elements.reviewOverlay.classList.add('hidden');
  elements.insightOverlay.classList.add('hidden');
  ctx.clearRect(0, 0, elements.canvas.width, elements.canvas.height); 
  updatePhysicsUI(0, 0, 0);
  elements.statusMsg.innerText = "Ready to record.";
  
  // Restore layout based on active tab
  if (elements.tabLive.classList.contains('active')) {
    elements.mainUi.classList.remove('hidden');
    elements.physicsPanel.classList.remove('hidden');
  } else {
    elements.sessionsPanel.classList.remove('hidden');
    elements.physicsPanel.classList.add('hidden');
  }
}

// Binds
elements.startBtn.addEventListener('click', () => startAudio(false));
elements.stopBtn.addEventListener('click', stopAudio);
elements.startFreqBtn.addEventListener('click', () => startAudio(true));
elements.stopFreqBtn.addEventListener('click', stopAudio);
elements.exitReviewBtn.addEventListener('click', exitReviewMode);
elements.closeInsightBtn.addEventListener('click', () => elements.insightOverlay.classList.add('hidden'));

elements.askAiBtn.addEventListener('click', () => {
    if (aiReviewTargetId) {
        const sess = sessions.find(s => s.id === aiReviewTargetId);
        elements.insightContent.innerHTML = generateAIInsights(sess);
        elements.insightOverlay.classList.remove('hidden');
        lucide.createIcons();
    }
});

// Tab Switching Logic
function switchTab(tab) {
  elements.tabLive.classList.remove('active');
  elements.tabRecorded.classList.remove('active');
  elements.tabFrequency.classList.remove('active');

  if (isRecording) stopAudio();
  if (isReviewing) exitReviewMode();

  elements.sessionsPanel.classList.add('hidden');
  elements.mainUi.classList.add('hidden');
  elements.frequencyPanel.classList.add('hidden');
  elements.physicsPanel.classList.add('hidden');
  elements.quickViewContainer.classList.add('hidden');
  
  isFrequencyMode = false;

  if (tab === 'live') {
    elements.tabLive.classList.add('active');
    elements.mainUi.classList.remove('hidden');
    elements.physicsPanel.classList.remove('hidden');
  } else if (tab === 'recorded') {
    elements.tabRecorded.classList.add('active');
    elements.sessionsPanel.classList.remove('hidden');
  } else if (tab === 'frequency') {
    elements.tabFrequency.classList.add('active');
    elements.frequencyPanel.classList.remove('hidden');
    elements.physicsPanel.classList.remove('hidden');
    isFrequencyMode = true;
  }

  // Close the drop-down menu automatically after tab selection
  elements.appMenu.classList.add('hidden');
}

elements.tabLive.addEventListener('click', () => switchTab('live'));
elements.tabRecorded.addEventListener('click', () => switchTab('recorded'));
elements.tabFrequency.addEventListener('click', () => switchTab('frequency'));
elements.menuToggle.addEventListener('click', () => {
  elements.appMenu.classList.toggle('hidden');
});

// ---------------------------
// UI WAKE MANAGEMENT
// ---------------------------
function wakeUpUI() {
  if (!isRecording) return;
  
  if (isFrequencyMode) elements.frequencyPanel.classList.remove('minimal');
  else elements.mainUi.classList.remove('minimal');
  
  if (sleepTimeout) {
    clearTimeout(sleepTimeout);
  }
  
  sleepTimeout = setTimeout(() => {
    if (isRecording) {
      if (isFrequencyMode) elements.frequencyPanel.classList.add('minimal');
      else elements.mainUi.classList.add('minimal');
    }
  }, 10000);
}

// Wake the UI when hovering over it
elements.mainUi.addEventListener('mouseenter', wakeUpUI);
elements.mainUi.addEventListener('mousemove', wakeUpUI);
elements.frequencyPanel.addEventListener('mouseenter', wakeUpUI);
elements.frequencyPanel.addEventListener('mousemove', wakeUpUI);

// ---------------------------
// AUTHENTICATION LOOP
// ---------------------------
function attemptLogin() {
    const account = elements.loginAccount.value.trim();
    const pass = elements.loginPassword.value.trim();
    
    if (userCredentials[account] && userCredentials[account] === pass) {
        loggedInUser = account;
        elements.loginOverlay.classList.add('hidden');
        elements.loginError.classList.add('hidden');
        
        // Reset app state & load user data
        elements.loginAccount.value = "";
        elements.loginPassword.value = "";
        loadSessions();
        lucide.createIcons();
    } else {
        elements.loginError.classList.remove('hidden');
    }
}

function handleLogout() {
    if (isRecording) stopAudio();
    if (isReviewing) exitReviewMode();
    
    loggedInUser = null;
    sessions = [];
    currentSession = null;
    renderSessionList();
    
    // Switch to visualizer tab for clean start on next login
    switchTab('live');
    
    // Show login overlay
    elements.loginOverlay.classList.remove('hidden');
}

elements.loginBtn.addEventListener('click', attemptLogin);
elements.loginPassword.addEventListener('keypress', (e) => { if (e.key === 'Enter') attemptLogin(); });
elements.logoutBtn.addEventListener('click', handleLogout);

