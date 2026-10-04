#pragma once

#include <Arduino.h>
#include <Preferences.h>

class CredentialStore {
public:
    bool begin() {
        return preferences.begin("notepin", false);
    }

    String ssid() {
        return preferences.getString("ssid", "");
    }

    String password() {
        return preferences.getString("password", "");
    }

    bool hasCredentials() {
        return !ssid().isEmpty();
    }

    void save(const String& ssidValue, const String& passwordValue) {
        preferences.putString("ssid", ssidValue);
        preferences.putString("password", passwordValue);
    }

    void clear() {
        preferences.remove("ssid");
        preferences.remove("password");
    }

private:
    Preferences preferences;
};
