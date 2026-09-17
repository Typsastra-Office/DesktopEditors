#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$PdfPath,

    [string]$Name = 'phase-11-candidate',
    [string]$BaselineDir = '',
    [string]$Expected = '',
    [ValidateSet('exact', 'contains', 'content-exact')]
    [string]$ExpectedMode = 'exact',
    [switch]$Strict
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$pdf = (Resolve-Path $PdfPath).Path
$outputRoot = Join-Path $PSScriptRoot 'results'
$outputDir = Join-Path $outputRoot $Name

& (Join-Path $PSScriptRoot 'capture_baseline.ps1') `
    -PdfPath $pdf `
    -Name $Name `
    -OutputRoot $outputRoot

$qualifierArgs = @(
    (Join-Path $PSScriptRoot 'qualify_phase11.py'),
    '--pdf', $pdf,
    '--output', (Join-Path $outputDir 'qualification.json')
)
if ($Expected) { $qualifierArgs += @('--expected', $Expected, '--expected-mode', $ExpectedMode) }
if ($Strict) { $qualifierArgs += '--strict' }
& python @qualifierArgs
if ($LASTEXITCODE -ne 0) { throw 'Phase 11 PDF qualification failed.' }

if ($BaselineDir) {
    $baselineRendered = Join-Path (Resolve-Path $BaselineDir).Path 'rendered'
    $candidateRendered = Join-Path $outputDir 'rendered'
    $renderArgs = @(
        (Join-Path $PSScriptRoot 'compare_rendering.py'),
        '--baseline', $baselineRendered,
        '--candidate', $candidateRendered,
        '--thresholds', (Join-Path $PSScriptRoot 'phase11-thresholds.json'),
        '--output', (Join-Path $outputDir 'rendering-comparison.json')
    )
    if ($Strict) { $renderArgs += '--strict' }
    & python @renderArgs
    if ($LASTEXITCODE -ne 0) { throw 'Phase 11 rendering comparison failed.' }
}

Write-Host "Phase 11 evidence written to $outputDir"
