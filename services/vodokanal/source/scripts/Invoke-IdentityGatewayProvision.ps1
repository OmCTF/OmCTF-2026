#requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Run,
    [ValidateSet('create','verify', IgnoreCase = $false)][string]$Mode = 'verify',
    [ValidateRange(30,300)][int]$TimeoutSeconds = 120
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Run) {
    [pscustomobject]@{
        schema = 1; state = 'plan_not_executed'; mode = $Mode
        name = 'vodokanal_identity_gateway'; roleName = 'ШлюзРегистрации'
        target = @{ server = 'onec:1541'; ref = 'vodokanal' }
        passwordPath = 'secrets/identity_gateway_password.txt'; receiptPath = 'secrets/identity-gateway.receipt.json'
        startupToken = 'VodokanalIdentityGatewayProvision'
        nativeRuntimeUsed = $false; secretRead = $false; publicationEnabled = $false
        note = 'Explicit Run only after the matching identity configuration has been published. Verify does not read the gateway password or replace its creation receipt.'
    } | ConvertTo-Json -Depth 4
    return
}
if (-not $IsWindows) { throw 'Для настройки шлюза идентификации требуется поддержка прав доступа Windows.' }

$HelperInputs = [ordered]@{}
$HelperSets = @(
    @{ path = 'scripts/identity/PublicReaderProvision.Support.ps1'; names = @(
        'Stop-PublicReaderContract','Assert-PublicReaderKeys','Assert-PublicReaderUuid','Assert-PublicReaderUtc',
        'Test-PublicReaderPassword','ConvertFrom-PublicReaderJson','ConvertFrom-PublicReaderRac',
        'Select-PublicReaderCluster','New-PublicReaderBinding','Assert-PublicReaderBinding','Assert-PublicReaderSameBinding') },
    @{ path = 'scripts/Invoke-PublicReaderProvision.ps1'; names = @(
        'Assert-PlainPrivatePath','New-ReceiptSecurity','Assert-PrivateAcl','Read-PrivateText',
        'Invoke-QuietDocker','Read-RegistrationBinding') }
)
foreach ($Set in $HelperSets) {
    $SourcePath = Join-Path $Root $Set.path
    $SourceBytes = [IO.File]::ReadAllBytes($SourcePath)
    $SourceText = [Text.UTF8Encoding]::new($false,$true).GetString($SourceBytes)
    $Tokens = $null; $ParseErrors = $null
    $Ast = [Management.Automation.Language.Parser]::ParseInput($SourceText,[ref]$Tokens,[ref]$ParseErrors)
    if ($ParseErrors.Count) { throw 'Не удалось загрузить проверенный исходник вспомогательной функции.' }
    $HelperInputs[$Set.path] = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($SourceBytes))
    foreach ($Name in $Set.names) {
        $Definitions = @($Ast.FindAll({ param($Node)
            $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -ceq $Name
        }, $true))
        if ($Definitions.Count -ne 1) { throw 'Проверенное определение вспомогательной функции отсутствует или неоднозначно.' }
        . ([scriptblock]::Create($Definitions[0].Extent.Text))
    }
}
function Get-PublicReaderContract {
    [ordered]@{ server = 'onec:1541'; ref = 'vodokanal'; host = 'onec'; port = '1541' }
}
$ReceiptPath = Join-Path $Root 'secrets/identity-gateway.receipt.json'
$PasswordPath = Join-Path $Root 'secrets/identity_gateway_password.txt'
$OperatorPath = Join-Path $Root 'secrets/native-operator.json'
$Owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$System = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')

