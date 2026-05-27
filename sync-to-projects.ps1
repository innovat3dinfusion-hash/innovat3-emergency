# Innovat3 Daily Sync — GitHub → Claude Projects
# Run this (or ask Claude to run it) after any updates to the live site

$repo   = "C:\Users\User\Desktop\Claude-Code"
$dest   = "C:\Users\User\Desktop\Claude Projects\01.Innovat3 Safety Tags\_Deployments\Frontend"

Write-Host "Pulling latest from GitHub..." -ForegroundColor Cyan
Set-Location $repo
git pull origin main

Write-Host "Syncing files to Claude Projects..." -ForegroundColor Cyan

# Main pages
Copy-Item "$repo\index.html"                  "$dest\index.html"            -Force
Copy-Item "$repo\success.html"                "$dest\success.html"          -Force
Copy-Item "$repo\privacy.html"                "$dest\privacy-index.html"    -Force
Copy-Item "$repo\terms.html"                  "$dest\terms-index.html"      -Force
Copy-Item "$repo\logo.png"                    "$dest\logo.png"              -Force

# Subpage folders
Copy-Item "$repo\register\index.html"         "$dest\register-index.html"   -Force
Copy-Item "$repo\card\index.html"             "$dest\card-index.html"       -Force
Copy-Item "$repo\cancellation\index.html"     "$dest\cancellation-index.html" -Force
Copy-Item "$repo\reactivate\index.html"       "$dest\reactivate-index.html" -Force

# Assets folder
Copy-Item "$repo\assets" "$dest\assets" -Recurse -Force

Write-Host "Done. Claude Projects is up to date." -ForegroundColor Green
