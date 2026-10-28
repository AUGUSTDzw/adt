Option Explicit
' SAP GUI VBScript daemon: reads JSON-RPC requests from stdin, executes them
' against the SAP GUI scripting engine via COM (GetObject/CreateObject), and
' writes JSON responses to stdout.
'
' Wire protocol (one JSON object per line on stdin):
'   {"id":N,"op":"getObject","name":"PROGID","options":{"getobject":true|"activate":true}}
'   {"id":N,"op":"getProp","ref":{"$com":ID},"name":"Prop"}
'   {"id":N,"op":"setProp","ref":{"$com":ID},"name":"Prop","value":V}
'   {"id":N,"op":"call","ref":{"$com":ID},"method":"M","args":[...]}
'   {"id":N,"op":"release","ref":{"$com":ID}}
' Response: {"id":N,"ok":true,"value":V} or {"id":N,"ok":false,"error":"..."}
' Object refs are returned as {"$com":ID}; primitives as JSON.

' Registered COM objects, keyed by numeric id. The Dictionary keeps a strong
' reference so objects survive across requests in the stdin loop.
Dim objs, nextId
Set objs = CreateObject("Scripting.Dictionary")
nextId = 1

Function RegisterObj(ByVal o)
  Dim id
  id = nextId
  nextId = nextId + 1
  objs.Add CStr(id), o
  RegisterObj = id
End Function

Function GetObj(id)
  Set GetObj = objs(CStr(id))
End Function

' ---------- JSON string escaping ----------
Function JStr(s)
  Dim i, c, out
  out = """"
  For i = 1 To Len(s)
    c = Mid(s, i, 1)
    Select Case c
      Case """": out = out & "\"""
      Case "\": out = out & "\\"
      Case vbCr: out = out & "\r"
      Case vbLf: out = out & "\n"
      Case vbTab: out = out & "\t"
      Case Else
        ' AscW handles Unicode; Asc fails above 255. Non-ASCII is emitted as
        ' \uXXXX so the response stays ASCII (cscript Stdout is ANSI-only).
        If AscW(c) < 32 Or AscW(c) > 127 Then
          out = out & "\u" & Right("0000" & Hex(AscW(c)), 4)
        Else
          out = out & c
        End If
    End Select
  Next
  JStr = out & """"
End Function

' ---------- JSON encoding ----------
Function JEnc(v)
  Dim t, i, out, tn, first, keys
  If IsObject(v) Then
    tn = TypeName(v)
    If tn = "Nothing" Then
      JEnc = "null"
      Exit Function
    End If
    If tn = "Dictionary" Then
      out = "{"
      keys = v.Keys
      first = True
      For i = 0 To UBound(keys)
        If Not first Then out = out & ","
        first = False
        out = out & JStr(CStr(keys(i))) & ":" & JEnc(v(CStr(keys(i))))
      Next
      JEnc = out & "}"
    Else
      JEnc = "{""$com"":" & RegisterObj(v) & "}"
    End If
    Exit Function
  End If
  t = VarType(v)
  If (t And vbArray) = vbArray Then
    out = "["
    For i = LBound(v) To UBound(v)
      If i > LBound(v) Then out = out & ","
      out = out & JEnc(v(i))
    Next
    JEnc = out & "]"
    Exit Function
  End If
  Select Case t
    Case vbNull, vbEmpty
      JEnc = "null"
    Case vbBoolean
      If v Then JEnc = "true" Else JEnc = "false"
    Case vbString
      JEnc = JStr(CStr(v))
    Case vbDate
      JEnc = JStr(CStr(v))
    Case Else
      If IsNumeric(v) Then
        JEnc = CStr(v)
      Else
        JEnc = "null"
      End If
  End Select
End Function

' ---------- JSON parser (global pv holds current value) ----------
Dim gs, gp, pv

Sub SkipWS()
  Do While gp <= Len(gs) And InStr(" " & vbTab & vbCr & vbLf, Mid(gs, gp, 1)) > 1
    gp = gp + 1
  Loop
End Sub

