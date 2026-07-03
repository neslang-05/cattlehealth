/*
=====================================================
  Multi-Device Cattle Health Dashboard
  Supports: Firebase RTDB (live) + Firestore (history)
  Each device gets isolated state, chart, and listeners.
=====================================================
*/

/* =====================================================
   CONFIGURATION — edit this list to add/remove devices
===================================================== */
const DEVICES = [
  { id: 'cow_1', label: 'Cow 1' },
  { id: 'cow_2', label: 'Cow 2' },
  { id: 'cow_3', label: 'Cow 3' },
];

// How long (ms) without data before marking a device offline
const OFFLINE_THRESHOLD_MS = 30000;

// Max data points to keep in the rolling history chart
const MAX_HISTORY_POINTS = 30;

/* =====================================================
   Firebase Configuration
===================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyAj7CcqeWrUemoyvATYDrT9PpdiIbye_lQ",
  projectId: "cattlehealthmonitoring-e1459",
  databaseURL: "https://cattlehealthmonitoring-e1459-default-rtdb.asia-southeast1.firebasedatabase.app"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const fs = firebase.firestore();
const auth = firebase.auth();

/* =====================================================
   Per-device state registry
===================================================== */
// deviceState[id] = { chart, chartData, currentView, lastSeen, rtdbRef }
const deviceState = {};

/* =====================================================
   DOM Bootstrap — build tabs + panels from DEVICES list
===================================================== */
const tabNav = document.getElementById('device-tabs');
const panelsWrapper = document.getElementById('panels-container');
const timestampEl = document.getElementById('timestamp-val');
const footerDevEl = document.getElementById('footer-device-label');

let activeDeviceId = DEVICES[0].id;

DEVICES.forEach((device, index) => {
  /* ── Tab button ── */
  const btn = document.createElement('button');
  btn.id = `tab-btn-${device.id}`;
  btn.className = `tab-btn${index === 0 ? ' active' : ''}`;
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', index === 0 ? 'true' : 'false');
  btn.setAttribute('aria-controls', `panel-${device.id}`);
  btn.dataset.deviceId = device.id;
  btn.dataset.colorIndex = index;
  btn.innerHTML = `
    <span class="tab-indicator" style="--tab-accent: var(--device-color-${index})"></span>
    <span class="tab-status-dot" id="tab-dot-${device.id}"></span>
    ${device.label}
  `;
  btn.addEventListener('click', () => switchTab(device.id));
  tabNav.appendChild(btn);

  /* ── Device panel ── */
  const panel = document.createElement('section');
  panel.id = `panel-${device.id}`;
  panel.className = `device-panel${index === 0 ? ' active' : ''}`;
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `tab-btn-${device.id}`);
  panel.innerHTML = `
    <!-- Offline overlay -->
    <div class="offline-overlay" id="offline-${device.id}" hidden>
      <div class="offline-content">
        <svg width="32" height="32" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="1.5" stroke-linecap="round" d="M3 3l18 18M8.5 8.5A5 5 0 0115.5 15.5M12 12v.01"/><path stroke="currentColor" stroke-width="1.5" d="M2 8.82A15.5 15.5 0 0112 6c1.84 0 3.6.32 5.24.9M5 11.19A10.5 10.5 0 0112 9a10.5 10.5 0 015 1.19M8 14.5a5 5 0 018 0"/></svg>
        <span>Device offline — waiting for signal</span>
      </div>
    </div>

    <!-- Sensor cards grid -->
    <div class="grid">
      <div class="card pulse-card">
        <span class="card-label">Pulse Rate</span>
        <p><span id="${device.id}-pulse">--</span><span class="unit">BPM</span></p>
        <div id="${device.id}-pulse-badge" class="status-badge status-neutral">Sensor active</div>
      </div>

      <div class="card internal-card">
        <span class="card-label">Internal Temp</span>
        <p><span id="${device.id}-internalTemp">--</span><span class="unit">°C</span></p>
        <div id="${device.id}-internal-badge" class="status-badge status-neutral">Sensor active</div>
      </div>

      <div class="card external-card">
        <span class="card-label">External Temp</span>
        <p><span id="${device.id}-externalTemp">--</span><span class="unit">°C</span></p>
        <div id="${device.id}-external-badge" class="status-badge status-neutral">Sensor active</div>
      </div>

     
    </div>

    <!-- History chart -->
    <div class="chart-section">
      <div class="card chart-card">
        <div class="chart-header">
          <span class="card-label">Reading History</span>
          <div class="chart-controls">
            <button id="${device.id}-btn-pulse" class="btn-toggle active" data-device="${device.id}" data-view="pulse">Pulse</button>
            <button id="${device.id}-btn-temp"  class="btn-toggle"        data-device="${device.id}" data-view="temp">Temp</button>
          </div>
        </div>
        <div class="chart-container">
          <canvas id="chart-${device.id}"></canvas>
        </div>
      </div>
    </div>
  `;
  panelsWrapper.appendChild(panel);

  /* ── Initialise per-device state ── */
  deviceState[device.id] = {
    chart: null,
    chartData: { labels: [], pulse: [], internalTemp: [], externalTemp: [] },
    currentView: 'pulse',
    lastSeen: null,
    rtdbRef: null,
  };
});

