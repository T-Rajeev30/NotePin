#pragma once

#include <Arduino.h>

// Self-contained onboarding UI.
// No CDN, external JS, external CSS, fonts or images are required.
// This is intentionally lightweight enough to live in ESP32 LittleFS.

const char SETUP_INDEX_HTML[] PROGMEM = R"HTML(
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#07080c">
<title>NotePin Setup</title>
<style>
:root{
  color-scheme:dark;
  --bg:#07080c;
  --panel:rgba(18,20,29,.78);
  --line:#292d39;
  --muted:#929aaa;
  --text:#f7f8fb;
  --accent:#9df8ce;
}
*{box-sizing:border-box}
body{
  margin:0;
  min-height:100vh;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
  color:var(--text);
  background:
    radial-gradient(circle at 50% -10%,#252a3e 0,transparent 38%),
    radial-gradient(circle at 100% 100%,#18251f 0,transparent 35%),
    var(--bg);
}
main{max-width:620px;margin:auto;padding:24px 18px 56px}
.top{display:flex;justify-content:space-between;align-items:center}
.brand{font-weight:800;letter-spacing:.04em}
.badge{
  border:1px solid var(--line);
  border-radius:999px;
  padding:7px 10px;
  font-size:11px;
  color:var(--muted);
}
.hero{padding:28px 2px 14px}
h1{font-size:39px;line-height:1.02;letter-spacing:-1.7px;margin:0 0 12px}
h2{font-size:22px;margin:0 0 8px}
p{color:var(--muted);line-height:1.55;margin:8px 0}
.card{
  margin-top:18px;
  padding:20px;
  border:1px solid var(--line);
  border-radius:28px;
  background:var(--panel);
  backdrop-filter:blur(22px);
  box-shadow:0 30px 80px rgba(0,0,0,.32);
}
.model{
  height:205px;
  display:grid;
  place-items:center;
  perspective:900px;
  overflow:hidden;
}
.pin{
  position:relative;
  width:280px;
  height:86px;
  border-radius:27px;
  transform:rotateX(54deg) rotateZ(-8deg);
  transform-style:preserve-3d;
  background:linear-gradient(145deg,#404653,#0e1117);
  border:1px solid #555b68;
  box-shadow:
    0 32px 55px rgba(0,0,0,.6),
    inset 0 1px 1px rgba(255,255,255,.2);
  animation:float 4s ease-in-out infinite;
}
.pin:before{
  content:"";
  position:absolute;
  inset:8px;
  border-radius:21px;
  border:1px solid rgba(255,255,255,.07);
}
.pin:after{
  content:"";
  position:absolute;
  width:12px;height:12px;
  left:50%;top:50%;
  transform:translate(-50%,-50%) translateZ(8px);
  border-radius:50%;
  background:var(--accent);
  box-shadow:0 0 35px var(--accent);
}
@keyframes float{
  0%,100%{transform:rotateX(54deg) rotateZ(-8deg) translateY(3px)}
  50%{transform:rotateX(54deg) rotateZ(-8deg) translateY(-12px)}
}
.steps{display:flex;gap:6px;margin:2px 0 22px}
.step{height:4px;flex:1;border-radius:9px;background:#252934}
.step.active{background:#fff}
label{display:block;color:var(--muted);font-size:12px;margin:16px 0 7px}
input,button{
  width:100%;
  border-radius:15px;
  padding:14px 15px;
  font:inherit;
}
input{
  border:1px solid #343946;
  background:#0c0f15;
  color:#fff;
  outline:none;
}
input:focus{border-color:#747c8e}
button{
  margin-top:13px;
  border:1px solid #fff;
  background:#fff;
  color:#08090d;
  font-weight:800;
  cursor:pointer;
}
button.secondary{background:#171a22;color:#fff;border-color:#343946}
button:disabled{opacity:.5;cursor:default}
.hidden{display:none!important}
.networks{display:grid;gap:7px;margin-top:10px}
.network{
  padding:12px 13px;
  border:1px solid #303541;
  border-radius:13px;
  cursor:pointer;
  display:flex;
  justify-content:space-between;
}
.network:hover{border-color:#737b8c}
.status{min-height:20px;margin-top:10px;color:var(--muted);font-size:13px}
.ok{color:#9df8ce}
.err{color:#ff7d86}
.footer{margin-top:18px;color:#626a79;font-size:11px;text-align:center}
</style>
</head>
<body>
<main>
  <div class="top">
    <div class="brand">NOTEPIN</div>
    <div class="badge">FIRST-TIME SETUP</div>
  </div>

  <div class="hero">
    <h1>Your memories start here.</h1>
    <p>Let’s get your NotePin connected. This setup page is running directly from the device.</p>
  </div>

  <div class="card">
    <div class="model">
      <div class="pin"></div>
    </div>

    <div class="steps">
      <div class="step active" id="s1"></div>
      <div class="step" id="s2"></div>
      <div class="step" id="s3"></div>
      <div class="step" id="s4"></div>
    </div>

    <section id="welcome">
      <h2>Meet your NotePin.</h2>
      <p>We’ll connect it to Wi-Fi, check the connection and prepare it for recording.</p>
      <button onclick="begin()">Get started</button>
    </section>

    <section id="wifi" class="hidden">
      <h2>Choose your Wi-Fi</h2>
      <p>NotePin needs your normal Wi-Fi after setup. Your password is stored locally on the device.</p>

      <button class="secondary" onclick="scan()">Scan networks</button>
      <div id="networks" class="networks"></div>

      <label for="ssid">Network name</label>
      <input id="ssid" autocomplete="off" placeholder="Select a network">

      <label for="password">Wi-Fi password</label>
      <input id="password" type="password" autocomplete="off" placeholder="Password">

      <button onclick="connectWifi()">Connect NotePin</button>
      <div id="wifiStatus" class="status"></div>
    </section>
  </div>

  <div class="footer">
    Device <span id="deviceId">…</span> · Firmware <span id="firmware">…</span>
  </div>
</main>

<script>
const $ = id => document.getElementById(id);

function setStep(n){
  for(let i=1;i<=4;i++) $('s'+i).classList.toggle('active',i<=n);
}

function begin(){
  $('welcome').classList.add('hidden');
  $('wifi').classList.remove('hidden');
  setStep(2);
  scan();
}

async function scan(){
  $('networks').innerHTML='<div class="status">Scanning nearby networks…</div>';
  try{
    const r=await fetch('/api/wifi/scan');
    const j=await r.json();

    if(!j.networks.length){
      $('networks').innerHTML='<div class="status">No networks found. Try scanning again.</div>';
      return;
    }

    $('networks').innerHTML=j.networks.map(n=>{
      const safe=escapeHtml(n.ssid);
      return `<div class="network" onclick='selectNetwork(${JSON.stringify(n.ssid)})'>
        <span>${safe}</span><span>${n.rssi} dBm</span>
      </div>`;
    }).join('');
  }catch(e){
    $('networks').innerHTML='<div class="status err">Could not scan Wi-Fi.</div>';
  }
}

function selectNetwork(name){
  $('ssid').value=name;
}

async function connectWifi(){
  const ssid=$('ssid').value.trim();
  const password=$('password').value;

  if(!ssid){
    $('wifiStatus').textContent='Select a Wi-Fi network first.';
    $('wifiStatus').className='status err';
    return;
  }

  $('wifiStatus').textContent='Saving credentials and connecting…';
  $('wifiStatus').className='status';

  try{
    const r=await fetch('/api/wifi/connect',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ssid,password})
    });

    const j=await r.json();

    if(!j.ok) throw new Error(j.error || 'Connection failed');

    showDone(ssid);
  }catch(e){
    $('wifiStatus').textContent=e.message;
    $('wifiStatus').className='status err';
  }
}

function showDone(ssid){
  setStep(4);
  document.body.innerHTML=`
    <main>
      <div class="card" style="margin-top:14vh;text-align:center">
        <div class="model"><div class="pin"></div></div>
        <h1>You're all set.</h1>
        <p>NotePin is restarting and joining <strong>${escapeHtml(ssid)}</strong>.<br>
        The light turns <strong style="color:#7aa7ff">blue</strong> when it's connected.
        You can close this page.</p>
        <p style="font-size:12px">Light turns <strong style="color:#ff7d86">red</strong>? The password was probably wrong. Hold the touch sensor for 5 seconds to set up again.</p>
      </div>
    </main>`;
}

function escapeHtml(value){
  return String(value).replace(/[&<>"']/g,m=>({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[m]));
}

fetch('/api/status')
  .then(r=>r.json())
  .then(j=>{
    $('deviceId').textContent=j.device_id;
    $('firmware').textContent=j.firmware;
  });
</script>
</body>
</html>
)HTML";