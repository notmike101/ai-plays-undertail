# tools/refocus.ps1 - give the game window the foreground, without touching OBS.
#
# Why this exists: SendInput only reaches the FOREGROUND window. On this machine Task Manager held the
# foreground, bridge's SetForegroundWindow was refused against it, and every key was eaten: frames came
# back byte-identical, which the mapper would otherwise have recorded as a WALL. bridge's own focus pull
# (AttachThreadInput + SetForegroundWindow) is not enough against some windows, so this adds the alt-tab
# primitive (SwitchToThisWindow) and, only if that is refused, minimizes the blocking window.
# A window whose title contains OBS is never minimized, restored or closed - the stream stays untouched.
param([string]$title = "UNDERTALE")
$sig = @'
using System;using System.Text;using System.Runtime.InteropServices;
public class W {
 [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern void SwitchToThisWindow(IntPtr h,bool alttab);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int c);
 [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint a,uint b,bool f);
 [DllImport("user32.dll")] public static extern bool SystemParametersInfo(uint a,uint b,IntPtr c,uint d);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
 public delegate bool EnumProc(IntPtr h, IntPtr l);
}
'@
Add-Type -TypeDefinition $sig
$script:T = $title
$script:game = [IntPtr]::Zero
$script:blockers = @()
$cb = {
  param($h, $l)
  if (-not [W]::IsWindowVisible($h)) { return $true }
  $n = [W]::GetWindowTextLength($h)
  if ($n -eq 0) { return $true }
  $sb = New-Object System.Text.StringBuilder ($n + 2)
  [void][W]::GetWindowText($h, $sb, $sb.Capacity)
  $t = $sb.ToString()
  if ($t -eq $script:T) { $script:game = $h; return $false }
  $script:blockers += , @($h, $t)
  return $true
}
[void][W]::EnumWindows($cb, [IntPtr]::Zero)
if ($script:game -eq [IntPtr]::Zero) { "no visible window titled '$title'"; exit 2 }
$game = $script:game
if ([W]::GetForegroundWindow() -eq $game) { "already foreground: 0x{0:X}" -f $game; exit 0 }
# Drop the foreground-lock timeout so SetForegroundWindow is not silently refused.
$spi = [Runtime.InteropServices.Marshal]::AllocHGlobal(4)
[Runtime.InteropServices.Marshal]::WriteInt32($spi, 0)
[void][W]::SystemParametersInfo(0x2001, 0, $spi, 0) # SPI_SETFOREGROUNDLOCKTIMEOUT
[Runtime.InteropServices.Marshal]::FreeHGlobal($spi)
function Try-Take($game) {
  $fg = [W]::GetForegroundWindow()
  $fgTid = [W]::GetWindowThreadProcessId($fg, [ref]0)
  $cur = [W]::GetCurrentThreadId()
  [void][W]::AttachThreadInput($fgTid, $cur, $true)
  [W]::SwitchToThisWindow($game, $true)
  Start-Sleep -Milliseconds 200
  if ([W]::GetForegroundWindow() -ne $game) { [void][W]::SetForegroundWindow($game) }
  [void][W]::AttachThreadInput($fgTid, $cur, $false)
  return [W]::GetForegroundWindow() -eq $game
}
if (Try-Take $game) { "foreground taken (alt-tab primitive): 0x{0:X}" -f $game; exit 0 }
# Still refused: minimize the blocking window. Never OBS, never the desktop shell.
$fg = [W]::GetForegroundWindow()
$n = [W]::GetWindowTextLength($fg)
$sb = New-Object System.Text.StringBuilder ($n + 2); [void][W]::GetWindowText($fg, $sb, $sb.Capacity)
$fgText = $sb.ToString()
if ($fg -ne [IntPtr]::Zero -and $fgText -ne '' -and $fgText -notmatch 'OBS' -and $fgText -ne 'Program Manager') {
  [void][W]::ShowWindow($fg, 6)  # SW_MINIMIZE - the app keeps running
  Try-Take $game | Out-Null
  "minimized the blocking window '$fgText' and re-tried"
}
"foreground now: 0x{0:X} (want 0x{1:X})" -f [W]::GetForegroundWindow(), $game
