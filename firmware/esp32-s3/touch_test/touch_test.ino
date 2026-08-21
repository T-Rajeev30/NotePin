#include <Arduino.h>

#define TOUCH_PIN 7

static int lastLevel = -1;
static unsigned long lastChangeMs = 0;
static uint32_t changeCount = 0;

void setup() {
  Serial.begin(115200);
  unsigned long t0 = millis();
  while (!Serial && (millis() - t0) < 3000) delay(10);

  // PULLDOWN so a disconnected signal wire reads LOW instead of floating
  // randomly - makes a wiring fault obvious rather than confusing.
  pinMode(TOUCH_PIN, INPUT_PULLDOWN);

  Serial.println("NotePin - Checkpoint 4a: TTP223 Touch Sensor Test");
  Serial.printf("Reading GPIO%d\n\n", TOUCH_PIN);
  Serial.println("1. Do NOT touch the sensor for 5 seconds - note the idle level.");
  Serial.println("2. Then touch and HOLD for ~3 seconds, and release.");
  Serial.println("3. Repeat the touch-and-release 3 or 4 times.\n");

  lastLevel = digitalRead(TOUCH_PIN);
  lastChangeMs = millis();
  Serial.printf("[%8lu ms] initial level = %s\n",
                (unsigned long)millis(), lastLevel ? "HIGH" : "LOW");
}

void loop() {
  int level = digitalRead(TOUCH_PIN);

  if (level != lastLevel) {
    unsigned long now = millis();
    unsigned long heldFor = now - lastChangeMs;
    changeCount++;
    Serial.printf("[%8lu ms] -> %-4s   (was %-4s for %lu ms)   changes=%lu\n",
                  now,
                  level ? "HIGH" : "LOW",
                  lastLevel ? "HIGH" : "LOW",
                  heldFor,
                  (unsigned long)changeCount);
    lastLevel = level;
    lastChangeMs = now;
  }

  // periodic idle report so you can see it's alive and stable
  static unsigned long lastReport = 0;
  if (millis() - lastReport >= 3000) {
    lastReport = millis();
    if (millis() - lastChangeMs >= 3000) {
      Serial.printf("[%8lu ms] steady at %s\n",
                    (unsigned long)millis(), level ? "HIGH" : "LOW");
    }
  }

  delay(5);
}