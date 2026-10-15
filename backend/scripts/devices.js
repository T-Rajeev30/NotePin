#!/usr/bin/env node
"use strict";
// node scripts/devices.js add NP-EA62F2A0 "Kiran's pin"   -> prints the key ONCE
// node scripts/devices.js add NP-EA62F2A0 --code K7Q2-M9XD-4TRB [name]   -> register with the pairing code shown by the pin
// node scripts/devices.js rotate NP-EA62F2A0               -> new key (old one stops working)
// node scripts/devices.js assign NP-EA62F2A0 owner@example.com
// node scripts/devices.js revoke NP-EA62F2A0 | restore NP-EA62F2A0 | list
const { load } = require("../src/config");
const { loadDevices, saveDevices, newKey } = require("../src/devices");
const pairing = require("../src/pairing");

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
  const ci = rest.indexOf("--code");
  let code = "";
  if (ci >= 0) {
    code = pairing.normalize(rest[ci + 1]);
    if (!code)
      die(
        "That pairing code does not look right (12 characters, shown during setup).",
      );
    rest.splice(ci, 2);
  }
  const key = code ? pairing.deriveKey(code, id) : newKey();
  devices[id] = {
    key,
    name: rest.join(" ") || id,
    createdAt: new Date().toISOString(),
    revoked: false,
    pairing: code ? "code" : "key",
  };
  saveDevices(cfg.devicesFile, devices);
  if (code)
    console.log(
      `Added ${id} (paired by code). Tap the pin; it connects by itself.`,
    );
  else
    console.log(
      `Added ${id}\nKey (shown once): ${key}\nOn the device serial monitor type:  key ${key}`,
    );
} else if (cmd === "rotate") {
  needId();
  if (!devices[id]) die(`${id} not found`);
  if (devices[id].pairing === "code")
    die("Paired by code: remove it and add it again with a new code.");
  devices[id].key = newKey();
  saveDevices(cfg.devicesFile, devices);
  console.log(
    `New key for ${id}: ${devices[id].key}\nOn the device serial monitor type:  key ${devices[id].key}`,
  );
} else if (cmd === "assign") {
  // node scripts/devices.js assign NP-EA62F2A0 owner@example.com  -> device shows up in that user's dashboard
  needId();
  if (!devices[id]) die(`${id} not found`);
  const { createUserStore } = require("../src/userStore");
  const owner = createUserStore(cfg.usersFile).byEmail(rest[0] || "");
  if (!owner) die("No such user (create the account first)");
  devices[id].ownerId = owner.id;
  saveDevices(cfg.devicesFile, devices);
  console.log(`${id} now belongs to ${owner.email}`);
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
      `${k}  ${d.revoked ? "REVOKED" : "active "}  ${d.name}  owner=${d.ownerId || "-"}  (${d.createdAt})`,
    ),
  );
} else {
  die(
    "Usage: node scripts/devices.js add|rotate|assign|revoke|restore|list <deviceId> [name|owner-email]",
  );
}
