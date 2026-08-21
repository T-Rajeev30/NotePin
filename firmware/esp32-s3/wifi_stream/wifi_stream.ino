#include <Arduino.h>
#include <WiFi.h>
#include <driver/i2s.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/stream_buffer.h"
#include "secrets.h"

// ---- I2S pins (verified in Checkpoint 2) ----
#define I2S_SCK   4
#define I2S_WS    5
#define I2S_SD    6
#define I2S_PORT  I2S_NUM_0

#define SAMPLE_RATE     16000
#define DMA_BUF_LEN     256
#define DMA_BUF_COUNT   8

// ---- Audio conditioning (carried over from the Checkpoint 2 fix) ----
#define GAIN_SHIFT      16      // 14 clipped badly; 16 = 4x less gain
#define HP_R            0.97f   // one-pole high-pass, corner ~76 Hz
#define CLIP_THRESHOLD  32700

// ---- Buffering ----
#define STREAM_BUF_SIZE 32768   // ~1 second of 16kHz 16-bit mono
#define NET_CHUNK       1024

static StreamBufferHandle_t audioStream = NULL;
static WiFiClient client;

static volatile uint32_t overrunCount     = 0;
static volatile uint32_t clippedCount     = 0;
static volatile uint32_t samplesProcessed = 0;
static volatile uint32_t bytesSent        = 0;
static volatile uint32_t connectCount     = 0;
static volatile int32_t  peakSeen         = 0;

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

    // Never block here - a full buffer means the network is behind,
    // and stalling I2S would corrupt capture. Drop and count instead.
    size_t want = n * sizeof(int16_t);
    size_t got  = xStreamBufferSend(audioStream, out, want, 0);
    if (got < want) overrunCount++;
  }
}

// ---- Core 1: connect, drain buffer, transmit ---------------------
void networkTask(void* param) {
  static uint8_t chunk[NET_CHUNK];

  for (;;) {
    if (!client.connected()) {
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

  Serial.println("NotePin - Checkpoint 3b: Wi-Fi Audio Streaming");

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
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

  xTaskCreatePinnedToCore(audioTask,   "audio", 4096, NULL, 5, NULL, 0);
  xTaskCreatePinnedToCore(networkTask, "net",   4096, NULL, 4, NULL, 1);

  Serial.println("Tasks started.");
}

void loop() {
  static unsigned long last = 0;
  if (millis() - last >= 5000) {
    last = millis();
    uint32_t sp = samplesProcessed;
    float clipPct = sp ? (100.0f * (float)clippedCount / (float)sp) : 0.0f;
    Serial.printf("[stat] rssi=%d  sent=%luKB  overruns=%lu  conns=%lu  peak=%ld  clip=%.2f%%  heap=%u\n",
                  WiFi.RSSI(),
                  (unsigned long)(bytesSent / 1024),
                  (unsigned long)overrunCount,
                  (unsigned long)connectCount,
                  (long)peakSeen,
                  clipPct,
                  ESP.getFreeHeap());
    peakSeen = 0;   // reset so each window shows its own peak
  }
  delay(50);
}