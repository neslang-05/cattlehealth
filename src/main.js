// ============================================================
// Cattle Health Monitoring Dashboard — main.js
// Entry point processed by Vite. Firebase credentials are
// loaded securely from .env.local via import.meta.env.VITE_*
// ============================================================

// --- npm Imports ------------------------------------------------
import { initializeApp }              from 'firebase/app';
import { getDatabase, ref, onValue }  from 'firebase/database';
import Chart                          from 'chart.js/auto';
import './style.css'; // Vite processes and injects this stylesheet

// --- Firebase Configuration ------------------------------------
// Values come from .env.local at build time — never hardcoded.
// See .env.local for the key names and where to find the values.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL:       import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

// --- Alert Thresholds ------------------------------------------
// Each function returns true when the value is out of the normal range.
// Add / adjust rules here to change alert behaviour.
const ALERT_RULES = {
  internal_temp: (v) => Number.isFinite(v) && v > 39.5,          // °C
  spo2:          (v) => Number.isFinite(v) && v < 95,             // %
  heart_rate:    (v) => Number.isFinite(v) && (v < 50 || v > 90), // BPM
};

// --- Application State -----------------------------------------
const state = {
  devices:              {},    // All device records from devices/ node
  selectedDeviceId:     null,  // Currently active device
  telemetryUnsubscribe: null,  // Cleanup fn for the active telemetry listener
  chart:                null,  // Chart.js instance
};

// --- DOM References --------------------------------------------
// Collected once at startup to avoid repeated querySelector calls.
const dom = {
  deviceCount:       document.getElementById('deviceCount'),
  deviceList:        document.getElementById('deviceList'),
  deviceName:        document.getElementById('deviceName'),
  deviceLocation:    document.getElementById('deviceLocation'),
  deviceMac:         document.getElementById('deviceMac'),
  deviceFirmware:    document.getElementById('deviceFirmware'),
  deviceLastSeen:    document.getElementById('deviceLastSeen'),
  deviceStatus:      document.getElementById('deviceStatus'),
  internalTempValue: document.getElementById('internalTempValue'),
  externalTempValue: document.getElementById('externalTempValue'),
  heartRateValue:    document.getElementById('heartRateValue'),
  spo2Value:         document.getElementById('spo2Value'),
  distanceValue:     document.getElementById('distanceValue'),
};

// ---------------------------------------------------------------
// GUARD — Verify all VITE_FIREBASE_* env vars are present
// ---------------------------------------------------------------
function hasFirebaseConfig(config) {
  return Object.values(config).every((v) => v !== undefined && v !== '');
}

// ---------------------------------------------------------------
// CHART INITIALIZATION
// Uses chart.js/auto (all chart types pre-registered — no manual
// Chart.register() calls required). Dual Y-axes: temp (left) and
// heart rate (right).
// ---------------------------------------------------------------
function initChart() {
  const ctx = document.getElementById('historyChart');
  state.chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          label:           'Internal Temp (°C)',
          data:            [],
          yAxisID:         'yTemp',
          borderColor:     '#2fd3b4',
          backgroundColor: 'rgba(47, 211, 180, 0.18)',
          borderWidth:     2,
          tension:         0.3,
          pointRadius:     2,
        },
        {
          label:           'External Temp (°C)',
          data:            [],
          yAxisID:         'yTemp',
          borderColor:     '#61c9ff',
          backgroundColor: 'rgba(97, 201, 255, 0.18)',
          borderWidth:     2,
          tension:         0.3,
          pointRadius:     2,
        },
        {
          label:           'Heart Rate (BPM)',
          data:            [],
          yAxisID:         'yHr',
          borderColor:     '#ffb45f',
          backgroundColor: 'rgba(255, 180, 95, 0.16)',
          borderWidth:     2,
          tension:         0.28,
          pointRadius:     2,
        },
      ],
    },
    options: {
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#dbe8ed' } },
      },
      scales: {
        x: {
          ticks: { color: '#9fb4be', maxRotation: 0 },
          grid:  { color: 'rgba(159, 180, 190, 0.12)' },
        },
        yTemp: {
          position: 'left',
          ticks:    { color: '#9fb4be' },
          grid:     { color: 'rgba(159, 180, 190, 0.12)' },
        },
        yHr: {
          position: 'right',
          ticks:    { color: '#9fb4be' },
          grid:     { drawOnChartArea: false }, // Prevent double grid lines
        },
      },
    },
  });
}

// ---------------------------------------------------------------
// HELPERS
// ---------------------------------------------------------------