/* =====================================================
   Tab Switching
===================================================== */
function switchTab(id) {
  if (id === activeDeviceId) return;
  activeDeviceId = id;

  /* Toggle panels */
  document.querySelectorAll('.device-panel').forEach(p => p.classList.remove('active'));
  document.getElementById(`panel-${id}`).classList.add('active');

  /* Toggle tab buttons */
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  const activeBtn = document.getElementById(`tab-btn-${id}`);
  activeBtn.classList.add('active');
  activeBtn.setAttribute('aria-selected', 'true');

  /* Update footer */
  footerDevEl.textContent = id;

  /* Resize chart (needed after display:none → block) */
  const state = deviceState[id];
  if (state.chart) {
    setTimeout(() => state.chart.resize(), 50);
  }

  /* Refresh timestamp */
  if (state.lastSeen) {
    timestampEl.textContent = new Date(state.lastSeen).toLocaleTimeString('en-GB', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    });
  } else {
    timestampEl.textContent = '—';
  }
}

/* =====================================================
   Chart.js — one instance per device
===================================================== */
const CHART_COLORS = [
  { border: '#E24B4A', bg: 'rgba(226,75,74,0.12)' },  // pulse
  { border: '#EF9F27', bg: 'rgba(239,159,39,0.12)' }, // internal temp
  { border: '#1D9E75', bg: 'rgba(29,158,117,0.12)' }, // external temp
];

function initChart(deviceId) {
  const canvas = document.getElementById(`chart-${deviceId}`);
  if (!canvas) return;

  const ctx = canvas.getContext('2d');

  const chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label: 'Pulse Rate (BPM)',
          data: [],
          borderColor: CHART_COLORS[0].border,
          backgroundColor: CHART_COLORS[0].bg,
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: CHART_COLORS[0].border,
          hidden: false
        },
        {
          label: 'Internal Temp (°C)',
          data: [],
          borderColor: CHART_COLORS[1].border,
          backgroundColor: CHART_COLORS[1].bg,
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: CHART_COLORS[1].border,
          hidden: true
        },
        {
          label: 'External Temp (°C)',
          data: [],
          borderColor: CHART_COLORS[2].border,
          backgroundColor: CHART_COLORS[2].bg,
          borderWidth: 2,
          tension: 0.4,
          fill: true,
          pointRadius: 3,
          pointBackgroundColor: CHART_COLORS[2].border,
          hidden: true
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1a1a1a',
          titleFont: { family: 'Sora', size: 12 },
          bodyFont: { family: 'Sora', size: 12 },
          padding: 12,
          cornerRadius: 8,
          displayColors: true
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: {
            font: { family: 'DM Mono', size: 10 },
            color: '#71717a',
            maxRotation: 0,
            autoSkip: true,
            maxTicksLimit: 8
          }
        },
        y: {
          grid: { color: '#f0f0f0' },
          ticks: {
            font: { family: 'DM Mono', size: 10 },
            color: '#71717a'
          }
        }
      }
    }
  });

  deviceState[deviceId].chart = chart;

  /* Wire up toggle buttons for this device */
  const btnPulse = document.getElementById(`${deviceId}-btn-pulse`);
  const btnTemp = document.getElementById(`${deviceId}-btn-temp`);

  btnPulse.addEventListener('click', () => {
    deviceState[deviceId].currentView = 'pulse';
    btnPulse.classList.add('active');
    btnTemp.classList.remove('active');
    renderChart(deviceId);
  });

  btnTemp.addEventListener('click', () => {
    deviceState[deviceId].currentView = 'temp';
    btnTemp.classList.add('active');
    btnPulse.classList.remove('active');
    renderChart(deviceId);
  });
}

