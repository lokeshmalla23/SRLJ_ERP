# setup.ps1 — Run this once on a new machine to install all dependencies.
# Requirements: Node.js >= 18  (https://nodejs.org/en/download — use LTS)

$ErrorActionPreference = "Stop"

function Check-NodeVersion {
    $version = node --version 2>$null
    if (-not $version) {
        Write-Error "Node.js not found. Install Node.js 18 LTS or higher from https://nodejs.org"
        exit 1
    }
    $major = [int]($version -replace 'v(\d+)\..*', '$1')
    if ($major -lt 18) {
        Write-Error "Node.js $version is too old. This project requires Node.js 18 or higher."
        exit 1
    }
    Write-Host "Node.js $version - OK" -ForegroundColor Green
}

Write-Host ""
Write-Host "=== Jewellery CRM Setup ===" -ForegroundColor Cyan
Write-Host ""

Check-NodeVersion

Write-Host ""
Write-Host "Installing backend dependencies..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\backend"
npm install
if (-not $?) { Write-Error "backend npm install failed"; exit 1 }
Write-Host "Backend OK" -ForegroundColor Green

Write-Host ""
Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\frontend"
npm install
if (-not $?) { Write-Error "frontend npm install failed"; exit 1 }

Write-Host ""
Write-Host "Building frontend..." -ForegroundColor Yellow
npm run build
if (-not $?) { Write-Error "frontend build failed"; exit 1 }
Write-Host "Frontend OK" -ForegroundColor Green

Write-Host ""
Write-Host "Installing desktop dependencies..." -ForegroundColor Yellow
Set-Location "$PSScriptRoot\desktop"
npm install
if (-not $?) { Write-Error "desktop npm install failed"; exit 1 }
Write-Host "Desktop OK" -ForegroundColor Green

Set-Location "$PSScriptRoot"

Write-Host ""
Write-Host "=== Setup complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "To run in development mode:"
Write-Host "  cd desktop && npm run dev"
Write-Host ""
Write-Host "To package the installer:"
Write-Host "  cd desktop && npm run dist"
Write-Host ""
