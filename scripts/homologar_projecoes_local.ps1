<#
  Homologação local e descartável da proteção contra leitura global.
  Não acessa Supabase, Render nem qualquer banco de produção.
#>
[CmdletBinding()]
param(
  [string]$ImagemPostgres = 'postgres:16-alpine',
  [string]$NomeContainer = ('sattva-homologacao-' + [guid]::NewGuid().ToString('N').Substring(0, 12)),
  [switch]$ManterContainer
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

$raiz = Split-Path -Parent $PSScriptRoot
Set-Location $raiz

$migration = Join-Path $raiz 'supabase\migrations\20261019_fonte_unica_projecoes_movimentos.sql'
if (-not (Test-Path -LiteralPath $migration)) {
  throw "Migration não encontrada: $migration"
}

function Invoke-Checked {
  param([string]$Descricao, [scriptblock]$Acao)
  Write-Host "`n==> $Descricao" -ForegroundColor Cyan
  & $Acao
  if ($LASTEXITCODE -ne 0) { throw "$Descricao falhou (exit code $LASTEXITCODE)." }
}

function Wait-Postgres {
  param([string]$Container)
  for ($tentativa = 1; $tentativa -le 60; $tentativa++) {
    $estado = (& docker inspect --format '{{.State.Health.Status}}' $Container 2>$null).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Container descartável deixou de existir durante a inicialização: $Container" }
    if ($estado -eq 'healthy') { return }
    if ($estado -eq 'unhealthy') { throw "PostgreSQL descartável ficou unhealthy. Consulte os logs abaixo." }
    Start-Sleep -Seconds 1
  }
  throw 'PostgreSQL descartável não ficou healthy em 60 segundos.'
}

$sucesso = $false
$arquivoValidacao = $null
try {
  Invoke-Checked 'Validar Docker Engine' { docker info --format '{{.ServerVersion}} | {{.OperatingSystem}}' }
  Invoke-Checked 'Validar contexto Docker' { docker context ls }

  Invoke-Checked 'Criar PostgreSQL descartável de homologação' {
    docker run --detach --rm --name $NomeContainer `
      --label sattva.homologacao=true `
      --label sattva.efemero=true `
      -e POSTGRES_USER=sattva `
      -e POSTGRES_PASSWORD=sattva_homologacao_local `
      -e POSTGRES_DB=sattva_homologacao `
      --health-cmd 'pg_isready -U sattva -d sattva_homologacao || exit 1' `
      --health-interval 1s `
      --health-timeout 3s `
      --health-retries 60 `
      --health-start-period 5s `
      $ImagemPostgres
  }

  Write-Host '==> Aguardar PostgreSQL descartável' -ForegroundColor Cyan
  Wait-Postgres -Container $NomeContainer

  # A migration é aditiva e pressupõe o esquema operacional já existente no
  # Supabase. O banco efêmero nasce vazio; este bootstrap reproduz somente as
  # relações e colunas das quais ela depende, sem dados de produção.
  Invoke-Checked 'Criar esquema-base mínimo de homologação' {
    docker exec $NomeContainer psql -v ON_ERROR_STOP=1 -U sattva -d sattva_homologacao -c @'
create table public.empresas (id bigint primary key);
create table public.parceiros (id bigint primary key, empresa_id bigint, inscr_federal text, regime text);
create table public.movimentos (id bigint primary key, empresa_id bigint, parceiro_id bigint, regime text);
create table public.motor_resultados_operacionais (id bigint primary key, empresa_id bigint, movimento_id bigint);
create table public.jobs_carteira (
  id uuid primary key,
  empresa_id bigint not null,
  tipo_job text not null,
  status text not null,
  erro text,
  payload jsonb not null default '{}'::jsonb
);
'@
  }

  Invoke-Checked 'Copiar migration para o PostgreSQL descartável' {
    docker cp $migration "${NomeContainer}:/tmp/migration.sql"
  }

  Invoke-Checked 'Aplicar migration no PostgreSQL descartável' {
    docker exec $NomeContainer psql -v ON_ERROR_STOP=1 -U sattva -d sattva_homologacao -f /tmp/migration.sql
  }

  Invoke-Checked 'Confirmar objetos criados pela migration' {
    docker exec $NomeContainer psql -v ON_ERROR_STOP=1 -U sattva -d sattva_homologacao -c "SELECT to_regclass('public.projecoes_movimentos_estado') AS projecoes, to_regclass('public.movimento_decisoes_fiscais') AS decisoes;"
  }

  Invoke-Checked 'Validar trigger de falha da projeção' {
    $arquivoValidacao = Join-Path $env:TEMP ('sattva-validar-trigger-' + [guid]::NewGuid().ToString('N') + '.sql')
    @'
insert into public.empresas(id) values(1);
insert into public.movimentos(id,empresa_id) values(1,1);
insert into public.projecoes_movimentos_estado(empresa_id,movimento_id,assinatura_origem,situacao)
values(1,1,'assinatura-fixture','ATUALIZACAO_PENDENTE');
insert into public.jobs_carteira(id,empresa_id,tipo_job,status,erro,payload)
values('00000000-0000-0000-0000-000000000001',1,'MOTOR_INCREMENTAL','PROCESSANDO','falha fixture','{"movimento_ids":[1]}'::jsonb);
update public.jobs_carteira set status='FALHOU'
where id='00000000-0000-0000-0000-000000000001';
do $$
begin
  if (select situacao from public.projecoes_movimentos_estado where empresa_id=1 and movimento_id=1) <> 'FALHOU' then
    raise exception 'Trigger não marcou a projeção como FALHOU';
  end if;
end $$;
select situacao,motivo from public.projecoes_movimentos_estado where empresa_id=1 and movimento_id=1;
'@ | Set-Content -LiteralPath $arquivoValidacao -Encoding utf8
    docker cp $arquivoValidacao "${NomeContainer}:/tmp/validar-trigger.sql"
    docker exec $NomeContainer psql -v ON_ERROR_STOP=1 -U sattva -d sattva_homologacao -f /tmp/validar-trigger.sql
  }

  $testes = @(
    'testes/fonte-unica-projecoes.test.js',
    'testes/worker-incremental-falha-projecao.test.js',
    'testes/worker-incremental-reprocessamento.test.js',
    'testes/protecao-carteira-global.test.js',
    'testes/leitura-analitica-limitada.test.js',
    'testes/homologacao-fonte-unica-relotec.test.js'
  )

  foreach ($teste in $testes) {
    Invoke-Checked "Executar $teste" { node $teste }
  }

  Invoke-Checked 'Auditoria estática de leituras amplas' { node scripts/auditar_leituras_amplas.js }
  Invoke-Checked 'Validar diff' { git diff --check }

  $sucesso = $true
  Write-Host "`nAPROVADO - Homologação local concluída. Container: $NomeContainer" -ForegroundColor Green
} catch {
  Write-Host "`n==> Logs do PostgreSQL descartável após falha" -ForegroundColor Yellow
  & docker logs $NomeContainer
  throw
} finally {
  if ($arquivoValidacao -and (Test-Path -LiteralPath $arquivoValidacao)) {
    Remove-Item -LiteralPath $arquivoValidacao -Force
  }
  if (-not $ManterContainer) {
    & docker rm -f $NomeContainer *> $null
    if ($LASTEXITCODE -eq 0) { Write-Host "Container descartável removido: $NomeContainer" -ForegroundColor DarkGray }
  } elseif (-not $sucesso) {
    Write-Warning "Falha preservada para diagnóstico no container: $NomeContainer"
  }
}
