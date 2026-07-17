# 大商所 API 凭证录入（不依赖外部编辑器）
# 运行: powershell -File scripts/setup-dce-creds-gui.ps1
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = '大商所 API 凭证'
$form.Size = New-Object System.Drawing.Size(520, 260)
$form.StartPosition = 'CenterScreen'
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'
$form.MaximizeBox = $false

$lbl1 = New-Object System.Windows.Forms.Label
$lbl1.Text = 'API key（门户点「复制」后粘贴）'
$lbl1.Location = New-Object System.Drawing.Point(20, 20)
$lbl1.AutoSize = $true
$form.Controls.Add($lbl1)

$tbKey = New-Object System.Windows.Forms.TextBox
$tbKey.Location = New-Object System.Drawing.Point(20, 45)
$tbKey.Size = New-Object System.Drawing.Size(460, 28)
$form.Controls.Add($tbKey)

$lbl2 = New-Object System.Windows.Forms.Label
$lbl2.Text = 'API secret（完整粘贴，含 & ^ %）'
$lbl2.Location = New-Object System.Drawing.Point(20, 85)
$lbl2.AutoSize = $true
$form.Controls.Add($lbl2)

$tbSecret = New-Object System.Windows.Forms.TextBox
$tbSecret.Location = New-Object System.Drawing.Point(20, 110)
$tbSecret.Size = New-Object System.Drawing.Size(460, 28)
$form.Controls.Add($tbSecret)

$btnOk = New-Object System.Windows.Forms.Button
$btnOk.Text = '保存并验证'
$btnOk.Location = New-Object System.Drawing.Point(280, 160)
$btnOk.Size = New-Object System.Drawing.Size(120, 32)
$btnOk.DialogResult = [System.Windows.Forms.DialogResult]::OK
$form.AcceptButton = $btnOk
$form.Controls.Add($btnOk)

$btnCancel = New-Object System.Windows.Forms.Button
$btnCancel.Text = '取消'
$btnCancel.Location = New-Object System.Drawing.Point(410, 160)
$btnCancel.Size = New-Object System.Drawing.Size(70, 32)
$btnCancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
$form.CancelButton = $btnCancel
$form.Controls.Add($btnCancel)

$result = $form.ShowDialog()
if ($result -ne [System.Windows.Forms.DialogResult]::OK) {
  Write-Host '已取消'
  exit 1
}

$key = $tbKey.Text.Trim()
$secret = $tbSecret.Text.Trim()
if (-not $key -or -not $secret) {
  Write-Host 'key/secret 不能为空'
  exit 1
}

$credsPath = Join-Path $PSScriptRoot '..\tmp\dce-creds.txt'
New-Item -ItemType Directory -Force -Path (Split-Path $credsPath) | Out-Null
Set-Content -Path $credsPath -Value (@($key, $secret) -join "`n") -Encoding UTF8
Write-Host "已写入 $credsPath"

$root = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $root
node scripts/set-dce-portal-creds.js --file tmp/dce-creds.txt
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
node scripts/_verify-dce-portal-api.js
exit $LASTEXITCODE
