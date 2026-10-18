$ErrorActionPreference = 'Stop'
$installPath = [IO.Path]::GetFullPath($PSScriptRoot)
$manifestPath = Join-Path $installPath 'com.comiclens.windows_ocr.json'
$newerRegistration = $false
foreach ($browser in @('BraveSoftware\Brave-Browser', 'Google\Chrome')) {
    $key = "HKCU:\Software\$browser\NativeMessagingHosts\com.comiclens.windows_ocr"
    if (Test-Path -LiteralPath $key) {
        if ((Get-Item -LiteralPath $key).GetValue('') -eq $manifestPath) { Remove-Item -LiteralPath $key }
        else { $newerRegistration = $true }
    }
}
$package = Get-AppxPackage -Name ComicLens.WindowsOcr
if ($package -and -not $newerRegistration) { $package | Remove-AppxPackage }
$statePath = Join-Path $installPath 'install-state.json'
if (Test-Path -LiteralPath $statePath) {
    $state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    if (-not $newerRegistration -and $state.ownsCertificate) { Write-Output 'To remove the development certificate too, run Trust-Certificate.ps1 -CertificatePath ComicLens.WindowsOcr.cer -Remove as Administrator.' }
}
# Keep the directory for review; do not recursively delete a user-supplied location.
Write-Output "Removed bridge registration. You may delete the files in $installPath. Comic Lens settings and history are unchanged."
