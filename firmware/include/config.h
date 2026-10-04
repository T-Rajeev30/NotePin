#pragma once

// -------------------------------
// Hardware
// -------------------------------

#define TOUCH_PIN 7
#define STATUS_LED_PIN 21

#define I2S_BCLK_PIN 4
#define I2S_WS_PIN   5
#define I2S_DATA_PIN 6

// -------------------------------
// Device
// -------------------------------
#define STATUS_LED_PIN 21
#define STATUS_LED_COUNT 1                 // add

#define FIRMWARE_VERSION "0.2.0-phase1"    // bump

#define SETUP_HOLD_MS 5000UL               // was 8000UL

#define SETUP_TIMEOUT_MS 600000UL          // add (setup hotspot gives up after 10 min)

#define DEVICE_ID_PREFIX "NP"

#define SETUP_AP_PREFIX "NotePin-"

#define AP_IP_1 192
#define AP_IP_2 168
#define AP_IP_3 4
#define AP_IP_4 1

#define AP_NETMASK_1 255
#define AP_NETMASK_2 255
#define AP_NETMASK_3 255
#define AP_NETMASK_4 0

#define SETUP_DNS_PORT 53
#define SETUP_HTTP_PORT 80

// Hold for this long to erase Wi-Fi credentials.
#define SETUP_HOLD_MS 8000UL

// Debounce / edge guard.
#define TOUCH_DEBOUNCE_MS 60UL

// -------------------------------
// Wi-Fi
// -------------------------------

#define WIFI_CONNECT_TIMEOUT_MS 20000UL
#define WIFI_RETRY_INTERVAL_MS 10000UL

// -------------------------------
// Optional server health check
// -------------------------------

// Leave empty until your VPA endpoint exists.
// Example later:
// #define VPA_HEALTH_HOST "api.notepin.com"
// #define VPA_HEALTH_PATH "/health"

#define VPA_HEALTH_HOST ""
#define VPA_HEALTH_PATH "/health"

// -------------------------------
// Safety
// -------------------------------


