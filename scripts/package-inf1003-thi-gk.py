#!/usr/bin/env python3
"""Package private INF1003 payloads from a reviewed thi-gk source directory."""

import argparse
import base64
import gzip
import io
import tarfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BOOTSTRAP = ROOT / "scripts/inf1003-thi-gk/deploy-bootstrap.sh"
GUIDE_SCRIPTS = ROOT / "public/guides/inf1003/scripts"
SOURCE_DIR = "three-tier+s3/three-tier+s3"
SOURCE_FILES = (
    "backend/.dockerignore", "backend/Dockerfile", "backend/docker-compose.yml",
    "backend/main.py", "backend/requirements.txt", "db/init.sql",
    "frontend/.dockerignore", "frontend/Dockerfile", "frontend/app.js",
    "frontend/backend-url.sh", "frontend/docker-compose.yml", "frontend/index.html",
    "frontend/nginx.conf", "frontend/style.css",
)
IMAGE_TYPES = {".jpg", ".jpeg", ".png", ".gif", ".webp", ".avif", ".bmp"}
MAX_PAYLOAD_BYTES = 16 * 1024 * 1024


def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Unexpected thi-gk source near {old.splitlines()[0]!r}")
    return text.replace(old, new, 1)


def section(text, first, after):
    start = text.index(first)
    return text[start:text.index(after, start + len(first))]


def read_text(path):
    return path.read_text(encoding="utf-8-sig")


def source_file(root, relative):
    resolved = (root / relative).resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError(f"Invalid input path: {relative}")
    return resolved


def prepare_clean(text, setup_path):
    text = replace_once(
        text, 'PROJECT_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)',
        'PROJECT_DIR=$(cd -- "${THI_GK_PROJECT_DIR:-$(dirname -- "${BASH_SOURCE[0]}")}" && pwd -P)',
    )
    text = replace_once(text, "prepare() {\n", setup_path + "prepare() {\n  setup_aws_path\n")
    text = replace_once(text, """  local args=()
  if [[ ${THI_GK_REMOTE_LOGIN:-0} == 1 ]]; then args+=(--remote); fi
  printf 'Mở phiên aws login mới. Chọn đúng tài khoản trong trình duyệt.\\n'
  aws_cli login "${args[@]}" || die 'aws login thất bại. Lệnh này cần AWS CLI v2.32.0 trở lên.'""",
        """  printf 'Mở phiên aws login mới. Chọn đúng tài khoản trong trình duyệt.\\n'
  if [[ ${THI_GK_REMOTE_LOGIN:-0} == 1 ]]; then
    aws_cli login --remote || die 'aws login thất bại. Cần AWS CLI v2.32.0 trở lên.'
  else
    aws_cli login || die 'aws login thất bại. Cần AWS CLI v2.32.0 trở lên.'
  fi""",
    )
    text = replace_once(text, """  elif [[ -d $path ]]; then
    chmod 700 -- "$path"
  else
    chmod 600 -- "$path"
  fi""",
        """  else
    # BSD chmod treats arguments after the mode as paths.
    [[ $path == /* ]] || path="./$path"
    if [[ -d $path ]]; then
      chmod 700 "$path"
    else
      chmod 600 "$path"
    fi
  fi""",
    )
    return replace_once(text, """  local state
  [[ -f $STATE_FILE ]] || die 'Không tìm thấy lần triển khai trong thi-gk.'
  mapfile -t state < "$STATE_FILE"
  [[ ${#state[@]} == 4""",
        """  local line state_count=0
  local state=()
  [[ -f $STATE_FILE ]] || die 'Không tìm thấy lần triển khai trong thi-gk.'
  while IFS= read -r line || [[ -n $line ]]; do
    state+=("$line")
    state_count=$((state_count + 1))
    if [[ $state_count -gt 4 ]]; then break; fi
  done < "$STATE_FILE"
  [[ $state_count == 4""",
    )


