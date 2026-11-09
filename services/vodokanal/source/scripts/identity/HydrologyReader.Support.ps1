$HelperInputs = [ordered]@{}
$HelperSets = @(
    @{ path = 'scripts/identity/PublicReaderProvision.Support.ps1'; names = @(
        'Stop-PublicReaderContract','Assert-PublicReaderKeys','Assert-PublicReaderUuid','Assert-PublicReaderUtc',
        'Test-PublicReaderPassword','ConvertFrom-PublicReaderJson','ConvertFrom-PublicReaderRac',
        'Select-PublicReaderCluster','New-PublicReaderBinding','Assert-PublicReaderBinding',
        'Assert-PublicReaderSameBinding','Assert-PublicReaderResult','Assert-PublicReaderReceipt') },
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
    if ($ParseErrors.Count) { throw 'Не удалось разобрать проверенный исходник вспомогательной функции.' }
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
    [ordered]@{
        schema = 1; purpose = 'public_hydrology_native_principal'; server = 'onec:1541'; ref = 'vodokanal'
        host = 'onec'; port = '1541'; name = 'vodokanal_hydrology_reader'
        roleName = 'ПубличноеЧтениеГидрологии'; roleUuid = 'd9bb82f0-0782-02b2-dc94-7262b37574b4'
        configurationVersion = '0.5.0-p0.1'
    }
}
function Assert-PublicReaderCurrentVersion($Value, [string]$Mode = 'verify') {
    if ($Mode -cnotin @('create','verify') -or $Value -isnot [string] -or
        $Value -cnotin @('0.5.0-p0.1','0.6.0-p0','1.0')) {
        Stop-PublicReaderContract
    }
}
function New-HydrologyReaderReceipt($Binding, $Result, [string]$CompletedAtUtc) {
    Assert-PublicReaderBinding $Binding
    Assert-PublicReaderResult $Result create $Result.operationId '' $Result.configurationVersion
    $Receipt = [ordered]@{
        schema = 1; purpose = 'public_hydrology_native_principal'; status = 'completed'
        operationId = $Result.operationId; target = $Binding; nativeResult = $Result; completedAtUtc = $CompletedAtUtc
    }
    Assert-PublicReaderReceipt $Receipt
    return $Receipt
}
