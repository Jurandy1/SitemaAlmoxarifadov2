[CmdletBinding()]
param(
  [int]$Port = 8000
)

$started = $false
$tries = 0
while (-not $started -and $tries -lt 20) {
  $prefix = "http://localhost:$Port/"
  $listener = New-Object System.Net.HttpListener
  $listener.Prefixes.Add($prefix)
  try {
    $listener.Start()
    $started = $true
  } catch {
    try { $listener.Stop() } catch {}
    $Port = $Port + 1
    $tries = $tries + 1
  }
}

if (-not $started) {
  throw "Não foi possível iniciar o servidor em nenhuma porta disponível."
}

Write-Host "Serving http://localhost:$Port/ from $pwd"
try {
  while ($listener.IsListening) {
    $context = $listener.GetContext()
    $path = $context.Request.Url.AbsolutePath.TrimStart('/')
    if ([string]::IsNullOrEmpty($path)) { $path = 'index.html' }
    $file = Join-Path $pwd $path
    if (Test-Path $file) {
      $bytes = [System.IO.File]::ReadAllBytes($file)
      $ext = [System.IO.Path]::GetExtension($file).ToLower()
      switch ($ext) {
        '.html' { $context.Response.ContentType = 'text/html' }
        '.js'   { $context.Response.ContentType = 'application/javascript' }
        '.css'  { $context.Response.ContentType = 'text/css' }
        '.json' { $context.Response.ContentType = 'application/json' }
        '.svg'  { $context.Response.ContentType = 'image/svg+xml' }
        '.png'  { $context.Response.ContentType = 'image/png' }
        '.jpg'  { $context.Response.ContentType = 'image/jpeg' }
        default { $context.Response.ContentType = 'application/octet-stream' }
      }
      $context.Response.ContentLength64 = $bytes.Length
      $context.Response.OutputStream.Write($bytes,0,$bytes.Length)
      $context.Response.OutputStream.Close()
    } else {
      $context.Response.StatusCode = 404
      $context.Response.OutputStream.Close()
    }
  }
} finally {
  $listener.Stop()
}
