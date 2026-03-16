/*
=====================================================
DOM Element Selection
=====================================================
*/
const pulseElement = document.getElementById("pulse");
const internalTempElement = document.getElementById("internalTemp");
const externalTempElement = document.getElementById("externalTemp");
const distanceElement = document.getElementById("distance");
const timestampElement = document.getElementById("timestamp-val");

const pulseBadge = document.getElementById("pulse-badge");
const internalBadge = document.getElementById("internal-badge");
const externalBadge = document.getElementById("external-badge");
const distanceBadge = document.getElementById("distance-badge");

/*
=====================================================
Firebase Configuration
=====================================================
*/
const firebaseConfig = {
  databaseURL: "https://cattlehealthmonitoring-e1459-default-rtdb.asia-southeast1.firebasedatabase.app"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const dataRef = db.ref("/cattle/cow_1/latest_reading");

/*
=====================================================
Realtime Data Listener
=====================================================
*/
dataRef.on("value", (snapshot) => {
  const data = snapshot.val();
  
  if (!data) return;

  // Update Numeric Values
  pulseElement.textContent = data.pulseBPM ?? "0";
  internalTempElement.textContent = data.internalTemperature != null ? data.internalTemperature.toFixed(2) : "--";
  externalTempElement.textContent = data.externalTemperature != null ? data.externalTemperature.toFixed(2) : "--";
  distanceElement.textContent = data.distanceCM != null ? Math.round(data.distanceCM) : "--";

  // Update Status Badges (User-requested mapping logic)
  
  // Pulse Rate
  if (data.pulseBPM === 0 || !data.pulseBPM) {
    updateBadge(pulseBadge, "No signal", "status-alert");
  } else {
    updateBadge(pulseBadge, "Pulse active", "status-ok");
  }

  // Internal Temperature (Cattle normal: 38.3 - 39.4 °C)
  if (data.internalTemperature < 38.3) {
    updateBadge(internalBadge, "Below normal", "status-warn");
  } else if (data.internalTemperature > 39.4) {
    updateBadge(internalBadge, "Above normal", "status-alert");
  } else {
    updateBadge(internalBadge, "Normal", "status-ok");
  }

  // External Temperature
  updateBadge(externalBadge, "Normal", "status-ok");

  // Distance
  updateBadge(distanceBadge, "Sensor active", "status-neutral");

  // Update Timestamp
  if (data.timestamp) {
    const date = new Date(data.timestamp);
    timestampElement.textContent = date.toLocaleTimeString('en-GB', { 
      hour12: false, 
      hour: '2-digit', 
      minute: '2-digit', 
      second: '2-digit' 
    });
  }

}, (error) => {
  console.error("Firebase Error:", error.code);
  timestampElement.textContent = "Offline";
});

/**
 * Utility to update badge text and theme
 */
function updateBadge(badge, text, statusClass) {
  if (!badge) return;
  badge.textContent = text;
  badge.className = "status-badge " + statusClass;
}
