# Start the Trace self-host server on Windows. Runs from this directory so
# config.json is picked up. Any arguments are passed through to serve.py.
$ErrorActionPreference = 'Stop'
Set-Location -Path $PSScriptRoot
python serve.py @args
