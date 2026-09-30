' Starts Capture Markup Tool in development mode with no console window.
' Double-click it, or run: explorer.exe scripts\start-dev.vbs
' Output goes to dev.log in the project folder.
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
sh.Run "cmd /c npm run dev > dev.log 2>&1", 0, False
