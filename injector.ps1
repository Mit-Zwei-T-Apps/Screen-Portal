# Reads lines from stdin and executes them as touch/pen/mouse events on this machine.
# Lines:
#   t <mode 0=screen 1=window> <left> <top> <width> <height> <cx> <cy> <cw> <ch> <hwnd>
#   p <phase> <type> <id> <nx> <ny> <pressure> <tiltX> <tiltY> <buttons> <button>
#   w <deltaY>
$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Runtime.InteropServices;

public static class Inj {
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int x; public int y; }
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int left; public int top; public int right; public int bottom; }

  [StructLayout(LayoutKind.Sequential)]
  public struct POINTER_INFO {
    public int pointerType; public uint pointerId; public uint frameId; public uint pointerFlags;
    public IntPtr sourceDevice; public IntPtr hwndTarget;
    public POINT ptPixelLocation; public POINT ptHimetricLocation;
    public POINT ptPixelLocationRaw; public POINT ptHimetricLocationRaw;
    public uint dwTime; public uint historyCount; public int InputData; public uint dwKeyStates;
    public ulong PerformanceCount; public int ButtonChangeType;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINTER_TOUCH_INFO {
    public POINTER_INFO pointerInfo; public uint touchFlags; public uint touchMask;
    public RECT rcContact; public RECT rcContactRaw; public uint orientation; public uint pressure;
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct POINTER_PEN_INFO {
    public POINTER_INFO pointerInfo; public uint penFlags; public uint penMask;
    public uint pressure; public uint rotation; public int tiltX; public int tiltY;
  }
  [StructLayout(LayoutKind.Explicit)]
  public struct POINTER_TYPE_INFO {
    [FieldOffset(0)] public int type;
    [FieldOffset(8)] public POINTER_TOUCH_INFO touchInfo;
    [FieldOffset(8)] public POINTER_PEN_INFO penInfo;
  }

  [DllImport("user32.dll")] static extern IntPtr CreateSyntheticPointerDevice(int pointerType, uint maxCount, int mode);
  [DllImport("user32.dll", SetLastError = true)] static extern bool InjectSyntheticPointerInput(IntPtr device, [In] POINTER_TYPE_INFO[] info, uint count);
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  [DllImport("user32.dll")] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll")] static extern void mouse_event(uint flags, int dx, int dy, int data, UIntPtr extra);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);

  const uint NEW = 0x1, INRANGE = 0x2, INCONTACT = 0x4, FIRSTBUTTON = 0x10, PRIMARY = 0x2000, CANCELED = 0x8000,
             DOWN = 0x10000, UPDATE = 0x20000, UP = 0x40000;

  static IntPtr touchDev = IntPtr.Zero, penDev = IntPtr.Zero;
  static int mode = 0, rl = 0, rt = 0, rw = 1920, rh = 1080;
  static double cx = 0, cy = 0, cw = 1, ch = 1;
  static IntPtr hwnd = IntPtr.Zero;

  class Touch { public int x; public int y; public double pressure; }
  static Dictionary<uint, Touch> touches = new Dictionary<uint, Touch>();
  static uint primaryId = 0;
  static bool penInRange = false;

  public static void Init() {
    try { SetProcessDpiAwarenessContext((IntPtr)(-4)); } catch (Exception) { }
  }

  static double D(string s) { return double.Parse(s, CultureInfo.InvariantCulture); }

  static void Map(double nx, double ny, out int x, out int y) {
    int l = rl, t = rt, w = rw, h = rh;
    if (mode == 1) {
      RECT r;
      if (GetWindowRect(hwnd, out r)) { l = r.left; t = r.top; w = r.right - r.left; h = r.bottom - r.top; }
    }
    x = l + (int)Math.Round((cx + nx * cw) * (w - 1));
    y = t + (int)Math.Round((cy + ny * ch) * (h - 1));
  }

  public static void Handle(string line) {
    string[] f = line.Split(' ');
    if (f.Length == 0) return;
    if (f[0] == "t" && f.Length >= 11) {
      mode = int.Parse(f[1]);
      rl = int.Parse(f[2]); rt = int.Parse(f[3]); rw = Math.Max(1, int.Parse(f[4])); rh = Math.Max(1, int.Parse(f[5]));
      cx = D(f[6]); cy = D(f[7]); cw = D(f[8]); ch = D(f[9]);
      hwnd = new IntPtr(long.Parse(f[10]));
    } else if (f[0] == "w" && f.Length >= 2) {
      mouse_event(0x0800, 0, 0, (int)(-D(f[1]) * 1.2), UIntPtr.Zero);
    } else if (f[0] == "p" && f.Length >= 11) {
      Pointer(f[1], f[2], uint.Parse(f[3]), D(f[4]), D(f[5]), D(f[6]), int.Parse(f[7]), int.Parse(f[8]), int.Parse(f[9]), int.Parse(f[10]));
    }
  }

  static void Pointer(string phase, string type, uint id, double nx, double ny, double pressure, int tx, int ty, int buttons, int button) {
    int x, y;
    Map(nx, ny, out x, out y);
    if (type == "mouse") {
      SetCursorPos(x, y);
      if (phase == "down") mouse_event(button == 2 ? 0x8u : (button == 1 ? 0x20u : 0x2u), 0, 0, 0, UIntPtr.Zero);
      else if (phase == "up") mouse_event(button == 2 ? 0x10u : (button == 1 ? 0x40u : 0x4u), 0, 0, 0, UIntPtr.Zero);
    } else if (type == "touch") {
      DoTouch(phase, id, x, y, pressure);
    } else if (type == "pen") {
      DoPen(phase, x, y, pressure, tx, ty, buttons);
    }
  }

  // ---- Touch (multi-finger gestures work) ----
  static POINTER_TYPE_INFO MakeTouch(uint id, int x, int y, uint flags, double pressure) {
    POINTER_TYPE_INFO t = new POINTER_TYPE_INFO();
    t.type = 2;
    POINTER_TOUCH_INFO ti = new POINTER_TOUCH_INFO();
    ti.pointerInfo.pointerType = 2;
    ti.pointerInfo.pointerId = id;
    ti.pointerInfo.pointerFlags = flags | (id == primaryId ? PRIMARY : 0u);
    ti.pointerInfo.ptPixelLocation.x = x;
    ti.pointerInfo.ptPixelLocation.y = y;
    ti.touchFlags = 0;
    ti.touchMask = 1 | 2 | 4; // CONTACTAREA | ORIENTATION | PRESSURE
    ti.rcContact.left = x - 2; ti.rcContact.right = x + 2; ti.rcContact.top = y - 2; ti.rcContact.bottom = y + 2;
    ti.orientation = 90;
    ti.pressure = (uint)Math.Max(1, Math.Min(1024, pressure * 1024));
    t.touchInfo = ti;
    return t;
  }

  static void DoTouch(string phase, uint id, int x, int y, double pressure) {
    if (touchDev == IntPtr.Zero) touchDev = CreateSyntheticPointerDevice(2, 10, 1);
    if (touchDev == IntPtr.Zero) return;
    if (pressure <= 0) pressure = 0.5;
    uint changed;
    if (phase == "down") {
      if (touches.Count == 0) primaryId = id;
      Touch tn = new Touch(); tn.x = x; tn.y = y; tn.pressure = pressure;
      touches[id] = tn;
      changed = DOWN | INRANGE | INCONTACT;
    } else if (phase == "move") {
      if (!touches.ContainsKey(id)) return;
      touches[id].x = x; touches[id].y = y; touches[id].pressure = pressure;
      changed = UPDATE | INRANGE | INCONTACT;
    } else if (phase == "up" || phase == "cancel") {
      if (!touches.ContainsKey(id)) return;
      touches[id].x = x; touches[id].y = y;
      changed = UP | (phase == "cancel" ? CANCELED : 0u);
    } else {
      return;
    }

    List<POINTER_TYPE_INFO> frame = new List<POINTER_TYPE_INFO>();
    foreach (KeyValuePair<uint, Touch> kv in touches) {
      uint fl = (kv.Key == id) ? changed : (UPDATE | INRANGE | INCONTACT);
      frame.Add(MakeTouch(kv.Key, kv.Value.x, kv.Value.y, fl, kv.Value.pressure));
    }
    InjectSyntheticPointerInput(touchDev, frame.ToArray(), (uint)frame.Count);
    if (phase == "up" || phase == "cancel") touches.Remove(id);
  }

  // ---- Pen (pressure, tilt, eraser, hover) ----
  static void DoPen(string phase, int x, int y, double pressure, int tx, int ty, int buttons) {
    if (penDev == IntPtr.Zero) penDev = CreateSyntheticPointerDevice(3, 1, 1);
    if (penDev == IntPtr.Zero) return;

    uint flags;
    bool contact = false;
    if (phase == "down") {
      flags = DOWN | INRANGE | INCONTACT | FIRSTBUTTON; contact = true;
    } else if (phase == "move") {
      flags = UPDATE | INRANGE | INCONTACT | FIRSTBUTTON; contact = true;
    } else if (phase == "up" || phase == "cancel") {
      flags = UP | (phase == "cancel" ? CANCELED : 0u);
    } else if (phase == "hover") {
      flags = UPDATE | INRANGE;
    } else if (phase == "leave") {
      flags = UPDATE;
    } else {
      return;
    }
    if (!penInRange && (flags & INRANGE) != 0) flags |= NEW;

    POINTER_TYPE_INFO t = new POINTER_TYPE_INFO();
    t.type = 3;
    POINTER_PEN_INFO pi = new POINTER_PEN_INFO();
    pi.pointerInfo.pointerType = 3;
    pi.pointerInfo.pointerId = 1;
    pi.pointerInfo.pointerFlags = flags;
    pi.pointerInfo.ptPixelLocation.x = x;
    pi.pointerInfo.ptPixelLocation.y = y;
    pi.penMask = 1 | 2 | 4 | 8; // PRESSURE | ROTATION | TILT_X | TILT_Y
    pi.pressure = contact ? (uint)Math.Max(1, Math.Min(1024, pressure * 1024)) : 0u;
    pi.rotation = 0;
    pi.tiltX = tx;
    pi.tiltY = ty;
    uint pf = 0;
    if ((buttons & 2) != 0) pf |= 0x1;          // barrel button
    if ((buttons & 32) != 0) pf |= 0x2 | 0x4;   // eraser (inverted)
    pi.penFlags = pf;
    t.penInfo = pi;

    InjectSyntheticPointerInput(penDev, new POINTER_TYPE_INFO[] { t }, 1);
    penInRange = (phase != "leave");
  }
}
'@

[Inj]::Init()
[Console]::Out.WriteLine('injector bereit')
$in = [Console]::In
while ($true) {
  $l = $in.ReadLine()
  if ($l -eq $null) { break }
  try { [Inj]::Handle($l) } catch { [Console]::Error.WriteLine($_.Exception.Message) }
}
