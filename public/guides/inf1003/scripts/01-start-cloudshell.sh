#!/usr/bin/env bash
# 01-start-cloudshell.sh - Dung ha tang bai 1 (web 3 tang) trong AWS CloudShell.
# Chay: bash 01-start-cloudshell.sh
# Idempotent: chay lai se tai su dung tai nguyen da co thay vi tao trung.
# Khong tu dong xoa hoac thay the key pair dang co tren AWS.
set -euo pipefail
umask 077

export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-ap-southeast-1}"
BASE="$HOME/bdu-aws"
BASE="${BDU_BASE:-$BASE}"
mkdir -p "$BASE"
# Khong de ket qua thanh cong cu bi hieu nham neu lan chay moi that bai.
if [ "${BDU_KEY_SOURCE:-}" != "LOCAL" ]; then : > "$BASE/lab-result.txt"; fi
IDS="$BASE/aws-ids.env"
IPS="$BASE/aws-ips.env"

need() { command -v "$1" >/dev/null 2>&1 || { echo "Thieu lenh $1. Hay dung AWS CloudShell hoac cai dat them."; exit 1; }; }
need aws
need base64
need tr

# Chon 2 Availability Zone that su co trong region (ten AZ khong phai luc nao
# cung la a/b: vi du Tokyo chi co a, c, d). RDS can subnet o 2 AZ khac nhau.
AZ_A=$(aws ec2 describe-availability-zones --filters Name=state,Values=available \
  --query 'AvailabilityZones[0].ZoneName' --output text 2>/dev/null) || AZ_A=""
AZ_B=$(aws ec2 describe-availability-zones --filters Name=state,Values=available \
  --query 'AvailabilityZones[1].ZoneName' --output text 2>/dev/null) || AZ_B=""
if [ -z "$AZ_A" ] || [ "$AZ_A" = "None" ] || [ -z "$AZ_B" ] || [ "$AZ_B" = "None" ]; then
  echo "LOI: khong xac dinh duoc 2 Availability Zone trong region $AWS_DEFAULT_REGION."
  echo "Kiem tra quyen ec2:DescribeAvailabilityZones, credentials va region da chon roi chay lai."
  exit 1
fi

# Chay 1 lenh AWS; chi bo qua khi stderr khop $1 (loi trung lap da biet).
# Moi loi khac deu dung script, khong bi nuot boi "|| true".
aws_allow_duplicate() { # $1=pattern stderr duoc bo qua, phan con lai la lenh
  local pattern="$1"
  shift
  local err rc=0
  err=$("$@" 2>&1 >/dev/null) || rc=$?
  if [ "$rc" -eq 0 ]; then
    return 0
  fi
  if printf '%s' "$err" | grep -q "$pattern"; then
    return 0
  fi
  echo ""
  echo "LOI: lenh AWS that bai (khong phai loi trung lap):"
  echo "  $*"
  echo "$err"
  exit 1
}

allow_sg_rule() { # cac tham so cua authorize-security-group-ingress
  aws_allow_duplicate 'InvalidPermission.Duplicate' aws ec2 authorize-security-group-ingress "$@"
}

ensure_route() { # $1=route-table $2=cidr $3=--gateway-id|--nat-gateway-id $4=target-id
  local rt="$1" cidr="$2" opt="$3" want="$4" current field
  if [ "$opt" = "--gateway-id" ]; then
    field="GatewayId"
  else
    field="NatGatewayId"
  fi
  current=$(aws ec2 describe-route-tables --route-table-ids "$rt" \
    --query "RouteTables[0].Routes[?DestinationCidrBlock=='$cidr'].$field | [0]" --output text 2>&1) || {
    echo "LOI: khong doc duoc route table $rt ($current)."
    exit 1
  }
  [ "$current" = "None" ] && current=""
  if [ "$current" = "$want" ]; then
    echo "Route $cidr da tro dung ($want)."
    return 0
  fi
  if [ -z "$current" ]; then
    aws_allow_duplicate 'RouteAlreadyExists' aws ec2 create-route \
      --route-table-id "$rt" --destination-cidr-block "$cidr" "$opt" "$want"
    echo "Da tao route $cidr -> $want."
  else
    echo "Route $cidr dang tro sai ($current), thay bang $want."
    aws_allow_duplicate 'RouteAlreadyExists' aws ec2 replace-route \
      --route-table-id "$rt" --destination-cidr-block "$cidr" "$opt" "$want"
  fi
}

