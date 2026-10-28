# Windows 域 + Kerberos + SNC 透明 SSO 实施清单

> 目标：SAP GUI 使用当前 Windows 域会话的 Kerberos 票据通过 SNC 透明登录，全程无密码输入，无需修改客户端代码。
> 适用：内网、全员 Windows 域账号的生产/测试环境。系统账户（RFC 服务账号）不适用本方案。

## 场景定位与安全边界

**核心场景：业务用户没有 SAP 密码，唯一合法凭证是 Windows 域身份（Kerberos 票据）。**

| 角色 | 是否有 SAP 密码 | 是否参与业务登录 |
|---|---|---|
| 管理员 / `<sid>adm` | 有 | **否**（仅配置期一次性安装证书/参数） |
| 业务用户（Dialog） | **无**（本地密码禁用/未知） | **是**（纯域票据，零密码） |

**安全边界（配置期特权 vs 运行期零密码）：**

- 管理员密码**从不用于 SAP 业务登录**，仅用于服务器端一次性安装基础设施（证书、SECUDIR、profile 参数）。安装完成后即退出，登录链路与管理员密码完全无关。
- 业务用户全程**零密码**：域登录获得 TGT → SAP GUI 携带 → SNC 验证 → 免密进入。SAP 本地密码可置为初始值/禁用，符合等保与最小权限。
- 运行期唯一凭证 = 域账户 → SAP 用户映射（SNC 绑定）；用户改密/离职即自动失效。

## 架构

```
用户登录 Windows 域 (Kerberos TGT)
        │
        ▼
SAP GUI ──SPNEGO/Kerberos──▶ SAP NetWeaver (SNC, X.509 证书)
        │                        │
        └── SAP Logon 连接 (SNC=ON, SNC 名称=域用户)
```

## 阶段 0：信息收集（先做，避免返工）

- [ ] 确认 SAP 版本支持 SNC（SAP NetWeaver 7.x 均支持）
- [ ] 确认域控可达、SAP 主机已加域（`Get-ComputerInfo | select DomainName`）
- [ ] 记录变量：
  - `<SAP-SID>`：SAP 系统标识（如 ECC）
  - `<sap-host-fqdn>`：SAP 主机 FQDN（如 `sap-ecc.corp.local`）
  - `<domain>`：域 FQDN（如 `corp.local`）
  - `<company>`：组织名（证书 O 字段）
  - `<sid>adm`：SAP 系统服务账号

## 阶段 0.5：SNC 信息收集报告（SE38，可选但推荐）

先跑一次诊断报告，获取部署所需的关键信息（profile 参数、SECUDIR 路径、PSE 证书库、SNC 目录、用户映射）：

- 程序：`ZSNC_SSO_INFO`（源码见 `abap/ZSNC_SSO_INFO.abap`，SE38 粘贴 → 激活 → F8）
- 选择条件：`p_parm`（单参数过滤）、`p_all`（列出全部 `snc/*` 参数）、`p_user`（用户过滤）、`p_pse/p_snc/p_usr`（开关各区块）
- 输出：系统信息（版本/OS/主机）、profile 参数（TPFCP 源值 + `RSPARAM_READ` 当前生效值）、SECUDIR 下 PSE 文件存在性与大小、`SNCDIR` 条目、`USRACL` 用户 SNC 映射（SNC 名称/外部系统/密码登录标志 + USR02 类型/锁定），以及**部署就绪诊断结论**（`snc/enable`、`snc/identity/as`、`SAPSNCS.pse` 逐项 OK/FAIL）

> 该报告只读，无写操作，可在生产安全执行。

## 阶段 1：服务器证书（在 SAP 主机上执行）

**方式 A：企业 CA（推荐，生产）**

```powershell
# 1. 生成密钥 + CSR（提交到企业 CA 签发）
New-SelfSignedCertificate -DnsName "<sap-host-fqdn>.<domain>" `
  -CertStoreLocation cert:\LocalMachine\My `
  -KeyExportPolicy Exportable -KeyAlgorithm RSA -KeyLength 2048 | Out-Null
# 用 MMC/certreq 提交 CSR 到企业 CA 签发
```

**方式 B：自签（测试环境，无 CA）**

```powershell
# 用 OpenSSL 生成自签服务器证书
openssl req -x509 -newkey rsa:2048 -keyout sap_server.key -out sap_server.crt `
  -days 3650 -nodes `
  -subj "/CN=<sap-host-fqdn>.<domain>/O=<company>/C=CN"
```

## 阶段 2：配置 SECUDIR 与证书库

> 一键脚本（自动生成证书 + 建 SECUDIR + 生成 PSE + 输出 profile 参数）：
> ```powershell
> .\scripts\snc-sso-setup.ps1 -CertCN <sap-host-fqdn> -Company <company> -Country CN [-ApplyProfile -Sid <SAP-SID>]
> ```

