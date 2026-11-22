#!/usr/bin/env bash
# First-time setup of a fresh Debian 13 (the netcup VPS, D-101) or Ubuntu 24.04 VPS for the backend (BE-90,
# docs/hosting.md). Run once as root:
#   LEVRA_SSH_KEYS_FROM=/root/.ssh/authorized_keys bash setup-server.sh
# Keep the current SSH session open until a new login as levra works: this turns off password and root login.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Run as root." >&2; exit 1; }
. /etc/os-release
case "$ID ${VERSION_ID:-}" in
  "debian 13" | "ubuntu 24.04") ;;
  *) echo "Written for Debian 13 or Ubuntu 24.04, found $PRETTY_NAME." >&2; exit 1 ;;
esac
# Docker publishes one apt repository per distribution, named by the os-release ID.
docker_repo="https://download.docker.com/linux/$ID"

home=/opt/levra
keys_from="${LEVRA_SSH_KEYS_FROM:-/root/.ssh/authorized_keys}"
secret_uid=1000

echo "== packages"
timedatectl set-timezone UTC
export DEBIAN_FRONTEND=noninteractive
# A fresh image runs its own apt jobs right after the first boot. Wait for their lock instead of failing.
apt_get() { apt-get -o DPkg::Lock::Timeout=600 "$@"; }
apt_get update
apt_get -y upgrade
apt_get install -y ca-certificates curl git ufw unattended-upgrades rclone cron

echo "== automatic security updates"
cat >/etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
EOF

echo "== docker"
if ! command -v docker >/dev/null; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL "$docker_repo/gpg" -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] $docker_repo ${VERSION_CODENAME} stable" >/etc/apt/sources.list.d/docker.list
  apt_get update
  apt_get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "== levra user"
if ! id levra >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash levra
fi
# Being in the docker group equals root on this server, so only the team's keys go in authorized_keys.
usermod -aG docker levra
install -d -m 0700 -o levra -g levra /home/levra/.ssh
if [ ! -s /home/levra/.ssh/authorized_keys ]; then
  [ -s "$keys_from" ] || { echo "No SSH keys in $keys_from. Add the team's public keys first." >&2; exit 1; }
  install -m 0600 -o levra -g levra "$keys_from" /home/levra/.ssh/authorized_keys
fi

echo "== ssh: keys only, no root login"
cat >/etc/ssh/sshd_config.d/10-levra.conf <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sshd -t
systemctl reload ssh
# The first value sshd reads wins, so a line in the provider's image could still allow passwords. Check what is in effect.
effective=$(sshd -T)
for want in "passwordauthentication no" "kbdinteractiveauthentication no" "permitrootlogin no"; do
  grep -qx "$want" <<<"$effective" || { echo "sshd still does not have '$want'. Check /etc/ssh/sshd_config and sshd_config.d/." >&2; exit 1; }
done

echo "== firewall: 22, 80 and 443 only"
# Docker publishes only Caddy's 80 and 443; Postgres has no published port.
ufw default deny incoming
ufw default allow outgoing
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

echo "== folders"
install -d -m 0755 -o levra -g levra "$home" "$home/app"
install -d -m 0750 -o levra -g levra "$home/env"
install -d -m 0711 -o root -g root "$home/secrets"
install -d -m 0700 -o levra -g levra "$home/backups"
for service in postgres migrate api indexer-monad keeper-monad keeper-base keeper-xlayer; do
  install -d -m 0700 -o "$secret_uid" -g "$secret_uid" "$home/secrets/$service"
done

echo "== daily backup"
if [ -f "$home/app/deploy/cron/levra-backup" ]; then
  install -m 0644 "$home/app/deploy/cron/levra-backup" /etc/cron.d/levra-backup
else
  echo "Clone the repo to $home/app, then run: install -m 0644 $home/app/deploy/cron/levra-backup /etc/cron.d/levra-backup"
fi

cat <<EOF

Done. Next, as described in docs/hosting.md:
  1. From a new terminal, check that 'ssh levra@<server>' works before closing this session.
  2. As levra: clone the repo to $home/app.
  3. As root: $home/app/deploy/new-secrets.sh, then move or make the other secrets (deploy/secrets.md).
  4. As levra: copy deploy/env/*.env.example to $home/env/ without .example and fill them in.
  5. As levra: $home/app/deploy/deploy.sh
EOF
