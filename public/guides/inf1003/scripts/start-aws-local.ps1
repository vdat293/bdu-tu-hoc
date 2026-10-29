# Windows PowerShell 5.1+. Downloads tools and the lab script, then runs it locally.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$LabDirectory,
    [Parameter(Mandatory = $true)][uri]$BaseUrl,
    [Parameter(Mandatory = $true)][ValidatePattern('^[a-f0-9]{64}$')][string]$ScriptSha256,
    [ValidateSet('start', 'clean')][string]$Action = 'start',
    [ValidatePattern('^[a-z]{2}(-[a-z]+)+-[0-9]$')][string]$AwsRegion = 'ap-southeast-1'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-AwsCli {
    $paths = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\Amazon\AWSCLIV2\aws.exe'),
        (Join-Path $env:ProgramFiles 'Amazon\AWSCLIV2\aws.exe')
    )
    $command = Get-Command aws.exe -ErrorAction SilentlyContinue
    if ($command) { $paths += $command.Source }
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) {
            $version = & $path --version 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0 -and $version -match 'aws-cli/(\d+\.\d+\.\d+)' -and [version]$Matches[1] -ge [version]'2.32.0') { return $path }
        }
    }
}

function Find-GitBash {
    $paths = @(
        (Join-Path $env:ProgramFiles 'Git\bin\bash.exe'),
        (Join-Path $env:LOCALAPPDATA 'Programs\Git\bin\bash.exe')
    )
    $git = Get-Command git.exe -ErrorAction SilentlyContinue
    if ($git) { $paths += Join-Path (Split-Path (Split-Path $git.Source)) 'bin\bash.exe' }
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path -PathType Leaf) { return $path }
    }
}

function Test-LabDownloadUrl([uri]$Url) {
    if ($Url.UserInfo) { return $false }
    if ($Url.Scheme -eq 'https') { return $true }
    if ($Url.Scheme -ne 'http') { return $false }
    if ($Url.IsLoopback) { return $true }
    $address = $null
    if ([Net.IPAddress]::TryParse($Url.Host, [ref]$address) -and $address.AddressFamily -eq [Net.Sockets.AddressFamily]::InterNetwork) {
        $octets = $address.GetAddressBytes()
        return ($octets[0] -eq 100 -and $octets[1] -ge 64 -and $octets[1] -le 127)
    }
    return $false
}

function Get-Download([uri]$Url, [string]$Destination) {
    if (-not (Test-LabDownloadUrl $Url)) {
        throw 'Downloads require HTTPS, localhost, or a Tailscale IP address.'
    }
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
}

function Assert-SignedInstaller([string]$Path, [string]$Publisher = '') {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid') { throw "Invalid installer signature: $Path" }
    if ($Publisher -and $signature.SignerCertificate.Subject -notmatch $Publisher) {
        throw "Unexpected installer publisher: $Path"
    }
}

function Install-AwsCli([string]$TemporaryDirectory) {
    Write-Host '[1/5] Installing AWS CLI for the current Windows user...'
    $file = Join-Path $TemporaryDirectory 'AWSCLIV2-User.msi'
    Get-Download 'https://awscli.amazonaws.com/AWSCLIV2-User.msi' $file
    Assert-SignedInstaller $file 'O="?Amazon(?:\.com| Web Services)'
    $process = Start-Process msiexec.exe -ArgumentList @('/i', ('"' + $file + '"'), '/qn', '/norestart') -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -notin @(0, 3010)) { throw "AWS CLI installation failed ($($process.ExitCode))." }
}

function Install-GitBash([string]$TemporaryDirectory) {
    Write-Host '[2/5] Installing Git Bash for the current Windows user...'
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/git-for-windows/git/releases/latest'
    $asset = @($release.assets | Where-Object { $_.name -match '^Git-[0-9].*-64-bit\.exe$' })
    if ($asset.Count -ne 1 -or $asset[0].browser_download_url -notlike 'https://github.com/git-for-windows/git/releases/download/*') {
        throw 'Cannot locate the official Git for Windows installer.'
    }
    $file = Join-Path $TemporaryDirectory 'Git-setup.exe'
    Get-Download $asset[0].browser_download_url $file
    Assert-SignedInstaller $file
    $destination = Join-Path $env:LOCALAPPDATA 'Programs\Git'
    $process = Start-Process -FilePath $file -ArgumentList @('/CURRENTUSER', '/VERYSILENT', '/SUPPRESSMSGBOXES', '/NORESTART', ('/DIR="' + $destination + '"')) -WindowStyle Hidden -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw "Git Bash installation failed ($($process.ExitCode))." }
}

