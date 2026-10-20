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
  { id: 'cow_1', label: 'Cow 1', mode: 'firebase' },
  { id: 'cow_2', label: 'Cow 2', mode: 'firebase' },
  { id: 'cow_3', label: 'Cow 3', mode: 'simulated', demoLabel: 'Healthy Baseline' },
  { id: 'cow_4', label: 'Cow 4', mode: 'simulated', demoLabel: 'Elevated Temp Alert' },
  { id: 'cow_5', label: 'Cow 5', mode: 'simulated', demoLabel: 'Low Temp Warning' },
  { id: 'cow_6', label: 'Cow 6', mode: 'simulated', demoLabel: 'Active Grazing' },
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
   Manipur Districts & Pasture Coordinates
===================================================== */
const MANIPUR_DISTRICTS = {
  cow_1: {
    district: 'Imphal West',
    locationName: 'Lamphelpat Pasture Field',
    centerLat: 24.8214,
    centerLng: 93.9218,
    radiusMeters: 220,
  },
  cow_2: {
    district: 'Bishnupur',
    locationName: 'Loktak Lake Meadows (Moirang)',
    centerLat: 24.5042,
    centerLng: 93.7745,
    radiusMeters: 250,
  },
  cow_3: {
    district: 'Thoubal',
    locationName: 'Thoubal River Valley Grassland',
    centerLat: 24.6415,
    centerLng: 94.0125,
    radiusMeters: 200,
  },
  cow_4: {
    district: 'Churachandpur',
    locationName: 'Tuibong Plateau Meadow',
    centerLat: 24.3365,
    centerLng: 93.6812,
    radiusMeters: 230,
  },
  cow_5: {
    district: 'Kangpokpi',
    locationName: 'Sadar Hills Reserve Range',
    centerLat: 25.1482,
    centerLng: 93.9680,
    radiusMeters: 210,
  },
  cow_6: {
    district: 'Kakching',
    locationName: 'Pallel Agrarian Field Zone',
    centerLat: 24.4862,
    centerLng: 93.9835,
    radiusMeters: 240,
  },
};

const EXTRA_MANIPUR_DISTRICTS = [
  { district: 'Ukhrul', locationName: 'Shirui Foothills Range', centerLat: 25.1165, centerLng: 94.3620, radiusMeters: 220 },
  { district: 'Senapati', locationName: 'Senapati Highland Pasture', centerLat: 25.2672, centerLng: 94.0175, radiusMeters: 220 },
  { district: 'Tamenglong', locationName: 'Barak River Grazing Basin', centerLat: 24.9840, centerLng: 93.4910, radiusMeters: 230 },
  { district: 'Imphal East', locationName: 'Porompat Dairy Range', centerLat: 24.8105, centerLng: 93.9660, radiusMeters: 200 },
  { district: 'Chandel', locationName: 'Maha Valley Pasture', centerLat: 24.3290, centerLng: 94.0040, radiusMeters: 220 },
  { district: 'Noney', locationName: 'Ijei River Meadows', centerLat: 24.8210, centerLng: 93.6010, radiusMeters: 220 },
];

function getDistrictForDevice(deviceId, index) {
  if (MANIPUR_DISTRICTS[deviceId]) {
    return MANIPUR_DISTRICTS[deviceId];
  }
  return EXTRA_MANIPUR_DISTRICTS[index % EXTRA_MANIPUR_DISTRICTS.length];
}

const DEVICE_COLORS = [
  '#1D9E75', '#378ADD', '#9B5DE5', '#EF9F27', '#E24B4A', '#F15BB5', '#00BBF9', '#00F5D4'
];

/* =====================================================
   Per-device state registry
===================================================== */
// deviceState[id] = { chart, chartData, currentView, lastSeen, rtdbRef, map, marker, trailPolyline, pastureCircle, districtInfo, geo }
const deviceState = {};

/* =====================================================
   All Cattle Fleet Map State
===================================================== */
let allCattleMap = null;
const allCattleMarkers = {};
const allCattleTrails = {};
const allCattleCircles = {};

/* =====================================================
   Fullscreen Map Helpers
===================================================== */
function toggleMapFullscreen(cardEl, mapInstance) {
  if (!cardEl) return;
  const isFs = cardEl.classList.contains('is-fullscreen');
  const btn = cardEl.querySelector('.btn-fullscreen');
  const fsText = btn?.querySelector('.fs-text');

  if (isFs) {
    cardEl.classList.remove('is-fullscreen');
    document.body.classList.remove('has-fullscreen-map');
    btn?.classList.remove('active');
    if (fsText) fsText.textContent = 'Fullscreen';
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  } else {
    cardEl.classList.add('is-fullscreen');
    document.body.classList.add('has-fullscreen-map');
    btn?.classList.add('active');
    if (fsText) fsText.textContent = 'Exit Fullscreen';
    if (cardEl.requestFullscreen && !document.fullscreenElement) {
      cardEl.requestFullscreen().catch(() => {});
    }
  }

  setTimeout(() => {
    if (mapInstance) mapInstance.invalidateSize();
  }, 120);
}

document.addEventListener('fullscreenchange', () => {
  if (!document.fullscreenElement) {
    document.querySelectorAll('.map-card.is-fullscreen').forEach(card => {
      card.classList.remove('is-fullscreen');
      const btn = card.querySelector('.btn-fullscreen');
      btn?.classList.remove('active');
      const fsText = btn?.querySelector('.fs-text');
      if (fsText) fsText.textContent = 'Fullscreen';
    });
    document.body.classList.remove('has-fullscreen-map');
    Object.values(deviceState).forEach(st => {
      if (st.map) st.map.invalidateSize();
    });
    if (allCattleMap) allCattleMap.invalidateSize();
  }
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    const fsCard = document.querySelector('.map-card.is-fullscreen');
    if (fsCard) {
      const devId = fsCard.dataset.deviceId;
      const targetMap = devId === 'all' ? allCattleMap : deviceState[devId]?.map;
      toggleMapFullscreen(fsCard, targetMap);
    }
  }
});

