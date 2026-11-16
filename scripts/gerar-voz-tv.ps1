Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SelectVoice("Microsoft Maria Desktop")
$s.Rate = -1
$dir = Join-Path (Get-Location) "public\tv-voz"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$lista = Get-Content -Raw -Encoding UTF8 (Join-Path $dir "frases.json") | ConvertFrom-Json
$feitos = 0
foreach ($item in $lista) {
  $path = Join-Path $dir ($item.slug + ".wav")
  if (Test-Path $path) { continue }
  $s.SetOutputToWaveFile($path)
  $s.Speak([string]$item.texto)
  $s.SetOutputToNull()
  $feitos++
  if (($feitos % 25) -eq 0) { Write-Output "gerados $feitos" }
}
$s.Dispose()
Write-Output "novos $feitos"
