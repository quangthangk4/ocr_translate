param(
    [ValidatePattern('^[a-p]{32}$')][string]$ExtensionId,
    [string]$InstallDirectory = (Join-Path $env:LOCALAPPDATA 'ComicLens\WindowsOcr'),
    [switch]$NoElevation
)
$ErrorActionPreference = 'Stop'
if (-not $ExtensionId) { $ExtensionId = (Read-Host 'Comic Lens extension ID (from extension settings)').Trim() }
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'Invalid extension ID. Copy the 32-letter ID from Comic Lens settings.' }
if ([Environment]::OSVersion.Version.Build -lt 19041) { throw 'Windows 10 version 2004 or newer is required.' }
$InstallDirectory = [IO.Path]::GetFullPath($InstallDirectory)
if ($InstallDirectory -eq [IO.Path]::GetPathRoot($InstallDirectory)) { throw 'Choose an application subdirectory.' }
New-Item -ItemType Directory -Path $InstallDirectory -Force | Out-Null
$required = @('ComicLens.WindowsOcr.exe', 'ComicLens.WindowsOcr.msix', 'ComicLens.WindowsOcr.cer', 'Uninstall.ps1', 'Trust-Certificate.ps1')
foreach ($name in $required) {
    $sourcePath = Join-Path $PSScriptRoot $name
    if (-not (Test-Path -LiteralPath $sourcePath)) { throw "Missing $name. Extract the complete bridge ZIP first." }
    if ([IO.Path]::GetFullPath($sourcePath) -ne (Join-Path $InstallDirectory $name)) { Copy-Item -LiteralPath $sourcePath -Destination $InstallDirectory -Force }
}
$originPath = Join-Path $InstallDirectory 'allowed-origins.json'
$origins = @("chrome-extension://$ExtensionId/")
if (Test-Path -LiteralPath $originPath) { $origins += @(Get-Content -LiteralPath $originPath -Raw | ConvertFrom-Json) }
$origins = @($origins | Where-Object { $_ -match '^chrome-extension://[a-p]{32}/$' } | Select-Object -Unique)
[IO.File]::WriteAllText($originPath, (ConvertTo-Json -InputObject $origins), [Text.UTF8Encoding]::new($false))
$certificatePath = Join-Path $InstallDirectory 'ComicLens.WindowsOcr.cer'
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($certificatePath)
$trustStore = [System.Security.Cryptography.X509Certificates.X509Store]::new('TrustedPeople', [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
$trustStore.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly)
$alreadyTrusted = @($trustStore.Certificates | Where-Object { $_.Thumbprint -eq $certificate.Thumbprint }).Count -gt 0
$ownsCertificate = -not $alreadyTrusted
$statePath = Join-Path $InstallDirectory 'install-state.json'
if (Test-Path -LiteralPath $statePath) {
    $previousState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if ($previousState.certificate -eq $certificate.Thumbprint -and $previousState.ownsCertificate) { $ownsCertificate = $true }
}
$trustStore.Close()
if (-not $alreadyTrusted) {
    if ($NoElevation) { throw 'MSIX certificate is not trusted on this machine. Run the bridge installer interactively once and approve the administrator prompt.' }
    Write-Output 'Windows needs administrator approval once to trust the bridge signing certificate. No root certificate is added.'
    $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $InstallDirectory 'Trust-Certificate.ps1') + '" -CertificatePath "' + $certificatePath + '"'
    $trustProcess = Start-Process -FilePath (Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -Wait -PassThru
    if ($trustProcess.ExitCode -ne 0) { throw 'Certificate trust was not completed. The bridge has not been registered.' }
}
$existing = Get-AppxPackage -Name ComicLens.WindowsOcr
if ($existing) { $existing | Remove-AppxPackage }
try { Add-AppxPackage -Path (Join-Path $InstallDirectory 'ComicLens.WindowsOcr.msix') -ExternalLocation $InstallDirectory }
catch {
    Write-Warning 'Package installation failed. If certificate trust completed, remove it using Trust-Certificate.ps1 -Remove as administrator.'
    throw
}
$manifestPath = Join-Path $InstallDirectory 'com.comiclens.windows_ocr.json'
$manifest = @{ name = 'com.comiclens.windows_ocr'; description = 'Comic Lens Windows OCR'; path = (Join-Path $InstallDirectory 'ComicLens.WindowsOcr.exe'); type = 'stdio'; allowed_origins = $origins }
[IO.File]::WriteAllText($manifestPath, (ConvertTo-Json $manifest -Depth 4), [Text.UTF8Encoding]::new($false))
foreach ($browser in @('BraveSoftware\Brave-Browser', 'Google\Chrome')) {
    $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.comiclens.windows_ocr"
    New-Item -Path $key -Force | Out-Null; Set-Item -LiteralPath $key -Value $manifestPath
}
[IO.File]::WriteAllText($statePath, (ConvertTo-Json @{ certificate = $certificate.Thumbprint; ownsCertificate = $ownsCertificate; package = (Get-AppxPackage -Name ComicLens.WindowsOcr).PackageFullName }), [Text.UTF8Encoding]::new($false))
Write-Output "Installed Windows OCR for extension $ExtensionId. Reload Comic Lens and click Check Windows OCR."
