<# PostgreSQL + PostgREST + SQLite temporários. Não acessa Supabase/produção. #>
[CmdletBinding()] param([int]$TimeoutSeconds=120,[string]$CleanupRunId='')
$ErrorActionPreference='Stop'
$root=(Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$run=[guid]::NewGuid().ToString('N'); $net="sattva-v2-$run"; $db="sattva-pg-$run"; $api="sattva-pgrst-$run"
$dbName='sattva_homolog'; $dbUser='sattva_homolog'; $pw=([guid]::NewGuid().ToString('N'))+([guid]::NewGuid().ToString('N'))
$authPw=([guid]::NewGuid().ToString('N')); $jwtSecret=([guid]::NewGuid().ToString('N'))+([guid]::NewGuid().ToString('N'))
$envFile=Join-Path ([IO.Path]::GetTempPath()) "sattva-$run.env"; $sqlite=Join-Path ([IO.Path]::GetTempPath()) "sattva-v2-$run"
$reportDir=Join-Path $root "outputs\homologacao-consumidor-real\$run"; $outcome='NÃO EXECUTADO'
$createdDb=$false; $createdApi=$false; $createdNet=$false
$testRun=$null; $originalError=$null
function Finish([string]$s,[int]$c){ Write-Host "$s"; exit $c }
function ConvertTo-WindowsCommandLineArgument([AllowNull()][string]$Value) {
  if($null -eq $Value){$Value=''}
  if($Value.Length -gt 0 -and $Value -notmatch '[\s"]'){return $Value}
  $encoded=New-Object Text.StringBuilder
  [void]$encoded.Append('"'); $backslashes=0
  foreach($character in $Value.ToCharArray()){
    if($character -eq [char]92){$backslashes++; continue}
    if($character -eq [char]34){
      [void]$encoded.Append([char]92,(2*$backslashes)+1); [void]$encoded.Append([char]34); $backslashes=0; continue
    }
    if($backslashes -gt 0){[void]$encoded.Append([char]92,$backslashes); $backslashes=0}
    [void]$encoded.Append($character)
  }
  if($backslashes -gt 0){[void]$encoded.Append([char]92,2*$backslashes)}
  [void]$encoded.Append('"'); return $encoded.ToString()
}
function Invoke-ExternalCapture([string]$File,[string[]]$Arguments) {
  $info=New-Object System.Diagnostics.ProcessStartInfo; $info.FileName=$File
  $info.UseShellExecute=$false; $info.RedirectStandardOutput=$true; $info.RedirectStandardError=$true; $info.CreateNoWindow=$true
  $utf8=New-Object Text.UTF8Encoding($false); $info.StandardOutputEncoding=$utf8; $info.StandardErrorEncoding=$utf8
  $encodedArguments=foreach($argument in $Arguments){ConvertTo-WindowsCommandLineArgument ([string]$argument)}
  $info.Arguments=($encodedArguments -join ' ')
  $process=New-Object System.Diagnostics.Process; $process.StartInfo=$info
  try {
    [void]$process.Start()
    [Threading.Tasks.Task[string]]$outTask=$process.StandardOutput.ReadToEndAsync()
    [Threading.Tasks.Task[string]]$errTask=$process.StandardError.ReadToEndAsync()
    $process.WaitForExit(); [Threading.Tasks.Task]::WaitAll([Threading.Tasks.Task[]]@($outTask,$errTask))
    [pscustomobject]@{stdout=$(if($null -eq $outTask.Result){''}else{[string]$outTask.Result});stderr=$(if($null -eq $errTask.Result){''}else{[string]$errTask.Result});codigo=[int]$process.ExitCode}
  } finally {
    $process.Dispose()
  }
}
function Mask([string]$Text) {
  $safe=if($null -eq $Text){''}else{$Text}
  foreach($secret in @($pw,$authPw,$jwtSecret,$token)){if(-not [string]::IsNullOrEmpty($secret)){$safe=$safe.Replace($secret,'***')}}
  return $safe
}
function Add-CleanupDiagnostic([string]$Resource,[System.Exception]$Exception) {
  $message="Falha adicional em ${Resource}: $($Exception.Message)"
  try { New-Item -ItemType Directory -Path $reportDir -Force|Out-Null; (Mask $message)|Add-Content (Join-Path $reportDir 'coleta-limpeza.erros.log') -Encoding utf8 } catch { Write-Warning (Mask $message) }
}
function RemoverExecucaoAnterior([string]$Id) {
  if([string]::IsNullOrWhiteSpace($Id)){return}
  if($Id -notmatch '^[a-f0-9]{32}$'){throw 'CleanupRunId inválido.'}
  $alvos=@("sattva-pgrst-$Id","sattva-pg-$Id")
  foreach($alvo in $alvos){$existe=Invoke-ExternalCapture $dockerPath @('inspect',$alvo);if($existe.codigo -eq 0){$null=Invoke-ExternalCapture $dockerPath @('rm','-f','-v',$alvo)}}
  $rede=Invoke-ExternalCapture $dockerPath @('network','inspect',"sattva-v2-$Id");if($rede.codigo -eq 0){$null=Invoke-ExternalCapture $dockerPath @('network','rm',"sattva-v2-$Id")}
}
function Wait-PostgresDefinitivo {
  $limite=(Get-Date).AddSeconds($TimeoutSeconds); $sucessosConsecutivos=0; $ultimaCausa='inicialização ainda não concluída'
  while((Get-Date)-lt $limite){
    $estado=Invoke-ExternalCapture $dockerPath @('inspect','--format','{{.State.Status}}|{{.State.Running}}|{{.State.ExitCode}}|{{.State.Error}}',$db)
    if($estado.codigo -ne 0){throw "Não foi possível inspecionar o PostgreSQL: $(Mask $estado.stderr)"}
    $partes=([string]$estado.stdout).Trim().Split('|'); $status=$partes[0]; $running=$partes[1]
    if($running -ne 'true' -or $status -in @('exited','dead','removing')){
      $logsEncerramento=Invoke-ExternalCapture $dockerPath @('logs',$db)
      $causa=(Mask (([string]$logsEncerramento.stdout)+[Environment]::NewLine+([string]$logsEncerramento.stderr)))
      throw "Contêiner PostgreSQL encerrou durante a inicialização ($(([string]$estado.stdout).Trim())). Logs preservados; causa: $causa"
    }
    $logs=Invoke-ExternalCapture $dockerPath @('logs',$db)
    $textoLogs=([string]$logs.stdout)+[Environment]::NewLine+([string]$logs.stderr)
    if($textoLogs -match 'PostgreSQL init process complete; ready for start up\.'){
      $probe=Invoke-ExternalCapture $dockerPath @('exec','-e',"PGPASSWORD=$pw",$db,'psql','-h','127.0.0.1','-U',$dbUser,'-d',$dbName,'-v','ON_ERROR_STOP=1','-Atqc',"select current_database() || '|' || pg_is_in_recovery()::text")
      if($probe.codigo -eq 0 -and ([string]$probe.stdout).Trim() -eq "$dbName|false"){$sucessosConsecutivos++}else{$sucessosConsecutivos=0;$ultimaCausa=(Mask (([string]$probe.stderr).Trim()))}
      if($sucessosConsecutivos -ge 2){return}
    } else {$sucessosConsecutivos=0;$ultimaCausa='servidor auxiliar de initdb ainda ativo'}
    Start-Sleep -Seconds 1
  }
  throw "PostgreSQL definitivo não ficou pronto dentro de $TimeoutSeconds segundos. Última causa: $ultimaCausa"
}
function Cleanup {
  $postgresLog=$null; $postgrestLog=$null
  try { New-Item -ItemType Directory -Path $reportDir -Force|Out-Null } catch { Add-CleanupDiagnostic 'criação do diretório de relatório' $_.Exception }
  try { if($createdDb){$postgresLog=Invoke-ExternalCapture $dockerPath @('logs',$db); (Mask (([string]$postgresLog.stdout)+[Environment]::NewLine+([string]$postgresLog.stderr)))|Set-Content (Join-Path $reportDir 'postgres.log') -Encoding utf8} } catch { Add-CleanupDiagnostic 'coleta do log PostgreSQL' $_.Exception }
  try { if($createdApi){$postgrestLog=Invoke-ExternalCapture $dockerPath @('logs',$api); (Mask (([string]$postgrestLog.stdout)+[Environment]::NewLine+([string]$postgrestLog.stderr)))|Set-Content (Join-Path $reportDir 'postgrest.log') -Encoding utf8} } catch { Add-CleanupDiagnostic 'coleta do log PostgREST' $_.Exception }
  $teste=$null
  $testeJson=Join-Path $reportDir 'teste.json'
  if(Test-Path $testeJson){try{$teste=Get-Content $testeJson -Raw -Encoding utf8|ConvertFrom-Json}catch{Add-CleanupDiagnostic 'leitura de teste.json' $_.Exception}}
  $erroPrincipal=$originalError
  if([string]::IsNullOrWhiteSpace($erroPrincipal) -and $null-ne$teste -and $null-ne$teste.falhos -and $teste.falhos.Count -gt 0){$erroPrincipal=[string]$teste.falhos[0].erro}
  try { [ordered]@{resultado=$outcome;run=$run;erro_original=(Mask $erroPrincipal);teste=$teste;teste_saida=$(if($null -ne $testRun){$testRun.codigo}else{$null});postgres_logs_exit=$(if($null -ne $postgresLog){$postgresLog.codigo}else{$null});postgrest_logs_exit=$(if($null -ne $postgrestLog){$postgrestLog.codigo}else{$null})}|ConvertTo-Json -Depth 12|Set-Content (Join-Path $reportDir 'resultado.json') -Encoding utf8 } catch { Add-CleanupDiagnostic 'gravação de resultado.json' $_.Exception }
  try {if($createdApi){$removeApi=Invoke-ExternalCapture $dockerPath @('rm','-f',$api);if($removeApi.codigo -ne 0){throw (Mask $removeApi.stderr)}}} catch { Add-CleanupDiagnostic 'remoção do PostgREST' $_.Exception }
  try {if($createdDb){$removeDb=Invoke-ExternalCapture $dockerPath @('rm','-f','-v',$db);if($removeDb.codigo -ne 0){throw (Mask $removeDb.stderr)}}} catch { Add-CleanupDiagnostic 'remoção do PostgreSQL' $_.Exception }
  try {if($createdNet){$removeNet=Invoke-ExternalCapture $dockerPath @('network','rm',$net);if($removeNet.codigo -ne 0){throw (Mask $removeNet.stderr)}}} catch { Add-CleanupDiagnostic 'remoção da rede Docker' $_.Exception }
  try {if(Test-Path $envFile){Remove-Item $envFile -Force -ErrorAction Stop}} catch { Add-CleanupDiagnostic 'remoção do arquivo temporário de ambiente' $_.Exception }
  try {if(Test-Path $sqlite){Remove-Item $sqlite -Recurse -Force -ErrorAction Stop}} catch { Add-CleanupDiagnostic 'remoção do SQLite temporário' $_.Exception }
}
try {
 Set-Location $root
 if(!(Get-Command docker -ErrorAction SilentlyContinue)){Finish 'NÃO EXECUTADO - Instale e inicie Docker Desktop.' 2}
 $dockerPath=(Get-Command docker -ErrorAction Stop).Source
 docker version --format '{{.Server.Version}}' *> $null; if($LASTEXITCODE -ne 0){Finish 'NÃO EXECUTADO - Abra Docker Desktop e aguarde o daemon ficar pronto.' 2}
 RemoverExecucaoAnterior $CleanupRunId
 if(!(Get-Command node -ErrorAction SilentlyContinue)){Finish 'NÃO EXECUTADO - Node.js não está disponível.' 2}
 & node -e "require.resolve('pg');require.resolve('@supabase/supabase-js')" *> $null; if($LASTEXITCODE -ne 0){Finish 'NÃO EXECUTADO - Execute npm ci no repositório.' 2}
 [IO.File]::WriteAllLines($envFile,[string[]]@("POSTGRES_DB=$dbName","POSTGRES_USER=$dbUser","POSTGRES_PASSWORD=$pw"),[Text.UTF8Encoding]::new($false))
 docker network create $net *> $null; if($LASTEXITCODE -ne 0){throw 'Não foi possível criar a rede Docker temporária.'}; $createdNet=$true
 docker run -d --name $db --label sattva.homologacao=consumidor-real --label "sattva.run=$run" --network $net --env-file $envFile -p '127.0.0.1::5432' --health-cmd "pg_isready -U $dbUser -d $dbName" --health-interval 2s --health-timeout 3s --health-retries 30 postgres:16-alpine *> $null; if($LASTEXITCODE -ne 0){throw 'Não foi possível iniciar PostgreSQL.'}; $createdDb=$true
 Wait-PostgresDefinitivo
 $roles=Invoke-ExternalCapture $dockerPath @('exec','-e',"PGPASSWORD=$pw",$db,'psql','-h','127.0.0.1','-U',$dbUser,'-d',$dbName,'-v','ON_ERROR_STOP=1','-1','-c',"create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls; create role authenticator login password '$authPw'; grant anon,authenticated,service_role to authenticator; grant usage on schema public to authenticator,anon,authenticated,service_role;")
 if($roles.codigo -ne 0){throw "Falha transacional ao preparar os papéis locais: $(Mask $roles.stderr)"}
 $env:HOMOLOG_JWT_SECRET=$jwtSecret
 $token=& node -e "const c=require('crypto');const s=process.env.HOMOLOG_JWT_SECRET;const b=x=>Buffer.from(JSON.stringify(x)).toString('base64url');const h=b({alg:'HS256',typ:'JWT'}),p=b({role:'service_role',exp:Math.floor(Date.now()/1000)+3600});process.stdout.write(h+'.'+p+'.'+c.createHmac('sha256',s).update(h+'.'+p).digest('base64url'))"
 docker run -d --name $api --label sattva.homologacao=consumidor-real --label "sattva.run=$run" --network $net -p '127.0.0.1::3000' -e "PGRST_DB_URI=postgresql://authenticator:$authPw@${db}:5432/$dbName" -e 'PGRST_DB_SCHEMAS=public' -e 'PGRST_DB_ANON_ROLE=anon' -e "PGRST_JWT_SECRET=$jwtSecret" postgrest/postgrest:v12.2.3 *> $null; if($LASTEXITCODE -ne 0){throw 'Não foi possível iniciar PostgREST.'}; $createdApi=$true
 $until=(Get-Date).AddSeconds($TimeoutSeconds); do { $state=(docker inspect --format '{{.State.Status}}' $api).Trim(); if($state -eq 'running'){break}; Start-Sleep 2 } while((Get-Date)-lt $until)
 if($state -ne 'running'){throw 'PostgREST não iniciou dentro do timeout.'}
 $pgPort=([regex]::Match((docker port $db 5432/tcp | Select-Object -First 1),':(\d+)$')).Groups[1].Value; $apiPort=([regex]::Match((docker port $api 3000/tcp | Select-Object -First 1),':(\d+)$')).Groups[1].Value
 New-Item -ItemType Directory -Path $sqlite -Force|Out-Null
 New-Item -ItemType Directory -Path $reportDir -Force|Out-Null
 $env:HOMOLOG_POSTGRES_URL="postgresql://${dbUser}:${pw}@127.0.0.1:${pgPort}/${dbName}?sslmode=disable"; $env:SUPABASE_URL="http://127.0.0.1:$apiPort"; $env:SUPABASE_SERVICE_ROLE_KEY=$token; $env:SATTVA_DADOS=$sqlite; $env:SINCRONIZACAO_CONSUMIDOR_ID="homolog-$run"; $env:HOMOLOG_JWT_SECRET=$jwtSecret
 $env:HOMOLOG_RESULTADO_JSON=Join-Path $reportDir 'teste.json'; $env:HOMOLOG_RPC_TRACE_JSONL=Join-Path $reportDir 'rpc-trace.jsonl'
 $testRun=Invoke-ExternalCapture 'node' @('.\scripts\homologar_consumidor_v2_real.js'); $code=$testRun.codigo
 (Mask ([string]$testRun.stdout))|Set-Content (Join-Path $reportDir 'teste.stdout.log') -Encoding utf8
 (Mask ([string]$testRun.stderr))|Set-Content (Join-Path $reportDir 'teste.stderr.log') -Encoding utf8
 if(-not (Test-Path $env:HOMOLOG_RESULTADO_JSON)){ Add-CleanupDiagnostic 'gravação do resultado estruturado do teste' (New-Object InvalidOperationException 'O processo de homologação não produziu teste.json.') }
 if($code -eq 0){$outcome='APROVADO';Finish "APROVADO - Consumidor real, PostgREST e SQLite temporário homologados. Logs: $reportDir" 0}; $outcome='REPROVADO';Finish "REPROVADO - Consulte JSON e logs em $reportDir; recursos temporários foram removidos." $code
} catch { $outcome='NÃO EXECUTADO'; $originalError=$_.Exception.ToString(); Finish "NÃO EXECUTADO - $($_.Exception.Message)" 2 } finally {
  try { Cleanup } catch { Write-Warning "Falha adicional na coleta/limpeza (erro original preservado): $($_.Exception.Message)" }
}
