// Visible picture area of a <video> with object-fit: contain (without the letterbox bars).
function contentBox(el, vw, vh) {
  const r = el.getBoundingClientRect();
  if (!vw || !vh) return { left: r.left, top: r.top, width: r.width || 1, height: r.height || 1 };
  const s = Math.min(r.width / vw, r.height / vh);
  const w = vw * s;
  const h = vh * s;
  return { left: r.left + (r.width - w) / 2, top: r.top + (r.height - h) / 2, width: w, height: h };
}

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// Waits until all ICE candidates are gathered (<1 s on a LAN, no trickle needed).
function waitIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const t = setTimeout(resolve, 3000);
    pc.addEventListener('icegatheringstatechange', () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(t);
        resolve();
      }
    });
  });
}
