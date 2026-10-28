*&---------------------------------------------------------------------*
*& Report ZSNC_SSO_INFO
*&---------------------------------------------------------------------*
*& SNC / Kerberos 透明 SSO 部署信息收集（增强版）
*& 用途：从 SAP 系统读取 SNC 相关的 profile 参数（含当前生效值）、
*&       SECUDIR 路径、PSE 证书库文件与用户 SNC 映射（USRACL），
*&       并给出部署就绪诊断结论，供部署/诊断使用。
*& 运行：SE38 -> ZSNC_SSO_INFO -> F8
*& 说明：只读报告，无任何写操作；仅依赖权威确认的标准表/系统参数
*&       （TPFCP/USRACL/USR02 + RSPARAM_READ + C_SAPGPARAM），跨版本可编译。
*& 参考：SAP 官方安全服务工具 security-services-tools (GitHub SAP-samples)；
*&       SNC/Kerberos 实施见 docs/SNC-SSO-Implementation.md
*&---------------------------------------------------------------------*
REPORT zsnc_sso_info.

TABLES: tpfcp, usr02, usracl.

*--------------------------------------------------------------------*
* 选择屏幕
*--------------------------------------------------------------------*
SELECTION-SCREEN BEGIN OF BLOCK b1 WITH FRAME TITLE 'SNC / Kerberos SSO 信息收集'.
  SELECTION-SCREEN BEGIN OF LINE.
    SELECTION-SCREEN COMMENT 1(24) '参数过滤:'.
    PARAMETERS p_parm TYPE tpfcp-parname LOWER CASE.
  SELECTION-SCREEN END OF LINE.
  SELECTION-SCREEN SKIP 1.
  PARAMETERS p_all  TYPE flag AS CHECKBOX DEFAULT 'X'.
  PARAMETERS p_user TYPE usr02-bname.
  PARAMETERS p_pse  TYPE flag AS CHECKBOX DEFAULT 'X'.
  PARAMETERS p_snc  TYPE flag AS CHECKBOX DEFAULT 'X'.
  PARAMETERS p_usr  TYPE flag AS CHECKBOX DEFAULT 'X'.
SELECTION-SCREEN END OF BLOCK b1.

*--------------------------------------------------------------------*
* 数据定义
*--------------------------------------------------------------------*
TYPES: BEGIN OF ty_parm,
         parname TYPE tpfcp-parname,
         parval  TYPE tpfcp-parval,
         profile TYPE tpfcp-profile,
         curval  TYPE string,
       END OF ty_parm.

TYPES: BEGIN OF ty_pse,
         name TYPE string,
         len  TYPE string,
         stat TYPE string,
         ok   TYPE flag,
       END OF ty_pse.

DATA: gt_parm  TYPE TABLE OF ty_parm,
      gs_parm  TYPE ty_parm,
      gt_pse   TYPE TABLE OF ty_pse,
      gs_pse   TYPE ty_pse,
      lv_secu  TYPE c LENGTH 255,
      lv_file  TYPE string,
      lv_len   TYPE i,
      lv_ok    TYPE flag,
      lv_enbl  TYPE c LENGTH 10,
      lv_ready TYPE flag,
      lt_usr   TYPE TABLE OF usracl,
      lv_coun  TYPE i.

DATA: gt_want TYPE TABLE OF tpfcp-parname.
FIELD-SYMBOLS: <fs_w> LIKE LINE OF gt_want.

*--------------------------------------------------------------------*
* 起始
*--------------------------------------------------------------------*
START-OF-SELECTION.

