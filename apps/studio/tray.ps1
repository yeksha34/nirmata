# System-tray launcher for the Story Editor. Starts the server with no
# console window at all and parks a notification-area icon instead —
# double-click (or "Open Story Editor" in the right-click menu) opens the
# browser; "Exit" stops the server and removes the icon. Meant to be run
# hidden via start_editor_tray.vbs, not double-clicked directly (running it
# directly in a normal PowerShell window leaves that window open behind
# the tray icon).

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$ServerScript = Join-Path $PSScriptRoot "server.mjs"
$Port = 8787
$Url = "http://localhost:$Port/"
$LogFile = Join-Path $env:TEMP "story_editor_server.log"

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = "`"$ServerScript`" --port $Port"
$psi.WorkingDirectory = $RepoRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$serverProc = [System.Diagnostics.Process]::Start($psi)

# Drain output to a log file instead of the void, so a startup failure
# (e.g. port already in use) is diagnosable without a visible console.
Start-Job -ScriptBlock {
    param($proc, $log)
    $proc.StandardOutput.ReadToEnd() + $proc.StandardError.ReadToEnd() | Out-File -FilePath $log -Encoding utf8
} -ArgumentList $serverProc, $LogFile | Out-Null

$notifyIcon = New-Object System.Windows.Forms.NotifyIcon
$notifyIcon.Icon = [System.Drawing.SystemIcons]::Application
$notifyIcon.Text = "Story Editor (localhost:$Port)"
$notifyIcon.Visible = $true

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$openItem = $menu.Items.Add("Open Story Editor")
$logItem = $menu.Items.Add("Open server log")
$menu.Items.Add("-") | Out-Null
$exitItem = $menu.Items.Add("Exit (stops the server)")
$notifyIcon.ContextMenuStrip = $menu

$openItem.Add_Click({ Start-Process $Url })
$logItem.Add_Click({ if (Test-Path $LogFile) { Start-Process notepad.exe $LogFile } })
$notifyIcon.Add_MouseDoubleClick({
    param($s, $e)
    if ($e.Button -eq [System.Windows.Forms.MouseButtons]::Left) { Start-Process $Url }
})

$exitItem.Add_Click({
    if (-not $serverProc.HasExited) { $serverProc.Kill() }
    $notifyIcon.Visible = $false
    [System.Windows.Forms.Application]::Exit()
})

# Give the server a moment to bind, then open the browser once, on start.
Start-Sleep -Seconds 2
if (-not $serverProc.HasExited) {
    Start-Process $Url
} else {
    $notifyIcon.ShowBalloonTip(5000, "Story Editor failed to start", "Check $LogFile", [System.Windows.Forms.ToolTipIcon]::Error)
}

[System.Windows.Forms.Application]::Run()
