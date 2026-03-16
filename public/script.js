/*
=====================================================
DOM Element Selection
=====================================================
*/
const pulseElement = document.getElementById("pulse");
const internalTempElement = document.getElementById("internalTemp");
const externalTempElement = document.getElementById("externalTemp");
const distanceElement = document.getElementById("distance");
const timestampElement = document.getElementById("timestamp");

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
console.log("Monitoring Cattle Health at:", dataRef.toString());

dataRef.on("value", (snapshot) => {
  const data = snapshot.val();
  
  if (!data) {
    console.warn("Waiting for data...");
    timestampElement.textContent = "Waiting for data...";
    return;
  }

  // Update values with fallbacks
  pulseElement.textContent = data.pulseBPM ?? "0";
  internalTempElement.textContent = data.internalTemperature ?? "0.00";
  externalTempElement.textContent = data.externalTemperature ?? "0.00";
  distanceElement.textContent = data.distanceCM ? Math.round(data.distanceCM) : "0";

  // Dynamic Status/Color effects
  updateStatusColor(pulseElement, data.pulseBPM, 60, 100);
  updateStatusColor(internalTempElement, data.internalTemperature, 37, 39);

  // Update Timestamp
  if (data.timestamp) {
    const date = new Date(data.timestamp);
    timestampElement.textContent = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

}, (error) => {
  console.error("Firebase Error:", error.code);
  timestampElement.textContent = "Connection Error";
});

/**
 * Utility to update text color based on thresholds
 */
function updateStatusColor(element, value, min, max) {
  if (value === undefined || value === null) return;
  
  if (value < min || value > max) {
    element.style.color = "var(--accent-danger)";
    element.style.textShadow = "0 0 15px rgba(239, 68, 68, 0.4)";
  } else {
    element.style.color = "#fff";
    element.style.textShadow = "none";
  }
}
