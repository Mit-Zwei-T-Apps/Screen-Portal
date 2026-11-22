const { contextBridge, ipcRenderer } = require('electron');

const on = (ch, cb) => ipcRenderer.on(ch, (_e, p) => cb(p));

contextBridge.exposeInMainWorld('api', {
  listSources: () => ipcRenderer.invoke('sources:list'),
  chooseSource: (id) => ipcRenderer.invoke('source:choose', id),
  startShare: () => ipcRenderer.invoke('share:start'),
  stopShare: () => ipcRenderer.send('share:stop'),
  sigOut: (m) => ipcRenderer.send('sig:out', m),
  setTarget: (t) => ipcRenderer.send('target:set', t),
  sendInput: (m) => ipcRenderer.send('input', m),
  onSigIn: (cb) => on('sig:in', cb),
  onPeerJoined: (cb) => on('peer:joined', cb),
  onPeerLeft: (cb) => on('peer:left', cb),
  onShareError: (cb) => on('share:error', cb),
  onShareCode: (cb) => on('share:code', cb),
  onInjectorLog: (cb) => on('injector:log', cb),
});
