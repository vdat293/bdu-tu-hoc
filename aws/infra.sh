#!/usr/bin/env bash
# =============================================================================
# BDU TỰ HỌC - HẠ TẦNG AWS (EC2 + VPC + EIP + DLM)
#
#   ./aws/infra.sh check     # kiểm môi trường + credentials + tài nguyên hiện có
#   ./aws/infra.sh deploy    # dựng hạ tầng (idempotent, an toàn chạy lại)
#   ./aws/infra.sh status    # in IP công khai, ID tài nguyên, lệnh ssh
#   ./aws/infra.sh ssh       # mở SSH vào máy (user deploy)
#   ./aws/infra.sh cleanup   # chuyển sang ./aws/cleanup.sh (xoá sạch)
#
# Kiến trúc dựng ra (xem spec docs/superpowers/specs/2026-10-13-dung-server-aws-design.md):
#   VPC 10.20.0.0/16 -> public subnet 10.20.1.0/24 -> IGW (KHÔNG NAT Gateway)
#   EC2 t3a.small, Ubuntu 24.04, gp3 30 GB mã hoá, IMDSv2 required, swap 2 GB
#   SG: 22/80/443 từ 0.0.0.0/0; KHÔNG mở 3000/5432
#   Elastic IP tĩnh; DLM snapshot hằng ngày giữ 7 bản
#
# Ghi chú Windows/Git Bash (giống aws-script/lab01.sh):
#   - AWS CLI v2 trên Windows xuất CRLF -> wrapper aws()/aws_np() lọc \r.
#   - MSYS tự đổi tham số bắt đầu bằng "/" thành đường dẫn Windows -> dùng
#     aws_np() (đặt MSYS_NO_PATHCONV) cho các lệnh có đường dẫn kiểu Linux.
# =============================================================================
set -Eeuo pipefail
export AWS_PAGER=""

REGION="${AWS_REGION:-ap-southeast-1}"
export AWS_DEFAULT_REGION="$REGION"
P="bdu-tu-hoc"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$DIR/infra.state"
KEY_PATH="${KEY_PATH:-$DIR/bdu-tu-hoc-deploy.pem}"
APP_DIR="${APP_DIR:-/opt/bdu-tu-hoc}"
AZ="${AZ:-ap-southeast-1a}"
KNOWN_HOSTS="$DIR/known_hosts"

aws()    { command aws "$@" | tr -d '\r'; }
aws_np() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' command aws "$@" | tr -d '\r'; }

log()  { printf '\033[1;34m[infra]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m[ OK ]\033[0m %s\n' "$*"; }

# --- state file (chứa ID tài nguyên; đã gitignore) ---------------------------
setstate() {
  local k="$1" v="$2" tmp="$STATE.tmp"
  touch "$STATE"
  grep -v "^${k}=" "$STATE" > "$tmp" 2>/dev/null || true
  mv "$tmp" "$STATE"
  printf '%s=%s\n' "$k" "$v" >> "$STATE"
}
load() {
  [[ -f "$STATE" ]] || { warn "Chưa có $STATE - chạy ./aws/infra.sh deploy trước."; return 0; }
  set +u
  # shellcheck disable=SC1090
  source <(tr -d '\r' < "$STATE")
  set -u
}

# --- tiện ích Windows --------------------------------------------------------
winpath() { command -v cygpath >/dev/null 2>&1 && cygpath -w "$1" || printf '%s' "$1"; }

fix_key_perms() {
  chmod 600 "$KEY_PATH" 2>/dev/null || true
  if command -v icacls >/dev/null 2>&1; then
    local wp user
    wp="$(winpath "$KEY_PATH")"
    user="${USERNAME:-${USER:-}}"
    if [[ -n "$user" ]]; then
      icacls "$wp" /inheritance:r /grant:r "${user}:R" >/dev/null 2>&1 || true
    fi
  fi
}

ssh_opts() {
  printf '%s' "-i $KEY_PATH -o StrictHostKeyChecking=accept-new -o UserKnownHostsFile=$KNOWN_HOSTS -o BatchMode=yes -o ConnectTimeout=10"
}

