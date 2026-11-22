const $ = (id) => document.getElementById(id);
const v = $('v');
const view = $('view');
const tbar = $('tbar');

let ws = null;
let pc = null;
let dc = null;
let remoteCtl = true; // does the sender allow control?

$('ip').value = localStorage.getItem('bp_ip') || '';
$('code').focus();

function status(t) { $('status').textContent = t; }

$('go').onclick = connect;
$('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });

function connect() {
  const ip = $('ip').value.trim();
  const code = $('code').value.trim();
  if (!ip || code.length !== 6) return status('Please enter the IP and the 6-digit code.');
  localStorage.setItem('bp_ip', ip);
  status('Connecting …');
  disconnect(true);
  try { ws = new WebSocket(`ws://${ip}:47800`); } catch (e) { return status('Invalid address.'); }
  ws.onopen = () => ws.send(JSON.stringify({ t: 'hello', code }));
  ws.onerror = () => status('Sender not reachable. Same network? Firewall allowed on the sender?');
  ws.onclose = () => { if (view.style.display === 'block') showConnect('Connection closed.'); };
  ws.onmessage = async (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'denied') return status('Wrong code.');
    if (m.t === 'busy') return status('A receiver is already connected.');
    if (m.t === 'welcome') return status('Code accepted – waiting for picture …');
    if (m.t === 'offer') await onOffer(m.sdp);
  };
}

async function onOffer(sdp) {
  pc = new RTCPeerConnection({ iceServers: [] });
  pc.ontrack = (e) => {
    v.srcObject = e.streams[0] || new MediaStream([e.track]);
    try { e.receiver.playoutDelayHint = 0; } catch (_) {}
    try { e.receiver.jitterBufferTarget = 0; } catch (_) {}
    showView();
  };
  pc.ondatachannel = (e) => {
    dc = e.channel;
    dc.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.k === 'ctl') { remoteCtl = !!m.on; updateState(); }
      } catch (_) {}
    };
  };
  pc.onconnectionstatechange = () => {
    if (['failed', 'closed'].includes(pc.connectionState)) showConnect('Connection lost.');
  };
  await pc.setRemoteDescription(sdp);
  await pc.setLocalDescription(await pc.createAnswer());
  await waitIce(pc);
  ws.send(JSON.stringify({ t: 'answer', sdp: pc.localDescription.toJSON() }));
}

function showView() {
  $('connect').style.display = 'none';
  view.style.display = 'block';
  tbar.style.display = 'flex';
  updateState();
  bumpBar();
}

function showConnect(msg) {
  disconnect(true);
  view.style.display = 'none';
  tbar.style.display = 'none';
  $('connect').style.display = 'grid';
  status(msg || '');
}

function disconnect(silent) {
  try { if (dc) dc.close(); } catch (_) {}
  try { if (pc) pc.close(); } catch (_) {}
  try { if (ws) { ws.onclose = null; ws.close(); } } catch (_) {}
  pc = dc = ws = null;
  v.srcObject = null;
  if (document.fullscreenElement) document.exitFullscreen();
}

$('bye').onclick = () => showConnect('Disconnected.');
$('fs').onclick = () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen();
};
$('ctl').onchange = updateState;

function ctlOn() { return $('ctl').checked && remoteCtl; }
function updateState() {
  $('state').textContent = !remoteCtl ? 'Connected – control disabled by sender' : 'Connected';
  view.style.cursor = ctlOn() ? 'crosshair' : 'default';
}

// The toolbar fades out; touching the top edge brings it back.
let barTimer = null;
function bumpBar() {
  tbar.classList.remove('hide');
  clearTimeout(barTimer);
  barTimer = setTimeout(() => tbar.classList.add('hide'), 3500);
}
window.addEventListener('mousemove', (e) => { if (e.clientY < 70) bumpBar(); });
window.addEventListener('pointerdown', (e) => { if (e.clientY < 70) bumpBar(); });

// ---------- Send input (touch, pen, mouse) to the sender ----------
function norm(e) {
  const b = contentBox(v, v.videoWidth, v.videoHeight);
  return [clamp((e.clientX - b.left) / b.width), clamp((e.clientY - b.top) / b.height)];
}

function sendMsg(m) {
  if (ctlOn() && dc && dc.readyState === 'open') dc.send(JSON.stringify(m));
}

function pm(phase, e) {
  const [x, y] = norm(e);
  sendMsg({
    k: 'p', ph: phase, pt: e.pointerType, id: e.pointerId, x, y,
    pr: e.pressure, tx: Math.round(e.tiltX || 0), ty: Math.round(e.tiltY || 0),
    bt: e.buttons, b: e.button,
  });
}

view.addEventListener('pointerdown', (e) => {
  if (e.clientY < 70 && tbar.style.display !== 'none') bumpBar();
  view.setPointerCapture(e.pointerId);
  pm('down', e);
  e.preventDefault();
});

view.addEventListener('pointermove', (e) => {
  const list = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const c of list.length ? list : [e]) {
    const inContact = (c.buttons & 33) !== 0; // 1 = tip/left button, 32 = eraser
    if (c.pointerType === 'pen' && !inContact) pm('hover', c);
    else pm('move', c);
  }
  e.preventDefault();
});

view.addEventListener('pointerup', (e) => { pm('up', e); e.preventDefault(); });
view.addEventListener('pointercancel', (e) => pm('cancel', e));
view.addEventListener('pointerleave', (e) => { if (e.pointerType === 'pen') pm('leave', e); });
view.addEventListener('contextmenu', (e) => e.preventDefault());
view.addEventListener('wheel', (e) => { sendMsg({ k: 'w', dy: e.deltaY }); e.preventDefault(); }, { passive: false });
