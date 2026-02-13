param(
  [string]$ApiBase = "http://localhost:3000"
)

$ErrorActionPreference = "Stop"

function Invoke-Json {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $false)][object]$Body,
    [Parameter(Mandatory = $false)][hashtable]$Headers
  )

  $jsonBody = $null
  if ($PSBoundParameters.ContainsKey('Body')) {
    $jsonBody = ($Body | ConvertTo-Json -Depth 20 -Compress)
  }

  $resp = Invoke-WebRequest -UseBasicParsing -Method $Method -Uri $Uri -ContentType "application/json" -Headers $Headers -Body $jsonBody
  if (-not $resp.Content) { return $null }
  return ($resp.Content | ConvertFrom-Json)
}

try {
  $health = Invoke-WebRequest -UseBasicParsing -Uri ("$ApiBase/healthz")
  Write-Host "healthz: OK" -ForegroundColor Green
} catch {
  Write-Host "healthz: FAIL" -ForegroundColor Red
  throw
}

$session = Invoke-Json -Method "POST" -Uri ("$ApiBase/api/v1/session") -Body @{}
if (-not $session.session.apiKey) {
  throw "session apiKey missing. Response: $($session | ConvertTo-Json -Depth 20)"
}

$apiKey = $session.session.apiKey
Write-Host "session: OK (apiKey acquired)" -ForegroundColor Green

$endpointName = "smoke-" + [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()

$endpoint = Invoke-Json -Method "POST" -Uri ("$ApiBase/api/v1/endpoints/create") -Headers @{ "x-api-key" = $apiKey } -Body @{ name = $endpointName }

if (-not $endpoint.endpoint.id) {
  throw "endpoint create failed. Response: $($endpoint | ConvertTo-Json -Depth 20)"
}

Write-Host "endpoint create: OK" -ForegroundColor Green
$endpoint | ConvertTo-Json -Depth 20
