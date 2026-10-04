#ifndef SECRETS_H
#define SECRETS_H

// 2.4GHz network only - the ESP32-S3 cannot use 5GHz
#define WIFI_SSID      "R"
#define WIFI_PASSWORD  "YOUR_PASSWORD"

// Your PC's IP on the SAME network. Find it with: ipconfig
// It must be in the same 10.92.127.x range as the ESP32.
#define SERVER_IP "10.92.127.64"
#define SERVER_PORT    5001

#endif