<#
.SYNOPSIS
    SNC + Kerberos 透明 SSO 服务器端一键准备脚本（在 SAP 主机上以管理员/系统账号运行）。

.DESCRIPTION
    配置期一次性特权：本脚本由管理员/<sid>adm 在服务器端安装基础设施（证书、SECUDIR、
    profile 参数），安装完成后即退出。管理员密码不参与任何 SAP 业务登录；业务用户无
    SAP 密码，运行期纯靠 Windows 域 Kerberos 票据经 SNC 免密登录。

    完成以下工作：
      1. 创建 SECUDIR 目录
      2. 校验 SAPCRYPTOLIB (sapcrypto.dll) 路径
      3. 生成自签服务器证书（含私钥）并导出 PFX
      4. 通过 sapgenpse 导入生成 SAPSNCS.pse
      5. 输出建议的 RZ10 profile 参数
      6. 可选：-ApplyProfile 直接追加参数到 DEFAULT.PFL
      7. 输出客户端需要执行的证书信任导入命令

.PARAMETER CertCN
    服务器证书 CN，即 SAP 主机 FQDN。默认：本机 FQDN。

.PARAMETER Company
    证书组织 O 字段。默认：SAP。

.PARAMETER Country
    证书国家 C 字段。默认：CN。

.PARAMETER Days
    证书有效期天数。默认：3650。

.PARAMETER SecuDir
    SECUDIR 路径。默认：C:\Program Files\SAP\secudir。

.PARAMETER SapCryptoLib
    sapcrypto.dll 完整路径。默认：C:\Program Files\SAP\CommonCryptoLib\sapcrypto.dll。

.PARAMETER PsePassword
    SAPSNCS.pse 的访问口令。默认：随机生成并提示修改。

.PARAMETER ApplyProfile
    若指定，将 SNC 参数追加写入 DEFAULT.PFL（需管理员权限）。

.PARAMETER ProfilePath
    DEFAULT.PFL 路径。默认：<usr/sap>/<SID>/SYS/profile/DEFAULT.PFL，需配合 -Sid。

.PARAMETER Sid
    SAP 系统标识（用于定位 profile 目录）。默认：不启用 profile 写入。

.EXAMPLE
    # 仅生成证书 + PSE + 输出参数建议
    .\snc-sso-setup.ps1 -CertCN sap-ecc.corp.local -Company "ACME" -Country CN

.EXAMPLE
    # 生成并写入 profile 参数
    .\snc-sso-setup.ps1 -CertCN sap-ecc.corp.local -ApplyProfile -Sid ECC
#>

