// Pipeline regressions ported from aws-web-tut; every AWS/install command is mocked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseLabResult } from '../src/modules/learning/lab-result.js';
const bash = process.platform === 'win32' ? (existsSync('C:/Program Files/Git/bin/bash.exe') ? 'C:/Program Files/Git/bin/bash.exe' : null) : 'bash';
const urlCases = [
  ['https://example.com/guides/inf1003/', true],
  ['http://localhost:4304/guides/inf1003/', true],
  ['http://127.0.0.1/guides/inf1003/', true],
  ['http://[::1]:4304/guides/inf1003/', true],
  ['http://100.69.225.60:4304/guides/inf1003/', true],
  ['http://100.64.0.0/guides/inf1003/', true],
  ['http://100.127.255.255/guides/inf1003/', true],
  ...['100.63.255.255', '100.128.0.0', '100.69.225.60.evil.test', '100.69.225.60@evil.test', 'example.com'].map(host => [`http://${host}/guides/inf1003/`, false]),
  ['https://user:pass@example.com/guides/inf1003/', false],
  ['file:///tmp/lab/', false]
];
function removeTestDirectory(root) {
  assert.equal(dirname(resolve(root)), resolve(tmpdir()));
  assert.match(basename(root), /^bdu-(?:mac-pipeline|local-result|local-pipeline)-/);
  rmSync(root, { recursive: true, force: true });
}

