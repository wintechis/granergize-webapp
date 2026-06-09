/// <reference lib="deno.ns" />
import { strict as assert } from "node:assert";
import { isReapableServer, parseListenerPids } from "./reapStaleServers.ts";

Deno.test("parseListenerPids extracts the pid= tokens from ss output", () => {
  const ss =
    `LISTEN 0 511 *:3456 *:* users:(("node",pid=27770,fd=21))\n` +
    `LISTEN 0 511 127.0.0.1:3457 0.0.0.0:* users:(("deno",pid=27769,fd=25))\n`;
  assert.deepEqual(parseListenerPids(ss).sort((a, b) => a - b), [27769, 27770]);
});

Deno.test("parseListenerPids dedupes and returns [] when no pid is present", () => {
  assert.deepEqual(parseListenerPids(""), []);
  assert.deepEqual(parseListenerPids("LISTEN 0 511 *:3456 *:*"), []);
  assert.deepEqual(parseListenerPids("pid=42 ... pid=42"), [42]);
});

Deno.test("isReapableServer matches our test servers", () => {
  assert.ok(isReapableServer(
    "node /home/u/.npm/_npx/x/node_modules/.bin/community-solid-server -p 3456",
  ));
  assert.ok(isReapableServer("node .../jss start --idp --conneg -p 3456 -r /tmp/jss-it-x"));
  assert.ok(isReapableServer("npx --yes -p javascript-solid-server@0.0.205 jss start"));
  assert.ok(isReapableServer("deno run -A npm:vite preview --port 4183 --strictPort"));
  assert.ok(isReapableServer("deno run -A test/e2e-local/css.ts"));
});

Deno.test("isReapableServer leaves unrelated processes alone", () => {
  assert.ok(!isReapableServer("/usr/lib/postgresql/16/bin/postgres -D /var/lib/pg"));
  assert.ok(!isReapableServer("node /home/u/some-other-app/server.js"));
  assert.ok(!isReapableServer("sshd: user@pts/0"));
});
