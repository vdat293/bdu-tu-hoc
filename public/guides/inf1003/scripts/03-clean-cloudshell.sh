#!/usr/bin/env bash
# 03-clean-cloudshell.sh - Xoa ha tang bai 1 (cac tai nguyen bdu-*) trong AWS CloudShell.
# Chay: bash 03-clean-cloudshell.sh
#       ASSUME_YES=1 bash 03-clean-cloudshell.sh   # khong hoi xac nhan
# Chi xoa tai nguyen ten/tag bdu-* trong region hien tai, theo thu tu nguoc luc tao.
# Khong dong toi tai nguyen khac cua ban va khong dong toi VPC mac dinh.
# Best-effort: loi xoa duoc bao va di tiep; loi API danh dau that bai (exit 1).
set -u

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Thieu lenh $1. Hay chay trong AWS CloudShell."; exit 1; }; }
need aws
need mktemp

FAILED=0

# Goi 1 lenh AWS, tach stdout/stderr de phan biet "khong ton tai" voi loi API.
# $1 = bien nhan stdout, $2 = nhan de in loi, $3 = regex loi "khong ton tai"
# (rong = khong co loi not-found), phan con lai = lenh.
# Loi khac not-found: in lenh + stderr, dat FAILED=1 va tra 1.
lookup() {
  local var="$1" label="$2" missing="$3" tmp err rc=0
  shift 3
  tmp=$(mktemp) || {
    echo "LOI: khong tao duoc file tam de goi AWS."
    printf -v "$var" '%s' ''
    FAILED=1
    return 1
  }
  err=$("$@" 2>&1 >"$tmp") || rc=$?
  printf -v "$var" '%s' "$(cat "$tmp")"
  rm -f "$tmp"
  if [ "$rc" -eq 0 ]; then
    return 0
  fi
  if [ -n "$missing" ] && printf '%s' "$err" | grep -qE "$missing"; then
    printf -v "$var" '%s' ''
    return 0
  fi
  echo ""
  echo "LOI: khong goi duoc AWS ($label)."
  echo "  Lenh: $*"
  echo "  Chi tiet: $err"
  printf -v "$var" '%s' ''
  FAILED=1
  return 1
}

if ! ACCOUNT_ID=$(aws sts get-caller-identity --query 'Account' --output text 2>/dev/null) \
  || [ -z "$ACCOUNT_ID" ] || [ "$ACCOUNT_ID" = "None" ]; then
  echo "LOI: khong goi duoc AWS CLI. Kiem tra credential/region roi chay lai."
  exit 1
fi

# Cac ham tra ID: chi tim trong VPC bdu-vpc khi da biet VPC_ID.
sg_id() { # $1 = bien nhan ID, $2 = group name
  lookup "$1" "describe-security-groups $2" "" aws ec2 describe-security-groups --filters Name=group-name,Values="$2" ${VPC_ID:+Name=vpc-id,Values=$VPC_ID} --query 'SecurityGroups[0].GroupId' --output text
}
subnet_id() { # $1 = bien nhan ID, $2 = tag Name
  lookup "$1" "describe-subnets $2" "" aws ec2 describe-subnets --filters Name=tag:Name,Values="$2" ${VPC_ID:+Name=vpc-id,Values=$VPC_ID} --query 'Subnets[0].SubnetId' --output text
}
rt_id() { # $1 = bien nhan ID, $2 = tag Name
  lookup "$1" "describe-route-tables $2" "" aws ec2 describe-route-tables --filters Name=tag:Name,Values="$2" ${VPC_ID:+Name=vpc-id,Values=$VPC_ID} --query 'RouteTables[0].RouteTableId' --output text
}
nat_id() { # $1 = bien nhan ID
  lookup "$1" "describe-nat-gateways bdu-nat" "" aws ec2 describe-nat-gateways --filter Name=tag:Name,Values=bdu-nat Name=state,Values=pending,available,deleting,failed --query 'NatGateways[0].NatGatewayId' --output text
}
eip_alloc() { # $1 = bien nhan allocation ID
  lookup "$1" "describe-addresses bdu-nat-eip" "" aws ec2 describe-addresses --filters Name=tag:Name,Values=bdu-nat-eip --query 'Addresses[0].AllocationId' --output text
}
igw_id() { # $1 = bien nhan ID
  lookup "$1" "describe-internet-gateways bdu-igw" "" aws ec2 describe-internet-gateways --filters Name=tag:Name,Values=bdu-igw --query 'InternetGateways[0].InternetGatewayId' --output text
}