* 关注的 SNC/profile 参数（固定核心清单）
  APPEND 'snc/enable'               TO gt_want.
  APPEND 'snc/identity/as'          TO gt_want.
  APPEND 'snc/identity/per'         TO gt_want.
  APPEND 'snc/gss_lib'              TO gt_want.
  APPEND 'snc/accept_insecure_gss'  TO gt_want.
  APPEND 'snc/accept_insecure_ssl'  TO gt_want.
  APPEND 'snc/accept_insecure_cpic' TO gt_want.
  APPEND 'snc/accept_insecure_rfc'  TO gt_want.
  APPEND 'snc/data_protection/use'  TO gt_want.
  APPEND 'snc/data_protection/max'  TO gt_want.
  APPEND 'snc/data_protection/min'  TO gt_want.
  APPEND 'snc/extid_login_diag'     TO gt_want.
  APPEND 'snc/extid_use_udd'        TO gt_want.
  APPEND 'secudir'                  TO gt_want.
  APPEND 'DIR_SECUDIR'              TO gt_want.

  IF p_parm IS NOT INITIAL.
    APPEND p_parm TO gt_want.
  ENDIF.
  SORT gt_want.
  DELETE ADJACENT DUPLICATES FROM gt_want.

* p_all=on：改为列出系统上所有 snc* 参数
  IF p_all IS NOT INITIAL.
    CLEAR gt_want.
    IF p_parm IS NOT INITIAL.
      APPEND p_parm TO gt_want.
    ELSE.
      SELECT DISTINCT parname FROM tpfcp INTO TABLE gt_want
        WHERE parname LIKE 'snc/%'
           OR parname LIKE 'ssl/%'.
      SORT gt_want.
    ENDIF.
  ENDIF.

*--------------------------------------------------------------------*
* 1) Profile 参数：TPFCP 源值 + 当前生效值
*--------------------------------------------------------------------*
  LOOP AT gt_want ASSIGNING <fs_w>.
    SELECT SINGLE parname parval profile
      FROM tpfcp
      INTO gs_parm
      WHERE parname = <fs_w>.
    IF sy-subrc = 0.
      CALL FUNCTION 'RSPARAM_READ'
        EXPORTING
          pname = gs_parm-parname
        IMPORTING
          pval  = gs_parm-curval.
      APPEND gs_parm TO gt_parm.
    ELSE.
*     参数未在 TPFCP 中显式定义：仍尝试读取当前生效值
      CLEAR gs_parm.
      gs_parm-parname = <fs_w>.
      CALL FUNCTION 'RSPARAM_READ'
        EXPORTING
          pname = gs_parm-parname
        IMPORTING
          pval  = gs_parm-curval.
      IF gs_parm-curval IS NOT INITIAL.
        APPEND gs_parm TO gt_parm.
      ENDIF.
    ENDIF.
  ENDLOOP.

*--------------------------------------------------------------------*
* 报告头
*--------------------------------------------------------------------*
  WRITE: / '=' CENTERED 100,
         / 'SAP SNC / Kerberos SSO - 部署信息报告' CENTERED 100,
         / '=' CENTERED 100,
         /(20) '系统'      , sy-sysid,
         /(20) '实例'      , sy-mandt,
         /(20) '版本'      , sy-releas,
         /(20) 'OS'        , sy-opsys,
         /(20) '主机/应用' , sy-host,
         /(20) '日期'      , sy-datum,
         /(20) '时间'      , sy-uzeit,
         / '=' CENTERED 100,
         /.

*--------------------------------------------------------------------*
* 2) Profile 参数输出
*--------------------------------------------------------------------*
  WRITE: / '--- 1. Profile 参数 (TPFCP / 当前生效值) ---'.
  ULINE.
  WRITE: /(50) '参数名', (50) '值', /(50) '来源 Profile'.
  ULINE.
  LOOP AT gt_parm INTO gs_parm.
    IF gs_parm-parval = '1' OR gs_parm-parval = 'true' OR
       gs_parm-parval = 'TRUE'.
      FORMAT COLOR COL_POSITIVE.
    ELSEIF gs_parm-parval = '0' OR gs_parm-parval = 'false' OR
           gs_parm-parval = 'FALSE'.
      FORMAT COLOR COL_NEGATIVE.
    ENDIF.
    WRITE: /(50) gs_parm-parname, (50) gs_parm-parval, (50) gs_parm-profile.
    FORMAT COLOR OFF.
  ENDLOOP.
  FORMAT RESET.