echo "Region: $AWS_DEFAULT_REGION"
echo "Availability zones: $AZ_A, $AZ_B"
echo "Thu muc lam viec: $BASE"
echo "Bat dau tao ha tang bdu-* (co the mat 10-15 phut, chu yeu la cho RDS)."

echo ""
echo "== [1/8] VPC bdu-vpc (10.0.0.0/16) =="
VPC_ID=$(aws ec2 describe-vpcs --filters Name=tag:Name,Values=bdu-vpc --query 'Vpcs[0].VpcId' --output text 2>/dev/null)
[ "$VPC_ID" = "None" ] && VPC_ID=""
if [ -z "$VPC_ID" ]; then
  VPC_ID=$(aws ec2 create-vpc --cidr-block 10.0.0.0/16 \
    --tag-specifications 'ResourceType=vpc,Tags=[{Key=Name,Value=bdu-vpc}]' \
    --query 'Vpc.VpcId' --output text)
  echo "Da tao VPC: $VPC_ID"
else
  echo "Dung lai VPC: $VPC_ID"
fi
aws ec2 modify-vpc-attribute --vpc-id "$VPC_ID" --enable-dns-hostnames '{"Value":true}'

echo ""
echo "== [2/8] 3 Subnet (FE, BE o $AZ_A; DB o $AZ_B) =="
mk_subnet() { # $1=name $2=cidr $3=az -> id
  local id
  id=$(aws ec2 describe-subnets --filters Name=tag:Name,Values="$1" Name=vpc-id,Values="$VPC_ID" --query 'Subnets[0].SubnetId' --output text 2>/dev/null)
  [ "$id" = "None" ] && id=""
  if [ -z "$id" ]; then
    id=$(aws ec2 create-subnet --vpc-id "$VPC_ID" --cidr-block "$2" --availability-zone "$3" \
      --tag-specifications "ResourceType=subnet,Tags=[{Key=Name,Value=$1}]" \
      --query 'Subnet.SubnetId' --output text)
    echo "Da tao subnet $1: $id" >&2
  else
    echo "Dung lai subnet $1: $id" >&2
  fi
  echo "$id"
}
FE_SUBNET_ID=$(mk_subnet bdu-fe-subnet 10.0.1.0/24 "$AZ_A")
BE_SUBNET_ID=$(mk_subnet bdu-be-subnet 10.0.2.0/24 "$AZ_A")
DB_SUBNET_ID=$(mk_subnet bdu-db-subnet 10.0.3.0/24 "$AZ_B")
echo "FE=$FE_SUBNET_ID BE=$BE_SUBNET_ID DB=$DB_SUBNET_ID"

echo ""
echo "== [3/8] Internet Gateway bdu-igw =="
IGW_ID=$(aws ec2 describe-internet-gateways --filters Name=tag:Name,Values=bdu-igw --query 'InternetGateways[0].InternetGatewayId' --output text 2>/dev/null)
[ "$IGW_ID" = "None" ] && IGW_ID=""
if [ -z "$IGW_ID" ]; then
  IGW_ID=$(aws ec2 create-internet-gateway \
    --tag-specifications 'ResourceType=internet-gateway,Tags=[{Key=Name,Value=bdu-igw}]' \
    --query 'InternetGateway.InternetGatewayId' --output text)
  echo "Da tao IGW: $IGW_ID"
else
  echo "Dung lai IGW: $IGW_ID"
fi
ATTACHED=$(aws ec2 describe-internet-gateways --internet-gateway-ids "$IGW_ID" --query "InternetGateways[0].Attachments[?VpcId=='$VPC_ID'].VpcId" --output text 2>/dev/null)
if [ -z "$ATTACHED" ] || [ "$ATTACHED" = "None" ]; then
  aws ec2 attach-internet-gateway --internet-gateway-id "$IGW_ID" --vpc-id "$VPC_ID"
  echo "Da gan IGW vao VPC."
