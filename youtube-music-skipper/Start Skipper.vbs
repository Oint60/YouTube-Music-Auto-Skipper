Set WshShell = CreateObject("WScript.Shell")
strPath = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))
WshShell.CurrentDirectory = strPath
WshShell.Run """" & strPath & "node_modules\electron\dist\electron.exe"" .", 0, False