*--------------------------------------------------------------------*
* 3) SECUDIR 路径 + PSE 证书库文件
*--------------------------------------------------------------------*
  CALL 'C_SAPGPARAM' ID 'DIR_SECUDIR' FIELD lv_secu.
  WRITE: /, / '--- 2. SECUDIR 与证书 PSE ---'.
  ULINE.
  IF lv_secu IS INITIAL.
    SELECT SINGLE parval FROM tpfcp INTO lv_secu WHERE parname = 'secudir'.
  ENDIF.
  WRITE: /(50) 'SECUDIR 路径', (50) lv_secu.
  IF lv_secu IS INITIAL.
    WRITE: / '  [WARN] SECUDIR 未配置！' COLOR COL_NEGATIVE.
  ENDIF.

  IF p_pse IS NOT INITIAL AND lv_secu IS NOT INITIAL.
    DATA(lt_cand) = VALUE string_table(
      ( 'SAPSNCS.pse' ) ( 'SAPSSLS.pse' ) ( 'SAPSSLC.pse' )
      ( 'SAPSSLO.pse' ) ( 'SAPNCSS.pse' ) ( 'SAPNCSP.pse' )
      ( 'SAPSNCS.crt' ) ( 'SAPSNCS.cer' ) ( 'SAPSNCS.key' )
      ( 'SAPSNCS.cred.v2' ) ( 'SAPSNCS.cred' ) ).
    LOOP AT lt_cand INTO DATA(lv_cand).
      CLEAR lv_file. lv_file = lv_secu && '\' && lv_cand.
      lv_len = 0. lv_ok = ''.
      OPEN DATASET lv_file FOR INPUT IN BINARY MODE.
      IF sy-subrc = 0.
        READ DATASET lv_file INTO DATA(lv_dummy) LENGTH lv_len.
        CLOSE DATASET lv_file.
        lv_ok = 'X'.
      ENDIF.
      gs_pse-name = lv_cand.
      gs_pse-ok   = lv_ok.
      gs_pse-stat = COND string( WHEN lv_ok IS NOT INITIAL THEN '存在'
                                 ELSE '缺失' ).
      IF lv_ok IS NOT INITIAL.
        gs_pse-len = |{ lv_len } bytes|.
      ELSE.
        CLEAR gs_pse-len.
      ENDIF.
      APPEND gs_pse TO gt_pse.
    ENDLOOP.
    WRITE: /(50) '文件', (50) '状态', (50) '大小'.
    ULINE.
    LOOP AT gt_pse INTO gs_pse.
      IF gs_pse-ok IS NOT INITIAL.
        FORMAT COLOR COL_POSITIVE.
      ELSE.
        FORMAT COLOR COL_NEGATIVE.
      ENDIF.
      WRITE: /(50) gs_pse-name, (50) gs_pse-stat, (50) gs_pse-len.
      FORMAT COLOR OFF.
    ENDLOOP.
    FORMAT RESET.
  ENDIF.

*--------------------------------------------------------------------*
* 4) SNC 目录条目（SNC 目录表非权威验证，改人工核对提示）
*--------------------------------------------------------------------*
  IF p_snc IS NOT INITIAL.
    WRITE: /, / '--- 3. SNC 目录条目 (请人工核对) ---'.
    ULINE.
    WRITE: / '  服务端 SNC 目录（服务 <-> SNC 名称）请用 SM30/SM59 核对；'
            '用户映射见下一节 USRACL。' COLOR COL_HEADING.
  ENDIF.

