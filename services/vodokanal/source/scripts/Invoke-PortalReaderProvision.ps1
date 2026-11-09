#requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Run,
    [Parameter(Mandatory)][ValidatePattern('^[A-Za-z0-9._-]{1,64}$')][string]$ExpectedVersion,
    [ValidateRange(30,300)][int]$TimeoutSeconds=120
)
Set-StrictMode -Version Latest
$ErrorActionPreference='Stop'
$Root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Run) {
    [pscustomobject]@{schema=1;state='plan_not_executed';mode='create';name='vodokanal_portal_reader';roleName='ПубличноеЧтениеПортала';expectedConfigurationVersion=$ExpectedVersion;nativeRuntimeUsed=$false;secretRead=$false;publicationEnabled=$false;note='ExpectedVersion must come from the approved release manifest. Run is create-only and never resets or adopts an existing name.'}|ConvertTo-Json
    return
}
if (-not $IsWindows) { throw 'Локальному адаптеру оператора нужна поддержка закрытых прав доступа Windows.' }
. (Join-Path $PSScriptRoot 'identity/PortalReader.Support.ps1')
$Contract=Get-PublicReaderContract
$Owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$System=[Security.Principal.SecurityIdentifier]::new('S-1-5-18')
$ReceiptPath=Join-Path $Root 'secrets/portal-public-reader.receipt.json'
$PasswordPath=Join-Path $Root 'secrets/public_portal_password.txt'
$OperatorPath=Join-Path $Root 'secrets/native-operator.json'
$Operator=$null;$Password=$null;$NativeInput=$null;$InputText=$null;$ResultText=$null
function Write-NewPrivateText([string]$Path,[string]$Text) {
    Assert-PlainPrivatePath $Path
    $Stream=$null;$Bytes=$null
    try {
        $Stream=[IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($Path),[IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,[IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,(New-ReceiptSecurity))
        Assert-PrivateAcl ([IO.FileSystemAclExtensions]::GetAccessControl($Stream))
        $Bytes=[Text.UTF8Encoding]::new($false).GetBytes($Text);$Stream.Write($Bytes,0,$Bytes.Length);$Stream.Flush($true)
    } finally {if($null -ne $Stream){$Stream.Dispose()};if($null -ne $Bytes){[Array]::Clear($Bytes,0,$Bytes.Length)}}
}
try {
    Assert-PlainPrivatePath $ReceiptPath;Assert-PlainPrivatePath $PasswordPath
    if ([IO.File]::Exists($ReceiptPath) -or [IO.Directory]::Exists($ReceiptPath)) { throw 'Квитанция уже существует.' }
    $Compose=@('compose','-f',(Join-Path $Root 'compose.yaml'),'-f',(Join-Path $Root 'compose.gui.yaml'))
    $Container=(Invoke-QuietDocker ($Compose+@('ps','-q','onec'))).Trim()
    $RasContainer=(Invoke-QuietDocker ($Compose+@('ps','-q','ras'))).Trim()
    if ($Container -cnotmatch '\A[a-f0-9]{12,64}\z' -or $RasContainer -cnotmatch '\A[a-f0-9]{12,64}\z') { throw 'Требуется ровно по одному существующему контейнеру сервера 1С и службы администрирования.' }
    $Before=Read-RegistrationBinding
    $Operator=ConvertFrom-PublicReaderJson (Read-PrivateText $OperatorPath 16384)
    Assert-PublicReaderKeys $Operator @('schema','administrator','dispatcher')
    Assert-PublicReaderKeys $Operator.administrator @('name','password')
    if ($Operator.schema -ne 1 -or $Operator.administrator.name -isnot [string] -or
        $Operator.administrator.password -isnot [string] -or $Operator.administrator.name -cnotmatch '\A[A-Za-z0-9._-]{3,64}\z' -or
        $Operator.administrator.password -cnotmatch '\A[A-Za-z0-9_-]{43}\z') { throw 'Учётные данные оператора некорректны.' }
    if (-not [IO.File]::Exists($PasswordPath)) {
        do {$Random=[Security.Cryptography.RandomNumberGenerator]::GetBytes(48);try{$Password=[Convert]::ToBase64String($Random).Replace('+','-').Replace('/','_')}finally{[Array]::Clear($Random,0,$Random.Length)}}until(Test-PublicReaderPassword $Password)
        Write-NewPrivateText $PasswordPath $Password
    }
    $Password=Read-PrivateText $PasswordPath 64
    if(-not(Test-PublicReaderPassword $Password)){throw 'Файл пароля читателя некорректен.'}
    $OperationId=[guid]::NewGuid().ToString('D')
    $NativeInput=[ordered]@{schema=1;purpose=$Contract.purpose;mode='create';operationId=$OperationId;currentVersion=$ExpectedVersion;target=[ordered]@{server=$Contract.server;ref=$Contract.ref};password=$Password}
    $Shell=@'
set +x
set -euo pipefail
umask 077
[[ ! -L /run/vodokanal-provision.lock ]]
exec 9>/run/vodokanal-provision.lock
flock -n 9
scratch=/run/vodokanal-portal-reader
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
printf 'ENTERPRISE /S "%s" /N "%s" /P "%s" /WA- /C VodokanalPortalReaderCreate /DisableStartupDialogs /DisableStartupMessages /Out "%s/result.log"\n' \
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
grep -Fq 'portal_reader_create_completed' "$scratch/result.log"
cat "$scratch/result.json"
'@
    $Shell=$Shell.Replace('__TIMEOUT__',[string]$TimeoutSeconds)
    $InputText=$Operator.administrator.name+[char]10+$Operator.administrator.password+[char]10+($NativeInput|ConvertTo-Json -Depth 5 -Compress)+[char]10
    $ResultText=Invoke-QuietDocker @('exec','-i',$Container,'/bin/bash','-c',$Shell) $InputText 16384
    $Result=ConvertFrom-PublicReaderJson $ResultText
    Assert-PublicReaderKeys $Result @('schema','purpose','mode','operationId','status','name','nativeUserId','roleName','configurationVersion','checkedAtUtc','server','ref','standardAuth','osAuth','showInList')
    Assert-PublicReaderUuid $Result.nativeUserId;Assert-PublicReaderUtc $Result.checkedAtUtc
    if ($Result.schema -ne 1 -or $Result.purpose -cne $Contract.purpose -or $Result.mode -cne 'create' -or
        $Result.operationId -cne $OperationId -or $Result.status -cne 'created' -or $Result.name -cne $Contract.name -or
        $Result.roleName -cne $Contract.roleName -or $Result.configurationVersion -cne $ExpectedVersion -or
        $Result.server -cne $Contract.server -or $Result.ref -cne $Contract.ref -or
        $Result.standardAuth -isnot [bool] -or -not $Result.standardAuth -or $Result.osAuth -isnot [bool] -or
        $Result.osAuth -or $Result.showInList -isnot [bool] -or $Result.showInList) { throw 'Привязка нативного результата не совпадает.' }
    $After=Read-RegistrationBinding;Assert-PublicReaderSameBinding $Before $After
    $Receipt=[ordered]@{schema=1;purpose=$Contract.purpose;status='completed';operationId=$OperationId;target=$After;nativeResult=$Result;completedAtUtc=[DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'");helperInputs=$HelperInputs}
    Write-NewPrivateText $ReceiptPath ($Receipt|ConvertTo-Json -Depth 8 -Compress)
} catch {throw 'Создание читателя портала не подтверждено. Существующие пользователь, пароль и квитанция не заменены. Если нативная запись могла выполниться, не повторяйте команду: требуется восстановление оператором.'}
finally {$Operator=$null;$Password=$null;$NativeInput=$null;$InputText=$null;$ResultText=$null}
[pscustomobject]@{schema=1;state='completed';mode='create';operationId=$OperationId;configurationVersion=$Result.configurationVersion;receiptPath=$ReceiptPath;publicationEnabled=$false;note='Native create result and registration binding only. Role XML, HTTP and browser acceptance remain separate.'}|ConvertTo-Json -Depth 4
