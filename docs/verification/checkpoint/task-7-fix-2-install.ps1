$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path -LiteralPath '.').Path
$prior = Get-Content -LiteralPath 'docs/verification/checkpoint/task-7-fix-1-installation.json' -Raw | ConvertFrom-Json
$install = [IO.Path]::GetFullPath($prior.InstallPath)
$expected = [IO.Path]::GetFullPath((Join-Path $workspace '.superpowers/sdd/2026-10-03-music-player-implementation/Installed application with spaces'))
if ($install -ne $expected -or -not $install.StartsWith($workspace + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Install target is outside the explicitly contained acceptance directory' }
$installer = (Resolve-Path -LiteralPath 'release/MusicWorkbench-0.1.0-Setup.exe').Path
$exe = Join-Path $install 'MusicWorkbench.exe'
if (-not (Test-Path -LiteralPath $exe)) { throw 'Existing contained installation is missing' }
function Get-ContainedIdentity {
  @(Get-ChildItem 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall' | Get-ItemProperty | Where-Object { $_.PSChildName -eq 'f4428f25-3c04-5cb1-9206-67001552b59f' } | Select-Object PSChildName, DisplayName, UninstallString)
}
$before = @(Get-ContainedIdentity)
if ($before.Count -ne 1 -or -not $before[0].UninstallString.Contains($install)) { throw 'Existing app identity does not belong to the contained acceptance installation' }
$priorExeHash = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
$process = Start-Process -FilePath $installer -ArgumentList @('/S', '/currentuser', "/D=$install") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Contained installer failed: $($process.ExitCode)" }
$after = @(Get-ContainedIdentity)
if ($after.Count -ne 1 -or $after[0].PSChildName -ne $before[0].PSChildName -or -not $after[0].UninstallString.Contains($install)) { throw 'Contained upgrade changed the installation identity or target' }
$installedAsar = Join-Path $install 'resources/app.asar'
$builtAsar = Join-Path $workspace 'release/win-unpacked/resources/app.asar'
$asarHash = (Get-FileHash -LiteralPath $installedAsar -Algorithm SHA256).Hash.ToLowerInvariant()
if ($asarHash -ne (Get-FileHash -LiteralPath $builtAsar -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'Installed app archive differs from the new built archive' }
$result = [ordered]@{
  Installer = $installer
  InstallerSha256 = (Get-FileHash -LiteralPath $installer -Algorithm SHA256).Hash.ToLowerInvariant()
  PreviousInstallerSha256 = $prior.InstallerSha256
  InstallPath = $install
  InstallerCommand = 'Start-Process -WindowStyle Hidden -Wait -PassThru <installer> /S /currentuser /D=<contained InstallPath>'
  InstallerExit = $process.ExitCode
  ExistingIdentityBefore = $before
  IdentityAfter = $after
  Signed = (Get-AuthenticodeSignature -LiteralPath $installer).Status.ToString()
  PreviousInstalledExecutableSha256 = $priorExeHash
  InstalledExecutable = $exe
  InstalledExecutableSha256 = (Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  InstalledAsarSha256 = $asarHash
  InstalledMatchesBuiltAsar = $true
}
$result | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath 'docs/verification/checkpoint/task-7-fix-2-installation.json' -Encoding utf8
$result | ConvertTo-Json -Depth 8
