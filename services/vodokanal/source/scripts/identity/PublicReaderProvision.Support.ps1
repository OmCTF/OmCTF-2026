function Get-PublicReaderContract {
    return [ordered]@{
        schema = 1; purpose = 'public_lab_native_principal'; server = 'onec:1541'; ref = 'vodokanal'
        host = 'onec'; port = '1541'; name = 'vodokanal_public_reader'
        roleName = 'ПубличноеЧтениеЛаборатории'; roleUuid = '1f7f42b8-556e-6406-580f-81251f474d7f'
        configurationVersion = '0.4.0-lab.6'
    }
}

function Stop-PublicReaderContract { throw 'Входные данные, привязка или результат публичного читателя не подтверждены.' }

function Assert-PublicReaderCurrentVersion($Value, [string]$Mode = 'verify') {
    if ($Mode -cnotin @('create','verify') -or $Value -isnot [string] -or
        $Value -cnotin @('0.4.0-lab.6','0.4.0-lab.8','0.4.0-lab.9','0.5.0-p0.1','0.6.0-p0','1.0') -or
        ($Mode -ceq 'create' -and $Value -cnotin @('0.4.0-lab.6','0.6.0-p0','1.0'))) { Stop-PublicReaderContract }
}

function Assert-PublicReaderKeys($Object, [string[]]$Keys) {
    if ($Object -isnot [Collections.IDictionary] -or $Object.Count -ne $Keys.Count) { Stop-PublicReaderContract }
    foreach ($Key in $Keys) {
        if (@($Object.Keys) -cnotcontains $Key) { Stop-PublicReaderContract }
    }
}

function Assert-PublicReaderUuid($Value) {
    if ($Value -isnot [string] -or
        $Value -cnotmatch '\A[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\z' -or
        $Value -ceq '00000000-0000-0000-0000-000000000000') { Stop-PublicReaderContract }
}

function Assert-PublicReaderUtc($Value) {
    if ($Value -isnot [string] -or $Value -cnotmatch '\A[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z\z') {
        Stop-PublicReaderContract
    }
    $Parsed = [DateTimeOffset]::MinValue
    if (-not [DateTimeOffset]::TryParseExact($Value, "yyyy-MM-dd'T'HH:mm:ss'Z'",
        [Globalization.CultureInfo]::InvariantCulture,
        [Globalization.DateTimeStyles]'AssumeUniversal, AdjustToUniversal', [ref]$Parsed)) {
        Stop-PublicReaderContract
    }
}

function Test-PublicReaderPassword($Value) {
    return $Value -is [string] -and $Value.Length -eq 64 -and
        $Value -cmatch '\A[A-Za-z0-9_-]{64}\z' -and $Value -cmatch '[A-Z]' -and
        $Value -cmatch '[a-z]' -and $Value -cmatch '[0-9]'
}

function ConvertFrom-PublicReaderJson([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text) -or [Text.Encoding]::UTF8.GetByteCount($Text) -gt 16384) {
        Stop-PublicReaderContract
    }
    function Convert-Node([Text.Json.JsonElement]$Node) {
        switch ($Node.ValueKind) {
            'Object' {
                $Result = [ordered]@{}
                $Names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
                foreach ($Property in $Node.EnumerateObject()) {
                    if (-not $Names.Add($Property.Name)) { Stop-PublicReaderContract }
                    $Result.Add($Property.Name, (Convert-Node $Property.Value))
                }
                return $Result
            }
            'String' { return $Node.GetString() }
            'Number' {
                $Number = [long]0
                if (-not $Node.TryGetInt64([ref]$Number)) { Stop-PublicReaderContract }
                return $Number
            }
            'True' { return $true }
            'False' { return $false }
            default { Stop-PublicReaderContract }
        }
    }
    $Document = $null
    try {
        $Options = [Text.Json.JsonDocumentOptions]::new()
        $Options.MaxDepth = 8
        $Options.AllowTrailingCommas = $false
        $Document = [Text.Json.JsonDocument]::Parse($Text, $Options)
        if ($Document.RootElement.ValueKind -ne [Text.Json.JsonValueKind]::Object) { Stop-PublicReaderContract }
        return Convert-Node $Document.RootElement
    }
    catch { Stop-PublicReaderContract }
    finally { if ($null -ne $Document) { $Document.Dispose() } }
}

