#pragma once

#include <Arduino.h>

inline String makeDeviceId() {
    uint64_t mac = ESP.getEfuseMac();

    char id[24];
    snprintf(
        id,
        sizeof(id),
        "NP-%04X%04X",
        (uint16_t)(mac >> 16),
        (uint16_t)mac
    );

    return String(id);
}

inline String makeSetupApName(const String& deviceId) {
    String suffix = deviceId;

    if (suffix.length() > 4) {
        suffix = suffix.substring(suffix.length() - 4);
    }

    return String("NotePin-") + suffix;
}