/**
 * Format an epoch timestamp (seconds or milliseconds) or ISO string
 * to a human-readable locale string. Returns '-' for falsy input.
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return '-';
  const numeric = Number(timestamp);
  if (Number.isFinite(numeric)) {
    // Distinguish seconds (< 1e12) from milliseconds
    const date = new Date(numeric < 1e12 ? numeric * 1000 : numeric);
    return date.toLocaleString();
  }
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? String(timestamp) : date.toLocaleString();
}

/**
 * Return a display string with the correct unit for a given metric key.
 * Returns '--' for non-finite values (sensor offline / missing data).
 */
function formatMetric(metric, value) {
  if (!Number.isFinite(value)) return '--';
  switch (metric) {
    case 'internal_temp':
    case 'external_temp': return `${value.toFixed(1)} °C`;
    case 'heart_rate':    return `${Math.round(value)} BPM`;
    case 'spo2':          return `${value.toFixed(1)} %`;
    case 'distance':      return `${value.toFixed(1)} cm`;
    default:              return String(value);
  }
}

/** Return true when the metric/value pair violates an alert rule. */
function evaluateAlert(metric, value) {
  const rule = ALERT_RULES[metric];
  return rule ? rule(value) : false;
}

// ---------------------------------------------------------------
// RENDERING
// ---------------------------------------------------------------

/** Re-render the sidebar device list, preserving the active selection. */
function renderDeviceList() {
  const entries = Object.entries(state.devices);
  dom.deviceCount.textContent = String(entries.length);
  dom.deviceList.innerHTML = '';

  if (!entries.length) {
    dom.deviceList.innerHTML =
      "<li class='device-item'><h3>No devices found</h3><p>Add devices in the /devices node</p></li>";
    return;
  }

  for (const [deviceId, device] of entries) {
    const item = document.createElement('li');
    item.className = `device-item${deviceId === state.selectedDeviceId ? ' active' : ''}`;
    // Escape user-provided strings to prevent XSS
    const safeName     = String(device.name     || deviceId).replace(/</g, '&lt;');
    const safeLocation = String(device.location || 'Unknown location').replace(/</g, '&lt;');
    item.innerHTML = `<h3>${safeName}</h3><p>${safeLocation}</p>`;
    item.addEventListener('click', () => selectDevice(deviceId));
    dom.deviceList.appendChild(item);
  }
}

/** Populate the device metadata header for the currently selected device. */
function renderDeviceDetails() {
  const device = state.devices[state.selectedDeviceId];

  if (!device) {
    dom.deviceName.textContent     = 'No device selected';
    dom.deviceLocation.textContent = '-';
    dom.deviceMac.textContent      = '-';
    dom.deviceFirmware.textContent = '-';
    dom.deviceLastSeen.textContent = '-';
    dom.deviceStatus.textContent   = 'Offline';
    dom.deviceStatus.className     = 'pill offline';
    return;
  }

  dom.deviceName.textContent     = device.name             || state.selectedDeviceId;
  dom.deviceLocation.textContent = device.location         || '-';
  dom.deviceMac.textContent      = device.mac_address      || '-';
  dom.deviceFirmware.textContent = device.firmware_version || '-';
  dom.deviceLastSeen.textContent = formatTimestamp(device.last_seen);

  const isOnline = String(device.status || '').toLowerCase() === 'online';
  dom.deviceStatus.textContent = isOnline ? 'Online' : 'Offline';
  dom.deviceStatus.className   = `pill ${isOnline ? 'online' : 'offline'}`;
}

/** Clear all sensor card values and remove any active alert styling. */
function resetCards() {
  dom.internalTempValue.textContent = '--';
  dom.externalTempValue.textContent = '--';
  dom.heartRateValue.textContent    = '--';
  dom.spo2Value.textContent         = '--';
  dom.distanceValue.textContent     = '--';
  document.querySelectorAll('.sensor-card').forEach((card) => card.classList.remove('alert'));
}

/**
 * Populate the sensor cards from a telemetry snapshot.
 * Cards with out-of-range values receive the .alert class, which
 * turns them red and shows the warning badge (see style.css).
 */
function renderSensorCards(telemetry) {
  const metrics = {
    internal_temp: Number(telemetry.internal_temp),
    external_temp: Number(telemetry.external_temp),
    heart_rate:    Number(telemetry.heart_rate),
    spo2:          Number(telemetry.spo2),
    distance:      Number(telemetry.distance),
  };

  dom.internalTempValue.textContent = formatMetric('internal_temp', metrics.internal_temp);
  dom.externalTempValue.textContent = formatMetric('external_temp', metrics.external_temp);
  dom.heartRateValue.textContent    = formatMetric('heart_rate',    metrics.heart_rate);
  dom.spo2Value.textContent         = formatMetric('spo2',          metrics.spo2);
  dom.distanceValue.textContent     = formatMetric('distance',      metrics.distance);

  document.querySelectorAll('.sensor-card').forEach((card) => {
    const metric = card.dataset.metric;
    card.classList.toggle('alert', evaluateAlert(metric, metrics[metric]));
  });
}

