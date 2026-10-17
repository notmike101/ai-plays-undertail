# Build the native bridge. Usage: powershell -NoProfile -File src/bridge/build.ps1
$ErrorActionPreference = 'Stop'
$dir = Split-Path -Parent $MyInvocation.MyCommand.Path
$csc = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\MSBuild\Current\Bin\Roslyn\csc.exe'
& $csc /nologo /out:"$dir\bridge.exe" /reference:System.Drawing.dll "$dir\bridge.cs"
Write-Host "exit=$LASTEXITCODE"
exit $LASTEXITCODE
