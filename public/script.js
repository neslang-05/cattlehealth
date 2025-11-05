// ===================================================================================
// --- 1. FIREBASE CONFIGURATION ---
// ===================================================================================
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

// ===================================================================================
// --- 2. INITIALIZATION ---
// ===================================================================================
firebase.initializeApp(firebaseConfig);
const database = firebase.database();
const firestore = firebase.firestore();

// DOM Elements
const pulseElement = document.getElementById('live-pulse');
const internalTempElement = document.getElementById('live-internal-temp');
const externalTempElement = document.getElementById('live-external-temp');
const lastUpdateElement = document.getElementById('last-update');
const connectionStatusElement = document.getElementById('connection-status');
const realtimePlotDiv = document.getElementById('realtime-plot');

// Real-time data buffers (keep last 50 readings for visualization)
const MAX_POINTS = 50;
const dataBuffer = {
    timestamps: [],
    pulse: [],
    internalTemp: [],
    externalTemp: []
};

console.log('Dashboard script loaded');
if (typeof Plotly === 'undefined') {
    console.error('Plotly is not loaded');
}

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

// ===================================================================================
// --- 3. REAL-TIME DATA LISTENER (For Live Cards & Plotly Visualization) ---
// ===================================================================================
const latestReadingRef = database.ref('/cattle/cow_1/latest_reading');

latestReadingRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        connectionStatusElement.className = 'status--connected';
        connectionStatusElement.innerHTML = '<i class="fa-solid fa-circle"></i> Connected';
        
        // Update live cards
        pulseElement.textContent = `${data.pulseRaw}`;
        internalTempElement.textContent = `${data.internalTemperature.toFixed(1)} °C`;
        externalTempElement.textContent = `${data.externalTemperature.toFixed(1)} °C`;
        
        const updateTime = new Date(data.timestamp);
        lastUpdateElement.textContent = updateTime.toLocaleTimeString();

        // Add to data buffer for real-time plot
        addDataPoint(updateTime, data.pulseRaw, data.internalTemperature, data.externalTemperature);
        updateRealtimePlot();
    } else {
        connectionStatusElement.className = 'status--disconnected';
        connectionStatusElement.innerHTML = '<i class="fa-solid fa-circle"></i> No Data';
    }
});

// ===================================================================================
// --- 4. REAL-TIME PLOTLY VISUALIZATION ---
// ===================================================================================
function addDataPoint(timestamp, pulse, internalTemp, externalTemp) {
    dataBuffer.timestamps.push(timestamp);
    dataBuffer.pulse.push(pulse);
    dataBuffer.internalTemp.push(internalTemp);
    dataBuffer.externalTemp.push(externalTemp);

    // Keep only the last MAX_POINTS
    if (dataBuffer.timestamps.length > MAX_POINTS) {
        dataBuffer.timestamps.shift();
        dataBuffer.pulse.shift();
        dataBuffer.internalTemp.shift();
        dataBuffer.externalTemp.shift();
    }
}

function updateRealtimePlot() {
    if (!realtimePlotDiv || typeof Plotly === 'undefined') return;

    const trace1 = {
        x: dataBuffer.timestamps,
        y: dataBuffer.pulse,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Pulse',
        line: { color: '#007bff', width: 2 },
        marker: { size: 5 },
        yaxis: 'y1'
    };

    const trace2 = {
        x: dataBuffer.timestamps,
        y: dataBuffer.internalTemp,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'Internal Temp (°C)',
        line: { color: '#28a745', width: 2 },
        marker: { size: 5 },
        yaxis: 'y2'
    };

    const trace3 = {
        x: dataBuffer.timestamps,
        y: dataBuffer.externalTemp,
        type: 'scatter',
        mode: 'lines+markers',
        name: 'External Temp (°C)',
        line: { color: '#ffc107', width: 2 },
        marker: { size: 5 },
        yaxis: 'y2'
    };

    const layout = {
        title: {
            text: 'Live Data Stream (Last 50 readings)',
            font: { size: 16, color: '#495057' }
        },
        xaxis: {
            title: 'Time',
            type: 'date',
            showgrid: true,
            gridcolor: '#e9ecef'
        },
        yaxis: {
            title: 'Pulse',
            titlefont: { color: '#007bff' },
            tickfont: { color: '#007bff' },
            side: 'left'
        },
        yaxis2: {
            title: 'Temperature (°C)',
            titlefont: { color: '#28a745' },
            tickfont: { color: '#28a745' },
            overlaying: 'y',
            side: 'right'
        },
        legend: {
            x: 0,
            y: 1.1,
            orientation: 'h'
        },
        margin: { l: 60, r: 60, t: 80, b: 60 },
        hovermode: 'x unified',
        plot_bgcolor: '#f8f9fa',
        paper_bgcolor: '#ffffff'
    };

    const config = {
        responsive: true,
        displayModeBar: true,
        displaylogo: false,
        modeBarButtonsToRemove: ['lasso2d', 'select2d']
    };

    // Use Plotly.react for efficient updates
    Plotly.react(realtimePlotDiv, [trace1, trace2, trace3], layout, config);
}

