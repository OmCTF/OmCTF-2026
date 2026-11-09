#requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Run,
    [ValidateSet('create','verify', IgnoreCase = $false)][string]$Mode = 'verify',
    [ValidateSet('0.5.0-p0.1','0.6.0-p0','1.0', IgnoreCase = $false)][string]$CurrentVersion = '1.0',
    [ValidateRange(30,300)][int]$TimeoutSeconds = 120
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Run) {
    [pscustomobject]@{
        schema = 1; state = 'plan_not_executed'; mode = $Mode; expectedConfigurationVersion = $CurrentVersion
        name = 'vodokanal_hydrology_reader'; roleName = 'ПубличноеЧтениеГидрологии'
        roleUuid = 'd9bb82f0-0782-02b2-dc94-7262b37574b4'; target = @{ server = 'onec:1541'; ref = 'vodokanal' }
        passwordPath = 'secrets/public_hydrology_password.txt'; receiptPath = 'secrets/hydrology-public-reader.receipt.json'
        nativeRuntimeUsed = $false; secretRead = $false; publicationEnabled = $false
        note = 'Run requires the reviewed/published expected release and explicit operator authorization. Creation records that exact release; Verify neither reads the reader password nor changes the receipt.'
    } | ConvertTo-Json -Depth 4
    return
}
if (-not $IsWindows) { throw 'Для настройки нативного читателя требуется поддержка прав доступа Windows.' }
. (Join-Path $PSScriptRoot 'identity/HydrologyReader.Support.ps1')
$Contract = Get-PublicReaderContract
Assert-PublicReaderCurrentVersion $CurrentVersion $Mode
$ReceiptPath = Join-Path $Root 'secrets/hydrology-public-reader.receipt.json'
$PasswordPath = Join-Path $Root 'secrets/public_hydrology_password.txt'
$OperatorPath = Join-Path $Root 'secrets/native-operator.json'
$Owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$System = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')

