// Minimal mDNS responder: answers plain A-record queries for
// "notepin-server.local" with this machine's LAN IP.
//
// This is intentionally NOT full DNS-SD service discovery (no service
// types, no TXT records) - the ESP32 side just needs a hostname -> IP
// lookup via ESPmDNS's MDNS.queryHost(), which performs exactly this kind
// of plain A-record query. Keeping this minimal keeps both ends simple.

const mdns = require("multicast-dns")();
const os = require("os");

const HOSTNAME = "notepin-server.local";

function getLocalIPv4() {
  const nets = os.networkInterfaces();
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        return net.address;
      }
    }
  }
  return null;
}

function startMdnsResponder() {
  const ip = getLocalIPv4();
  if (!ip) {
    console.error(
      "[mdns] no non-internal IPv4 address found - responder not started",
    );
    return null;
  }

  mdns.on("query", (query) => {
    const asksForUs = query.questions.some(
      (q) => q.type === "A" && q.name.toLowerCase() === HOSTNAME,
    );
    if (!asksForUs) return;

    mdns.respond({
      answers: [{ name: HOSTNAME, type: "A", ttl: 120, data: ip }],
    });
  });

  console.log(`[mdns] responding to "${HOSTNAME}" queries with ${ip}`);
  return mdns;
}

module.exports = { startMdnsResponder, HOSTNAME };
function getLocalIPv4() {
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === "IPv4" && !net.internal) {
        candidates.push({ name, address: net.address });
      }
    }
  }

  // Prefer the adapter literally named "Wi-Fi" - that's what the ESP32
  // actually connects through. This sidesteps VirtualBox/VMware host-only
  // adapters, Tailscale, Docker bridges, etc. all being on the same PC.
  const wifi = candidates.find((c) => /wi-?fi/i.test(c.name));
  if (wifi) return wifi.address;

  // Fallback for machines where the adapter isn't named "Wi-Fi": at least
  // avoid Tailscale/CGNAT addresses, which are never reachable from a
  // plain Wi-Fi device.
  const lan = candidates.find((c) => !isCGNATRange(c.address));
  if (lan) return lan.address;

  return candidates[0] ? candidates[0].address : null;
}
