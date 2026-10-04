#pragma once

enum class DeviceState {
    FACTORY,
    PROVISIONING,
    CONNECTING_WIFI,
    CONNECTING_SERVER,
    READY,
    ERROR_STATE
};

inline const char* stateToString(DeviceState state) {
    switch (state) {
        case DeviceState::FACTORY: return "factory";
        case DeviceState::PROVISIONING: return "provisioning";
        case DeviceState::CONNECTING_WIFI: return "connecting_wifi";
        case DeviceState::READY: return "ready";
        case DeviceState::ERROR_STATE: return "error";
        case DeviceState::CONNECTING_SERVER: return "CONNECTING_SERVER";

    }

    return "unknown";
}
