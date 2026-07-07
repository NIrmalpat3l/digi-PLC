Set WshShell = CreateObject("WScript.Shell") 
WshShell.Run chr(34) & "D:\PLC_System\gateway\start_dashboard.bat" & Chr(34), 0
Set WshShell = Nothing
