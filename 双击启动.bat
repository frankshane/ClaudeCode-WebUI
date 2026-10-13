@echo off
cd /d "%~dp0"
:: 开启全局全权免密模式（子代理及所有工具调用一律自动放行，0 弹窗打扰）
set CC_PERMISSION_MODE=bypassPermissions

echo ===============================================
echo  CC WebUI zhengzai qidong (Quanxian Yi Quanmian Fangxing)...
echo  liulanqi hui zidong dakai http://127.0.0.1:8787
echo  guanbi ci chuangkou ji tingzhi fuwu
echo ===============================================
echo.
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8787"
npm start
pause
