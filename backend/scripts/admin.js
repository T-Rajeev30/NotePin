#!/usr/bin/env node
"use strict";
// Server-side account administration (the dashboard cannot create the first admin on purpose).
//   node scripts/admin.js create-admin <email> [name]     (prompts for the password, hidden)
//   node scripts/admin.js reset-password <email>
//   node scripts/admin.js list
//   node scripts/admin.js invite
const { load } = require("../src/config");
const { createUserStore } = require("../src/userStore");

const cfg = load();
const users = createUserStore(cfg.usersFile);
const [cmd, a1, a2] = process.argv.slice(2);

function ask(prompt) {
  return new Promise((resolve) => {
    if (process.env.NOTEPIN_ADMIN_PASSWORD)
      return resolve(process.env.NOTEPIN_ADMIN_PASSWORD);
    if (!process.stdin.isTTY) return resolve("");
    process.stdout.write(prompt);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let s = "";
    const onData = (c) => {
      for (const ch of c) {
        if (ch === "\r" || ch === "\n" || ch === "\u0004") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          return resolve(s);
        }
        if (ch === "\u0003") process.exit(130);
        if (ch === "\u007f") s = s.slice(0, -1);
        else s += ch;
      }
    };
    process.stdin.on("data", onData);
  });
}

(async () => {
  if (cmd === "create-admin") {
    if (!a1) throw new Error("usage: create-admin <email> [name]");
    const pw = await ask("Password (min 10 chars, not echoed): ");
    const u = await users.create({
      email: a1,
      name: a2,
      password: pw,
      role: "admin",
    });
    console.log(`Admin created: ${u.email}`);
  } else if (cmd === "reset-password") {
    const u = users.byEmail(a1 || "");
    if (!u) throw new Error("no such user");
    await users.setPassword(
      u.id,
      await ask("New password (min 10 chars, not echoed): "),
    );
    console.log("Password updated; all existing sessions were signed out.");
  } else if (cmd === "list") {
    for (const u of users.list())
      console.log(`${u.role.padEnd(6)} ${u.email}  (${u.name})`);
  } else if (cmd === "invite") {
    const admin = users.list().find((u) => u.role === "admin");
    if (!admin) throw new Error("create an admin first");
    console.log(
      `Invite code (single use): ${users.createInvite(admin.id).code}`,
    );
  } else {
    console.log(
      "usage: node scripts/admin.js create-admin <email> [name] | reset-password <email> | list | invite",
    );
    process.exit(1);
  }
})().catch((e) => {
  console.error(`Error: ${e.message}`);
  process.exit(1);
});