function Assert-IdentityGatewayResult($Result, [string]$ExpectedMode, [string]$ExpectedOperationId, [string]$ExpectedNativeId = '') {
    Assert-PublicReaderKeys $Result @('schema','operationId','mode','nativeUserId','name','roleName','standardAuth','osAuth','showInList')
    Assert-PublicReaderUuid $Result.operationId
    Assert-PublicReaderUuid $Result.nativeUserId
    if (($Result.schema -isnot [long] -and $Result.schema -isnot [int]) -or $Result.schema -ne 1 -or
        $Result.mode -isnot [string] -or $Result.mode -cne $ExpectedMode -or
        $Result.operationId -cne $ExpectedOperationId -or
        $Result.name -isnot [string] -or $Result.name -cne 'vodokanal_identity_gateway' -or
        $Result.roleName -isnot [string] -or $Result.roleName -cne 'ШлюзРегистрации' -or
        $Result.standardAuth -isnot [bool] -or -not $Result.standardAuth -or
        $Result.osAuth -isnot [bool] -or $Result.osAuth -or
        $Result.showInList -isnot [bool] -or $Result.showInList) {
        throw 'Нативный результат шлюза идентификации не подтверждён.'
    }
    if ($ExpectedNativeId -ne '') {
        Assert-PublicReaderUuid $ExpectedNativeId
        if ($Result.nativeUserId -cne $ExpectedNativeId) { throw 'Нативный идентификатор шлюза идентификации изменился.' }
    }
}
function Assert-IdentityGatewayReceipt($Receipt) {
    Assert-PublicReaderKeys $Receipt @('schema','purpose','status','operationId','target','nativeResult','completedAtUtc')
    if (($Receipt.schema -isnot [long] -and $Receipt.schema -isnot [int]) -or $Receipt.schema -ne 1 -or
        $Receipt.purpose -isnot [string] -or $Receipt.purpose -cne 'identity_gateway_native_principal' -or
        $Receipt.status -isnot [string] -or $Receipt.status -cne 'completed') {
        throw 'Квитанция создания шлюза идентификации некорректна.'
    }
    Assert-PublicReaderUuid $Receipt.operationId
    Assert-PublicReaderBinding $Receipt.target
    Assert-PublicReaderUtc $Receipt.completedAtUtc
    Assert-IdentityGatewayResult $Receipt.nativeResult 'create' $Receipt.operationId
}
function Write-IdentityGatewayReceipt($Receipt) {
    Assert-IdentityGatewayReceipt $Receipt
    Assert-PlainPrivatePath $ReceiptPath
    if ([IO.File]::Exists($ReceiptPath) -or [IO.Directory]::Exists($ReceiptPath)) { throw 'Квитанция уже существует.' }
    $Temporary = Join-Path ([IO.Path]::GetDirectoryName($ReceiptPath)) ('.identity-gateway.receipt.' + [guid]::NewGuid().ToString('N') + '.tmp')
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
        Assert-IdentityGatewayReceipt $Receipt
    }
    $Compose = @('compose','-f',(Join-Path $Root 'compose.yaml'),'-f',(Join-Path $Root 'compose.gui.yaml'))
    $Container = (Invoke-QuietDocker ($Compose + @('ps','-q','onec'))).Trim()
    $RasContainer = (Invoke-QuietDocker ($Compose + @('ps','-q','ras'))).Trim()
    if ($Container -cnotmatch '\A[a-f0-9]{12,64}\z' -or $RasContainer -cnotmatch '\A[a-f0-9]{12,64}\z') {
        throw 'Требуется ровно по одному существующему контейнеру сервера 1С и службы администрирования.'
    }
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
    $NativeInput = [ordered]@{ schema = 1; mode = $Mode; operationId = $OperationId; password = ''; expectedNativeId = '' }
    if ($Mode -ceq 'create') {
        $Password = Read-PrivateText $PasswordPath 64
        if (-not (Test-PublicReaderPassword $Password)) { throw 'Файл пароля шлюза идентификации некорректен.' }
        $NativeInput.password = $Password
    }
    else { $NativeInput.expectedNativeId = $Receipt.nativeResult.nativeUserId }
    $Shell = @'
