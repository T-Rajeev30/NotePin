#pragma once

#include <Arduino.h>
#include <Adafruit_NeoPixel.h>
#include "config.h"
#include "device_state.h"

// white (holding) | cyan blink = setup hotspot | yellow blink = connecting
// blue = connected | red = cannot connect (retrying)
class StatusLed {
public:
    StatusLed() : pixel(STATUS_LED_COUNT, STATUS_LED_PIN, NEO_GRB + NEO_KHZ800) {}

    void begin() {
        pixel.begin();
        pixel.setBrightness(30);
        set(0, 0, 0);
    }

    void update(bool setupMode, DeviceState state, unsigned long holdMs) {
        const bool on = ((millis() / 450) % 2) == 0;

        if (holdMs >= 1500) return set(255, 255, 255);
        if (setupMode)      return on ? set(0, 200, 255) : set(0, 0, 0);

        switch (state) {
            case DeviceState::CONNECTING_WIFI:
            case DeviceState::CONNECTING_SERVER:
                return on ? set(255, 180, 0) : set(0, 0, 0);
            case DeviceState::READY:
                return set(0, 0, 255);
            case DeviceState::ERROR_STATE:
                return set(255, 0, 0);
            default:
                return set(0, 0, 0);
        }
    }

private:
    Adafruit_NeoPixel pixel;
    uint32_t last = 0xFFFFFFFF;

    void set(uint8_t r, uint8_t g, uint8_t b) {
        const uint32_t c = pixel.Color(r, g, b);
        if (c == last) return;
        last = c;
        pixel.setPixelColor(0, c);
        pixel.show();
    }
};