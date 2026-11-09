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
    if ($ParseErrors.Count) { throw 'Исходник вспомогательной функции настройки некорректен.' }
    $HelperInputs[$Set.path] = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($SourceBytes))
    foreach ($Name in $Set.names) {
        $Definitions = @($Ast.FindAll({param($Node)
            $Node -is [Management.Automation.Language.FunctionDefinitionAst] -and $Node.Name -ceq $Name
        },$true))
        if ($Definitions.Count -ne 1) { throw 'Определение вспомогательной функции настройки отсутствует или неоднозначно.' }
        . ([scriptblock]::Create($Definitions[0].Extent.Text))
    }
}
function Get-PublicReaderContract {
    [ordered]@{schema=1;purpose='dispatch_gateway_native_principal';server='onec:1541';ref='vodokanal';host='onec';port='1541';name='vodokanal_intake_gateway';roleName='ШлюзГостевыхОбращений';configurationVersion=$ExpectedVersion}
}

function Write-DispatchPrivateText([string]$Path,[string]$Text) {
    Assert-PlainPrivatePath $Path
    if ([IO.File]::Exists($Path) -or [IO.Directory]::Exists($Path)) { throw 'Закрытый выходной файл уже существует.' }
    $Temporary = Join-Path ([IO.Path]::GetDirectoryName($Path)) ('.dispatch-gateway.' + [guid]::NewGuid().ToString('N') + '.tmp')
    $Stream = $null; $Bytes = $null
    try {
        $Stream = [IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($Temporary),
            [IO.FileMode]::CreateNew,[Security.AccessControl.FileSystemRights]::FullControl,
            [IO.FileShare]::None,4096,[IO.FileOptions]::WriteThrough,(New-ReceiptSecurity))
        Assert-PrivateAcl ([IO.FileSystemAclExtensions]::GetAccessControl($Stream))
        $Bytes = [Text.UTF8Encoding]::new($false).GetBytes($Text)
        $Stream.Write($Bytes,0,$Bytes.Length); $Stream.Flush($true); $Stream.Dispose(); $Stream = $null
        [IO.File]::Move($Temporary,$Path,$false); $Temporary = $null
    }
    finally {
        if ($null -ne $Stream) { $Stream.Dispose() }
        if ($null -ne $Bytes) { [Array]::Clear($Bytes,0,$Bytes.Length) }
        if ($null -ne $Temporary -and [IO.File]::Exists($Temporary)) { [IO.File]::Delete($Temporary) }
    }
}

function Assert-DispatchResult($Result,[string]$ExpectedMode,[string]$Operation,[string]$Version,[string]$NativeId='') {
    Assert-PublicReaderKeys $Result @('schema','purpose','mode','operationId','status','name','nativeUserId','roleName','configurationVersion','checkedAtUtc','server','ref','standardAuth','osAuth','showInList','publicOrigin','readsPerMinute','writesPerMinute','protectedSettingsBound')
    Assert-PublicReaderUuid $Result.operationId; Assert-PublicReaderUuid $Result.nativeUserId; Assert-PublicReaderUtc $Result.checkedAtUtc
    $ExpectedStatus = if ($ExpectedMode -ceq 'create') { 'created' } else { 'verified' }
    if ($Result.schema -isnot [long] -or $Result.schema -ne 1 -or
        $Result.purpose -cne $Contract.purpose -or $Result.mode -cne $ExpectedMode -or
        $Result.operationId -cne $Operation -or $Result.status -cne $ExpectedStatus -or
        $Result.name -cne $Contract.name -or $Result.roleName -cne $Contract.roleName -or
        $Result.configurationVersion -isnot [string] -or $Result.configurationVersion -cne $Version -or
        $Result.server -cne $Contract.server -or $Result.ref -cne $Contract.ref -or
        $Result.standardAuth -isnot [bool] -or -not $Result.standardAuth -or
        $Result.osAuth -isnot [bool] -or $Result.osAuth -or
        $Result.showInList -isnot [bool] -or $Result.showInList -or
        $Result.publicOrigin -isnot [string] -or $Result.publicOrigin -cne $PublicOrigin -or
        $Result.readsPerMinute -isnot [long] -or $Result.readsPerMinute -ne $ReadsPerMinute -or
        $Result.writesPerMinute -isnot [long] -or $Result.writesPerMinute -ne $WritesPerMinute -or
        $Result.protectedSettingsBound -isnot [bool] -or -not $Result.protectedSettingsBound) {
        throw 'Результат настройки нативного шлюза диспетчерской не подтверждён.'
    }
    if ($NativeId -ne '' -and $Result.nativeUserId -cne $NativeId) { throw 'Нативный идентификатор шлюза диспетчерской изменился.' }
}

function Assert-DispatchReceipt($Receipt) {
    Assert-PublicReaderKeys $Receipt @('schema','purpose','status','operationId','target','nativeResult','completedAtUtc','helperInputs')
    if ($Receipt.schema -isnot [long] -or $Receipt.schema -ne 1 -or
        $Receipt.purpose -cne $Contract.purpose -or $Receipt.status -cne 'completed') { throw 'Квитанция создания диспетчерской некорректна.' }
    Assert-PublicReaderUuid $Receipt.operationId; Assert-PublicReaderBinding $Receipt.target; Assert-PublicReaderUtc $Receipt.completedAtUtc
    Assert-DispatchResult $Receipt.nativeResult 'create' $Receipt.operationId $Receipt.nativeResult.configurationVersion
}
