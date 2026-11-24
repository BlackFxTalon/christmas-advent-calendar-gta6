$ErrorActionPreference = "Stop"
$botRoot = Split-Path -Parent $PSScriptRoot
$secret = $null
$pointer = [IntPtr]::Zero
$plainUrl = $null

Push-Location $botRoot
try {
    $secret = Read-Host "Paste the rotated Supabase DATABASE_URL (input is hidden)" -AsSecureString
    $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secret)
    $plainUrl = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
    $env:DATABASE_URL = $plainUrl

    node .\scripts\live-supabase-smoke.mjs
    if ($LASTEXITCODE -ne 0) {
        throw "Live smoke test failed with exit code $LASTEXITCODE."
    }
}
finally {
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    if ($pointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
    }
    if ($secret) {
        $secret.Dispose()
    }
    $plainUrl = $null
    Pop-Location
}
