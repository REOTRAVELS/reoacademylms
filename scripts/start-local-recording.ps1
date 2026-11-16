$ErrorActionPreference = 'Stop'

$repositoryRoot = Split-Path $PSScriptRoot -Parent
$serverEnvPath = Join-Path $repositoryRoot 'server\.env'
$composeDirectory = Join-Path $repositoryRoot 'dev-services\livekit'
$s3ConfigPath = Join-Path $composeDirectory 's3.json'

if (-not (Test-Path $serverEnvPath)) {
  throw 'server/.env was not found. Create it from .env.example first.'
}

$settings = @{}
Get-Content $serverEnvPath | ForEach-Object {
  if ($_ -match '^\s*([^#=]+)=(.*)$') {
    $settings[$matches[1].Trim()] = $matches[2].Trim().Trim('"').Trim("'")
  }
}

$required = @(
  'LIVEKIT_RECORDING_S3_ACCESS_KEY',
  'LIVEKIT_RECORDING_S3_SECRET',
  'LIVEKIT_RECORDING_S3_BUCKET'
)
foreach ($key in $required) {
  if (-not $settings[$key]) {
    throw "$key must be set in server/.env."
  }
}
if (($settings.LIVEKIT_RECORDING_S3_ACCESS_KEY.Length -lt 3) -or
  ($settings.LIVEKIT_RECORDING_S3_SECRET.Length -lt 8)) {
  throw 'The SeaweedFS S3 access key must be at least 3 characters and its secret at least 8.'
}

$s3Config = @{
  identities = @(
    @{
      name = 'reo-academy-local'
      credentials = @(
        @{
          accessKey = $settings.LIVEKIT_RECORDING_S3_ACCESS_KEY
          secretKey = $settings.LIVEKIT_RECORDING_S3_SECRET
        }
      )
      actions = @('Admin', 'Read', 'Write', 'List', 'Tagging')
    }
  )
} | ConvertTo-Json -Depth 8
[System.IO.File]::WriteAllText(
  $s3ConfigPath,
  $s3Config,
  [System.Text.UTF8Encoding]::new($false)
)

Set-Location $composeDirectory
docker compose --progress quiet --env-file $serverEnvPath up -d
if ($LASTEXITCODE -ne 0) {
  throw 'Could not start the local LiveKit recording services.'
}

$ready = $false
for ($attempt = 0; $attempt -lt 60; $attempt++) {
  $connection = Test-NetConnection 127.0.0.1 -Port 8333 -InformationLevel Quiet `
    -WarningAction SilentlyContinue
  if ($connection) {
    $ready = $true
    break
  }
  Start-Sleep -Seconds 2
}
if (-not $ready) {
  docker compose --env-file $serverEnvPath logs --tail 80 storage
  throw 'SeaweedFS S3 did not become ready on localhost:8333.'
}

$env:RECORDING_S3_ACCESS_KEY = $settings.LIVEKIT_RECORDING_S3_ACCESS_KEY
$env:RECORDING_S3_SECRET = $settings.LIVEKIT_RECORDING_S3_SECRET
$env:RECORDING_S3_BUCKET = $settings.LIVEKIT_RECORDING_S3_BUCKET
$env:RECORDING_S3_ENDPOINT = 'http://localhost:8333'
$env:RECORDING_S3_REGION = if ($settings.LIVEKIT_RECORDING_S3_REGION) {
  $settings.LIVEKIT_RECORDING_S3_REGION
} else {
  'us-east-1'
}

$createBucket = @'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';

const client = new S3Client({
  endpoint: process.env.RECORDING_S3_ENDPOINT,
  region: process.env.RECORDING_S3_REGION,
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.RECORDING_S3_ACCESS_KEY,
    secretAccessKey: process.env.RECORDING_S3_SECRET,
  },
});
try {
  await client.send(new CreateBucketCommand({ Bucket: process.env.RECORDING_S3_BUCKET }));
  console.log('Created the private recording bucket.');
} catch (error) {
  if (error.name !== 'BucketAlreadyOwnedByYou' && error.name !== 'BucketAlreadyExists') throw error;
  console.log('The private recording bucket already exists.');
}
'@
Push-Location $repositoryRoot
try {
  node --input-type=module -e $createBucket
  if ($LASTEXITCODE -ne 0) {
    throw 'Could not create or verify the local recording bucket.'
  }
} finally {
  Pop-Location
}

Write-Output 'Local LiveKit, Egress, SeaweedFS, and the private recording bucket are ready.'
