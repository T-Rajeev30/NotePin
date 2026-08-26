// NotePin backend configuration.
// Keep this file simple - no secrets live here, just local dev settings.

module.exports = {
  HTTP_PORT: 3002, // REST API - for the web app / manual testing
  TCP_PORT: 5000, // raw audio ingest - MUST match SERVER_PORT in the
  // ESP32's secrets.h
  DATA_DIR: __dirname + "/data",
  RECORDINGS_DIR: __dirname + "/data/recordings",
  SESSIONS_FILE: __dirname + "/data/sessions.json",
};