function Write-HydrologyReaderReceipt($Receipt) {
    Assert-PublicReaderReceipt $Receipt
    Assert-PlainPrivatePath $ReceiptPath
    if ([IO.File]::Exists($ReceiptPath) -or [IO.Directory]::Exists($ReceiptPath)) { throw 'Квитанция уже существует.' }
    $Temporary = Join-Path ([IO.Path]::GetDirectoryName($ReceiptPath)) ('.hydrology-public-reader.receipt.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $Stream = $null; $Bytes = $null
    try {
        $Stream = [IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($Temporary),
            [IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,
            [IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,(New-ReceiptSecurity))
        Assert-PrivateAcl ([IO.FileSystemAclExtensions]::GetAccessControl($Stream))
        $Bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Receipt | ConvertTo-Json -Depth 8 -Compress))
        $Stream.Write($Bytes,0,$Bytes.Length); $Stream.Flush($true); $Stream.Dispose(); $Stream = $null
        [IO.File]::Move($Temporary,$ReceiptPath,$false)
        $Temporary = $null
    }
    finally {
        if ($null -ne $Stream) { $Stream.Dispose() }
        if ($null -ne $Bytes) { [Array]::Clear($Bytes,0,$Bytes.Length) }
        if ($null -ne $Temporary -and [IO.File]::Exists($Temporary)) { [IO.File]::Delete($Temporary) }
    }
}

$Operator = $null; $Password = $null; $NativeInput = $null; $InputText = $null; $ResultText = $null
try {
    Assert-PlainPrivatePath $ReceiptPath
    $Receipt = $null
    if ($Mode -ceq 'create') {
        if ([IO.File]::Exists($ReceiptPath) -or [IO.Directory]::Exists($ReceiptPath)) { throw 'Квитанция уже существует.' }
    }
    else {
        $Receipt = ConvertFrom-PublicReaderJson (Read-PrivateText $ReceiptPath 16384)
        Assert-PublicReaderReceipt $Receipt $CurrentVersion
    }
    $Compose = @('compose','-f',(Join-Path $Root 'compose.yaml'),'-f',(Join-Path $Root 'compose.gui.yaml'))
    $Container = (Invoke-QuietDocker ($Compose + @('ps','-q','onec'))).Trim()
    $RasContainer = (Invoke-QuietDocker ($Compose + @('ps','-q','ras'))).Trim()
    if ($Container -cnotmatch '\A[a-f0-9]{12,64}\z' -or $RasContainer -cnotmatch '\A[a-f0-9]{12,64}\z') { throw 'Требуется ровно по одному существующему контейнеру сервера 1С и службы администрирования.' }
    $Before = Read-RegistrationBinding
    if ($Mode -ceq 'verify') { Assert-PublicReaderSameBinding $Receipt.target $Before }
    $Operator = ConvertFrom-PublicReaderJson (Read-PrivateText $OperatorPath 16384)
    Assert-PublicReaderKeys $Operator @('schema','administrator','dispatcher')
    if ($Operator.schema -isnot [long] -or $Operator.schema -ne 1) { throw 'Структура данных оператора некорректна.' }
    Assert-PublicReaderKeys $Operator.administrator @('name','password')
    if ($Operator.administrator.name -isnot [string] -or $Operator.administrator.password -isnot [string] -or
        $Operator.administrator.name -cnotmatch '\A[A-Za-z0-9._-]{3,64}\z' -or
        $Operator.administrator.password -cnotmatch '\A[A-Za-z0-9_-]{43}\z') { throw 'Учётные данные оператора некорректны.' }
    $OperationId = [guid]::NewGuid().ToString('D')
    $NativeInput = [ordered]@{
        schema = 1; purpose = $Contract.purpose; mode = $Mode; operationId = $OperationId
        target = [ordered]@{ server = $Contract.server; ref = $Contract.ref }; currentVersion = $CurrentVersion
    }
    if ($Mode -ceq 'create') {
        $Password = Read-PrivateText $PasswordPath 64
        if (-not (Test-PublicReaderPassword $Password)) { throw 'Файл пароля читателя гидрологии некорректен.' }
        $NativeInput.password = $Password
        $Token = 'VodokanalHydrologyReaderCreate'; $Marker = 'hydrology_reader_create_completed'
    }
    else {
        $NativeInput.nativeUserId = $Receipt.nativeResult.nativeUserId
        $Token = 'VodokanalHydrologyReaderVerify'; $Marker = 'hydrology_reader_verify_completed'
    }
    $Shell = @'
set +x
set -euo pipefail
umask 077
[[ ! -L /run/vodokanal-provision.lock ]]
exec 9>/run/vodokanal-provision.lock
flock -n 9
scratch=/run/vodokanal-hydrology-reader
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
printf 'ENTERPRISE /S "%s" /N "%s" /P "%s" /WA- /C __TOKEN__ /DisableStartupDialogs /DisableStartupMessages /Out "%s/result.log"\n' \
    'onec:1541\vodokanal' "$admin_name" "$admin_password" "$scratch" > "$scratch/startup.txt"
chown usr1cv8:grp1cv8 "$scratch/input.json" "$scratch/startup.txt"
chmod 0400 "$scratch/input.json" "$scratch/startup.txt"
unset admin_name admin_password native_json
cd "$scratch"
gosu usr1cv8:grp1cv8 env HOME=/home/usr1cv8 LC_ALL=C.UTF-8 \
    LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6 \
    timeout --kill-after=10 __TIMEOUT__ \
    xvfb-run -a -s '-screen 0 1280x800x24 -nolisten tcp' \
    /opt/onec/1cv8 /@ "$scratch/startup.txt" > "$scratch/client.log" 2>&1
[[ -f "$scratch/result.json" && ! -L "$scratch/result.json" ]]
[[ $(wc -c < "$scratch/result.json") -le 16384 ]]
grep -Fq '__MARKER__' "$scratch/result.log"
cat "$scratch/result.json"
'@
    $Shell = $Shell.Replace('__TOKEN__',$Token).Replace('__MARKER__',$Marker).Replace('__TIMEOUT__',[string]$TimeoutSeconds)
    $InputText = $Operator.administrator.name + [char]10 + $Operator.administrator.password + [char]10 +
        ($NativeInput | ConvertTo-Json -Depth 4 -Compress) + [char]10
    $ResultText = Invoke-QuietDocker @('exec','-i',$Container,'/bin/bash','-c',$Shell) $InputText 16384
    $Result = ConvertFrom-PublicReaderJson $ResultText
    $ExpectedNativeId = if ($Mode -ceq 'verify') { $Receipt.nativeResult.nativeUserId } else { '' }
    Assert-PublicReaderResult $Result $Mode $OperationId $ExpectedNativeId $CurrentVersion
    $After = Read-RegistrationBinding
    Assert-PublicReaderSameBinding $Before $After
    if ($Mode -ceq 'create') {
        $Completed = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",[Globalization.CultureInfo]::InvariantCulture)
        Write-HydrologyReaderReceipt (New-HydrologyReaderReceipt $After $Result $Completed)
    }
}
catch {
    throw 'Операция читателя гидрологии не подтверждена. Квитанция и пароль не заменены. Если создание могло выполниться, не повторяйте команду и не присваивайте имя: требуется восстановление оператором.'
}
finally { $Operator = $null; $Password = $null; $NativeInput = $null; $InputText = $null; $ResultText = $null }
[pscustomobject]@{
    schema = 1; state = $(if ($Mode -ceq 'create') { 'completed' } else { 'verified' })
    mode = $Mode; operationId = $OperationId; receiptPath = $ReceiptPath; configurationVersion = $Result.configurationVersion
    nativeAccountVerified = $true; publicationEnabled = $false; helperInputs = $HelperInputs
    note = 'Exact server/ref and RAC registration binding. Not cryptographic proof of database contents or runtime role XML.'
} | ConvertTo-Json -Depth 4
