#include <Arduino.h>
#include <WiFi.h>
#include <driver/i2s.h>
#include <Adafruit_NeoPixel.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/stream_buffer.h"
#include "secrets.h"
#include <ESPmDNS.h>
// ---- I2S pins (verified in Checkpoint 2) ----
#define I2S_SCK   4
#define I2S_WS    5
#define I2S_SD    6
#define I2S_PORT  I2S_NUM_0

#define SAMPLE_RATE     16000
#define DMA_BUF_LEN     256
#define DMA_BUF_COUNT   8

// ---- Audio conditioning ----
#define GAIN_SHIFT      16
#define HP_R            0.97f
#define CLIP_THRESHOLD  32700

// ---- Buffering ----
#define STREAM_BUF_SIZE 65536
#define NET_CHUNK       1460

// ---- Touch control (confirmed in Checkpoint 4a) ----
#define TOUCH_PIN          7
#define TOUCH_ACTIVE_HIGH  1
#define TOUCH_IS_TOGGLE    0
#define DEBOUNCE_MS        50

#define LED_PIN   21
#define LED_COUNT 1

Adafruit_NeoPixel pixel(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

static StreamBufferHandle_t audioStream = NULL;
static WiFiClient client;

static volatile uint32_t overrunCount     = 0;
static volatile uint32_t clippedCount     = 0;
static volatile uint32_t samplesProcessed = 0;
static volatile uint32_t bytesSent        = 0;
static volatile uint32_t connectCount     = 0;
static volatile int32_t  peakSeen         = 0;
static volatile uint32_t bufHighWater     = 0;
static volatile uint32_t i2sErrors        = 0;
static volatile bool     streamingEnabled = false;
static volatile bool     clientReady      = false;   // true only once TCP is actually up

inline bool touchActive() {
  int v = digitalRead(TOUCH_PIN);
  return TOUCH_ACTIVE_HIGH ? (v == HIGH) : (v == LOW);
}

// ------------------------------------------------------------------
void setupI2S() {
  i2s_config_t cfg = {
    .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
    .sample_rate = SAMPLE_RATE,
    .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
    .channel_format = I2S_CHANNEL_FMT_ONLY_LEFT,
    .communication_format = I2S_COMM_FORMAT_STAND_I2S,
    .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
    .dma_buf_count = DMA_BUF_COUNT,
    .dma_buf_len = DMA_BUF_LEN,
    .use_apll = false,
    .tx_desc_auto_clear = false,
    .fixed_mclk = 0
  };
  i2s_pin_config_t pins = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };
  esp_err_t err = i2s_driver_install(I2S_PORT, &cfg, 0, NULL);
  if (err != ESP_OK) Serial.printf("i2s_driver_install failed: %d\n", err);
  err = i2s_set_pin(I2S_PORT, &pins);
  if (err != ESP_OK) Serial.printf("i2s_set_pin failed: %d\n", err);
}

// ---- Core 0: capture, condition, enqueue -------------------------
void audioTask(void* param) {
  static int32_t raw[DMA_BUF_LEN];
  static int16_t out[DMA_BUF_LEN];
  float hpX1 = 0.0f, hpY1 = 0.0f;

  for (;;) {
    size_t bytesRead = 0;
    if (i2s_read(I2S_PORT, raw, sizeof(raw), &bytesRead, portMAX_DELAY) != ESP_OK) {
      i2sErrors++;
      continue;
    }
    int n = bytesRead / sizeof(int32_t);

    for (int i = 0; i < n; i++) {
      int32_t s = raw[i] >> GAIN_SHIFT;

      float xf = (float)s;
      float y  = xf - hpX1 + HP_R * hpY1;
      hpX1 = xf;
      hpY1 = y;
      s = (int32_t)y;

      int32_t a = abs(s);
      if (a > peakSeen) peakSeen = a;
      if (a >= CLIP_THRESHOLD) clippedCount++;

      if (s > 32767)  s = 32767;
      if (s < -32768) s = -32768;
      out[i] = (int16_t)s;
    }
    samplesProcessed += n;

    // Only queue once a real TCP connection exists - nothing to lose
    // while we're merely trying to connect.
    if (!streamingEnabled || !clientReady) continue;

    size_t want = n * sizeof(int16_t);
    size_t got  = xStreamBufferSend(audioStream, out, want, 0);
    if (got < want) overrunCount++;
    size_t filled = xStreamBufferBytesAvailable(audioStream);
    if (filled > bufHighWater) bufHighWater = filled;
  }
}

