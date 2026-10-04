/*
 * NotePin - Mic streaming test (supports Checkpoint 2 verification)
 *
 * Waits for a single 'R' byte over serial, then streams 5 seconds of
 * raw 16-bit PCM audio as binary data, framed by text markers so a
 * PC-side script can capture it into a WAV file.
 */

#include <Arduino.h>
#include <driver/i2s.h>

#define I2S_SCK   4
#define I2S_WS    5
#define I2S_SD    6

#define I2S_PORT        I2S_NUM_0
#define SAMPLE_RATE     16000
#define RECORD_SECONDS  5
#define DMA_BUF_LEN     256
#define DMA_BUF_COUNT   8

int32_t rawSamples[DMA_BUF_LEN];
int16_t outSamples[DMA_BUF_LEN];

void setupI2S() {
  i2s_config_t i2s_config = {
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
  i2s_pin_config_t pin_config = {
    .bck_io_num = I2S_SCK,
    .ws_io_num = I2S_WS,
    .data_out_num = I2S_PIN_NO_CHANGE,
    .data_in_num = I2S_SD
  };
  i2s_driver_install(I2S_PORT, &i2s_config, 0, NULL);
  i2s_set_pin(I2S_PORT, &pin_config);
}

void recordAndStream() {
  const uint32_t totalSamples = SAMPLE_RATE * RECORD_SECONDS;
  uint32_t samplesSent = 0;

  Serial.print("BEGIN\n");
  Serial.flush();

  while (samplesSent < totalSamples) {
    size_t bytesRead = 0;
    i2s_read(I2S_PORT, rawSamples, sizeof(rawSamples), &bytesRead, portMAX_DELAY);
    int samplesRead = bytesRead / sizeof(int32_t);

    int toSend = samplesRead;
    if (samplesSent + (uint32_t)toSend > totalSamples) {
      toSend = totalSamples - samplesSent;
    }

    for (int i = 0; i < toSend; i++) {
      int32_t s = rawSamples[i] >> 14;
      if (s > 32767) s = 32767;
      if (s < -32768) s = -32768;
      outSamples[i] = (int16_t)s;
    }

    Serial.write((uint8_t*)outSamples, toSend * sizeof(int16_t));
    samplesSent += toSend;
  }

  Serial.flush();
  Serial.print("\nEND\n");
}

void setup() {
  Serial.begin(115200);
  unsigned long waitStart = millis();
  while (!Serial && (millis() - waitStart) < 3000) {
    delay(10);
  }
  setupI2S();
  Serial.println("READY - send 'R' to record 5 seconds");
}

void loop() {
  if (Serial.available()) {
    char c = Serial.read();
    if (c == 'R') {
      recordAndStream();
    }
  }
}