#!/bin/bash
# =============================================================================
# cloud-init cho EC2 production (bdu-tu-hoc).
#
# ĐƯỢC GỌI BỞI `aws/infra.sh deploy`: trước khi truyền cho EC2, infra.sh thay
# hai placeholder dưới đây bằng giá trị thật rồi lưu ra file tạm (đã lọc CR):
#   __DEPLOY_PUBLIC_KEY__  -> nội dung public key của key pair `bdu-tu-hoc-deploy`
#   __APP_DIR__            -> thư mục app, mặc định /opt/bdu-tu-hoc
#
# Việc cài đặt chỉ chạy MỘT LẦN lúc máy mới boot. Mọi thứ phụ thuộc repo
# (compose, .env, dữ liệu) do `deploy/bootstrap-server.sh` lo, KHÔNG ở đây.
#
# Script phải giữ line-ending LF. Nếu bị CRLF, shebang và `set -e` sẽ hỏng.
# =============================================================================
set -euxo pipefail

export DEBIAN_FRONTEND=noninteractive

# -----------------------------------------------------------------------------
# 1. Gói cơ bản + Docker
# -----------------------------------------------------------------------------
apt-get update
apt-get install -y --no-install-recommends \
  ca-certificates curl gnupg git \
  docker.io docker-compose-v2 \
  fail2ban unattended-upgrades

# Ubuntu 24.04 có `docker-compose-v2`; nếu vì lý do nào đó không có, cài từ
# kho chính thức của Docker để chắc chắn `docker compose` chạy được.
if ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
    -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y --no-install-recommends \
    docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

systemctl enable --now docker
systemctl enable --now fail2ban

# -----------------------------------------------------------------------------
# 2. Swap 2 GB (máy chỉ có 2 GB RAM; WordFmt/.NET và migrate cần dư địa)
# -----------------------------------------------------------------------------
if [ ! -f /swapfile ]; then
  if ! fallocate -l 2G /swapfile; then
    dd if=/dev/zero of=/swapfile bs=1M count=2048
  fi
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# -----------------------------------------------------------------------------
# 3. User `deploy` (không phải root) + public key
# -----------------------------------------------------------------------------
if ! id -u deploy >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" deploy
  usermod -aG docker deploy
fi
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
cat > /home/deploy/.ssh/authorized_keys <<'PUBKEY'
__DEPLOY_PUBLIC_KEY__
PUBKEY
chmod 600 /home/deploy/.ssh/authorized_keys
chown deploy:deploy /home/deploy/.ssh/authorized_keys
printf 'deploy ALL=(ALL) NOPASSWD:ALL\n' > /etc/sudoers.d/90-deploy
chmod 440 /etc/sudoers.d/90-deploy

# -----------------------------------------------------------------------------
# 4. Hardening SSH: chỉ key, không password, không root
# -----------------------------------------------------------------------------
cat > /etc/ssh/sshd_config.d/99-bdu.conf <<'SSHD'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
PubkeyAuthentication yes
SSHD
systemctl reload ssh 2>/dev/null || systemctl restart ssh

# -----------------------------------------------------------------------------
# 5. Thư mục app + unattended-upgrades
# -----------------------------------------------------------------------------
install -d -m 755 -o deploy -g deploy __APP_DIR__
dpkg-reconfigure -f noninteractive unattended-upgrades || true

# Dấu hiệu cho `infra.sh deploy` biết cloud-init đã xong.
touch /var/lib/cloud/instance/boot-finished