[CmdletBinding()]
param(
    [string]$CertCN,
    [string]$Company = "SAP",
    [string]$Country = "CN",
    [int]$Days = 3650,
    [string]$SecuDir = "C:\Program Files\SAP\secudir",
    [string]$SapCryptoLib = "C:\Program Files\SAP\CommonCryptoLib\sapcrypto.dll",
    [string]$PsePassword,
    [switch]$ApplyProfile,
    [string]$ProfilePath,
    [string]$Sid
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok([string]$msg) { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn2([string]$msg) { Write-Host "    [WARN] $msg" -ForegroundColor Yellow }

# ---------- 1. SECUDIR ----------
Write-Step "1/6 创建 SECUDIR: $SecuDir"
New-Item -ItemType Directory -Path $SecuDir -Force | Out-Null
Write-Ok "SECUDIR 就绪"

# ---------- 2. sapcrypto.dll ----------
Write-Step "2/6 校验 SAPCRYPTOLIB"
if (-not (Test-Path -LiteralPath $SapCryptoLib)) {
    Write-Warn2 "未找到 $SapCryptoLib —— 请先从 SAP 下载 CommonCryptoLib 并放置到此路径，然后重新运行本脚本。"
    return
}
Write-Ok "sapcrypto.dll 存在"

# ---------- 3. 服务器证书 ----------
if (-not $CertCN) { $CertCN = [System.Net.Dns]::GetHostEntry([System.Net.Dns]::GetHostName()).HostName }
$sncIdentity = "p:CN=$CertCN, O=$Company, C=$Country"
Write-Step "3/6 生成自签服务器证书 (CN=$CertCN)"
$cert = New-SelfSignedCertificate -DnsName $CertCN -CertStoreLocation cert:\LocalMachine\My `
    -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 -NotAfter (Get-Date).AddDays($Days)
Write-Ok "证书 Thumbprint: $($cert.Thumbprint)"

$pfxPath = Join-Path $env:TEMP "sap-server-$($cert.Thumbprint).pfx"
$pfxPassword = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12))
Export-PfxCertificate -Cert $cert -FilePath $pfxPath -Password (ConvertTo-SecureString $pfxPassword -AsPlainText -Force) | Out-Null
Write-Ok "已导出临时 PFX: $pfxPath"

# ---------- 4. sapgenpse / PSE ----------
Write-Step "4/6 生成 SAPSNCS.pse"
$sapgenpse = Get-Command sapgenpse -ErrorAction SilentlyContinue
if (-not $sapgenpse) {
    Write-Warn2 "未找到 sapgenpse 命令。请手动执行："
    Write-Host "    sapgenpse import_p12 -p `"$SecuDir\SAPSNCS.pse`" -x <PSE口令> $pfxPath"
    return
}
if (-not $PsePassword) {
    $PsePassword = [System.Convert]::ToBase64String([System.Security.Cryptography.RandomNumberGenerator]::GetBytes(12))
    Write-Warn2 "未提供 -PsePassword，已生成随机口令（请记录并妥善保管）：$PsePassword"
}
& $sapgenpse.Source import_p12 -p "$SecuDir\SAPSNCS.pse" -x $PsePassword $pfxPath
if ($LASTEXITCODE -ne 0) { throw "sapgenpse import_p12 失败，退出码 $LASTEXITCODE" }
Write-Ok "SAPSNCS.pse 已生成"
Remove-Item -LiteralPath $pfxPath -Force -ErrorAction SilentlyContinue

# ---------- 5. profile 参数 ----------
Write-Step "5/6 profile 参数建议"
$params = [ordered]@{
    "snc/enable"                 = "1"
    "snc/identity/as"            = $sncIdentity
    "snc/gss_lib"                = $SapCryptoLib
    "snc/accept_insecure_gss"    = "0"
    "snc/accept_insecure_ssl"    = "0"
    "snc/accept_insecure_cpic"   = "0"
    "snc/data_protection/use"    = "3"
    "snc/data_protection/max"    = "3"
    "snc/data_protection/min"    = "1"
}
foreach ($k in $params.Keys) { Write-Host ("    {0,-28} = {1}" -f $k, $params[$k]) }

if ($ApplyProfile) {
    if (-not $ProfilePath) {
        if (-not $Sid) { throw "-ApplyProfile 需要 -Sid 或 -ProfilePath" }
        $ProfilePath = Join-Path $env:SAP_SYSTEM_ROOT "\SYS\profile\DEFAULT.PFL"
        if (-not (Test-Path -LiteralPath $ProfilePath)) {
            $ProfilePath = "C:\Program Files\SAP\$Sid\SYS\profile\DEFAULT.PFL"
        }
    }
    Write-Step "5b/6 写入 profile: $ProfilePath"
    if (-not (Test-Path -LiteralPath $ProfilePath)) { throw "profile 文件不存在: $ProfilePath" }
    $lines = foreach ($k in $params.Keys) { "$k = $($params[$k])" }
    Add-Content -LiteralPath $ProfilePath -Value $lines
    Write-Ok "已追加 $($params.Count) 个参数，请重启实例后在 RZ11 确认"
}

# ---------- 6. 客户端提示 ----------
Write-Step "6/6 客户端后续操作"
Write-Host "    1. 将证书导出并在每台客户端导入到受信任根："
Write-Host "       certutil -addstore Root `"cert:\LocalMachine\My\$($cert.Thumbprint)`""
Write-Host "       或：Export-Certificate -Cert `"cert:\LocalMachine\My\$($cert.Thumbprint)`" -FilePath sap-server.cer"
Write-Host "    2. SAP Logon 连接属性：SNC=Active，SNC Name = $sncIdentity"
Write-Host "    3. SU01 用户 SNC 页签绑定域用户（详见 docs/SNC-SSO-Implementation.md）"
Write-Host "`n完成。请重启 SAP 实例使参数生效。" -ForegroundColor Green
