' Double-click launcher: starts the Story Editor with no visible window at
' all, just a system-tray icon (see tray.ps1). The "0" window-style arg to
' Run is what suppresses PowerShell's own console -- without this wrapper,
' even "-WindowStyle Hidden" can flash a window briefly on launch.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
trayScript = scriptDir & "\tray.ps1"

Set shell = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & trayScript & """"
shell.Run cmd, 0, False
