// ===================================================================================
// --- HISTORY PAGE SCRIPT (Firestore historical data) ---
// ===================================================================================

console.log('=== History.js loading ===');
console.log('Firebase available?', typeof firebase !== 'undefined');

// Firebase Configuration (same as main page)
const firebaseConfig = {
  apiKey: "AIzaSyAj7CcqeWrUemoyvATYDrT9PpdiIbye_lQ",
  authDomain: "cattlehealthmonitoring-e1459.firebaseapp.com",
  databaseURL: "https://cattlehealthmonitoring-e1459-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "cattlehealthmonitoring-e1459",
  storageBucket: "cattlehealthmonitoring-e1459.firebasestorage.app",
  messagingSenderId: "1044738365075",
  appId: "1:1044738365075:web:e7dc0ee6f01ccfdbf05f66",
  measurementId: "G-YC1VF9N0YL"
};

console.log('Initializing Firebase with config:', firebaseConfig);

// Initialize Firebase
try {
  firebase.initializeApp(firebaseConfig);
  console.log('✅ Firebase initialized successfully');
} catch (error) {
  console.error('❌ Firebase initialization error:', error);
}

const firestore = firebase.firestore();
const database = firebase.database();

console.log('Firestore instance created:', firestore);
console.log('Database instance created:', database);

// DOM Elements
const tableBody = document.getElementById('history-table-body');
const chartCanvas = document.getElementById('history-chart');
const insightsContainer = document.getElementById('insights-container');

// Analytics DOM elements
const avgPulseEl = document.getElementById('avg-pulse');
const avgInternalEl = document.getElementById('avg-internal');
const avgExternalEl = document.getElementById('avg-external');
const maxPulseEl = document.getElementById('max-pulse');
const minPulseEl = document.getElementById('min-pulse');
const totalReadingsEl = document.getElementById('total-readings');

let historyChart = null;

// Helper: convert timestamp formats
function convertTimestamp(ts) {
    if (!ts) return new Date();
    if (typeof ts === 'object') {
        if (typeof ts.toDate === 'function') return ts.toDate();
        if (ts.seconds) return new Date(ts.seconds * 1000 + (ts.nanoseconds ? ts.nanoseconds / 1e6 : 0));
        if (ts._seconds) return new Date(ts._seconds * 1000 + (ts._nanoseconds ? ts._nanoseconds / 1e6 : 0));
    }
    if (typeof ts === 'number') return new Date(ts);
    if (typeof ts === 'string' && !isNaN(Number(ts))) return new Date(Number(ts));
    return new Date(ts);
}

// Fetch and display historical data from Firestore (with RTDB fallback)
async function loadHistoricalData() {
    console.log('=== Starting loadHistoricalData ===');
    console.log('Firestore instance:', firestore);
    console.log('Database instance:', database);

    const readingsRef = firestore.collection('historical_readings');
    console.log('Collection reference created:', readingsRef);
    
    const query = readingsRef.orderBy('timestamp', 'desc').limit(100);
    console.log('Query created for last 100 docs ordered by timestamp desc');

    try {
        console.log('Executing Firestore query...');
        const snapshot = await query.get();
        console.log('✅ Firestore query SUCCESS! Returned docs:', snapshot.size);
        console.log('Snapshot empty?', snapshot.empty);

        if (!snapshot.empty) {
            console.log('📊 Processing', snapshot.size, 'Firestore documents...');
            const entries = [];
            snapshot.forEach((doc, index) => {
                const data = doc.data();
                console.log(`Doc ${index + 1}:`, {
                    id: doc.id,
                    timestamp: data.timestamp,
                    pulseRaw: data.pulseRaw,
                    internalTemperature: data.internalTemperature,
                    externalTemperature: data.externalTemperature
                });
                
                entries.push({
                    timestamp: convertTimestamp(data.timestamp),
                    pulseRaw: data.pulseRaw,
                    internalTemperature: data.internalTemperature,
                    externalTemperature: data.externalTemperature
                });
            });

            console.log('✅ Successfully processed', entries.length, 'entries');
            
            // Reverse to get oldest -> newest for chart
            entries.reverse();
            console.log('Calculating analytics...');
            calculateAnalytics(entries);
            console.log('Generating insights...');
            generateInsights(entries);
            console.log('Populating table...');
            populateTable(entries);
            console.log('Populating chart...');
            populateChart(entries);
            console.log('✅ All data rendering complete!');
            return;
        }

        // Fallback to RTDB
        console.log('⚠️ Firestore snapshot is EMPTY. No documents found in historical_readings collection.');
        console.log('Trying Realtime Database fallback...');
        const rtdbEntries = await fetchFromRTDB();
        if (rtdbEntries && rtdbEntries.length) {
            rtdbEntries.reverse(); // most recent first -> oldest first
            calculateAnalytics(rtdbEntries);
            generateInsights(rtdbEntries);
            populateTable(rtdbEntries);
            populateChart(rtdbEntries);
            return;
        }

        // No data found
        tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center;">No historical data found.</td></tr>';
        insightsContainer.innerHTML = '<p class="loading-message">No data available for analysis.</p>';

    } catch (error) {
        console.error('❌ ERROR loading historical data from Firestore:', error);
        console.error('Error code:', error.code);
        console.error('Error message:', error.message);
        
        if (error.code === 'permission-denied') {
            console.error('🚫 PERMISSION DENIED - Firestore security rules are blocking reads');
            tableBody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: red;"><strong>Permission Denied:</strong> Firestore security rules are blocking data access. Please update your Firestore rules to allow reads.</td></tr>';
            insightsContainer.innerHTML = '<div class="insight-item danger"><i class="fa-solid fa-lock"></i> <strong>Permission Denied:</strong> Cannot read from Firestore. Update security rules in Firebase Console.</div>';
        } else {
            tableBody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: red;">Error loading data: ${error.message}</td></tr>`;
        }
        
        // Try RTDB fallback
        console.log('Attempting RTDB fallback...');
        try {
            const rtdbEntries = await fetchFromRTDB();
            console.log('RTDB fallback returned:', rtdbEntries.length, 'entries');
            if (rtdbEntries && rtdbEntries.length) {
                rtdbEntries.reverse();
                calculateAnalytics(rtdbEntries);
                generateInsights(rtdbEntries);
                populateTable(rtdbEntries);
                populateChart(rtdbEntries);
            }
        } catch (err) {
            console.error('❌ RTDB fallback error:', err);
        }
    }
}

