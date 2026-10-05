# Stiahne nové verzie appky Odkiaľ Kam z GitHub Releases (vlado-obona/mhdPO)
# do priečinka v OneDrive. Už stiahnuté súbory preskočí, takže sa dá spúšťať
# opakovane (napr. raz denne cez Plánovač úloh).
#
# Ručné spustenie:  pravý klik na súbor -> Spustiť v prostredí PowerShell
param(
  [string]$Ciel = 'C:\Users\shuks\OneDrive\Dokumenty\Operator\MHD Prešov'
)
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$repo = 'vlado-obona/mhdPO'
$hdr  = @{ 'User-Agent' = 'odkialkam-stiahni-verzie' }

if (-not (Test-Path $Ciel)) { New-Item -ItemType Directory -Force -Path $Ciel | Out-Null }
$nove = 0
$verzie = Invoke-RestMethod "https://api.github.com/repos/$repo/releases?per_page=20" -Headers $hdr
foreach ($v in $verzie) {
  $dir = Join-Path $Ciel $v.tag_name
  foreach ($s in $v.assets) {
    $f = Join-Path $dir $s.name
    if ((Test-Path $f) -and ((Get-Item $f).Length -eq $s.size)) { continue }
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    Write-Host "Sťahujem $($v.tag_name)\$($s.name) ..."
    Invoke-WebRequest $s.browser_download_url -OutFile $f -Headers $hdr -UseBasicParsing
    $nove++
  }
}
Invoke-WebRequest "https://raw.githubusercontent.com/$repo/main/releases/CHANGELOG.txt" `
  -OutFile (Join-Path $Ciel 'CHANGELOG.txt') -Headers $hdr -UseBasicParsing
if ($nove -eq 0) { Write-Host 'Všetky verzie už máš stiahnuté.' }
else { Write-Host "Hotovo — stiahnutých súborov: $nove (priečinok $Ciel)." }