function renderChart(deviceId) {
  const state = deviceState[deviceId];
  const chart = state.chart;
  if (!chart) return;

  const { chartData, currentView } = state;
  chart.data.labels = chartData.labels;

  if (currentView === 'pulse') {
    chart.data.datasets[0].data = chartData.pulse;
    chart.data.datasets[0].hidden = false;
    chart.data.datasets[1].hidden = true;
    chart.data.datasets[2].hidden = true;
  } else {
    chart.data.datasets[0].hidden = true;
    chart.data.datasets[1].data = chartData.internalTemp;
    chart.data.datasets[1].hidden = false;
    chart.data.datasets[2].data = chartData.externalTemp;
    chart.data.datasets[2].hidden = false;
  }

  chart.update('none');
}

/* =====================================================
   Firebase RTDB — seed chart from persistent history on page load
===================================================== */
function seedHistoryFromRTDB(deviceId) {
  db.ref(`/cattle/${deviceId}/history`)
    .orderByKey()
    .limitToLast(MAX_HISTORY_POINTS)
    .once('value', snapshot => {
      if (!snapshot.exists()) return;

      const rows = [];
      snapshot.forEach(child => rows.push(child.val()));
      // Firebase push keys are time-sorted ascending — already chronological

      // Clear any partial data before seeding
      const cd = deviceState[deviceId].chartData;
      cd.labels = [];
      cd.pulse = [];
      cd.internalTemp = [];
      cd.externalTemp = [];

      rows.forEach(data => pushToHistory(deviceId, data));
      console.log(`[${deviceId}] Seeded ${rows.length} history points from RTDB.`);
    }, err => {
      console.warn(`[${deviceId}] History seed error:`, err.message);
    });
}

/* =====================================================
   Firebase RTDB — live listener per device
   Also feeds the rolling history chart buffer.
===================================================== */
function attachRtdbListener(deviceId) {
  const ref = db.ref(`/cattle/${deviceId}/latest_reading`);
  deviceState[deviceId].rtdbRef = ref;

  // Pre-populate chart from stored history before live stream starts
  seedHistoryFromRTDB(deviceId);

  ref.on('value', snapshot => {
    const data = snapshot.val();
    if (!data) return;

    deviceState[deviceId].lastSeen = Date.now();

    /* Append to rolling history chart buffer */
    pushToHistory(deviceId, data);

    /* If this is the currently active tab, update footer timestamp */
    if (deviceId === activeDeviceId && data.timestamp) {
      const d = new Date(data.timestamp);
      timestampEl.textContent = d.toLocaleTimeString('en-GB', {
        hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
      });
    }

    updateCards(deviceId, data);
    markOnline(deviceId);
  }, err => {
    console.error(`[${deviceId}] RTDB error:`, err.code);
    markOffline(deviceId);
  });
}


/**
 * Push one RTDB reading into the per-device ring buffer and re-render the chart.
 * Skips duplicate timestamps so reconnects don't duplicate the last point.
 */
function pushToHistory(deviceId, data) {
  const state = deviceState[deviceId];
  const cd = state.chartData;

  // Label from Firebase server timestamp (ms epoch)
  const ts = data.timestamp
    ? new Date(data.timestamp).toLocaleTimeString('en-GB', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    })
    : new Date().toLocaleTimeString('en-GB', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

  // Skip if this exact timestamp label is already the last entry (duplicate on reconnect)
  if (cd.labels.length > 0 && cd.labels[cd.labels.length - 1] === ts) return;

  cd.labels.push(ts);
  cd.pulse.push(data.pulseBPM ?? 0);
  cd.internalTemp.push(data.internalTemperature ?? null);
  cd.externalTemp.push(data.externalTemperature ?? null);

  // Keep rolling window at MAX_HISTORY_POINTS
  if (cd.labels.length > MAX_HISTORY_POINTS) {
    cd.labels.shift();
    cd.pulse.shift();
    cd.internalTemp.shift();
    cd.externalTemp.shift();
  }

  renderChart(deviceId);
}

