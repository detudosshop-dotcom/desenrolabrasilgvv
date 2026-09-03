
$source = "c:\Users\paulo\Desktop\solicitacao-saque\regularizabrasil";
$dest = "c:\Users\paulo\Desktop\regularizabrasil_completo.zip";
$localDest = "c:\Users\paulo\Desktop\solicitacao-saque\regularizabrasil\regularizabrasil_completo.zip";

$exclude = @('node_modules', '.git', '*.zip');
$files = Get-ChildItem -Path $source -Recurse | Where-Object {
    $item = $_;
    $shouldExclude = $false;
    if ($item.FullName -match 'node_modules|\.git|\.zip$') {
        $shouldExclude = $true;
    }
    -not $shouldExclude;
};

if (Test-Path $dest) { Remove-Item $dest -Force }
if (Test-Path $localDest) { Remove-Item $localDest -Force }

Compress-Archive -Path "c:\Users\paulo\Desktop\solicitacao-saque\regularizabrasil\*" -DestinationPath $dest -CompressionLevel Optimal;
Copy-Item -Path $dest -Destination $localDest -Force;

$size = (Get-Item $dest).Length / 1MB;
Write-Host "SIZE_MB: $size";
