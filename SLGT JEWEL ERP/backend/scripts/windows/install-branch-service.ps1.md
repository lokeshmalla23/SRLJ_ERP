# Windows Branch Service install notes (NSSM)
#
# Goal: Branch Service keeps running when Electron/CRM UI closes.
# Prefer NSSM (https://nssm.cc/) over custom service wrappers for V1.
#
# Prerequisites:
#   1. Local PostgreSQL ready (npm run branch:bootstrap  OR production installer)
#   2. backend/.env.branch present with APP_MODE=branch and DATABASE_URL
#   3. Node.js installed system-wide
#
# Install (elevated PowerShell):
#
#   $nssm = "C:\Tools\nssm\nssm.exe"   # adjust path
#   $node = (Get-Command node).Source
#   $app  = "C:\crm\backend\src\scripts\startBranch.js"
#   $cwd  = "C:\crm\backend"
#
#   & $nssm install JewelleryCRM-BranchService $node $app
#   & $nssm set JewelleryCRM-BranchService AppDirectory $cwd
#   & $nssm set JewelleryCRM-BranchService Start SERVICE_AUTO_START
#   & $nssm set JewelleryCRM-BranchService AppStdout "$cwd\logs\branch-service.out.log"
#   & $nssm set JewelleryCRM-BranchService AppStderr "$cwd\logs\branch-service.err.log"
#   & $nssm set JewelleryCRM-BranchService AppRotateFiles 1
#   New-Item -ItemType Directory -Force -Path "$cwd\logs" | Out-Null
#   & $nssm start JewelleryCRM-BranchService
#
# Firewall (LAN clients — Phase 9):
#   New-NetFirewallRule -DisplayName "Jewellery CRM Branch API" `
#     -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
#
# Uninstall:
#   & $nssm stop JewelleryCRM-BranchService
#   & $nssm remove JewelleryCRM-BranchService confirm
#
# Do NOT store DB passwords in this file. Use .env.branch with restricted ACLs.
