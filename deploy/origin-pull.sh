#!/usr/bin/env bash
# Makes the CA and the client certificate for zone-level authenticated origin pulls (BE-52, docs/hosting.md). Run it on
# the server as root. Caddy checks the client certificate against rootca.crt with ORIGIN=cloudflare-mtls; Cloudflare
# presents cert.crt with cert.key, which you upload in its dashboard. The CA key is deleted once the certificate is
# signed, so nobody can sign another one; run the script again (with --renew) to replace both before cert.crt ends.
#   deploy/origin-pull.sh [--renew]
set -euo pipefail

dir="${LEVRA_HOME:-/opt/levra}/secrets/caddy"
host="${API_HOST:-api.levra.finance}"

if [ -f "$dir/rootca.crt" ] && [ "${1:-}" != "--renew" ]; then
  echo "$dir/rootca.crt exists. Add --renew to replace the CA and the certificate (then upload the new one first)." >&2
  exit 1
fi

install -d -m 0700 -o 1000 -g 1000 "$dir"
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$work"

# The CA: 5 years. The client certificate: 2 years, not a CA itself (Cloudflare's own steps use these numbers).
openssl req -x509 -new -nodes -newkey rsa:4096 -keyout rootca.key -sha256 -days 1826 -subj "/CN=Levra origin pull CA" -out rootca.crt 2>/dev/null
openssl req -new -nodes -newkey rsa:4096 -keyout cert.key -subj "/CN=$host" -out cert.csr 2>/dev/null
printf 'basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=clientAuth\n' >cert.v3.ext
openssl x509 -req -in cert.csr -CA rootca.crt -CAkey rootca.key -CAcreateserial -days 730 -sha256 -extfile cert.v3.ext -out cert.crt 2>/dev/null
openssl verify -CAfile rootca.crt cert.crt >/dev/null

install -m 0444 -o 1000 -g 1000 rootca.crt "$dir/rootca.crt"
install -m 0400 -o 1000 -g 1000 cert.crt "$dir/cert.crt"
install -m 0400 -o 1000 -g 1000 cert.key "$dir/cert.key"

echo "Made $dir/rootca.crt (Caddy reads it) and the client certificate for Cloudflare."
echo "Ends: $(openssl x509 -in "$dir/cert.crt" -noout -enddate | cut -d= -f2)"
echo
echo "Next, without printing the key anywhere else:"
echo "  1. Cloudflare > SSL/TLS > Origin Server > Authenticated Origin Pulls > Upload certificate: paste the contents"
echo "     of $dir/cert.crt and $dir/cert.key (for example with: sudo cat <file>, copied straight into the form)."
echo "  2. Turn zone-level Authenticated Origin Pulls on."
echo "  3. Delete the key here: shred -u $dir/cert.key ; Cloudflare holds it now."
echo "  4. Set ORIGIN=cloudflare-mtls in caddy.env and run deploy/deploy.sh."
