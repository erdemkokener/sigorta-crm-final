@echo off
set PATH=C:\Program Files\nodejs;%PATH%
set APP_USER=admin
set APP_PASS=admin123
set SESSION_SECRET=secret123
set MAIL_MODE=smtp
set SMTP_HOST=smtp.gmail.com
set SMTP_PORT=587
set SMTP_SECURE=false
set SMTP_USER=erdemkokener@gmail.com
set SMTP_PASS=bznfvszqqhasczon
set MAIL_FROM=erdemkokener@gmail.com
set MAIL_TO=erdemkokener@gmail.com

echo Starting Sigorta CRM...
node server.js
pause
