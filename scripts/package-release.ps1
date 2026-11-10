# Package the already checked dist/ directory; requires PowerShell 7.
[CmdletBinding()]
param(
    [string]$Tag = '',
    [string]$OutputDirectory = '.tmp/release',
    [switch]$ValidateOnly
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$lock = Get-Content -LiteralPath (Join-Path $root 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
$manifest = Get-Content -LiteralPath (Join-Path $root 'public/manifest.json') -Raw | ConvertFrom-Json
$version = $package.version

if ($version -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
    throw "Expected a stable x.y.z extension version, got: $version"
}
if ($manifest.version -ne $version -or $lock.version -ne $version -or $lock.packages[''].version -ne $version) {
    throw 'package.json, package-lock.json and public/manifest.json versions must match.'
}
if ($Tag -and $Tag -cne "v$version") {
    throw "Release tag '$Tag' must match package version 'v$version'."
}
if ($ValidateOnly) {
    Write-Output $version
    return
}

$dist = Join-Path $root 'dist'
$builtManifest = Get-Content -LiteralPath (Join-Path $dist 'manifest.json') -Raw | ConvertFrom-Json
if ($builtManifest.version -ne $version) {
    throw 'dist/manifest.json is out of date; run npm run check before packaging.'
}
if (-not (Test-Path -LiteralPath (Join-Path $dist 'content.js') -PathType Leaf)) {
    throw 'dist/content.js is missing; run npm run check before packaging.'
}
if (-not (Test-Path -LiteralPath (Join-Path $dist 'interceptor.js') -PathType Leaf)) {
    throw 'dist/interceptor.js is missing; run npm run check before packaging.'
}

$output = [System.IO.Path]::GetFullPath($OutputDirectory, $root)
[System.IO.Directory]::CreateDirectory($output) | Out-Null
$name = "deepseek-genui-v$version"
$zipPath = Join-Path $output "$name.zip"
$checksumPath = Join-Path $output "$name.sha256"
if ((Test-Path -LiteralPath $zipPath) -or (Test-Path -LiteralPath $checksumPath)) {
    throw "Package already exists in '$output'; choose a new output directory."
}

# Zip the contents, so manifest.json is at the archive root for browser loading.
Compress-Archive -Path (Join-Path $dist '*') -DestinationPath $zipPath -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText($checksumPath, "$hash  $name.zip`n", [System.Text.UTF8Encoding]::new($false))

Write-Output $zipPath
Write-Output $checksumPath