/**
 * Refresh the Chart.js line chart with the last 15 telemetry entries.
 * Accepts an array of [timestamp, payload] pairs (sorted ascending by time).
 */
function updateChart(telemetryEntries) {
  // Show only the most recent 15 readings per the dashboard spec
  const recent = telemetryEntries.slice(-15);

  state.chart.data.labels = recent.map(([timestamp]) => {
    const numeric = Number(timestamp);
    const date    = new Date(Number.isFinite(numeric) && numeric < 1e12 ? numeric * 1000 : numeric);
    return Number.isNaN(date.getTime()) ? String(timestamp) : date.toLocaleTimeString();
  });

  // Each dataset maps to one metric field in the telemetry payload
  state.chart.data.datasets[0].data = recent.map(([, p]) => Number(p.internal_temp) || null);
  state.chart.data.datasets[1].data = recent.map(([, p]) => Number(p.external_temp) || null);
  state.chart.data.datasets[2].data = recent.map(([, p]) => Number(p.heart_rate)    || null);

  state.chart.update();
}

// ---------------------------------------------------------------
// FIREBASE SUBSCRIPTIONS
// ---------------------------------------------------------------

/**
 * Attach a real-time onValue listener to telemetry/{deviceId}.
 * Always unsubscribes from the previous device first to prevent
 * stale listeners and memory leaks.
 */
function subscribeTelemetry(db, deviceId) {
  // Detach previous listener before attaching a new one
  if (state.telemetryUnsubscribe) {
    state.telemetryUnsubscribe();
    state.telemetryUnsubscribe = null;
  }

  const telemetryRef = ref(db, `telemetry/${deviceId}`);

  // onValue fires immediately with cached data, then on every update
  state.telemetryUnsubscribe = onValue(telemetryRef, (snapshot) => {
    const telemetryObj = snapshot.val() || {};

    // Convert the object keyed by epoch timestamp to a sorted array
    const entries = Object.entries(telemetryObj)
      .filter(([ts]) => Number.isFinite(Number(ts)))
      .sort((a, b) => Number(a[0]) - Number(b[0]));

    if (!entries.length) {
      resetCards();
      updateChart([]);
      return;
    }

    // The most recent entry (last after sort) powers the live sensor cards
    const [, latestTelemetry] = entries[entries.length - 1];
    renderSensorCards(latestTelemetry);
    updateChart(entries);
  });
}

/** Handle a device selection from the sidebar. */
function selectDevice(deviceId) {
  state.selectedDeviceId = deviceId;
  renderDeviceList();
  renderDeviceDetails();

  if (!deviceId) {
    resetCards();
    updateChart([]);
    return;
  }

  subscribeTelemetry(getDatabase(), deviceId);
}

/**
 * Bootstrap the dashboard after Firebase is initialised.
 * Attaches a real-time listener to the devices/ node; auto-selects
 * the first device that appears if none is currently selected.
 */
function startDashboard(db) {
  initChart();
  resetCards();

  const devicesRef = ref(db, 'devices');

  // This listener fires on load and on every change to any device record
  onValue(devicesRef, (snapshot) => {
    state.devices = snapshot.val() || {};
    const ids = Object.keys(state.devices);

    if (!ids.length) {
      state.selectedDeviceId = null;
      renderDeviceList();
      renderDeviceDetails();
      resetCards();
      updateChart([]);
      return;
    }

    // Keep the current selection when devices refresh, unless it no longer exists
    if (!state.selectedDeviceId || !state.devices[state.selectedDeviceId]) {
      state.selectedDeviceId = ids[0];
    }

    renderDeviceList();
    renderDeviceDetails();
    subscribeTelemetry(db, state.selectedDeviceId);
  });
}

/** Render a user-friendly warning in the sidebar when .env.local is not filled in. */
function showConfigWarning() {
  dom.deviceList.innerHTML =
    "<li class='device-item'><h3>Firebase not configured</h3><p>Fill in .env.local with your Firebase project credentials</p></li>";
  dom.deviceCount.textContent = '0';
  dom.deviceName.textContent  = 'Configuration Required';
}

// ---------------------------------------------------------------
// Bootstrap — runs immediately when the module is loaded
// ---------------------------------------------------------------
(function bootstrap() {
  if (!hasFirebaseConfig(firebaseConfig)) {
    // Show a helpful warning instead of throwing an SDK error
    initChart();
    resetCards();
    showConfigWarning();
    return;
  }

  const app = initializeApp(firebaseConfig);
  const db  = getDatabase(app);
  startDashboard(db);
}());
