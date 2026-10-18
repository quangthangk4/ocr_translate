$ErrorActionPreference = 'Stop'
$dist = Join-Path $PSScriptRoot 'dist'
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'Install.ps1'), (Join-Path $PSScriptRoot 'Uninstall.ps1'), (Join-Path $PSScriptRoot 'Trust-Certificate.ps1'), (Join-Path $PSScriptRoot 'Install.cmd') -Destination $dist -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '..\..\docs\WINDOWS_OCR.md') -Destination (Join-Path $dist 'README.md') -Force
$files = @('ComicLens.WindowsOcr.exe', 'ComicLens.WindowsOcr.msix', 'ComicLens.WindowsOcr.cer', 'Install.ps1', 'Install.cmd', 'Uninstall.ps1', 'Trust-Certificate.ps1', 'README.md') | ForEach-Object { Join-Path $dist $_ }
foreach ($file in $files) { if (-not (Test-Path -LiteralPath $file)) { throw "Missing $file. Run windows:build first." } }
$output = Join-Path $PSScriptRoot '..\..\.output'
New-Item -ItemType Directory -Path $output -Force | Out-Null
Compress-Archive -LiteralPath $files -DestinationPath (Join-Path $output 'comic-lens-windows-ocr-1.0.0.zip') -Force
Write-Output 'Packaged Windows OCR bridge (no private keys or SDK tools).'
