$ErrorActionPreference='Stop'
$base='c:\Users\user\Desktop\HabitTracker'
$backupDir=Join-Path $base 'backups'
if(!(Test-Path $backupDir)){
  New-Item -ItemType Directory -Path $backupDir | Out-Null
}
$ts=Get-Date -Format 'yyyyMMdd_HHmmss'
$items=@('index_fixed.html','script.js','style.css','privacy.html','TODO.md')

# Copy (separate commands)
Copy-Item -LiteralPath (Join-Path $base 'index_fixed.html') -Destination (Join-Path $backupDir ('index_fixed.html.bak.'+$ts)) -Force
Copy-Item -LiteralPath (Join-Path $base 'script.js') -Destination (Join-Path $backupDir ('script.js.bak.'+$ts)) -Force
Copy-Item -LiteralPath (Join-Path $base 'style.css') -Destination (Join-Path $backupDir ('style.css.bak.'+$ts)) -Force
Copy-Item -LiteralPath (Join-Path $base 'privacy.html') -Destination (Join-Path $backupDir ('privacy.html.bak.'+$ts)) -Force
Copy-Item -LiteralPath (Join-Path $base 'TODO.md') -Destination (Join-Path $backupDir ('TODO.md.bak.'+$ts)) -Force

# Verify (individual checks)
$f1='index_fixed.html.bak.'+$ts
$f2='script.js.bak.'+$ts
$f3='style.css.bak.'+$ts
$f4='privacy.html.bak.'+$ts
$f5='TODO.md.bak.'+$ts

$ok1=Test-Path (Join-Path $backupDir $f1)
$ok2=Test-Path (Join-Path $backupDir $f2)
$ok3=Test-Path (Join-Path $backupDir $f3)
$ok4=Test-Path (Join-Path $backupDir $f4)
$ok5=Test-Path (Join-Path $backupDir $f5)

Write-Output ('BACKUP_DIR='+$backupDir)
Write-Output ('TIMESTAMP='+$ts)
Write-Output ('index_fixed.html backup exists: '+$ok1)
Write-Output ('script.js backup exists: '+$ok2)
Write-Output ('style.css backup exists: '+$ok3)
Write-Output ('privacy.html backup exists: '+$ok4)
Write-Output ('TODO.md backup exists: '+$ok5)

Write-Output 'BACKUP_FILENAMES:'
Write-Output $f1
Write-Output $f2
Write-Output $f3
Write-Output $f4
Write-Output $f5