fi

echo ""
echo "== [4/8] Route table bdu-igw cho FE ra Internet =="
RT_ID=$(aws ec2 describe-route-tables --filters Name=tag:Name,Values=bdu-igw Name=vpc-id,Values="$VPC_ID" --query 'RouteTables[0].RouteTableId' --output text 2>/dev/null)
[ "$RT_ID" = "None" ] && RT_ID=""
if [ -z "$RT_ID" ]; then
  RT_ID=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
    --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=bdu-igw}]' \
    --query 'RouteTable.RouteTableId' --output text)
  echo "Da tao route table FE: $RT_ID"
else
  echo "Dung lai route table FE: $RT_ID"
fi
ensure_route "$RT_ID" 0.0.0.0/0 --gateway-id "$IGW_ID"
ASSOC=$(aws ec2 describe-route-tables --route-table-ids "$RT_ID" --query "RouteTables[0].Associations[?SubnetId=='$FE_SUBNET_ID'].RouteTableAssociationId" --output text 2>/dev/null)
if [ -z "$ASSOC" ] || [ "$ASSOC" = "None" ]; then
  aws ec2 associate-route-table --route-table-id "$RT_ID" --subnet-id "$FE_SUBNET_ID" >/dev/null
  echo "Da gan route table FE vao subnet FE."
fi

echo ""
echo "== [5/8] NAT Gateway cho BE + route table DB =="
# NAT nam o public subnet FE; BE private di Internet qua NAT de apt/docker pull.
EIP_ALLOC=$(aws ec2 describe-addresses --filters Name=tag:Name,Values=bdu-nat-eip --query 'Addresses[0].AllocationId' --output text 2>/dev/null)
[ "$EIP_ALLOC" = "None" ] && EIP_ALLOC=""
if [ -z "$EIP_ALLOC" ]; then
  EIP_ALLOC=$(aws ec2 allocate-address --domain vpc \
    --tag-specifications 'ResourceType=elastic-ip,Tags=[{Key=Name,Value=bdu-nat-eip}]' \
    --query 'AllocationId' --output text)
  echo "Da cap EIP cho NAT: $EIP_ALLOC"
else
  echo "Dung lai EIP cua NAT: $EIP_ALLOC"
fi
NAT_ID=$(aws ec2 describe-nat-gateways --filter Name=tag:Name,Values=bdu-nat Name=subnet-id,Values="$FE_SUBNET_ID" Name=state,Values=pending,available --query 'NatGateways[0].NatGatewayId' --output text 2>/dev/null)
[ "$NAT_ID" = "None" ] && NAT_ID=""
if [ -z "$NAT_ID" ]; then
  NAT_ID=$(aws ec2 create-nat-gateway --subnet-id "$FE_SUBNET_ID" --allocation-id "$EIP_ALLOC" \
    --tag-specifications 'ResourceType=natgateway,Tags=[{Key=Name,Value=bdu-nat}]' \
    --query 'NatGateway.NatGatewayId' --output text)
  echo "Da tao NAT: $NAT_ID"
else
  echo "Dung lai NAT: $NAT_ID"
fi
echo "Cho NAT available..."
aws ec2 wait nat-gateway-available --nat-gateway-ids "$NAT_ID"

BE_RT_ID=$(aws ec2 describe-route-tables --filters Name=tag:Name,Values=bdu-backend-rtb Name=vpc-id,Values="$VPC_ID" --query 'RouteTables[0].RouteTableId' --output text 2>/dev/null)
[ "$BE_RT_ID" = "None" ] && BE_RT_ID=""
if [ -z "$BE_RT_ID" ]; then
  BE_RT_ID=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
    --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=bdu-backend-rtb}]' \
    --query 'RouteTable.RouteTableId' --output text)
  echo "Da tao route table BE: $BE_RT_ID"
else
  echo "Dung lai route table BE: $BE_RT_ID"
