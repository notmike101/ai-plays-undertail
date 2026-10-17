@echo off
rem Build the native bridge. Run from the repo root: cmd /c tools\build.cmd
"C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" -nologo -out:src\bridge\bridge.exe @build.rsp
