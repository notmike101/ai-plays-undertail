// Native instrumentation bridge: observes the game's visible output and delivers
// ordinary keyboard input via OS APIs. No game memory or file access.
// Line protocol on stdin; one JSON line per command on stdout.
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;

class Bridge
{
    const uint INPUT_KEYBOARD = 1;
    const uint KEYUP = 0x0002;
    const uint SCAN = 0x0008;
    const int PW_RENDERFULLCONTENT = 2;

    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public InputU u; }
    [StructLayout(LayoutKind.Explicit)] struct InputU { [FieldOffset(0)] public KEYBDINPUT k; [FieldOffset(0)] public MOUSEINPUT m; }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int dx; public int dy; public uint mouseData; public uint flags; public uint time; public IntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct RECT { public int l, t, r, b; }
    [StructLayout(LayoutKind.Sequential)] struct POINT { public int x, y; }

    [DllImport("kernel32.dll")] static extern uint GetCurrentThreadId();
    [DllImport("user32.dll")] static extern bool AttachThreadInput(uint a, uint b, bool attach);
    [DllImport("user32.dll")] static extern bool SetActiveWindow(IntPtr h);

    // Windows refuses SetForegroundWindow from a background process; borrowing the
    // foreground thread's input queue is the standard way in. Returns the thread id
    // that was attached, for Detach().
    static uint AttachTo(IntPtr h)
    {
        uint pid;
        uint fgTid = GetWindowThreadProcessId(GetForegroundWindow(), out pid);
        uint tid = GetCurrentThreadId();
        if (fgTid != 0 && fgTid != tid) AttachThreadInput(fgTid, tid, true);
        SetActiveWindow(h);
        return fgTid;
    }
    static void Detach(uint fgTid)
    {
        uint tid = GetCurrentThreadId();
        if (fgTid != 0 && fgTid != tid) AttachThreadInput(fgTid, tid, false);
    }
    static bool IsWhite(int p) { int r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255; return r > 180 && g > 180 && b > 180; }
    static bool IsRed(int p) { int r = (p >> 16) & 255, g = (p >> 8) & 255, b = p & 255; return r > 140 && g < 110 && b < 110; }
    static bool ThinWhite(int[] px, int w, int hh, int x, int y)
    {
        if (x < 0 || x >= w) return false;
        int t = 0;
        for (int k = 0; k < 10 && y + k < hh; k++) if (IsWhite(px[(y + k) * w + x])) t++; else break;
        return t <= 5;
    }
    static bool RowAll(int[] px, int w, int y, int x0, int x1)
    {
        int hit = 0, n = 0;
        for (int x = x0; x <= x1; x++) { n++; if (IsWhite(px[y * w + x])) hit++; }
        return n > 0 && hit >= (n * 95) / 100;
    }
    static bool ColFrac(int[] px, int w, int x, int y0, int y1)
    {
        int hit = 0, n = 0;
        for (int y = y0; y <= y1; y++) { n++; if (IsWhite(px[y * w + x])) hit++; }
        return n > 0 && hit >= (n * 55) / 100;
    }
    // the battle box is a thin outline with a dark inside and vertical side walls;
    // speech bubbles are filled, so an all-white interior rejects them
    static int FindBottom(int[] px, int w, int hh, int y, int x0, int x1)
    {
        for (int yy = y + 60; yy <= y + 420 && yy < hh - 1; yy++)
        {
            if (!RowAll(px, w, yy, x0, x1)) continue;
            if (RowAll(px, w, yy + 3, x0, x1)) continue;
            int midy = (y + yy) / 2, cnt = 0, white = 0;
            for (int x = x0 + 8; x <= x1 - 8; x++) { cnt++; if (IsWhite(px[midy * w + x])) white++; }
            if (cnt <= 0 || white > (cnt * 12) / 100) continue;
            if (ColFrac(px, w, x0, y, yy) && ColFrac(px, w, x1, y, yy)) return yy;
        }
        return -1;
    }

    delegate bool EnumProc(IntPtr h, IntPtr l);

    [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern int GetWindowText(IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out RECT r);
    [DllImport("user32.dll")] static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern IntPtr GetWindowDC(IntPtr h);
    [DllImport("user32.dll")] static extern int ReleaseDC(IntPtr h, IntPtr dc);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint n, INPUT[] i, int size);
    [DllImport("user32.dll")] static extern IntPtr GetDC(IntPtr h);
    [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr d, int x, int y, int w, int h, IntPtr s, int sx, int sy, uint rop);
    [DllImport("user32.dll")] static extern short GetKeyState(int vk);
    [DllImport("user32.dll")] static extern bool Iconic(IntPtr h); // fallback unused
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);

    const uint SRCCOPY = 0x00CC0020;
    static IntPtr target = IntPtr.Zero; // auto-find by title when zero
    static string titleFilter = "UNDERTALE";
    static uint pidFilter = 0;
    static bool substr = false;

    static string J(string s) { return "\"" + s.Replace("\\", "\\\\").Replace("\"", "\\\"") + "\""; }

    static IntPtr FindWindow()
    {
        if (target != IntPtr.Zero && IsWindowVisible(target)) return target;
        IntPtr found = IntPtr.Zero;
        EnumWindows((h, l) =>
        {
            if (!IsWindowVisible(h)) return true;
            int len = GetWindowTextLength(h);
            if (len <= 0) return true;
            var sb = new System.Text.StringBuilder(len + 2);
            GetWindowText(h, sb, sb.Capacity);
            string t = sb.ToString();
            bool titleOk = substr ? t.IndexOf(titleFilter, StringComparison.OrdinalIgnoreCase) >= 0 : t.Equals(titleFilter, StringComparison.OrdinalIgnoreCase);
            if (pidFilter != 0) { uint wp; GetWindowThreadProcessId(h, out wp); if (wp != pidFilter) return true; }
            if (titleOk || (pidFilter != 0 && titleFilter.Length == 0)) { found = h; return false; }
            return true;
        }, IntPtr.Zero);
        if (found != IntPtr.Zero) target = found;
        return found;
    }

    static Bitmap Grab(IntPtr h, bool blt)
    {
        RECT r; GetWindowRect(h, out r);
        int w = r.r - r.l, hh = r.b - r.t;
        if (w <= 0 || hh <= 0) return null;
        var bmp = new Bitmap(w, hh, PixelFormat.Format32bppArgb);
        using (var g = Graphics.FromImage(bmp))
        {
            if (blt)
            {
                g.CopyFromScreen(r.l, r.t, 0, 0, new Size(w, hh));
            }
            else
            {
                IntPtr ddc = g.GetHdc();
                bool ok = PrintWindow(h, ddc, PW_RENDERFULLCONTENT);
                g.ReleaseHdc(ddc);
                if (!ok) { bmp.Dispose(); return null; }
            }
        }
        return bmp;
    }

    static bool SendKey(ushort vk, ushort scan, bool down, bool useScan)
    {
        var i = new INPUT { type = INPUT_KEYBOARD };
        i.u.k = new KEYBDINPUT { vk = useScan ? (ushort)0 : vk, scan = scan, flags = (down ? 0u : KEYUP) | (useScan ? SCAN : 0u), time = 0, extra = IntPtr.Zero };
        return SendInput(1, new INPUT[] { i }, Marshal.SizeOf(typeof(INPUT))) == 1;
    }

    static int Vk(string name)
    {
        switch (name)
        {
            case "z": return 0x5A; case "x": return 0x58; case "c": return 0x43; case "v": return 0x56;
            case "a": return 0x41; case "s": return 0x53; case "d": return 0x44; case "q": return 0x51;
            case "up": return 0x26; case "down": return 0x28; case "left": return 0x25; case "right": return 0x27;
            case "enter": return 0x0D; case "shift": return 0x10; case "lshift": return 0xA0; case "rshift": return 0xA1;
            case "space": return 0x20; case "esc": case "escape": return 0x1B; case "tab": return 0x09;
            case "f1": return 0x70; case "f2": return 0x71; case "f3": return 0x72; case "f4": return 0x73;
            case "alt": return 0x12; case "ctrl": return 0x11; case "back": return 0x08;
        }
        int v; if (int.TryParse(name, out v)) return v;
        if (name.Length == 1) return (int)Char.ToUpper(name[0]);
        return -1;
    }

    [DllImport("user32.dll")] static extern int MapVirtualKey(uint vk, uint mapType);

    static string Esc(string s) { return J(s); }

    static void Main(string[] args)
    {
        SetProcessDPIAware();
        for (int a = 0; a < args.Length; a++)
            if (args[a] == "--title" && a + 1 < args.Length) titleFilter = args[++a];
            else if (args[a] == "--pid" && a + 1 < args.Length) pidFilter = uint.Parse(args[++a]);
            else if (args[a] == "--substr") substr = true;
        var stdin = Console.In;
        while (true)
        {
            string line = stdin.ReadLine();
            if (line == null) break;
            line = line.Trim();
            if (line.Length == 0) continue;
            string[] p = line.Split(' ');
            try
            {
                switch (p[0])
                {
                    case "filter":
                        for (int i = 1; i < p.Length; i++)
                        {
                            int eq = p[i].IndexOf('=');
                            string k = eq < 0 ? p[i] : p[i].Substring(0, eq);
                            string v = eq < 0 ? "" : p[i].Substring(eq + 1);
                            if (k == "pid") pidFilter = v.Length == 0 ? 0u : uint.Parse(v);
                            else if (k == "title") titleFilter = v;
                            else if (k == "substr") substr = v == "1" || v == "true";
                            target = IntPtr.Zero;
                        }
                        Console.WriteLine("{\"ok\":true,\"pid\":" + pidFilter + ",\"title\":" + Esc(titleFilter) + ",\"substr\":" + substr.ToString().ToLower() + "}");
                        break;
                    case "list":
                    {
                        var items = new List<string>();
                        EnumWindows((h, l) =>
                        {
                            if (!IsWindowVisible(h)) return true;
                            int len2 = GetWindowTextLength(h);
                            if (len2 <= 0) return true;
                            var sb2 = new System.Text.StringBuilder(len2 + 2); GetWindowText(h, sb2, sb2.Capacity);
                            RECT r2; GetWindowRect(h, out r2);
                            uint pid2; GetWindowThreadProcessId(h, out pid2);
                            items.Add("{\"hwnd\":" + (long)h + ",\"pid\":" + pid2 + ",\"title\":" + Esc(sb2.ToString()) + ",\"x\":" + r2.l + ",\"y\":" + r2.t + ",\"w\":" + (r2.r - r2.l) + ",\"h\":" + (r2.b - r2.t) + "}");
                            return true;
                        }, IntPtr.Zero);
                        Console.WriteLine("{\"ok\":true,\"windows\":[" + string.Join(",", items) + "]}");
                        break;
                    }
                    case "find":
                    {
                        IntPtr h = FindWindow();
                        if (h == IntPtr.Zero) { Console.WriteLine("{\"ok\":false,\"err\":\"no window\"}"); break; }
                        RECT r; GetWindowRect(h, out r);
                        uint pid; GetWindowThreadProcessId(h, out pid);
                        int len = GetWindowTextLength(h); var sb = new System.Text.StringBuilder(len + 2); GetWindowText(h, sb, sb.Capacity);
                        Console.WriteLine("{\"ok\":true,\"hwnd\":" + (long)h + ",\"pid\":" + pid + ",\"title\":" + Esc(sb.ToString()) +
                            ",\"x\":" + r.l + ",\"y\":" + r.t + ",\"w\":" + (r.r - r.l) + ",\"h\":" + (r.b - r.t) + ",\"iconic\":" + IsIconic(h).ToString().ToLower() + "}");
                        break;
                    }
                    case "hwnd":
                        if (p.Length > 1) target = new IntPtr(long.Parse(p[1]));
                        Console.WriteLine("{\"ok\":true,\"hwnd\":" + (long)target + "}");
                        break;
                    case "focus":
                    {
                        IntPtr h = FindWindow();
                        if (h == IntPtr.Zero) { Console.WriteLine("{\"ok\":false,\"err\":\"no window\"}"); break; }
                        if (IsIconic(h)) ShowWindow(h, 9);
                        uint t = AttachTo(h);
                        bool r = SetForegroundWindow(h);
                        Detach(t);
                        Console.WriteLine("{\"ok\":" + r.ToString().ToLower() + ",\"foreground\":" +
                            (GetForegroundWindow() == h).ToString().ToLower() + "}");
                        break;
                    }
                    case "fg":
                    {
                        IntPtr h = GetForegroundWindow();
                        int len = GetWindowTextLength(h); var sb = new System.Text.StringBuilder(len + 2); GetWindowText(h, sb, sb.Capacity);
                        uint pid; GetWindowThreadProcessId(h, out pid);
                        Console.WriteLine("{\"ok\":true,\"hwnd\":" + (long)h + ",\"pid\":" + pid + ",\"title\":" + Esc(sb.ToString()) + "}");
                        break;
                    }
                    case "shot":
                    {
                        IntPtr h = FindWindow();
                        if (h == IntPtr.Zero) { Console.WriteLine("{\"ok\":false,\"err\":\"no window\"}"); break; }
                        bool blt = p.Length > 2 && p[2] == "blt";
                        Bitmap b = Grab(h, blt);
                        if (b == null) { Console.WriteLine("{\"ok\":false,\"err\":\"grab failed\"}"); break; }
                        string path = p.Length > 1 ? p[1] : "frame.png";
                        b.Save(path, ImageFormat.Png);
                        Console.WriteLine("{\"ok\":true,\"path\":" + Esc(System.IO.Path.GetFullPath(path)) + ",\"w\":" + b.Width + ",\"h\":" + b.Height + ",\"mode\":" + (blt ? "\"blt\"" : "\"print\"") + "}");
                        b.Dispose();
                        break;
                    }
                    case "dump":
                    {
                        // dump <png> <out.bin> [x y w h] -> raw BGRA bytes, for the OCR tool
                        if (p.Length < 3) { Console.WriteLine("{\"ok\":false,\"err\":\"need png and out\"}"); break; }
                        Bitmap src = new Bitmap(p[1]);
                        int x = 0, y = 0, cw = src.Width, chh = src.Height;
                        if (p.Length >= 7) { x = int.Parse(p[3]); y = int.Parse(p[4]); cw = int.Parse(p[5]); chh = int.Parse(p[6]); }
                        if (x + cw > src.Width) cw = src.Width - x;
                        if (y + chh > src.Height) chh = src.Height - y;
                        BitmapData bd2 = src.LockBits(new Rectangle(x, y, cw, chh), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                        byte[] row = new byte[cw * 4];
                        using (var fs = new System.IO.FileStream(p[2], System.IO.FileMode.Create))
                        {
                            for (int r2 = 0; r2 < chh; r2++)
                            {
                                IntPtr ptr = IntPtr.Add(bd2.Scan0, r2 * bd2.Stride);
                                Marshal.Copy(ptr, row, 0, row.Length);
                                fs.Write(row, 0, row.Length);
                            }
                        }
                        src.UnlockBits(bd2);
                        src.Dispose();
                        Console.WriteLine("{\"ok\":true,\"w\":" + cw + ",\"h\":" + chh + ",\"path\":" + Esc(System.IO.Path.GetFullPath(p[2])) + "}");
                        break;
                    }
                    case "grab":
                    {
                        // grab <out.bin> [x y w h] -> dump the live window straight to raw bytes
                        IntPtr h = FindWindow();
                        if (h == IntPtr.Zero) { Console.WriteLine("{\"ok\":false,\"err\":\"no window\"}"); break; }
                        Bitmap b = Grab(h, false);
                        if (b == null) { Console.WriteLine("{\"ok\":false,\"err\":\"grab failed\"}"); break; }
                        string tmp = System.IO.Path.GetTempFileName();
                        b.Save(tmp, ImageFormat.Png);
                        b.Dispose();
                        var parts = new List<string> { "dump", tmp, p.Length > 1 ? p[1] : "grab.bin" };
                        for (int i = 2; i < p.Length; i++) parts.Add(p[i]);
                        p = parts.ToArray();
                        goto case "dump";
                    }
                    case "diff":
                    {
                        if (p.Length < 3) { Console.WriteLine("{\"ok\":false,\"err\":\"need two paths\"}"); break; }
                        Bitmap a = new Bitmap(p[1]), b = new Bitmap(p[2]);
                        int w = Math.Min(a.Width, b.Width), hh = Math.Min(a.Height, b.Height);
                        long changed = 0, sumabs = 0; int minx = w, miny = hh, maxx = -1, maxy = -1;
                        for (int y = 0; y < hh; y++)
                            for (int x = 0; x < w; x++)
                            {
                                Color ca = a.GetPixel(x, y), cb = b.GetPixel(x, y);
                                int d = Math.Abs(ca.R - cb.R) + Math.Abs(ca.G - cb.G) + Math.Abs(ca.B - cb.B);
                                if (d > 12)
                                {
                                    changed++; sumabs += d;
                                    if (x < minx) minx = x; if (x > maxx) maxx = x;
                                    if (y < miny) miny = y; if (y > maxy) maxy = y;
                                }
                            }
                        Console.WriteLine("{\"ok\":true,\"changed\":" + changed + ",\"pixels\":" + ((long)w * hh) +
                            ",\"sumdiff\":" + sumabs + ",\"bbox\":[" + minx + "," + miny + "," + maxx + "," + maxy + "]}");
                        a.Dispose(); b.Dispose();
                        break;
                    }
                    case "scan":
                    {
                        IntPtr h = FindWindow();
                        if (h == IntPtr.Zero) { Console.WriteLine("{\"ok\":false,\"err\":\"no window\"}"); break; }
                        Bitmap bmp = Grab(h, false);
                        if (bmp == null) { Console.WriteLine("{\"ok\":false,\"err\":\"grab failed\"}"); break; }
                        int w = bmp.Width, hh = bmp.Height;
                        BitmapData bd = bmp.LockBits(new Rectangle(0, 0, w, hh), ImageLockMode.ReadOnly, PixelFormat.Format32bppArgb);
                        int[] px = new int[w * hh];
                        Marshal.Copy(bd.Scan0, px, 0, px.Length);
                        bmp.UnlockBits(bd);
                        bmp.Dispose();
                        int yTop = 45;
                        int top = -1, bot = -1, bx0 = -1, bx1 = -1;
                        for (int y = yTop; y < hh && bot < 0; y++)
                        {
                            int run = 0, start = 0;
                            for (int x = 0; x <= w; x++)
                            {
                                if (x < w && IsWhite(px[y * w + x])) { if (run == 0) start = x; run++; }
                                else
                                {
                                    if (run >= 60 && ThinWhite(px, w, hh, start + run / 2, y))
                                    {
                                        int ey = FindBottom(px, w, hh, y, start, start + run - 1);
                                        if (ey > 0) { top = y; bot = ey; bx0 = start; bx1 = start + run - 1; break; }
                                    }
                                    run = 0;
                                }
                            }
                        }
                        int ix0 = bx0 < 0 ? 0 : bx0 + 6, ix1 = bx1 < 0 ? w - 1 : bx1 - 6;
                        int iy0 = top < 0 ? yTop : top + 6, iy1 = bot < 0 ? hh - 1 : bot - 6;
                        int rsx = 0, rsy = 0, rn = 0;
                        for (int y = iy0; y <= iy1; y++)
                            for (int x = ix0; x <= ix1; x++)
                                if (IsRed(px[y * w + x])) { rsx += x; rsy += y; rn++; }
                        var comps = new List<string>();
                        byte[] seen = new byte[w * hh];
                        int[] stack = new int[w * hh];
                        for (int y = iy0; y <= iy1; y++)
                            for (int x = ix0; x <= ix1; x++)
                            {
                                int idx = y * w + x;
                                if (seen[idx] != 0 || !IsWhite(px[idx])) continue;
                                int sp = 0; stack[sp++] = idx;
                                seen[idx] = 1;
                                int n = 0, sx = 0, sy = 0, minx = x, maxx = x, miny = y, maxy = y;
                                while (sp > 0)
                                {
                                    int c = stack[--sp];
                                    int cx = c % w, cy = c / w;
                                    n++; sx += cx; sy += cy;
                                    if (cx < minx) minx = cx; if (cx > maxx) maxx = cx;
                                    if (cy < miny) miny = cy; if (cy > maxy) maxy = cy;
                                    if (cx > ix0 && seen[c - 1] == 0 && IsWhite(px[c - 1])) { seen[c - 1] = 1; stack[sp++] = c - 1; }
                                    if (cx < ix1 && seen[c + 1] == 0 && IsWhite(px[c + 1])) { seen[c + 1] = 1; stack[sp++] = c + 1; }
                                    if (cy > iy0 && seen[c - w] == 0 && IsWhite(px[c - w])) { seen[c - w] = 1; stack[sp++] = c - w; }
                                    if (cy < iy1 && seen[c + w] == 0 && IsWhite(px[c + w])) { seen[c + w] = 1; stack[sp++] = c + w; }
                                }
                        int bw = maxx - minx + 1, bh = maxy - miny + 1;
                        if (n >= 4 && bw <= 40 && bh <= 40 && n >= (bw * bh) / 3 && comps.Count < 80)
                            comps.Add("[" + (sx / n) + "," + (sy / n) + "," + n + "," + bw + "," + bh + "]");
                            }
                        Console.WriteLine("{\"ok\":true,\"box\":[" + bx0 + "," + top + "," + bx1 + "," + bot +
                            "],\"inner\":[" + ix0 + "," + iy0 + "," + ix1 + "," + iy1 +
                            "],\"soul\":[" + (rn > 0 ? rsx / rn : -1) + "," + (rn > 0 ? rsy / rn : -1) + "," + rn +
                            "],\"bullets\":[" + string.Join(",", comps) + "]}");
                        break;
                    }
                    case "key":
                    {
                        IntPtr gh = FindWindow();
                        uint tt = 0;
                        if (gh != IntPtr.Zero && GetForegroundWindow() != gh) { tt = AttachTo(gh); SetForegroundWindow(gh); }
                        string name = p[1]; string act = p.Length > 2 ? p[2] : "press";
                        bool scan = false; int hold = 0;
                        for (int i = 3; i < p.Length; i++)
                        {
                            if (p[i] == "scan") scan = true;
                            else { int h; if (int.TryParse(p[i], out h)) hold = h; }
                        }
                        int vk = Vk(name); if (vk < 0) { Console.WriteLine("{\"ok\":false,\"err\":\"bad key\"}"); break; }
                        ushort sc = (ushort)MapVirtualKey((uint)vk, 0);
                        bool down = act == "down", up = act == "up";
                        bool r1 = true, r2 = true;
                        if (down || (!up)) r1 = SendKey((ushort)vk, sc, true, scan);
                        if (!down && !up && hold > 0) System.Threading.Thread.Sleep(hold);
                        if (up || (!down)) r2 = SendKey((ushort)vk, sc, false, scan);
                        Detach(tt);
                        Console.WriteLine("{\"ok\":" + (r1 && r2).ToString().ToLower() + ",\"vk\":" + vk + ",\"scan\":" + sc + ",\"hold\":" + hold + "}");
                        break;
                    }
                    case "held":
                    {
                        var parts = new List<string>();
                        foreach (var n in new[] { "up", "down", "left", "right", "z", "x", "enter", "shift", "c" })
                            if ((GetKeyState(Vk(n)) & 0x8000) != 0) parts.Add(n);
                        Console.WriteLine("{\"ok\":true,\"held\":[" + string.Join(",", parts.ConvertAll(x => Esc(x))) + "]}");
                        break;
                    }
                    case "ping": Console.WriteLine("{\"ok\":true}"); break;
                    case "quit": return;
                    default: Console.WriteLine("{\"ok\":false,\"err\":\"unknown\"}"); break;
                }
            }
            catch (Exception e)
            {
                Console.WriteLine("{\"ok\":false,\"err\":" + Esc(e.Message) + "}");
            }
        }
    }
}