fi
ensure_route "$BE_RT_ID" 0.0.0.0/0 --nat-gateway-id "$NAT_ID"
BE_ASSOC=$(aws ec2 describe-route-tables --route-table-ids "$BE_RT_ID" --query "RouteTables[0].Associations[?SubnetId=='$BE_SUBNET_ID'].RouteTableAssociationId" --output text 2>/dev/null)
if [ -z "$BE_ASSOC" ] || [ "$BE_ASSOC" = "None" ]; then
  aws ec2 associate-route-table --route-table-id "$BE_RT_ID" --subnet-id "$BE_SUBNET_ID" >/dev/null
  echo "Da gan route table BE vao subnet BE."
fi

# Route table DB: DB subnet chi noi bo, khong ra Internet.
DB_RT_ID=$(aws ec2 describe-route-tables --filters Name=tag:Name,Values=bdu-db-rtb Name=vpc-id,Values="$VPC_ID" --query 'RouteTables[0].RouteTableId' --output text 2>/dev/null)
[ "$DB_RT_ID" = "None" ] && DB_RT_ID=""
if [ -z "$DB_RT_ID" ]; then
  MAIN_RT_ID=$(aws ec2 describe-route-tables --filters Name=vpc-id,Values="$VPC_ID" Name=association.main,Values=true --query 'RouteTables[0].RouteTableId' --output text 2>/dev/null)
  [ "$MAIN_RT_ID" = "None" ] && MAIN_RT_ID=""
  if [ -n "$MAIN_RT_ID" ]; then
    DB_RT_ID="$MAIN_RT_ID"
    aws ec2 create-tags --resources "$DB_RT_ID" --tags Key=Name,Value=bdu-db-rtb
    echo "Dung main route table va doi ten thanh bdu-db-rtb: $DB_RT_ID"
  else
    DB_RT_ID=$(aws ec2 create-route-table --vpc-id "$VPC_ID" \
      --tag-specifications 'ResourceType=route-table,Tags=[{Key=Name,Value=bdu-db-rtb}]' \
      --query 'RouteTable.RouteTableId' --output text)
    echo "Da tao route table DB: $DB_RT_ID"
  fi
fi
DB_ASSOC=$(aws ec2 describe-route-tables --route-table-ids "$DB_RT_ID" --query "RouteTables[0].Associations[?SubnetId=='$DB_SUBNET_ID'].RouteTableAssociationId" --output text 2>/dev/null)
if [ -z "$DB_ASSOC" ] || [ "$DB_ASSOC" = "None" ]; then
  DB_RT_IS_MAIN=$(aws ec2 describe-route-tables --route-table-ids "$DB_RT_ID" --query 'RouteTables[0].Associations[?Main==`true`].Main | [0]' --output text 2>/dev/null)
  if [ "$DB_RT_IS_MAIN" = "True" ]; then
    echo "Route table DB la main route table, ap dung ngam cho subnet DB."
  else
    aws ec2 associate-route-table --route-table-id "$DB_RT_ID" --subnet-id "$DB_SUBNET_ID" >/dev/null
    echo "Da gan route table DB vao subnet DB."
  fi
fi

