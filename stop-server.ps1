<#
==============================================================================
Frontline Tactics 3D - Windows Desktop Server Stopper
==============================================================================
#>

[CmdletBinding()]
param(
    [int]$Port = 0
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ($Port -gt 0) {
    & "$ScriptDir\launch.ps1" -Stop -Port $Port
} else {
    & "$ScriptDir\launch.ps1" -Stop
}
