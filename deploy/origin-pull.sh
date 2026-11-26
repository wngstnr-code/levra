#!/usr/bin/env bash
# Our own CA and client certificate for zone-level authenticated origin pulls (BE-52, docs/hosting.md "Cloudflare in
# front"). Run it on the server as root. Caddy trusts the CAs in caddy-origin/rootca.crt with ORIGIN=cloudflare-mtls;
# Cloudflare presents the client certificate, uploaded with its key in its dashboard. The CA key is deleted once the
# certificate is signed, so nobody can sign another one.
#   deploy/origin-pull.sh            the first CA and certificate
#   deploy/origin-pull.sh --renew    a new CA and certificate; Caddy trusts the old and the new CA until --finish
#   deploy/origin-pull.sh --finish   after Cloudflare presents the new certificate: Caddy trusts only the new CA
# The CA and the certificate are public (caddy-origin, readable by the deploy user); only the key is secret
# (secrets/origin-pull, root only, deleted after the upload).
set -euo pipefail

home="${LEVRA_HOME:-/opt/levra}"
pub="$home/caddy-origin"
priv="$home/secrets/origin-pull"
host="${API_HOST:-api.levra.finance}"
mode="${1:-}"

case "$mode" in
  "")
    if [ -f "$pub/rootca.crt" ]; then
      echo "$pub/rootca.crt exists. To replace it: deploy/origin-pull.sh --renew, then the steps it prints." >&2
      exit 1
    fi
    ;;
  --renew)
    if [ ! -f "$pub/rootca.crt" ]; then
      echo "Nothing to renew: run deploy/origin-pull.sh without --renew first." >&2
      exit 1
    fi
    if [ -f "$pub/rootca.next.crt" ]; then
      echo "A renewal is already in progress: finish it with deploy/origin-pull.sh --finish first." >&2
      exit 1
    fi
    ;;
  --finish)
    if [ ! -f "$pub/rootca.next.crt" ]; then
      echo "No renewal in progress: run deploy/origin-pull.sh --renew first." >&2
      exit 1
    fi
    install -m 0444 -o root -g root "$pub/rootca.next.crt" "$pub/rootca.crt"
    install -m 0444 -o root -g root "$pub/cert.next.crt" "$pub/cert.crt"
    rm -f "$pub/rootca.next.crt" "$pub/cert.next.crt"
    echo "Caddy now trusts only the new CA. Run deploy/deploy.sh, then check /v1/health through the domain."
    exit 0
    ;;
  *)
    echo "Usage: deploy/origin-pull.sh [--renew | --finish]" >&2
    exit 1
    ;;
esac

install -d -m 0755 -o root -g root "$pub"
install -d -m 0700 -o root -g root "$priv"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

# The CA: 5 years. The client certificate: 2 years, not a CA itself (Cloudflare's own steps use these numbers).
openssl req -x509 -new -nodes -newkey rsa:4096 -keyout rootca.key -sha256 -days 1826 -subj "/CN=Levra origin pull CA $(date -u +%Y-%m-%d)" -out rootca.crt
openssl req -new -nodes -newkey rsa:4096 -keyout cert.key -subj "/CN=$host" -out cert.csr
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n' >cert.v3.ext
openssl x509 -req -in cert.csr -CA rootca.crt -CAkey rootca.key -CAcreateserial -days 730 -sha256 -extfile cert.v3.ext -out cert.crt
openssl verify -CAfile rootca.crt cert.crt >/dev/null

install -m 0400 -o root -g root cert.key "$priv/cert.key"
install -m 0400 -o root -g root cert.crt "$priv/cert.crt"
if [ "$mode" = "--renew" ]; then
  # Both CAs in one bundle (Caddy reads every certificate in the file), so the old and the new client certificate pass.
  cat "$pub/rootca.crt" rootca.crt >bundle.crt
  install -m 0444 -o root -g root bundle.crt "$pub/rootca.crt"
  install -m 0444 -o root -g root rootca.crt "$pub/rootca.next.crt"
  install -m 0444 -o root -g root cert.crt "$pub/cert.next.crt"
else
  install -m 0444 -o root -g root rootca.crt "$pub/rootca.crt"
  install -m 0444 -o root -g root cert.crt "$pub/cert.crt"
fi

echo
echo "Client certificate ends $(openssl x509 -in cert.crt -noout -enddate | cut -d= -f2). Write that date in docs/05 (Name and domains)."
echo "Next, without printing the key anywhere else:"
if [ "$mode" = "--renew" ]; then
  echo "  1. deploy/deploy.sh, so Caddy trusts the old and the new CA."
  echo "  2. Cloudflare > SSL/TLS > Origin Server > Authenticated Origin Pulls: upload $priv/cert.crt and $priv/cert.key"
  echo "     (sudo cat each file, copied straight into the form) in place of the old certificate."
  echo "  3. shred -u $priv/cert.key ; check /v1/health through the domain."
  echo "  4. deploy/origin-pull.sh --finish, then deploy/deploy.sh."
else
  echo "  1. Cloudflare > SSL/TLS > Origin Server > Authenticated Origin Pulls > Upload certificate: $priv/cert.crt and"
  echo "     $priv/cert.key (sudo cat each file, copied straight into the form). Turn zone-level on."
  echo "  2. shred -u $priv/cert.key ; Cloudflare holds it now."
  echo "  3. ORIGIN=cloudflare-mtls in caddy.env, then deploy/deploy.sh."
fi
