const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session, Menu } = require('electron');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');
const { WebSocketServer } = require('ws');

// Do not throttle hidden windows, otherwise the stream stutters.
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows');
// Real LAN IPs in WebRTC candidates (instead of mDNS names the receiver may not resolve).
app.commandLine.appendSwitch('disable-features', 'WebRtcHideLocalIpsWithMdns,CalculateNativeWinOcclusion');

const PORT = 47800;
let win = null;
let wss = null;
let client = null;
let code = '';
let fails = 0;
let injector = null;
let chosenSourceId = null;

function createWindow() {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1180,
    height: 780,
    backgroundColor: '#0e1116',
    title: 'Screen Portal',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  // The app window itself is excluded from capture (no infinite mirror).
  win.setContentProtection(true);
  win.loadFile('index.html');
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function lanIps() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const n of list || []) {
      if (n.family === 'IPv4' && !n.internal) out.push(n.address);
    }
  }
  return out;
}

// ---------- Source selection ----------
ipcMain.handle('sources:list', async () => {
  const src = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 480, height: 300 },
    fetchWindowIcons: false,
  });
  return src.map((s) => ({
    id: s.id,
    name: s.name,
    display_id: s.display_id,
    thumb: s.thumbnail.toDataURL(),
  }));
});

ipcMain.handle('source:choose', (_e, id) => {
  chosenSourceId = String(id);
  return true;
});

// getDisplayMedia() in the renderer returns exactly the previously chosen source, no system dialog.
function installDisplayHandler() {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
        const s = sources.find((x) => x.id === chosenSourceId);
        if (!s) return callback({});
        callback({ video: s });
      } catch (e) {
        callback({});
      }
    },
    { useSystemPicker: false }
  );
}

// ---------- Input injector (Windows) ----------
function injectorPath() {
  return path.join(__dirname, 'injector.ps1').replace('app.asar', 'app.asar.unpacked');
}

function startInjector() {
  if (injector || process.platform !== 'win32') return process.platform === 'win32';
  try {
    injector = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', injectorPath()],
      { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
    );
    injector.stderr.on('data', (d) => send('injector:log', String(d)));
    injector.stdout.on('data', (d) => send('injector:log', String(d)));
    injector.on('exit', () => { injector = null; });
    injector.on('error', (e) => { send('injector:log', 'Error: ' + e.message); injector = null; });
    injector.stdin.on('error', () => {});
    return true;
  } catch (e) {
    injector = null;
    return false;
  }
}

function stopInjector() {
  if (injector) {
    try { injector.stdin.end(); injector.kill(); } catch (_) {}
    injector = null;
  }
}

function write(line) {
  if (injector && injector.stdin.writable) injector.stdin.write(line + '\n');
}

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
const clamp01 = (v) => Math.min(1, Math.max(0, v));

ipcMain.on('target:set', (_e, t) => {
  if (!injector || !t) return;
  const c = t.crop || { x: 0, y: 0, w: 1, h: 1 };
  const crop = [clamp01(num(c.x)), clamp01(num(c.y)), clamp01(num(c.w, 1)), clamp01(num(c.h, 1))]
    .map((n) => n.toFixed(6))
    .join(' ');
  if (t.mode === 'window') {
    const hwnd = parseInt(String(t.sourceId).split(':')[1], 10) || 0;
    write(`t 1 0 0 0 0 ${crop} ${hwnd}`);
  } else {
    const displays = screen.getAllDisplays();
    let d = displays.find((x) => String(x.id) === String(t.displayId));
    if (!d) d = screen.getPrimaryDisplay();
    const r = screen.dipToScreenRect(null, d.bounds); // physical pixels
    write(`t 0 ${r.x} ${r.y} ${r.width} ${r.height} ${crop} 0`);
  }
});

ipcMain.on('input', (_e, m) => {
  if (!injector || !m) return;
  if (m.k === 'w') return write(`w ${num(m.dy).toFixed(1)}`);
  if (m.k !== 'p') return;
  const ph = ['down', 'move', 'up', 'hover', 'leave', 'cancel'].includes(m.ph) ? m.ph : null;
  const pt = ['mouse', 'touch', 'pen'].includes(m.pt) ? m.pt : null;
  if (!ph || !pt) return;
  write(
    [
      'p', ph, pt,
      Math.abs(Math.trunc(num(m.id))) % 100000,
      clamp01(num(m.x)).toFixed(5),
      clamp01(num(m.y)).toFixed(5),
      clamp01(num(m.pr)).toFixed(3),
      Math.max(-90, Math.min(90, Math.trunc(num(m.tx)))),
      Math.max(-90, Math.min(90, Math.trunc(num(m.ty)))),
      Math.trunc(num(m.bt)) & 0xffff,
      Math.trunc(num(m.b)) & 0xff,
    ].join(' ')
  );
});

// ---------- Sharing (signaling via WebSocket on the LAN) ----------
function newCode() {
  code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  fails = 0;
  return code;
}

function stopShare() {
  try { if (client) client.close(); } catch (_) {}
  client = null;
  if (wss) { try { wss.close(); } catch (_) {} wss = null; }
  stopInjector();
}

ipcMain.handle('share:start', () => {
  stopShare();
  newCode();
  const inj = startInjector();
  wss = new WebSocketServer({ port: PORT });
  wss.on('error', (e) => send('share:error', e.code === 'EADDRINUSE' ? 'Port ' + PORT + ' is already in use (is the app running twice?)' : e.message));
  wss.on('connection', (ws) => {
    let authed = false;
    ws.on('message', (raw) => {
      let m;
      try { m = JSON.parse(String(raw)); } catch (_) { return; }
      if (!authed) {
        if (m.t === 'hello' && m.code === code) {
          if (client && client.readyState === 1) {
            ws.send(JSON.stringify({ t: 'busy' }));
            return ws.close();
          }
          authed = true;
          client = ws;
          ws.send(JSON.stringify({ t: 'welcome' }));
          send('peer:joined');
        } else {
          ws.send(JSON.stringify({ t: 'denied' }));
          ws.close();
          if (++fails >= 5) {
            newCode();
            send('share:code', code);
          }
        }
        return;
      }
      send('sig:in', m);
    });
    ws.on('close', () => {
      if (client === ws) {
        client = null;
        send('peer:left');
      }
    });
  });
  return { code, port: PORT, ips: lanIps(), injector: inj };
});

ipcMain.on('sig:out', (_e, m) => {
  if (client && client.readyState === 1) client.send(JSON.stringify(m));
});

ipcMain.on('share:stop', stopShare);

app.whenReady().then(() => {
  installDisplayHandler();
  createWindow();
});

app.on('window-all-closed', () => {
  stopShare();
  app.quit();
});