if ! lookup VPC_ID "describe-vpcs bdu-vpc" "" aws ec2 describe-vpcs --filters Name=tag:Name,Values=bdu-vpc --query 'Vpcs[0].VpcId' --output text; then
  echo "CANH BAO: khong xac dinh duoc VPC bdu-vpc; van thu xoa theo ten/tag nhung se khong detach IGW."
fi
[ "$VPC_ID" = "None" ] && VPC_ID=""

echo "== Don dep ha tang bdu-* =="
echo "Region: $AWS_DEFAULT_REGION"
echo "Tai khoan AWS: $ACCOUNT_ID"
echo "VPC bdu-vpc: ${VPC_ID:-(khong tim thay)}"
echo ""
echo "Chi xoa cac tai nguyen bdu-* do bai lab tao: RDS, DB subnet group, EC2,"
echo "security group, route table, NAT + EIP, internet gateway, subnet, VPC, key pair."
echo "Tai nguyen khac trong tai khoan/region nay khong bi dong toi."
echo "Chi phi bai lab khoang 0.1-0.2 USD/gio, xoa xong la het."
echo ""

if [ "${ASSUME_YES:-0}" != "1" ]; then
  if ! read -r -p "Go yes de xoa toan bo tai nguyen bdu-*: " ans; then
    echo "LOI: khong doc duoc xac nhan. Dung nut Copy tren website hoac chay bash 03-clean-cloudshell.sh tu file."
    exit 1
  fi
  [ "$ans" = "yes" ] || { echo "Da huy."; exit 0; }
fi

echo "Bat dau don dep (co the mat 5-15 phut, chu yeu la cho RDS va NAT)..."

# 1. RDS bdu-db
echo ""
echo "== [1/10] RDS bdu-db =="
if lookup DB_STATUS "describe-db-instances bdu-db" 'DBInstanceNotFound' aws rds describe-db-instances --db-instance-identifier bdu-db --query 'DBInstances[0].DBInstanceStatus' --output text; then
  [ "$DB_STATUS" = "None" ] && DB_STATUS=""
  if [ -n "$DB_STATUS" ]; then
    echo "-- Xoa RDS bdu-db (trang thai: $DB_STATUS)..."
    aws rds delete-db-instance --db-instance-identifier bdu-db --skip-final-snapshot --delete-automated-backups >/dev/null 2>&1 \
      || echo "   Khong gui duoc lenh xoa (co the dang xoa san)."
    echo "   Cho RDS xoa xong (vai phut)..."
    aws rds wait db-instance-deleted --db-instance-identifier bdu-db 2>/dev/null \
      || echo "   CANH BAO: RDS chua xoa xong, tiep tuc phan con lai."
  else
    echo "-- RDS bdu-db khong ton tai, bo qua."
  fi
else
  echo "-- Bo qua RDS: khong kiem tra duoc trang thai (xem loi o tren)."
fi

