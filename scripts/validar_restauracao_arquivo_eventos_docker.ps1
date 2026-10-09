param([switch]$Benchmark)
$ErrorActionPreference='Stop'
$id=[guid]::NewGuid().ToString('N')
$container="sattva-restaura-eventos-$id"
$porta=15439
$manifesto=Join-Path $PSScriptRoot '..\outputs\arquivo-sincronizacao-operacional-pre-v2\sincronizacao_operacional_eventos-7-21380482.manifesto.json'
try {
  docker run --name $container --shm-size=1g -e POSTGRES_PASSWORD=homologacao -e POSTGRES_DB=restauracao -p "${porta}:5432" -d postgres:16-alpine | Out-Null
  $pronto=$false
  for($i=0;$i -lt 60;$i++){
    docker exec $container pg_isready -U postgres -d restauracao 2>$null | Out-Null
    if($LASTEXITCODE -eq 0){$pronto=$true;break}
    Start-Sleep -Seconds 1
  }
  if(-not $pronto){throw 'PostgreSQL descartável não ficou pronto.'}
  $env:ARCHIVE_RESTORE_POSTGRES_URL="postgresql://postgres:homologacao@127.0.0.1:$porta/restauracao"
  $env:ARCHIVE_BENCHMARK_CLEANUP=$(if($Benchmark){'1'}else{'0'})
  node (Join-Path $PSScriptRoot 'validar_restauracao_arquivo_eventos.js') $manifesto
  if($LASTEXITCODE -ne 0){throw "Validação falhou com código $LASTEXITCODE."}
} finally {
  Remove-Item Env:ARCHIVE_RESTORE_POSTGRES_URL -ErrorAction SilentlyContinue
  Remove-Item Env:ARCHIVE_BENCHMARK_CLEANUP -ErrorAction SilentlyContinue
  docker rm -f $container 2>$null | Out-Null
}
