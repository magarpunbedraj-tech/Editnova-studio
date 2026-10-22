# Runs a command in CI. On failure, publishes the end of its output as a
# GitHub annotation so the error is visible on the run summary page.
param([Parameter(Mandatory)][string]$Title, [Parameter(Mandatory)][string]$Command)
$log = New-TemporaryFile
cmd /c "$Command 2>&1" | Tee-Object -FilePath $log
$code = $LASTEXITCODE
if ($code -ne 0) {
  $lines = Get-Content $log
  $important = $lines | Where-Object { $_ -match 'error|panicked|FAILED|failed|assert|Error' } | Select-Object -Last 60
  $tail = $lines | Select-Object -Last 40
  $text = (($important + '----- last lines -----' + $tail) -join "`n")
  if ($text.Length -gt 30000) { $text = $text.Substring($text.Length - 30000) }
  $escaped = $text.Replace('%', '%25').Replace("`r", '').Replace("`n", '%0A')
  Write-Output "::error title=$Title::$escaped"
  exit $code
}
