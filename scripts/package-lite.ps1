param(
    [string]$ReleaseDir,
    [string]$OutputDir
)
$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if (-not $ReleaseDir) { $ReleaseDir = Join-Path $repoRoot 'src-tauri/target/release' }
if (-not $OutputDir) { $OutputDir = Join-Path $repoRoot 'release' }
$config = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri/tauri.conf.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $repoRoot 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$cargo = Get-Content -LiteralPath (Join-Path $repoRoot 'src-tauri/Cargo.toml') -Raw -Encoding UTF8
$version = $config.version
if ($version -notmatch '^\d+\.\d+\.\d+$' -or $package.version -ne $version -or $cargo -notmatch ('(?m)^version = "' + [regex]::Escape($version) + '"\r?$')) {
    throw 'Tauri, npm and Cargo release versions must match.'
}
$binaryPath = (Resolve-Path -LiteralPath (Join-Path $ReleaseDir 'tauri-app.exe')).Path
$binaryVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($binaryPath).ProductVersion
if ($binaryVersion -ne $version) { throw "Binary version $binaryVersion does not match source version $version. Rebuild with the Tauri CLI." }
$appName = ([string][char]0x8bd1) + [char]0x523b + '.exe'
$files = [ordered]@{
    $appName = $binaryPath
    'DirectML.dll' = Join-Path $ReleaseDir 'DirectML.dll'
    'tauri_app_lib.dll' = Join-Path $ReleaseDir 'tauri_app_lib.dll'
    'licenses/Inter-OFL.txt' = Join-Path $repoRoot 'public/licenses/Inter-OFL.txt'
    'licenses/NotoSerifSC-OFL.txt' = Join-Path $repoRoot 'public/licenses/NotoSerifSC-OFL.txt'
    'licenses/README.md' = Join-Path $repoRoot 'public/licenses/README.md'
}
foreach ($path in $files.Values) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required package file missing: $path" }
}
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
$outputRoot = (Resolve-Path -LiteralPath $OutputDir).Path
$zipName = "YiKe-Lite-v$version.zip"
$zipPath = Join-Path $outputRoot $zipName
$checksumPath = Join-Path $outputRoot 'SHA256SUMS.txt'
if ((Test-Path -LiteralPath $zipPath) -or (Test-Path -LiteralPath $checksumPath)) { throw 'Release artifacts already exist; use a new output directory.' }
$folder = "YiKe-Lite-v$version/"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [IO.File]::Open($zipPath, [IO.FileMode]::CreateNew)
$zip = [IO.Compression.ZipArchive]::new($stream, [IO.Compression.ZipArchiveMode]::Create, $false, [Text.Encoding]::UTF8)
try {
    # Explicit allowlist: never recursively archive the portable installation.
    foreach ($name in $files.Keys) {
        [IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $files[$name], $folder + $name, [IO.Compression.CompressionLevel]::Optimal) | Out-Null
    }
    $readme = Get-Content -LiteralPath (Join-Path $repoRoot 'packaging/LITE_README.zh-CN.txt') -Raw -Encoding UTF8
    $entry = $zip.CreateEntry($folder + 'README.txt')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write($readme.Replace('{{VERSION}}', $version)) } finally { $writer.Dispose() }
    $entry = $zip.CreateEntry($folder + 'version.json')
    $writer = [IO.StreamWriter]::new($entry.Open(), [Text.UTF8Encoding]::new($false))
    try { $writer.Write((@{version=$version;edition='Lite';platform='windows-x64';modelsIncluded=$false;ollamaIncluded=$false} | ConvertTo-Json)) } finally { $writer.Dispose() }
} finally { $zip.Dispose(); $stream.Dispose() }
$hash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText($checksumPath, "$hash  $zipName`n", [Text.UTF8Encoding]::new($false))
Write-Output "$zipPath ($((Get-Item -LiteralPath $zipPath).Length) bytes)"
Write-Output "SHA-256: $hash"