function ConvertFrom-PublicReaderRac([string]$Text, [ValidateSet('cluster','infobase')][string]$Kind) {
    if ([string]::IsNullOrWhiteSpace($Text) -or $Text.Length -gt 262144 -or
        $Text -match '[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]') { Stop-PublicReaderContract }
    $Text = $Text.Replace(([string][char]13 + [char]10), [string][char]10)
    if ($Text.Contains([string][char]13)) { Stop-PublicReaderContract }
    $Rows = [Collections.Generic.List[object]]::new()
    $Row = [ordered]@{}
    $Names = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($Line in ($Text -split [string][char]10)) {
        if ([string]::IsNullOrWhiteSpace($Line)) {
            if ($Row.Count) { $Rows.Add($Row); $Row = [ordered]@{}; $Names.Clear() }
            continue
        }
        if ($Line -cnotmatch '^\s*([a-z][a-z0-9-]*)\s*:\s*(.*?)\s*$') { Stop-PublicReaderContract }
        $Key = $Matches[1]; $Value = $Matches[2]
        if (-not $Names.Add($Key)) { Stop-PublicReaderContract }
        if ($Value.StartsWith('"') -or $Value.EndsWith('"')) {
            if ($Value.Length -lt 2 -or -not ($Value.StartsWith('"') -and $Value.EndsWith('"'))) {
                Stop-PublicReaderContract
            }
            $Value = $Value.Substring(1, $Value.Length - 2)
        }
        $Row.Add($Key, $Value)
    }
    if ($Row.Count) { $Rows.Add($Row) }
    if ($Rows.Count -eq 0 -or $Rows.Count -gt 512) { Stop-PublicReaderContract }
    $Ids = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($Item in $Rows) {
        $Required = if ($Kind -ceq 'cluster') { @('cluster','host','port') } else { @('infobase','name') }
        foreach ($Key in $Required) {
            if (@($Item.Keys) -cnotcontains $Key -or [string]::IsNullOrWhiteSpace($Item[$Key])) { Stop-PublicReaderContract }
        }
        Assert-PublicReaderUuid $Item[$Kind]
        if (-not $Ids.Add($Item[$Kind])) { Stop-PublicReaderContract }
        if ($Kind -ceq 'cluster' -and ($Item.host -cnotmatch '\A[A-Za-z0-9._-]{1,253}\z' -or
            $Item.port -cnotmatch '\A[0-9]{1,5}\z' -or [int]$Item.port -lt 1 -or [int]$Item.port -gt 65535)) {
            Stop-PublicReaderContract
        }
    }
    return ,$Rows.ToArray()
}

function Select-PublicReaderCluster([string]$Text) {
    $Contract = Get-PublicReaderContract
    $Rows = ConvertFrom-PublicReaderRac $Text cluster
    $Selected = @($Rows | Where-Object { $_.host -ceq $Contract.host -and $_.port -ceq $Contract.port })
    if ($Selected.Count -ne 1) { Stop-PublicReaderContract }
    return $Selected[0].cluster
}

function New-PublicReaderBinding([string]$ClusterId, [string]$SummaryText) {
    Assert-PublicReaderUuid $ClusterId
    $Contract = Get-PublicReaderContract
    $Rows = ConvertFrom-PublicReaderRac $SummaryText infobase
    $Selected = @($Rows | Where-Object { $_.name -ceq $Contract.ref })
    if ($Selected.Count -ne 1) { Stop-PublicReaderContract }
    return [ordered]@{
        server = $Contract.server; ref = $Contract.ref
        clusterId = $ClusterId; infobaseRegistrationId = $Selected[0].infobase
    }
}

function Assert-PublicReaderBinding($Binding) {
    Assert-PublicReaderKeys $Binding @('server','ref','clusterId','infobaseRegistrationId')
    $Contract = Get-PublicReaderContract
    if ($Binding.server -isnot [string] -or $Binding.ref -isnot [string] -or
        $Binding.server -cne $Contract.server -or $Binding.ref -cne $Contract.ref) { Stop-PublicReaderContract }
    Assert-PublicReaderUuid $Binding.clusterId
    Assert-PublicReaderUuid $Binding.infobaseRegistrationId
}

function Assert-PublicReaderSameBinding($Before, $After) {
    Assert-PublicReaderBinding $Before
    Assert-PublicReaderBinding $After
    foreach ($Key in @('server','ref','clusterId','infobaseRegistrationId')) {
        if ($Before[$Key] -cne $After[$Key]) { Stop-PublicReaderContract }
    }
}

