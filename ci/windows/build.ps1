# Build Typsastra Office for win_64 and produce zip + Inno installer.
# Used by .github/workflows/release-windows.yml, can also run locally from the
# repository root:  powershell -File ci/windows/build.ps1
param (
    [string]$QtDir,
    [string]$VsPath,
    [string]$Version,
    [string]$Build = "0"
)
$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path "$scriptDir\..\..").Path
$buildTools = "$repoRoot\build_tools"

# ---- bootstrap -----------------------------------------------------------
# long paths (Inno/compiler paths)
git config --system core.longpaths true 2>$null

function Get-VsPath {
    $vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path $vswhere) {
        $path = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
        if ($path) { return "$path\VC\Auxiliary\Build" }
    }
    return "C:\Program Files\Microsoft Visual Studio\2022\Enterprise\VC\Auxiliary\Build"
}

if (-not $VsPath) { $VsPath = Get-VsPath }
if (-not $QtDir) {
    if ($env:QT_ROOT_DIR -and (Test-Path $env:QT_ROOT_DIR)) { $QtDir = (Get-Item $env:QT_ROOT_DIR).Parent.FullName }
    else { throw "QtDir is not set (expected QT_ROOT_DIR from install-qt-action)" }
}
if (-not $Version) {
    $Version = (Get-Content "$buildTools\version" -Raw).Trim()
}

Write-Host "QtDir   = $QtDir"
Write-Host "VsPath  = $VsPath"
Write-Host "Version = $Version.$Build"

# Always use the real interpreter path: `python` may resolve to a launcher
# that returns without waiting for the actual process.
$pythonExe = "$env:pythonLocation\python.exe"
if (-not (Test-Path $pythonExe)) { $pythonExe = (Get-Command python).Source }
Write-Host "Python  = $pythonExe"

# Inno Setup (needed by the branded installer). The required Inno message files
# are bundled in desktop-apps/package/inno/languages and copied into the
# compiler's Languages folder by make_inno.ps1, so no network access is needed.
$innoCandidates = @("C:\Program Files (x86)\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")
if (-not ($innoCandidates | Where-Object { Test-Path $_ })) {
    choco install innosetup -y --no-progress
}
$env:INNOPATH = Split-Path -Parent (($innoCandidates | Where-Object { Test-Path $_ })[0])

# ---- configure + build ---------------------------------------------------
Push-Location $buildTools
& $pythonExe ./configure.py `
    --branch master `
    --platform win_64 `
    --module desktop `
    --qt-dir $QtDir `
    --vs-version 2019 `
    --compiler msvc2022 `
    --vs-path $VsPath `
    --branding typsastra `
    --branding-name typsastra `
    --update 0
if ($LASTEXITCODE -ne 0) { throw "configure.py failed ($LASTEXITCODE)" }

# import the Visual Studio environment into this process, then run make.py
# directly so PowerShell waits for the build to actually finish
$vcvars = "$VsPath\vcvarsall.bat"
$vsEnv = & cmd.exe /c "call `"$vcvars`" x64 -vcvars_ver=14.29 && set"
if ($LASTEXITCODE -ne 0) { throw "vcvarsall failed ($LASTEXITCODE)" }
foreach ($line in $vsEnv) {
    $i = $line.IndexOf("=")
    if ($i -gt 0) {
        [System.Environment]::SetEnvironmentVariable($line.Substring(0, $i), $line.Substring($i + 1))
    }
}
& $pythonExe make.py
if ($LASTEXITCODE -ne 0) { throw "make.py failed ($LASTEXITCODE)" }
Pop-Location

$payload = Get-ChildItem -Path "$buildTools\out\win_64\*\DesktopEditors\DesktopEditors.exe" -ErrorAction SilentlyContinue
if (-not $payload) { throw "Build payload not found under build_tools\out\win_64" }
Write-Host "Payload = $($payload[0].FullName)"

# ---- package -------------------------------------------------------------
Push-Location $buildTools
& $pythonExe ./make_package.py -P windows_x64 -T desktop -V "$Version" -B "$Build" -R typsastra
$pkgExit = $LASTEXITCODE
Pop-Location
if ($pkgExit -ne 0) { throw "make_package.py failed ($pkgExit)" }

Write-Host "Artifacts:"
Get-ChildItem "$repoRoot\desktop-apps\package\zip\*.zip", "$repoRoot\desktop-apps\package\inno\*.exe" -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "  $($_.FullName)" }
