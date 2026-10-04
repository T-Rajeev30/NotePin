#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <DNSServer.h>
#include <ArduinoJson.h>

#include "config.h"
#include "device_state.h"
#include "identity.h"
#include "storage.h"
#include "led.h"
#include "setup_ui.h"

WebServer webServer(SETUP_HTTP_PORT);
DNSServer dnsServer;
CredentialStore credentials;
StatusLed statusLed;

String deviceId;
String setupApName;
DeviceState deviceState = DeviceState::FACTORY;
bool setupMode = false;

unsigned long setupStartedAt = 0;
unsigned long restartAt = 0;          // non-zero = restart pending
unsigned long stationStartedAt = 0;
unsigned long lastWifiAttempt = 0;
unsigned long touchHeldMs = 0;

// ---------------- Wi-Fi station (normal mode) ----------------

void beginStation() {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);
    WiFi.begin(credentials.ssid().c_str(), credentials.password().c_str());
    deviceState = DeviceState::CONNECTING_WIFI;
    stationStartedAt = lastWifiAttempt = millis();
    Serial.printf("[wifi] connecting to \"%s\"\n", credentials.ssid().c_str());
}

void updateStation() {
    if (setupMode || !credentials.hasCredentials()) return;

    const bool up = WiFi.status() == WL_CONNECTED;

    if (up && deviceState != DeviceState::READY) {
        deviceState = DeviceState::READY;
        Serial.printf("[wifi] connected  ssid=%s  ip=%s  rssi=%d dBm\n",
                      WiFi.SSID().c_str(),
                      WiFi.localIP().toString().c_str(),
                      WiFi.RSSI());
    } else if (!up && deviceState == DeviceState::READY) {
        Serial.println("[wifi] connection lost, reconnecting...");
        deviceState = DeviceState::CONNECTING_WIFI;
        stationStartedAt = lastWifiAttempt = millis();
    } else if (!up && millis() - lastWifiAttempt > WIFI_RETRY_INTERVAL_MS) {
        lastWifiAttempt = millis();
        WiFi.disconnect();
        WiFi.begin(credentials.ssid().c_str(), credentials.password().c_str());
        if (millis() - stationStartedAt > WIFI_CONNECT_TIMEOUT_MS) {
            deviceState = DeviceState::ERROR_STATE;   // red; still retrying
            Serial.println("[wifi] cannot connect (hold touch 5 s to re-run setup)");
        }
    }
}

// ---------------- Setup hotspot + captive portal ----------------

void startSetupMode() {
    if (setupMode) return;
    setupMode = true;
    setupStartedAt = millis();
    deviceState = DeviceState::PROVISIONING;

    if (WiFi.getMode() != WIFI_OFF) WiFi.disconnect();
    WiFi.mode(WIFI_AP_STA);

    IPAddress ip(AP_IP_1, AP_IP_2, AP_IP_3, AP_IP_4);
    IPAddress mask(AP_NETMASK_1, AP_NETMASK_2, AP_NETMASK_3, AP_NETMASK_4);
    WiFi.softAPConfig(ip, ip, mask);
    WiFi.softAP(setupApName.c_str());           // open AP; the portal is the onboarding
    dnsServer.start(SETUP_DNS_PORT, "*", WiFi.softAPIP());

    Serial.println("\n==================================");
    Serial.println("NOTEPIN SETUP MODE");
    Serial.printf("Join Wi-Fi: %s\n", setupApName.c_str());
    Serial.printf("Open:       http://%s/\n", WiFi.softAPIP().toString().c_str());
    Serial.println("==================================");
}

void sendJson(int code, const String& body) {
    webServer.send(code, "application/json; charset=utf-8", body);
}

void handleCaptive() {
    webServer.sendHeader("Location", "http://" + WiFi.softAPIP().toString() + "/", true);
    webServer.send(302, "text/plain", "");
}

void handleStatus() {
    JsonDocument doc;
    doc["device_id"] = deviceId;
    doc["firmware"] = FIRMWARE_VERSION;
    doc["state"] = stateToString(deviceState);
    doc["setup_mode"] = setupMode;
    String out;
    serializeJson(doc, out);
    sendJson(200, out);
}

void handleScan() {
    const int count = WiFi.scanNetworks(false, false);
    JsonDocument doc;
    JsonArray list = doc["networks"].to<JsonArray>();

    for (int i = 0; i < count; ++i) {             // strongest first
        const String ssid = WiFi.SSID(i);
        if (ssid.isEmpty()) continue;

        bool dup = false;
        for (JsonObject n : list) {
            if (n["ssid"].as<String>() == ssid) { dup = true; break; }
        }
        if (dup) continue;

        JsonObject n = list.add<JsonObject>();
        n["ssid"] = ssid;
        n["rssi"] = WiFi.RSSI(i);
    }
    WiFi.scanDelete();

    String out;
    serializeJson(doc, out);
    sendJson(200, out);
}

