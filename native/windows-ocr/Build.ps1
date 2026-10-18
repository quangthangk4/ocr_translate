param([string]$SdkTools = (Join-Path $PSScriptRoot '..\..\.native-tools\sdk\bin\10.0.26100.0\x64'))
$ErrorActionPreference = 'Stop'
$outDir = Join-Path $PSScriptRoot 'dist'
$packageDir = Join-Path $PSScriptRoot 'build\identity'
New-Item -ItemType Directory -Path $outDir, (Join-Path $packageDir 'Assets') -Force | Out-Null
$framework = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
$refs = @('System.dll','System.Core.dll','System.Web.Extensions.dll','System.Runtime.WindowsRuntime.dll') | ForEach-Object { '/r:' + (Join-Path $framework $_) }
$refs += Get-ChildItem (Join-Path $env:WINDIR 'System32\WinMetadata\*.winmd') | ForEach-Object { '/r:' + $_.FullName }
foreach ($assembly in @('System.Runtime','System.Runtime.InteropServices.WindowsRuntime','System.ObjectModel','System.Threading.Tasks')) {
    $dll = Get-ChildItem (Join-Path $env:WINDIR "Microsoft.NET\assembly\GAC_MSIL\$assembly") -Filter "$assembly.dll" -Recurse | Select-Object -First 1
    if ($dll) { $refs += '/r:' + $dll.FullName }
}
& (Join-Path $framework 'csc.exe') /nologo /target:exe /platform:anycpu /optimize+ "/out:$outDir\ComicLens.WindowsOcr.exe" "/win32manifest:$PSScriptRoot\Host.manifest" @refs (Join-Path $PSScriptRoot 'Host.cs')
if ($LASTEXITCODE -ne 0) { throw 'Native host compilation failed.' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'AppxManifest.xml') -Destination $packageDir -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\public\icons\128.png') -Destination (Join-Path $packageDir 'Assets\logo.png') -Force
& (Join-Path $SdkTools 'makeappx.exe') pack /o /nv /d $packageDir /p (Join-Path $outDir 'ComicLens.WindowsOcr.msix')
if ($LASTEXITCODE -ne 0) { throw 'MSIX packaging failed. Supply -SdkTools with the Windows SDK tool directory.' }
# Personal development certificate, generated without writing to any certificate store.
# The private PFX remains in ignored build/ and is NEVER included in the delivery ZIP.
$pfxPath = Join-Path $PSScriptRoot 'build\signer.pfx'
if (-not (Test-Path -LiteralPath $pfxPath)) {
    $rsa = [System.Security.Cryptography.RSACng]::new(2048)
    $request = [System.Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=Comic Lens Personal', $rsa, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($false, $false, 0, $true))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new([System.Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature, $true))
    $oids = [System.Security.Cryptography.OidCollection]::new()
    [void]$oids.Add([System.Security.Cryptography.Oid]::new('1.3.6.1.5.5.7.3.3'))
    $request.CertificateExtensions.Add([System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension]::new($oids, $true))
    $cert = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddDays(-1), [DateTimeOffset]::UtcNow.AddYears(3))
    [IO.File]::WriteAllBytes($pfxPath, $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pfx, 'ComicLensLocalBuild'))
    $rsa.Dispose()
}
$cert = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new($pfxPath, 'ComicLensLocalBuild', [System.Security.Cryptography.X509Certificates.X509KeyStorageFlags]::EphemeralKeySet)
[IO.File]::WriteAllBytes((Join-Path $outDir 'ComicLens.WindowsOcr.cer'), $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Cert))
& (Join-Path $SdkTools 'signtool.exe') sign /fd SHA256 /f $pfxPath /p ComicLensLocalBuild (Join-Path $outDir 'ComicLens.WindowsOcr.msix') (Join-Path $outDir 'ComicLens.WindowsOcr.exe')
if ($LASTEXITCODE -ne 0) { throw 'MSIX signing failed.' }
$cert.Dispose()
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install.ps1'), (Join-Path $PSScriptRoot 'Uninstall.ps1'), (Join-Path $PSScriptRoot 'Trust-Certificate.ps1'), (Join-Path $PSScriptRoot 'Install.cmd') -Destination $outDir -Force
Write-Output "Native host and signed identity package built in $outDir"
