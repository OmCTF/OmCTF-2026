[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Vendor = Join-Path $Root 'vendor/gui'
$Secret = Join-Path $Root 'secrets/gui_password.txt'
[void][IO.Directory]::CreateDirectory($Vendor)
[void][IO.Directory]::CreateDirectory((Split-Path $Secret -Parent))
$Archive = Join-Path $Vendor 'noVNC-1.7.0.tar.gz'
if (-not (Test-Path -LiteralPath $Archive -PathType Leaf)) {
    $Partial = $Archive + '.' + [guid]::NewGuid().ToString('N') + '.partial'
    try {
        Invoke-WebRequest -Uri 'https://codeload.github.com/novnc/noVNC/tar.gz/refs/tags/v1.7.0' -UseBasicParsing -OutFile $Partial
        Move-Item -LiteralPath $Partial -Destination $Archive
    }
    finally { if (Test-Path -LiteralPath $Partial) { Remove-Item -LiteralPath $Partial } }
}
$Hash = (Get-FileHash -LiteralPath $Archive -Algorithm SHA256).Hash.ToLowerInvariant()
$Checksum = $Archive + '.sha256'
if (Test-Path -LiteralPath $Checksum) {
    $Expected = ([IO.File]::ReadAllText($Checksum) -split '\s+')[0]
    if ($Hash -ne $Expected) { throw 'Архив удалённого экрана не совпадает с сохранённой контрольной суммой.' }
}
else { [IO.File]::WriteAllText($Checksum, "$Hash  noVNC-1.7.0.tar.gz`n", [Text.Encoding]::ASCII) }
Write-Host "noVNC source ready; local SHA256: $Hash"
if (-not (Test-Path -LiteralPath $Secret -PathType Leaf)) {
    $Bytes = New-Object byte[] 6
    $Random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Random.GetBytes($Bytes) } finally { $Random.Dispose() }
    [IO.File]::WriteAllText($Secret, ([Convert]::ToBase64String($Bytes) + "`n"), [Text.Encoding]::ASCII)
    [Array]::Clear($Bytes, 0, $Bytes.Length)
    Write-Host 'Created an independent VNC secret; contents hidden.'
}
if ([IO.File]::ReadAllText($Secret).Trim().Length -ne 8) { throw 'Секрет удалённого экрана должен содержать ровно восемь символов.' }
if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls $Secret /inheritance:r /grant:r "*${UserSid}:(F)" '*S-1-5-18:(F)' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось ограничить права доступа к секрету удалённого экрана.' }
    foreach ($Rule in @((Get-Acl -LiteralPath $Secret).Access)) {
        $Sid = $Rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($Sid -notin @($UserSid, 'S-1-5-18')) {
            & icacls $Secret /remove "*$Sid" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Не удалось удалить непредусмотренное правило доступа к секрету удалённого экрана.' }
        }
    }
}
else { & chmod 600 $Secret; if ($LASTEXITCODE -ne 0) { throw 'Не удалось ограничить права доступа к секрету удалённого экрана.' } }
Write-Host 'GUI prerequisites prepared. No developer account credentials are read or stored.'
