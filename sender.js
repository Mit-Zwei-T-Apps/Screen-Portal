const $ = (id) => document.getElementById(id);
const pv = $('pv');
const stage = $('stage');
const selBox = $('sel');

const MAX_EDGE = 2560; // longest edge of the sent picture
let current = null; // chosen source
let stream = null;
let crop = { x: 0, y: 0, w: 1, h: 1 };
let timer = null;

// Output canvas: holds only the chosen region and is sent via WebRTC.
const out = document.createElement('canvas');
out.width = 16; out.height = 16;
const octx = out.getContext('2d', { alpha: false });

let pc = null;
let dc = null;
let sharing = false;
let rtpSender = null;

// ---------- Source list ----------
async function loadSources() {
  const list = await api.listSources();
  const el = $('list');
  el.innerHTML = '';
  for (const s of list) {
    const d = document.createElement('div');
    d.className = 'src' + (current && current.id === s.id ? ' sel' : '');
    const label = s.id.startsWith('screen') ? '🖥️ ' + s.name : '🪟 ' + s.name;
    d.innerHTML = `<img src="${s.thumb}"><span></span>`;
    d.querySelector('span').textContent = label;
    d.onclick = () => selectSource(s);
    el.appendChild(d);
  }
}

async function selectSource(s) {
  current = s;
  await api.chooseSource(s.id);
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = await navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: 60 },
    audio: false,
  });
  pv.srcObject = stream;
  await pv.play();
  crop = { x: 0, y: 0, w: 1, h: 1 };
  renderSel();
  applyTarget();
  startDrawing();
  loadSources();
}

function applyTarget() {
  if (!current) return;
  api.setTarget({
    mode: current.id.startsWith('window') ? 'window' : 'screen',
    sourceId: current.id,
    displayId: current.display_id,
    crop,
  });
  const full = crop.w > 0.999 && crop.h > 0.999;
  $('cropinfo').textContent = full ? 'Sharing: whole source' : `Sharing: region ${Math.round(crop.w * 100)}% × ${Math.round(crop.h * 100)}%`;
}

// ---------- Drawing the region ----------
function startDrawing() {
  if (timer) clearInterval(timer);
  const fps = parseInt($('fps').value, 10) || 60;
  timer = setInterval(draw, 1000 / fps);
}

function draw() {
  const sw = pv.videoWidth, sh = pv.videoHeight;
  if (!sw || !sh) return;
  const cx = crop.x * sw, cy = crop.y * sh;
  const cw = Math.max(16, crop.w * sw), ch = Math.max(16, crop.h * sh);
  const scale = Math.min(1, MAX_EDGE / Math.max(cw, ch));
  const ow = Math.max(16, Math.round((cw * scale) / 2) * 2);
  const oh = Math.max(16, Math.round((ch * scale) / 2) * 2);
  if (out.width !== ow || out.height !== oh) { out.width = ow; out.height = oh; }
  octx.drawImage(pv, cx, cy, cw, ch, 0, 0, ow, oh);
}

$('fps').onchange = () => { startDrawing(); tuneSender(); };

// ---------- Choose region by dragging ----------
let drag = null;
function normPoint(e) {
  const b = contentBox(pv, pv.videoWidth, pv.videoHeight);
  return { x: clamp((e.clientX - b.left) / b.width), y: clamp((e.clientY - b.top) / b.height) };
}

stage.addEventListener('pointerdown', (e) => {
  if (!pv.videoWidth) return;
  stage.setPointerCapture(e.pointerId);
  drag = { a: normPoint(e), b: normPoint(e) };
});
stage.addEventListener('pointermove', (e) => {
  if (!drag) return;
  drag.b = normPoint(e);
  const r = dragRect();
  renderSel(r);
});
stage.addEventListener('pointerup', () => {
  if (!drag) return;
  const r = dragRect();
  drag = null;
  crop = r.w < 0.02 || r.h < 0.02 ? { x: 0, y: 0, w: 1, h: 1 } : r;
  renderSel();
  applyTarget();
});

function dragRect() {
  const x = Math.min(drag.a.x, drag.b.x), y = Math.min(drag.a.y, drag.b.y);
  return { x, y, w: Math.abs(drag.a.x - drag.b.x), h: Math.abs(drag.a.y - drag.b.y) };
}

