#include <Arduino.h>
#include <WiFi.h>
#include "secrets.h"

#define CONNECT_TIMEOUT_MS  20000
#define STATUS_INTERVAL_MS   5000

static unsigned long lastStatus = 0;
static uint32_t dropCount = 0;
static bool wasConnected = false;

const char* statusText(wl_status_t s) {
  switch (s) {
    case WL_IDLE_STATUS:     return "IDLE";
    case WL_NO_SSID_AVAIL:   return "NO_SSID_AVAIL (network not found)";
    case WL_SCAN_COMPLETED:  return "SCAN_COMPLETED";
    case WL_CONNECTED:       return "CONNECTED";
    case WL_CONNECT_FAILED:  return "CONNECT_FAILED (wrong password?)";
    case WL_CONNECTION_LOST: return "CONNECTION_LOST";
    case WL_DISCONNECTED:    return "DISCONNECTED";
    default:                 return "UNKNOWN";
  }
}

void printConnectionInfo() {
  Serial.println();
  Serial.println("========================================");
  Serial.println(" NotePin - Wi-Fi Connected");
  Serial.println("========================================");
  Serial.printf("SSID:         %s\n", WiFi.SSID().c_str());
  Serial.printf("IP address:   %s\n", WiFi.localIP().toString().c_str());
  Serial.printf("Gateway:      %s\n", WiFi.gatewayIP().toString().c_str());
  Serial.printf("Subnet:       %s\n", WiFi.subnetMask().toString().c_str());
  Serial.printf("MAC address:  %s\n", WiFi.macAddress().c_str());
  Serial.printf("Signal (RSSI): %d dBm\n", WiFi.RSSI());
  Serial.printf("Channel:      %d\n", WiFi.channel());
  Serial.println("========================================");
  Serial.println();
  Serial.println("NOTE the IP address above - Checkpoint 3b needs it.");
  Serial.println();
}

void setup() {
  Serial.begin(115200);
  unsigned long waitStart = millis();
  while (!Serial && (millis() - waitStart) < 3000) { delay(10); }

  Serial.println("NotePin - Checkpoint 3a: Wi-Fi Connection Test");
  Serial.printf("Connecting to \"%s\"...\n", WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - start) < CONNECT_TIMEOUT_MS) {
    delay(500);
    Serial.printf("  status=%s\n", statusText(WiFi.status()));
  }

  if (WiFi.status() == WL_CONNECTED) {
    printConnectionInfo();
    wasConnected = true;
  } else {
    Serial.println();
    Serial.println("FAILED to connect within timeout.");
    Serial.printf("Final status: %s\n", statusText(WiFi.status()));
    Serial.println("See Failure Diagnosis - most common cause is a 5GHz network.");
    Serial.println();
  }

  lastStatus = millis();
}

void loop() {
  if (millis() - lastStatus >= STATUS_INTERVAL_MS) {
    lastStatus = millis();
    bool connected = (WiFi.status() == WL_CONNECTED);

    if (connected) {
      Serial.printf("[ok] rssi=%d dBm  ip=%s  drops=%lu  uptime=%lus\n",
                    WiFi.RSSI(),
                    WiFi.localIP().toString().c_str(),
                    (unsigned long)dropCount,
                    (unsigned long)(millis() / 1000));
    } else {
      if (wasConnected) {
        dropCount++;
        Serial.printf("[DROP #%lu] status=%s - attempting reconnect\n",
                      (unsigned long)dropCount, statusText(WiFi.status()));
        WiFi.reconnect();
      } else {
        Serial.printf("[waiting] status=%s\n", statusText(WiFi.status()));
      }
    }
    wasConnected = connected;
  }
}