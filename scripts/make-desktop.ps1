$ErrorActionPreference = 'Stop'
function Get-Sha256Hex([byte[]]$Bytes) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [System.BitConverter]::ToString($sha.ComputeHash($Bytes)).Replace([string][char]45, [string]::Empty) }
  finally { $sha.Dispose() }
}
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$systemRoot = if ($env:SystemRoot) { $env:SystemRoot } else { 'C:\Windows' }
$tempCandidates = @($env:TEMP, (Join-Path $systemRoot 'Temp'))
$tempBase = $tempCandidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and $_ -match '^[\x20-\x7e]+$' } | Select-Object -First 1
if (-not $tempBase) { throw '找不到可用的 ASCII 暫存路徑，無法產生 Windows 發行包。' }

$buildId = [guid]::NewGuid()
$buildRoot = Join-Path $tempBase ("704bg-build-" + $buildId.ToString('N'))
$nodeModulesPath = Join-Path $buildRoot 'node_modules'
$junctionCreated = $false
New-Item -ItemType Directory -Path $buildRoot | Out-Null

try {
  foreach ($name in @('config', 'public', 'src', 'assets', 'resources', 'runtime', 'scripts')) {
    $source = Join-Path $projectRoot $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $buildRoot -Recurse }
  }
  foreach ($name in @('package.json', 'package-lock.json', 'forge.config.js', 'LICENSE')) {
    $source = Join-Path $projectRoot $name
    if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $buildRoot }
  }
  $manualSource = Join-Path $projectRoot 'docs\704現場操作手冊_v1.md'
  if (-not (Test-Path -LiteralPath $manualSource)) { throw "找不到現場操作手冊：$manualSource" }
  $manualBuildDirectory = Join-Path $buildRoot 'docs'
  New-Item -ItemType Directory -Path $manualBuildDirectory | Out-Null
  Copy-Item -LiteralPath $manualSource -Destination $manualBuildDirectory
  Copy-Item -LiteralPath $manualSource -Destination (Join-Path $manualBuildDirectory '704-operation-manual.md')

  New-Item -ItemType Junction -Path $nodeModulesPath -Target (Join-Path $projectRoot 'node_modules') | Out-Null
  $junctionCreated = $true
  $forgeCli = Join-Path $nodeModulesPath '@electron-forge\cli\dist\electron-forge.js'
  Push-Location $buildRoot
  try {
    & node $forgeCli make
    if ($LASTEXITCODE -ne 0) { throw "Electron Forge make 失敗，結束碼：$LASTEXITCODE" }
    & node (Join-Path $buildRoot 'scripts\verify-desktop-package.mjs') `
      (Join-Path $buildRoot 'out\704 腦力競賽-win32-x64\resources\app.asar') `
      (Join-Path $buildRoot 'out\704 腦力競賽-win32-x64\resources\touch-service') `
      (Join-Path $buildRoot 'docs\704現場操作手冊_v1.md')
    if ($LASTEXITCODE -ne 0) { throw "桌面 package 內容驗證失敗，結束碼：$LASTEXITCODE" }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $packedManual = Join-Path $buildRoot 'out\704 腦力競賽-win32-x64\resources\704-operation-manual.md'
    if (-not (Test-Path -LiteralPath $packedManual)) { throw '桌面 package 未包含現場操作手冊。' }
    $manualSha256 = Get-Sha256Hex -Bytes ([System.IO.File]::ReadAllBytes($packedManual))
    $archivePaths = @(
      Get-ChildItem -LiteralPath (Join-Path $buildRoot 'out\make\zip\win32\x64') -Filter '*.zip' -File
      Get-ChildItem -LiteralPath (Join-Path $buildRoot 'out\make\squirrel.windows\x64') -Filter '*.nupkg' -File
    )
    if ($archivePaths.Count -ne 2) { throw "ZIP 或 Squirrel .nupkg 數量錯誤：$($archivePaths.Count)" }
    foreach ($archiveFile in $archivePaths) {
      $zipArchive = [System.IO.Compression.ZipFile]::OpenRead($archiveFile.FullName)
      try {
        $manualEntries = @($zipArchive.Entries | Where-Object {
          ($_.FullName -replace '\\', '/') -match '(^|/)resources/704-operation-manual\.md$'
        })
        if ($manualEntries.Count -ne 1) { throw "發行包缺少唯一現場操作手冊：$($archiveFile.Name)" }
        $entryStream = $manualEntries[0].Open()
        $memoryStream = [System.IO.MemoryStream]::new()

        try {
          $entryStream.CopyTo($memoryStream)
          $archiveManualSha256 = Get-Sha256Hex -Bytes $memoryStream.ToArray()
        }
        finally { $memoryStream.Dispose(); $entryStream.Dispose() }
        if ($archiveManualSha256 -ne $manualSha256) { throw "發行包內手冊雜湊與 package 不符：$($archiveFile.Name)" }
      }
      finally { $zipArchive.Dispose() }
    }
    Write-Host '現場操作手冊已核對並包含於 app package、ZIP 與 Squirrel .nupkg。'
  }
  finally { Pop-Location }

  $destinationOut = Join-Path $projectRoot 'out'
  # New release numbering starts at 5; existing dated release folders carry it forward.
  $releaseDate = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId([DateTime]::UtcNow, 'Taipei Standard Time').ToString('yyyy-MM-dd')
  $lastReleaseNumber = 4
  if (Test-Path -LiteralPath $destinationOut) {
    foreach ($folder in (Get-ChildItem -LiteralPath $destinationOut -Directory)) {
      if ($folder.Name -match '-\d{4}-\d{2}-\d{2}-(\d+)$') {
        $lastReleaseNumber = [Math]::Max($lastReleaseNumber, [int]$Matches[1])
      }
    }
  }
  $releaseSuffix = "-$releaseDate-$($lastReleaseNumber + 1)"
  $outputSlot = $env:BRAIN_GAME_OUTPUT_SLOT
  if (-not $outputSlot) { $outputSlot = 'recovery-candidate' }
  if ($outputSlot -notmatch '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$') {
    throw 'BRAIN_GAME_OUTPUT_SLOT 只能是英數、連字號或底線的名稱前綴。日期與版次會自動附加。'
  }
  $outputSlot = $outputSlot -replace '-\d{4}-\d{2}-\d{2}-\d+$', ''
  $outputRoot = Join-Path $destinationOut ($outputSlot + $releaseSuffix)
  $portableFolderName = '704 腦力競賽-win32-x64' + $releaseSuffix
  $resolvedOutputRoot = [IO.Path]::GetFullPath($outputRoot)
  $resolvedOutRoot = [IO.Path]::GetFullPath($destinationOut).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
  if (-not $resolvedOutputRoot.StartsWith($resolvedOutRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
      -not $resolvedOutputRoot.Equals($resolvedOutRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw "拒絕寫入 out 目錄以外的路徑：$resolvedOutputRoot"
  }

  foreach ($name in @('704 腦力競賽-win32-x64', 'make')) {
    $source = Join-Path (Join-Path $buildRoot 'out') $name
    if (-not (Test-Path -LiteralPath $source)) { throw "建置產物不存在：$source" }
  }

  $destinations = @($portableFolderName, 'make') | ForEach-Object { Join-Path $outputRoot $_ }
  $runningExecutables = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = '704-Brain-Game.exe' OR Name = 'TouchService.exe'" -ErrorAction Stop)
  $lockedTargets = foreach ($destination in $destinations) {
    $resolvedDestination = [IO.Path]::GetFullPath($destination).TrimEnd([IO.Path]::DirectorySeparatorChar, [IO.Path]::AltDirectorySeparatorChar)
    foreach ($process in $runningExecutables) {
      $executablePath = $process.ExecutablePath
      if (-not $executablePath) {
        throw "無法確認執行中程序 $($process.ProcessId) $($process.Name) 的檔案位置；為避免覆寫使用中的輸出，已中止。"
      }
      if ($executablePath -and $executablePath.StartsWith($resolvedDestination + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        [pscustomobject]@{ Target = $destination; ProcessId = $process.ProcessId; Name = $process.Name; Path = $executablePath }
      }
    }
  }
  if ($lockedTargets) {
    $details = ($lockedTargets | ForEach-Object { "PID $($_.ProcessId) $($_.Name)（$($_.Path)）" }) -join '；'
    throw "目標輸出仍有程式執行，未刪除或覆寫任何輸出。請先正常關閉後重試：$details"
  }

  # Refuse to overwrite any existing release (including concurrent builds).
  New-Item -ItemType Directory -Path $outputRoot -ErrorAction Stop | Out-Null
  foreach ($name in @('704 腦力競賽-win32-x64', 'make')) {
    $destinationName = if ($name -eq '704 腦力競賽-win32-x64') { $portableFolderName } else { $name }
    $destination = Join-Path $outputRoot $destinationName
    Copy-Item -LiteralPath (Join-Path (Join-Path $buildRoot 'out') $name) -Destination $destination -Recurse
  }
  Write-Host "Windows 發行包已建置並驗證：$outputRoot"
}
finally {
  Set-Location $projectRoot
  $junctionRemoved = -not $junctionCreated
  if ($junctionCreated -and (Test-Path -LiteralPath $nodeModulesPath)) {
    try {
      [IO.Directory]::Delete($nodeModulesPath, $false)
      $junctionRemoved = $true
    }
    catch { Write-Warning "暫存 node_modules junction 未能移除；保留建置暫存目錄以免刪除原始依賴：$nodeModulesPath" }
  }
  $resolvedTempBase = (Resolve-Path -LiteralPath $tempBase).Path
  $resolvedBuildRoot = (Resolve-Path -LiteralPath $buildRoot).Path
  if ($resolvedBuildRoot.StartsWith($resolvedTempBase + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -and
      (Split-Path -Leaf $resolvedBuildRoot).StartsWith('704bg-build-', [StringComparison]::Ordinal) -and $junctionRemoved) {
    Remove-Item -LiteralPath $resolvedBuildRoot -Recurse -Force
  }
  else { Write-Warning "拒絕清理非本次建置的暫存路徑：$resolvedBuildRoot" }
}