/* =====================================================
   DOM Bootstrap — build tabs + panels from DEVICES list
===================================================== */
const tabNav = document.getElementById('device-tabs');
const panelsWrapper = document.getElementById('panels-container');
const timestampEl = document.getElementById('timestamp-val');
const footerDevEl = document.getElementById('footer-device-label');

let activeDeviceId = 'all';

/* ── "All Cattle" Tab Button ── */
const allTabBtn = document.createElement('button');
allTabBtn.id = 'tab-btn-all';
allTabBtn.className = 'tab-btn tab-btn-all active';
allTabBtn.setAttribute('role', 'tab');
allTabBtn.setAttribute('aria-selected', 'true');
allTabBtn.setAttribute('aria-controls', 'panel-all');
allTabBtn.dataset.deviceId = 'all';
allTabBtn.innerHTML = `
  <span class="tab-indicator" style="--tab-accent: #378ADD"></span>
  <span class="tab-fleet-icon">🗺️</span>
  All Cattle (Manipur)
`;
allTabBtn.addEventListener('click', () => switchTab('all'));
tabNav.appendChild(allTabBtn);

/* ── "All Cattle" Panel ── */
const allPanel = document.createElement('section');
allPanel.id = 'panel-all';
allPanel.className = 'device-panel active';
allPanel.setAttribute('role', 'tabpanel');
allPanel.setAttribute('aria-labelledby', 'tab-btn-all');
allPanel.innerHTML = `
  <!-- Fleet Summary Cards -->
  <div class="fleet-summary-grid">
    <div class="card summary-card">
      <span class="card-label">Total Cattle</span>
      <p><span id="fleet-total-count">${DEVICES.length}</span><span class="unit">monitored</span></p>
      <div class="status-badge status-ok">All tracked</div>
    </div>
    <div class="card summary-card">
      <span class="card-label">Avg Pulse Rate</span>
      <p><span id="fleet-avg-pulse">--</span><span class="unit">BPM</span></p>
      <div id="fleet-avg-pulse-badge" class="status-badge status-ok">Active herd</div>
    </div>
    <div class="card summary-card">
      <span class="card-label">Avg Internal Temp</span>
      <p><span id="fleet-avg-temp">--</span><span class="unit">°C</span></p>
      <div id="fleet-avg-temp-badge" class="status-badge status-ok">Normal range</div>
    </div>
    <div class="card summary-card">
      <span class="card-label">Districts of Manipur</span>
      <p><span id="fleet-districts-count">${Object.keys(MANIPUR_DISTRICTS).length}</span><span class="unit">districts</span></p>
      <div class="status-badge status-neutral">State coverage</div>
    </div>
  </div>

  <!-- State-Wide OpenStreetMap Card -->
  <div class="card map-card all-map-card" id="all-map-card" style="margin-top: 1.5rem; min-height: 540px; --device-accent: #378ADD;" data-device-id="all">
    <div class="map-header">
      <div class="map-header-left">
        <span class="card-label">State-Wide Multi-Cattle Tracking (Manipur)</span>
        <div class="all-map-chips-bar" id="all-map-cows-filter">
          <button type="button" class="chip-cow-focus active" data-cow="all">
            <span class="chip-cow-dot" style="background: #378ADD;"></span>
            All Manipur
          </button>
          ${DEVICES.map((d, i) => `
            <button type="button" class="chip-cow-focus" data-cow="${d.id}">
              <span class="chip-cow-dot" style="background: ${DEVICE_COLORS[i % DEVICE_COLORS.length]};"></span>
              ${d.label} (${getDistrictForDevice(d.id, i).district})
            </button>
          `).join('')}
        </div>
      </div>
      <div class="map-header-right" style="display: flex; gap: 8px; align-items: center; flex-wrap: wrap;">
        <span class="coords-badge">📍 Manipur State View</span>
        <button type="button" class="btn-fullscreen" id="all-map-btn-fullscreen" title="Expand map to full screen">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
          <span class="fs-text">Fullscreen</span>
        </button>
      </div>
    </div>
    <div class="map-container-wrap" style="min-height: 420px;">
      <div id="map-all_cattle" class="cattle-map"></div>
    </div>
    <div class="map-footer">
      <div class="map-legend">
        <span class="pulsing-map-dot"></span>
        <span>Simulating live wandering across Manipur districts</span>
      </div>
      <div style="display: flex; gap: 8px;">
        <button type="button" class="btn-recenter" id="all-map-btn-fit" title="Fit all cattle in view">
          Fit All Cattle
        </button>
      </div>
    </div>
  </div>

  <!-- Fleet Roster Section -->
  <div class="fleet-cards-section" style="margin-top: 2rem;">
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 1rem; flex-wrap: wrap; gap: 0.5rem;">
      <h3 style="font-size: 1.15rem; font-weight: 600;">Cattle Fleet Roster</h3>
      <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">Click any card to inspect detailed sensor history</span>
    </div>
    <div class="fleet-cards-grid" id="fleet-roster-grid"></div>
  </div>
`;
panelsWrapper.appendChild(allPanel);