// Fetch from RTDB
async function fetchFromRTDB() {
    try {
        const snapshot = await database.ref('/cattle/cow_1/history').orderByChild('timestamp').limitToLast(100).once('value');
        const val = snapshot.val();
        if (!val) return [];

        const arr = Object.values(val)
            .sort((a, b) => {
                const ta = (a && a.timestamp) ? (typeof a.timestamp === 'number' ? a.timestamp : (a.timestamp.seconds ? a.timestamp.seconds * 1000 : 0)) : 0;
                const tb = (b && b.timestamp) ? (typeof b.timestamp === 'number' ? b.timestamp : (b.timestamp.seconds ? b.timestamp.seconds * 1000 : 0)) : 0;
                return tb - ta; // most recent first
            })
            .map(d => ({
                timestamp: convertTimestamp(d.timestamp),
                pulseRaw: d.pulseRaw,
                internalTemperature: d.internalTemperature,
                externalTemperature: d.externalTemperature
            }));

        return arr;
    } catch (err) {
        console.error('RTDB fetch error:', err);
        return [];
    }
}

// Populate table with entries (oldest -> newest)
function populateTable(entries) {
    tableBody.innerHTML = '';
    
    // Reverse for table display (most recent first)
    const reversed = [...entries].reverse();
    
    reversed.forEach((entry, index) => {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${index + 1}</td>
            <td>${entry.timestamp.toLocaleDateString()}</td>
            <td>${entry.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</td>
            <td>${entry.pulseRaw ?? '-'}</td>
            <td>${typeof entry.internalTemperature === 'number' ? entry.internalTemperature.toFixed(1) : (entry.internalTemperature ?? '-')}</td>
            <td>${typeof entry.externalTemperature === 'number' ? entry.externalTemperature.toFixed(1) : (entry.externalTemperature ?? '-')}</td>
        `;
        tableBody.appendChild(row);
    });
}

// Populate chart with entries (oldest -> newest)
function populateChart(entries) {
    if (!chartCanvas || typeof Chart === 'undefined') {
        console.warn('Chart.js not available or canvas not found');
        return;
    }

    const labels = entries.map(e => e.timestamp.toLocaleString([], { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
    }));
    const pulseData = entries.map(e => (typeof e.pulseRaw === 'number' ? e.pulseRaw : Number(e.pulseRaw) || null));
    const internalData = entries.map(e => (typeof e.internalTemperature === 'number' ? e.internalTemperature : Number(e.internalTemperature) || null));
    const externalData = entries.map(e => (typeof e.externalTemperature === 'number' ? e.externalTemperature : Number(e.externalTemperature) || null));

    const commonOptions = {
        tension: 0.3,
        spanGaps: true,
        borderWidth: 2,
    };

    if (!historyChart) {
        historyChart = new Chart(chartCanvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [
                    { 
                        label: 'Pulse', 
                        data: pulseData, 
                        borderColor: '#007bff', 
                        backgroundColor: 'rgba(0,123,255,0.08)', 
                        yAxisID: 'y',
                        ...commonOptions
                    },
                    { 
                        label: 'Internal Temp (°C)', 
                        data: internalData, 
                        borderColor: '#28a745', 
                        backgroundColor: 'rgba(40,167,69,0.06)', 
                        yAxisID: 'y1',
                        ...commonOptions
                    },
                    { 
                        label: 'External Temp (°C)', 
                        data: externalData, 
                        borderColor: '#ffc107', 
                        backgroundColor: 'rgba(255,193,7,0.06)', 
                        yAxisID: 'y1',
                        ...commonOptions
                    },
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                    },
                    title: {
                        display: false,
                    }
                },
                scales: {
                    y: { 
                        type: 'linear', 
                        display: true, 
                        position: 'left',
                        title: { display: true, text: 'Pulse' }
                    },
                    y1: { 
                        type: 'linear', 
                        display: true, 
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        title: { display: true, text: 'Temperature (°C)' }
                    }
                }
            }
        });
    } else {
        historyChart.data.labels = labels;
        historyChart.data.datasets[0].data = pulseData;
        historyChart.data.datasets[1].data = internalData;
        historyChart.data.datasets[2].data = externalData;
        historyChart.update();
    }
}

// Calculate analytics from entries
function calculateAnalytics(entries) {
    if (!entries || !entries.length) return;

    const pulseValues = entries.map(e => Number(e.pulseRaw) || 0).filter(v => v > 0);
    const internalTempValues = entries.map(e => Number(e.internalTemperature) || 0).filter(v => v > 0);
    const externalTempValues = entries.map(e => Number(e.externalTemperature) || 0).filter(v => v > 0);

    // Calculate averages
    const avgPulse = pulseValues.length ? (pulseValues.reduce((a, b) => a + b, 0) / pulseValues.length).toFixed(0) : '--';
    const avgInternal = internalTempValues.length ? (internalTempValues.reduce((a, b) => a + b, 0) / internalTempValues.length).toFixed(1) : '--';
    const avgExternal = externalTempValues.length ? (externalTempValues.reduce((a, b) => a + b, 0) / externalTempValues.length).toFixed(1) : '--';

    // Calculate min/max
    const maxPulse = pulseValues.length ? Math.max(...pulseValues).toFixed(0) : '--';
    const minPulse = pulseValues.length ? Math.min(...pulseValues).toFixed(0) : '--';

    // Update DOM
    if (avgPulseEl) avgPulseEl.textContent = avgPulse;
    if (avgInternalEl) avgInternalEl.textContent = avgInternal + ' °C';
    if (avgExternalEl) avgExternalEl.textContent = avgExternal + ' °C';
    if (maxPulseEl) maxPulseEl.textContent = maxPulse;
    if (minPulseEl) minPulseEl.textContent = minPulse;
    if (totalReadingsEl) totalReadingsEl.textContent = entries.length;

    console.log('Analytics calculated:', { avgPulse, avgInternal, avgExternal, maxPulse, minPulse, total: entries.length });
}

// Generate health insights based on data patterns
function generateInsights(entries) {
    if (!entries || !entries.length || !insightsContainer) return;

    const insights = [];
    
    const pulseValues = entries.map(e => Number(e.pulseRaw) || 0).filter(v => v > 0);
    const internalTempValues = entries.map(e => Number(e.internalTemperature) || 0).filter(v => v > 0);
    const externalTempValues = entries.map(e => Number(e.externalTemperature) || 0).filter(v => v > 0);

    if (pulseValues.length === 0) {
        insightsContainer.innerHTML = '<p class="loading-message">Insufficient data for analysis.</p>';
        return;
    }

    // Calculate statistics
    const avgPulse = pulseValues.reduce((a, b) => a + b, 0) / pulseValues.length;
    const avgInternal = internalTempValues.reduce((a, b) => a + b, 0) / internalTempValues.length;
    const avgExternal = externalTempValues.reduce((a, b) => a + b, 0) / externalTempValues.length;
    const maxPulse = Math.max(...pulseValues);
    const minPulse = Math.min(...pulseValues);
    
    // Calculate standard deviation for pulse
    const pulseStdDev = Math.sqrt(pulseValues.map(v => Math.pow(v - avgPulse, 2)).reduce((a, b) => a + b, 0) / pulseValues.length);

    // Insight 1: Overall health status
    if (avgPulse >= 60 && avgPulse <= 80 && avgInternal >= 38 && avgInternal <= 39.5) {
        insights.push({
            type: 'success',
            icon: 'fa-check-circle',
            message: `Vital signs are within normal range. Average pulse: ${avgPulse.toFixed(0)} BPM, Average internal temp: ${avgInternal.toFixed(1)}°C`
        });
    } else if (avgPulse > 80 || avgInternal > 39.5) {
        insights.push({
            type: 'warning',
            icon: 'fa-exclamation-triangle',
            message: `Elevated vital signs detected. Average pulse: ${avgPulse.toFixed(0)} BPM, Average internal temp: ${avgInternal.toFixed(1)}°C. Monitor closely.`
        });
    } else if (avgPulse < 60 || avgInternal < 38) {
        insights.push({
            type: 'warning',
            icon: 'fa-exclamation-triangle',
            message: `Low vital signs detected. Average pulse: ${avgPulse.toFixed(0)} BPM, Average internal temp: ${avgInternal.toFixed(1)}°C. Consider veterinary consultation.`
        });
    }

    // Insight 2: Pulse variability
    if (pulseStdDev > 15) {
        insights.push({
            type: 'warning',
            icon: 'fa-heartbeat',
            message: `High pulse variability detected (std dev: ${pulseStdDev.toFixed(1)}). This may indicate stress or irregular activity patterns.`
        });
    } else {
        insights.push({
            type: 'success',
            icon: 'fa-heartbeat',
            message: `Pulse variability is stable (std dev: ${pulseStdDev.toFixed(1)}), indicating consistent health patterns.`
        });
    }

    // Insight 3: Temperature difference (internal vs external)
    const tempDiff = avgInternal - avgExternal;
    if (tempDiff < 10) {
        insights.push({
            type: 'warning',
            icon: 'fa-temperature-arrow-down',
            message: `Small temperature differential (${tempDiff.toFixed(1)}°C). Animal may be experiencing heat stress or environmental exposure.`
        });
    } else if (tempDiff > 15) {
        insights.push({
            type: 'success',
            icon: 'fa-temperature-half',
            message: `Healthy temperature differential (${tempDiff.toFixed(1)}°C). Good thermoregulation observed.`
        });
    }

    // Insight 4: Trend analysis (last 20% vs first 20%)
    const firstQuintile = pulseValues.slice(0, Math.floor(pulseValues.length * 0.2));
    const lastQuintile = pulseValues.slice(-Math.floor(pulseValues.length * 0.2));
    
    if (firstQuintile.length > 0 && lastQuintile.length > 0) {
        const firstAvg = firstQuintile.reduce((a, b) => a + b, 0) / firstQuintile.length;
        const lastAvg = lastQuintile.reduce((a, b) => a + b, 0) / lastQuintile.length;
        const trendChange = ((lastAvg - firstAvg) / firstAvg) * 100;
        
        if (Math.abs(trendChange) > 10) {
            const direction = trendChange > 0 ? 'increase' : 'decrease';
            insights.push({
                type: trendChange > 0 ? 'warning' : 'success',
                icon: trendChange > 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down',
                message: `Pulse trend shows ${Math.abs(trendChange).toFixed(1)}% ${direction} over the recorded period. ${trendChange > 0 ? 'Monitor for signs of stress or illness.' : 'Animal appears to be calming or recovering.'}`
            });
        } else {
            insights.push({
                type: 'success',
                icon: 'fa-chart-line',
                message: `Pulse remains stable over time (${Math.abs(trendChange).toFixed(1)}% change), indicating consistent health.`
            });
        }
    }

    // Insight 5: Data collection frequency
    const timeSpan = entries[entries.length - 1].timestamp - entries[0].timestamp;
    const hoursSpan = timeSpan / (1000 * 60 * 60);
    const readingsPerHour = entries.length / hoursSpan;
    
    if (readingsPerHour < 1) {
        insights.push({
            type: 'warning',
            icon: 'fa-clock',
            message: `Low data collection frequency detected (${readingsPerHour.toFixed(1)} readings/hour). Consider more frequent monitoring for better insights.`
        });
    }

    // Render insights
    if (insights.length > 0) {
        insightsContainer.innerHTML = insights.map(insight => `
            <div class="insight-item ${insight.type}">
                <i class="fa-solid ${insight.icon}"></i>
                ${insight.message}
            </div>
        `).join('');
    } else {
        insightsContainer.innerHTML = '<p class="loading-message">No significant insights detected. Data appears normal.</p>';
    }

    console.log('Generated', insights.length, 'insights');
}

// Load data on page load
loadHistoricalData();

// Refresh every 2 minutes
setInterval(loadHistoricalData, 120000);