# 2. DB subnet group (RDS vua xoa thi ENI can vai giay moi nha)
echo ""
echo "== [2/10] DB subnet group bdu-db-subnet-group =="
if lookup DBSG_NAME "describe-db-subnet-groups bdu-db-subnet-group" 'DBSubnetGroupNotFound' aws rds describe-db-subnet-groups --db-subnet-group-name bdu-db-subnet-group --query 'DBSubnetGroups[0].DBSubnetGroupName' --output text; then
  [ "$DBSG_NAME" = "None" ] && DBSG_NAME=""
  if [ -n "$DBSG_NAME" ]; then
    for TRY in 1 2 3 4 5 6; do
      if aws rds delete-db-subnet-group --db-subnet-group-name bdu-db-subnet-group >/dev/null 2>&1; then
        echo "-- Da xoa DB subnet group."
        break
      fi
      if [ "$TRY" = "6" ]; then
        echo "-- CANH BAO: chua xoa duoc DB subnet group (RDS co the con dung), bo qua."
      else
        echo "   Lan $TRY/6: chua xoa duoc, cho 5s..."
        sleep 5
      fi
    done
  else
    echo "-- DB subnet group khong ton tai, bo qua."
  fi
else
  echo "-- Bo qua DB subnet group: khong kiem tra duoc (xem loi o tren)."
fi

# 3. EC2 bdu-fe-ec2 / bdu-be-ec2
echo ""
echo "== [3/10] EC2 bdu-fe-ec2, bdu-be-ec2 =="
if lookup IDS "describe-instances bdu-fe-ec2,bdu-be-ec2" "" aws ec2 describe-instances --filters "Name=tag:Name,Values=bdu-fe-ec2,bdu-be-ec2" "Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down" --query 'Reservations[].Instances[].InstanceId' --output text; then
  [ "$IDS" = "None" ] && IDS=""
  if [ -n "$IDS" ]; then
    echo "-- Terminate EC2: $IDS"
    aws ec2 terminate-instances --instance-ids $IDS >/dev/null 2>&1 || echo "   Khong gui duoc lenh terminate (co the dang tat san)."
    echo "   Cho EC2 terminated..."
    aws ec2 wait instance-terminated --instance-ids $IDS 2>/dev/null \
      || echo "   CANH BAO: EC2 chua terminated, tiep tuc phan con lai."
  else
    echo "-- Khong co EC2 can xoa."
  fi
else
  echo "-- Bo qua EC2: khong kiem tra duoc danh sach instance (xem loi o tren)."
fi

# 4. Security Groups: go ingress truoc de tranh circular dependency
echo ""
echo "== [4/10] Security Groups bdu-frontend, bdu-backend-sg, bdu-db-sg =="
echo "-- Go bo ingress rules cua security group bdu-*..."
for SG in bdu-frontend bdu-backend-sg bdu-db-sg; do
  if sg_id SG_ID "$SG"; then
    [ "$SG_ID" = "None" ] && SG_ID=""
    if [ -n "$SG_ID" ]; then
      lookup IP_PERMS "describe-security-groups $SG_ID ingress" "" aws ec2 describe-security-groups --group-ids "$SG_ID" --query 'SecurityGroups[0].IpPermissions' --output json || {
        echo "   Bo qua go ingress cua $SG: khong doc duoc IpPermissions."
        IP_PERMS=""
      }
      if [ -n "$IP_PERMS" ] && [ "$IP_PERMS" != "[]" ] && [ "$IP_PERMS" != "None" ]; then
        if aws ec2 revoke-security-group-ingress --group-id "$SG_ID" --ip-permissions "$IP_PERMS" >/dev/null 2>&1; then
          echo "   Da go ingress cua $SG."
        else
          echo "   Chua go duoc ingress cua $SG, se thu lai khi xoa."
        fi
      fi
    fi
  else
    echo "   Bo qua ingress cua $SG: khong kiem tra duoc security group."
  fi
done

for TRY in 1 2 3 4 5 6; do
  LEFT=""
  LOOKUP_OK=1
  for SG in bdu-db-sg bdu-backend-sg bdu-frontend; do
    if sg_id SG_ID "$SG"; then
      [ "$SG_ID" = "None" ] && SG_ID=""
      if [ -n "$SG_ID" ]; then
        LEFT="$LEFT $SG"
        if aws ec2 delete-security-group --group-id "$SG_ID" >/dev/null 2>&1; then
          echo "-- Da xoa SG $SG ($SG_ID)."
        fi
      fi
    else
      LOOKUP_OK=0
    fi
  done
  if [ "$LOOKUP_OK" = "0" ]; then
    echo "-- Dung retry SG: co loi API khi kiem tra danh sach."
    break
  fi
  [ -z "$LEFT" ] && { echo "-- Het SG can xoa."; break; }
  if [ "$TRY" = "6" ]; then
    echo "-- CANH BAO: con sot SG:$LEFT (thuong do ENI/RDS chua nha)."
  else
    sleep 5
  fi
