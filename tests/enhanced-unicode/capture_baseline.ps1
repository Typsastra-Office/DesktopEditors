#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PdfPath,

    [string]$Name = 'desktopeditors-baseline',
    [string]$OutputRoot = '',
    [int]$RenderDpi = 144,
    [string]$VeraPdfPath = "$env:LOCALAPPDATA\Programs\veraPDF\verapdf.bat"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if (-not $OutputRoot) { $OutputRoot = Join-Path $PSScriptRoot 'results' }

function Resolve-Tool([string]$Name, [string]$ExplicitPath = '') {
    if ($ExplicitPath -and (Test-Path $ExplicitPath)) {
        return (Resolve-Path $ExplicitPath).Path
    }
    $command = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $command) { throw "Required tool not found: $Name" }
    return $command.Source
}

function Invoke-Logged([string]$Tool, [string[]]$Arguments, [string]$LogPath, [switch]$AllowFailure) {
    # Windows PowerShell converts native stderr into ErrorRecord objects. Keep
    # those diagnostics in the log and use the process exit code for failure.
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & $Tool @Arguments 2>&1
        $exitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorAction
    }
    $output | ForEach-Object { $_.ToString() } |
        Set-Content -LiteralPath $LogPath -Encoding UTF8
    if ($exitCode -ne 0 -and -not $AllowFailure) {
        throw "$Tool failed with exit code $exitCode. See $LogPath"
    }
    return $exitCode
}

$pdf = (Resolve-Path $PdfPath).Path
$qpdf = Resolve-Tool 'qpdf.exe'
$python = Resolve-Tool 'python.exe'
$pdfToPpm = Resolve-Tool 'pdftoppm.exe'
$popplerDir = Split-Path $pdfToPpm
# Keep all Poppler operations on one installation. Git for Windows may put an
# older pdftotext.exe earlier on PATH than the standalone Poppler package.
$pdfToText = Resolve-Tool 'pdftotext.exe' (Join-Path $popplerDir 'pdftotext.exe')
$pdfFonts = Resolve-Tool 'pdffonts.exe' (Join-Path $popplerDir 'pdffonts.exe')
$veraPdf = if (Test-Path $VeraPdfPath) { (Resolve-Path $VeraPdfPath).Path } else { $null }

$outputDir = Join-Path $OutputRoot $Name
if (Test-Path $outputDir) { Remove-Item -LiteralPath $outputDir -Recurse -Force }
New-Item -ItemType Directory -Path $outputDir -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $outputDir 'rendered') -Force | Out-Null

$capturedPdf = Join-Path $outputDir 'document.pdf'
Copy-Item -LiteralPath $pdf -Destination $capturedPdf

Invoke-Logged $qpdf @('--check', $capturedPdf) (Join-Path $outputDir 'qpdf-check.txt') | Out-Null
Invoke-Logged $pdfFonts @($capturedPdf) (Join-Path $outputDir 'fonts.txt') | Out-Null

Invoke-Logged $pdfToText @('-enc', 'UTF-8', $capturedPdf, (Join-Path $outputDir 'text.txt')) `
    (Join-Path $outputDir 'pdftotext.txt') | Out-Null
Invoke-Logged $pdfToText @('-raw', '-enc', 'UTF-8', $capturedPdf, (Join-Path $outputDir 'text-raw.txt')) `
    (Join-Path $outputDir 'pdftotext-raw.txt') | Out-Null
Invoke-Logged $python @(
    (Join-Path $PSScriptRoot 'audit_extraction.py'),
    '--manifest', (Join-Path $PSScriptRoot 'corpus.json'),
    '--normal', (Join-Path $outputDir 'text.txt'),
    '--raw', (Join-Path $outputDir 'text-raw.txt'),
    '--output', (Join-Path $outputDir 'extraction-audit.json')
) (Join-Path $outputDir 'extraction-audit-summary.txt') | Out-Null

$renderPrefix = Join-Path $outputDir 'rendered\page'
Invoke-Logged $pdfToPpm @('-png', '-r', $RenderDpi, $capturedPdf, $renderPrefix) `
    (Join-Path $outputDir 'pdftoppm.txt') | Out-Null

$veraPdfExitCode = $null
if ($veraPdf) {
    $veraPdfExitCode = Invoke-Logged $veraPdf @('--format', 'text', $capturedPdf) (Join-Path $outputDir 'verapdf.txt') -AllowFailure
} else {
    'veraPDF not found; conformance validation was skipped.' |
        Set-Content -LiteralPath (Join-Path $outputDir 'verapdf.txt') -Encoding UTF8
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$metadata = [ordered]@{
    captured_at_utc = [DateTime]::UtcNow.ToString('o')
    source_pdf = $pdf
    pdf_sha256 = (Get-FileHash -LiteralPath $capturedPdf -Algorithm SHA256).Hash.ToLowerInvariant()
    pdf_bytes = (Get-Item -LiteralPath $capturedPdf).Length
    render_dpi = $RenderDpi
    desktopeditors_commit = (& git -C $repoRoot rev-parse HEAD).Trim()
    core_commit = (& git -C (Join-Path $repoRoot 'core') rev-parse HEAD).Trim()
    sdkjs_commit = (& git -C (Join-Path $repoRoot 'sdkjs') rev-parse HEAD).Trim()
    qpdf = $qpdf
    python = $python
    pdftotext = $pdfToText
    pdftoppm = $pdfToPpm
    pdffonts = $pdfFonts
    verapdf = $veraPdf
    verapdf_exit_code = $veraPdfExitCode
}
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $outputDir 'metadata.json') -Encoding UTF8

Write-Host "Baseline captured at $outputDir"
