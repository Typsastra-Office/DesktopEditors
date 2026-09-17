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

# Inno Setup + unofficial translations (needed by the branded installer)
$innoCandidates = @("C:\Program Files (x86)\Inno Setup 6\ISCC.exe", "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe")
if (-not ($innoCandidates | Where-Object { Test-Path $_ })) {
    choco install innosetup -y --no-progress
}
$innoPath = Split-Path -Parent (($innoCandidates | Where-Object { Test-Path $_ })[0])
$env:INNOPATH = $innoPath
$langDir = "$innoPath\Languages"
if (-not (Test-Path $langDir)) { New-Item -ItemType Directory -Path $langDir -Force | Out-Null }
$langBase = "https://raw.githubusercontent.com/jrsoftware/issrc/refs/heads/main/Files/Languages"
$unofficial = @("Greek.isl","Estonian.isl","Indonesian.isl","Romanian.isl","Vietnamese.isl","Croatian.isl","Latvian.isl","Belarusian.isl","Galician.isl","SerbianLatin.isl","SerbianCyrillic.isl","EnglishBritish.isl","Albanian.isl","Urdu.isl","Sinhala.islu")
foreach ($f in $unofficial) {
    if (-not (Test-Path "$langDir\$f")) {
        try { Invoke-WebRequest -Uri "$langBase/Unofficial/$f" -OutFile "$langDir\$f" -UseBasicParsing -TimeoutSec 60 } catch { Write-Warning "translation $f not fetched: $_" }
    }
}
$official = @("Lithuanian.isl","ChineseSimplified.isl","ChineseTraditional.isl")
foreach ($f in $official) {
    if (-not (Test-Path "$langDir\$f")) {
        try { Invoke-WebRequest -Uri "$langBase/$f" -OutFile "$langDir\$f" -UseBasicParsing -TimeoutSec 60 } catch { Write-Warning "translation $f not fetched: $_" }
    }
}

# ---- configure + build ---------------------------------------------------
Push-Location $buildTools
python ./configure.py `
    --branch master `
    --platform win_64 `
    --module desktop `
    --qt-dir $QtDir `
    --vs-path $VsPath `
    --branding typsastra `
    --branding-name typsastra `
    --update 0
if ($LASTEXITCODE -ne 0) { throw "configure.py failed" }

$vcvars = "$VsPath\vcvarsall.bat"
$makeBat = Join-Path $env:TEMP "typsastra-make.bat"
@(
    "@echo off",
    "call `"$vcvars`" x64 -vcvars_ver=14.29",
    "if errorlevel 1 exit /b %errorlevel%",
    "python make.py",
    "exit /b %errorlevel%"
) | Set-Content -Path $makeBat -Encoding ASCII
cmd /c $makeBat
if ($LASTEXITCODE -ne 0) { throw "make.py failed ($LASTEXITCODE)" }
Pop-Location

# ---- package -------------------------------------------------------------
Push-Location $buildTools
python ./make_package.py -P windows_x64 -T desktop -V "$Version.$Build" -B "$Build" -R typsastra
$pkgExit = $LASTEXITCODE
Pop-Location
if ($pkgExit -ne 0) { throw "make_package.py failed" }

Write-Host "Artifacts:"
Get-ChildItem "$repoRoot\desktop-apps\package\zip\*.zip", "$repoRoot\desktop-apps\package\inno\*.exe" -ErrorAction SilentlyContinue |
    ForEach-Object { Write-Host "  $($_.FullName)" }
