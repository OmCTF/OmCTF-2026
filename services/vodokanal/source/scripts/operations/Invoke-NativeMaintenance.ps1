#requires -Version 7.0
[CmdletBinding()]
param([ValidateSet('Status','Enable','Disable','Once')][string]$Mode='Status',
    [ValidateRange(30,300)][int]$TimeoutSeconds=120,[switch]$Execute)
. (Join-Path $PSScriptRoot 'Operations.Support.ps1')
$Root = $OperationsRoot
if (-not $Execute) { [pscustomobject]@{action='native-maintenance';mode=$Mode;execute=$false;target='onec:1541\vodokanal';note='Native Administrator only. Once can rotate expired operational data.'}; return }
if (-not $IsWindows) { throw 'Закрытый файл нативного оператора требует проверки прав доступа Windows.' }
. (Join-Path $Root 'scripts/identity/HydrologyReader.Support.ps1')
$Owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$System = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$stack = Get-OperationsStack
$Compose = @('compose','-f',(Join-Path $Root 'compose.yaml'),'-f',(Join-Path $Root 'compose.gui.yaml'))
$RasContainer = (Invoke-QuietDocker ($Compose + @('ps','-q','ras'))).Trim()
$before = Read-RegistrationBinding
$operator = $null; $inputText = $null
try {
    $operator = ConvertFrom-PublicReaderJson (Read-PrivateText (Join-Path $Root 'secrets/native-operator.json') 16384)
    if ($operator.administrator.name -isnot [string] -or $operator.administrator.name -cnotmatch '^[A-Za-z0-9._-]{3,64}$' -or
        $operator.administrator.password -isnot [string] -or $operator.administrator.password -cnotmatch '^[A-Za-z0-9_-]{43}$') { throw 'Закрытые входные данные нативного оператора некорректны.' }
    $token = 'VodokanalMaintenance' + $Mode
    $shell = @'
set +x
set -euo pipefail
umask 077
[[ ! -L /run/vodokanal-provision.lock ]]
exec 9>/run/vodokanal-provision.lock
flock -n 9
scratch=/run/vodokanal-maintenance
[[ ! -e "$scratch" && ! -L "$scratch" ]]
mkdir "$scratch"
cleanup() {
  code=$?
  unset admin_name admin_password
  rm -f -- "$scratch/startup.txt" "$scratch/client.log" "$scratch/result.log" "$scratch/result.json" 2>/dev/null || code=1
  rmdir -- "$scratch" 2>/dev/null || code=1
  exit "$code"
}
trap cleanup EXIT
chown usr1cv8:grp1cv8 "$scratch"
chmod 0700 "$scratch"
IFS= read -r admin_name
IFS= read -r admin_password
[[ "$admin_name" =~ ^[A-Za-z0-9._-]{3,64}$ ]]
[[ "$admin_password" =~ ^[A-Za-z0-9_-]{43}$ ]]
printf 'ENTERPRISE /S "%s" /N "%s" /P "%s" /WA- /C __TOKEN__ /DisableStartupDialogs /DisableStartupMessages /Out "%s/result.log"\n' \
  'onec:1541\vodokanal' "$admin_name" "$admin_password" "$scratch" > "$scratch/startup.txt"
chown usr1cv8:grp1cv8 "$scratch/startup.txt"
chmod 0400 "$scratch/startup.txt"
unset admin_name admin_password
cd "$scratch"
gosu usr1cv8:grp1cv8 env HOME=/home/usr1cv8 LC_ALL=C.UTF-8 LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6 \
  timeout --kill-after=10 __TIMEOUT__ xvfb-run -a -s '-screen 0 1280x800x24 -nolisten tcp' \
  /opt/onec/1cv8 /@ "$scratch/startup.txt" > "$scratch/client.log" 2>&1
[[ -f "$scratch/result.json" && ! -L "$scratch/result.json" ]]
[[ $(wc -c < "$scratch/result.json") -le 65536 ]]
grep -Fq 'operations_completed' "$scratch/result.log"
cat "$scratch/result.json"
'@
    $shell = $shell.Replace('__TOKEN__',$token).Replace('__TIMEOUT__',[string]$TimeoutSeconds)
    $inputText = $operator.administrator.name + [char]10 + $operator.administrator.password + [char]10
    $result = Invoke-QuietDocker @('exec','-i',$stack.Onec,'/bin/bash','-c',$shell) $inputText 65536 | ConvertFrom-Json -AsHashtable
    if ($result.schema -ne 'vodokanal.maintenance.v1' -or $result.command -cne $token) { throw 'Квитанция нативного обслуживания не соответствует запрошенной команде.' }
    $after = Read-RegistrationBinding; Assert-PublicReaderSameBinding $before $after
    $current = Get-OperationsStack
    if ($current.Onec -cne $stack.Onec -or $current.Db -cne $stack.Db) { throw 'Идентификатор контейнера изменился.' }
    $reportPath = Join-Path $Root ('backups/maintenance-' + [guid]::NewGuid().ToString('N') + '.json')
    [void][IO.Directory]::CreateDirectory((Split-Path -Parent $reportPath))
    Write-OperationsManifest $reportPath $result
    Write-Output $reportPath
}
finally { $operator = $null; $inputText = $null }