def prepare_deploy(text):
    text = replace_once(
        text,
        'source "$(dirname -- "${BASH_SOURCE[0]}")/clean.sh"',
        'bundle_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)\nsource "$bundle_root/clean.sh"',
    )
    text = replace_once(text, 'SOURCE="$PROJECT_DIR/three-tier+s3/three-tier+s3"', 'SOURCE="$bundle_root/three-tier+s3/three-tier+s3"')
    text = replace_once(text, 'IMAGES="$PROJECT_DIR/anh"', 'IMAGES="$bundle_root/anh"')
    text = replace_once(text, "  local -A statuses=()\n", "")
    text = replace_once(text, """  while read -r code status; do
    if [[ -n $code ]]; then statuses[$code]=$status; fi
  done <<< "$rows"
""", "")
    text = replace_once(text, "    status=${statuses[$code]:-}", '''    status=$(awk -v region="$code" '$1 == region { print $2; exit }' <<< "$rows")''')
    text = replace_once(text, """    if [[ ! $code =~ ^[a-z]{2}(-[a-z0-9]+)+-[0-9]+$ || -z ${statuses[$code]:-} ]]; then""",
        """    status=$(awk -v region="$code" '$1 == region { print $2; exit }' <<< "$rows")
    if [[ ! $code =~ ^[a-z]{2}(-[a-z0-9]+)+-[0-9]+$ || -z $status ]]; then""",
    )
    text = replace_once(text, "    elif [[ ${statuses[$code]} == not-opted-in ]]; then", "    elif [[ $status == not-opted-in ]]; then")
    return text.replace("bash deploy.sh", "bash start-gk.sh").replace("bash clean.sh", "key Xóa tài nguyên")


def windows_installer():
    guide = read_text(GUIDE_SCRIPTS / "start-aws-local.ps1")
    installer = section(guide, "function Assert-SignedInstaller(", "function Install-GitBash(")
    return """param([Parameter(Mandatory=$true)][string]$TemporaryDirectory)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Get-Download([uri]$Url, [string]$Destination) {
    if ($Url.Scheme -ne 'https' -or $Url.Host -ne 'awscli.amazonaws.com') {
        throw 'The installer must come from the official AWS CLI host over HTTPS.'
    }
    Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Destination
}
""" + installer + "Install-AwsCli $TemporaryDirectory\n"


def pack_deploy(bootstrap, files):
    archive = io.BytesIO()
    with tarfile.open(fileobj=archive, mode="w") as tar:
        directory = tarfile.TarInfo("anh")
        directory.type = tarfile.DIRTYPE
        directory.mode = 0o700
        tar.addfile(directory)
        for name, data in sorted(files.items()):
            file = tarfile.TarInfo(name)
            file.size = len(data)
            file.mode = 0o600
            tar.addfile(file, io.BytesIO(data))
    encoded = base64.encodebytes(gzip.compress(archive.getvalue(), mtime=0)).decode("ascii")
    return (
        bootstrap + "\nread_bundle() {\n  base64 \"$1\" <<'THI_GK_BUNDLE'\n"
        + encoded + 'THI_GK_BUNDLE\n}\n\nmain "$@"\n'
    ).encode("utf-8")


def package(source, output):
    bootstrap = read_text(BOOTSTRAP)
    setup_path = section(bootstrap, "setup_aws_path() {", "ensure_aws_cli() {")
    mac_guide = read_text(GUIDE_SCRIPTS / "start-aws-local.sh")
    mac_check = section(mac_guide, "aws_cli_ready() {", "is_lab_url() {")
    clean = prepare_clean(read_text(source_file(source, "clean.sh")), setup_path).encode("utf-8")
    deploy = prepare_deploy(read_text(source_file(source, "deploy.sh"))).encode("utf-8")
    files = {
        "deploy.sh": deploy, "clean.sh": clean,
        "aws-check.sh": mac_check.encode("utf-8"),
        "aws-install.ps1": windows_installer().encode("utf-8-sig"),
    }
    for name in SOURCE_FILES:
        relative = f"{SOURCE_DIR}/{name}"
        files[relative] = read_text(source_file(source, relative)).encode("utf-8")
    images = (source / "anh").resolve(strict=True)
    if not images.is_relative_to(source) or not images.is_dir():
        raise ValueError("Invalid image directory")
    for image in images.rglob("*"):
        if image.suffix.lower() in IMAGE_TYPES and image.is_file():
            relative = image.relative_to(source).as_posix()
            files[relative] = source_file(source, relative).read_bytes()
    payload = pack_deploy(bootstrap, files)
    if len(payload) > MAX_PAYLOAD_BYTES:
        raise ValueError("Deployment payload exceeds the API's 16 MiB limit")
    output.mkdir(parents=True, exist_ok=True)
    (output / "deploy.sh").write_bytes(payload)
    (output / "clean.sh").write_bytes(clean)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path, help="Private thi-gk directory")
    parser.add_argument("output", type=Path, help="Separate directory for private payloads")
    args = parser.parse_args()
    source, output = args.source.resolve(strict=True), args.output.resolve()
    if output.is_relative_to(source):
        parser.error("Output must be outside the thi-gk source directory.")
    package(source, output)


if __name__ == "__main__":
    main()
