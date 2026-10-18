$ErrorActionPreference = 'Stop'
$env:RUN_WINDOWS_OCR = '1'
& node (Join-Path $PSScriptRoot '..\..\node_modules\@playwright\test\cli.js') test --grep 'Windows OCR'
exit $LASTEXITCODE
