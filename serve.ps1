# ============================================================================
#  lll 的小站 · 本地预览服务器
#  只绑定 127.0.0.1，对外不可见；不需要安装任何环境，Windows 自带 PowerShell 即可。
#  用法：双击「启动网站.bat」，或手动执行：
#        powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
#  参数：-Port 8770     指定端口（被占用会自动往后找）
#        -NoBrowser     只启动服务，不自动打开浏览器
# ============================================================================
param(
  [int]$Port = 8770,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root      = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
$ImageDir  = Join-Path $Root 'material-library\image'
$ThumbDir  = Join-Path $Root 'thumbs'
$RootFull  = [System.IO.Path]::GetFullPath($Root)

$MimeTypes = @{
  '.html' = 'text/html; charset=utf-8'
  '.htm'  = 'text/html; charset=utf-8'
  '.css'  = 'text/css; charset=utf-8'
  '.js'   = 'application/javascript; charset=utf-8'
  '.mjs'  = 'application/javascript; charset=utf-8'
  '.json' = 'application/json; charset=utf-8'
  '.png'  = 'image/png'
  '.jpg'  = 'image/jpeg'
  '.jpeg' = 'image/jpeg'
  '.webp' = 'image/webp'
  '.gif'  = 'image/gif'
  '.svg'  = 'image/svg+xml'
  '.ico'  = 'image/x-icon'
  '.txt'  = 'text/plain; charset=utf-8'
  '.md'   = 'text/plain; charset=utf-8'
  '.mp3'  = 'audio/mpeg'
  '.m4a'  = 'audio/mp4'
  '.flac' = 'audio/flac'
  '.ogg'  = 'audio/ogg'
  '.wav'  = 'audio/wav'
  '.lrc'  = 'text/plain; charset=utf-8'
}
$ServeExt = @('.html', '.htm', '.css', '.js', '.mjs', '.json', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.txt', '.md', '.mp3', '.m4a', '.flac', '.ogg', '.wav', '.lrc')
$ImageExt = @('.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp')

function Write-Log {
  param([string]$Message, [string]$Color = 'Gray')
  $stamp = (Get-Date).ToString('HH:mm:ss')
  Write-Host ("  {0}  {1}" -f $stamp, $Message) -ForegroundColor $Color
}

function Send-Response {
  param(
    $Stream,
    [int]$Status,
    [string]$StatusText,
    [string]$ContentType,
    [byte[]]$Body,
    [bool]$HeadOnly = $false,
    [string]$Cache = 'no-cache',
    [string]$ContentRange = ''
  )
  if ($null -eq $Body) { $Body = New-Object byte[] 0 }
  $header = "HTTP/1.1 $Status $StatusText`r`n" +
            "Date: $([DateTime]::UtcNow.ToString('r'))`r`n" +
            "Server: CuteImage`r`n" +
            "Content-Type: $ContentType`r`n" +
            "Content-Length: $($Body.Length)`r`n" +
            "Accept-Ranges: bytes`r`n" +
            ($(if ($ContentRange) { "Content-Range: $ContentRange`r`n" } else { "" })) +
            "Cache-Control: $Cache`r`n" +
            "X-Content-Type-Options: nosniff`r`n" +
            "Connection: close`r`n`r`n"
  $headBytes = [System.Text.Encoding]::ASCII.GetBytes($header)
  $Stream.Write($headBytes, 0, $headBytes.Length)
  if (-not $HeadOnly -and $Body.Length -gt 0) {
    $Stream.Write($Body, 0, $Body.Length)
  }
  $Stream.Flush()
}

function Send-Text {
  param($Stream, [int]$Status, [string]$StatusText, [string]$Text, [bool]$HeadOnly, [string]$Cache = 'no-cache')
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($Text)
  Send-Response -Stream $Stream -Status $Status -StatusText $StatusText -ContentType 'text/plain; charset=utf-8' -Body $bytes -HeadOnly $HeadOnly -Cache $Cache
}

function Send-Json {
  param($Stream, $Object, [bool]$HeadOnly)
  $json = $Object | ConvertTo-Json -Depth 6 -Compress
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
  Send-Response -Stream $Stream -Status 200 -StatusText 'OK' -ContentType 'application/json; charset=utf-8' -Body $bytes -HeadOnly $HeadOnly -Cache 'no-store'
}

function Send-NotFound {
  param($Stream, [bool]$HeadOnly)
  $html = @'
<!doctype html><meta charset="utf-8"><title>404 · lll 的小站</title>
<style>body{font-family:system-ui,"Microsoft YaHei UI",sans-serif;background:#fbf5fa;color:#2a1f33;display:grid;place-items:center;height:100vh;margin:0;text-align:center}code{background:#f0e6f5;padding:2px 8px;border-radius:6px}a{color:#e0568a}</style>
<div><h1 style="font-size:64px;margin:0">404</h1><p>这个地址没有东西，回<a href="/">小站首页</a>看看吧～</p></div>
'@
  $bytes = [System.Text.Encoding]::UTF8.GetBytes($html)
  Send-Response -Stream $Stream -Status 404 -StatusText 'Not Found' -ContentType 'text/html; charset=utf-8' -Body $bytes -HeadOnly $HeadOnly
}

function Get-ThumbSlug {
  param([string]$Stem)
  $slug = [regex]::Replace($Stem, '[^A-Za-z0-9_\-]', '_')
  if ($slug.Length -gt 80) { $slug = $slug.Substring(0, 80) }
  if ([string]::IsNullOrWhiteSpace($slug)) { $slug = 'image' }
  return $slug
}

function Get-ImageManifest {
  $items = New-Object System.Collections.ArrayList
  if (-not (Test-Path -LiteralPath $ImageDir)) {
    return @{ generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss'); count = 0; totalBytes = 0; images = @() }
  }
  $total = 0
  $files = @(Get-ChildItem -LiteralPath $ImageDir -File -ErrorAction SilentlyContinue |
             Where-Object { $ImageExt -contains $_.Extension.ToLower() } |
             Sort-Object Name)

  foreach ($f in $files) {
    $stem = [System.IO.Path]::GetFileNameWithoutExtension($f.Name)
    $date = $f.LastWriteTime
    $source = '本地图片'
    $width = 0
    $height = 0
    $m = [regex]::Match($stem, '^VRChat_(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})(?:\.(\d+))?_(\d+)x(\d+)$')
    if ($m.Success) {
      $ms = 0
      if ($m.Groups[7].Success) {
        $frac = $m.Groups[7].Value
        if ($frac.Length -gt 3) { $frac = $frac.Substring(0, 3) }
        while ($frac.Length -lt 3) { $frac = $frac + '0' }
        [void][int]::TryParse($frac, [ref]$ms)
      }
      try {
        $date = New-Object DateTime ([int]$m.Groups[1].Value), ([int]$m.Groups[2].Value), ([int]$m.Groups[3].Value),
                                   ([int]$m.Groups[4].Value), ([int]$m.Groups[5].Value), ([int]$m.Groups[6].Value), $ms
      } catch { $date = $f.LastWriteTime }
      $source = 'VRChat'
      $width = [int]$m.Groups[8].Value
      $height = [int]$m.Groups[9].Value
    }

    $slug = Get-ThumbSlug $stem
    $thumbRel = $null
    $thumbAbs = Join-Path $ThumbDir ($slug + '.webp')
    if (Test-Path -LiteralPath $thumbAbs) { $thumbRel = 'thumbs/' + $slug + '.webp' }

    $ts = 0
    try { $ts = ([DateTimeOffset]::new($date)).ToUnixTimeMilliseconds() } catch { $ts = 0 }
    if ($ts -le 0) { $ts = ([DateTimeOffset]::new($f.LastWriteTime)).ToUnixTimeMilliseconds() }

    $total += $f.Length
    [void]$items.Add(@{
      file      = $f.Name
      stem      = $stem
      title     = $stem
      source    = $source
      date      = $date.ToString('yyyy-MM-ddTHH:mm:ss')
      timestamp = $ts
      width     = $width
      height    = $height
      bytes     = $f.Length
      thumb     = $thumbRel
    })
  }

  $sorted = @($items | Sort-Object { $_.timestamp } -Descending)
  return @{
    generatedAt = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
    count       = $sorted.Count
    totalBytes  = $total
    images      = $sorted
  }
}

function Get-FreePort {
  param([int]$Start)
  for ($p = $Start; $p -lt ($Start + 60); $p++) {
    $probe = $null
    try {
      $probe = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $p
      $probe.Start()
      $probe.Stop()
      return $p
    } catch {
      if ($probe) { try { $probe.Stop() } catch {} }
      continue
    }
  }
  throw "在 $Start 附近找不到空闲端口"
}

# ---------------------------------------------------------------- 启动
$Port = Get-FreePort $Port
$listener = New-Object System.Net.Sockets.TcpListener ([System.Net.IPAddress]::Loopback), $Port
$listener.Start()
$url = "http://127.0.0.1:$Port/"

try { $Host.UI.RawUI.WindowTitle = "lll 的小站 · 本地预览" } catch {}

Clear-Host
Write-Host ""
Write-Host "   lll 的小站" -ForegroundColor Magenta -NoNewline
Write-Host "  ·  本地预览已启动" -ForegroundColor White
Write-Host "   ------------------------------------------" -ForegroundColor DarkGray
Write-Host "   地址   " -ForegroundColor DarkGray -NoNewline
Write-Host $url -ForegroundColor Cyan
Write-Host "   根目录 " -ForegroundColor DarkGray -NoNewline
Write-Host $Root -ForegroundColor Gray
$imgCount = @(Get-ChildItem -LiteralPath $ImageDir -File -ErrorAction SilentlyContinue | Where-Object { $ImageExt -contains $_.Extension.ToLower() }).Count
Write-Host "   图片   " -ForegroundColor DarkGray -NoNewline
Write-Host "$imgCount 张（新增图片后刷新网页即可）" -ForegroundColor Gray
Write-Host "   退出   " -ForegroundColor DarkGray -NoNewline
Write-Host "在这个窗口按 Ctrl + C，或直接关掉窗口" -ForegroundColor Gray
Write-Host "   ------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

if (-not $NoBrowser) {
  Start-Sleep -Milliseconds 250
  try { Start-Process $url | Out-Null } catch { Write-Log "无法自动打开浏览器，请手动访问上面的地址" 'Yellow' }
}

$buffer = New-Object byte[] 16384
$script:running = $true
try {
  [Console]::add_CancelKeyPress([ConsoleCancelEventHandler]{
    param($sender, $e)
    $e.Cancel = $true
    $script:running = $false
    try { $listener.Stop() } catch {}
  })
} catch {}

while ($script:running) {
  $client = $null
  try {
    $client = $listener.AcceptTcpClient()
    $client.ReceiveTimeout = 8000
    $stream = $client.GetStream()

    # 浏览器经常先建立闲置连接（preconnect）却不发请求；
    # 等 400ms 还没有数据就直接丢掉，避免堵住后面真正要图的请求。
    $waitUntil = [DateTime]::UtcNow.AddMilliseconds(400)
    while ($client.Available -eq 0 -and [DateTime]::UtcNow -lt $waitUntil) {
      Start-Sleep -Milliseconds 5
    }
    if ($client.Available -eq 0) { $client.Close(); continue }

    # ---- 读取请求头 ----
    $sb = New-Object System.Text.StringBuilder
    $headerEnd = -1
    while ($headerEnd -lt 0) {
      $read = $stream.Read($buffer, 0, $buffer.Length)
      if ($read -le 0) { break }
      [void]$sb.Append([System.Text.Encoding]::ASCII.GetString($buffer, 0, $read))
      $headerEnd = $sb.ToString().IndexOf("`r`n`r`n")
      if ($sb.Length -gt 65536) { break }
    }
    if ($headerEnd -lt 0) { $client.Close(); continue }

    $rawHeader = $sb.ToString()
    $lines = $rawHeader -split "`r`n"
    $requestLine = $lines[0]
    $parts = $requestLine -split ' '
    if ($parts.Count -lt 2) { $client.Close(); continue }
    $method = $parts[0].ToUpperInvariant()
    $target = $parts[1]

    # 收集需要的请求头
    $headers = @{}
    for ($i = 1; $i -lt $lines.Count; $i++) {
      $idx = $lines[$i].IndexOf(':')
      if ($idx -gt 0) {
        $k = $lines[$i].Substring(0, $idx).Trim().ToLowerInvariant()
        $headers[$k] = $lines[$i].Substring($idx + 1).Trim()
      }
    }

    $headOnly = ($method -eq 'HEAD')
    $pathOnly = $target.Split('?')[0]
    $query = ''
    if ($target.Contains('?')) { $query = $target.Substring($target.IndexOf('?') + 1) }

    if ($method -ne 'GET' -and $method -ne 'HEAD') {
      Send-Text -Stream $stream -Status 405 -StatusText 'Method Not Allowed' -Text 'Only GET / HEAD' -HeadOnly $false
      $client.Close(); continue
    }

    $decoded = [System.Uri]::UnescapeDataString($pathOnly)
    $status = 200
    $label = $decoded

    if ($decoded -eq '/' -or $decoded -eq '') {
      $decoded = '/index.html'
    }

    if ($decoded -eq '/api/images') {
      Send-Json -Stream $stream -Object (Get-ImageManifest) -HeadOnly $headOnly
      $label = '/api/images'
    }
    elseif ($decoded -eq '/api/openfolder') {
      $site = $headers['sec-fetch-site']
      if ($site -and $site -ne 'same-origin' -and $site -ne 'none') {
        Send-Text -Stream $stream -Status 403 -StatusText 'Forbidden' -Text 'blocked cross-site request' -HeadOnly $headOnly
        $status = 403
      } else {
        try {
          Start-Process explorer.exe -ArgumentList $ImageDir | Out-Null
          Send-Json -Stream $stream -Object @{ ok = $true; folder = $ImageDir } -HeadOnly $headOnly
        } catch {
          Send-Text -Stream $stream -Status 500 -StatusText 'Error' -Text 'cannot open explorer' -HeadOnly $headOnly
          $status = 500
        }
      }
    }
    elseif ($decoded -eq '/favicon.ico') {
      Send-Response -Stream $stream -Status 204 -StatusText 'No Content' -ContentType 'image/x-icon' -Body (New-Object byte[] 0) -HeadOnly $headOnly -Cache 'public, max-age=86400'
      $status = 204
    }
    else {
      $rel = $decoded.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
      if ([string]::IsNullOrWhiteSpace($rel)) { $rel = 'index.html' }
      $candidate = $null
      try {
        $candidate = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($RootFull, $rel))
      } catch { $candidate = $null }

      if (-not $candidate -or -not $candidate.StartsWith($RootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Send-NotFound -Stream $stream -HeadOnly $headOnly
        $status = 404
      }
      elseif ((Test-Path -LiteralPath $candidate -PathType Container)) {
        $indexPath = Join-Path $candidate 'index.html'
        if (Test-Path -LiteralPath $indexPath) {
          $bytes = [System.IO.File]::ReadAllBytes($indexPath)
          Send-Response -Stream $stream -Status 200 -StatusText 'OK' -ContentType 'text/html; charset=utf-8' -Body $bytes -HeadOnly $headOnly
        } else {
          Send-NotFound -Stream $stream -HeadOnly $headOnly
          $status = 404
        }
      }
      elseif (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
        Send-NotFound -Stream $stream -HeadOnly $headOnly
        $status = 404
      }
      else {
        $ext = [System.IO.Path]::GetExtension($candidate).ToLowerInvariant()
        if ($ServeExt -notcontains $ext) {
          Send-Text -Stream $stream -Status 403 -StatusText 'Forbidden' -Text 'file type not served' -HeadOnly $headOnly
          $status = 403
        } else {
          $bytes = [System.IO.File]::ReadAllBytes($candidate)
          $total = $bytes.Length
          $ctype = $MimeTypes[$ext]
          if (-not $ctype) { $ctype = 'application/octet-stream' }
          $cache = 'no-cache'
          if ($ext -eq '.png' -or $ext -eq '.jpg' -or $ext -eq '.jpeg' -or $ext -eq '.webp' -or $ext -eq '.gif' -or $ext -eq '.svg' -or $ext -eq '.ico' -or $ext -eq '.mp3' -or $ext -eq '.m4a' -or $ext -eq '.flac' -or $ext -eq '.ogg' -or $ext -eq '.wav') {
            $cache = 'public, max-age=600'
          }

          # Range 支持：音频拖动进度、浏览器分段加载都靠它
          $rangeHeader = $headers['range']
          $handledRange = $false
          if ($rangeHeader -and $total -gt 0 -and $rangeHeader -match '^bytes=(\d*)-(\d*)$') {
            $fromRaw = $Matches[1]
            $toRaw = $Matches[2]
            $start = [int64]0
            $end = [int64]($total - 1)
            $ok = $true
            if ($fromRaw -eq '') {
              if ($toRaw -eq '') { $ok = $false }
              else {
                $suffix = [int64]$toRaw
                if ($suffix -le 0) { $ok = $false }
                else {
                  if ($suffix -gt $total) { $suffix = $total }
                  $start = $total - $suffix
                }
              }
            } else {
              $start = [int64]$fromRaw
              if ($toRaw -ne '') { $end = [int64]$toRaw }
              if ($end -ge $total) { $end = $total - 1 }
              if ($start -gt $end -or $start -ge $total) { $ok = $false }
            }
            if (-not $ok) {
              Send-Response -Stream $stream -Status 416 -StatusText 'Range Not Satisfiable' -ContentType 'text/plain; charset=utf-8' -Body (New-Object byte[] 0) -HeadOnly $headOnly -ContentRange "bytes */$total"
              $status = 416
              $handledRange = $true
            } else {
              $length = [int]($end - $start + 1)
              $slice = New-Object byte[] $length
              [System.Array]::Copy($bytes, $start, $slice, 0, $length)
              Send-Response -Stream $stream -Status 206 -StatusText 'Partial Content' -ContentType $ctype -Body $slice -HeadOnly $headOnly -Cache $cache -ContentRange "bytes $start-$end/$total"
              $status = 206
              $handledRange = $true
            }
          }
          if (-not $handledRange) {
            Send-Response -Stream $stream -Status 200 -StatusText 'OK' -ContentType $ctype -Body $bytes -HeadOnly $headOnly -Cache $cache
          }
        }
      }
    }

    $color = if ($status -ge 400) { 'DarkYellow' } elseif ($status -eq 204) { 'DarkGray' } else { 'DarkGray' }
    $shown = $label
    if ($shown.Length -gt 72) { $shown = $shown.Substring(0, 69) + '...' }
    Write-Host ("  {0}  {1} {2}  {3}" -f (Get-Date).ToString('HH:mm:ss'), $status, $method.PadRight(4), $shown) -ForegroundColor $color
  }
  catch {
    # 客户端提前断开、端口被占用等都不影响继续服务
    try {
      if ($client -and $client.Connected) {
        $s = $client.GetStream()
        Send-Text -Stream $s -Status 500 -StatusText 'Internal Error' -Text 'server error' -HeadOnly $false
      }
    } catch {}
  }
  finally {
    if ($client) { try { $client.Close() } catch {} }
  }
}

try { $listener.Stop() } catch {}
Write-Host ""
Write-Log "服务已停止，这个窗口可以直接关掉了。" 'DarkGray'