// Initialize plot with empty data
function initializePlot() {
    if (!realtimePlotDiv || typeof Plotly === 'undefined') {
        console.warn('Plotly or plot div not available');
        return;
    }

    const emptyLayout = {
        title: {
            text: 'Live Data Stream (Waiting for data...)',
            font: { size: 16, color: '#495057' }
        },
        xaxis: { title: 'Time' },
        yaxis: { title: 'Pulse', side: 'left' },
        yaxis2: { title: 'Temperature (°C)', overlaying: 'y', side: 'right' },
        margin: { l: 60, r: 60, t: 80, b: 60 },
        plot_bgcolor: '#f8f9fa',
        paper_bgcolor: '#ffffff'
    };

    Plotly.newPlot(realtimePlotDiv, [], emptyLayout, { responsive: true, displaylogo: false });
}

// ===================================================================================
// --- 5. FIRESTORE REAL-TIME DATA FETCHING ---
// ===================================================================================
async function fetchRecentFirestoreData() {
    console.log('Fetching recent data from Firestore for real-time chart...');
    
    try {
        const readingsRef = firestore.collection('historical_readings');
        const query = readingsRef.orderBy('timestamp', 'desc').limit(MAX_POINTS);
        const snapshot = await query.get();
        
        console.log('Firestore returned', snapshot.size, 'recent readings');
        
        if (!snapshot.empty) {
            // Clear existing buffer
            dataBuffer.timestamps = [];
            dataBuffer.pulse = [];
            dataBuffer.internalTemp = [];
            dataBuffer.externalTemp = [];
            
            // Collect entries (newest first from query)
            const entries = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                entries.push({
                    timestamp: convertTimestamp(data.timestamp),
                    pulseRaw: data.pulseRaw,
                    internalTemperature: data.internalTemperature,
                    externalTemperature: data.externalTemperature
                });
            });
            
            // Reverse to get oldest -> newest for chart
            entries.reverse();
            
            // Populate buffer
            entries.forEach(entry => {
                dataBuffer.timestamps.push(entry.timestamp);
                dataBuffer.pulse.push(entry.pulseRaw);
                dataBuffer.internalTemp.push(entry.internalTemperature);
                dataBuffer.externalTemp.push(entry.externalTemperature);
            });
            
            // Update the plot
            updateRealtimePlot();
            
            // Update live cards with most recent reading
            const latest = entries[entries.length - 1];
            if (latest) {
                pulseElement.textContent = `${latest.pulseRaw}`;
                internalTempElement.textContent = `${latest.internalTemperature.toFixed(1)} °C`;
                externalTempElement.textContent = `${latest.externalTemperature.toFixed(1)} °C`;
                lastUpdateElement.textContent = latest.timestamp.toLocaleTimeString();
                connectionStatusElement.className = 'status--connected';
                connectionStatusElement.innerHTML = '<i class="fa-solid fa-circle"></i> Connected';
            }
        } else {
            console.warn('No data found in Firestore historical_readings collection');
        }
    } catch (error) {
        console.error('Error fetching Firestore data:', error);
    }
}

// Listen for new documents in Firestore (real-time listener)
function setupFirestoreListener() {
    const readingsRef = firestore.collection('historical_readings');
    const query = readingsRef.orderBy('timestamp', 'desc').limit(1);
    
    query.onSnapshot((snapshot) => {
        snapshot.docChanges().forEach((change) => {
            if (change.type === 'added') {
                const data = change.doc.data();
                const timestamp = convertTimestamp(data.timestamp);
                
                console.log('New Firestore reading detected:', data);
                
                // Add to buffer
                addDataPoint(timestamp, data.pulseRaw, data.internalTemperature, data.externalTemperature);
                updateRealtimePlot();
                
                // Update live cards
                pulseElement.textContent = `${data.pulseRaw}`;
                internalTempElement.textContent = `${data.internalTemperature.toFixed(1)} °C`;
                externalTempElement.textContent = `${data.externalTemperature.toFixed(1)} °C`;
                lastUpdateElement.textContent = timestamp.toLocaleTimeString();
                connectionStatusElement.className = 'status--connected';
                connectionStatusElement.innerHTML = '<i class="fa-solid fa-circle"></i> Connected';
            }
        });
    }, (error) => {
        console.error('Firestore listener error:', error);
    });
}

// ===================================================================================
// --- 6. EXECUTION ---
// ===================================================================================
initializePlot();

// Initial load from Firestore
fetchRecentFirestoreData();

// Setup real-time listener for new Firestore documents
setupFirestoreListener();

// Fallback: Keep RTDB listener for immediate updates if still being used
// (This ensures live cards update even if Firestore writes are delayed)
latestReadingRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        // Only update if Firestore hasn't provided data recently
        if (dataBuffer.timestamps.length === 0) {
            const updateTime = new Date(data.timestamp);
            pulseElement.textContent = `${data.pulseRaw}`;
            internalTempElement.textContent = `${data.internalTemperature.toFixed(1)} °C`;
            externalTempElement.textContent = `${data.externalTemperature.toFixed(1)} °C`;
            lastUpdateElement.textContent = updateTime.toLocaleTimeString();
            connectionStatusElement.className = 'status--connected';
            connectionStatusElement.innerHTML = '<i class="fa-solid fa-circle"></i> Connected (RTDB)';
        }
    }
});

console.log('Real-time dashboard initialized. Fetching from Firestore and listening for updates...');