# =============================================================================
# check
# =============================================================================
cmd_check() {
  log "Kiểm môi trường..."
  command -v aws >/dev/null 2>&1 || die "Không tìm thấy 'aws' (AWS CLI v2)."
  command -v ssh >/dev/null 2>&1 || die "Không tìm thấy 'ssh'."

  log "AWS identity:"
  aws sts get-caller-identity || die "Không gọi được AWS API (kiểm credentials)."
  log "Region: $REGION"

  local n
  n="$(aws ec2 describe-instances --query 'length(Reservations[].Instances[])' --output text 2>/dev/null || echo '?')"
  log "EC2 instance hiện có:        $n"
  n="$(aws ec2 describe-volumes --query 'length(Volumes)' --output text 2>/dev/null || echo '?')"
  log "EBS volume hiện có:          $n"
  n="$(aws ec2 describe-addresses --query 'length(Addresses)' --output text 2>/dev/null || echo '?')"
  log "Elastic IP hiện có:          $n"
  n="$(aws ec2 describe-security-groups --query 'length(SecurityGroups)' --output text 2>/dev/null || echo '?')"
  log "Security Group hiện có:      $n"
  n="$(aws ec2 describe-vpcs --query 'length(Vpcs)' --output text 2>/dev/null || echo '?')"
  log "VPC hiện có:                 $n"
  n="$(aws ec2 describe-key-pairs --query 'length(KeyPairs)' --output text 2>/dev/null || echo '?')"
  log "Key pair hiện có:            $n"
  ok "check xong."
}

# =============================================================================
# deploy
# =============================================================================
ensure_vpc() {
  if [[ -n "${VPC_ID:-}" ]] && aws ec2 describe-vpcs --vpc-ids "$VPC_ID" >/dev/null 2>&1; then
    log "VPC đã có: $VPC_ID"; return 0
  fi
  log "Tạo VPC 10.20.0.0/16..."
  VPC_ID="$(aws ec2 create-vpc --cidr-block 10.20.0.0/16 \
    --tag-specifications "ResourceType=vpc,Tags=[{Key=Name,Value=$P-vpc},{Key=Project,Value=$P}]" \
    --query 'Vpc.VpcId' --output text)"
  aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames
  setstate VPC_ID "$VPC_ID"
  ok "VPC_ID=$VPC_ID"
}

ensure_subnet() {
  if [[ -n "${SUBNET_ID:-}" ]] && aws ec2 describe-subnets --subnet-ids "$SUBNET_ID" >/dev/null 2>&1; then
    log "Subnet đã có: $SUBNET_ID"; return 0
  fi
  log "Tạo subnet public 10.20.1.0/24 tại $AZ..."
  SUBNET_ID="$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block 10.20.1.0/24 \
    --availability-zone "$AZ" \
    --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$P-public-$AZ},{Key=Project,Value=$P}]" \
    --query 'Subnet.SubnetId' --output text)"
  setstate SUBNET_ID "$SUBNET_ID"
  ok "SUBNET_ID=$SUBNET_ID"
}

ensure_igw_rt() {
  if [[ -z "${IGW_ID:-}" ]] || ! aws ec2 describe-internet-gateways --internet-gateway-ids "$IGW_ID" >/dev/null 2>&1; then
    log "Tạo Internet Gateway..."
    IGW_ID="$(aws ec2 create-internet-gateway \
      --tag-specifications "ResourceType=internet-gateway,Tags=[{Key=Name,Value=$P-igw},{Key=Project,Value=$P}]" \
      --query 'InternetGateway.InternetGatewayId' --output text)"
    aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
    setstate IGW_ID "$IGW_ID"
    ok "IGW_ID=$IGW_ID"
  else
    log "Internet Gateway đã có: $IGW_ID"
  fi

  if [[ -z "${RT_ID:-}" ]] || ! aws ec2 describe-route-tables --route-table-ids "$RT_ID" >/dev/null 2>&1; then
    log "Tạo route table public..."
    RT_ID="$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
      --tag-specifications "ResourceType=route-table,Tags=[{Key=Name,Value=$P-rt-public},{Key=Project,Value=$P}]" \
      --query 'RouteTable.RouteTableId' --output text)"
    aws ec2 create-route --route-table-id "$RT_ID" --destination-cidr-block 0.0.0.0/0 --gateway-id "$IGW_ID" >/dev/null
    aws ec2 associate-route-table --route-table-id "$RT_ID" --subnet-id "$SUBNET_ID" >/dev/null
    setstate RT_ID "$RT_ID"
    ok "RT_ID=$RT_ID"
  else
    log "Route table đã có: $RT_ID"
  fi
}

