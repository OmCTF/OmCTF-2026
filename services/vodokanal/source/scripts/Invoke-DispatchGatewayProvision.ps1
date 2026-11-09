#requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Run,
    [ValidateSet('create','verify', IgnoreCase=$false)][string]$Mode='verify',
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,64}$')][string]$ExpectedVersion,
    [Parameter(Mandatory)][ValidateLength(8,200)][string]$PublicOrigin,
    [ValidateRange(1,1000)][int]$ReadsPerMinute=120,
    [ValidateRange(1,100)][int]$WritesPerMinute=10,
    [ValidateRange(30,300)][int]$TimeoutSeconds=120
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$OriginUri=$null
if (-not [Uri]::TryCreate($PublicOrigin,[UriKind]::Absolute,[ref]$OriginUri) -or
    $OriginUri.Scheme -cnotin @('http','https') -or $OriginUri.UserInfo -ne '' -or
    $OriginUri.GetLeftPart([UriPartial]::Authority) -cne $PublicOrigin -or
    $PublicOrigin -cnotmatch '\Ahttps?://[a-z0-9.\-:\[\]]+\z') {
    throw 'Публичный источник должен быть точным каноническим адресом без пути, учётных данных, запроса и фрагмента.'
}
if (-not $Run) {
    [pscustomobject]@{
        schema=1; state='plan_not_executed'; mode=$Mode; name='vodokanal_intake_gateway'; roleName='ШлюзГостевыхОбращений'
        expectedConfigurationVersion=$ExpectedVersion; publicOrigin=$PublicOrigin; readsPerMinute=$ReadsPerMinute; writesPerMinute=$WritesPerMinute
        nativeRuntimeUsed=$false; secretRead=$false; publicationEnabled=$false
        note='Run only after the matching approved configuration is published. Create never adopts/resets an existing name; verify requires the creation receipt and performs no persistent native write.'
    } | ConvertTo-Json
    return
}
if (-not $IsWindows) { throw 'Локальному адаптеру оператора нужна поддержка закрытых прав доступа Windows.' }
. (Join-Path $PSScriptRoot 'identity/DispatchGateway.Support.ps1')
$Contract=Get-PublicReaderContract
$Owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$System=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$ReceiptPath=Join-Path $Root 'secrets/dispatch-gateway.receipt.json'
$PasswordPath=Join-Path $Root 'secrets/public_dispatch_password.txt'
$OperatorPath=Join-Path $Root 'secrets/native-operator.json'
$Operator=$null; $Password=$null; $SourceKey=$null; $NativeInput=$null; $InputText=$null; $ResultText=$null
$LocalLock=$null; $LocalLockOwned=$false; $OperationId=''
$LockPath=Join-Path $Root 'secrets/.dispatch-gateway-provision.lock'
try {
    Assert-PlainPrivatePath $LockPath
    $LocalLock=[IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($LockPath),[IO.FileMode]::CreateNew,
        [Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,(New-ReceiptSecurity))
    $LocalLockOwned=$true
    Assert-PrivateAcl ([IO.FileSystemAclExtensions]::GetAccessControl($LocalLock))
    Assert-PlainPrivatePath $ReceiptPath
    $Receipt=$null
    if ($Mode -ceq 'create') {
        if ([IO.File]::Exists($ReceiptPath) -or [IO.Directory]::Exists($ReceiptPath)) { throw 'Квитанция создания уже существует.' }
    }
    else {
        $Receipt=ConvertFrom-PublicReaderJson (Read-PrivateText $ReceiptPath 16384)
        Assert-DispatchReceipt $Receipt
    }
    $Compose=@('compose','-f',(Join-Path $Root 'compose.yaml'),'-f',(Join-Path $Root 'compose.gui.yaml'))
    $Container=(Invoke-QuietDocker ($Compose+@('ps','-q','onec'))).Trim()
    $RasContainer=(Invoke-QuietDocker ($Compose+@('ps','-q','ras'))).Trim()
    if ($Container -cnotmatch '\A[a-f0-9]{12,64}\z' -or $RasContainer -cnotmatch '\A[a-f0-9]{12,64}\z') { throw 'Требуется ровно по одному существующему контейнеру сервера 1С и службы администрирования.' }
    $Before=Read-RegistrationBinding
    if ($Mode -ceq 'verify') { Assert-PublicReaderSameBinding $Receipt.target $Before }
    $Operator=ConvertFrom-PublicReaderJson (Read-PrivateText $OperatorPath 16384)
    Assert-PublicReaderKeys $Operator @('schema','administrator','dispatcher')
    Assert-PublicReaderKeys $Operator.administrator @('name','password')
    if ($Operator.schema -isnot [long] -or $Operator.schema -ne 1 -or $Operator.administrator.name -isnot [string] -or
        $Operator.administrator.password -isnot [string] -or $Operator.administrator.name -cnotmatch '\A[A-Za-z0-9._-]{3,64}\z' -or
        $Operator.administrator.password -cnotmatch '\A[A-Za-z0-9_-]{43}\z') { throw 'Учётные данные оператора некорректны.' }
    $OperationId=[guid]::NewGuid().ToString('D')
    $NativeInput=[ordered]@{
        schema=1; purpose=$Contract.purpose; mode=$Mode; operationId=$OperationId; currentVersion=$ExpectedVersion
        target=[ordered]@{server=$Contract.server;ref=$Contract.ref}; password=''; sourceKey=''; expectedNativeId=''
        publicOrigin=$PublicOrigin; readsPerMinute=$ReadsPerMinute; writesPerMinute=$WritesPerMinute
    }
    if ($Mode -ceq 'create') {
        Assert-PlainPrivatePath $PasswordPath
        if (-not [IO.File]::Exists($PasswordPath)) {
            do {
                $Random=[Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
                try { $Password=[Convert]::ToBase64String($Random).Replace('+','-').Replace('/','_') }
                finally { [Array]::Clear($Random,0,$Random.Length) }
            } until (Test-PublicReaderPassword $Password)
            Write-DispatchPrivateText $PasswordPath $Password
        }
        $Password=Read-PrivateText $PasswordPath 64
        if (-not (Test-PublicReaderPassword $Password)) { throw 'Файл пароля шлюза некорректен.' }
        $Random=[Security.Cryptography.RandomNumberGenerator]::GetBytes(32)
        try { $SourceKey=[Convert]::ToHexString($Random).ToLowerInvariant() }
        finally { [Array]::Clear($Random,0,$Random.Length) }
        $NativeInput.password=$Password; $NativeInput.sourceKey=$SourceKey
    }
    else { $NativeInput.expectedNativeId=$Receipt.nativeResult.nativeUserId }
    $Shell=@'
set +x
set -euo pipefail
umask 077
[[ ! -L /run/vodokanal-provision.lock ]]
exec 9>/run/vodokanal-provision.lock
flock -n 9
scratch=/run/vodokanal-dispatch-gateway
[[ ! -e "$scratch" && ! -L "$scratch" ]]
mkdir "$scratch"
cleanup() {
    code=$?
    unset admin_name admin_password native_json
    rm -f -- "$scratch/input.json" "$scratch/startup.txt" "$scratch/client.log" "$scratch/result.log" "$scratch/result.json" 2>/dev/null || code=1
    rmdir -- "$scratch" 2>/dev/null || code=1
    exit "$code"
}
trap cleanup EXIT
chown usr1cv8:grp1cv8 "$scratch"
chmod 0700 "$scratch"
IFS= read -r admin_name
IFS= read -r admin_password
IFS= read -r native_json
[[ "$admin_name" =~ ^[A-Za-z0-9._-]{3,64}$ ]]
[[ "$admin_password" =~ ^[A-Za-z0-9_-]{43}$ ]]
[[ "$native_json" == '{'* && "$native_json" == *'}' ]]
(set -o noclobber; printf '%s\n' "$native_json" > "$scratch/input.json")
printf 'ENTERPRISE /S "%s" /N "%s" /P "%s" /WA- /C VodokanalDispatchGatewayProvision /DisableStartupDialogs /DisableStartupMessages /Out "%s/result.log"\n' \
    'onec:1541\vodokanal' "$admin_name" "$admin_password" "$scratch" > "$scratch/startup.txt"
chown usr1cv8:grp1cv8 "$scratch/input.json" "$scratch/startup.txt"
chmod 0400 "$scratch/input.json" "$scratch/startup.txt"
unset admin_name admin_password native_json
cd "$scratch"
gosu usr1cv8:grp1cv8 env HOME=/home/usr1cv8 LC_ALL=C.UTF-8 LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6 \
    timeout --kill-after=10 __TIMEOUT__ xvfb-run -a -s '-screen 0 1280x800x24 -nolisten tcp' \
    /opt/onec/1cv8 /@ "$scratch/startup.txt" > "$scratch/client.log" 2>&1
[[ -f "$scratch/result.json" && ! -L "$scratch/result.json" ]]
[[ $(wc -c < "$scratch/result.json") -le 16384 ]]
[[ $(id -u usr1cv8) == 10001 && $(id -g usr1cv8) == 10001 ]]
[[ -d "$scratch" && ! -L "$scratch" && $(stat -c '%u:%g:%a' "$scratch") == '10001:10001:700' ]]
[[ $(stat -c '%u:%g:%h' "$scratch/result.json") == '10001:10001:1' ]]
chmod 0600 -- "$scratch/result.json"
[[ $(stat -c '%u:%a' "$scratch/result.json") == "$(id -u usr1cv8):600" ]]
grep -Fq 'dispatch_gateway_provision_completed' "$scratch/result.log"
cat "$scratch/result.json"
'@
    $Shell=$Shell.Replace('__TIMEOUT__',[string]$TimeoutSeconds)
    $InputText=$Operator.administrator.name+[char]10+$Operator.administrator.password+[char]10+($NativeInput|ConvertTo-Json -Depth 5 -Compress)+[char]10
    $ResultText=Invoke-QuietDocker @('exec','-i',$Container,'/bin/bash','-c',$Shell) $InputText 16384
    $Result=ConvertFrom-PublicReaderJson $ResultText
    $ExpectedId=if ($Mode -ceq 'verify') { $Receipt.nativeResult.nativeUserId } else { '' }
    Assert-DispatchResult $Result $Mode $OperationId $ExpectedVersion $ExpectedId
    $After=Read-RegistrationBinding; Assert-PublicReaderSameBinding $Before $After
    if ((Invoke-QuietDocker ($Compose+@('ps','-q','onec'))).Trim() -cne $Container -or
        (Invoke-QuietDocker ($Compose+@('ps','-q','ras'))).Trim() -cne $RasContainer) { throw 'Привязка контейнера изменилась во время настройки.' }
    if ($Mode -ceq 'create') {
        $Completed=[DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",[Globalization.CultureInfo]::InvariantCulture)
        $Receipt=[ordered]@{schema=1;purpose=$Contract.purpose;status='completed';operationId=$OperationId;target=$After;nativeResult=$Result;completedAtUtc=$Completed;helperInputs=$HelperInputs}
        Write-DispatchPrivateText $ReceiptPath ($Receipt|ConvertTo-Json -Depth 8 -Compress)
    }
}
catch { throw 'Операция шлюза диспетчерской не подтверждена. Существующие учётная запись, пароль и квитанция не заменены. Если нативное создание могло выполниться, не повторяйте команду: требуется отдельное восстановление оператором.' }
finally {
    $Operator=$null; $Password=$null; $SourceKey=$null; $NativeInput=$null; $InputText=$null; $ResultText=$null
    if ($null -ne $LocalLock) { $LocalLock.Dispose() }
    if ($LocalLockOwned) { [IO.File]::Delete($LockPath) }
}
[pscustomobject]@{
    schema=1; state=$(if ($Mode -ceq 'create') {'completed'} else {'verified'}); mode=$Mode; operationId=$OperationId
    configurationVersion=$Result.configurationVersion; receiptPath=$ReceiptPath; publicationEnabled=$false
    note='Native UUID, protected settings and RAC binding only. Role-rights XML, HTTP and browser acceptance remain separate. No publication was enabled.'
}|ConvertTo-Json -Depth 4
