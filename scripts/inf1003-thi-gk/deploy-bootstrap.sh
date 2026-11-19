#!/usr/bin/env bash
set -euo pipefail
umask 077

fail() { printf '%s\n' "$*" >&2; exit 1; }

setup_aws_path() {
  local location candidate user_bin="${XDG_BIN_HOME:-$HOME/.local/bin}"
  case "$(uname -s)" in
    Darwin) PATH="/usr/local/bin:/opt/homebrew/bin:$user_bin:$PATH" ;;
    MINGW*|MSYS*|CYGWIN*)
      for location in "${PROGRAMFILES:-${ProgramFiles:-}}" "${LOCALAPPDATA:-}"; do
        [[ -n $location ]] || continue
        for candidate in "$location/Amazon/AWSCLIV2" "$location/Programs/Amazon/AWSCLIV2"; do
          if [[ -x $candidate/aws.exe ]]; then
            PATH="$(cygpath -u "$candidate"):$PATH"
          fi
        done
      done ;;
    *) PATH="$user_bin:$PATH" ;;
  esac
  export PATH
  hash -r
}

ensure_aws_cli() {
  # Hai hàm kiểm tra phiên bản và chữ ký lấy từ bootstrap macOS của Bài 1.
  source "$BUNDLE_DIR/aws-check.sh"
  setup_aws_path
  if aws_cli_ready; then return; fi

  printf 'Đang cài hoặc cập nhật AWS CLI để chạy aws login…\n'
  case "$(uname -s)" in
    Darwin)
      curl -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 2 \
        'https://awscli.amazonaws.com/AWSCLIV2.pkg' --output "$BUNDLE_DIR/AWSCLIV2.pkg"
      verify_aws_installer "$BUNDLE_DIR/AWSCLIV2.pkg" "$BUNDLE_DIR/aws-signature.txt" ||
        fail 'Không xác minh được chữ ký bộ cài AWS CLI.'
      printf 'macOS có thể hỏi mật khẩu quản trị để cài AWS CLI.\n'
      sudo installer -pkg "$BUNDLE_DIR/AWSCLIV2.pkg" -target / ||
        fail 'Cài AWS CLI thất bại.' ;;
    Linux)
      curl -q --fail --silent --show-error --location --proto '=https' --proto-redir '=https' --retry 2 \
        'https://awscli.amazonaws.com/v2/install.sh' --output "$BUNDLE_DIR/aws-install.sh"
      bash "$BUNDLE_DIR/aws-install.sh" || fail 'Cài AWS CLI thất bại.' ;;
    MINGW*|MSYS*|CYGWIN*)
      powershell.exe -NoProfile -ExecutionPolicy Bypass \
        -File "$(cygpath -w "$BUNDLE_DIR/aws-install.ps1")" \
        -TemporaryDirectory "$(cygpath -w "$BUNDLE_DIR")" || fail 'Cài AWS CLI thất bại.' ;;
    *) fail 'Hệ điều hành này cần cài AWS CLI v2.32.0 trở lên trước.' ;;
  esac
  setup_aws_path
  aws_cli_ready || fail 'Chưa tìm thấy AWS CLI v2.32.0 trở lên sau khi cài.'
}

main() {
  local temp_root decode_flag=-d
  temp_root=$(cd -- "${TMPDIR:-/tmp}" && pwd -P)
  BUNDLE_DIR=$(mktemp -d "$temp_root/thi-gk-bundle.XXXXXXXX")
  [[ $BUNDLE_DIR == "$temp_root"/thi-gk-bundle.* ]] || fail 'Đường dẫn thư mục tạm không hợp lệ.'
  trap 'rm -rf -- "$BUNDLE_DIR"' EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  if [[ $(uname -s) == Darwin ]]; then decode_flag=-D; fi
  read_bundle "$decode_flag" | tar -xzf - -C "$BUNDLE_DIR"

  export THI_GK_PROJECT_DIR=${THI_GK_PROJECT_DIR:-$PWD}
  ensure_aws_cli
  bash "$BUNDLE_DIR/deploy.sh" "$@"
}