ensure_sg() {
  if [[ -n "${SG_ID:-}" ]] && aws ec2 describe-security-groups --group-ids "$SG_ID" >/dev/null 2>&1; then
    log "Security Group đã có: $SG_ID"; return 0
  fi
  log "Tạo Security Group (22/80/443)..."
  SG_ID="$(aws ec2 create-security-group --group-name "$P-sg" \
    --description "bdu-tu-hoc: SSH + HTTP + HTTPS" --vpc-id "$VPC_ID" \
    --tag-specifications "ResourceType=security-group,Tags=[{Key=Name,Value=$P-sg},{Key=Project,Value=$P}]" \
    --query 'GroupId' --output text)"
  aws ec2 authorize-security-group-ingress --group-id "$SG_ID" --ip-permissions \
    'IpProtocol=tcp,FromPort=22,ToPort=22,IpRanges=[{CidrIp=0.0.0.0/0,Description=SSH}]' \
    'IpProtocol=tcp,FromPort=80,ToPort=80,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTP}]' \
    'IpProtocol=tcp,FromPort=443,ToPort=443,IpRanges=[{CidrIp=0.0.0.0/0,Description=HTTPS}]'
  setstate SG_ID "$SG_ID"
  ok "SG_ID=$SG_ID"
}

keypair_name() { printf '%s-deploy' "$P"; }
keypair_pub()  { printf '%s.pub' "$KEY_PATH"; }

ensure_keypair() {
  local name; name="$(keypair_name)"

  if aws ec2 describe-key-pairs --key-names "$name" >/dev/null 2>&1 && [[ -f "$KEY_PATH" ]]; then
    log "Key pair đã có: $name ($KEY_PATH)"
    KEY_NAME="$name"; setstate KEY_NAME "$name"; setstate KEY_PATH "$KEY_PATH"
    fix_key_perms
    return 0
  fi

  # Key pair đã có trên AWS NHƯNG thiếu file private cục bộ: KHÔNG được im lặng
  # sinh key mới (sẽ lệch với key pair của instance -> mất đường SSH).
  if aws ec2 describe-key-pairs --key-names "$name" >/dev/null 2>&1 && [[ ! -f "$KEY_PATH" ]]; then
    die "Key pair '$name' đã có trên AWS nhưng thiếu file private '$KEY_PATH'. Khôi phục file đó, HOẶC xoá key pair trên AWS rồi chạy lại (lưu ý: instance đang chạy dùng key cũ nên sẽ mất đường SSH tới nó)."
  fi

  # Sinh key CỤC BỘ rồi import public key lên AWS. Cách này tránh phụ thuộc
  # định dạng private key mà CreateKeyPair trả về (RSA = PKCS#1, ed25519 =
  # OpenSSH) và luôn có .pub để nhét vào user-data.
  if [[ ! -f "$KEY_PATH" ]]; then
    log "Sinh key ed25519 cục bộ..."
    ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "$name" >/dev/null
  fi
  if [[ ! -f "$(keypair_pub)" ]]; then
    ssh-keygen -y -f "$KEY_PATH" > "$(keypair_pub)"
  fi
  fix_key_perms

  if ! aws ec2 describe-key-pairs --key-names "$name" >/dev/null 2>&1; then
    log "Import public key lên AWS..."
    aws_np ec2 import-key-pair --key-name "$name" \
      --public-key-material "fileb://$(winpath "$(keypair_pub)")" \
      --tag-specifications "ResourceType=key-pair,Tags=[{Key=Project,Value=$P}]" >/dev/null
  fi

  KEY_NAME="$name"
  setstate KEY_NAME "$name"
  setstate KEY_PATH "$KEY_PATH"
  ok "KEY_PATH=$KEY_PATH"
}

