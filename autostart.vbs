' AI Agent 网站开机自启（隐藏窗口运行 node server.js）
Option Explicit

Dim ws, fso, logFile, f
Set ws = CreateObject("Wscript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

ws.CurrentDirectory = "D:\codex_project"
logFile = "D:\codex_project\autostart.log"

Call AppendLog(fso, logFile, Now & " Starting node server.js")

' 若服务已在运行（端口 3000 已被占用），server.js 会打印友好提示后退出，不会重复占用
ws.Run "cmd /c node server.js >> """ & logFile & """ 2>&1", 0, False

Sub AppendLog(fso, path, msg)
    On Error Resume Next
    Set f = fso.OpenTextFile(path, 8, True)
    f.WriteLine msg
    f.Close
    On Error GoTo 0
End Sub
