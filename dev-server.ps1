$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add('http://localhost:8000/')
$listener.Start()
Write-Host "Serving http://localhost:8000/ from $pwd"
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
