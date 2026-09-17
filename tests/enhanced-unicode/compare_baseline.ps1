#Requires -Version 5.1
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$BaselineDir,

    [Parameter(Mandatory = $true)]
    [string]$CandidateDir
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$baseline = (Resolve-Path $BaselineDir).Path
$candidate = (Resolve-Path $CandidateDir).Path
$failed = $false

function Compare-File([string]$RelativePath) {
    $baselinePath = Join-Path $baseline $RelativePath
    $candidatePath = Join-Path $candidate $RelativePath
    if (-not (Test-Path $baselinePath) -or -not (Test-Path $candidatePath)) {
        Write-Host "MISSING  $RelativePath"
        $script:failed = $true
        return
    }
    $baselineHash = (Get-FileHash -LiteralPath $baselinePath -Algorithm SHA256).Hash
    $candidateHash = (Get-FileHash -LiteralPath $candidatePath -Algorithm SHA256).Hash
    if ($baselineHash -eq $candidateHash) {
        Write-Host "MATCH    $RelativePath"
    } else {
        Write-Host "DIFF     $RelativePath"
        $script:failed = $true
    }
}

Compare-File 'text.txt'
Compare-File 'text-raw.txt'

$baselinePages = @(Get-ChildItem -LiteralPath (Join-Path $baseline 'rendered') -Filter '*.png' -File |
    Sort-Object Name)
$candidatePages = @(Get-ChildItem -LiteralPath (Join-Path $candidate 'rendered') -Filter '*.png' -File |
    Sort-Object Name)

if ($baselinePages.Count -ne $candidatePages.Count) {
    Write-Host "DIFF     rendered page count: baseline=$($baselinePages.Count), candidate=$($candidatePages.Count)"
    $failed = $true
}

foreach ($page in $baselinePages) {
    Compare-File (Join-Path 'rendered' $page.Name)
}

if ($failed) {
    throw 'Baseline comparison failed.'
}

Write-Host 'Baseline extraction and rendered pages match.'
