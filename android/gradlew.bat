@echo off
setlocal
set "BRIDGE_JAVA=java.exe"
if defined JAVA_HOME set "BRIDGE_JAVA=%JAVA_HOME%\bin\java.exe"
"%BRIDGE_JAVA%" -classpath "%~dp0gradle\wrapper\gradle-wrapper.jar" org.gradle.wrapper.GradleWrapperMain %*
exit /b %ERRORLEVEL%
