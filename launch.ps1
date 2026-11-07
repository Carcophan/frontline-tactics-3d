<#
==============================================================================
Frontline Tactics 3D - Windows Desktop Game Launcher
==============================================================================
#>

[CmdletBinding()]
param(
    [switch]$Stop,
    [switch]$Tab,
    [int]$Port = 0
)

$ErrorActionPreference = "Continue"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# Support Linux/Bash style arguments passed from command line or batch file
if ($args -contains "--stop" -or $args -contains "-stop") {
    $Stop = $true
}
if ($args -contains "--tab" -or $args -contains "-tab") {
    $Tab = $true
}

# Determine Port (Parameter > $env:PORT > Default 5174)
if ($Port -le 0) {
    if ($env:PORT) {
        $Port = [int]$env:PORT
    } else {
        $Port = 5174
    }
}

$Url = "http://localhost:$Port"
$PidFile = Join-Path $ScriptDir ".vite.pid"
$LogFile = Join-Path $ScriptDir ".server.log"

# Function: Recursively kill a process tree
function Stop-ProcessTree {
    param([int]$ParentId)
    try {
        $children = Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $ParentId }
        foreach ($child in $children) {
            Stop-ProcessTree -ParentId $child.ProcessId
            Stop-Process -Id $child.ProcessId -Force -ErrorAction SilentlyContinue
        }
    } catch {}
    Stop-Process -Id $ParentId -Force -ErrorAction SilentlyContinue
}

# Function: Stop the background server
function Stop-GameServer {
    Write-Host "`n[Frontline Tactics 3D] Stoppe Server..." -ForegroundColor Yellow
    $stopped = $false

    # 1. Stop by PID file
    if (Test-Path $PidFile) {
        try {
            $rawPid = (Get-Content $PidFile -ErrorAction SilentlyContinue | Out-String).Trim()
            if ($rawPid -match '^\d+$') {
                $pId = [int]$rawPid
                $proc = Get-Process -Id $pId -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Host "Beende Server-Prozessbaum (PID: $pId)..." -ForegroundColor Gray
                    Stop-ProcessTree -ParentId $pId
                    $stopped = $true
                }
            }
        } catch {}
        Remove-Item -Path $PidFile -Force -ErrorAction SilentlyContinue
    }

    # 2. Terminate any lingering process listening on the designated port
    try {
        $conns = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        if ($conns) {
            foreach ($conn in $conns) {
                if ($conn.OwningProcess -gt 0) {
                    Write-Host "Beende verbleibenden Prozess auf Port $Port (PID: $($conn.OwningProcess))..." -ForegroundColor Gray
                    Stop-ProcessTree -ParentId $conn.OwningProcess
                    $stopped = $true
                }
            }
        }
    } catch {}

    if ($stopped) {
        Write-Host "[Frontline Tactics 3D] Server erfolgreich beendet.`n" -ForegroundColor Green
    } else {
        Write-Host "[Frontline Tactics 3D] Kein aktiver Server auf Port $Port gefunden.`n" -ForegroundColor Cyan
    }
}

# Handle stop action
if ($Stop) {
    Stop-GameServer
    exit 0
}

# Function: Test if HTTP server responds
function Test-ServerReady {
    try {
        $req = [System.Net.WebRequest]::Create($Url)
        $req.Timeout = 1000
        $req.Method = "GET"
        $resp = $req.GetResponse()
        $resp.Close()
        return $true
    } catch {
        return $false
    }
}

# Detect Chromium-based browser for standalone App-Mode
function Get-AppBrowser {
    $candidates = @(
        @{ Name = "Google Chrome"; Path = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" },
        @{ Name = "Google Chrome (x86)"; Path = "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe" },
        @{ Name = "Google Chrome (Local)"; Path = "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe" },
        @{ Name = "Microsoft Edge"; Path = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" },
        @{ Name = "Microsoft Edge (x64)"; Path = "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe" },
        @{ Name = "Brave"; Path = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe" },
        @{ Name = "Brave (Local)"; Path = "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe" }
    )

    foreach ($browser in $candidates) {
        if ($browser.Path -and (Test-Path $browser.Path)) {
            return $browser
        }
    }
    return $null
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "       🌍 Frontline Tactics 3D - Windows Launcher         " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# Check if server is already running
if (Test-ServerReady) {
    Write-Host "[i] Server laeuft bereits auf $Url" -ForegroundColor Green
} else {
    Write-Host "[*] Starte Frontline Tactics 3D Dev-Server auf Port $Port..." -ForegroundColor Yellow
    
    # Start npm run dev detached and hidden
    $psi = New-Object System.Diagnostics.ProcessStartInfo
    $psi.FileName = "cmd.exe"
    $psi.Arguments = "/c npm run dev -- --port $Port > `"$LogFile`" 2>&1"
    $psi.WorkingDirectory = $ScriptDir
    $psi.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $psi.UseShellExecute = $true

    try {
        $serverProc = [System.Diagnostics.Process]::Start($psi)
        if ($serverProc) {
            $serverProc.Id | Out-File -FilePath $PidFile -Encoding ascii -Force
        }
    } catch {
        Write-Host "[!] Fehler beim Starten des Dev-Servers: $_" -ForegroundColor Red
        exit 1
    }

    # Wait for server to become responsive (up to 15 seconds)
    $ready = $false
    $timeoutSeconds = 15
    $checks = $timeoutSeconds * 4

    for ($i = 0; $i -lt $checks; $i++) {
        Start-Sleep -Milliseconds 250
        if (Test-ServerReady) {
            $ready = $true
            break
        }
        # Check if process exited prematurely
        if ($serverProc -and $serverProc.HasExited) {
            Write-Host "[!] Server-Prozess unerwartet beendet. Siehe Log in $LogFile" -ForegroundColor Red
            exit 1
        }
    }

    if (-not $ready) {
        Write-Host "[!] Fehler: Zeitueberschreitung beim Starten des Servers!" -ForegroundColor Red
        Write-Host "    Details siehe Log: $LogFile" -ForegroundColor Yellow
        exit 1
    }

    Write-Host "[+] Server ist bereit auf $Url!" -ForegroundColor Green
}

# Locate browser and launch game
$browser = Get-AppBrowser

if ($Tab) {
    Write-Host "[*] Oeffne Frontline Tactics 3D im Browser-Tab..." -ForegroundColor Cyan
    if ($browser) {
        Start-Process -FilePath $browser.Path -ArgumentList "$Url"
    } else {
        Start-Process "$Url"
    }
} else {
    if ($browser) {
        Write-Host "[*] Starte Frontline Tactics 3D im App-Modus via $($browser.Name)..." -ForegroundColor Green
        Start-Process -FilePath $browser.Path -ArgumentList "--app=$Url"
    } else {
        Write-Host "[*] Kein Chrome/Edge gefunden. Oeffne im Standard-Browser..." -ForegroundColor Yellow
        Start-Process "$Url"
    }
}

Write-Host "[+] Spiel gestartet. Viel Erfolg, Kommandant!`n" -ForegroundColor Green