*--------------------------------------------------------------------*
* 5) 用户 SNC 映射 (USRACL)
*--------------------------------------------------------------------*
  IF p_usr IS NOT INITIAL.
    IF p_user IS INITIAL.
      SELECT * FROM usracl INTO TABLE lt_usr
        WHERE pname <> ''.
    ELSE.
      SELECT * FROM usracl INTO TABLE lt_usr
        WHERE bname = p_user.
    ENDIF.
    WRITE: /, / '--- 4. 用户 SNC 映射 (USRACL) ---'.
    ULINE.
    WRITE: /(15) '用户', (55) 'SNC 名称 (PNAME)', (10) '外部系统',
           (15) '允许密码登录', (10) '类型', (10) '锁定'.
    ULINE.
    LOOP AT lt_usr INTO DATA(ls_usr).
      DATA(lv_ustyp) TYPE usr02-ustyp.
      DATA(lv_uflag) TYPE usr02-uflag.
      SELECT SINGLE ustyp uflag FROM usr02
        INTO (lv_ustyp, lv_uflag)
        WHERE bname = ls_usr-bname.
      WRITE: /(15) ls_usr-bname, (55) ls_usr-pname, (10) ls_usr-snc_sid,
             (15) ls_usr-guiflag, (10) lv_ustyp, (10) lv_uflag.
    ENDLOOP.
    DESCRIBE TABLE lt_usr LINES lv_coun.
    IF lv_coun = 0.
      WRITE: / '  无匹配用户 SNC 映射' COLOR COL_NEGATIVE.
    ENDIF.
  ENDIF.

*--------------------------------------------------------------------*
* 6) 部署就绪诊断结论
*--------------------------------------------------------------------*
  WRITE: /, / '--- 5. 部署就绪诊断结论 ---'.
  ULINE.
  lv_enbl = ''.
  READ TABLE gt_parm INTO gs_parm WITH KEY parname = 'snc/enable'.
  IF sy-subrc = 0.
    lv_enbl = gs_parm-parval.
  ENDIF.
  IF lv_enbl = '1'.
    WRITE: / '  [OK] snc/enable = 1，SNC 已启用' COLOR COL_POSITIVE.
    lv_ready = 'X'.
  ELSE.
    WRITE: / '  [FAIL] snc/enable 未启用 (当前值见上)，请设置 = 1 并重启实例'
            COLOR COL_NEGATIVE.
    CLEAR lv_ready.
  ENDIF.

  READ TABLE gt_parm INTO gs_parm WITH KEY parname = 'snc/identity/as'.
  IF sy-subrc = 0 AND gs_parm-parval IS NOT INITIAL.
    WRITE: / '  [OK] snc/identity/as 已配置' COLOR COL_POSITIVE.
  ELSE.
    WRITE: / '  [FAIL] snc/identity/as 未配置' COLOR COL_NEGATIVE.
    CLEAR lv_ready.
  ENDIF.

  READ TABLE gt_pse INTO gs_pse WITH KEY name = 'SAPSNCS.pse'.
  IF sy-subrc = 0 AND gs_pse-ok IS NOT INITIAL.
    WRITE: / '  [OK] SAPSNCS.pse 存在' COLOR COL_POSITIVE.
  ELSE.
    WRITE: / '  [FAIL] SAPSNCS.pse 缺失，请用 sapgenpse 生成'
            COLOR COL_NEGATIVE.
    CLEAR lv_ready.
  ENDIF.

* RFC 通道 SNC 检查（snc/accept_insecure_rfc）
  READ TABLE gt_parm INTO gs_parm WITH KEY parname = 'snc/accept_insecure_rfc'.
  IF sy-subrc = 0.
    IF gs_parm-parval = '0'.
      WRITE: / '  [OK] RFC 通道 SNC 强制 (accept_insecure_rfc=0)'
              COLOR COL_POSITIVE.
    ELSEIF gs_parm-parval = '1'.
      WRITE: / '  [WARN] RFC 通道允许回退 (accept_insecure_rfc=1)，建议 = 0'
              COLOR COL_NEGATIVE.
    ELSE.
      WRITE: / '  [WARN] snc/accept_insecure_rfc 未显式设置，检查 SM59 目的地'
              COLOR COL_NEGATIVE.
    ENDIF.
  ELSE.
    WRITE: / '  [WARN] snc/accept_insecure_rfc 未读取到，检查 SM59 目的地'
            COLOR COL_NEGATIVE.
  ENDIF.

  IF lv_ready IS NOT INITIAL.
    WRITE: / '  ===> 核心配置就绪，可进行客户端连接验证' COLOR COL_POSITIVE.
  ELSE.
    WRITE: / '  ===> 存在未就绪项，请按上述 FAIL 逐项修复' COLOR COL_NEGATIVE.
  ENDIF.
  FORMAT RESET.

  WRITE: /, / '报告结束。' .
