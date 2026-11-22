# Screen Portal

Share **only what you choose** – a whole screen, a single window or a region you draw – from one Windows machine (the *Sender*) to another (the *Receiver*). On the Receiver, **touch, pen (pressure, tilt, eraser, hover) and mouse** work: the input is executed on the Sender.

## Run

On **both** machines (Windows, Node.js installed):

```
npm install
npm start
```

- **Sender**: pick a source on the left, drag on the preview to share just a region (click = whole source), press "Start sharing". IP and a 6-digit code appear at the bottom.
- **Receiver**: enter IP + code and connect. "Fullscreen" is in the bar at the top (it fades out; touch the top edge to bring it back).

Source and region can be changed **live** without reconnecting.

On first start the Windows firewall asks: allow **private networks** (on the Sender for port 47800 + WebRTC, on the Receiver for WebRTC). Both devices must be on the same network.

## Build a single .exe

```
npm run dist
```

The portable .exe ends up in `dist/`. The same file works as Sender and Receiver. Pushing a tag like `v1.0.0` builds it automatically on GitHub and attaches it to a release.

## Use the Receiver as a real second monitor

Windows only knows an extra monitor if a driver provides one. Install a **virtual display driver** on the Sender (for example "Virtual-Display-Driver" by VirtualDrivers on GitHub), then in Windows Display settings choose "Extend desktop". The virtual monitor shows up in the Sender as a normal screen source – select it, done.

## Limits

- One share at a time (one screen, window or region).
- Apps running **as administrator** can only be controlled if Screen Portal is started as administrator too (Windows rule).
- For **window** shares the touch position is mapped to the window rectangle; the drop-shadow border can cause an offset of a few pixels. For precise drawing choose a screen or a region.
- The Sender's own window is excluded from capture (no infinite mirror).
- LAN only, protected by the code (a new code is generated after 5 wrong attempts). No internet access.
- Untick "Allow touch/pen control" on the Sender to make the Receiver view-only.

## License & credits

MIT License. By **Matteo Mit Zwei T**.