function Assert-PublicReaderResult($Result, [string]$Mode, [string]$OperationId, [string]$NativeUserId = '',
    [string]$CurrentVersion = '0.4.0-lab.6') {
    Assert-PublicReaderKeys $Result @('schema','purpose','mode','operationId','status','server','ref',
        'nativeUserId','name','roleName','roleUuid','standardAuth','osAuth','showInList','configurationVersion','checkedAtUtc')
    $Contract = Get-PublicReaderContract
    Assert-PublicReaderCurrentVersion $CurrentVersion $Mode
    Assert-PublicReaderUuid $OperationId
    Assert-PublicReaderUuid $Result.nativeUserId
    Assert-PublicReaderUuid $Result.operationId
    foreach ($Key in @('purpose','mode','status','server','ref','name','roleName','roleUuid','configurationVersion')) {
        if ($Result[$Key] -isnot [string]) { Stop-PublicReaderContract }
    }
    $Status = if ($Mode -ceq 'create') { 'created' } elseif ($Mode -ceq 'verify') { 'verified' } else { Stop-PublicReaderContract }
    if ($Result.schema -isnot [long] -and $Result.schema -isnot [int]) { Stop-PublicReaderContract }
    foreach ($Key in @('schema','purpose','server','ref','name','roleName','roleUuid')) {
        if ($Result[$Key] -cne $Contract[$Key]) { Stop-PublicReaderContract }
    }
    if ($Result.configurationVersion -cne $CurrentVersion) { Stop-PublicReaderContract }
    if ($Result.mode -cne $Mode -or $Result.operationId -cne $OperationId -or $Result.status -cne $Status -or
        $Result.standardAuth -isnot [bool] -or -not $Result.standardAuth -or
        $Result.osAuth -isnot [bool] -or $Result.osAuth -or
        $Result.showInList -isnot [bool] -or $Result.showInList) { Stop-PublicReaderContract }
    if ($NativeUserId -ne '') {
        Assert-PublicReaderUuid $NativeUserId
        if ($Result.nativeUserId -cne $NativeUserId) { Stop-PublicReaderContract }
    }
    Assert-PublicReaderUtc $Result.checkedAtUtc
}

function Assert-PublicReaderReceipt($Receipt, [string]$CurrentVersion = '') {
    Assert-PublicReaderKeys $Receipt @('schema','purpose','status','operationId','target','nativeResult','completedAtUtc')
    $Contract = Get-PublicReaderContract
    if (($Receipt.schema -isnot [long] -and $Receipt.schema -isnot [int]) -or
        $Receipt.schema -ne 1 -or $Receipt.purpose -isnot [string] -or $Receipt.status -isnot [string] -or
        $Receipt.purpose -cne $Contract.purpose -or $Receipt.status -cne 'completed') {
        Stop-PublicReaderContract
    }
    Assert-PublicReaderUuid $Receipt.operationId
    Assert-PublicReaderBinding $Receipt.target
    if ($Receipt.nativeResult -isnot [Collections.IDictionary] -or
        @($Receipt.nativeResult.Keys) -cnotcontains 'configurationVersion') { Stop-PublicReaderContract }
    $CreationVersion = $Receipt.nativeResult.configurationVersion
    Assert-PublicReaderCurrentVersion $CreationVersion create
    Assert-PublicReaderResult $Receipt.nativeResult create $Receipt.operationId '' $CreationVersion
    if ($CurrentVersion -cne '') {
        Assert-PublicReaderCurrentVersion $CurrentVersion verify
        if (($CreationVersion -ceq '0.6.0-p0' -and $CurrentVersion -cnotin @('0.6.0-p0','1.0')) -or
            ($CreationVersion -ceq '1.0' -and $CurrentVersion -cne '1.0')) { Stop-PublicReaderContract }
    }
    Assert-PublicReaderUtc $Receipt.completedAtUtc
    if ([string]::CompareOrdinal($Receipt.completedAtUtc, $Receipt.nativeResult.checkedAtUtc) -lt 0) {
        Stop-PublicReaderContract
    }
}

function New-PublicReaderReceipt($Binding, $Result, [string]$CompletedAtUtc) {
    Assert-PublicReaderBinding $Binding
    Assert-PublicReaderResult $Result create $Result.operationId '' $Result.configurationVersion
    $Receipt = [ordered]@{
        schema = 1; purpose = 'public_lab_native_principal'; status = 'completed'
        operationId = $Result.operationId; target = $Binding; nativeResult = $Result; completedAtUtc = $CompletedAtUtc
    }
    Assert-PublicReaderReceipt $Receipt
    return $Receipt
}
