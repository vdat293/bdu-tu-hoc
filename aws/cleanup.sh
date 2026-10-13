#!/usr/bin/env bash
# =============================================================================
# BDU TỰ HỌC - XOÁ SẠCH HẠ TẦNG AWS
#
#   ./aws/cleanup.sh          # có hỏi xác nhận
#   ./aws/cleanup.sh --yes    # không hỏi
#
# Xoá theo đúng thứ tự phụ thuộc (xoá ngược thứ tự tạo):
#   EC2 -> Elastic IP -> snapshot -> volume -> DLM policy -> IAM role
#   -> Security Group -> route table -> subnet -> IGW -> VPC -> key pair
#
# Idempotent: chạy lại nhiều lần vẫn an toàn. Có retry cho DependencyViolation
# (AWS đôi khi trả lỗi này vài giây sau khi vừa xoá tài nguyên con).
# Log ghi vào aws/cleanup-log.txt.
#
# LƯU Ý: DLM snapshot KHÔNG tự mất khi xoá EC2. Nếu muốn giữ bản snapshot để
# khôi phục sau, chạy với SKIP_SNAPSHOTS=1.
# =============================================================================
set -Eeuo pipefail
export AWS_PAGER=""

REGION="${AWS_REGION:-ap-southeast-1}"
export AWS_DEFAULT_REGION="$REGION"
P="bdu-tu-hoc"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$DIR/infra.state"
LOG="$DIR/cleanup-log.txt"

ASSUME_YES=0
[[ "${1:-}" == "--yes" ]] && ASSUME_YES=1

aws()    { command aws "$@" | tr -d '\r'; }
aws_np() { MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' command aws "$@" | tr -d '\r'; }

log()  { printf '\033[1;34m[cleanup]\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[WARN]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[1;31m[ERROR]\033[0m %s\n' "$*" >&2; exit 1; }
ok()   { printf '\033[1;32m[ OK ]\033[0m %s\n' "$*"; }

# Ghi log ra file (không màu) song song với stdout.
exec > >(tee >(sed -u 's/\x1b\[[0-9;]*m//g' >> "$LOG")) 2>&1

load() {
  [[ -f "$STATE" ]] || { warn "Không có $STATE - sẽ dò tài nguyên theo tag $P."; return 0; }
  set +u
  # shellcheck disable=SC1090
  source <(tr -d '\r' < "$STATE")
  set -u
}

# Thử lại vài lần cho các lệnh xoá dễ gặp DependencyViolation.
retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    if [[ $n -ge 6 ]]; then
      warn "Thất bại sau $n lần: $*"
      return 1
    fi
    sleep 10
  done
}

confirm() {
  if [[ "$ASSUME_YES" == "1" ]]; then return 0; fi
  printf 'Xoá SẠCH hạ tầng %s ở %s? Gõ "yes" để tiếp tục: ' "$P" "$REGION"
  read -r a
  [[ "$a" == "yes" ]] || { echo "Đã huỷ."; exit 0; }
}

# -----------------------------------------------------------------------------
# 1. EC2
# -----------------------------------------------------------------------------
del_instances() {
  local ids
  ids="$(aws ec2 describe-instances \
    --filters "Name=tag:Project,Values=$P" "Name=instance-state-name,Values=pending,running,stopping,stopped" \
    --query 'Reservations[].Instances[].InstanceId' --output text 2>/dev/null || true)"
  [[ -z "$ids" || "$ids" == "None" ]] && { log "Không còn EC2."; return 0; }
  log "Terminate EC2: $ids"
  # shellcheck disable=SC2086
  aws ec2 terminate-instances --instance-ids $ids >/dev/null
  # shellcheck disable=SC2086
  aws ec2 wait instance-terminated --instance-ids $ids
  ok "Đã xoá EC2."
}

# -----------------------------------------------------------------------------
# 2. Elastic IP
# -----------------------------------------------------------------------------
del_eips() {
  local allocs
  allocs="$(aws ec2 describe-addresses --query 'Addresses[].AllocationId' --output text 2>/dev/null || true)"
  [[ -z "$allocs" || "$allocs" == "None" ]] && { log "Không còn Elastic IP."; return 0; }
  local id
  for id in $allocs; do
    log "Release EIP $id"
    retry aws ec2 release-address --allocation-id "$id" >/dev/null || true
  done
  ok "Đã release Elastic IP."
}

# -----------------------------------------------------------------------------
# 3. Snapshot (DLM tạo, mang tag Project)
# -----------------------------------------------------------------------------
del_snapshots() {
  if [[ "${SKIP_SNAPSHOTS:-0}" == "1" ]]; then
    warn "SKIP_SNAPSHOTS=1 -> giữ nguyên snapshot."
    return 0
  fi
  local snaps
  snaps="$(aws ec2 describe-snapshots --owner-ids self \
    --filters "Name=tag:Project,Values=$P" \
    --query 'Snapshots[].SnapshotId' --output text 2>/dev/null || true)"
  [[ -z "$snaps" || "$snaps" == "None" ]] && { log "Không còn snapshot."; return 0; }
  local s
  for s in $snaps; do
    log "Xoá snapshot $s"
    aws ec2 delete-snapshot --snapshot-id "$s" >/dev/null || true
  done
  ok "Đã xoá snapshot."
}

# -----------------------------------------------------------------------------
# 4. EBS volume mồ côi
# -----------------------------------------------------------------------------
del_volumes() {
  local vols
  vols="$(aws ec2 describe-volumes \
    --filters "Name=tag:Project,Values=$P" "Name=status,Values=available" \
    --query 'Volumes[].VolumeId' --output text 2>/dev/null || true)"
  [[ -z "$vols" || "$vols" == "None" ]] && { log "Không còn volume mồ côi."; return 0; }
  local v
  for v in $vols; do
    log "Xoá volume $v"
    retry aws ec2 delete-volume --volume-id "$v" >/dev/null || true
  done
  ok "Đã xoá volume."
}

