' Double-click launcher for the Electron Story Editor. Runs "npx electron ."
' in this folder with no console window -- Electron's own window (and tray
' icon, see main.js) is the only thing you see.
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = scriptDir
shell.Run "cmd /c npx.cmd electron .", 0, False