function renderSel(r = crop) {
  const full = r.w > 0.999 && r.h > 0.999;
  if (full || !pv.videoWidth) { selBox.style.display = 'none'; return; }
  const b = contentBox(pv, pv.videoWidth, pv.videoHeight);
  const s = stage.getBoundingClientRect();
  selBox.style.display = 'block';
  selBox.style.left = b.left - s.left + r.x * b.width + 'px';
  selBox.style.top = b.top - s.top + r.y * b.height + 'px';
  selBox.style.width = r.w * b.width + 'px';
  selBox.style.height = r.h * b.height + 'px';
}
window.addEventListener('resize', () => renderSel());
pv.addEventListener('loadedmetadata', () => renderSel());

$('reset').onclick = () => { crop = { x: 0, y: 0, w: 1, h: 1 }; renderSel(); applyTarget(); };
$('refresh').onclick = loadSources;

// ---------- Sharing / WebRTC ----------
function setInfo(text, on) {
  $('infotext').innerHTML = text;
  $('dot').className = 'dot' + (on ? ' on' : '');
}

$('share').onclick = async () => {
  if (!sharing) {
    const r = await api.startShare();
    sharing = true;
    $('share').textContent = 'Stop sharing';
    $('share').classList.add('stop');
    showInfo(r);
  } else {
    stopSharing();
  }
};

let lastInfo = null;
function showInfo(r) {
  lastInfo = r;
  const ips = r.ips.length ? r.ips.join(' or ') : '(no network address found)';
  const warn = r.injector ? '' : ' · <span style="color:var(--bad)">Touch/pen control works on Windows only</span>';
  setInfo(`Waiting for receiver … IP: <b>${ips}</b> · Code: <b>${r.code}</b>${warn}`, false);
}

function stopSharing() {
  sharing = false;
  api.stopShare();
  if (pc) { pc.close(); pc = null; }
  $('share').textContent = '3. Start sharing';
  $('share').classList.remove('stop');
  setInfo('Not sharing yet', false);
}

api.onShareError((m) => { setInfo('Error: ' + m, false); });
api.onShareCode((c) => { if (lastInfo) { lastInfo.code = c; showInfo(lastInfo); } });
api.onInjectorLog((t) => console.log('[injector]', t));

api.onPeerJoined(async () => {
  setInfo('Receiver is connecting …', false);
  if (pc) pc.close();
  pc = new RTCPeerConnection({ iceServers: [] });
  const track = out.captureStream().getVideoTracks()[0];
  track.contentHint = 'detail';
  rtpSender = pc.addTrack(track, new MediaStream([track]));

  dc = pc.createDataChannel('input', { ordered: true });
  dc.onopen = () => sendCtlState();
  dc.onmessage = (e) => handleInput(e.data);

  pc.onconnectionstatechange = () => {
    if (pc && pc.connectionState === 'connected') setInfo('<b>Connected</b> – receiver sees your share', true);
    if (pc && ['failed', 'disconnected'].includes(pc.connectionState)) setInfo('Connection lost – reconnect the receiver', false);
  };

  await pc.setLocalDescription(await pc.createOffer());
  await waitIce(pc);
  api.sigOut({ t: 'offer', sdp: pc.localDescription.toJSON() });
});

api.onSigIn(async (m) => {
  if (m.t === 'answer' && pc) {
    await pc.setRemoteDescription(m.sdp);
    tuneSender();
  }
});

api.onPeerLeft(() => {
  if (pc) { pc.close(); pc = null; }
  if (sharing && lastInfo) showInfo(lastInfo);
});

async function tuneSender() {
  if (!rtpSender) return;
  try {
    const p = rtpSender.getParameters();
    if (!p.encodings || !p.encodings.length) p.encodings = [{}];
    p.encodings[0].maxBitrate = 30e6;
    p.encodings[0].maxFramerate = parseInt($('fps').value, 10) || 60;
    p.degradationPreference = 'maintain-resolution';
    await rtpSender.setParameters(p);
  } catch (_) {}
}

// ---------- Control ----------
function sendCtlState() {
  if (dc && dc.readyState === 'open') dc.send(JSON.stringify({ k: 'ctl', on: $('ctl').checked }));
}
$('ctl').onchange = sendCtlState;

function handleInput(data) {
  if (!$('ctl').checked) return;
  let m;
  try { m = JSON.parse(data); } catch (_) { return; }
  if (m.k === 'p' || m.k === 'w') api.sendInput(m);
}

loadSources();
