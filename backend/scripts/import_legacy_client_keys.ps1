param(
    [string]$LegacyZip = "$env:USERPROFILE\Downloads\invotaxi-master (2) (1).zip",
    [string]$ApiBaseUrl = "http://localhost:8000/api/v1"
)

$ErrorActionPreference = "Stop"
$backendRoot = Split-Path -Parent $PSScriptRoot
$workspaceRoot = Split-Path -Parent $backendRoot
$archive = [System.IO.Path]::GetFullPath($LegacyZip)
if (-not (Test-Path -LiteralPath $archive) -or [System.IO.Path]::GetExtension($archive) -ne '.zip') {
    throw "Legacy ZIP was not found: $archive"
}
$tempBase = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$tempRoot = Join-Path $tempBase "invotaxi-key-import-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $tempRoot | Out-Null
Expand-Archive -LiteralPath $archive -DestinationPath $tempRoot
$legacyFrontendPath = Get-ChildItem -LiteralPath $tempRoot -Recurse -Force -File -Filter '.env' |
    Where-Object { $_.FullName -match '[\\/]frontend[\\/]\.env$' } |
    Select-Object -First 1
if (-not $legacyFrontendPath) {
    throw "frontend/.env is missing in the legacy ZIP"
}
$legacy = Split-Path -Parent (Split-Path -Parent $legacyFrontendPath.FullName)

function Read-EnvFile([string]$Path) {
    $result = @{}
    foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
        if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=(.*)$') {
            $result[$matches[1]] = $matches[2].Trim().Trim('"').Trim("'")
        }
    }
    return $result
}

function Upsert-Env([string]$Path, [hashtable]$Values) {
    $lines = [System.Collections.Generic.List[string]]::new()
    if (Test-Path -LiteralPath $Path) {
        foreach ($line in [System.IO.File]::ReadAllLines($Path)) {
            $name = if ($line -match '^([A-Za-z_][A-Za-z0-9_]*)=') { $matches[1] } else { $null }
            if ($name -and $Values.ContainsKey($name)) {
                $lines.Add("$name=$($Values[$name])")
                $Values.Remove($name)
            } else {
                $lines.Add($line)
            }
        }
    }
    foreach ($entry in $Values.GetEnumerator()) {
        $lines.Add("$($entry.Key)=$($entry.Value)")
    }
    [System.IO.File]::WriteAllLines($Path, $lines)
}

$legacyFrontend = Read-EnvFile (Join-Path $legacy "frontend\.env")
$mapsKey = $legacyFrontend['VITE_YANDEX_MAPS_API_KEY']
$suggestKey = $legacyFrontend['VITE_YANDEX_MAPS_SUGGEST_API_KEY']
if ([string]::IsNullOrWhiteSpace($mapsKey)) { throw "Yandex Maps key is missing in legacy frontend/.env" }
if ([string]::IsNullOrWhiteSpace($suggestKey)) { throw "Yandex Suggest key is missing in legacy frontend/.env" }
$clientSuggestKey = $suggestKey
if ($suggestKey -eq $mapsKey) {
    Write-Warning "The legacy Suggest key duplicates the Maps/Geocoder key; Suggest is disabled and clients will use Geocoder fallback."
    $clientSuggestKey = ''
}

$frontendEnv = @(
    'VITE_API_BASE_URL=http://localhost:8000/api/v1',
    'VITE_ALLOW_DEV_LOGIN=true',
    "VITE_YANDEX_MAPS_API_KEY=$mapsKey",
    "VITE_YANDEX_MAPS_SUGGEST_API_KEY=$clientSuggestKey"
)
[System.IO.File]::WriteAllLines((Join-Path $workspaceRoot "frontend\.env.local"), $frontendEnv)

$appConfig = [ordered]@{
    API_BASE_URL = $ApiBaseUrl
    ALLOW_DEV_LOGIN = 'true'
    YANDEX_MAPS_API_KEY = $mapsKey
    YANDEX_MAPS_SUGGEST_API_KEY = $clientSuggestKey
}
$appConfig | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $workspaceRoot "app\config\local.json") -Encoding utf8

Upsert-Env (Join-Path $backendRoot ".env") @{
    DEV_AUTO_REGISTER = 'true'
    DEV_APP_PASSWORD = '1111'
    CORS_ALLOWED_ORIGINS = 'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080'
    VITE_ALLOW_DEV_LOGIN = 'true'
    VITE_YANDEX_MAPS_API_KEY = $mapsKey
    VITE_YANDEX_MAPS_SUGGEST_API_KEY = $clientSuggestKey
}

Write-Output "Legacy client keys imported into ignored local configuration files."

$resolvedTemp = [System.IO.Path]::GetFullPath($tempRoot)
if ($resolvedTemp.StartsWith($tempBase) -and (Split-Path -Leaf $resolvedTemp).StartsWith('invotaxi-key-import-')) {
    Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
}
