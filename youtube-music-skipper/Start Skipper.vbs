Set WshShell = CreateObject("WScript.Shell")
strPath = Left(WScript.ScriptFullName, Len(WScript.ScriptFullName) - Len(WScript.ScriptName))
WshShell.CurrentDirectory = strPath
WshShell.Run "cmd /c npm start", 0, False