DEVICES.forEach((device, index) => {
  const districtInfo = getDistrictForDevice(device.id, index);
  const deviceColor = DEVICE_COLORS[index % DEVICE_COLORS.length];

  /* ── Tab button ── */
  const btn = document.createElement('button');
  btn.id = `tab-btn-${device.id}`;
  btn.className = 'tab-btn';
  btn.setAttribute('role', 'tab');
  btn.setAttribute('aria-selected', 'false');
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
  panel.className = 'device-panel';
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

    <!-- Sensor measurements (left) + OpenStreetMap (right) -->
    <div class="metrics-map-row">
      <div class="sensors-column">
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

      <!-- Live OpenStreetMap (Manipur District) -->
      <div class="map-column">
        <div class="card map-card" id="map-card-${device.id}" data-device-id="${device.id}" style="--device-accent: ${deviceColor};">
          <div class="map-header">
            <div class="map-header-left">
              <span class="card-label">Live Pasture Location (OSM)</span>
              <span class="district-badge" id="${device.id}-district-badge">📍 ${districtInfo.district}, Manipur</span>
            </div>
            <div class="map-header-right" style="display: flex; gap: 6px; align-items: center; flex-wrap: wrap;">
              <span class="coords-badge" id="${device.id}-coords">--.----° N, --.----° E</span>
              <button type="button" class="btn-toggle-all" id="${device.id}-btn-toggle-all" title="View all cattle in Manipur on this map">
                <span>View All (${DEVICES.length})</span>
              </button>
              <button type="button" class="btn-fullscreen" id="${device.id}-btn-fullscreen" title="Full screen map">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>
                <span class="fs-text">Fullscreen</span>
              </button>
            </div>
          </div>
          <div class="map-container-wrap">
            <div id="map-${device.id}" class="cattle-map"></div>
          </div>
          <div class="map-footer">
            <div class="map-legend">
              <span class="pulsing-map-dot"></span>
              <span id="${device.id}-movement-status">Grazing in pasture</span>
              <span class="speed-pill mono" id="${device.id}-speed">1.2 km/h</span>
            </div>
            <button type="button" class="btn-recenter" id="${device.id}-btn-recenter" title="Center map on cattle">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M12 2v3M12 19v3M2 12h3M19 12h3"></path></svg>
              Recenter
            </button>
          </div>
        </div>
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
  const startLat = districtInfo.centerLat + (Math.random() - 0.5) * 0.0006;
  const startLng = districtInfo.centerLng + (Math.random() - 0.5) * 0.0006;

  deviceState[device.id] = {
    chart: null,
    chartData: { labels: [], pulse: [], internalTemp: [], externalTemp: [] },
    currentView: 'pulse',
    lastSeen: null,
    rtdbRef: null,
    // Map & Geolocation state
    map: null,
    marker: null,
    trailPolyline: null,
    pastureCircle: null,
    districtInfo: districtInfo,
    extraMarkers: [],
    showingAllOnSingle: false,
    latestReading: null,
    geo: {
      lat: startLat,
      lng: startLng,
      targetLat: districtInfo.centerLat + (Math.random() - 0.5) * 0.0012,
      targetLng: districtInfo.centerLng + (Math.random() - 0.5) * 0.0012,
      speedKmh: 1.2,
      history: [[startLat, startLng]]
    }
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
  const targetPanel = document.getElementById(id === 'all' ? 'panel-all' : `panel-${id}`);
  if (targetPanel) targetPanel.classList.add('active');

  /* Toggle tab buttons */
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('active');
    b.setAttribute('aria-selected', 'false');
  });
  const activeBtn = document.getElementById(id === 'all' ? 'tab-btn-all' : `tab-btn-${id}`);
  if (activeBtn) {
    activeBtn.classList.add('active');
    activeBtn.setAttribute('aria-selected', 'true');
  }

  /* All cattle fleet overview */
  if (id === 'all') {
    footerDevEl.textContent = `All Cattle Fleet (${DEVICES.length})`;
    const footerSourceEl = document.getElementById('footer-source-label');
    if (footerSourceEl) footerSourceEl.textContent = 'Fleet Overview';
    timestampEl.textContent = new Date().toLocaleTimeString('en-GB', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
    });

    if (allCattleMap) {
      setTimeout(() => {
        allCattleMap.invalidateSize();
        fitAllCattleBounds();
      }, 100);
    } else {
      setTimeout(() => initAllCattleMap(), 50);
    }
    updateFleetSummaryAndRoster();
    return;
  }

  /* Specific cattle view */
  footerDevEl.textContent = id;
  updateFooterSource(id);

  /* Resize chart (needed after display:none → block) */
  const state = deviceState[id];
  if (state?.chart) {
    setTimeout(() => state.chart.resize(), 50);
  }

  /* Invalidate Leaflet map size and re-center on cattle */
  if (state?.map) {
    setTimeout(() => {
      state.map.invalidateSize();
      if (state.geo?.lat && state.geo?.lng) {
        state.map.panTo([state.geo.lat, state.geo.lng], { animate: false });
      }
    }, 100);
  } else {
    setTimeout(() => initMap(id), 50);
  }

  /* Refresh timestamp */
  if (state?.lastSeen) {
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
  if (deviceState[deviceId]?.chart) return;
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
   OpenStreetMap (OSM) — Leaflet Integration
===================================================== */
function initMap(deviceId) {
  const state = deviceState[deviceId];
  if (!state || state.map) return;

  const container = document.getElementById(`map-${deviceId}`);
  if (!container) return;

  if (typeof L === 'undefined') {
    console.warn(`Leaflet not ready for ${deviceId}, retrying...`);
    setTimeout(() => initMap(deviceId), 200);
    return;
  }

  const deviceIdx = DEVICES.findIndex(d => d.id === deviceId);
  const deviceColor = DEVICE_COLORS[deviceIdx >= 0 ? deviceIdx % DEVICE_COLORS.length : 0];
  const info = state.districtInfo;

  try {
    // 1. Create Leaflet map instance centered on Manipur district pasture
    const map = L.map(container, {
      center: [state.geo.lat, state.geo.lng],
      zoom: 15,
      minZoom: 10,
      maxZoom: 18,
      zoomControl: true,
      attributionControl: true
    });

    // 2. OpenStreetMap standard tile layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(map);

    // 3. Pasture perimeter circle (grazing zone in Manipur district)
    const pastureCircle = L.circle([info.centerLat, info.centerLng], {
      radius: info.radiusMeters,
      color: deviceColor,
      weight: 1.5,
      dashArray: '5, 6',
      fillColor: deviceColor,
      fillOpacity: 0.08
    }).addTo(map);

    pastureCircle.bindTooltip(`${info.locationName} (${info.district} District)`, {
      direction: 'top',
      opacity: 0.9
    });

    // 4. Movement breadcrumb trail polyline
    const trailPolyline = L.polyline(state.geo.history, {
      color: deviceColor,
      weight: 3,
      opacity: 0.8,
      dashArray: '4, 6',
      lineCap: 'round',
      lineJoin: 'round'
    }).addTo(map);

    // 5. Custom Cattle Marker with animated halo
    const devLabel = DEVICES.find(d => d.id === deviceId)?.label || deviceId;
    const markerHtml = `
      <div class="cow-marker-container">
        <div class="cow-marker-bubble" style="--marker-color: ${deviceColor};">
          <span class="cow-marker-halo" style="--marker-color: ${deviceColor};"></span>
          <span class="cow-marker-emoji">🐄</span>
        </div>
        <div class="cow-marker-tag">${devLabel}</div>
      </div>
    `;

    const customIcon = L.divIcon({
      className: 'cow-custom-icon',
      html: markerHtml,
      iconSize: [42, 58],
      iconAnchor: [21, 29],
      popupAnchor: [0, -28]
    });

    const marker = L.marker([state.geo.lat, state.geo.lng], {
      icon: customIcon
    }).addTo(map);

    const getPopupContent = () => `
      <div class="cattle-popup-header">
        <span>🐄</span>
        <strong>${devLabel}</strong>
        <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${deviceColor};"></span>
      </div>
      <div class="cattle-popup-loc">${info.district} District · ${info.locationName}</div>
      <div class="cattle-popup-meta">
        <span>Lat: ${state.geo.lat.toFixed(5)}°</span>
        <span>Lng: ${state.geo.lng.toFixed(5)}°</span>
      </div>
      <div class="cattle-popup-stats">
        Moving: <strong>${state.geo.speedKmh.toFixed(1)} km/h</strong> (Simulated)
      </div>
    `;

    marker.bindPopup(getPopupContent);

    state.map = map;
    state.marker = marker;
    state.trailPolyline = trailPolyline;
    state.pastureCircle = pastureCircle;

    // Recenter button
    const recenterBtn = document.getElementById(`${deviceId}-btn-recenter`);
    if (recenterBtn) {
      recenterBtn.addEventListener('click', () => {
        map.setView([state.geo.lat, state.geo.lng], 15, { animate: true });
      });
    }

    // Fullscreen button
    const fsBtn = document.getElementById(`${deviceId}-btn-fullscreen`);
    const mapCard = document.getElementById(`map-card-${deviceId}`);
    if (fsBtn && mapCard) {
      fsBtn.addEventListener('click', () => {
        toggleMapFullscreen(mapCard, state.map);
      });
    }

    // View All cattle toggle on single map
    const toggleAllBtn = document.getElementById(`${deviceId}-btn-toggle-all`);
    if (toggleAllBtn) {
      toggleAllBtn.addEventListener('click', () => {
        state.showingAllOnSingle = !state.showingAllOnSingle;
        toggleAllBtn.classList.toggle('active', state.showingAllOnSingle);
        const span = toggleAllBtn.querySelector('span');
        if (span) span.textContent = state.showingAllOnSingle ? 'Focus Cow' : `View All (${DEVICES.length})`;

        if (state.showingAllOnSingle) {
          state.extraMarkers = [];
          DEVICES.forEach((otherDev, oIdx) => {
            if (otherDev.id === deviceId) return;
            const otherColor = DEVICE_COLORS[oIdx % DEVICE_COLORS.length];
            const otherGeo = deviceState[otherDev.id]?.geo;
            if (!otherGeo) return;

            const m = L.marker([otherGeo.lat, otherGeo.lng], {
              icon: L.divIcon({
                className: 'cow-custom-icon',
                html: `
                  <div class="cow-marker-container">
                    <div class="cow-marker-bubble" style="--marker-color: ${otherColor};">
                      <span class="cow-marker-halo" style="--marker-color: ${otherColor};"></span>
                      <span class="cow-marker-emoji">🐄</span>
                    </div>
                    <div class="cow-marker-tag">${otherDev.label}</div>
                  </div>
                `,
                iconSize: [42, 58],
                iconAnchor: [21, 29],
                popupAnchor: [0, -28]
              })
            }).addTo(map);

            m.bindPopup(`
              <div class="cattle-popup-header">
                <span>🐄</span>
                <strong>${otherDev.label}</strong>
              </div>
              <div class="cattle-popup-loc">${getDistrictForDevice(otherDev.id, oIdx).district} District</div>
              <div class="cattle-popup-stats" style="margin-top: 6px;">
                <button type="button" class="btn-open-cow" onclick="switchTab('${otherDev.id}')">Switch to ${otherDev.label} →</button>
              </div>
            `);

            state.extraMarkers.push({ id: otherDev.id, marker: m });
          });

          // Fit bounds to show all cows across Manipur
          const points = DEVICES.map(d => [deviceState[d.id]?.geo.lat, deviceState[d.id]?.geo.lng]).filter(p => p[0] && p[1]);
          if (points.length > 0) {
            map.fitBounds(L.latLngBounds(points), { padding: [50, 50], animate: true });
          }
        } else {
          // Remove extra markers and zoom back to this cow
          state.extraMarkers.forEach(item => map.removeLayer(item.marker));
          state.extraMarkers = [];
          map.setView([state.geo.lat, state.geo.lng], 15, { animate: true });
        }
      });
    }

    updateMapBadges(deviceId);

    // If active tab, ensure correct sizing
    if (deviceId === activeDeviceId) {
      setTimeout(() => map.invalidateSize(), 100);
    }
  } catch (err) {
    console.error(`Failed to initialize map for ${deviceId}:`, err);
  }
}

/* =====================================================
   All Cattle Fleet Map (State-Wide Manipur)
===================================================== */
function initAllCattleMap() {
  if (allCattleMap) return;
  const container = document.getElementById('map-all_cattle');
  if (!container || typeof L === 'undefined') return;

  try {
    allCattleMap = L.map(container, {
      center: [24.78, 93.94],
      zoom: 10,
      minZoom: 9,
      maxZoom: 18,
      zoomControl: true,
      attributionControl: true
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
    }).addTo(allCattleMap);

    // Add pasture circles, trails, and markers for each cow
    DEVICES.forEach((dev, idx) => {
      const state = deviceState[dev.id];
      const color = DEVICE_COLORS[idx % DEVICE_COLORS.length];
      const info = state ? state.districtInfo : getDistrictForDevice(dev.id, idx);
      const geo = state ? state.geo : { lat: info.centerLat, lng: info.centerLng };

      // Pasture circle
      const circle = L.circle([info.centerLat, info.centerLng], {
        radius: info.radiusMeters,
        color: color,
        weight: 1.5,
        dashArray: '5, 6',
        fillColor: color,
        fillOpacity: 0.08
      }).addTo(allCattleMap);

      circle.bindTooltip(`${dev.label} Pasture — ${info.district} District`, {
        direction: 'top',
        opacity: 0.9
      });
      allCattleCircles[dev.id] = circle;

      // Polyline trail
      const trail = L.polyline(geo.history || [[geo.lat, geo.lng]], {
        color: color,
        weight: 3,
        opacity: 0.8,
        dashArray: '4, 6',
        lineCap: 'round',
        lineJoin: 'round'
      }).addTo(allCattleMap);
      allCattleTrails[dev.id] = trail;

      // Custom marker
      const markerHtml = `
        <div class="cow-marker-container">
          <div class="cow-marker-bubble" style="--marker-color: ${color};">
            <span class="cow-marker-halo" style="--marker-color: ${color};"></span>
            <span class="cow-marker-emoji">🐄</span>
          </div>
          <div class="cow-marker-tag">${dev.label}</div>
        </div>
      `;

      const marker = L.marker([geo.lat, geo.lng], {
        icon: L.divIcon({
          className: 'cow-custom-icon',
          html: markerHtml,
          iconSize: [42, 58],
          iconAnchor: [21, 29],
          popupAnchor: [0, -28]
        })
      }).addTo(allCattleMap);

      const updatePopup = () => {
        const currentGeo = deviceState[dev.id]?.geo || geo;
        const curPulse = document.getElementById(`${dev.id}-pulse`)?.textContent || '--';
        const curTemp = document.getElementById(`${dev.id}-internalTemp`)?.textContent || '--';
        return `
          <div class="cattle-popup-header">
            <span>🐄</span>
            <strong>${dev.label}</strong>
            <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};"></span>
          </div>
          <div class="cattle-popup-loc">${info.district} District · ${info.locationName}</div>
          <div class="cattle-popup-meta">
            <span>Lat: ${currentGeo.lat.toFixed(5)}°</span>
            <span>Lng: ${currentGeo.lng.toFixed(5)}°</span>
          </div>
          <div class="cattle-popup-stats" style="margin-bottom: 8px;">
            Pulse: <strong>${curPulse} BPM</strong> · Temp: <strong>${curTemp} °C</strong> · Speed: <strong>${currentGeo.speedKmh ? currentGeo.speedKmh.toFixed(1) : '1.2'} km/h</strong>
          </div>
          <button type="button" class="btn-open-cow" onclick="switchTab('${dev.id}')" style="width: 100%; text-align: center;">
            Open ${dev.label} Sensors Dashboard →
          </button>
        `;
      };

      marker.bindPopup(updatePopup);
      allCattleMarkers[dev.id] = marker;
    });

    fitAllCattleBounds();

    // Fit button
    const fitBtn = document.getElementById('all-map-btn-fit');
    if (fitBtn) {
      fitBtn.addEventListener('click', fitAllCattleBounds);
    }

    // Fullscreen button
    const fsBtn = document.getElementById('all-map-btn-fullscreen');
    const allMapCard = document.getElementById('all-map-card');
    if (fsBtn && allMapCard) {
      fsBtn.addEventListener('click', () => {
        toggleMapFullscreen(allMapCard, allCattleMap);
      });
    }

    // Filter chips
    const chipContainer = document.getElementById('all-map-cows-filter');
    if (chipContainer) {
      chipContainer.querySelectorAll('.chip-cow-focus').forEach(chip => {
        chip.addEventListener('click', () => {
          chipContainer.querySelectorAll('.chip-cow-focus').forEach(c => c.classList.remove('active'));
          chip.classList.add('active');
          const cowId = chip.dataset.cow;
          if (cowId === 'all') {
            fitAllCattleBounds();
          } else {
            const st = deviceState[cowId];
            if (st?.geo) {
              allCattleMap.setView([st.geo.lat, st.geo.lng], 15, { animate: true });
              if (allCattleMarkers[cowId]) {
                setTimeout(() => allCattleMarkers[cowId].openPopup(), 300);
              }
            }
          }
        });
      });
    }

    // Render roster cards
    renderFleetRosterGrid();
    updateFleetSummaryAndRoster();

  } catch (err) {
    console.error('Failed to initialize All Cattle Map:', err);
  }
}

function fitAllCattleBounds() {
  if (!allCattleMap) return;
  const points = DEVICES.map(d => {
    const geo = deviceState[d.id]?.geo;
    return geo ? [geo.lat, geo.lng] : null;
  }).filter(Boolean);

  if (points.length > 0) {
    allCattleMap.fitBounds(L.latLngBounds(points), { padding: [50, 50], animate: true });
  }
}

function renderFleetRosterGrid() {
  const grid = document.getElementById('fleet-roster-grid');
  if (!grid) return;
  grid.innerHTML = '';

  DEVICES.forEach((dev, idx) => {
    const color = DEVICE_COLORS[idx % DEVICE_COLORS.length];
    const info = getDistrictForDevice(dev.id, idx);
    const card = document.createElement('div');
    card.className = 'fleet-roster-card';
    card.id = `roster-card-${dev.id}`;
    card.style.setProperty('--card-accent', color);

    card.innerHTML = `
      <div class="fleet-roster-top">
        <div>
          <div class="fleet-roster-title">
            <span style="color: ${color};">●</span>
            ${dev.label}
          </div>
          <div class="fleet-roster-district">📍 ${info.district} District · ${info.locationName}</div>
        </div>
        <div id="roster-${dev.id}-badge" class="status-badge status-ok">Online</div>
      </div>
      <div class="fleet-roster-metrics">
        <div>
          <span class="roster-metric-label">Pulse</span>
          <span class="roster-metric-val" id="roster-${dev.id}-pulse">--</span> <span class="unit">BPM</span>
        </div>
        <div>
          <span class="roster-metric-label">Internal Temp</span>
          <span class="roster-metric-val" id="roster-${dev.id}-temp">--</span> <span class="unit">°C</span>
        </div>
      </div>
      <div class="fleet-roster-bottom">
        <span class="mono" id="roster-${dev.id}-coords" style="font-size: 11px; color: var(--text-muted);">--.----° N, --.----° E</span>
        <button type="button" class="btn-open-cow" onclick="switchTab('${dev.id}')">View Details →</button>
      </div>
    `;
    grid.appendChild(card);
  });
}

function updateFleetSummaryAndRoster() {
  let pulseSum = 0;
  let pulseCount = 0;
  let tempSum = 0;
  let tempCount = 0;

  DEVICES.forEach(dev => {
    const st = deviceState[dev.id];
    if (!st) return;

    // Pulse
    const pulseEl = document.getElementById(`${dev.id}-pulse`);
    const pVal = pulseEl ? parseFloat(pulseEl.textContent) : NaN;
    if (!isNaN(pVal) && pVal > 0) {
      pulseSum += pVal;
      pulseCount++;
      const rPulse = document.getElementById(`roster-${dev.id}-pulse`);
      if (rPulse) rPulse.textContent = Math.round(pVal);
    }

    // Temp
    const tempEl = document.getElementById(`${dev.id}-internalTemp`);
    const tVal = tempEl ? parseFloat(tempEl.textContent) : NaN;
    if (!isNaN(tVal) && tVal > 0) {
      tempSum += tVal;
      tempCount++;
      const rTemp = document.getElementById(`roster-${dev.id}-temp`);
      if (rTemp) rTemp.textContent = tVal.toFixed(2);
    }

    // Coords
    const rCoords = document.getElementById(`roster-${dev.id}-coords`);
    if (rCoords && st.geo) {
      rCoords.textContent = `${st.geo.lat.toFixed(4)}° N, ${st.geo.lng.toFixed(4)}° E`;
    }
  });

  const avgPulseEl = document.getElementById('fleet-avg-pulse');
  if (avgPulseEl) {
    avgPulseEl.textContent = pulseCount > 0 ? Math.round(pulseSum / pulseCount) : '--';
  }

  const avgTempEl = document.getElementById('fleet-avg-temp');
  if (avgTempEl) {
    avgTempEl.textContent = tempCount > 0 ? (tempSum / tempCount).toFixed(2) : '--';
  }
}

function updateMapBadges(deviceId) {
  const state = deviceState[deviceId];
  if (!state || !state.geo) return;

  const coordsEl = document.getElementById(`${deviceId}-coords`);
  if (coordsEl) {
    coordsEl.textContent = `${state.geo.lat.toFixed(4)}° N, ${state.geo.lng.toFixed(4)}° E`;
  }

  const districtBadge = document.getElementById(`${deviceId}-district-badge`);
  if (districtBadge && state.districtInfo) {
    districtBadge.textContent = `📍 ${state.districtInfo.district}, Manipur`;
  }

  const speedEl = document.getElementById(`${deviceId}-speed`);
  if (speedEl) {
    speedEl.textContent = `${state.geo.speedKmh.toFixed(1)} km/h`;
  }

  const statusText = document.getElementById(`${deviceId}-movement-status`);
  if (statusText && state.districtInfo) {
    statusText.textContent = `Grazing · ${state.districtInfo.locationName}`;
  }
}

/* =====================================================
   Cattle Movement Simulation (Districts of Manipur)
===================================================== */
function simulateCattleMovementStep(deviceId) {
  const state = deviceState[deviceId];
  if (!state || !state.geo) return;

  const info = state.districtInfo;
  const geo = state.geo;

  // Vector towards target
  const dLat = geo.targetLat - geo.lat;
  const dLng = geo.targetLng - geo.lng;
  const dist = Math.sqrt(dLat * dLat + dLng * dLng);

  // If close to current pasture target or randomly, select a new waypoint in pasture
  if (dist < 0.00012 || Math.random() < 0.08) {
    // 1 deg lat ≈ 111,000 m; 1 deg lng ≈ 100,750 m at 24.8°N
    const maxLatDelta = (info.radiusMeters * 0.82) / 111000;
    const maxLngDelta = (info.radiusMeters * 0.82) / 100750;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()); // Uniform circle distribution

    geo.targetLat = info.centerLat + Math.sin(angle) * maxLatDelta * r;
    geo.targetLng = info.centerLng + Math.cos(angle) * maxLngDelta * r;
    geo.speedKmh = Number((0.6 + Math.random() * 1.6).toFixed(1));
  }

  // Smooth step towards target with gentle natural forage wander
  const stepRate = 0.07 + Math.random() * 0.04;
  const jitterLat = (Math.random() - 0.5) * 0.00003;
  const jitterLng = (Math.random() - 0.5) * 0.00003;

  geo.lat += (geo.targetLat - geo.lat) * stepRate + jitterLat;
  geo.lng += (geo.targetLng - geo.lng) * stepRate + jitterLng;

  // Append to history trail (keep last 20 coordinates)
  geo.history.push([geo.lat, geo.lng]);
  if (geo.history.length > 20) {
    geo.history.shift();
  }

  // Update map marker and polyline trail
  if (state.marker) {
    state.marker.setLatLng([geo.lat, geo.lng]);
    if (state.marker.isPopupOpen && state.marker.isPopupOpen()) {
      state.marker.setPopupContent(`
        <div class="cattle-popup-header">
          <span>🐄</span>
          <strong>${DEVICES.find(d => d.id === deviceId)?.label || deviceId}</strong>
        </div>
        <div class="cattle-popup-loc">${info.district} District · ${info.locationName}</div>
        <div class="cattle-popup-meta">
          <span>Lat: ${geo.lat.toFixed(5)}°</span>
          <span>Lng: ${geo.lng.toFixed(5)}°</span>
        </div>
        <div class="cattle-popup-stats">
          Moving: <strong>${geo.speedKmh.toFixed(1)} km/h</strong> (Simulated)
        </div>
      `);
    }
  }

  if (state.trailPolyline) {
    state.trailPolyline.setLatLngs(geo.history);
  }

  // Also update position on All Cattle Fleet Map
  if (allCattleMarkers[deviceId]) {
    allCattleMarkers[deviceId].setLatLng([geo.lat, geo.lng]);
  }
  if (allCattleTrails[deviceId]) {
    allCattleTrails[deviceId].setLatLngs(geo.history);
  }

  // Update extra markers on any individual map that has View All toggled
  Object.values(deviceState).forEach(st => {
    if (st.showingAllOnSingle && st.extraMarkers) {
      const em = st.extraMarkers.find(m => m.id === deviceId);
      if (em) em.marker.setLatLng([geo.lat, geo.lng]);
    }
  });

  updateMapBadges(deviceId);
  updateFleetSummaryAndRoster();
}