echo ""
echo "== [6/8] Key pair, Security Group va EC2 FE/BE =="
mk_key() { # $1=name -> tao/reuse $BASE/<name>.pem; dung neu khong xac dinh duoc key
  local name="$1"
  local pem="$BASE/$1.pem"
  local err
  if err=$(aws ec2 describe-key-pairs --key-names "$name" 2>&1 >/dev/null); then
    if [ ! -s "$pem" ]; then
      echo ""
      echo "LOI: key pair $name da ton tai tren AWS nhung thieu pem $pem."
      echo "Script dung lai de khong xoa hoac ghi de key pair cua ban."
      echo "Cach xu ly:"
      echo "  - Neu con file $name.pem, chep/upload lai vao $BASE/."
      echo "  - AWS khong cho tai lai private key cua key pair da tao."
      echo "  - Hoac chay 03-clean-cloudshell.sh roi chay lai script nay tu dau."
      echo "  - Hoac dung EC2 Instance Connect de dang nhap tam thoi."
      exit 1
    fi
    chmod 400 "$pem" 2>/dev/null || true
    echo "Dung lai key $name (da co $pem)"
    return 0
  fi
  # describe that bai: chi coi la "chua co key" khi AWS tra dung InvalidKeyPair.NotFound.
  # Loi mang/quyen/region khac khong duoc phep dung vao pem cua nguoi dung.
  if ! printf '%s' "$err" | grep -q 'InvalidKeyPair\.NotFound'; then
    echo ""
    echo "LOI: khong kiem tra duoc key pair $name tren AWS."
    echo "Chi tiet: $err"
    echo "Script dung lai va KHONG dong vao $pem."
    echo "Kiem tra credentials, quyen ec2:DescribeKeyPairs va region $AWS_DEFAULT_REGION roi chay lai."
    exit 1
  fi
  if [ -s "$pem" ]; then
    # Key khong con tren AWS nhung pem van con: giu lai ban cu truoc khi tao key moi.
    local backup="$pem.bak.$(date +%Y%m%d%H%M%S)"
    mv "$pem" "$backup"
    chmod 400 "$backup" 2>/dev/null || true
    echo "CANH BAO: khong thay key pair $name tren AWS nhung van con pem cu."
    echo "Da doi ten $pem -> $backup (khong xoa du lieu cua ban)."
  fi
  aws ec2 create-key-pair --key-name "$name" --query 'KeyMaterial' --output text > "$pem"
  chmod 400 "$pem"
  echo "Da tao key $name -> $pem"
}
mk_key bdu-key-fe
mk_key bdu-key-be

AMI_ID=$(aws ec2 describe-images --owners 099720109477 \
  --filters "Name=name,Values=ubuntu/images/hvm-ssd-gp3/ubuntu-noble-24.04-amd64-server-*" "Name=state,Values=available" \
  --query 'sort_by(Images, &CreationDate)[-1].ImageId' --output text)
if [ -z "$AMI_ID" ] || [ "$AMI_ID" = "None" ]; then
  echo "LOI: khong tim thay AMI Ubuntu 24.04 trong region $AWS_DEFAULT_REGION."
  exit 1
fi
echo "AMI Ubuntu 24.04: $AMI_ID"

mk_sg() { # $1=name $2=description -> id
  local id
  id=$(aws ec2 describe-security-groups --filters Name=group-name,Values="$1" Name=vpc-id,Values="$VPC_ID" --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null)
  [ "$id" = "None" ] && id=""
  if [ -z "$id" ]; then
    id=$(aws ec2 create-security-group --group-name "$1" --description "$2" --vpc-id "$VPC_ID" --query 'GroupId' --output text)
    echo "Da tao security group $1: $id" >&2
  else
    echo "Dung lai security group $1: $id" >&2
  fi
  echo "$id"
}

FE_SG_ID=$(mk_sg bdu-frontend "SSH va web frontend cho bai hoc")
if [ -z "$FE_SG_ID" ]; then
  echo "LOI: khong tao hoac dung duoc security group FE (bdu-frontend)."
  exit 1
fi
# FE: SSH va web mo tu Internet (chi dung cho lab).
allow_sg_rule --group-id "$FE_SG_ID" --protocol tcp --port 22 --cidr 0.0.0.0/0
allow_sg_rule --group-id "$FE_SG_ID" --protocol tcp --port 3000 --cidr 0.0.0.0/0

BE_SG_ID=$(mk_sg bdu-backend-sg "SSH va API backend, chi nhan tu FE")
if [ -z "$BE_SG_ID" ]; then
  echo "LOI: khong tao hoac dung duoc security group BE (bdu-backend-sg)."
  exit 1
fi
# BE: SSH va API chi nhan tu security group FE.
allow_sg_rule --group-id "$BE_SG_ID" --protocol tcp --port 22 --source-group "$FE_SG_ID"
allow_sg_rule --group-id "$BE_SG_ID" --protocol tcp --port 8000 --source-group "$FE_SG_ID"