```powershell
# 1. 创建 SECUDIR（SAP 服务账号可读写）
New-Item -ItemType Directory "C:\Program Files\SAP\secudir" -Force

# 2. 安装 SAPCRYPTOLIB（sapcrypto.dll）
#    从 SAP 下载 CommonCryptoLib，放至 C:\Program Files\SAP\CommonCryptoLib\sapcrypto.dll

# 3. 导入服务器证书到个人库（PSE），在 <sid>adm 环境下执行：
#    sapgenpse import_own_cert -p "C:\Program Files\SAP\secudir\SAPSNCS.pse" -c sap_server.crt
#    sapgenpse gen_pse -p "C:\Program Files\SAP\secudir\SAPSNCS.pse" -x <PSE密码>
```

> 关键：PSE 文件名约定 `SAPSNCS.pse`；`SECUDIR` 权限只授予 `<sid>adm`。

## 阶段 3：SAP 实例参数（RZ10 / RZ11）

| 参数 | 值 |
|---|---|
| `snc/enable` | `1` |
| `snc/identity/as` | `p:CN=<sap-host-fqdn>, O=<company>, C=CN` |
| `snc/gss_lib` | `C:\Program Files\SAP\CommonCryptoLib\sapcrypto.dll` |
| `snc/accept_insecure_gss` | `0` |
| `snc/accept_insecure_ssl` | `0` |
| `snc/accept_insecure_cpic` | `0` |
| `snc/data_protection/use` | `3` |
| `snc/data_protection/max` | `3` |
| `snc/data_protection/min` | `1` |
| `snc/extid_login_diag` | `1`（可选） |
| `snc/extid_use_udd` | `1`（可选，外部 ID 直接绑定域 UPN） |

- [ ] RZ10 维护 profile 参数 → 重启实例
- [ ] RZ11 确认运行时生效

> 启用 `snc/extid_use_udd=1` 可实现域用户自动映射，免去逐个 SU01 配置。

## 阶段 4：SU01 用户 SNC 映射（若无 UDD 自动映射）

事务 `SU01` → 每个需 SSO 用户 → **SNC 页签**：

- `SNC Name` = `p:CN=<域用户名>@<域FQDN>`（如 `p:CN=zhangsan@corp.local`）
- 勾选 `SSO with Kerberos/Secure Login`

**批量映射（SE38 ABAP 示例）**：

```abap
* 批量更新 USR02 / USRACL 的 SNC 名称（按实际表调整）
DATA: lt_users TYPE TABLE OF usr02.
SELECT * FROM usr02 INTO TABLE lt_users WHERE bname IN ('USER1','USER2').
LOOP AT lt_users ASSIGNING FIELD-SYMBOL(<fs>).
  CALL FUNCTION 'SUSR_USER_CHANGE'
    EXPORTING
      user_name       = <fs>-bname
      snc_name        = 'p:CN=<域用户名>@<域FQDN>'
      snc_required    = 'X'.
ENDLOOP.
COMMIT WORK.
```

## 阶段 5：客户端 SAP Logon 配置（每台 PC）

1. 导入服务器证书到受信任根（`cert:\CurrentUser\Root` 或 `LocalMachine\Root`）
2. 安装 SAP GUI + CommonCryptoLib（客户端 `sapcrypto.dll`）
3. SAP Logon → 新建连接属性：
   - `SNC = Active`
   - `SNC Name = p:CN=<sap-host-fqdn>, O=<company>, C=CN`（与服务器 `snc/identity/as` 一致）
   - **不填**用户/密码（或勾选"当前用户"）
4. 首次双击连接 → 弹证书确认 → 信任

> 客户端无需改代码；SAP GUI 通过 `sapcrypto.dll` 自动携带域 Kerberos 票据。

## 阶段 6：验证

- [ ] `SM59` 查看 SNC 状态为 Active
- [ ] 双击 SAP GUI 连接 → 直接进系统，无密码弹窗
- [ ] 断开网络重连，仍无需输入密码（纯票据）
- [ ] 域外/未加域机器连接 → 应被拒绝（确认未回退）
- [ ] `SM20` 安全日志确认登录方式为 SNC/Kerberos

## 常见坑速查

| 症状 | 原因 | 解决 |
|---|---|---|
| 连接报 SNC 错误 100/106 | 证书名不匹配 | 核对客户端 SNC Name 与 `snc/identity/as` 完全一致 |
| 弹回退到密码登录 | `accept_insecure_gss=0` 未生效 | 重启实例确认 RZ11 |
| 票据未传递 | 客户端未加域 / 证书未受信 | 确认域登录 + Root 存储 |
| RFC/服务账号连不上 | 无域票据 | 该场景改走 Secure Login 或存密码 |

## 参考

- 相关开源方案：[Jimsnote/sap-gui-sso-poc](https://github.com/Jimsnote/sap-gui-sso-poc)（SAML/MYSAPSSO2 路线，仅 PoC）
- 生产级替代（闭源商业）：SAP Secure Login Server / Client、SAP SSO 2.0 (SAML/OIDC)
