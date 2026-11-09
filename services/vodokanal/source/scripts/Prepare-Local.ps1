[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$ArchivePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Distribution = Join-Path $Root 'vendor/onec'
$InstallerName = 'setup-full-8.5.1.1522-x86_64.run'
$Installer = Join-Path $Distribution $InstallerName
$Secret = Join-Path $Root 'secrets/pg_password.txt'

[void][IO.Directory]::CreateDirectory($Distribution)
[void][IO.Directory]::CreateDirectory((Split-Path $Secret -Parent))

if (-not (Test-Path -LiteralPath $Installer -PathType Leaf)) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $ZipPath = (Resolve-Path -LiteralPath $ArchivePath).ProviderPath
    $Zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    $Partial = Join-Path $Distribution ($InstallerName + '.' + [guid]::NewGuid().ToString('N') + '.partial')
    try {
        $Entry = $Zip.GetEntry($InstallerName)
        if ($null -eq $Entry) { throw "В архиве отсутствует запись $InstallerName." }
        $InputStream = $Entry.Open()
        try {
            $OutputStream = [IO.File]::Open($Partial, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write)
            try { $InputStream.CopyTo($OutputStream) }
            finally { $OutputStream.Dispose() }
        }
        finally { $InputStream.Dispose() }
        if ((Get-Item -LiteralPath $Partial).Length -ne $Entry.Length) {
            throw 'Размер извлечённого установщика не совпадает с метаданными архива.'
        }
        Move-Item -LiteralPath $Partial -Destination $Installer
    }
    finally {
        $Zip.Dispose()
        if (Test-Path -LiteralPath $Partial) { Remove-Item -LiteralPath $Partial }
    }
}

$Digest = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
$ChecksumPath = $Installer + '.sha256'
if (Test-Path -LiteralPath $ChecksumPath) {
    $Expected = ([IO.File]::ReadAllText($ChecksumPath) -split '\s+')[0]
    if ($Digest -ne $Expected) { throw 'Установщик не совпадает с сохранённой контрольной суммой. Проверьте причину перед заменой.' }
}
else {
    [IO.File]::WriteAllText($ChecksumPath, "$Digest  $InstallerName`n", [Text.Encoding]::ASCII)
}
Write-Host "Installer ready. SHA256: $Digest"

if (-not (Test-Path -LiteralPath $Secret)) {
    $Bytes = New-Object byte[] 32
    $Random = [Security.Cryptography.RandomNumberGenerator]::Create()
    try { $Random.GetBytes($Bytes) }
    finally { $Random.Dispose() }
    $Password = [BitConverter]::ToString($Bytes).Replace('-', '').ToLowerInvariant()
    [IO.File]::WriteAllText($Secret, $Password + "`n", [Text.Encoding]::ASCII)
    $Password = $null
    [Array]::Clear($Bytes, 0, $Bytes.Length)
    Write-Host 'Created a new PostgreSQL secret (contents hidden).'
}
else {
    Write-Host 'Existing PostgreSQL secret preserved.'
}

if ([Environment]::OSVersion.Platform -eq [PlatformID]::Win32NT) {
    $UserSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    $SystemSid = 'S-1-5-18'
    & icacls $Secret /inheritance:r /grant:r "*${UserSid}:(F)" "*${SystemSid}:(F)" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось ограничить права доступа к секретному файлу.' }
    $Acl = Get-Acl -LiteralPath $Secret
    foreach ($Rule in @($Acl.Access)) {
        $Sid = $Rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
        if ($Sid -notin @($UserSid, $SystemSid)) {
            & icacls $Secret /remove "*$Sid" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Не удалось удалить непредусмотренное правило доступа к секрету.' }
        }
        elseif ($Rule.AccessControlType -eq 'Deny') {
            & icacls $Secret /remove:d "*$Sid" | Out-Null
            if ($LASTEXITCODE -ne 0) { throw 'Не удалось удалить конфликтующее правило доступа к секрету.' }
        }
    }
}
else {
    & chmod 600 $Secret
    if ($LASTEXITCODE -ne 0) { throw 'Не удалось ограничить права доступа к секретному файлу.' }
}

Write-Host 'Local files prepared. No images built and no containers started.'
