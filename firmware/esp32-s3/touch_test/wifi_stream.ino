#include <Adafruit_NeoPixel.h>

// ---- Touch control (set these from the Checkpoint 4a result) ----
#define TOUCH_PIN          7
#define TOUCH_ACTIVE_HIGH  1    // 1 if touch reads HIGH, 0 if it reads LOW
#define TOUCH_IS_TOGGLE    0    // 1 if the module latches, 0 if momentary
#define DEBOUNCE_MS        50

#define LED_PIN   21
#define LED_COUNT 1

Adafruit_NeoPixel pixel(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

static volatile bool streamingEnabled = false;

inline bool touchActive() {
  int v = digitalRead(TOUCH_PIN);
  return TOUCH_ACTIVE_HIGH ? (v == HIGH) : (v == LOW);
}