# Khoi dong chay-tat-ca.cmd TACH ROI khoi terminal hien tai.
#
#     powershell -ExecutionPolicy Bypass -File start-tach-roi.ps1
#
# Vi sao can: tac vu nen chay qua Claude Code (hoac qua mot cua so terminal) se chet
# khi phien do ket thuc. Luot render nay dai vai chuc gio nen phai song doc lap.
# Da gap that: tien trinh thoat ma 4 dung luc phien Claude Code truoc dong lai.
#
# Kiem tra con song:   Get-Process node -ErrorAction SilentlyContinue
# Xem tien do:         Get-Content ket-qua\chay.log -Tail 20 -Wait
# Dung lai:            Stop-Process -Name node

$thuMuc = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $thuMuc
New-Item -ItemType Directory -Force -Path (Join-Path $thuMuc 'ket-qua') | Out-Null

$dangChay = Get-Process node -ErrorAction SilentlyContinue
if ($dangChay) {
    Write-Host "Da co $($dangChay.Count) tien trinh node dang chay."
    Write-Host "Neu do la luot render cu thi khong can khoi dong lai."
    Write-Host "Muon chay moi: Stop-Process -Name node   roi chay lai file nay."
    exit 1
}

$p = Start-Process -FilePath (Join-Path $thuMuc 'chay-tat-ca.cmd') `
    -WorkingDirectory $thuMuc -WindowStyle Hidden -PassThru

Write-Host "Da khoi dong tach roi, PID = $($p.Id)"
Write-Host "Log:        $(Join-Path $thuMuc 'ket-qua\chay.log')"
Write-Host "Theo doi:   Get-Content ket-qua\chay.log -Tail 20 -Wait"
Write-Host "Bao cao:    $(Join-Path $thuMuc 'ket-qua\bao-cao.html')  (tu dung lai moi 10 anh)"
