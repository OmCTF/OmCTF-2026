[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Path = Join-Path $Root 'secrets/native-operator.json'
if (Test-Path -LiteralPath $Path) {
    $Existing = Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json
    if ($Existing.schema -ne 1 -or [string]::IsNullOrWhiteSpace($Existing.administrator.name) -or
        [string]::IsNullOrWhiteSpace($Existing.dispatcher.name)) { throw 'Файл оператора имеет непредусмотренную структуру.' }
    $Data = $Existing
    Write-Host 'Existing private operator credentials preserved.'
}
else {
    function New-PrivatePassword {
        [Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).TrimEnd('=').Replace('+','-').Replace('/','_')
    }
    $Data = [ordered]@{schema=1;
        administrator=@{name='dev_operator';password=(New-PrivatePassword)};
        dispatcher=@{name='dev_dispatcher';password=(New-PrivatePassword)}}
    $Data | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $Path -Encoding utf8NoBOM
}
$AdminUserPath = Join-Path $Root 'secrets/native_admin_user.txt'
$AdminPasswordPath = Join-Path $Root 'secrets/native_admin_password.txt'
$Data.administrator.name | Set-Content -LiteralPath $AdminUserPath -Encoding utf8NoBOM -NoNewline
$Data.administrator.password | Set-Content -LiteralPath $AdminPasswordPath -Encoding utf8NoBOM -NoNewline
foreach ($PrivatePath in @($Path,$AdminUserPath,$AdminPasswordPath)) {
    & icacls $PrivatePath /inheritance:r /grant:r (([Security.Principal.WindowsIdentity]::GetCurrent().Name)+':F') 'SYSTEM:F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось ограничить права доступа к файлу учётных данных оператора.' }
}
Write-Host 'Private native operator files prepared; no values were printed.'
