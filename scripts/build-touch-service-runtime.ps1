param(
  [string]$SourceRoot
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$settings = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'config\touch-service.desktop.json') | ConvertFrom-Json
if (-not $SourceRoot) { $SourceRoot = $settings.serviceRoot }
if (-not $SourceRoot -or -not (Test-Path -LiteralPath $SourceRoot)) { throw "找不到 TouchService 原始碼：$SourceRoot" }
$SourceRoot = (Resolve-Path -LiteralPath $SourceRoot).Path
$serviceProject = Join-Path $SourceRoot 'src\TouchService\TouchService.csproj'
$sourceConfig = Join-Path $SourceRoot 'config.json'
$sourceVenue = Join-Path $SourceRoot 'venues\704.json'
foreach ($path in @($serviceProject, $sourceConfig, $sourceVenue)) {
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "TouchService 建置來源缺少檔案：$path" }
}

$dirtySource = & git -C $SourceRoot status --porcelain -- src/TouchService config.json venues/704.json
if ($LASTEXITCODE -ne 0) { throw '無法確認 TouchService 發布來源的 Git 狀態。' }
if ($dirtySource) { throw "TouchService 發布來源含未提交變更；先核對後再建置：`n$($dirtySource -join "`n")" }
$revision = (& git -C $SourceRoot rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or -not $revision) { throw '無法讀取 TouchService 來源版本。' }
$sdkVersion = (& dotnet --version).Trim()
if ($LASTEXITCODE -ne 0 -or -not $sdkVersion) { throw '找不到 .NET SDK。' }

$tempRootPath = Join-Path $projectRoot 'tmp'
New-Item -ItemType Directory -Path $tempRootPath -Force | Out-Null
$buildRoot = Join-Path $tempRootPath ("touchservice-build-" + [guid]::NewGuid().ToString('N'))
$sourceCopy = Join-Path $buildRoot 'src\TouchService'
$stagedRuntime = Join-Path $buildRoot 'runtime'
$destinationRuntime = Join-Path $projectRoot 'runtime\touch-service'
New-Item -ItemType Directory -Path $buildRoot | Out-Null

try {
  New-Item -ItemType Directory -Path (Split-Path -Parent $sourceCopy) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $SourceRoot 'src\TouchService') -Destination (Split-Path -Parent $sourceCopy) -Recurse
  $publishOutput = Join-Path $stagedRuntime 'publish\win-x64'
  New-Item -ItemType Directory -Path $publishOutput -Force | Out-Null
  & dotnet publish $sourceCopy -c Release -r win-x64 -p:SelfContained=true -p:PublishSingleFile=true `
    -p:EnableCompressionInSingleFile=true -o $publishOutput
  if ($LASTEXITCODE -ne 0) { throw "TouchService 發布失敗，結束碼：$LASTEXITCODE" }

  $executable = Join-Path $publishOutput 'TouchService.exe'
  if (-not (Test-Path -LiteralPath $executable -PathType Leaf) -or (Get-Item -LiteralPath $executable).Length -lt 30000000) {
    throw 'TouchService 發布輸出不是預期的自包含 win-x64 單檔執行檔。'
  }
  Get-ChildItem -LiteralPath $publishOutput -Filter '*.pdb' -File | Remove-Item -Force
  Copy-Item -LiteralPath $sourceConfig -Destination (Join-Path $stagedRuntime 'config.json')
  New-Item -ItemType Directory -Path (Join-Path $stagedRuntime 'venues') -Force | Out-Null
  Copy-Item -LiteralPath $sourceVenue -Destination (Join-Path $stagedRuntime 'venues\704.json')

  $provenance = [ordered]@{
    component = 'TouchService'
    sourceRevision = $revision
    runtime = 'win-x64 self-contained single-file'
    dotnetSdk = $sdkVersion
    builtAt = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    sha256 = (Get-FileHash -LiteralPath $executable -Algorithm SHA256).Hash.ToLowerInvariant()
    publishArguments = @('-c Release', '-r win-x64', '-p:SelfContained=true', '-p:PublishSingleFile=true', '-p:EnableCompressionInSingleFile=true')
  }
  $provenance | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stagedRuntime 'PROVENANCE.json') -Encoding utf8

  & node (Join-Path $projectRoot 'scripts\verify-touch-service-runtime.mjs') $stagedRuntime (Join-Path $projectRoot 'config\venue-704.json')
  if ($LASTEXITCODE -ne 0) { throw "TouchService runtime hello 驗證失敗，結束碼：$LASTEXITCODE" }

  if (Test-Path -LiteralPath $destinationRuntime) {
    $backup = Join-Path $buildRoot 'previous-runtime'
    Move-Item -LiteralPath $destinationRuntime -Destination $backup
    try { Move-Item -LiteralPath $stagedRuntime -Destination $destinationRuntime }
    catch {
      if (-not (Test-Path -LiteralPath $destinationRuntime) -and (Test-Path -LiteralPath $backup)) {
        Move-Item -LiteralPath $backup -Destination $destinationRuntime
      }
      throw
    }
  }
  else { New-Item -ItemType Directory -Path (Split-Path -Parent $destinationRuntime) -Force | Out-Null; Move-Item -LiteralPath $stagedRuntime -Destination $destinationRuntime }

  Write-Host "TouchService runtime 已建立：$destinationRuntime"
  Write-Host "來源 revision：$revision"
  Write-Host "SHA-256：$($provenance.sha256)"
}
finally {
  $resolvedTemp = (Resolve-Path -LiteralPath $tempRootPath).Path
  $resolvedBuild = (Resolve-Path -LiteralPath $buildRoot -ErrorAction SilentlyContinue).Path
  if ($resolvedBuild -and $resolvedBuild.StartsWith($resolvedTemp + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedBuild).StartsWith('touchservice-build-', [StringComparison]::Ordinal)) {
    Remove-Item -LiteralPath $resolvedBuild -Recurse -Force
  }
}
