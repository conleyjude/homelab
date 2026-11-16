[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [Parameter()]
    [string]$PiTarget = 'ubuntu@192.168.0.71',

    [Parameter()]
    [string]$RemoteRepoName = 'homelab'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($PiTarget)) {
    throw 'Pass -PiTarget user@host.'
}
if ($RemoteRepoName -notmatch '^[A-Za-z0-9._-]+$') {
    throw '-RemoteRepoName must be a simple directory name without slashes or spaces.'
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$requiredCommands = @('ssh', 'scp', 'tar.exe')
foreach ($command in $requiredCommands) {
    if (-not (Get-Command $command -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $command"
    }
}

$apiRoot = Join-Path $repoRoot 'apps\api'
if (-not (Test-Path (Join-Path $repoRoot '.dockerignore'))) { throw 'Repository .dockerignore is missing.' }
if (-not (Test-Path (Join-Path $apiRoot 'Dockerfile'))) { throw 'API Dockerfile is missing.' }
if (-not (Test-Path (Join-Path $repoRoot 'deploy\pi\compose.yaml'))) { throw 'Pi Compose file is missing.' }

if (-not $PSCmdlet.ShouldProcess("$PiTarget -> ~/$RemoteRepoName", 'Transfer source and build/start the API container with its local dashboard')) {
    return
}

$sshOptions = @('-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=10')
$runId = [Guid]::NewGuid().ToString('N')
$temporaryRoot = Join-Path $env:TEMP "homelab-deploy-$runId"
$repositoryStage = Join-Path $temporaryRoot 'repository'
$archivePath = Join-Path $env:TEMP "homelab-deploy-$runId.tar.gz"

function Invoke-CheckedNativeCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string[]]$Arguments
    )
    & $Name @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$Name failed with exit code $LASTEXITCODE."
    }
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination
    )
    New-Item -ItemType Directory -Force -Path $Destination | Out-Null
    Get-ChildItem -LiteralPath $Source -Force | Copy-Item -Destination $Destination -Recurse -Force
}

try {
    Write-Host '[1/4] Staging API, dashboard, and deployment source...' -ForegroundColor Cyan
    New-Item -ItemType Directory -Force -Path $repositoryStage | Out-Null
    Copy-Item -LiteralPath (Join-Path $repoRoot '.dockerignore') -Destination $repositoryStage
    New-Item -ItemType Directory -Force -Path (Join-Path $repositoryStage 'apps\api') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $repositoryStage 'deploy\pi') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $repositoryStage 'apps\dashboard') | Out-Null
    New-Item -ItemType Directory -Force -Path (Join-Path $repositoryStage 'integrations\weather') | Out-Null
    Copy-Item -LiteralPath (Join-Path $apiRoot 'Dockerfile') -Destination (Join-Path $repositoryStage 'apps\api\Dockerfile') -Force
    Copy-DirectoryContents -Source (Join-Path $apiRoot 'src') -Destination (Join-Path $repositoryStage 'apps\api\src')
    Copy-Item -LiteralPath (Join-Path $repoRoot 'deploy\pi\compose.yaml') -Destination (Join-Path $repositoryStage 'deploy\pi\compose.yaml') -Force
    Copy-Item -LiteralPath (Join-Path $repoRoot 'deploy\pi\setup-kiosk.sh') -Destination (Join-Path $repositoryStage 'deploy\pi\setup-kiosk.sh') -Force
    Copy-DirectoryContents -Source (Join-Path $repoRoot 'integrations\whoop\server') -Destination (Join-Path $repositoryStage 'integrations\whoop\server')
    Copy-DirectoryContents -Source (Join-Path $repoRoot 'integrations\weather\server') -Destination (Join-Path $repositoryStage 'integrations\weather\server')
    Copy-DirectoryContents -Source (Join-Path $repoRoot 'integrations\weather\dashboard') -Destination (Join-Path $repositoryStage 'integrations\weather\dashboard')
    foreach ($file in @('package.json', 'package-lock.json', 'index.html', 'vite.config.mjs')) {
        Copy-Item -LiteralPath (Join-Path $repoRoot "apps\dashboard\$file") -Destination (Join-Path $repositoryStage "apps\dashboard\$file") -Force
    }
    Copy-DirectoryContents -Source (Join-Path $repoRoot 'apps\dashboard\src') -Destination (Join-Path $repositoryStage 'apps\dashboard\src')
    Copy-DirectoryContents -Source (Join-Path $repoRoot 'integrations\whoop\dashboard') -Destination (Join-Path $repositoryStage 'integrations\whoop\dashboard')

    Write-Host '[2/4] Creating deployment archive and transferring it over SSH...' -ForegroundColor Cyan
    Invoke-CheckedNativeCommand -Name 'tar.exe' -Arguments @('-czf', $archivePath, '-C', $temporaryRoot, '.')
    $remoteArchive = "homelab-deploy-$runId.tar.gz"
    $remotePreflight = @(
        'sudo test -f /etc/homelab/whoop.env'
        'sudo docker compose version >/dev/null'
        'sudo install -d -o 1000 -g 1000 -m 0700 /var/lib/homelab/whoop'
    ) -join ' && '
    Write-Host 'Checking Pi config and Docker Compose...' -ForegroundColor Yellow
    Invoke-CheckedNativeCommand -Name 'ssh' -Arguments ($sshOptions + @('-t', $PiTarget, $remotePreflight))
    Invoke-CheckedNativeCommand -Name 'scp' -Arguments ($sshOptions + @($archivePath, "${PiTarget}:$remoteArchive"))

    Write-Host '[3/4] Installing source and building/starting the API with its dashboard...' -ForegroundColor Cyan
    $remoteCommand = @(
        'set -eu'
        "archive=`$HOME/$remoteArchive"
        "staging=`$HOME/.homelab-deploy-$runId"
        "repository=`$HOME/$RemoteRepoName"
        'mkdir -p "$staging" "$repository"'
        'tar -xzf "$archive" -C "$staging"'
        'cp -a "$staging/repository/." "$repository/"'
        'cd "$repository"'
        'sudo docker compose -f deploy/pi/compose.yaml up -d --build'
        'for attempt in $(seq 1 15); do if curl --fail --silent http://127.0.0.1:4001/healthz >/dev/null; then break; fi; if [ "$attempt" -eq 15 ]; then echo "API health check failed; recent API logs follow:" >&2; sudo docker compose -f deploy/pi/compose.yaml logs --tail=80 api >&2 || true; exit 1; fi; sleep 2; done'
        'curl --fail --silent --show-error http://127.0.0.1:4001/healthz'
        'rm -rf -- "$staging" "$archive"'
    ) -join "`n"
    Invoke-CheckedNativeCommand -Name 'ssh' -Arguments ($sshOptions + @('-t', $PiTarget, $remoteCommand))

    Write-Host "`n[4/4] Deployed successfully to $PiTarget." -ForegroundColor Green
    Write-Host "Repository: ~/$RemoteRepoName"
    Write-Host 'Dashboard:  http://localhost:4001'
    Write-Host 'The existing nginx and Cloudflare Tunnel configuration was not changed.'
}
finally {
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
}