done

# 5. Route Tables: bdu-backend-rtb, bdu-db-rtb, bdu-igw
echo ""
echo "== [5/10] Route tables bdu-backend-rtb, bdu-db-rtb, bdu-igw =="
for RT_NAME in bdu-backend-rtb bdu-db-rtb bdu-igw; do
  if ! rt_id RT_ID "$RT_NAME"; then
    echo "-- Bo qua route table $RT_NAME: khong kiem tra duoc."
    continue
  fi
  [ "$RT_ID" = "None" ] && RT_ID=""
  if [ -z "$RT_ID" ]; then
    echo "-- Route table $RT_NAME khong ton tai."
    continue
  fi
  if ! lookup IS_MAIN "describe-route-tables $RT_ID" "" aws ec2 describe-route-tables --route-table-ids "$RT_ID" --query 'RouteTables[0].Associations[?Main==`true`].Main' --output text; then
    echo "-- Bo qua route table $RT_NAME: khong kiem tra duoc association."
    continue
  fi
  if [ "$IS_MAIN" = "True" ] || [ "$IS_MAIN" = "true" ]; then
    echo "-- $RT_NAME ($RT_ID) la main route table, giu nguyen (se bi xoa cung VPC)."
    continue
  fi
  echo "-- Xu ly route table $RT_NAME ($RT_ID)..."
  if ! lookup ASSOCS "describe-route-tables $RT_ID associations" "" aws ec2 describe-route-tables --route-table-ids "$RT_ID" --query 'RouteTables[0].Associations[?Main==`false`].RouteTableAssociationId' --output text; then
    echo "   Bo qua disassociate: khong kiem tra duoc association."
  else
    for A in $ASSOCS; do
      [ "$A" = "None" ] && continue
      echo "   Disassociate $A"
      aws ec2 disassociate-route-table --association-id "$A" >/dev/null 2>&1 || echo "   Chua disassociate duoc $A."
    done
  fi
  if aws ec2 delete-route-table --route-table-id "$RT_ID" >/dev/null 2>&1; then
    echo "   Da xoa route table $RT_NAME."
  else
    echo "   CANH BAO: chua xoa duoc route table $RT_NAME."
  fi
done

# 6. NAT Gateway bdu-nat roi moi giai phong EIP bdu-nat-eip
echo ""
echo "== [6/10] NAT bdu-nat va EIP bdu-nat-eip =="
if ! nat_id NAT_ID; then
  echo "-- Bo qua NAT: khong kiem tra duoc (xem loi o tren)."
else
  [ "$NAT_ID" = "None" ] && NAT_ID=""
  if [ -n "$NAT_ID" ]; then
    if ! lookup STATE "describe-nat-gateways $NAT_ID" "" aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_ID" --query 'NatGateways[0].State' --output text; then
      echo "   Khong doc duoc trang thai NAT; van thu xoa."
      STATE=""
    fi
    if [ "$STATE" = "deleting" ]; then
      echo "-- NAT $NAT_ID dang deleting, cho hoan tat..."
    elif [ "$STATE" = "deleted" ]; then
      echo "-- NAT $NAT_ID da xoa."
    else
      echo "-- Xoa NAT $NAT_ID (trang thai: ${STATE:-khong ro})..."
      aws ec2 delete-nat-gateway --nat-gateway-id "$NAT_ID" >/dev/null 2>&1 || echo "   Khong gui duoc lenh xoa NAT."
    fi
    aws ec2 wait nat-gateway-deleted --nat-gateway-ids "$NAT_ID" 2>/dev/null \
      || echo "   CANH BAO: NAT chua xoa xong."
  else
    echo "-- NAT bdu-nat khong ton tai."
  fi
