#!/usr/bin/env bash
# macOS bootstrap: bash start-aws-local.sh LAB_DIRECTORY BASE_URL SHA256 [start|clean] [region]
set -euo pipefail
umask 077

fail() { echo "LOI: $*" >&2; exit 1; }
aws_cli_ready() {
  local version
  command -v aws >/dev/null 2>&1 || return 1
  version=$(aws --version 2>/dev/null) || return 1
  [[ "$version" =~ ^aws-cli/([0-9]+)\.([0-9]+)\.([0-9]+)([[:space:]]|$) ]] || return 1
  (( 10#${BASH_REMATCH[1]} > 2 || (10#${BASH_REMATCH[1]} == 2 && 10#${BASH_REMATCH[2]} >= 32) ))
}
verify_aws_installer() {
  local package="$1" report="$2"
  if ! LC_ALL=C pkgutil --check-signature "$package" > "$report" 2>&1; then
    cat "$report" >&2
    return 1
  fi
  # Amazon's Developer ID Installer team, verified from the official PKG.
  # Its current certificate is named AMZN Mobile LLC, not Amazon Web Services.
  if ! grep -Eq '^[[:space:]]*1[.][[:space:]]+Developer ID Installer: .+ [(]94KV3E626L[)][[:space:]]*$' "$report"; then
    cat "$report" >&2
    return 1
  fi
  if grep -Eq '^[[:space:]]*Status: signed by a certificate trusted by (Mac OS X|macOS)[[:space:]]*$' "$report" || {
    grep -Eq '^[[:space:]]*Status: signed by a developer certificate issued by Apple for distribution[[:space:]]*$' "$report" &&
    grep -Eq '^[[:space:]]*Notarization: trusted by the Apple notary service[[:space:]]*$' "$report"
  }; then
    return 0
  fi
  cat "$report" >&2
  return 1
}
is_lab_url() {
  local url="$1" scheme authority
  [[ "$url" =~ ^(https?)://([^/?#]+)(/[^?#]*)?$ ]] || return 1
  scheme="${BASH_REMATCH[1]}"
  authority="${BASH_REMATCH[2]}"
  [[ "$authority" != *@* ]] || return 1
  [ "$scheme" = https ] && return 0
  [[ "$authority" =~ ^(localhost|127\.0\.0\.1|\[::1\])(:[0-9]+)?$ ]] && return 0
  # Tailscale IPv4: 100.64.0.0/10. Match the whole authority, never a DNS suffix.
  [[ "$authority" =~ ^100\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})(:[0-9]+)?$ ]] || return 1
  (( 10#${BASH_REMATCH[1]} >= 64 && 10#${BASH_REMATCH[1]} <= 127 && 10#${BASH_REMATCH[2]} <= 255 && 10#${BASH_REMATCH[3]} <= 255 ))
}
main() {
  [ "$#" -ge 3 ] && [ "$#" -le 5 ] || fail 'Can duong dan lab, URL website, SHA256, action va region.'
  [ "$(uname -s)" = Darwin ] || fail 'Script nay danh cho macOS; Windows dung start-aws-local.ps1.'
  local lab_dir="$1" base_url="${2%/}" checksum="$3" action="${4:-start}" region="${5:-ap-southeast-1}" source temp_dir
  case "$action" in start|clean) ;; *) fail 'Action phai la start hoac clean.' ;; esac
  [[ "$region" =~ ^[a-z]{2}(-[a-z]+)+-[0-9]$ ]] || fail "Region khong hop le: $region."
  is_lab_url "$base_url" || fail 'URL website phai dung HTTPS, localhost hoac IP Tailscale.'
  [[ "$checksum" =~ ^[a-f0-9]{64}$ ]] || fail 'SHA256 khong hop le.'
  [ -d "$lab_dir" ] || fail 'Thu muc lab chua ton tai.'
  export BDU_BASE="$(cd -- "$lab_dir" && pwd -P)"
  temp_dir=$(mktemp -d)
  BDU_BOOTSTRAP_TEMP="$temp_dir"
  trap 'rm -rf -- "$BDU_BOOTSTRAP_TEMP"' EXIT
  export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.local/bin:$PATH"
  hash -r
  if ! aws_cli_ready; then
    echo '[1/4] Cai/cap nhat AWS CLI. macOS co the hoi mat khau quan tri...'
    curl --fail --location --proto '=https' --retry 2 'https://awscli.amazonaws.com/AWSCLIV2.pkg' -o "$temp_dir/AWSCLIV2.pkg"
    verify_aws_installer "$temp_dir/AWSCLIV2.pkg" "$temp_dir/signature.txt" || fail 'Khong xac minh duoc chu ky bo cai AWS. Xem ket qua kiem tra chu ky o tren.'
    sudo installer -pkg "$temp_dir/AWSCLIV2.pkg" -target / || fail 'Cai AWS CLI that bai. Kiem tra thong bao bo cai va quyen quan tri o tren.'
    hash -r
  fi
  aws_cli_ready || fail 'AWS CLI chua chay duoc hoac chua dat ban 2.32.0 sau khi cai. Kiem tra bo cai va duong dan lenh aws.'
  export AWS_PROFILE=bdu-lab AWS_REGION="$region" AWS_DEFAULT_REGION="$region" AWS_PAGER='' AWS_CLI_AUTO_PROMPT=off
  unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN AWS_SECURITY_TOKEN ASSUME_YES
  echo "[2/4] Dang nhap tai khoan AWS lab tren trinh duyet (region $region)..."
  aws login --profile bdu-lab --region "$region" || fail 'Dang nhap that bai. Can quyen SignInLocalDevelopmentAccess; IAM Identity Center dung aws sso login.'
  aws sts get-caller-identity --profile bdu-lab --region "$region"
  echo '[3/4] Tai script bai lab...'
  if [ "$action" = start ]; then source=01-start-cloudshell.sh; else source=03-clean-cloudshell.sh; fi
  curl --fail --location --retry 2 "$base_url/scripts/$source" -o "$temp_dir/$action-aws.sh"
  [ "$(shasum -a 256 "$temp_dir/$action-aws.sh" | awk '{print $1}')" = "$checksum" ] || fail 'Script da thay doi. Tai lai trang huong dan va copy lenh moi.'
  export BDU_KEY_SOURCE=LOCAL
  cd -- "$BDU_BASE"
  echo "[4/4] Chay $action-aws.sh. Key va ket qua luu tai: $BDU_BASE"
  bash "$temp_dir/$action-aws.sh"
  if [ "$action" = start ]; then echo 'Copy toan bo dong BDU-LAB-V1: o tren, dan vao o cuoi buoc 2. Hai file PEM da nam trong thu muc bai lab.'; fi
}

if [[ "${BASH_SOURCE[0]}" = "$0" ]]; then main "$@"; fi
