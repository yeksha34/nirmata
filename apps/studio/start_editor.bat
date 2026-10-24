@echo off
setlocal
rem Double-click launcher for the Story Editor. One window, one process:
rem this console runs node directly in the foreground (no "start", no
rem "cmd /k" wrapper) -- closing this window stops the server, full stop,
rem nothing left dangling. The server opens your browser itself once it's
rem actually listening (see --open in server.mjs) instead of this script
rem guessing a delay and spawning a second window to do it.

set PORT=8787
cd /d "%~dp0..\.."
title Story Editor Server

node "%~dp0server.mjs" --port %PORT% --open