Sub ParseValue()
  Dim c
  SkipWS
  If gp > Len(gs) Then
    pv = Null
    Exit Sub
  End If
  c = Mid(gs, gp, 1)
  Select Case c
    Case "{": ParseObject
    Case "[": ParseArray
    Case """": pv = ParseStr()
    Case "t", "f": pv = ParseBool()
    Case "n"
      gp = gp + 4
      pv = Null
    Case Else: pv = ParseNum()
  End Select
End Sub

Sub ParseObject()
  Dim d, key
  Set d = CreateObject("Scripting.Dictionary")
  gp = gp + 1
  Do While True
    SkipWS
    If Mid(gs, gp, 1) = "}" Then
      gp = gp + 1
      Exit Do
    End If
    key = ParseStr()
    SkipWS
    If Mid(gs, gp, 1) = ":" Then gp = gp + 1
    ParseValue
    d.Add key, pv
    SkipWS
    If Mid(gs, gp, 1) = "," Then
      gp = gp + 1
    ElseIf Mid(gs, gp, 1) = "}" Then
      gp = gp + 1
      Exit Do
    End If
  Loop
  Set pv = d
End Sub

Sub ParseArray()
  Dim a(), n
  n = 0
  ReDim a(0)
  gp = gp + 1
  Do While True
    SkipWS
    If Mid(gs, gp, 1) = "]" Then
      gp = gp + 1
      Exit Do
    End If
    ReDim Preserve a(n)
    ParseValue
    If IsObject(pv) Then
      Set a(n) = pv
    Else
      a(n) = pv
    End If
    n = n + 1
    SkipWS
    If Mid(gs, gp, 1) = "," Then
      gp = gp + 1
    ElseIf Mid(gs, gp, 1) = "]" Then
      gp = gp + 1
      Exit Do
    End If
  Loop
  pv = a
End Sub

Function ParseStr()
  Dim s, c, esc, code
  gp = gp + 1
  s = ""
  Do While gp <= Len(gs)
    c = Mid(gs, gp, 1)
    gp = gp + 1
    If c = """" Then
      Exit Do
    ElseIf c = "\" Then
      esc = Mid(gs, gp, 1)
      gp = gp + 1
      Select Case esc
        Case """": s = s & """"
        Case "\": s = s & "\"
        Case "/": s = s & "/"
        Case "b": s = s & Chr(8)
        Case "f": s = s & Chr(12)
        Case "n": s = s & vbLf
        Case "r": s = s & vbCr
        Case "t": s = s & vbTab
        Case "u":
          code = Mid(gs, gp, 4)
          gp = gp + 4
          s = s & ChrW(CInt("&H" & code))
      End Select
    Else
      s = s & c
    End If
  Loop
  ParseStr = s
End Function

Function ParseBool()
  If Mid(gs, gp, 1) = "t" Then
    gp = gp + 4
    ParseBool = True
  Else
    gp = gp + 5
    ParseBool = False
  End If
End Function

Function RefId(v)
  If IsObject(v) Then
    If TypeName(v) = "Dictionary" And v.Exists("$com") Then
      RefId = CLng(v("$com"))
      Exit Function
    End If
  End If
  RefId = -1
End Function

Function ArgExpr(a)
  If IsObject(a) Then
    If TypeName(a) = "Dictionary" And a.Exists("$com") Then
      ArgExpr = "GetObj(" & a("$com") & ")"
    Else
      ArgExpr = "Nothing"
    End If
  ElseIf VarType(a) = vbString Then
    ArgExpr = VbsStrLit(a)
  ElseIf VarType(a) = vbBoolean Then
    If a Then ArgExpr = "True" Else ArgExpr = "False"
  ElseIf VarType(a) = vbNull Or VarType(a) = vbEmpty Then
    ArgExpr = "Null"
  Else
    ArgExpr = CStr(a)
  End If
End Function

' Build a VBScript string literal usable inside Execute. VBScript string
' literals cannot contain CR/LF/TAB directly (a raw newline terminates the
' statement), so control characters are emitted as Chr(n) concatenations.
Function VbsStrLit(s)
  Dim out, i, c
  out = """"
  For i = 1 To Len(s)
    c = Mid(s, i, 1)
    Select Case c
      Case """": out = out & """"""
      Case vbCr: out = out & """ & Chr(13) & """
      Case vbLf: out = out & """ & Chr(10) & """
      Case vbTab: out = out & """ & Chr(9) & """
      Case Else: out = out & c
    End Select
  Next
  VbsStrLit = out & """"
End Function

