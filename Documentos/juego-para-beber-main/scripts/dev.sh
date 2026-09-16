#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
# Exact local origins, including the current LAN address for phones on Wi-Fi.
lan_address="$(hostname -I | awk '{print $1}')"
export ASPNETCORE_ENVIRONMENT=Development
export Cors__AllowedOrigins__0=http://localhost:4300
export Cors__AllowedOrigins__1=http://127.0.0.1:4300
if [[ -n "$lan_address" ]]; then
  export Cors__AllowedOrigins__2="http://${lan_address}:4300"
fi
if [[ ! -d frontend/node_modules ]]; then
  (cd frontend && npm ci)
fi
dotnet run --project backend/Aproximados.Api --urls http://0.0.0.0:5000 &
api_pid=$!
(cd frontend && exec npm start -- --host 0.0.0.0 --port 4300) &
web_pid=$!
cleanup() {
  kill "$api_pid" "$web_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 130' INT TERM
printf 'Aproximados: http://localhost:4300\nMóvil (misma Wi-Fi): http://%s:4300\n' "${lan_address:-localhost}"
wait -n "$api_pid" "$web_pid"
