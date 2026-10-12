param()
$ErrorActionPreference = 'Stop'
$previewRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$previewPython = Join-Path $previewRoot '.venv\Scripts\python.exe'
$previewScript = Join-Path $previewRoot 'scripts\serve-subject-experiment.py'
$runtimeFolder = Join-Path $previewRoot 'screenshots\local-runtime'
if (-not (Test-Path -LiteralPath $previewPython)) { throw 'The existing project virtual environment is missing.' }
if (-not (Test-Path -LiteralPath (Join-Path $previewRoot 'dist\index.html'))) { throw 'Build the local frontend first.' }
try {
    $currentHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5190/api/health' -TimeoutSec 3
    if ($currentHealth.status -eq 'ok' -and $currentHealth.model -eq 'ZhengPeng7/BiRefNet') {
        Write-Output 'IntoFrame is already running at http://127.0.0.1:5190/'
        exit 0
    }
} catch { }
New-Item -ItemType Directory -Path $runtimeFolder -Force | Out-Null
$previewProcess = Start-Process -FilePath $previewPython -ArgumentList @($previewScript) -WorkingDirectory $previewRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeFolder 'preview.stdout.log') -RedirectStandardError (Join-Path $runtimeFolder 'preview.stderr.log') -PassThru
@{ launcherPid = $previewProcess.Id; url = 'http://127.0.0.1:5190/'; startedAt = (Get-Date).ToUniversalTime().ToString('o'); interpreter = $previewPython; script = $previewScript } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runtimeFolder 'preview.json') -Encoding utf8
$previewReady = $false
for ($previewAttempt = 0; $previewAttempt -lt 12; $previewAttempt++) {
    try {
        $readyHealth = Invoke-RestMethod -Uri 'http://127.0.0.1:5190/api/health' -TimeoutSec 1
        if ($readyHealth.status -eq 'ok' -and $readyHealth.model -eq 'ZhengPeng7/BiRefNet') { $previewReady = $true; break }
    } catch { }
    if ($previewProcess.HasExited) { throw "Preview process exited. Check $runtimeFolder\preview.stderr.log" }
    Start-Sleep -Milliseconds 500
}
if (-not $previewReady) { throw "Preview did not become ready. Check $runtimeFolder\preview.stderr.log" }
Write-Output "IntoFrame is ready in background process $($previewProcess.Id): http://127.0.0.1:5190/"
Write-Output "Logs: $runtimeFolder"