' ---------- Main request loop ----------
Dim line, req, resp, gresult
Do While Not WScript.Stdin.AtEndOfStream
  line = WScript.Stdin.ReadLine
  If Len(Trim(line)) = 0 Then Exit Do
  gs = line
  gp = 1
  On Error Resume Next
  ParseValue
  Set req = Nothing
  If IsObject(pv) Then
    Set req = pv
  Else
    Err.Raise vbObjectError + 1, , "request is not an object"
  End If
  If Err.Number <> 0 Then
    WScript.Stdout.WriteLine "{""id"":0,""ok"":false,""error"":" & JStr("parse error: " & Err.Description) & "}"
    Err.Clear
    On Error GoTo 0
    Exit Do
  End If
  On Error GoTo 0
  Dim id, op, out
  id = req("id")
  op = CStr(req("op"))
  out = "null"
  On Error Resume Next
  Err.Clear
  Select Case op
    Case "getObject"
      Dim progid, o, rid
      Err.Clear
      progid = CStr(req("name"))
      Err.Clear
      Set o = Nothing
      ' Try CreateObject first; fall back to GetObject (activate) on failure.
      Set o = CreateObject(progid)
      If Err.Number <> 0 Then
        Err.Clear
        Set o = GetObject(progid)
      End If
      If Not IsObject(o) Or TypeName(o) = "Nothing" Then
        Err.Raise vbObjectError + 2, , "cannot create object: " & progid
      Else
        Err.Clear
        rid = nextId
        nextId = nextId + 1
        objs.Add CStr(rid), o
        Err.Clear
        out = "{""$com"":" & rid & "}"
      End If
    Case "getProp"
      Dim rid2, pname
      rid2 = RefId(req("ref"))
      pname = CStr(req("name"))
      Set gresult = Nothing
      On Error Resume Next
      Err.Clear
      Execute "Set gresult = GetObj(" & rid2 & ")." & pname
      If Err.Number <> 0 Then
        Err.Clear
        Execute "gresult = GetObj(" & rid2 & ")." & pname
      End If
      On Error GoTo 0
      out = JEnc(gresult)
    Case "setProp"
      Dim rid3, pname3
      rid3 = RefId(req("ref"))
      pname3 = CStr(req("name"))
      Execute "GetObj(" & rid3 & ")." & pname3 & " = " & ArgExpr(req("value"))
      Err.Clear
      out = "null"
    Case "call"
      Dim rid4, mname, margs, cargs(), nargs, i, arr, cexpr
      rid4 = RefId(req("ref"))
      mname = CStr(req("method"))
      margs = req("args")
      nargs = 0
      If Not IsEmpty(margs) And Not IsNull(margs) Then
        If VarType(margs) And vbArray Then
          arr = margs
          nargs = UBound(arr) + 1
          If nargs > 0 Then
            ReDim cargs(nargs - 1)
            For i = 0 To nargs - 1
              If IsObject(arr(i)) Then
                Set cargs(i) = arr(i)
              Else
                cargs(i) = arr(i)
              End If
            Next
          End If
        Else
          ReDim cargs(0)
          If IsObject(margs) Then
            Set cargs(0) = margs
          Else
            cargs(0) = margs
          End If
          nargs = 1
        End If
      End If
      If nargs = 0 Then
        cexpr = "GetObj(" & rid4 & ")." & mname
      Else
        cexpr = "GetObj(" & rid4 & ")." & mname & "("
        For i = 0 To nargs - 1
          If i > 0 Then cexpr = cexpr & ","
          cexpr = cexpr & ArgExpr(cargs(i))
        Next
        cexpr = cexpr & ")"
      End If
      ' Evaluate in main-loop scope (module-level gresult persists; using a
      ' Sub here would release the COM ref when the Sub returns).
      Set gresult = Nothing
      On Error Resume Next
      Err.Clear
      Execute "Set gresult = " & cexpr
      If Err.Number <> 0 Then
        Err.Clear
        Execute "gresult = " & cexpr
      End If
      On Error GoTo 0
      out = JEnc(gresult)
    Case "release"
      Dim rref, rid5
      Set rref = req("ref")
      If IsObject(rref) Then
        If TypeName(rref) = "Dictionary" And rref.Exists("$com") Then
          rid5 = CLng(rref("$com"))
          If objs.Exists(CStr(rid5)) Then objs.Remove CStr(rid5)
        End If
      End If
      out = "null"
    Case Else
      Err.Raise vbObjectError + 1, , "unknown op: " & op
  End Select
  If Err.Number <> 0 Then
    resp = "{""id"":" & id & ",""ok"":false,""error"":" & JStr("[" & op & "] " & Err.Description) & "}"
    Err.Clear
  Else
    resp = "{""id"":" & id & ",""ok"":true,""value"":" & out & "}"
  End If
  On Error GoTo 0
  WScript.Stdout.WriteLine resp
Loop

Function ParseNum()
  Dim s, c
  s = ""
  Do While gp <= Len(gs)
    c = Mid(gs, gp, 1)
    If (c >= "0" And c <= "9") Or c = "-" Or c = "+" Or c = "." Or c = "e" Or c = "E" Then
      s = s & c
      gp = gp + 1
    Else
      Exit Do
    End If
  Loop
  If s = "" Then
    ParseNum = 0
  ElseIf InStr(s, ".") > 0 Or InStr(s, "e") > 0 Or InStr(s, "E") > 0 Then
    ParseNum = CDbl(s)
  Else
    ParseNum = CLng(s)
  End If
End Function