let mapMovementIntervalId = null;

function startMapMovementTicker() {
  if (mapMovementIntervalId) return;

  // Run initial step for all devices
  DEVICES.forEach(dev => {
    simulateCattleMovementStep(dev.id);
  });

  // Tick every 2.5 seconds to simulate moving cattle across Manipur
  mapMovementIntervalId = setInterval(() => {
    DEVICES.forEach(dev => {
      simulateCattleMovementStep(dev.id);
    });
  }, 2500);
}

/* =====================================================
   Firebase RTDB — seed chart from persistent history on page load
===================================================== */
function seedHistoryFromRTDB(deviceId) {
  const historyPath = `/cattle/${deviceId}/history`;
  console.log(`[${deviceId}] Attempting to seed history from: ${historyPath}`);

  db.ref(historyPath)
    .orderByKey()
    .limitToLast(MAX_HISTORY_POINTS)
    .once('value', snapshot => {
      if (!snapshot.exists()) {
        console.warn(`[${deviceId}] No history data found at path: ${historyPath}. ` +
          `Check that your device writes to this path (not just latest_reading).`);
        return;
      }

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
      console.log(`[${deviceId}] ✅ Seeded ${rows.length} history points from RTDB.`);
    }, err => {
      console.error(`[${deviceId}] ❌ History seed FAILED — code: ${err.code}, message: ${err.message}`);
      if (err.code === 'PERMISSION_DENIED') {
        console.error(`[${deviceId}] → RTDB rules are blocking reads. ` +
          `Enable Anonymous Auth in Firebase Console (Authentication → Sign-in method) ` +
          `or open your RTDB rules to allow public reads.`);
      }
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

  /* Hardware GPS coordinates if provided by RTDB */
  const lat = data.latitude ?? data.lat;
  const lng = data.longitude ?? data.lng;
  if (lat != null && lng != null && !isNaN(lat) && !isNaN(lng)) {
    const state = deviceState[deviceId];
    if (state && state.geo) {
      state.geo.lat = Number(lat);
      state.geo.lng = Number(lng);
      if (state.marker) state.marker.setLatLng([state.geo.lat, state.geo.lng]);
      state.geo.history.push([state.geo.lat, state.geo.lng]);
      if (state.geo.history.length > 20) state.geo.history.shift();
      if (state.trailPolyline) state.trailPolyline.setLatLngs(state.geo.history);
      updateMapBadges(deviceId);
    }
  }
}

function setBadge(el, text, cls) {
  if (!el) return;
  el.textContent = text;
  el.className = `status-badge ${cls}`;
}

/* =====================================================
   Footer Source Indicator
===================================================== */
function updateFooterSource(deviceId) {
  const footerSourceEl = document.getElementById('footer-source-label');
  if (!footerSourceEl) return;
  footerSourceEl.textContent = 'Firebase RTDB';
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
   DEMO SIMULATION ENGINE (Cows 3, 4, 5 & 6)
===================================================== */
const SIMULATION_PROFILES = {
  cow_3: {
    name: 'Cow 3',
    statusDesc: 'Healthy / Normal Baseline',
    basePulse: 66,
    pulseAmp: 3,
    pulseClamp: [62, 70],
    baseInternalTemp: 38.65,
    tempAmp: 0.15,
    tempClamp: [38.45, 38.85], // Cattle normal is 38.3 – 39.4 °C
    baseExternalTemp: 26.5,
    extAmp: 0.3,
    baseDistance: 45,
    distAmp: 4,
  },
  cow_4: {
    name: 'Cow 4',
    statusDesc: 'Fever / Elevated Temp (Alert Demo)',
    basePulse: 92,
    pulseAmp: 4,
    pulseClamp: [88, 96],
    baseInternalTemp: 39.95,
    tempAmp: 0.20,
    tempClamp: [39.75, 40.20], // Alert is > 39.4 °C
    baseExternalTemp: 29.8,
    extAmp: 0.4,
    baseDistance: 36,
    distAmp: 3,
  },
  cow_5: {
    name: 'Cow 5',
    statusDesc: 'Hypothermia / Low Temp (Warning Demo)',
    basePulse: 54,
    pulseAmp: 3,
    pulseClamp: [50, 58],
    baseInternalTemp: 37.95,
    tempAmp: 0.16,
    tempClamp: [37.75, 38.15], // Warning is < 38.3 °C
    baseExternalTemp: 21.8,
    extAmp: 0.3,
    baseDistance: 50,
    distAmp: 4,
  },
  cow_6: {
    name: 'Cow 6',
    statusDesc: 'Active Pasture Grazing (Dynamic Demo)',
    basePulse: 78,
    pulseAmp: 6,
    pulseClamp: [72, 85],
    baseInternalTemp: 38.90,
    tempAmp: 0.18,
    tempClamp: [38.70, 39.10], // Cattle normal is 38.3 – 39.4 °C
    baseExternalTemp: 27.4,
    extAmp: 0.4,
    baseDistance: 55,
    distAmp: 25,
  },
};

function generateSimulatedPoint(deviceId, stepIndex, timestamp) {
  const profile = SIMULATION_PROFILES[deviceId];
  if (!profile) return null;

  const t = stepIndex * 0.35;
  const wave1 = Math.sin(t);
  const wave2 = Math.cos(t * 0.6);

  // Pulse (BPM)
  const pulseRaw = profile.basePulse + wave1 * profile.pulseAmp + (wave2 * 0.8) + (Math.random() - 0.5) * 1.0;
  const pulseBPM = Math.min(profile.pulseClamp[1], Math.max(profile.pulseClamp[0], Math.round(pulseRaw)));

  // Internal Temperature (°C)
  const tempRaw = profile.baseInternalTemp + wave2 * profile.tempAmp + (wave1 * 0.04) + (Math.random() - 0.5) * 0.03;
  const internalTemperature = Number(Math.min(profile.tempClamp[1], Math.max(profile.tempClamp[0], tempRaw)).toFixed(2));

  // External Temperature (°C)
  const extRaw = profile.baseExternalTemp + wave1 * profile.extAmp + (Math.random() - 0.5) * 0.05;
  const externalTemperature = Number(extRaw.toFixed(2));

  // Distance (cm)
  const distRaw = profile.baseDistance + Math.sin(t * 0.5) * profile.distAmp + (Math.random() - 0.5) * 2;
  const distanceCM = Math.max(5, Math.round(distRaw));

  return {
    pulseBPM,
    internalTemperature,
    externalTemperature,
    distanceCM,
    timestamp: timestamp || Date.now()
  };
}

function seedSimulatedHistory(deviceId) {
  const cd = deviceState[deviceId].chartData;
  cd.labels = [];
  cd.pulse = [];
  cd.internalTemp = [];
  cd.externalTemp = [];

  const pointsCount = 20;
  const intervalMs = 5000;
  const now = Date.now();

  for (let i = pointsCount - 1; i >= 0; i--) {
    const ptTime = now - (i * intervalMs);
    const reading = generateSimulatedPoint(deviceId, pointsCount - i, ptTime);
    pushToHistory(deviceId, reading);
  }

  const latest = generateSimulatedPoint(deviceId, pointsCount, now);
  deviceState[deviceId].lastSeen = now;
  updateCards(deviceId, latest);
  markOnline(deviceId);
}

let simulationStep = 25;
let simulationIntervalId = null;

function startSimulationTicker() {
  if (simulationIntervalId) return;

  // Initialize history and cards for each simulated device
  DEVICES.filter(d => d.mode === 'simulated').forEach(dev => {
    seedSimulatedHistory(dev.id);
  });

  simulationIntervalId = setInterval(() => {
    const now = Date.now();
    simulationStep++;

    DEVICES.filter(d => d.mode === 'simulated').forEach(dev => {
      const reading = generateSimulatedPoint(dev.id, simulationStep, now);
      deviceState[dev.id].lastSeen = now;

      pushToHistory(dev.id, reading);
      updateCards(dev.id, reading);
      markOnline(dev.id);

      if (dev.id === activeDeviceId) {
        timestampEl.textContent = new Date(now).toLocaleTimeString('en-GB', {
          hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit'
        });
      }
    });
  }, 5000);
}

/* =====================================================
   Offline Watchdog — check every 15 s
===================================================== */
function startOfflineWatchdog() {
  setInterval(() => {
    const now = Date.now();
    DEVICES.forEach(({ id, mode }) => {
      // Only monitor real hardware devices for timeout
      if (mode === 'simulated') return;
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
let bootstrapped = false;
let firebaseAttached = false;

function bootstrap() {
  if (bootstrapped) return;
  bootstrapped = true;

  if (activeDeviceId === 'all') {
    footerDevEl.textContent = `All Cattle Fleet (${DEVICES.length})`;
    const footerSourceEl = document.getElementById('footer-source-label');
    if (footerSourceEl) footerSourceEl.textContent = 'Fleet Overview';
  } else {
    footerDevEl.textContent = activeDeviceId;
    updateFooterSource(activeDeviceId);
  }

  DEVICES.forEach(device => {
    initChart(device.id);
    initMap(device.id);
  });

  initAllCattleMap();
  renderFleetRosterGrid();
  updateFleetSummaryAndRoster();

  startOfflineWatchdog();
  startSimulationTicker();
  startMapMovementTicker();
}

function attachFirebaseDevices() {
  if (firebaseAttached) return;
  firebaseAttached = true;

  DEVICES.filter(d => d.mode === 'firebase').forEach(({ id }) => {
    attachRtdbListener(id);
  });
}

/* =====================================================
   Auth Gate — sign in anonymously then attach Firebase
===================================================== */
auth.onAuthStateChanged(user => {
  if (user) {
    console.log('✅ Firebase Auth: signed in as', user.uid, '(anonymous:', user.isAnonymous, ')');
    bootstrap();
    attachFirebaseDevices();
  } else {
    console.log('Firebase Auth: no user session yet, waiting for signInAnonymously...');
  }
});

// Trigger anonymous sign-in
auth.signInAnonymously()
  .then(() => {
    console.log('✅ signInAnonymously() succeeded.');
    bootstrap();
    attachFirebaseDevices();
  })
  .catch(err => {
    console.error('❌ Firebase anonymous auth FAILED:', err.code, err.message);
    if (err.code === 'auth/operation-not-allowed') {
      console.error('→ Anonymous sign-in is DISABLED in Firebase Console. ' +
        'Go to Authentication → Sign-in method → Enable Anonymous.');
    }
    // Auth is disabled or blocked — fall back to unauthenticated listeners
    bootstrap();
    attachFirebaseDevices();
  });

// Bootstrap UI, charts, and simulation immediately
bootstrap();