fi

if ! eip_alloc EIP_ALLOC; then
  echo "-- Bo qua EIP: khong kiem tra duoc (xem loi o tren)."
else
  [ "$EIP_ALLOC" = "None" ] && EIP_ALLOC=""
  if [ -n "$EIP_ALLOC" ]; then
    echo "-- Giai phong EIP $EIP_ALLOC..."
    for TRY in 1 2 3 4 5 6; do
      if aws ec2 release-address --allocation-id "$EIP_ALLOC" >/dev/null 2>&1; then
        echo "   Da giai phong EIP."
        break
      fi
      if [ "$TRY" = "6" ]; then
        echo "   CANH BAO: chua giai phong duoc EIP $EIP_ALLOC."
      else
        sleep 5
      fi
    done
  else
    echo "-- EIP bdu-nat-eip khong ton tai."
  fi
fi

# 7. Internet Gateway bdu-igw: detach roi moi xoa
echo ""
echo "== [7/10] Internet Gateway bdu-igw =="
if ! igw_id IGW_ID; then
  echo "-- Bo qua IGW: khong kiem tra duoc (xem loi o tren)."
else
  [ "$IGW_ID" = "None" ] && IGW_ID=""
  if [ -n "$IGW_ID" ]; then
    if ! lookup ATTACHED_VPC "describe-internet-gateways $IGW_ID" "" aws ec2 describe-internet-gateways --internet-gateway-ids "$IGW_ID" --query 'InternetGateways[0].Attachments[0].VpcId' --output text; then
      ATTACHED_VPC=""
    fi
    [ "$ATTACHED_VPC" = "None" ] && ATTACHED_VPC=""
    CAN_DELETE=1
    if [ -n "$ATTACHED_VPC" ]; then
      if [ -z "$VPC_ID" ]; then
        echo "-- CANH BAO: khong xac dinh duoc VPC bdu-vpc nhung IGW $IGW_ID dang gan vao VPC $ATTACHED_VPC, khong detach."
        CAN_DELETE=0
        FAILED=1
      elif [ "$ATTACHED_VPC" != "$VPC_ID" ]; then
        echo "-- CANH BAO: IGW $IGW_ID dang gan vao VPC $ATTACHED_VPC khac $VPC_ID, khong detach."
        CAN_DELETE=0
      else
        echo "-- Detach IGW $IGW_ID khoi VPC $ATTACHED_VPC..."
        aws ec2 detach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$ATTACHED_VPC" >/dev/null 2>&1 || echo "   Chua detach duoc IGW."
      fi
    fi
    if [ "$CAN_DELETE" = "1" ]; then
      if aws ec2 delete-internet-gateway --internet-gateway-id "$IGW_ID" >/dev/null 2>&1; then
        echo "-- Da xoa IGW $IGW_ID."
      else
        echo "-- CANH BAO: chua xoa duoc IGW $IGW_ID."
      fi
    fi
  else
    echo "-- IGW bdu-igw khong ton tai."
  fi
fi

# 8. Subnets (retry vi ENI cua RDS/NAT can vai giay de nha)
echo ""
echo "== [8/10] Subnets bdu-fe-subnet, bdu-be-subnet, bdu-db-subnet =="
for TRY in 1 2 3 4 5 6 7 8; do
  LEFT_SN=""
  LOOKUP_OK=1
  for SN in bdu-fe-subnet bdu-be-subnet bdu-db-subnet; do
    if subnet_id SN_ID "$SN"; then
      [ "$SN_ID" = "None" ] && SN_ID=""
      if [ -n "$SN_ID" ]; then
        LEFT_SN="$LEFT_SN $SN"
        if aws ec2 delete-subnet --subnet-id "$SN_ID" >/dev/null 2>&1; then
          echo "-- Da xoa subnet $SN ($SN_ID)."
        fi
      fi
    else
      LOOKUP_OK=0
    fi
  done
  if [ "$LOOKUP_OK" = "0" ]; then
    echo "-- Dung retry subnet: co loi API khi kiem tra danh sach."
    break
  fi
  [ -z "$LEFT_SN" ] && { echo "-- Het subnet can xoa."; break; }
  if [ "$TRY" = "8" ]; then
    echo "-- CANH BAO: con sot subnet:$LEFT_SN (thuong do ENI chua nha)."
  else
    echo "   Lan $TRY/8: con subnet$LEFT_SN, cho 5s..."
    sleep 5
  fi
