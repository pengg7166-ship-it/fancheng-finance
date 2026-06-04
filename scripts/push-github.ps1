# 首次推送到 GitHub（需先在 https://github.com/new 创建空仓库 fancheng-finance）
# 用法：.\scripts\push-github.ps1 -GitHubUser 你的GitHub用户名

param(
  [Parameter(Mandatory = $true)]
  [string]$GitHubUser,
  [string]$RepoName = 'fancheng-finance'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path | Split-Path -Parent
Set-Location $root

$remote = "https://github.com/$GitHubUser/$RepoName.git"
$exists = git remote get-url origin 2>$null
if ($LASTEXITCODE -ne 0) {
  git remote add origin $remote
  Write-Host "Added remote: $remote"
} else {
  git remote set-url origin $remote
  Write-Host "Updated remote: $remote"
}

git branch -M main
git push -u origin main
Write-Host "Done. Repo: https://github.com/$GitHubUser/$RepoName"
