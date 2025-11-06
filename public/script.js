
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

