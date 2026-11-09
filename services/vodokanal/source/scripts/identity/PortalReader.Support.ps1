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
    [ordered]@{schema=1;purpose='public_portal_native_principal';server='onec:1541';ref='vodokanal';host='onec';port='1541';name='vodokanal_portal_reader';roleName='ПубличноеЧтениеПортала';configurationVersion=$ExpectedVersion}
}
