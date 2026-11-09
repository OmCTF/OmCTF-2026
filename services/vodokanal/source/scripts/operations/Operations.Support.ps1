#requires -Version 7.0
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $false
$script:OperationsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))

function Invoke-OperationsDocker([string[]]$Arguments) {
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Операция Докера завершилась с ошибкой (код=$LASTEXITCODE)." }
}

function Get-OperationsStack {
    $compose = @('compose','-f',(Join-Path $script:OperationsRoot 'compose.yaml'))
    $db = ([string](& docker @compose ps -q db)).Trim()
    $onec = ([string](& docker @compose ps -q onec)).Trim()
    if ($LASTEXITCODE -ne 0 -or $db -notmatch '^[a-f0-9]{64}$' -or $onec -notmatch '^[a-f0-9]{64}$') {
        throw 'Требуются существующие контейнеры базы данных и 1С. Эта команда их не создаёт и не заменяет.'
    }
    return @{Db=$db;Onec=$onec}
}

function Resolve-OperationsPath([string]$Path,[string]$AllowedDirectory) {
    $full = [IO.Path]::GetFullPath($Path)
    $base = [IO.Path]::GetFullPath($AllowedDirectory).TrimEnd([IO.Path]::DirectorySeparatorChar)
    if (-not $full.StartsWith($base + [IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase)) {
        throw 'Путь находится вне разрешённого каталога оператора.'
    }
    $current = $full
    while ($current -and $current.Length -ge $base.Length) {
        if (Test-Path -LiteralPath $current) {
            if ((Get-Item -LiteralPath $current -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Пути через точки повторной обработки запрещены.' }
        }
        if ($current -eq $base) { break }
        $current = Split-Path -Parent $current
    }
    return $full
}

function Read-OperationsBackupManifest([string]$ManifestPath) {
    $path = Resolve-OperationsPath $ManifestPath (Join-Path $script:OperationsRoot 'backups')
    $manifest = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -AsHashtable
    if ($manifest.schema -cne 'vodokanal.backup.v1' -or $manifest.database -isnot [string] -or
        $manifest.database -cnotmatch '\A(vodokanal|vk_restore_[a-z0-9_]{1,32})\z') { throw 'Манифест резервной копии некорректен.' }
    $archive = Resolve-OperationsPath $manifest.archive (Join-Path $script:OperationsRoot 'backups')
    if (-not (Test-Path -LiteralPath $archive -PathType Leaf)) { throw 'Архив резервной копии отсутствует.' }
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -cne $manifest.archiveSha256) { throw 'Контрольная сумма резервной копии не совпадает.' }
    if ((Get-Item -LiteralPath $archive).Length -lt 1000) { throw 'Архив резервной копии слишком мал.' }
    return $manifest
}

function Write-OperationsManifest([string]$Path,[object]$Data) {
    $bytes = [Text.UTF8Encoding]::new($false).GetBytes(($Data | ConvertTo-Json -Depth 12))
    $stream = [IO.File]::Open($Path,[IO.FileMode]::CreateNew,[IO.FileAccess]::Write,[IO.FileShare]::None)
    try { $stream.Write($bytes,0,$bytes.Length); $stream.Flush($true) }
    finally { $stream.Dispose() }
}

function New-OperationsMigrationReservation([string]$MigrationId,[object]$Data) {
    if ($MigrationId -cnotmatch '\A[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}\z') { throw 'Идентификатор миграции некорректен.' }
    $directory = Join-Path $script:OperationsRoot 'backups'
    [void][IO.Directory]::CreateDirectory($directory)
    $started = Resolve-OperationsPath (Join-Path $directory ('migration-' + $MigrationId + '.json')) $directory
    $outcome = Resolve-OperationsPath (Join-Path $directory ('migration-' + $MigrationId + '.result.json')) $directory
    $active = Resolve-OperationsPath (Join-Path $directory 'migration-active.json') $directory
    if ((Test-Path -LiteralPath $started) -or (Test-Path -LiteralPath $outcome)) { throw 'Для миграции уже существует квитанция. Повторный запуск без проверки запрещён.' }
    Write-OperationsManifest $active @{schema='vodokanal.migration-lock.v1';migrationId=$MigrationId;started=$started;outcome=$outcome}
    Write-OperationsManifest $started $Data
    return @{started=$started;outcome=$outcome;active=$active}
}

function New-OperationsBackup([string]$Database,[hashtable]$Stack,[string]$ConfigurationFile='') {
    if ($Database -cnotmatch '\A(vodokanal|vk_restore_[a-z0-9_]{1,32})\z') { throw 'База данных не входит в разрешённый список оператора.' }
    $run = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ') + '-' + [guid]::NewGuid().ToString('N')
    $directory = Join-Path $script:OperationsRoot 'backups'
    [void][IO.Directory]::CreateDirectory($directory)
    $archive = Resolve-OperationsPath (Join-Path $directory ($Database + '-' + $run + '.dump')) $directory
    $remote = '/tmp/vodokanal-operator-' + $run + '.dump'
    try {
        Invoke-OperationsDocker @('exec',$Stack.Db,'gosu','postgres','pg_dump','--format=custom','--file',$remote,$Database)
        $index = @(& docker exec $Stack.Db gosu postgres pg_restore --list $remote)
        if ($LASTEXITCODE -ne 0 -or $index.Count -lt 10) { throw 'Не удалось прочитать индекс архива резервной копии.' }
        Invoke-OperationsDocker @('cp',($Stack.Db + ':' + $remote),$archive)
        $cf = $null
        if ($ConfigurationFile) {
            $source = (Resolve-Path -LiteralPath $ConfigurationFile).Path
            if ([IO.Path]::GetExtension($source) -ne '.cf') { throw 'Снимок конфигурации должен быть файлом .cf.' }
            $copy = $archive + '.cf'; Copy-Item -LiteralPath $source -Destination $copy -ErrorAction Stop
            $cf = @{path=$copy;sha256=(Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash}
        }
        $data = [ordered]@{schema='vodokanal.backup.v1';createdUtc=[DateTime]::UtcNow.ToString('o');database=$Database;
            archive=$archive;archiveSha256=(Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash;
            archiveBytes=(Get-Item -LiteralPath $archive).Length;sourceDbContainer=$Stack.Db;originalOnecContainer=$Stack.Onec;
            configuration=$cf;restoreVerified=$false;publicDownload=$false}
        $manifest = $archive + '.json'; Write-OperationsManifest $manifest $data
        return $manifest
    }
    finally {
        & docker exec $Stack.Db rm -f -- $remote | Out-Null
    }
}
