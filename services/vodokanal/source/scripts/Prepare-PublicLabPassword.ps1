#requires -Version 7.0
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Для подготовки пароля публичной лаборатории требуется поддержка прав доступа Windows.' }

$Root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$Directory = Join-Path $Root 'secrets'
$Path = Join-Path $Directory 'public_lab_password.txt'
$Owner = [Security.Principal.WindowsIdentity]::GetCurrent().User
$System = [Security.Principal.SecurityIdentifier]::new('S-1-5-18')

function Assert-PlainPath {
    param([string]$Candidate)
    $Cursor = [IO.Path]::GetFullPath($Candidate)
    while ($Cursor) {
        try {
            $Attributes = [IO.File]::GetAttributes($Cursor)
            if (($Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
                throw 'пароль_публичного_читателя_недопустимая_ссылка'
            }
        }
        catch [IO.FileNotFoundException] { }
        catch [IO.DirectoryNotFoundException] { }
        $Parent = [IO.Path]::GetDirectoryName($Cursor)
        if ($Parent -eq $Cursor) { break }
        $Cursor = $Parent
    }
}

function New-PrivateFileSecurity {
    $Security = [Security.AccessControl.FileSecurity]::new()
    $Security.SetOwner($Owner)
    $Security.SetAccessRuleProtection($true, $false)
    foreach ($Sid in @($Owner, $System) | Select-Object -Unique) {
        $Rule = [Security.AccessControl.FileSystemAccessRule]::new(
            $Sid, [Security.AccessControl.FileSystemRights]::FullControl,
            [Security.AccessControl.AccessControlType]::Allow)
        [void]$Security.AddAccessRule($Rule)
    }
    return $Security
}

function Assert-PrivateFileSecurity {
    param([Security.AccessControl.FileSecurity]$Security)
    if (-not $Security.AreAccessRulesProtected -or
        $Security.GetOwner([Security.Principal.SecurityIdentifier]).Value -cne $Owner.Value) {
        throw 'пароль_публичного_читателя_неверный_владелец_или_наследование'
    }
    $Expected = @($Owner.Value, $System.Value) | Select-Object -Unique
    $Rules = @($Security.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]))
    if ($Rules.Count -ne $Expected.Count) { throw 'пароль_публичного_читателя_неожиданные_права' }
    foreach ($Sid in $Expected) {
        $Matches = @($Rules | Where-Object { $_.IdentityReference.Value -ceq $Sid })
        if ($Matches.Count -ne 1 -or $Matches[0].IsInherited -or
            $Matches[0].AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow -or
            $Matches[0].FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl) {
            throw 'пароль_публичного_читателя_неожиданные_права'
        }
    }
}

function Test-PasswordText {
    param([string]$Value)
    return $Value -cmatch '^[A-Za-z0-9_-]{64}$' -and
        $Value -cmatch '[A-Z]' -and $Value -cmatch '[a-z]' -and $Value -cmatch '[0-9]'
}

function Read-ValidatedPassword {
    param([IO.FileStream]$Stream)
    if ($Stream.Length -ne 64) { throw 'пароль_публичного_читателя_некорректная_длина' }
    $Bytes = [byte[]]::new(64)
    try {
        $Offset = 0
        while ($Offset -lt $Bytes.Length) {
            $Read = $Stream.Read($Bytes, $Offset, $Bytes.Length - $Offset)
            if ($Read -eq 0) { throw 'пароль_публичного_читателя_прочитан_не_полностью' }
            $Offset += $Read
        }
        foreach ($Byte in $Bytes) {
            if ($Byte -gt 127) { throw 'пароль_публичного_читателя_недопустимые_символы' }
        }
        $Value = [Text.Encoding]::ASCII.GetString($Bytes)
        if (-not (Test-PasswordText $Value)) { throw 'пароль_публичного_читателя_некорректный_формат' }
    }
    finally {
        [Array]::Clear($Bytes, 0, $Bytes.Length)
        $Value = $null
    }
}

$Stream = $null
$RandomBytes = $null
$PasswordBytes = $null
$Password = $null
try {
    Assert-PlainPath $Path
    if (-not [IO.Directory]::Exists($Directory)) {
        $DirectorySecurity = [Security.AccessControl.DirectorySecurity]::new()
        $DirectorySecurity.SetOwner($Owner)
        $DirectorySecurity.SetAccessRuleProtection($true, $false)
        foreach ($Sid in @($Owner, $System) | Select-Object -Unique) {
            $Rule = [Security.AccessControl.FileSystemAccessRule]::new(
                $Sid, [Security.AccessControl.FileSystemRights]::FullControl,
                [Security.AccessControl.InheritanceFlags]'ContainerInherit, ObjectInherit',
                [Security.AccessControl.PropagationFlags]::None,
                [Security.AccessControl.AccessControlType]::Allow)
            [void]$DirectorySecurity.AddAccessRule($Rule)
        }
        [IO.FileSystemAclExtensions]::Create([IO.DirectoryInfo]::new($Directory), $DirectorySecurity)
    }
    Assert-PlainPath $Path
    if ([IO.File]::Exists($Path)) {
        $Stream = [IO.FileStream]::new($Path, [IO.FileMode]::Open,
            [IO.FileAccess]::Read, [IO.FileShare]::None)
        Assert-PrivateFileSecurity ([IO.FileSystemAclExtensions]::GetAccessControl($Stream))
        Read-ValidatedPassword $Stream
        $State = 'preserved'
    }
    else {
        do {
            $RandomBytes = [Security.Cryptography.RandomNumberGenerator]::GetBytes(48)
            $Password = [Convert]::ToBase64String($RandomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
            [Array]::Clear($RandomBytes, 0, $RandomBytes.Length)
        } until (Test-PasswordText $Password)
        $PasswordBytes = [Text.Encoding]::ASCII.GetBytes($Password)
        $Stream = [IO.FileSystemAclExtensions]::Create([IO.FileInfo]::new($Path),
            [IO.FileMode]::CreateNew, [Security.AccessControl.FileSystemRights]::FullControl,
            [IO.FileShare]::None, 4096, [IO.FileOptions]::WriteThrough,
            (New-PrivateFileSecurity))
        Assert-PrivateFileSecurity ([IO.FileSystemAclExtensions]::GetAccessControl($Stream))
        $Stream.Write($PasswordBytes, 0, $PasswordBytes.Length)
        $Stream.Flush($true)
        $Stream.Position = 0
        Read-ValidatedPassword $Stream
        $State = 'created'
    }
}
catch {
    throw 'Подготовка пароля публичной лаборатории отклонена. Существующий файл не заменён; локально проверьте путь, владельца, права доступа и формат.'
}
finally {
    if ($null -ne $Stream) { $Stream.Dispose() }
    foreach ($Buffer in @($RandomBytes, $PasswordBytes)) {
        if ($null -ne $Buffer) { [Array]::Clear($Buffer, 0, $Buffer.Length) }
    }
    $Password = $null
}

[pscustomobject]@{
    schema = 1
    state = $State
    path = $Path
    nativeAccountVerified = $false
    publicationEnabled = $false
    note = 'File preparation only. No native user was created or verified.'
} | ConvertTo-Json