/* =====================================================
   Card updater
===================================================== */
function updateCards(deviceId, data) {
  const get = id => document.getElementById(`${deviceId}-${id}`);

  const pulseEl = get('pulse');
  const intTempEl = get('internalTemp');
  const extTempEl = get('externalTemp');
  const distEl = get('distance');

  if (pulseEl) pulseEl.textContent = data.pulseBPM ?? '--';
  if (intTempEl) intTempEl.textContent = data.internalTemperature != null ? data.internalTemperature.toFixed(2) : '--';
  if (extTempEl) extTempEl.textContent = data.externalTemperature != null ? data.externalTemperature.toFixed(2) : '--';
  if (distEl) distEl.textContent = data.distanceCM != null ? Math.round(data.distanceCM) : '--';

  /* Pulse badge */
  const pulseBadge = get('pulse-badge');
  if (data.pulseBPM === 0 || !data.pulseBPM) {
    setBadge(pulseBadge, 'No signal', 'status-alert');
  } else {
    setBadge(pulseBadge, 'Pulse active', 'status-ok');
  }

  /* Internal temp badge (cattle normal: 38.3 – 39.4 °C) */
  const intBadge = get('internal-badge');
  if (data.internalTemperature < 38.3) {
    setBadge(intBadge, 'Below normal', 'status-warn');
  } else if (data.internalTemperature > 39.4) {
    setBadge(intBadge, 'Above normal', 'status-alert');
  } else {
    setBadge(intBadge, 'Normal', 'status-ok');
  }

  /* External temp badge */
  setBadge(get('external-badge'), 'Normal', 'status-ok');

  /* Distance badge */
  setBadge(get('distance-badge'), 'Sensor active', 'status-neutral');
}

function setBadge(el, text, cls) {
  if (!el) return;
  el.textContent = text;
  el.className = `status-badge ${cls}`;
}

/* =====================================================
   Online / Offline state
===================================================== */
function markOnline(deviceId) {
  const overlay = document.getElementById(`offline-${deviceId}`);
  if (overlay) overlay.hidden = true;

  /* Tab dot = green */
  const dot = document.getElementById(`tab-dot-${deviceId}`);
  if (dot) {
    dot.classList.remove('dot-offline', 'dot-unknown');
    dot.classList.add('dot-online');
  }
}

function markOffline(deviceId) {
  const overlay = document.getElementById(`offline-${deviceId}`);
  if (overlay) overlay.hidden = false;

  /* Tab dot = red */
  const dot = document.getElementById(`tab-dot-${deviceId}`);
  if (dot) {
    dot.classList.remove('dot-online', 'dot-unknown');
    dot.classList.add('dot-offline');
  }

  if (deviceId === activeDeviceId) {
    timestampEl.textContent = 'Offline';
  }
}

/* =====================================================
   Offline Watchdog — check every 15 s
===================================================== */
function startOfflineWatchdog() {
  setInterval(() => {
    const now = Date.now();
    DEVICES.forEach(({ id }) => {
      const state = deviceState[id];
      if (state.lastSeen !== null && (now - state.lastSeen) > OFFLINE_THRESHOLD_MS) {
        markOffline(id);
      }
    });
  }, 15000);
}

/* =====================================================
   Bootstrap — initialise all devices
===================================================== */
function bootstrap() {
  footerDevEl.textContent = activeDeviceId;

  DEVICES.forEach(({ id }) => {
    initChart(id);
    attachRtdbListener(id); // history is built live from RTDB stream
  });

  startOfflineWatchdog();
}

/* =====================================================
   Auth Gate — sign in anonymously then start the app
   (required if Firebase RTDB rules use auth != null)
===================================================== */
auth.onAuthStateChanged(user => {
  if (user) {
    // Signed in — safe to attach Firebase listeners
    bootstrap();
  }
});

// Trigger anonymous sign-in
auth.signInAnonymously().catch(err => {
  console.error('Firebase anonymous auth failed:', err.code, err.message);
  // Auth is disabled or blocked — fall back to unauthenticated listeners
  // (works if RTDB rules allow public reads)
  bootstrap();
});