function Invoke-LocalLab {
    if (-not (Test-LabDownloadUrl $BaseUrl)) { throw 'The lab URL requires HTTPS, localhost, or a Tailscale IP address.' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Windows 64-bit is required.' }
    $directory = (Resolve-Path -LiteralPath $LabDirectory).ProviderPath
    if (-not (Test-Path -LiteralPath $directory -PathType Container)) { throw 'The lab directory does not exist.' }
    if ($directory -match '[\r\n]' -or $directory -match '[%!]') { throw 'The lab path must not contain %, !, or a newline.' }
    $temporaryDirectory = Join-Path ([IO.Path]::GetTempPath()) ('bdu-local-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null
    $environmentNames = @('PATH', 'AWS_PROFILE', 'AWS_REGION', 'AWS_DEFAULT_REGION', 'AWS_PAGER', 'AWS_CLI_AUTO_PROMPT', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN', 'MSYS_NO_PATHCONV', 'BDU_KEY_SOURCE', 'BDU_LAB_DIRECTORY', 'BDU_LAB_SCRIPT', 'ASSUME_YES')
    $originalEnvironment = @{}
    foreach ($name in $environmentNames) { $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process') }
    try {
        $aws = Find-AwsCli
        if (-not $aws) { Install-AwsCli $temporaryDirectory; $aws = Find-AwsCli }
        if (-not $aws) { throw 'AWS CLI installation did not produce a supported aws.exe.' }
        $bash = Find-GitBash
        if (-not $bash) { Install-GitBash $temporaryDirectory; $bash = Find-GitBash }
        if (-not $bash) { throw 'Git Bash installation did not produce bash.exe.' }
        $env:PATH = (Split-Path $aws) + ';' + (Split-Path $bash) + ';' + $env:PATH
        $env:AWS_PROFILE = 'bdu-lab'
        $env:AWS_REGION = $AwsRegion
        $env:AWS_DEFAULT_REGION = $env:AWS_REGION
        $env:AWS_PAGER = ''
        $env:AWS_CLI_AUTO_PROMPT = 'off'
        # The signed-in profile must not be shadowed by inherited access keys.
        foreach ($name in @('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN', 'AWS_SECURITY_TOKEN')) {
            [Environment]::SetEnvironmentVariable($name, $null, 'Process')
        }
        Write-Host "[3/5] Sign in to your AWS lab account in the browser (region $AwsRegion)..."
        Write-Host 'If asked "Configure AWS MCP server connection? [Y/n]:", type n then press Enter (No).'
        Write-Host 'If asked "Configure AWS skills and the AWS MCP server for your AI coding agent(s)? [y/n/never]:", type n then press Enter (No).'
        & $aws login --profile bdu-lab --region $AwsRegion
        if ($LASTEXITCODE -ne 0) { throw 'AWS login failed. Your identity needs SignInLocalDevelopmentAccess; IAM Identity Center uses aws sso login instead.' }
        & $aws sts get-caller-identity --profile bdu-lab --region $AwsRegion
        if ($LASTEXITCODE -ne 0) { throw 'Cannot verify the signed-in account. The lab script was not started.' }
        Write-Host "[4/5] Downloading the $Action script..."
        $source = if ($Action -eq 'start') { '01-start-cloudshell.sh' } else { '03-clean-cloudshell.sh' }
        $file = Join-Path $temporaryDirectory ($Action + '-aws.sh')
        $root = [uri]($BaseUrl.AbsoluteUri.TrimEnd('/') + '/')
        Get-Download ([uri]::new($root, ('scripts/' + $source))) $file
        if ((Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() -ne $ScriptSha256) {
            throw 'The downloaded script differs from this page. Reload the tutorial and copy the command again.'
        }
        # Keep Unicode paths in environment variables, not a generated shell program.
        $env:MSYS_NO_PATHCONV = '1'
        $env:BDU_KEY_SOURCE = 'LOCAL'
        $env:BDU_LAB_DIRECTORY = $directory
        $env:BDU_LAB_SCRIPT = $file
        [Environment]::SetEnvironmentVariable('ASSUME_YES', $null, 'Process')
        $launcher = Join-Path $temporaryDirectory 'run-lab.sh'
        [IO.File]::WriteAllText($launcher, 'set -euo pipefail
export BDU_BASE="$(cygpath -u "$BDU_LAB_DIRECTORY")"
cd -- "$BDU_BASE"
exec bash "$(cygpath -u "$BDU_LAB_SCRIPT")"
', (New-Object Text.UTF8Encoding($false)))
        Write-Host "[5/5] Running $Action-aws.sh. Keys and results: $directory"
        & $bash --noprofile --norc ($launcher.Replace('\', '/'))
        if ($LASTEXITCODE -ne 0) { throw 'The AWS script failed. Fix the reported error before continuing the lesson.' }
        if ($Action -eq 'start') { Write-Host 'Copy the full BDU-LAB-V1: line above and paste it at the end of step 2. Both PEM files are already in the lab directory.' }
    } finally {
        foreach ($name in $environmentNames) { [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process') }
        # Only remove the exact temporary directory created by this invocation.
        $temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\')
        if ((Split-Path $temporaryDirectory) -ne $temporaryRoot -or (Split-Path $temporaryDirectory -Leaf) -notmatch '^bdu-local-[a-f0-9]{32}$') {
            throw 'Refusing to clean an unexpected temporary directory.'
        }
        if (Test-Path -LiteralPath $temporaryDirectory) { Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force }
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try { Invoke-LocalLab } catch { Write-Error $_; exit 1 }
}