ensure_instance() {
  if [[ -n "${INSTANCE_ID:-}" ]] && aws ec2 describe-instances --instance-ids "$INSTANCE_ID" >/dev/null 2>&1; then
    log "Instance đã có: $INSTANCE_ID"; return 0
  fi

  log "Lấy AMI Ubuntu 24.04 mới nhất..."
  local ami
  ami="$(aws_np ssm get-parameter \
    --name /aws/service/canonical/ubuntu/server/24.04/stable/current/amd64/hvm/ebs-gp3/ami-id \
    --query 'Parameter.Value' --output text)"
  [[ -n "$ami" ]] || die "Không lấy được AMI từ SSM public parameter."
  log "AMI: $ami"

  log "Sinh user-data (thay placeholder, lọc CR, chuyển ASCII)..."
  local pub_file tmp_ud
  pub_file="$(keypair_pub)"
  [[ -f "$pub_file" ]] || ssh-keygen -y -f "$KEY_PATH" > "$pub_file"
  tmp_ud="$DIR/user-data.generated.sh"
  # AWS CLI trên Windows decode paramfile theo encoding hệ thống, không phải
  # UTF-8 -> file có dấu tiếng Việt sẽ lỗi "text contents could not be decoded".
  # Vì vậy bản GỬI LÊN chỉ chứa ASCII; comment mất dấu, phần thực thi không đổi.
  if command -v iconv >/dev/null 2>&1; then
    tr -d '\r' < "$DIR/user-data.sh" \
      | sed "s|__DEPLOY_PUBLIC_KEY__|$(cat "$pub_file")|" \
      | sed "s|__APP_DIR__|$APP_DIR|" \
      | iconv -f UTF-8 -t ASCII//TRANSLIT//IGNORE > "$tmp_ud"
  else
    tr -d '\r' < "$DIR/user-data.sh" \
      | sed "s|__DEPLOY_PUBLIC_KEY__|$(cat "$pub_file")|" \
      | sed "s|__APP_DIR__|$APP_DIR|" \
      | LC_ALL=C tr -cd '\11\12\15\40-\176' > "$tmp_ud"
  fi
  local ud_win
  ud_win="$(winpath "$tmp_ud")"

  log "Tạo EC2 t3a.small (gp3 30 GB, IMDSv2 required)..."
  INSTANCE_ID="$(aws_np ec2 run-instances \
    --image-id "$ami" \
    --instance-type t3a.small \
    --key-name "$KEY_NAME" \
    --subnet-id "$SUBNET_ID" \
    --security-group-ids "$SG_ID" \
    --metadata-options 'HttpTokens=required,HttpPutResponseHopLimit=1,HttpEndpoint=enabled' \
    --block-device-mappings '[{"DeviceName":"/dev/sda1","Ebs":{"VolumeSize":30,"VolumeType":"gp3","DeleteOnTermination":true,"Encrypted":true}}]' \
    --user-data "file://$ud_win" \
    --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$P-app},{Key=Project,Value=$P}]" \
                       "ResourceType=volume,Tags=[{Key=Name,Value=$P-root},{Key=Project,Value=$P}]" \
    --query 'Instances[0].InstanceId' --output text)"
  setstate INSTANCE_ID "$INSTANCE_ID"
  ok "INSTANCE_ID=$INSTANCE_ID"

  log "Chờ instance running..."
  aws ec2 wait instance-running --instance-ids "$INSTANCE_ID"
}

ensure_eip() {
  if [[ -n "${EIP_ALLOC_ID:-}" ]] && aws ec2 describe-addresses --allocation-ids "$EIP_ALLOC_ID" >/dev/null 2>&1; then
    log "Elastic IP đã có: $EIP_PUBLIC_IP ($EIP_ALLOC_ID)"
  else
    log "Cấp Elastic IP..."
    EIP_ALLOC_ID="$(aws ec2 allocate-address --domain vpc \
      --tag-specifications "ResourceType=elastic-ip,Tags=[{Key=Name,Value=$P-eip},{Key=Project,Value=$P}]" \
      --query 'AllocationId' --output text)"
    setstate EIP_ALLOC_ID "$EIP_ALLOC_ID"
  fi
  EIP_PUBLIC_IP="$(aws ec2 describe-addresses --allocation-ids "$EIP_ALLOC_ID" --query 'Addresses[0].PublicIp' --output text)"
  setstate EIP_PUBLIC_IP "$EIP_PUBLIC_IP"
  local assoc
  assoc="$(aws ec2 describe-addresses --allocation-ids "$EIP_ALLOC_ID" --query 'Addresses[0].AssociationId' --output text)"
  if [[ -z "$assoc" || "$assoc" == "None" ]]; then
    aws ec2 associate-address --allocation-id "$EIP_ALLOC_ID" --instance-id "$INSTANCE_ID" >/dev/null
    ok "Đã gắn EIP $EIP_PUBLIC_IP vào $INSTANCE_ID"
  else
    log "EIP đã gắn: $EIP_PUBLIC_IP"
  fi
}

