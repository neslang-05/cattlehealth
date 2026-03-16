/*
===================================================================================
ESP32 Cattle Health Monitoring System
===================================================================================
Author : Nilambar Elangbam
Sensors: MAX30102 Pulse + DS18B20 (2x) + HC-SR04
Cloud  : Firebase RTDB + Firestore
===================================================================================
*/

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include <OneWire.h>
#include <DallasTemperature.h>
#include <Wire.h>
#include "MAX30105.h"
#include "heartRate.h"
#include "addons/TokenHelper.h"

/* WIFI */

#define WIFI_SSID     "Test1"
#define WIFI_PASSWORD "123456789"

/* FIREBASE */

#define API_KEY             "AIzaSyAj7CcqeWrUemoyvATYDrT9PpdiIbye_lQ"
#define FIREBASE_PROJECT_ID "cattlehealthmonitoring-e1459"
#define DATABASE_URL        "cattlehealthmonitoring-e1459-default-rtdb.asia-southeast1.firebasedatabase.app"
#define USER_EMAIL          "neslang.in@gmail.com"
#define USER_PASSWORD       "123456"

/* SENSOR PINS */

#define ONE_WIRE_BUS 4
#define TRIG_PIN     5
#define ECHO_PIN     18

/* DATABASE PATHS */

const char* RTDB_LATEST_PATH     = "/cattle/cow_1/latest_reading";
const char* FIRESTORE_COLLECTION = "historical_readings";

/* FIREBASE OBJECTS */

FirebaseData   fbdo;
FirebaseAuth   auth;
FirebaseConfig config;

/* TEMPERATURE SENSORS */

OneWire           oneWire(ONE_WIRE_BUS);
DallasTemperature tempSensors(&oneWire);

/* PULSE SENSOR */

MAX30105 pulseSensor;

/* JSON */

FirebaseJson reusableJson;

/* ---------------------------------------------------------------
   BPM Rolling Average
--------------------------------------------------------------- */

const byte RATE_SIZE = 8;
byte  rates[RATE_SIZE];
byte  rateSpot       = 0;
long  lastBeat       = 0;
float beatsPerMinute = 0;
int   beatAvg        = 0;

/* Upload interval */

const unsigned long UPLOAD_INTERVAL_MS = 5000;
unsigned long       lastUploadTime     = 0;

/* ---------------------------------------------------------------
   ULTRASONIC
--------------------------------------------------------------- */

float read_ultrasonic_distance()
{
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);

  long duration = pulseIn(ECHO_PIN, HIGH, 30000);
  if (duration == 0) return -1.0;

  return duration * 0.034f / 2.0f;
}

/* ---------------------------------------------------------------
   PULSE SAMPLING — Library checkForBeat() peak detection
   Must be called every loop() iteration without blocking delay.
   Returns rolling-average BPM, or 0 if no valid reading.
--------------------------------------------------------------- */

int samplePulse()
{
  long irValue = pulseSensor.getIR();

  /* No finger on sensor — reset and bail */
  if (irValue < 10000)
  {
    beatAvg        = 0;
    beatsPerMinute = 0;
    for (byte x = 0; x < RATE_SIZE; x++) rates[x] = 0;
    rateSpot = 0;
    return 0;
  }

  if (checkForBeat(irValue))
  {
    long delta = millis() - lastBeat;
    lastBeat   = millis();

    beatsPerMinute = 60.0f / (delta / 1000.0f);

    if (beatsPerMinute > 20 && beatsPerMinute < 255)
    {
      rates[rateSpot++] = (byte)beatsPerMinute;
      rateSpot %= RATE_SIZE;

      beatAvg = 0;
      for (byte x = 0; x < RATE_SIZE; x++)
        beatAvg += rates[x];
      beatAvg /= RATE_SIZE;

      /* Signal quality — mirrors test sketch thresholds */
      const char* signalStrength =
        (irValue > 50000) ? "Excellent" :
        (irValue > 30000) ? "Good"      : "Weak";

      Serial.println("\n----------------------------------");
      Serial.print("Finger Status      : ");
      Serial.println("Detected");
      Serial.print("Current Heart Rate : ");
      Serial.print((int)beatsPerMinute);
      Serial.println(" BPM");
      Serial.print("Average Heart Rate : ");
      Serial.print(beatAvg);
      Serial.println(" BPM");
      Serial.print("Signal Strength    : ");
      Serial.println(signalStrength);
      Serial.println("----------------------------------");
    }
  }

  return beatAvg;
}

/* ---------------------------------------------------------------
   SETUP
--------------------------------------------------------------- */

void setup()
{
  Serial.begin(115200);
  delay(2000);
  Serial.println("\nSYSTEM INITIALIZING");

  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);

  tempSensors.begin();
  Serial.print("Temperature Sensors Found: ");
  Serial.println(tempSensors.getDeviceCount());

  Wire.begin(21, 22);

  if (!pulseSensor.begin(Wire, I2C_SPEED_FAST))
  {
    Serial.println("MAX30102 not found. Check wiring.");
    while (1);
  }

  Serial.println("MAX30102 Initialized");

  pulseSensor.setup();
  pulseSensor.setPulseAmplitudeRed(0x0A);
  pulseSensor.setPulseAmplitudeGreen(0);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting WiFi");
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi Connected: " + WiFi.localIP().toString());

  config.api_key               = API_KEY;
  config.database_url          = DATABASE_URL;
  auth.user.email              = USER_EMAIL;
  auth.user.password           = USER_PASSWORD;
  config.token_status_callback = tokenStatusCallback;

  Firebase.begin(&config, &auth);
}

/* ---------------------------------------------------------------
   LOOP
--------------------------------------------------------------- */

void loop()
{
  int currentBPM = samplePulse();

  unsigned long now = millis();

  if ((now - lastUploadTime) >= UPLOAD_INTERVAL_MS)
  {
    lastUploadTime = now;

    if (WiFi.status() != WL_CONNECTED || !Firebase.ready())
      return;

    tempSensors.requestTemperatures();
    float internalTemp = tempSensors.getTempCByIndex(0);
    float externalTemp = tempSensors.getTempCByIndex(1);
    float distance     = read_ultrasonic_distance();

    Serial.println("\n============== SENSOR REPORT ==============");
    Serial.print("Pulse Rate   : "); Serial.print(currentBPM);  Serial.println(" BPM (avg)");
    Serial.print("Internal Temp: "); Serial.print(internalTemp); Serial.println(" C");
    Serial.print("External Temp: "); Serial.print(externalTemp); Serial.println(" C");
    Serial.print("Distance     : "); Serial.print(distance);     Serial.println(" cm");
    Serial.println("===========================================\n");

    reusableJson.clear();
    reusableJson.set("pulseBPM",            currentBPM);
    reusableJson.set("internalTemperature", internalTemp);
    reusableJson.set("externalTemperature", externalTemp);
    reusableJson.set("distanceCM",          distance);

    FirebaseJson timestamp;
    timestamp.set(".sv", "timestamp");
    reusableJson.set("timestamp", timestamp);

    if (!Firebase.RTDB.setJSON(&fbdo, RTDB_LATEST_PATH, &reusableJson))
      Serial.println("RTDB ERROR: " + fbdo.errorReason());
    else
      Serial.println("RTDB upload successful.");
  }
}
