#!/usr/bin/env bash
# Tier-4 (browser × real Pods) orchestration. ONE env file (test/.env.e2e.local) holds all
# four accounts; the binding is by GROUP, not per spec:
#
#   A, B = solidcommunity Pods  → the SHARING specs (share-building, share-view)
#   C    = solidweb  (NSS)      ┐  the SOLO specs, one Pod per run, picked by
#   D    = redpencil (CSS v5)   ┘  E2E_SOLO (slot id). C and D are different hosts,
#                                  so the two solo runs go fully in parallel.
#
#   test/run-e2e.sh            # all three groups in parallel: solo C, solo D, sharing
#   test/run-e2e.sh solo       # just the two solo runs (parallel)
#   test/run-e2e.sh sharing    # just the sharing run (A+B)
#   test/run-e2e.sh support    # handbuch screenshots (account A)
#
# The three groups hit THREE different hosts (solidweb / redpencil / solidcommunity),
# so they overlap without contending — running sharing alongside the solo pair adds
# no extra load on solidcommunity (only the sharing run touches it).
#
# Logs stream to /tmp/e2e-<tag>.log (the runs are quiet on stdout so the parallel
# output doesn't interleave). Override the env file with E2E_ENV_FILE=...
set -uo pipefail
cd "$(dirname "$0")/.."
ENV_FILE="${E2E_ENV_FILE:-test/.env.e2e.local}"
PORT=4173
mode="${1:-all}"

[ -f "$ENV_FILE" ] || {
  echo "missing $ENV_FILE — cp test/.env.e2e.example $ENV_FILE and fill it in" >&2
  exit 2
}
set -a; . "./$ENV_FILE"; set +a

# One shared Vite dev server; every Playwright run reuses it (reuseExistingServer
# in playwright.config.ts), so the parallel solo runs don't race to bind the port.
deno run -A npm:vite dev --port "$PORT" --strictPort >/tmp/e2e-vite.log 2>&1 &
vite=$!
trap 'kill "$vite" 2>/dev/null' EXIT
for _ in $(seq 1 60); do
  curl -fsS "http://localhost:$PORT" >/dev/null 2>&1 && break
  sleep 1
done

# run <project> <log-tag> [VAR=val ...] — extra env assignments scope the run.
run() {
  local proj="$1" tag="$2"; shift 2
  env "$@" npx playwright test --project="$proj" \
    --output="test-results/$tag" >"/tmp/e2e-$tag.log" 2>&1
}

rc=0
pids=()
case "$mode" in
  all | solo)
    echo "solo → solidweb (E2E_SOLO=C) + redpencil (E2E_SOLO=D)…"
    run solo solidweb E2E_SOLO=C &
    pids+=($!)
    run solo redpencil E2E_SOLO=D &
    pids+=($!)
    ;;
esac
case "$mode" in
  all | sharing)
    echo "sharing → solidcommunity A+B…"
    run sharing sharing &
    pids+=($!)
    ;;
esac
case "$mode" in
  support)
    echo "screenshots → solidcommunity A…"
    run support support &
    pids+=($!)
    ;;
esac

# All selected groups run concurrently (different hosts → no contention); wait for
# every one, failing the whole run if any group fails.
for p in "${pids[@]}"; do wait "$p" || rc=1; done

echo "done (rc=$rc). logs: /tmp/e2e-{solidweb,redpencil,sharing,support}.log"
exit $rc
