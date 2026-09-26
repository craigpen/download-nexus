<#
.SYNOPSIS
  Universal Dev Environment & Routing Manager
.EXAMPLE
  .\dev.ps1              # Starts current app
  .\dev.ps1 up           # Starts current app (or all if at root)
  .\dev.ps1 down         # Stops current app
  .\dev.ps1 status       # Shows active containers and URLs
  .\dev.ps1 up sure      # Starts a specific app
  .\dev.ps1 up all       # Starts all frontends
#>

param(
    [Parameter(Position=0)]
    [ValidateSet("up", "down", "restart", "status", "urls", "logs", "gateway")]
    [string]$Action = "up",

    [Parameter(Position=1)]
    [string]$App = ""
)

# Resolve Root Git directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (Test-Path "$ScriptDir\dev-gateway") {
    $RootDir = $ScriptDir
} else {
    $RootDir = (Resolve-Path "$ScriptDir\..").Path
}

# Current Folder Name for context-awareness
$CurrentFolder = (Get-Item $ScriptDir).Name

$Apps = @{
    "gateway"     = @{ Dir = "$RootDir\dev-gateway"; Url = "http://traefik.localhost"; Port = "8081"; Desc = "Traefik Reverse Proxy" }
    "finance"     = @{ Dir = "$RootDir\home-finance"; Url = "http://finance.localhost"; Port = "3600"; Desc = "Home Finance Dashboard" }
    "pathfinder"  = @{ Dir = "$RootDir\pathfinder"; Url = "http://pathfinder.localhost"; Port = "3601"; Desc = "Pathfinder Career Paths" }
    "university"  = @{ Dir = "$RootDir\university_pathfinder"; Url = "http://university.localhost"; Port = "3602"; Desc = "University Pathfinder" }
    "sure"        = @{ Dir = "$RootDir\sure"; Url = "http://sure.localhost"; Port = "3000"; Desc = "Sure Personal Finance API" }
    "hangtime"    = @{ Dir = "$RootDir\hangtime-party"; Url = "http://hangtime.localhost"; Port = "3701"; Desc = "Hangtime Party Game" }
    "golf"        = @{ Dir = "$RootDir\golf-autopilot"; Url = "http://golf.localhost"; Port = "3702"; Desc = "Golf Autopilot" }
    "icarus"      = @{ Dir = "$RootDir\icarus-architect"; Url = "http://icarus.localhost"; Port = "3703"; Desc = "Icarus Architect 3D" }
    "downloads"   = @{ Dir = "$RootDir\download-nexus"; Url = "http://deluge.localhost"; Port = "8112"; Desc = "Download Harness" }
}

# Map folder names to app keys
$FolderMap = @{
    "dev-gateway"           = "gateway"
    "home-finance"          = "finance"
    "pathfinder"            = "pathfinder"
    "university_pathfinder" = "university"
    "sure"                  = "sure"
    "hangtime-party"        = "hangtime"
    "golf-autopilot"        = "golf"
    "icarus-architect"      = "icarus"
    "download-nexus"        = "downloads"
}

# Infer app if not provided
if ([string]::IsNullOrWhiteSpace($App)) {
    if ($FolderMap.ContainsKey($CurrentFolder)) {
        $App = $FolderMap[$CurrentFolder]
    } else {
        $App = "all"
    }
}

function Ensure-Gateway {
    $gwDir = $Apps["gateway"].Dir
    $netExists = docker network ls --filter name=^dev-net$ --format "{{.Name}}"
    if (!$netExists) {
        Write-Host "Creating shared Docker network: dev-net..." -ForegroundColor Cyan
        docker network create dev-net | Out-Null
    }
    $gwRunning = docker ps --filter name=dev-traefik-gateway --format "{{.Status}}"
    if (!$gwRunning) {
        Write-Host "Starting Traefik Dev Gateway..." -ForegroundColor Cyan
        Push-Location $gwDir
        docker compose up -d
        Pop-Location
    }
}

function Show-Urls {
    Write-Host "`n========================================================" -ForegroundColor Green
    Write-Host "            LOCAL DEV ROUTING DIRECTORY                 " -ForegroundColor Green
    Write-Host "========================================================" -ForegroundColor Green
    $table = foreach ($key in ($Apps.Keys | Sort-Object)) {
        [PSCustomObject]@{
            "Command Key" = $key
            "Friendly URL" = $Apps[$key].Url
            "Direct Port" = $Apps[$key].Port
            "Application" = $Apps[$key].Desc
        }
    }
    $table | Format-Table -AutoSize
}

function Run-AppAction($targetKey, $act) {
    if (!$Apps.ContainsKey($targetKey)) {
        Write-Error "Unknown app key: '$targetKey'. Valid keys: $($Apps.Keys -join ', ')"
        return
    }
    $info = $Apps[$targetKey]
    if (!(Test-Path $info.Dir)) {
        Write-Warning "Directory not found: $($info.Dir)"
        return
    }
    
    Push-Location $info.Dir
    Write-Host "==> [$act] $targetKey ($($info.Desc))..." -ForegroundColor Cyan
    if ($act -eq "up") {
        Ensure-Gateway
        docker compose up -d
        Write-Host "  -> Live at: $($info.Url) (Port $($info.Port))" -ForegroundColor Green
    } elseif ($act -eq "down") {
        docker compose down
    } elseif ($act -eq "restart") {
        docker compose restart
    } elseif ($act -eq "logs") {
        docker compose logs -f
    }
    Pop-Location
}

switch ($Action) {
    "gateway" {
        Ensure-Gateway
    }
    "urls" {
        Show-Urls
    }
    "status" {
        Write-Host "`nActive Containers:" -ForegroundColor Cyan
        docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
        Show-Urls
    }
    "up" {
        Ensure-Gateway
        if ($App -eq "all") {
            foreach ($key in @("finance", "pathfinder", "university", "hangtime", "golf", "icarus")) {
                Run-AppAction $key "up"
            }
        } else {
            Run-AppAction $App "up"
        }
    }
    "down" {
        if ($App -eq "all") {
            foreach ($key in $Apps.Keys) {
                Run-AppAction $key "down"
            }
        } else {
            Run-AppAction $App "down"
        }
    }
    "restart" {
        if ($App -eq "all") {
            foreach ($key in $Apps.Keys) {
                Run-AppAction $key "restart"
            }
        } else {
            Run-AppAction $App "restart"
        }
    }
    "logs" {
        if ($App -ne "all") {
            Run-AppAction $App "logs"
        } else {
            Write-Host "Specify an app for logs (e.g. .\dev.ps1 logs finance)"
        }
    }
}
