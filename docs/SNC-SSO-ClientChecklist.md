# SNC/Kerberos SSO 用户自检清单（ABAP 程序之外）

> 配套：`abap/ZSNC_SSO_INFO.abap`（ABAP 内信息）＋ `docs/SNC-SSO-Implementation.md`（实施步骤）。
> 本清单覆盖 **ABAP 程序无法获取**、需在 OS/AD/客户端/网络层自行检索的内容。
> 逐项勾选，全部满足后即可进入客户端连接验证。

## 1. SAP 主机（OS 层）

- [ ] 确认 `sapcrypto.dll`（CommonCryptoLib）存在，路径与 `snc/gss_lib` 一致：
  `Test-Path "C:\Program Files\SAP\CommonCryptoLib\sapcrypto.dll"`
- [ ] 确认 DLL 位数匹配（SAP 实例 64 位 → 64 位 DLL）
- [ ] 读取服务器证书 CN/指纹/有效期：
  `sapgenpse get_my_name -p <SECUDIR>\SAPSNCS.pse`
- [ ] 导出证书内容核验：
  `sapgenpse export_own_cert -p <SECUDIR>\SAPSNCS.pse -o sap_server.cer`
- [ ] **证书 CN 与 `snc/identity/as` 一致**（程序显示 identity，此处比对证书 CN）
- [ ] 证书**未过期**（有效期覆盖部署窗口）
- [ ] PSE 文件权限仅 `<sid>adm` 可读写（`icacls <SECUDIR>`）
- [ ] 若有 WebGUI/SSL 通道：核验 `SAPSSLC.pse` 内容（`sapgenpse`/`sapconf`）

## 2. 活动目录（AD 层）

- [ ] SAP 主机已加域：`Get-ComputerInfo | select DomainName`
- [ ] 域 FQDN / KDC 可达：`nltest /dsgetdc:<domain>`
- [ ] SPN 已注册：`setspn -L <sap-host>`（应含 SAP 服务主体名）
- [ ] 当前登录为域账户（非本地）：`whoami`、`klist`
- [ ] Kerberos 票据可获取：`klist`（应有 TGT）
- [ ] 域用户存在且启用：`Get-ADUser <user>`
- [ ] 域用户与 SU01 SNC 名对应（对照 `ZSNC_SSO_INFO` 输出的 `USRACL-PNAME`）
- [ ] 跨域/林信任（若跨域）：已配置信任关系

## 3. 客户端工作站（SAP GUI 侧）

- [ ] SAP GUI 版本已确认（含 SNC 支持）
- [ ] 客户端 CommonCryptoLib 已安装且与 SAP GUI 位数匹配
- [ ] 服务器证书已导入**受信任根**：`certutil -store Root`
- [ ] SAP Logon 连接配置：`SNC = Active`、`SNC Name = snc/identity/as` 值（见 saplogon.ini）
- [ ] 连接**未勾选**用户/密码（透明 SSO）
- [ ] 工作站为域登录状态（`whoami /fqdn` 显示域 UPN）

## 4. 网络层

- [ ] SAP 主机 ↔ KDC 连通：`Test-NetConnection <kdc> -Port 88`
- [ ] SAP 应用端口可达（33xx/36xx 或负载均衡端口）
- [ ] 防火墙放行 Kerberos(88/464) 与 SAP 端口
- [ ] DNS 可解析 SAP 主机 FQDN：`Resolve-DnsName <sap-host-fqdn>`

## 5. RFC / 系统账户（可选，若存在 RFC 目的地）

- [ ] SM59 逐一检查 RFC 目的地 SNC 标志（ABAP 无法可靠读取，需人工）
- [ ] RFC 目的地信任关系（`RFCTRUST`/证书）已配置
- [ ] 服务端 SNC 目录（服务 ↔ SNC 名称）用 SM30/SM59 核对（`ZSNC_SSO_INFO` 第 3 节为人工提示）

---

**判定**：全部勾选后，执行 `ZSNC_SSO_INFO` 应显示"核心配置就绪"；再用 SAP GUI 双击连接验证免密进入。若连接仍弹密码/报错，按上表逐项回查。
