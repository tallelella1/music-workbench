param([string]$ArchivePath)

$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resourceRoot = Join-Path $projectRoot 'resources'
$manifestInfo = Get-Content -LiteralPath (Join-Path $resourceRoot 'media-runtime.json') -Raw | ConvertFrom-Json

function Test-MediaFile([string]$Path, $Entry) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }
    if ((Get-Item -LiteralPath $Path).Length -ne $Entry.byteLength) { return $false }
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant() -eq $Entry.sha256
}

$validRuntime = $true
foreach ($entry in $manifestInfo.binaries) {
    $destination = [IO.Path]::GetFullPath((Join-Path $resourceRoot $entry.file))
    if (-not $destination.StartsWith($resourceRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runtime manifest path escapes resources'
    }
    if (-not (Test-MediaFile $destination $entry)) { $validRuntime = $false }
}
if ($validRuntime) {
    Write-Output "Verified $($manifestInfo.binaries.Count) existing media binaries: $($manifestInfo.version)"
    exit 0
}

$cacheRoot = Join-Path $projectRoot '.cache\media-runtime'
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null
$archiveFile = Join-Path $cacheRoot ($manifestInfo.archiveSha256 + '.zip')
$stagingRoot = Join-Path $cacheRoot ('extract-' + [Guid]::NewGuid().ToString('N'))
$partialFile = Join-Path $cacheRoot ('download-' + [Guid]::NewGuid().ToString('N') + '.part')
try {
    if ($ArchivePath) {
        $archiveFile = (Resolve-Path -LiteralPath $ArchivePath).Path
    } elseif (-not (Test-Path -LiteralPath $archiveFile -PathType Leaf)) {
        if (([Uri]$manifestInfo.sourceUrl).Scheme -ne 'https') { throw 'Media download must use HTTPS' }
        Write-Output "Downloading fixed media runtime: $($manifestInfo.version)"
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $manifestInfo.sourceUrl -OutFile $partialFile
        if ((Get-FileHash -LiteralPath $partialFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifestInfo.archiveSha256) {
            throw 'Media archive SHA256 mismatch; downloaded bytes were not installed'
        }
        Move-Item -LiteralPath $partialFile -Destination $archiveFile
    }
    if ((Get-FileHash -LiteralPath $archiveFile -Algorithm SHA256).Hash.ToLowerInvariant() -ne $manifestInfo.archiveSha256) {
        throw 'Media archive SHA256 mismatch; cached bytes were not installed'
    }
    Expand-Archive -LiteralPath $archiveFile -DestinationPath $stagingRoot
    $verifiedFiles = @()
    foreach ($entry in $manifestInfo.binaries) {
        $candidates = @(Get-ChildItem -LiteralPath $stagingRoot -Recurse -File -Filter ([IO.Path]::GetFileName($entry.file)))
        if ($candidates.Count -ne 1 -or -not (Test-MediaFile $candidates[0].FullName $entry)) {
            throw "Extracted media binary failed verification: $($entry.file)"
        }
        $verifiedFiles += @{ Source = $candidates[0].FullName; Destination = Join-Path $resourceRoot $entry.file }
    }
    # Validate every binary before replacing any runtime file.
    foreach ($verifiedFile in $verifiedFiles) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $verifiedFile.Destination) -Force | Out-Null
        Copy-Item -LiteralPath $verifiedFile.Source -Destination $verifiedFile.Destination -Force
    }
    Write-Output "Installed $($verifiedFiles.Count) hash-verified media binaries: $($manifestInfo.version) ($($manifestInfo.license))"
} finally {
    foreach ($temporaryPath in @($stagingRoot, $partialFile)) {
        $resolvedTemporary = [IO.Path]::GetFullPath($temporaryPath)
        if (-not $resolvedTemporary.StartsWith([IO.Path]::GetFullPath($cacheRoot) + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
            throw 'Temporary cleanup path escapes media cache'
        }
        if (Test-Path -LiteralPath $resolvedTemporary) { Remove-Item -LiteralPath $resolvedTemporary -Recurse -Force }
    }
}