// ---- Core 1: connect, drain buffer, transmit ---------------------
void networkTask(void* param) {
  static uint8_t chunk[NET_CHUNK];

  for (;;) {
    if (!streamingEnabled) {
      if (client.connected()) {
        client.stop();
        Serial.println("Session ended - disconnected.");
      }
      clientReady = false;
      vTaskDelay(pdMS_TO_TICKS(100));
      continue;
    }

    if (!client.connected()) {
      clientReady = false;
      if (WiFi.status() != WL_CONNECTED) {
        vTaskDelay(pdMS_TO_TICKS(500));
        continue;
      }
      Serial.printf("Connecting to %s:%d ...\n", SERVER_IP, SERVER_PORT);
      if (client.connect(SERVER_IP, SERVER_PORT)) {
        client.setNoDelay(true);
        connectCount++;

        uint8_t hdr[12];
        uint32_t sr = SAMPLE_RATE;
        uint16_t bits = 16, ch = 1;
        memcpy(hdr + 0, "NPIN", 4);
        memcpy(hdr + 4, &sr, 4);
        memcpy(hdr + 8, &bits, 2);
        memcpy(hdr + 10, &ch, 2);
        client.write(hdr, sizeof(hdr));

        xStreamBufferReset(audioStream);
        clientReady = true;
        Serial.println("Connected - streaming.");
      } else {
        Serial.println("Connect failed, retrying in 2s.");
        vTaskDelay(pdMS_TO_TICKS(2000));
        continue;
      }
    }

    size_t got = xStreamBufferReceive(audioStream, chunk, sizeof(chunk), pdMS_TO_TICKS(100));
    if (got > 0) {
      size_t w = client.write(chunk, got);
      if (w != got) {
        Serial.println("Write failed - dropping connection.");
        client.stop();
        clientReady = false;
      } else {
        bytesSent += w;
      }
    }
  }
}

// ------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && (millis() - t0) < 3000) delay(10);

  Serial.println("NotePin - Checkpoint 4b: Touch-Controlled Wi-Fi Streaming");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setSleep(false);
  Serial.printf("Connecting to \"%s\"", WIFI_SSID);
  t0 = millis();
  while (WiFi.status() != WL_CONNECTED && (millis() - t0) < 20000) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi failed. Halting.");
    return;
  }
  Serial.printf("Wi-Fi OK  ip=%s  rssi=%d dBm\n",
                WiFi.localIP().toString().c_str(), WiFi.RSSI());

  setupI2S();

  audioStream = xStreamBufferCreate(STREAM_BUF_SIZE, 1);
  if (audioStream == NULL) {
    Serial.println("Failed to allocate stream buffer. Halting.");
    return;
  }

  pinMode(TOUCH_PIN, INPUT_PULLDOWN);
  pixel.begin();
  pixel.setBrightness(40);
  pixel.setPixelColor(0, pixel.Color(0, 0, 30));   // dim blue = idle
  pixel.show();

  xTaskCreatePinnedToCore(audioTask,   "audio", 4096, NULL, 5, NULL, 0);
  xTaskCreatePinnedToCore(networkTask, "net",   4096, NULL, 4, NULL, 1);

  Serial.println("Ready - tap the touch sensor to start streaming.");
}

void loop() {
  // ---- debounced touch handling ----
  static bool lastRaw = false;
  static bool stable = false;
  static unsigned long lastEdge = 0;

  bool raw = touchActive();
  if (raw != lastRaw) {
    lastRaw = raw;
    lastEdge = millis();
  }
  if ((millis() - lastEdge) > DEBOUNCE_MS && raw != stable) {
    stable = raw;
    if (TOUCH_IS_TOGGLE) {
      streamingEnabled = stable;
    } else if (stable) {
      streamingEnabled = !streamingEnabled;
    }
    if (raw == stable) {
      if (streamingEnabled) {
        // fresh counters so end-of-session stats describe THIS recording
        clippedCount = 0;
        samplesProcessed = 0;
        peakSeen = 0;
      }
      Serial.printf(">>> streaming %s\n", streamingEnabled ? "STARTED" : "STOPPED");
    }
  }

  // ---- status LED: red=no wifi, blue=idle, yellow=connecting, green=streaming ----
  static bool lastLed = false, lastWifi = true, lastReady = false;
  bool wifiOk = (WiFi.status() == WL_CONNECTED);
  bool ready  = clientReady;
  if (streamingEnabled != lastLed || wifiOk != lastWifi || ready != lastReady) {
    lastLed = streamingEnabled;
    lastWifi = wifiOk;
    lastReady = ready;
    if (!wifiOk)                          pixel.setPixelColor(0, pixel.Color(40, 0, 0));
    else if (streamingEnabled && ready)   pixel.setPixelColor(0, pixel.Color(0, 40, 0));
    else if (streamingEnabled)            pixel.setPixelColor(0, pixel.Color(40, 40, 0));
    else                                  pixel.setPixelColor(0, pixel.Color(0, 0, 30));
    pixel.show();
  }

  // ---- stats ----
  static unsigned long last = 0;
  if (millis() - last >= 5000) {
    last = millis();
    uint32_t sp = samplesProcessed;
    float clipPct = sp ? (100.0f * (float)clippedCount / (float)sp) : 0.0f;
    const char* state = !streamingEnabled ? "idle  " : (clientReady ? "STREAM" : "connct");
    Serial.printf("[stat] %s  rssi=%d  sent=%luKB  overruns=%lu  conns=%lu  bufmax=%lu%%  i2serr=%lu  peak=%ld  clip=%.2f%%  heap=%u\n",
                  state,
                  WiFi.RSSI(),
                  (unsigned long)(bytesSent / 1024),
                  (unsigned long)overrunCount,
                  (unsigned long)connectCount,
                  (unsigned long)(bufHighWater * 100UL / STREAM_BUF_SIZE),
                  (unsigned long)i2sErrors,
                  (long)peakSeen,
                  clipPct,
                  ESP.getFreeHeap());
    peakSeen = 0;
    bufHighWater = 0;
  }

  delay(10);
}