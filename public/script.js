
/*
=====================================================
Firebase Configuration
=====================================================
Replace the values below with your firebase project
credentials taken from Firebase console.
*/


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


/*
=====================================================
Initialize Firebase
=====================================================
*/

firebase.initializeApp(firebaseConfig);

const db = firebase.database();



/*
=====================================================
Reference to the ESP32 latest reading path
=====================================================
*/

const dataRef = db.ref("/cattle/cow_1/latest_reading");



/*
=====================================================
DOM Elements
=====================================================
*/

const pulseElement = document.getElementById("pulse");

const internalTempElement = document.getElementById("internalTemp");

const externalTempElement = document.getElementById("externalTemp");

const distanceElement = document.getElementById("distance");

const timestampElement = document.getElementById("timestamp");



/*
=====================================================
Realtime Firebase Listener
=====================================================
This listener triggers every time ESP32 pushes
new data to Firebase.
*/

dataRef.on("value", (snapshot) => {

const data = snapshot.val();

if (!data) return;



/*
=====================================================
Update dashboard values
=====================================================
*/

pulseElement.textContent = data.pulseBPM;

internalTempElement.textContent = data.internalTemperature;

externalTempElement.textContent = data.externalTemperature;

distanceElement.textContent = data.distanceCM;



/*
=====================================================
Convert timestamp to readable date
=====================================================
*/

if(data.timestamp){

const date = new Date(data.timestamp);

timestampElement.textContent = date.toLocaleString();

}

});