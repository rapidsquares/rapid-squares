# Rapid Squares - tiny local web server for Windows (no installs needed).
# Normally started by double-clicking start-windows.bat.
#
#   powershell -ExecutionPolicy Bypass -File serve.ps1            # http://localhost:8000
#   powershell -ExecutionPolicy Bypass -File serve.ps1 -Port 9000
#   powershell -ExecutionPolicy Bypass -File serve.ps1 -NoBrowser
#
# Works with Windows PowerShell 5.1 (built into Windows 10/11) and PowerShell 7.
param(
  [int]$Port = 8000,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)

$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.htm' = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8';  '.js'  = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'; '.webmanifest' = 'application/manifest+json; charset=utf-8'
  '.svg'  = 'image/svg+xml'; '.png' = 'image/png'; '.jpg' = 'image/jpeg'; '.jpeg' = 'image/jpeg'
  '.gif'  = 'image/gif'; '.webp' = 'image/webp'; '.ico' = 'image/x-icon'
  '.woff' = 'font/woff'; '.woff2' = 'font/woff2'; '.txt' = 'text/plain; charset=utf-8'; '.md' = 'text/plain; charset=utf-8'
}

# Find a free port (8000, 8001, ... 8010)
$listener = $null
for ($p = $Port; $p -le $Port + 10; $p++) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $Port = $p; break }
  catch { $l.Close() }
}
if (-not $listener) {
  Write-Host "Couldn't start: ports $Port-$($Port + 10) are all in use." -ForegroundColor Red
  exit 1
}

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  Rapid Squares is running at $url" -ForegroundColor Green
Write-Host "  Serving: $root"
Write-Host "  Leave this window open while you use the site. Close it (or press Ctrl+C) to stop."
Write-Host ""
if (-not $NoBrowser) { Start-Process $url }

function Send([System.Net.HttpListenerResponse]$res, [int]$code, [byte[]]$body, [string]$type) {
  $res.StatusCode = $code
  $res.ContentType = $type
  $res.Headers['Cache-Control'] = 'no-store'   # always show your latest edits on reload
  $res.ContentLength64 = $body.Length
  $res.OutputStream.Write($body, 0, $body.Length)
  $res.OutputStream.Close()
}

try {
  while ($listener.IsListening) {
    # Wait in short slices so Ctrl+C can stop the server.
    $task = $listener.GetContextAsync()
    while (-not $task.AsyncWaitHandle.WaitOne(250)) { }
    $ctx = $task.GetAwaiter().GetResult()
    $req = $ctx.Request; $res = $ctx.Response
    try {
      $rel = [System.Uri]::UnescapeDataString($req.Url.AbsolutePath).TrimStart('/')
      if ($rel -eq '') { $rel = 'index.html' }
      $path = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
      if (Test-Path -LiteralPath $path -PathType Container) { $path = Join-Path $path 'index.html' }

      $inside = $path.StartsWith($root + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)
      if ($inside -and (Test-Path -LiteralPath $path -PathType Leaf)) {
        $ext = [System.IO.Path]::GetExtension($path).ToLowerInvariant()
        $type = $mime[$ext]; if (-not $type) { $type = 'application/octet-stream' }
        Send $res 200 ([System.IO.File]::ReadAllBytes($path)) $type
        Write-Host ("  200  " + $req.Url.AbsolutePath)
      } else {
        Send $res 404 ([System.Text.Encoding]::UTF8.GetBytes('Not found')) 'text/plain; charset=utf-8'
        Write-Host ("  404  " + $req.Url.AbsolutePath) -ForegroundColor Yellow
      }
    } catch {
      try { Send $res 500 ([System.Text.Encoding]::UTF8.GetBytes('Server error')) 'text/plain; charset=utf-8' } catch { }
      Write-Host ("  500  " + $req.Url.AbsolutePath + "  " + $_.Exception.Message) -ForegroundColor Red
    }
  }
} finally {
  $listener.Stop(); $listener.Close()
  Write-Host "Server stopped."
}
