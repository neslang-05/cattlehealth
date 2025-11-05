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
const chartCanvas = document.getElementById('health-chart');

// Chart Variable
let healthChart = null;

// ===================================================================================
// --- 3. REAL-TIME DATA LISTENER (For Live Cards - Unchanged) ---
// ===================================================================================
const latestReadingRef = database.ref('/cattle/cow_1/latest_reading');

latestReadingRef.on('value', (snapshot) => {
    const data = snapshot.val();
    if (data) {
        connectionStatusElement.className = 'status--connected';
        connectionStatusElement.innerHTML = '<i class="fa-solid fa-circle"></i> Connected';
        
        pulseElement.textContent = `${data.pulseRaw}`;
        internalTempElement.textContent = `${data.internalTemperature.toFixed(1)} °C`;
        externalTempElement.textContent = `${data.externalTemperature.toFixed(1)} °C`;
        
        const updateTime = new Date(data.timestamp);
        lastUpdateElement.textContent = updateTime.toLocaleTimeString();
    } else {
        connectionStatusElement.className = 'status--disconnected';
        connectionStatusElement.innerHTML = '<i class="fa-solid fa-circle"></i> No Data';
    }
});

// ===================================================================================
// --- 4. NEW: CHART.JS VISUALIZATION ---
// ===================================================================================

// Function to initialize and update the chart
function initializeChart(historicalData) {
    if (!chartCanvas) return;

    const labels = historicalData.map(d => new Date(d.timestamp).toLocaleTimeString());
    const pulseData = historicalData.map(d => d.pulseRaw);
    const internalTempData = historicalData.map(d => d.internalTemperature);
    const externalTempData = historicalData.map(d => d.externalTemperature);

    const chartData = {
        labels: labels,
        datasets: [
            {
                label: 'Pulse',
                data: pulseData,
                borderColor: '#007bff',
                backgroundColor: 'rgba(0, 123, 255, 0.1)',
                yAxisID: 'yPulse',
                tension: 0.3
            },
            {
                label: 'Internal Temp (°C)',
                data: internalTempData,
                borderColor: '#28a745',
                backgroundColor: 'rgba(40, 167, 69, 0.1)',
                yAxisID: 'yTemp',
                tension: 0.3
            },
            {
                label: 'External Temp (°C)',
                data: externalTempData,
                borderColor: '#ffc107',
                backgroundColor: 'rgba(255, 193, 7, 0.1)',
                yAxisID: 'yTemp',
                tension: 0.3
            }
        ]
    };

    if (healthChart) {
        // If chart exists, update data and re-render
        healthChart.data = chartData;
        healthChart.update();
    } else {
        // If chart doesn't exist, create it
        healthChart = new Chart(chartCanvas, {
            type: 'line',
            data: chartData,
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                scales: {
                    x: {
                        title: {
                            display: true,
                            text: 'Time'
                        }
                    },
                    yPulse: {
                        type: 'linear',
                        position: 'left',
                        title: {
                            display: true,
                            text: 'Pulse (BPM)'
                        }
                    },
                    yTemp: {
                        type: 'linear',
                        position: 'right',
                        title: {
                            display: true,
                            text: 'Temperature (°C)'
                        },
                        grid: {
                            drawOnChartArea: false // only draw grid for first Y axis
                        }
                    }
                }
            }
        });
    }
}

// Function to fetch historical data for the chart
async function fetchHistoryForChart() {
    console.log("Fetching historical data for chart...");
    const readingsRef = firestore.collection('historical_readings');
    const query = readingsRef.orderBy('timestamp', 'desc').limit(20); // Get last 20 readings

    try {
        const snapshot = await query.get();
        if (snapshot.empty) {
            console.log("No historical data found for chart.");
            return;
        }

        const historicalData = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            historicalData.push({
                timestamp: data.timestamp.toDate(),
                pulseRaw: data.pulseRaw,
                internalTemperature: data.internalTemperature,
                externalTemperature: data.externalTemperature
            });
        });

        // Data is fetched desc, reverse to show oldest to newest on chart
        initializeChart(historicalData.reverse());

    } catch (error) {
        console.error("Error fetching historical data for chart:", error);
    }
}

// ===================================================================================
// --- 5. EXECUTION ---
// ===================================================================================
// Initial chart load when the page opens
fetchHistoryForChart();

// Refresh the chart every 60 seconds (60000 milliseconds)
setInterval(fetchHistoryForChart, 60000);