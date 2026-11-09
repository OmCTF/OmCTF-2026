#requires -Version 7.0
[CmdletBinding()]
param(
    [switch]$Run,
    [ValidateSet('create','verify', IgnoreCase = $false)][string]$Mode = 'verify',
    [ValidateSet('0.4.0-lab.6','0.4.0-lab.8','0.4.0-lab.9','0.5.0-p0.1','0.6.0-p0','1.0', IgnoreCase = $false)][string]$CurrentVersion = '1.0',
    [ValidateRange(30,300)][int]$TimeoutSeconds = 120
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if ($Mode -ceq 'create' -and $CurrentVersion -cnotin @('0.4.0-lab.6','0.6.0-p0','1.0')) {
    throw 'Создание публичного читателя поддерживает версии lab.6, 0.6.0-p0 и 1.0.'
}
if (-not $Run) {
    [pscustomobject]@{
        schema = 1; state = 'plan_not_executed'; mode = $Mode
        expectedConfigurationVersion = $CurrentVersion
        historicalCreationVersion = '0.4.0-lab.6'
        target = @{ server = 'onec:1541'; ref = 'vodokanal' }
        passwordPath = 'secrets/public_lab_password.txt'
        receiptPath = 'secrets/public-lab-reader.receipt.json'
        nativeRuntimeUsed = $false; secretRead = $false; publicationEnabled = $false
        note = 'Operator-only draft. Review and publish the expected release before an explicitly authorized Run. Verify does not read the public-reader password or modify the receipt.'
    } | ConvertTo-Json -Depth 3
    return
}
if (-not $IsWindows) { throw 'Для настройки публичного читателя требуется поддержка прав доступа Windows.' }
. (Join-Path $PSScriptRoot 'identity/PublicReaderProvision.Support.ps1')
$Contract = Get-PublicReaderContract
Assert-PublicReaderCurrentVersion $CurrentVersion $Mode
$ReceiptPath = Join-Path $Root 'secrets/public-lab-reader.receipt.json'
$PasswordPath = Join-Path $Root 'secrets/public_lab_password.txt'
$OperatorPath = Join-Path $Root 'secrets/native-operator.json'
$Owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$System = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')

function Assert-PlainPrivatePath([string]$Path) {
    $Cursor = [IO.Path]::GetFullPath($Path)
    while ($Cursor) {
        try {
            $Attributes = [IO.File]::GetAttributes($Cursor)
            if (($Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Путь к закрытому файлу некорректен.' }
        }
        catch [IO.FileNotFoundException] { }
        catch [IO.DirectoryNotFoundException] { }
        $Parent = [IO.Path]::GetDirectoryName($Cursor)
        if ($Parent -eq $Cursor) { break }
        $Cursor = $Parent
    }
}
function New-ReceiptSecurity {
    $Acl = [Security.AccessControl.FileSecurity]::new()
    $Acl.SetOwner($Owner)
    $Acl.SetAccessRuleProtection($true, $false)
    foreach ($Sid in @($Owner,$System) | Select-Object -Unique) {
        [void]$Acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($Sid,
            [Security.AccessControl.FileSystemRights]::FullControl, [Security.AccessControl.AccessControlType]::Allow))
    }
    return $Acl
}
function Assert-PrivateAcl([Security.AccessControl.FileSecurity]$Acl) {
    $Rules = @($Acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
    $Expected = @($Owner.Value,$System.Value) | Select-Object -Unique
    if (-not $Acl.AreAccessRulesProtected -or $Rules.Count -ne $Expected.Count -or
        $Acl.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $Owner.Value) { throw 'Права доступа к закрытому файлу некорректны.' }
    foreach ($Sid in $Expected) {
        $Found = @($Rules | Where-Object { $_.IdentityReference.Value -ceq $Sid })
        if ($Found.Count -ne 1 -or $Found[0].IsInherited -or
            $Found[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $Found[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) { throw 'Права доступа к закрытому файлу некорректны.' }
    }
}
function Read-PrivateText([string]$Path, [int]$Limit) {
    Assert-PlainPrivatePath $Path
    $Stream = [IO.FileStream]::new($Path,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)
    $Bytes = $null
    try {
        Assert-PrivateAcl ([IO.FileSystemAclExtensions]::GetAccessControl($Stream))
        if ($Stream.Length -lt 1 -or $Stream.Length -gt $Limit) { throw 'Размер закрытого файла некорректен.' }
        $Bytes = [byte[]]::new([int]$Stream.Length)
        $Position = 0
        while ($Position -lt $Bytes.Length) {
            $Count = $Stream.Read($Bytes,$Position,$Bytes.Length-$Position)
            if ($Count -eq 0) { throw 'Закрытые входные данные неполные.' }
            $Position += $Count
        }
        return [Text.UTF8Encoding]::new($false,$true).GetString($Bytes)
    }
    finally {
        $Stream.Dispose()
        if ($null -ne $Bytes) { [Array]::Clear($Bytes,0,$Bytes.Length) }
    }
}
function Invoke-QuietDocker([string[]]$Arguments, [string]$InputText = '', [int]$Limit = 262144) {
    $Start = [Diagnostics.ProcessStartInfo]::new('docker')
    $Start.UseShellExecute = $false
    $Start.CreateNoWindow = $true
    $Start.RedirectStandardInput = $true
    $Start.RedirectStandardOutput = $true
    $Start.RedirectStandardError = $true
    $Start.StandardInputEncoding = [Text.UTF8Encoding]::new($false)
    $Start.StandardOutputEncoding = [Text.UTF8Encoding]::new($false,$true)
    $Start.StandardErrorEncoding = [Text.UTF8Encoding]::new($false,$true)
    foreach ($Argument in $Arguments) { [void]$Start.ArgumentList.Add($Argument) }
    $Process = [Diagnostics.Process]::new()
    $Process.StartInfo = $Start
    try {
        if (-not $Process.Start()) { throw 'Вызов Докера не подтверждён.' }
        $OutputTask = $Process.StandardOutput.ReadToEndAsync()
        $ErrorTask = $Process.StandardError.ReadToEndAsync()
        if ($InputText -ne '') { $Process.StandardInput.Write($InputText) }
        $Process.StandardInput.Close()
        if (-not $Process.WaitForExit(($TimeoutSeconds + 30) * 1000)) {
            $Process.Kill($true)
            throw 'Вызов Докера превысил время ожидания; состояние не подтверждено.'
        }
        $Output = $OutputTask.GetAwaiter().GetResult()
        $Diagnostic = $ErrorTask.GetAwaiter().GetResult()
        if ($Process.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($Diagnostic) -or $Output.Length -gt $Limit) {
            throw 'Операция Докера не подтверждена; эта команда не сохраняет диагностику.'
        }
        return $Output
    }
    finally { $Process.Dispose(); $InputText = $null; $Diagnostic = $null }
}
function Read-RegistrationBinding {
    $ClusterText = Invoke-QuietDocker @('exec',$RasContainer,'/opt/onec/rac','cluster','list','localhost:1545')
    $ClusterId = Select-PublicReaderCluster $ClusterText
    $SummaryText = Invoke-QuietDocker @('exec',$RasContainer,'/opt/onec/rac','infobase','summary','list',('--cluster=' + $ClusterId),'localhost:1545')
    return New-PublicReaderBinding $ClusterId $SummaryText
}
function Write-CompletedReceipt($Receipt) {
    Assert-PublicReaderReceipt $Receipt
    Assert-PlainPrivatePath $ReceiptPath
    if ([IO.File]::Exists($ReceiptPath) -or [IO.Directory]::Exists($ReceiptPath)) { throw 'Квитанция уже существует.' }
    $Temporary = Join-Path ([IO.Path]::GetDirectoryName($ReceiptPath)) ('.public-lab-reader.receipt.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $Stream = $null
    try {
        $Stream = [IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($Temporary),
            [IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,
            [IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,(New-ReceiptSecurity))
        Assert-PrivateAcl ([IO.FileSystemAclExtensions]::GetAccessControl($Stream))
        $Bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Receipt | ConvertTo-Json -Depth 8 -Compress))
        $Stream.Write($Bytes,0,$Bytes.Length)
        $Stream.Flush($true)
        $Stream.Dispose(); $Stream = $null
        [IO.File]::Move($Temporary,$ReceiptPath,$false)
        $Temporary = $null
    }
    finally {
        if ($null -ne $Stream) { $Stream.Dispose() }
        if ($null -ne $Temporary -and [IO.File]::Exists($Temporary)) { [IO.File]::Delete($Temporary) }
    }
}

$Operator = $null; $Password = $null; $InputText = $null; $NativeInput = $null
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
    $NativeInput = [ordered]@{
        schema = 1; purpose = $Contract.purpose; mode = $Mode; operationId = $OperationId
        target = [ordered]@{ server = $Contract.server; ref = $Contract.ref }
    }
    if ($CurrentVersion -cne '0.4.0-lab.6') { $NativeInput.currentVersion = $CurrentVersion }
    if ($Mode -ceq 'create') {
        $Password = Read-PrivateText $PasswordPath 64
        if (-not (Test-PublicReaderPassword $Password)) { throw 'Файл пароля публичного читателя некорректен.' }
        $NativeInput.password = $Password
        $LaunchToken = 'VodokanalPublicReaderCreate'
        $Marker = 'public_reader_create_completed'
    }
    else {
        $NativeInput.nativeUserId = $Receipt.nativeResult.nativeUserId
        $LaunchToken = 'VodokanalPublicReaderVerify'
        $Marker = 'public_reader_verify_completed'
    }
    $Shell = @'
set +x
set -euo pipefail
umask 077
[[ ! -L /run/vodokanal-provision.lock ]]
exec 9>/run/vodokanal-provision.lock
flock -n 9
scratch=/run/vodokanal-public-reader
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
    $Shell = $Shell.Replace('__TOKEN__',$LaunchToken).Replace('__MARKER__',$Marker).Replace('__TIMEOUT__',[string]$TimeoutSeconds)
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
        Write-CompletedReceipt (New-PublicReaderReceipt $After $Result $Completed)
    }
}
catch {
    throw 'Операция публичного читателя не подтверждена. Квитанция и пароль не заменены. Если нативное создание могло выполниться, не повторяйте команду и не присваивайте имя: требуется восстановление оператором.'
}
finally { $Operator = $null; $Password = $null; $NativeInput = $null; $InputText = $null }

[pscustomobject]@{
    schema = 1; state = $(if ($Mode -ceq 'create') { 'completed' } else { 'verified' })
    mode = $Mode; operationId = $OperationId; receiptPath = $ReceiptPath
    configurationVersion = $Result.configurationVersion
    nativeAccountVerified = $true; publicationEnabled = $false
    note = 'Server/ref and RAC registration binding verified; this is not cryptographic proof of database contents.'
} | ConvertTo-Json