ensure_dlm() {
  if [[ -n "${DLM_POLICY_ID:-}" ]] \
     && aws dlm get-lifecycle-policies --policy-ids "$DLM_POLICY_ID" --query "Policies[0].PolicyId" --output text 2>/dev/null | grep -q .; then
    log "DLM policy đã có: $DLM_POLICY_ID"; return 0
  fi
  log "Tạo IAM role cho DLM..."
  local role="$P-dlm-role"
  if ! aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    aws iam create-role --role-name "$role" \
      --assume-role-policy-document '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Principal":{"Service":"dlm.amazonaws.com"},"Action":"sts:AssumeRole"}]}' \
      --tags "Key=Project,Value=$P" >/dev/null
    aws iam attach-role-policy --role-name "$role" \
      --policy-arn arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole
  fi
  local role_arn tmp_policy
  role_arn="$(aws iam get-role --role-name "$role" --query 'Role.Arn' --output text)"

  log "Tạo DLM lifecycle policy..."
  tmp_policy="$DIR/dlm-input.generated.json"
  sed "s|__DLM_ROLE_ARN__|$role_arn|" "$DIR/dlm-policy.json" | tr -d '\r' > "$tmp_policy"
  DLM_POLICY_ID="$(aws_np dlm create-lifecycle-policy \
    --cli-input-json "file://$(winpath "$tmp_policy")" \
    --query 'PolicyId' --output text)"
  setstate DLM_POLICY_ID "$DLM_POLICY_ID"
  ok "DLM_POLICY_ID=$DLM_POLICY_ID"
}

wait_cloud_init() {
  log "Chờ cloud-init hoàn tất trên $EIP_PUBLIC_IP..."
  local i
  for i in $(seq 1 60); do
    # shellcheck disable=SC2046
    if ssh $(ssh_opts) "deploy@$EIP_PUBLIC_IP" 'test -f /var/lib/cloud/instance/boot-finished && docker compose version >/dev/null 2>&1 && sudo swapon --show | grep -q swap' >/dev/null 2>&1; then
      ok "cloud-init xong."
      return 0
    fi
    sleep 10
  done
  die "cloud-init chưa xong sau 10 phút. Kiểm /var/log/cloud-init-output.log trên máy."
}

cmd_deploy() {
  load
  cmd_check
  ensure_vpc
  ensure_subnet
  ensure_igw_rt
  ensure_sg
  ensure_keypair
  ensure_instance
  ensure_eip
  ensure_dlm
  log "Chờ instance-status-ok..."
  aws ec2 wait instance-status-ok --instance-ids "$INSTANCE_ID"
  wait_cloud_init
  echo
  cmd_status
}

# =============================================================================
# status / ssh
# =============================================================================
cmd_status() {
  load
  [[ -n "${INSTANCE_ID:-}" ]] || die "Chưa có hạ tầng. Chạy ./aws/infra.sh deploy."
  local ip st
  ip="$EIP_PUBLIC_IP"
  st="$(aws ec2 describe-instances --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].State.Name' --output text)"
  log "INSTANCE_ID : $INSTANCE_ID ($st)"
  log "VPC_ID      : ${VPC_ID:-?}"
  log "SUBNET_ID   : ${SUBNET_ID:-?}"
  log "SG_ID       : ${SG_ID:-?}"
  log "EIP         : $ip"
  log "DLM policy  : ${DLM_POLICY_ID:-?}"
  log "Key         : ${KEY_PATH:-?}"
  log "SSH         : ssh -i $KEY_PATH deploy@$ip"
  log "URL         : https://sv.bdu.io.vn  (sau khi trỏ DNS + cài cert)"
}

cmd_ssh() {
  load
  [[ -n "${EIP_PUBLIC_IP:-}" ]] || die "Chưa có EIP. Chạy ./aws/infra.sh deploy."
  # shellcheck disable=SC2046
  exec ssh $(ssh_opts) "deploy@$EIP_PUBLIC_IP" "$@"
}

# =============================================================================
# main
# =============================================================================
case "${1:-}" in
  check)   cmd_check ;;
  deploy)  cmd_deploy ;;
  status)  cmd_status ;;
  ssh)     shift; cmd_ssh "$@" ;;
  cleanup) shift; exec "$DIR/cleanup.sh" "$@" ;;
  *)
    cat >&2 <<EOF
Dùng: ./aws/infra.sh <lệnh>
  check     kiểm môi trường + credentials + tài nguyên hiện có
  deploy    dựng hạ tầng (idempotent)
  status    in IP + ID tài nguyên
  ssh       mở SSH vào máy (user deploy)
  cleanup   xoá sạch tài nguyên (delegates sang aws/cleanup.sh)
EOF
    exit 2
    ;;
esac