set +x
set -euo pipefail
umask 077
[[ ! -L /run/vodokanal-provision.lock ]]
exec 9>/run/vodokanal-provision.lock
flock -n 9
scratch=/run/vodokanal-identity-gateway
native_input=/run/vodokanal-identity-gateway.json
[[ ! -e "$scratch" && ! -L "$scratch" ]]
[[ ! -e "$native_input" && ! -L "$native_input" ]]
mkdir "$scratch"
input_owned=0
cleanup() {
    code=$?
    unset admin_name admin_password native_json
    if [[ "$input_owned" == 1 ]]; then rm -f -- "$native_input" 2>/dev/null || code=1; fi
    rm -f -- "$scratch/startup.txt" "$scratch/client.log" "$scratch/result.log" "$scratch/result.json" 2>/dev/null || code=1
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
(set -o noclobber; printf '%s\n' "$native_json" > "$native_input")
input_owned=1
printf 'ENTERPRISE /S "%s" /N "%s" /P "%s" /WA- /C VodokanalIdentityGatewayProvision /DisableStartupDialogs /DisableStartupMessages /Out "%s/result.log"\n' \
    'onec:1541\vodokanal' "$admin_name" "$admin_password" "$scratch" > "$scratch/startup.txt"
chown usr1cv8:grp1cv8 "$native_input" "$scratch/startup.txt"
chmod 0400 "$native_input" "$scratch/startup.txt"
unset admin_name admin_password native_json
cd "$scratch"
gosu usr1cv8:grp1cv8 env HOME=/home/usr1cv8 LC_ALL=C.UTF-8 \
    LD_PRELOAD=/usr/lib/x86_64-linux-gnu/libstdc++.so.6 \
    timeout --kill-after=10 __TIMEOUT__ \
    xvfb-run -a -s '-screen 0 1280x800x24 -nolisten tcp' \
    /opt/onec/1cv8 /@ "$scratch/startup.txt" > "$scratch/client.log" 2>&1
[[ -f "$scratch/result.json" && ! -L "$scratch/result.json" ]]
[[ $(wc -c < "$scratch/result.json") -le 16384 ]]
[[ $(stat -c '%u:%a' "$scratch/result.json") == "$(id -u usr1cv8):600" ]]
grep -Fq 'identity_gateway_provision_completed' "$scratch/result.log"
cat "$scratch/result.json"
'@
    $Shell = $Shell.Replace('__TIMEOUT__',[string]$TimeoutSeconds)
    $InputText = $Operator.administrator.name + [char]10 + $Operator.administrator.password + [char]10 +
        ($NativeInput | ConvertTo-Json -Depth 4 -Compress) + [char]10
    $ResultText = Invoke-QuietDocker @('exec','-i',$Container,'/bin/bash','-c',$Shell) $InputText 16384
    $Result = ConvertFrom-PublicReaderJson $ResultText
    $ExpectedNativeId = if ($Mode -ceq 'verify') { $Receipt.nativeResult.nativeUserId } else { '' }
    Assert-IdentityGatewayResult $Result $Mode $OperationId $ExpectedNativeId
    $After = Read-RegistrationBinding
    Assert-PublicReaderSameBinding $Before $After
    if ((Invoke-QuietDocker ($Compose + @('ps','-q','onec'))).Trim() -cne $Container -or
        (Invoke-QuietDocker ($Compose + @('ps','-q','ras'))).Trim() -cne $RasContainer) {
        throw 'Привязка контейнера изменилась во время настройки.'
    }
    if ($Mode -ceq 'create') {
        $Completed = [DateTime]::UtcNow.ToString("yyyy-MM-dd'T'HH:mm:ss'Z'",[Globalization.CultureInfo]::InvariantCulture)
        Write-IdentityGatewayReceipt ([ordered]@{
            schema = 1; purpose = 'identity_gateway_native_principal'; status = 'completed'
            operationId = $OperationId; target = $After; nativeResult = $Result; completedAtUtc = $Completed
        })
    }
}
catch {
    throw 'Операция шлюза идентификации не подтверждена. Квитанция, учётная запись и пароль не заменены. Если нативное создание могло выполниться, не повторяйте команду: требуется отдельное восстановление оператором.'
}
finally { $Operator = $null; $Password = $null; $NativeInput = $null; $InputText = $null; $ResultText = $null }

[pscustomobject]@{
    schema = 1; state = $(if ($Mode -ceq 'create') { 'completed' } else { 'verified' })
    mode = $Mode; operationId = $OperationId; receiptPath = $ReceiptPath
    nativeAccountVerified = $true; publicationEnabled = $false; helperInputs = $HelperInputs
    note = 'Exact native UUID, role name/auth flags and RAC registration binding. Not a runtime HTTP test, role-rights XML attestation or cryptographic database fingerprint.'
} | ConvertTo-Json -Depth 4
