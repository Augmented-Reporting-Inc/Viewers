param(
  [Parameter(Mandatory=$true)][string] $Version,                 # e.g. 0.1.0
  [string] $PublicUrl = '/rviewer/',                              # baked asset base
  [string] $Image     = 'ohif-viewer',                            # local image name
  [string] $EcrRepo   = '',                                       # e.g. 8042...ecr.../s3orth
  [string] $Region    = 'ca-central-1',                           # your AWS region
  [string] $Dockerfile = 'Dockerfile'                             # path to Dockerfile
)

# Basic checks
if (-not $Version -or $Version -notmatch '^\d+\.\d+\.\d+$') {
  Write-Error 'Version must be SemVer like 1.2.3'
  exit 1
}
$ShortSha = (git rev-parse --short HEAD).Trim()
Write-Host "Building version $Version ($ShortSha) with PUBLIC_URL=$PublicUrl" -ForegroundColor Cyan

# Build
docker build `
  --build-arg PUBLIC_URL=$PublicUrl `
  -t "$Image:$Version" `
  -f "$Dockerfile" `
  . || exit 1

# Local tags
$major = ($Version.Split('.'))[0]
$minor = ($Version.Split('.'))[0..1] -join '.'
$tags = @(
  "$Image:$Version",
  "$Image:$minor",
  "$Image:$major",
  "$Image:latest",
  "$Image:$Version-$ShortSha"
)

# Tag locally
foreach ($t in $tags[1..($tags.Count-1)]) { docker tag "$Image:$Version" "$t" }

# ECR tagging/push (optional)
if ($EcrRepo) {
  Write-Host "Tagging for ECR: $EcrRepo" -ForegroundColor Yellow
  $ecrTags = $tags | ForEach-Object { "$EcrRepo:" + ($_ -split ':')[-1] }
  foreach ($e in $ecrTags) { docker tag "$Image:$Version" "$e" }

  # Login (requires AWS CLI v2 configured)  skip if already logged in
  try {
    aws ecr get-login-password --region $Region | docker login --username AWS --password-stdin ($EcrRepo -split '/')[0] | Out-Null
  } catch {
    Write-Warning "ECR login failed or skipped; ensure you're authenticated before pushing."
  }

  foreach ($e in $ecrTags) { docker push "$e" }
}

# Git tag
git tag -a "v$Version" -m "OHIF viewer $Version ($ShortSha)"
git push --tags

Write-Host "Done. Tags:" -ForegroundColor Green
$tags | ForEach-Object { Write-Host "  - $_" }
if ($EcrRepo) {
  Write-Host "ECR Tags:" -ForegroundColor Green
  ($tags | ForEach-Object { "$EcrRepo:" + ($_ -split ':')[-1] }) | ForEach-Object { Write-Host "  - $_" }
}