done

# 9. VPC bdu-vpc (chi xoa duoc khi subnet/IGW/SG/NAT da xoa het)
echo ""
echo "== [9/10] VPC bdu-vpc =="
if [ -n "$VPC_ID" ]; then
  for TRY in 1 2 3 4 5 6; do
    if aws ec2 delete-vpc --vpc-id "$VPC_ID" >/dev/null 2>&1; then
      echo "-- Da xoa VPC $VPC_ID."
      break
    fi
    if [ "$TRY" = "6" ]; then
      echo "-- CANH BAO: chua xoa duoc VPC $VPC_ID (kiem tra ENI/tai nguyen dinh kem)."
    else
      echo "   Lan $TRY/6: chua xoa duoc VPC, cho 5s..."
      sleep 5
    fi
  done
else
  echo "-- VPC bdu-vpc khong ton tai hoac khong xac dinh duoc."
fi

# 10. Key pairs tren AWS (khong xoa file .pem cua ban)
echo ""
echo "== [10/10] Key pairs bdu-key-fe, bdu-key-be =="
for K in bdu-key-fe bdu-key-be; do
  if lookup KEY_NAME "describe-key-pairs $K" 'InvalidKeyPair\.NotFound' aws ec2 describe-key-pairs --key-names "$K" --query 'KeyPairs[].KeyName' --output text; then
    [ "$KEY_NAME" = "None" ] && KEY_NAME=""
    if [ -n "$KEY_NAME" ]; then
      if aws ec2 delete-key-pair --key-name "$K" >/dev/null 2>&1; then
        echo "-- Da xoa key pair $K."
      else
        echo "-- CANH BAO: chua xoa duoc key pair $K."
        FAILED=1
      fi
    else
      echo "-- Key pair $K khong ton tai."
    fi
  else
    echo "-- CANH BAO: khong kiem tra duoc key pair $K, bo qua de tranh xoa nham."
  fi
done
echo "-- File .pem (neu co) trong ~/bdu-aws duoc giu lai, khong tu dong xoa."

echo ""
echo "DA DON DEP XONG"

# Kiem tra tai nguyen con sot mang ten/tag bdu-*
echo ""
echo "== Kiem tra tai nguyen con sot =="
LEFT_OVER=""
SCAN_ERROR=0
add_left() { # $1 = loai tai nguyen, $2 = gia tri tim duoc
  local value="${2:-}"
  [ "$value" = "None" ] && value=""
  [ -z "$value" ] && return 0
  LEFT_OVER="${LEFT_OVER:+$LEFT_OVER }[$1: $value]"
  return 0
}
scan() { # $1 = loai, $2 = nhan, $3 = regex not-found, con lai = lenh
  local kind="$1" label="$2" missing="$3" value
  shift 3
  if lookup value "$label" "$missing" "$@"; then
    add_left "$kind" "$value"
  else
    LEFT_OVER="${LEFT_OVER:+$LEFT_OVER }[$kind: KHONG KIEM TRA DUOC]"
    SCAN_ERROR=1
  fi
}