# -----------------------------------------------------------------------------
# 5. DLM policy
# -----------------------------------------------------------------------------
del_dlm() {
  local ids
  ids="$(aws dlm get-lifecycle-policies --query 'Policies[].PolicyId' --output text 2>/dev/null || true)"
  [[ -z "$ids" || "$ids" == "None" ]] && { log "Không còn DLM policy."; return 0; }
  local id
  for id in $ids; do
    log "Xoá DLM policy $id"
    aws dlm delete-lifecycle-policy --policy-id "$id" >/dev/null || true
  done
  ok "Đã xoá DLM policy."
}

# -----------------------------------------------------------------------------
# 6. IAM role
# -----------------------------------------------------------------------------
del_iam() {
  local role="$P-dlm-role"
  if aws iam get-role --role-name "$role" >/dev/null 2>&1; then
    log "Xoá IAM role $role"
    aws iam detach-role-policy --role-name "$role" \
      --policy-arn arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole >/dev/null 2>&1 || true
    aws iam delete-role --role-name "$role" >/dev/null || true
    ok "Đã xoá IAM role."
  else
    log "Không còn IAM role."
  fi
}

# -----------------------------------------------------------------------------
# 7-11. Security Group, route table, subnet, IGW, VPC
# -----------------------------------------------------------------------------
del_network() {
  local sg_ids sub_ids rt_ids igw_ids vpc_ids

  sg_ids="$(aws ec2 describe-security-groups --filters "Name=tag:Project,Values=$P" \
    --query 'SecurityGroups[].GroupId' --output text 2>/dev/null || true)"
  if [[ -n "$sg_ids" && "$sg_ids" != "None" ]]; then
    local sg
    for sg in $sg_ids; do
      log "Xoá Security Group $sg"
      retry aws ec2 delete-security-group --group-id "$sg" >/dev/null || true
    done
  fi

  vpc_ids="$(aws ec2 describe-vpcs --filters "Name=tag:Project,Values=$P" \
    --query 'Vpcs[].VpcId' --output text 2>/dev/null || true)"
  if [[ -z "$vpc_ids" || "$vpc_ids" == "None" ]]; then
    log "Không còn VPC của $P."
    return 0
  fi

  local vpc
  for vpc in $vpc_ids; do
    sub_ids="$(aws ec2 describe-subnets --filters "Name=vpc-id,Values=$vpc" --query 'Subnets[].SubnetId' --output text)"
    rt_ids="$(aws ec2 describe-route-tables --filters "Name=vpc-id,Values=$vpc" --query 'RouteTables[].RouteTableId' --output text)"
    igw_ids="$(aws ec2 describe-internet-gateways --filters "Name=attachment.vpc-id,Values=$vpc" --query 'InternetGateways[].InternetGatewayId' --output text)"

    local rt
    for rt in $rt_ids; do
      # Bỏ qua route table main (không xoá được).
      local main
      main="$(aws ec2 describe-route-tables --route-table-ids "$rt" \
        --query 'RouteTables[0].Associations[?Main==`true`].RouteTableId' --output text)"
      [[ -n "$main" && "$main" != "None" ]] && continue
      local assoc
      assoc="$(aws ec2 describe-route-tables --route-table-ids "$rt" \
        --query 'RouteTables[0].Associations[].RouteTableAssociationId' --output text)"
      local a
      for a in $assoc; do
        [[ -n "$a" && "$a" != "None" ]] && aws ec2 disassociate-route-table --association-id "$a" >/dev/null 2>&1 || true
      done
      log "Xoá route table $rt"
      retry aws ec2 delete-route-table --route-table-id "$rt" >/dev/null || true
    done

    local igw
    for igw in $igw_ids; do
      log "Detach + xoá IGW $igw"
      aws ec2 detach-internet-gateway --internet-gateway-id "$igw" --vpc-id "$vpc" >/dev/null 2>&1 || true
      retry aws ec2 delete-internet-gateway --internet-gateway-id "$igw" >/dev/null || true
    done

    local sub
    for sub in $sub_ids; do
      log "Xoá subnet $sub"
      retry aws ec2 delete-subnet --subnet-id "$sub" >/dev/null || true
    done

    log "Xoá VPC $vpc"
    retry aws ec2 delete-vpc --vpc-id "$vpc" >/dev/null || true
  done
  ok "Đã xoá mạng."
}

# -----------------------------------------------------------------------------
# 12. Key pair + file cục bộ
# -----------------------------------------------------------------------------
del_keypair() {
  local name="$P-deploy"
  if aws ec2 describe-key-pairs --key-names "$name" >/dev/null 2>&1; then
    log "Xoá key pair $name"
    aws ec2 delete-key-pair --key-name "$name" >/dev/null || true
  fi
  rm -f "$DIR/$name.pem" "$DIR/$name.pem.pub" 2>/dev/null || true
  ok "Đã dọn key pair."
}

main() {
  log "Dọn hạ tầng $P tại $REGION"
  confirm
  load
  del_instances
  del_eips
  del_snapshots
  del_volumes
  del_dlm
  del_iam
  del_network
  del_keypair
  rm -f "$STATE"
  ok "XONG. Kiểm lại bằng: ./aws/infra.sh check"
  log "Nếu còn sót do tagging API trễ, chạy lại sau vài phút."
}

main "$@"