test('macOS downloader accepts Tailscale and rejects lookalike/public HTTP URLs', { skip: !bash }, () => {
  const quote = value => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
  const source = `source ${quote(resolve('public/guides/inf1003/scripts/start-aws-local.sh'))}\n` + urlCases.map(([url, allowed]) => `if is_lab_url ${quote(url)}; then actual=1; else actual=0; fi\n[ "$actual" = "${allowed ? 1 : 0}" ] || { echo ${quote('Wrong URL policy: ' + url)}; exit 1; }`).join('\n');
  const run = spawnSync(bash, ['-s'], { input: source, encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test('Windows downloader accepts Tailscale and rejects lookalike/public HTTP URLs', { skip: process.platform !== 'win32' }, () => {
  const quote = value => "'" + value.replace(/'/g, "''") + "'";
  const source = `. ${quote(resolve('public/guides/inf1003/scripts/start-aws-local.ps1'))} -LabDirectory '.' -BaseUrl 'https://example.com/' -ScriptSha256 '${'a'.repeat(64)}'\n` + urlCases.map(([url, allowed]) => `if ((Test-LabDownloadUrl ([uri]${quote(url)})) -ne $${allowed}) { throw ${quote('Wrong URL policy: ' + url)} }`).join('\n');
  const run = spawnSync('powershell.exe', ['-NoProfile', '-Command', source], { encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});
test('macOS accepts the actual notarized pkgutil output and rejects altered trust evidence', { skip: !bash }, () => {
  const root = mkdtempSync(join(tmpdir(), 'bdu-mac-pipeline-'));
  const quote = value => "'" + value.replace(/\\/g, '/').replace(/'/g, "'\\''") + "'";
  try {
    const original = readFileSync('tests/fixtures/aws-cli/macos-pkgutil-notarized.txt', 'utf8');
    const cases = [
      { name: 'actual Mac output', text: original, accepted: true },
      { name: 'missing notarization', text: original.replace(/^.*Notarization:.*\n/m, ''), accepted: false },
      { name: 'untrusted notarization', text: original.replace('Notarization: trusted', 'Notarization: not trusted'), accepted: false },
      { name: 'untrusted certificate', text: original.replace('signed by a developer certificate issued by Apple for distribution', 'signed by a certificate that is not trusted'), accepted: false },
      { name: 'wrong Amazon team', text: original.replace('94KV3E626L', 'OTHERTEAM1'), accepted: false },
      { name: 'failed pkgutil', text: original, status: 1, accepted: false }
    ];
    for (const item of cases) {
      const source = `source ${quote(resolve('public/guides/inf1003/scripts/start-aws-local.sh'))}\npkgutil() { printf '%s' '${Buffer.from(item.text).toString('base64')}' | base64 -d; return ${item.status || 0}; }\nif verify_aws_installer 'mock.pkg' ${quote(join(root, 'signature.txt'))}; then accepted=yes; else accepted=no; fi\n[ "$accepted" = '${item.accepted ? 'yes' : 'no'}' ]`;
      const output = spawnSync(bash, ['-s'], { input: source, encoding: 'utf8', windowsHide: true });
      assert.equal(output.status, 0, `${item.name}: ${output.stdout}${output.stderr}`);
    }
  } finally { removeTestDirectory(root); }
});

test("macOS pipeline installs when necessary and stops on login errors (AWS and installers mocked)", { skip: !bash }, () => {
  const root = mkdtempSync(join(tmpdir(), "bdu-mac-pipeline-"));
  const shellPath = value => "'" + value.replace(/\\/g, "/").replace(/'/g, "'\\''") + "'";
  try {
    const payload = "#!/bin/bash\nprintf 'run-lab\\n' >> \"$BDU_TEST_LOG\"\n";
    const checksum = createHash("sha256").update(payload).digest("hex");
    const harness = join(root, "harness.sh");
    writeFileSync(harness, `source ${shellPath(resolve("public/guides/inf1003/scripts/start-aws-local.sh"))}
uname() { printf 'Darwin\\n'; }
BDU_TEST_AWS_INSTALLED=0
command() {
  if [ "$*" = '-v aws' ] && [ "$BDU_TEST_CASE" = not-installed ] && [ "$BDU_TEST_AWS_INSTALLED" = 0 ]; then return 1; fi
  builtin command "$@"
}
aws() {
  printf 'aws %s\\n' "$*" >> "$BDU_TEST_LOG"
  if [ "$1" = --version ]; then
    if [ "$BDU_TEST_AWS_INSTALLED" = 1 ]; then
      if [ "$BDU_TEST_CASE" = install-no-cli ]; then return 127; fi
      echo 'aws-cli/2.39.0'
    else
      case "$BDU_TEST_CASE" in
        missing-tools) echo 'aws-cli/2.31.0' ;;
        version-one) echo 'aws-cli/1.42.0' ;;
        not-installed|install-no-cli|install-fails) return 127 ;;
        signature-*) return 127 ;;
        empty-version) return 0 ;;
        malformed-version) echo 'unexpected output' ;;
        version-fails) echo 'aws-cli/2.39.0'; return 1 ;;
        *) echo 'aws-cli/2.39.0' ;;
      esac
    fi
  elif [ "$1" = login ] && [ "$BDU_TEST_CASE" = login-fails ]; then return 1; fi
}
curl() {
  local destination='' argument
  printf 'download-url %s\\n' "$*" >> "$BDU_TEST_LOG"
  while [ "$#" -gt 0 ]; do
    argument="$1"; shift
    if [ "$argument" = -o ]; then destination="$1"; shift; fi
  done
  printf 'download %s\\n' "$destination" >> "$BDU_TEST_LOG"
  if [[ "$destination" = *.pkg ]]; then printf 'MOCK INSTALLER' > "$destination"
  else printf '%s' '${Buffer.from(payload).toString("base64")}' | base64 -d > "$destination"; fi
}
pkgutil() {
  printf 'signature-check\\n' >> "$BDU_TEST_LOG"
  local status='signed by a certificate trusted by Mac OS X'
  local signer='Developer ID Installer: AMZN Mobile LLC (94KV3E626L)'
  case "$BDU_TEST_CASE" in
    signature-notarized) cat ${shellPath(resolve('tests/fixtures/aws-cli/macos-pkgutil-notarized.txt'))}; return 0 ;;
    signature-macos) status='signed by a certificate trusted by macOS' ;;
    signature-untrusted) status='signed by a certificate that is not trusted' ;;
    signature-unsigned) echo 'Status: no signature'; return 0 ;;
    signature-wrong-publisher) signer='Developer ID Installer: Other Publisher (OTHERTEAM1)' ;;
    signature-wrong-leaf)
      printf 'Status: %s\\n  1. Developer ID Installer: Other Publisher (OTHERTEAM1)\\n  2. %s\\n' "$status" "$signer"
      return 0 ;;
  esac
  printf 'Package AWSCLIV2.pkg:\\n  Status: %s\\n  Certificate Chain:\\n    1. %s\\n    2. Developer ID Certification Authority\\n    3. Apple Root CA\\n' "$status" "$signer"
  if [ "$BDU_TEST_CASE" = signature-invalid ]; then return 1; fi
}
shasum() { shift 2; sha256sum "$@"; }
sudo() {
  printf 'install-aws\\n' >> "$BDU_TEST_LOG"
  if [ "$BDU_TEST_CASE" = install-fails ]; then return 1; fi
  BDU_TEST_AWS_INSTALLED=1
}
export -f aws
base_url='https://example.com/course/'
if [ "$BDU_TEST_CASE" = tailscale ]; then base_url='http://100.69.225.60:4304/guides/inf1003/'; fi
main ${shellPath(root)} "$base_url" '${checksum}'
`);
    for (const scenario of ['existing-tools', 'missing-tools', 'version-one', 'not-installed', 'empty-version', 'malformed-version', 'version-fails', 'install-no-cli', 'install-fails', 'signature-macos', 'signature-notarized', 'signature-untrusted', 'signature-unsigned', 'signature-wrong-publisher', 'signature-wrong-leaf', 'signature-invalid', 'login-fails', 'tailscale']) {
      const log = join(root, scenario + ".log");
      const output = spawnSync(bash, [harness.replace(/\\/g, "/")], {
        env: { ...process.env, BDU_TEST_CASE: scenario, BDU_TEST_LOG: log.replace(/\\/g, "/") }, encoding: "utf8", windowsHide: true, timeout: 15000
      });
      const lines = readFileSync(log, "utf8");
      const signatureRejected = scenario.startsWith('signature-') && !['signature-macos', 'signature-notarized'].includes(scenario);
      if (['login-fails', 'install-no-cli', 'install-fails'].includes(scenario) || signatureRejected) {
        assert.notEqual(output.status, 0);
        assert.ok(!lines.includes("run-lab"));
        assert.ok(!lines.includes("aws sts"));
        if (scenario !== 'login-fails') {
          assert.equal(lines.includes('install-aws'), !signatureRejected, scenario);
          assert.ok(!lines.includes('aws login'));
        }
        if (signatureRejected) assert.ok(lines.includes('signature-check'));
      } else {
        assert.equal(output.status, 0, output.stdout + output.stderr);
        assert.ok(lines.indexOf("aws login") < lines.indexOf("aws sts"));
        assert.ok(lines.indexOf("aws sts") < lines.indexOf("run-lab"));
        assert.equal(lines.includes('install-aws'), ['missing-tools', 'version-one', 'not-installed', 'empty-version', 'malformed-version', 'version-fails', 'signature-macos', 'signature-notarized'].includes(scenario), scenario);
        if (lines.includes('install-aws')) assert.ok(lines.indexOf('signature-check') < lines.indexOf('install-aws'));
        if (scenario === 'tailscale') assert.ok(lines.includes('http://100.69.225.60:4304/guides/inf1003/scripts/01-start-cloudshell.sh'));
      }
    }
  } finally { removeTestDirectory(root); }
});

test("local result only prints its token and leaves two PEM files; CloudShell keeps recovery files", { skip: !bash }, () => {
  const root = mkdtempSync(join(tmpdir(), "bdu-local-result-"));
  try {
    const source = readFileSync("public/guides/inf1003/scripts/01-start-cloudshell.sh", "utf8");
    const resourceIds = Object.fromEntries(['VPC_ID', 'FE_SUBNET_ID', 'BE_SUBNET_ID', 'DB_SUBNET_ID', 'IGW_ID', 'RT_ID', 'EIP_ALLOC', 'NAT_ID', 'BE_RT_ID', 'DB_RT_ID', 'FE_SG_ID', 'BE_SG_ID', 'DB_SG_ID', 'FE_INSTANCE_ID', 'BE_INSTANCE_ID'].map(name => [name, 'test-id']));
    for (const mode of ['LOCAL', 'CLOUDSHELL']) {
      const directory = join(root, mode);
      mkdirSync(directory);
      for (const name of ['bdu-key-fe.pem', 'bdu-key-be.pem']) writeFileSync(join(directory, name), 'MOCK-PEM');
      const output = spawnSync(bash, ['-s'], {
        input: source.slice(0, source.indexOf('need()')) + source.slice(source.indexOf('# Luu thong tin tai nguyen tren CloudShell')),
        env: { ...process.env, ...resourceIds, BDU_BASE: directory.replace(/\\/g, '/').replace(/^([A-Za-z]):/, (_, drive) => '/' + drive.toLowerCase()), AWS_DEFAULT_REGION: 'ap-southeast-1', FE_IP: '203.0.113.10', BE_IP: '10.0.2.5', DB_ENDPOINT: 'bdu-db.example.ap-southeast-1.rds.amazonaws.com', BDU_KEY_SOURCE: mode }, encoding: 'utf8', windowsHide: true
      });
      assert.equal(output.status, 0, output.stderr);
      const token = output.stdout.match(/BDU-LAB-V1:[A-Za-z0-9+/=]+/)?.[0];
      assert.ok(token, output.stdout);
      const result = parseLabResult(token);
      assert.equal(result.KEY_SOURCE, mode === 'LOCAL' ? 'LOCAL' : undefined);
      assert.equal(result.FE_IP, '203.0.113.10');
      assert.ok(!/PRIVATE KEY|PASSWORD|SECRET/.test(JSON.stringify(result)));
      if (mode === 'LOCAL') {
        assert.deepEqual(readdirSync(directory).sort(), ['bdu-key-be.pem', 'bdu-key-fe.pem']);
      } else {
        assert.equal(readFileSync(join(directory, 'lab-result.txt'), 'utf8').trim(), token);
        assert.ok(existsSync(join(directory, 'aws-ids.env')));
        assert.ok(existsSync(join(directory, 'aws-ips.env')));
      }
    }
  } finally { removeTestDirectory(root); }
});

test("Windows pipeline installs missing tools, logs in before launch, and stops on failure (all tools mocked)", { skip: process.platform !== "win32" }, () => {
  const root = mkdtempSync(join(tmpdir(), "bdu-local-pipeline-"));
  try {
    const lab = join(root, "Năm 3 O'Brien"); mkdirSync(lab);
    const payload = "#!/bin/bash\necho TEST_ONLY\n";
    const checksum = createHash("sha256").update(payload).digest("hex");
    writeFileSync(join(root, "fake-aws.ps1"), `Add-Content -LiteralPath $env:BDU_TEST_LOG -Value ("aws " + ($args -join ' '))
if ($args[0] -eq 'login' -and $env:BDU_TEST_CASE -eq 'login-fails') { $global:LASTEXITCODE=1 } else { $global:LASTEXITCODE=0 }
`);
    writeFileSync(join(root, "fake-bash.ps1"), `if ($env:AWS_REGION -ne 'ap-southeast-1' -or $env:MSYS_NO_PATHCONV -ne '1') { throw 'missing environment' }
if ($env:AWS_ACCESS_KEY_ID) { throw 'inherited credentials must not shadow login' }
if ($env:BDU_LAB_DIRECTORY -ne $env:BDU_TEST_LAB) { throw 'wrong output path' }
if ($env:ASSUME_YES) { throw 'cleanup confirmation bypassed' }
Add-Content -LiteralPath $env:BDU_TEST_LOG -Value 'run-lab'
$global:LASTEXITCODE=0
`);
    const harness = join(root, "harness.ps1");
    writeFileSync(harness, `$baseUrl = if ($env:BDU_TEST_CASE -eq 'tailscale') { 'http://100.69.225.60:4304/guides/inf1003/' } else { 'https://example.com/course/' }
. $env:BDU_TEST_SOURCE -LabDirectory $env:BDU_TEST_LAB -BaseUrl $baseUrl -ScriptSha256 '${checksum}'
$script:awsInstalled=$false; $script:bashInstalled=$false
function Find-AwsCli { if ($env:BDU_TEST_CASE -ne 'missing-tools' -or $script:awsInstalled) { Join-Path $env:BDU_TEST_ROOT 'fake-aws.ps1' } }
function Find-GitBash { if ($env:BDU_TEST_CASE -ne 'missing-tools' -or $script:bashInstalled) { Join-Path $env:BDU_TEST_ROOT 'fake-bash.ps1' } }
function Install-AwsCli { $script:awsInstalled=$true; Add-Content $env:BDU_TEST_LOG 'install-aws' }
function Install-GitBash { $script:bashInstalled=$true; Add-Content $env:BDU_TEST_LOG 'install-bash' }
function Get-Download($Url,$Destination) {
  Add-Content $env:BDU_TEST_LOG ("download " + $Url)
  $content=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${Buffer.from(payload).toString("base64")}'))
  if ($env:BDU_TEST_CASE -eq 'bad-hash') { $content='tampered' }
  [IO.File]::WriteAllText($Destination,$content,(New-Object Text.UTF8Encoding($false)))
}
try { Invoke-LocalLab } catch { Write-Output $_; exit 1 }
if ($env:AWS_ACCESS_KEY_ID -ne 'TEST-INHERITED') { throw 'environment was not restored' }
`, "utf8");
    for (const scenario of ["existing-tools", "missing-tools", "login-fails", "bad-hash", "tailscale"]) {
      const log = join(root, scenario + ".log");
      const run = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", harness], {
        env: { ...process.env, PSModulePath: join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0", "Modules"), BDU_TEST_CASE: scenario, BDU_TEST_ROOT: root, BDU_TEST_LOG: log, BDU_TEST_LAB: lab, BDU_TEST_SOURCE: resolve("public/guides/inf1003/scripts/start-aws-local.ps1"), AWS_ACCESS_KEY_ID: "TEST-INHERITED", ASSUME_YES: "1" },
        encoding: "utf8", timeout: 30000, windowsHide: true
      });
      const output = existsSync(log) ? readFileSync(log, "utf8") : "";
      if (["login-fails", "bad-hash"].includes(scenario)) {
        assert.notEqual(run.status, 0, run.stdout + run.stderr);
        assert.ok(!output.includes("run-lab"));
        if (scenario === "login-fails") assert.ok(!output.includes("download"));
      } else {
        assert.equal(run.status, 0, run.stdout + run.stderr);
        assert.ok(output.indexOf("aws login") < output.indexOf("aws sts"));
        assert.ok(output.indexOf("aws sts") < output.indexOf("download"));
        assert.ok(output.indexOf("download") < output.indexOf("run-lab"));
        assert.equal(output.includes("install-aws"), scenario === "missing-tools");
        assert.equal(output.includes("install-bash"), scenario === "missing-tools");
        if (scenario === 'tailscale') assert.ok(output.includes('http://100.69.225.60:4304/guides/inf1003/scripts/01-start-cloudshell.sh'));
      }
    }
  } finally { removeTestDirectory(root); }
});