scan vpc "describe-vpcs bdu-vpc" "" aws ec2 describe-vpcs --filters Name=tag:Name,Values=bdu-vpc --query 'Vpcs[].VpcId' --output text
scan subnet "describe-subnets bdu-*" "" aws ec2 describe-subnets --filters Name=tag:Name,Values=bdu-fe-subnet,bdu-be-subnet,bdu-db-subnet ${VPC_ID:+Name=vpc-id,Values=$VPC_ID} --query 'Subnets[].SubnetId' --output text
scan security-group "describe-security-groups bdu-*" "" aws ec2 describe-security-groups --filters Name=group-name,Values=bdu-frontend,bdu-backend-sg,bdu-db-sg ${VPC_ID:+Name=vpc-id,Values=$VPC_ID} --query 'SecurityGroups[].GroupId' --output text
scan route-table "describe-route-tables bdu-*" "" aws ec2 describe-route-tables --filters Name=tag:Name,Values=bdu-backend-rtb,bdu-db-rtb,bdu-igw ${VPC_ID:+Name=vpc-id,Values=$VPC_ID} --query 'RouteTables[].RouteTableId' --output text
scan nat "describe-nat-gateways bdu-nat" "" aws ec2 describe-nat-gateways --filter Name=tag:Name,Values=bdu-nat Name=state,Values=pending,available,deleting,failed --query 'NatGateways[].NatGatewayId' --output text
scan eip "describe-addresses bdu-nat-eip" "" aws ec2 describe-addresses --filters Name=tag:Name,Values=bdu-nat-eip --query 'Addresses[].AllocationId' --output text
scan igw "describe-internet-gateways bdu-igw" "" aws ec2 describe-internet-gateways --filters Name=tag:Name,Values=bdu-igw --query 'InternetGateways[].InternetGatewayId' --output text
scan ec2 "describe-instances bdu-*" "" aws ec2 describe-instances --filters "Name=tag:Name,Values=bdu-fe-ec2,bdu-be-ec2" "Name=instance-state-name,Values=pending,running,stopping,stopped,shutting-down" --query 'Reservations[].Instances[].InstanceId' --output text
scan rds "describe-db-instances bdu-db" 'DBInstanceNotFound' aws rds describe-db-instances --db-instance-identifier bdu-db --query 'DBInstances[0].DBInstanceStatus' --output text
scan db-subnet-group "describe-db-subnet-groups bdu-db-subnet-group" 'DBSubnetGroupNotFound' aws rds describe-db-subnet-groups --db-subnet-group-name bdu-db-subnet-group --query 'DBSubnetGroups[0].DBSubnetGroupName' --output text
scan key-pair "describe-key-pairs bdu-key-fe" 'InvalidKeyPair\.NotFound' aws ec2 describe-key-pairs --key-names bdu-key-fe --query 'KeyPairs[].KeyName' --output text
scan key-pair "describe-key-pairs bdu-key-be" 'InvalidKeyPair\.NotFound' aws ec2 describe-key-pairs --key-names bdu-key-be --query 'KeyPairs[].KeyName' --output text

check_hints() {
  echo "   Lenh kiem tra nhanh:"
  echo "     aws ec2 describe-vpcs --filters Name=tag:Name,Values=bdu-vpc --output table"
  echo "     aws rds describe-db-instances --db-instance-identifier bdu-db --output table"
  echo "     aws ec2 describe-key-pairs --key-names bdu-key-fe bdu-key-be --output table"
}

if [ -n "$LEFT_OVER" ]; then
  echo "CANH BAO: con tai nguyen bdu-*:$LEFT_OVER"
  if [ "$SCAN_ERROR" = "1" ]; then
    echo "   Mot so muc KHONG KIEM TRA DUOC (xem loi AWS o tren), chua the ket luan da sach."
  fi
  echo "   Doi 2-5 phut (ENI/RDS can thoi gian nha) roi chay lai script nay."
  check_hints
elif [ "$SCAN_ERROR" = "1" ] || [ "$FAILED" = "1" ]; then
  echo "CANH BAO: chua the khang dinh da sach vi co loi AWS (xem chi tiet o tren)."
  echo "   Kiem tra credentials/quyen/region roi chay lai script nay."
  check_hints
else
  echo "-- Khong con tai nguyen bdu-* trong region $AWS_DEFAULT_REGION."
fi

if [ -n "$LEFT_OVER" ] || [ "$SCAN_ERROR" = "1" ] || [ "$FAILED" = "1" ]; then
  exit 1
fi
