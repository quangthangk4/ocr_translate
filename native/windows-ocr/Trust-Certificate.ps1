param([Parameter(Mandatory = $true)][string]$CertificatePath, [switch]$Remove)
$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator approval is required for MSIX certificate trust.' }
$certificate = [System.Security.Cryptography.X509Certificates.X509Certificate2]::new([IO.Path]::GetFullPath($CertificatePath))
if ($certificate.Subject -ne 'CN=Comic Lens Personal') { throw 'Unexpected bridge certificate.' }
$store = [System.Security.Cryptography.X509Certificates.X509Store]::new('TrustedPeople', [System.Security.Cryptography.X509Certificates.StoreLocation]::LocalMachine)
$store.Open([System.Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
try {
    if ($Remove) {
        foreach ($existing in @($store.Certificates | Where-Object { $_.Thumbprint -eq $certificate.Thumbprint })) { $store.Remove($existing) }
    } else { $store.Add($certificate) }
} finally { $store.Close(); $certificate.Dispose() }
