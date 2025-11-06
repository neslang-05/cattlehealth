/**
 * ===================================================================================
 * FINAL STABLE VERSION: ESP8266 Health Monitor Sketch 
 * ===================================================================================
 * Authur : Nilambar Elangbamb
 * Github : neslang-05
 * Email  : neslang.in@gmail.com
 * ===================================================================================
 */

#include <ESP8266WiFi.h>
#include <Firebase_ESP_Client.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include "addons/TokenHelper.h" 

// --- Configuration ---
#define WIFI_SSID "RedmiSarat"
#define WIFI_PASSWORD "reni1234"
#define API_KEY "AIzaSyAj7CcqeWrUemoyvATYDrT9PpdiIbye_lQ"
#define FIREBASE_PROJECT_ID "cattlehealthmonitoring-e1459"
#define DATABASE_URL "cattlehealthmonitoring-e1459-default-rtdb.asia-southeast1.firebasedatabase.app"
#define USER_EMAIL "neslang.in@gmail.com"
#define USER_PASSWORD "123456"

#define INTERNAL_TEMP_PIN 4 
#define EXTERNAL_TEMP_PIN 2
#define PULSE_SENSOR_PIN A0

// CONSTANT PATHS 
const char* RTDB_LATEST_PATH = "/cattle/cow_1/latest_reading";
const char* FIRESTORE_COLLECTION = "historical_readings";
const char* UPDATE_MASK = "timestamp";

// --- Global Objects ---
FirebaseData fbdo;
FirebaseAuth auth;
FirebaseConfig config;
OneWire oneWire_Internal(INTERNAL_TEMP_PIN);
DallasTemperature internalTempSensor(&oneWire_Internal);
OneWire oneWire_External(EXTERNAL_TEMP_PIN);
DallasTemperature externalTempSensor(&oneWire_External);


FirebaseJson reusableJson; 

bool wifiConnected = false;


void read_sensors(int &pulseValue, float &internalTemp, float &externalTemp) {
  pulseValue = analogRead(PULSE_SENSOR_PIN);
  internalTempSensor.requestTemperatures();
  externalTempSensor.requestTemperatures();
  internalTemp = internalTempSensor.getTempCByIndex(0);
  externalTemp = externalTempSensor.getTempCByIndex(0);
}

void setup() {
  Serial.begin(115200);
  delay(3000); 
  while (Serial.available()) { Serial.read(); }

  Serial.println("\n[INFO] Init...");
  internalTempSensor.begin();
  externalTempSensor.begin();

 
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("[WIFI] Connecting");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
    yield();
  }
  Serial.println("\n[WIFI] Connected! IP: " + WiFi.localIP().toString());
  wifiConnected = true;

  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;
  auth.user.email = USER_EMAIL;
  auth.user.password = USER_PASSWORD;
  config.token_status_callback = tokenStatusCallback;
  Firebase.begin(&config, &auth);
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    return;
  }

  if (Firebase.ready()) {
    int pulseRaw;
    float iTemp, eTemp;
    read_sensors(pulseRaw, iTemp, eTemp);

    Serial.printf("\n[REPORT] Pulse: %d, Temp (In/Ex): %.2f°C / %.2f°C\n", pulseRaw, iTemp, eTemp);

    reusableJson.clear(); 
    reusableJson.set("pulseRaw", pulseRaw);
    reusableJson.set("internalTemperature", iTemp);
    reusableJson.set("externalTemperature", eTemp);
    FirebaseJson rtdbTimestamp; 
    rtdbTimestamp.set(".sv", "timestamp");
    reusableJson.set("timestamp", rtdbTimestamp);
    
    // Send to RTDB
    if (!Firebase.RTDB.setJSON(&fbdo, RTDB_LATEST_PATH, &reusableJson)) {
      Serial.println("[ERROR] RTDB FAIL: " + fbdo.errorReason());
      yield();
      goto end_loop; 
    }
    
    reusableJson.clear(); 
    reusableJson.set("fields/pulseRaw/integerValue", String(pulseRaw));
    reusableJson.set("fields/internalTemperature/doubleValue", String(iTemp));
    reusableJson.set("fields/externalTemperature/doubleValue", String(eTemp));
    
    // Step 2.1: Create the document
    if (Firebase.Firestore.createDocument(&fbdo, FIREBASE_PROJECT_ID, "", FIRESTORE_COLLECTION, reusableJson.raw())) {
      yield(); // WDT FIX

      FirebaseJson responseJson(fbdo.payload());
      FirebaseJsonData result;
      responseJson.get(result, "name");

      String fullDocumentPath = result.stringValue; 
      int startIndex = fullDocumentPath.indexOf(FIRESTORE_COLLECTION);

      if (startIndex != -1) {
        String relativeDocPath = fullDocumentPath.substring(startIndex); 
        
        // Step 2.2: Patch the document
        if (Firebase.Firestore.patchDocument(&fbdo, FIREBASE_PROJECT_ID, "", relativeDocPath.c_str(), "", UPDATE_MASK)) {
          Serial.println("[STATUS] Data cycle successful. RTDB and Firestore updated.");
        } else {
          Serial.println("[ERROR] Firestore Patch FAIL: " + fbdo.errorReason());
        }
      } else {
        Serial.println("[ERROR] Firestore FAIL: Could not parse doc path.");
      }
    } else {
      Serial.println("[ERROR] Firestore Create FAIL: " + fbdo.errorReason());
    }
  } else {
    Serial.println("[FIREBASE] Not ready, waiting for token/connection...");
  }

  // --- LOG 4: Delay Message ---
  end_loop: 
  Serial.printf("[INFO] Cycle end. Waiting 1s...\n");
  delay(1000);
}