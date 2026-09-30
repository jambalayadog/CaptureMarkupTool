' Starts Capture Markup Tool in development mode with no console window.
' Double-click it, or run: explorer.exe scripts\start-dev.vbs
' Output goes to dev.log in the project folder. Arguments (such as --hidden,
' which Windows passes at sign-in) are forwarded to the app.
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = root
args = ""
For Each a In WScript.Arguments
  args = args & " " & a
Next
electron = root & "\node_modules\electron\dist\electron.exe"
Set running = GetObject("winmgmts:\\.\root\cimv2").ExecQuery( _
  "SELECT ProcessId FROM Win32_Process WHERE Name = 'electron.exe' AND CommandLine LIKE '%" & _
  Replace(electron, "\", "\\") & "%'")
If running.Count > 0 Then
  ' Already running (maybe hidden in the tray): a second instance just hands its
  ' arguments to that one and exits, which brings the editor up.
  sh.Run """" & electron & """ ." & args, 0, False
Else
  If args <> "" Then args = " -- --" & args
  sh.Run "cmd /c npm run dev" & args & " > dev.log 2>&1", 0, False
End If
