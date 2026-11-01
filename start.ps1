$ErrorActionPreference = 'Stop'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw 'Node.js 18+ is required for the preview server. You can also open public/index.html directly in a browser.'
}
& node (Join-Path $PSScriptRoot 'scripts/serve.mjs')
