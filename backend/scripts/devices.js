#!/usr/bin/env node
"use strict";
// node scripts/devices.js add NP-EA62F2A0 "Kiran's pin"   -> prints the key ONCE
// node scripts/devices.js rotate NP-EA62F2A0               -> new key (old one stops working)
// node scripts/devices.js revoke NP-EA62F2A0 | restore NP-EA62F2A0 | list
const { load } = require("../src/config");
const { loadDevices, saveDevices, newKey } = require("../src/deviceRegistry");

const cfg = load();
const [cmd, id, ...rest] = process.argv.slice(2);
const devices = loadDevices(cfg.devicesFile);
const die = (m) => {
  console.error(m);
  process.exit(1);
};
const needId = () => {
  if (!/^[A-Za-z0-9._-]{1,16}$/.test(id || ""))
    die("Device id required (e.g. NP-EA62F2A0)");
};

if (cmd === "add") {
  needId();
  if (devices[id]) die(`${id} already exists (use rotate to issue a new key)`);
  const key = newKey();
  devices[id] = {
    key,
    name: rest.join(" ") || id,
    createdAt: new Date().toISOString(),
    revoked: false,
  };
  saveDevices(cfg.devicesFile, devices);
  console.log(
    `Added ${id}\nKey (shown once): ${key}\nOn the device serial monitor type:  key ${key}`,
  );
} else if (cmd === "rotate") {
  needId();
  if (!devices[id]) die(`${id} not found`);
  devices[id].key = newKey();
  saveDevices(cfg.devicesFile, devices);
  console.log(
    `New key for ${id}: ${devices[id].key}\nOn the device serial monitor type:  key ${devices[id].key}`,
  );
} else if (cmd === "revoke" || cmd === "restore") {
  needId();
  if (!devices[id]) die(`${id} not found`);
  devices[id].revoked = cmd === "revoke";
  saveDevices(cfg.devicesFile, devices);
  console.log(`${id} ${cmd}d`);
} else if (cmd === "list") {
  const rows = Object.entries(devices);
  if (!rows.length) console.log("No devices registered.");
  rows.forEach(([k, d]) =>
    console.log(
      `${k}  ${d.revoked ? "REVOKED" : "active "}  ${d.name}  (${d.createdAt})`,
    ),
  );
} else {
  die(
    "Usage: node scripts/devices.js add|rotate|revoke|restore|list <deviceId> [name]",
  );
}