mk_ec2() { # $1=tag $2=key $3=subnet $4=sg $5=public(true/false) -> id
  local id pub state
  id=$(aws ec2 describe-instances --filters "Name=tag:Name,Values=$1" "Name=instance-state-name,Values=pending,running,stopping,stopped" --query 'Reservations[].Instances[].InstanceId | [0]' --output text 2>/dev/null)
  [ "$id" = "None" ] && id=""
  if [ -z "$id" ]; then
    if [ "$5" = "true" ]; then pub="--associate-public-ip-address"; else pub="--no-associate-public-ip-address"; fi
    id=$(aws ec2 run-instances --image-id "$AMI_ID" --instance-type t3.micro --key-name "$2" \
      --subnet-id "$3" --security-group-ids "$4" "$pub" \
      --tag-specifications "ResourceType=instance,Tags=[{Key=Name,Value=$1}]" \
      --query 'Instances[0].InstanceId' --output text)
    echo "Da tao EC2 $1: $id" >&2
  else
    state=$(aws ec2 describe-instances --instance-ids "$id" --query 'Reservations[0].Instances[0].State.Name' --output text 2>/dev/null)
    echo "Dung lai EC2 $1: $id (trang thai: $state)" >&2
  fi
  echo "$id"
}
FE_INSTANCE_ID=$(mk_ec2 bdu-fe-ec2 bdu-key-fe "$FE_SUBNET_ID" "$FE_SG_ID" true)
BE_INSTANCE_ID=$(mk_ec2 bdu-be-ec2 bdu-key-be "$BE_SUBNET_ID" "$BE_SG_ID" false)
echo "FE EC2=$FE_INSTANCE_ID BE EC2=$BE_INSTANCE_ID"

# Instance co the bi stop tu lan truoc: start lai (vo hai neu dang running) roi cho running.
aws ec2 start-instances --instance-ids "$FE_INSTANCE_ID" "$BE_INSTANCE_ID" >/dev/null 2>&1 || true
echo "Cho EC2 running..."
aws ec2 wait instance-running --instance-ids "$FE_INSTANCE_ID" "$BE_INSTANCE_ID"
echo "Ca hai EC2 da running."

echo ""
echo "== [7/8] RDS MySQL bdu-db (chi BE duoc vao) =="
DB_SG_ID=$(mk_sg bdu-db-sg "Security group cho RDS bdu-db")
if [ -z "$DB_SG_ID" ]; then
  echo "LOI: khong tao hoac dung duoc security group DB (bdu-db-sg)."
  exit 1
fi
allow_sg_rule --group-id "$DB_SG_ID" --protocol tcp --port 3306 --source-group "$BE_SG_ID"

if ! aws rds describe-db-subnet-groups --db-subnet-group-name bdu-db-subnet-group >/dev/null 2>&1; then
  aws rds create-db-subnet-group --db-subnet-group-name bdu-db-subnet-group \
    --db-subnet-group-description "Subnet group cho bdu-db" \
    --subnet-ids "$BE_SUBNET_ID" "$DB_SUBNET_ID" >/dev/null
  echo "Da tao DB subnet group bdu-db-subnet-group."
else
  echo "Dung lai DB subnet group bdu-db-subnet-group."
fi
if ! aws rds describe-db-instances --db-instance-identifier bdu-db >/dev/null 2>&1; then
  aws rds create-db-instance --db-instance-identifier bdu-db --db-instance-class db.t3.micro \
    --engine mysql --master-username root --master-user-password "12345678" \
    --allocated-storage 20 --db-subnet-group-name bdu-db-subnet-group \
    --vpc-security-group-ids "$DB_SG_ID" --availability-zone "$AZ_B" \
    --no-publicly-accessible --no-multi-az >/dev/null
  echo "Da tao RDS bdu-db (mat khau lab: 12345678)."
else
  echo "Dung lai RDS bdu-db."
  DB_STATUS=$(aws rds describe-db-instances --db-instance-identifier bdu-db --query 'DBInstances[0].DBInstanceStatus' --output text)
  if [ "$DB_STATUS" = "stopped" ]; then
    echo "RDS dang stopped, khoi dong lai..."
    aws rds start-db-instance --db-instance-identifier bdu-db >/dev/null
  fi
