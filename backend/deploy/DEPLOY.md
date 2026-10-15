# Deploy / update on the VPS (Ubuntu/Debian, Node >= 22)

## First time
```bash
id notepin 2>/dev/null || useradd --system --home /opt/notepin --shell /usr/sbin/nologin notepin
git clone <your-repo-url> /opt/notepin && cd /opt/notepin/backend
cp -n .env.example .env && nano .env        # set DEEPGRAM_API_KEY, ANTHROPIC_API_KEY, NOTEPIN_REQUIRE_AUTH=true
(cd ../dashboard && npm ci && npm run build)
mkdir -p data && chown -R notepin:notepin /opt/notepin
sudo -u notepin node scripts/admin.js create-admin you@example.com   # hidden password prompt
cp deploy/notepin.service /etc/systemd/system/ && systemctl daemon-reload && systemctl enable --now notepin
ufw allow 5000/tcp && ufw allow 8080/tcp               # also open both in the Hostinger firewall
```
Dashboard: `http://<vps-ip>:8080`.

## Update
```bash
cd /opt/notepin && git pull && (cd dashboard && npm ci && npm run build) && systemctl restart notepin
journalctl -u notepin -n 30 --no-pager
```
Deploy the backend BEFORE flashing firmware 0.5.x: the old server rejects ADPCM (bits=4).

## Devices
Run the scripts as the service user (`sudo -u notepin ...`) so the data files stay readable by the service.
```bash
sudo -u notepin node scripts/devices.js add NP-XXXXXXXX "Desk pin"   # prints the key ONCE: type it into the device Serial Monitor, never paste it in chat
sudo -u notepin node scripts/devices.js assign NP-XXXXXXXX you@example.com
sudo -u notepin node scripts/devices.js rotate NP-XXXXXXXX        # then re-enter the new key on the device: key <hex>
```
Or manage devices from the dashboard.

## HTTPS without a domain
Plain HTTP exposes the login cookie. Use Tailscale: `tailscale up && tailscale serve --bg 8080`,
then set `NOTEPIN_COOKIE_SECURE=true` and open the `https://<host>.ts.net` address. With a domain,
put Caddy in front of port 8080 instead.

## Data
`data/` holds users, devices and transcripts (JSON). Back it up; it is git-ignored.