// Save credentials, tell the phone, then reboot into normal mode.
void handleConnect() {
    JsonDocument req;
    if (deserializeJson(req, webServer.arg("plain"))) {
        return sendJson(400, "{\"ok\":false,\"error\":\"Invalid request\"}");
    }

    String ssid = req["ssid"] | "";
    String password = req["password"] | "";
    ssid.trim();

    if (ssid.isEmpty() || ssid.length() > 32) {
        return sendJson(400, "{\"ok\":false,\"error\":\"Enter a valid Wi-Fi name\"}");
    }
    if (password.length() != 0 && (password.length() < 8 || password.length() > 63)) {
        return sendJson(400, "{\"ok\":false,\"error\":\"Wi-Fi password must be 8-63 characters\"}");
    }

    credentials.save(ssid, password);
    Serial.printf("[setup] saved Wi-Fi \"%s\"; restarting\n", ssid.c_str());
    sendJson(200, "{\"ok\":true}");
    restartAt = millis() + 1500;                  // let the response reach the phone
}

// ---------------- Touch: hold 5 s -> setup hotspot ----------------

void updateTouch() {
    static unsigned long pressedAt = 0, lastHigh = 0;
    static bool fired = false;

    const unsigned long now = millis();
    const bool raw = digitalRead(TOUCH_PIN) == HIGH;
    if (raw) lastHigh = now;
    const bool down = raw || (lastHigh && now - lastHigh < TOUCH_DEBOUNCE_MS);

    if (!down) {
        pressedAt = 0;
        fired = false;
        touchHeldMs = 0;
        return;
    }

    if (!pressedAt) pressedAt = now;
    touchHeldMs = now - pressedAt;

    if (!fired && touchHeldMs >= SETUP_HOLD_MS) {
        fired = true;
        Serial.println("[touch] 5 s hold -> setup mode");
        startSetupMode();
    }
}

// ---------------- Boot / loop ----------------

void setup() {
    Serial.begin(115200);
    delay(500);

    pinMode(TOUCH_PIN, INPUT_PULLDOWN);
    statusLed.begin();
    credentials.begin();

    deviceId = makeDeviceId();
    setupApName = makeSetupApName(deviceId);

    Serial.println("\n==================================");
    Serial.println("          NOTEPIN");
    Serial.println("==================================");
    Serial.printf("Firmware: %s\nDevice ID: %s\n", FIRMWARE_VERSION, deviceId.c_str());

    webServer.on("/", HTTP_GET, []() {
        webServer.send_P(200, "text/html; charset=utf-8", SETUP_INDEX_HTML);
    });
    webServer.on("/api/status", HTTP_GET, handleStatus);
    webServer.on("/api/wifi/scan", HTTP_GET, handleScan);
    webServer.on("/api/wifi/connect", HTTP_POST, handleConnect);

    // Captive-portal probes (Android, Apple, Windows, Firefox)
    for (const char* path : {"/generate_204", "/gen_204", "/hotspot-detect.html",
                             "/library/test/success.html", "/connecttest.txt",
                             "/ncsi.txt", "/fwlink", "/canonical.html", "/success.txt"}) {
        webServer.on(path, HTTP_GET, handleCaptive);
    }
    webServer.onNotFound([]() {
        if (setupMode) return handleCaptive();
        webServer.send(404, "text/plain", "NotePin: not found");
    });
    webServer.begin();

    if (credentials.hasCredentials()) {
        Serial.println("[boot] saved Wi-Fi found");
        beginStation();
    } else {
        Serial.println("[boot] no saved Wi-Fi (first boot)");
        startSetupMode();
    }
}

void loop() {
    updateTouch();
    webServer.handleClient();
    if (setupMode) dnsServer.processNextRequest();
    updateStation();
    statusLed.update(setupMode, deviceState, touchHeldMs);

    if (restartAt && millis() > restartAt) ESP.restart();

    // Forgotten setup hotspot: return to normal mode if Wi-Fi is already saved.
    if (setupMode && !restartAt && credentials.hasCredentials() &&
        millis() - setupStartedAt > SETUP_TIMEOUT_MS) {
        Serial.println("[setup] timed out, restarting");
        ESP.restart();
    }

    delay(5);
}