fi
echo "Cho RDS available (co the mat vai phut)..."
aws rds wait db-instance-available --db-instance-identifier bdu-db
DB_ENDPOINT=$(aws rds describe-db-instances --db-instance-identifier bdu-db --query 'DBInstances[0].Endpoint.Address' --output text)
if [ -z "$DB_ENDPOINT" ] || [ "$DB_ENDPOINT" = "None" ]; then
  echo "LOI: RDS bdu-db chua co endpoint. Kiem tra RDS trong region $AWS_DEFAULT_REGION roi chay lai."
  exit 1
fi
echo "DB endpoint: $DB_ENDPOINT"

echo ""
echo "== [8/8] Hoan tat va hien thi ket qua =="
FE_IP=$(aws ec2 describe-instances --instance-ids "$FE_INSTANCE_ID" --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
BE_IP=$(aws ec2 describe-instances --instance-ids "$BE_INSTANCE_ID" --query 'Reservations[0].Instances[0].PrivateIpAddress' --output text)
[ "$FE_IP" = "None" ] && FE_IP=""
[ "$BE_IP" = "None" ] && BE_IP=""
if [ -z "$FE_IP" ] || [ -z "$BE_IP" ]; then
  echo "LOI: chua lay duoc IP cua FE/BE (FE_IP='$FE_IP', BE_IP='$BE_IP')."
  echo "Kiem tra EC2 trong region $AWS_DEFAULT_REGION roi chay lai script."
  exit 1
fi

# Luu thong tin tai nguyen tren CloudShell de tham khao va dung voi cong cu cu.
if [ "${BDU_KEY_SOURCE:-}" != "LOCAL" ]; then
{
  echo "VPC_ID=$VPC_ID"
  echo "FE_SUBNET_ID=$FE_SUBNET_ID"
  echo "BE_SUBNET_ID=$BE_SUBNET_ID"
  echo "DB_SUBNET_ID=$DB_SUBNET_ID"
  echo "IGW_ID=$IGW_ID"
  echo "RT_ID=$RT_ID"
  echo "EIP_ALLOC=$EIP_ALLOC"
  echo "NAT_ID=$NAT_ID"
  echo "BE_RT_ID=$BE_RT_ID"
  echo "DB_RT_ID=$DB_RT_ID"
  echo "FE_SG_ID=$FE_SG_ID"
  echo "BE_SG_ID=$BE_SG_ID"
  echo "DB_SG_ID=$DB_SG_ID"
  echo "FE_INSTANCE_ID=$FE_INSTANCE_ID"
  echo "BE_INSTANCE_ID=$BE_INSTANCE_ID"
  echo "DB_ENDPOINT=$DB_ENDPOINT"
} > "$IDS"
chmod 600 "$IDS"

# Luu hai dia chi hien tai tren CloudShell; khong can tai env ve may local.
{
  echo "FE_IP=$FE_IP"
  echo "BE_IP=$BE_IP"
} > "$IPS"
chmod 600 "$IPS"
fi

# Ket qua chi chua dia chi va duong dan, KHONG chua noi dung private key.
# Base64 giu nguyen du lieu tren mot dong de website tu phan tich.
LAB_PAYLOAD=$({ printf 'STATUS=READY\nREGION=%s\nFE_IP=%s\nBE_IP=%s\nDB_ENDPOINT=%s\nFE_KEY_PATH=%s\nBE_KEY_PATH=%s\n' \
  "$AWS_DEFAULT_REGION" "$FE_IP" "$BE_IP" "$DB_ENDPOINT" \
  "$BASE/bdu-key-fe.pem" "$BASE/bdu-key-be.pem"
  if [ "${BDU_KEY_SOURCE:-}" = "LOCAL" ]; then printf 'KEY_SOURCE=LOCAL\n'; fi
} | base64 | tr -d '\r\n')
LAB_RESULT="BDU-LAB-V1:$LAB_PAYLOAD"
if [ "${BDU_KEY_SOURCE:-}" != "LOCAL" ]; then
  printf '%s\n' "$LAB_RESULT" > "$BASE/lab-result.txt"
  chmod 600 "$BASE/lab-result.txt"
fi
printf '\nĐã hoàn tất, vui lòng copy phần bên dưới:\n\n===================\n%s\n===================\n' "$LAB_RESULT"
