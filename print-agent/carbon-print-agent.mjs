#!/usr/bin/env node
/**
 * Carbon POS print agent.
 *
 * Runs on a PC inside the store. Polls the POS server for print jobs
 * (outbound HTTPS only — no ports to open) and writes each job's raw
 * ESC/POS bytes to the receipt printer on its raw TCP port (9100).
 * The printer host/port come with each job from Settings → Locations,
 * so the only local config is the server URL and the agent key.
 *
 * Requires Node.js 18+. No npm install needed.
 *
 *   node carbon-print-agent.mjs            (reads ./config.json)
 *   node carbon-print-agent.mjs --test     (prints a test slip, then exits)
 */
import { readFileSync, appendFileSync, statSync, truncateSync } from "node:fs";
import { createConnection } from "node:net";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const VERSION = "1.0.0";
const HERE = dirname(fileURLToPath(import.meta.url));
const LOG_FILE = join(HERE, "print-agent.log");

function log(...parts) {
  const line = `${new Date().toISOString()} ${parts.join(" ")}`;
  console.log(line);
  try {
    if (statSync(LOG_FILE, { throwIfNoEntry: false })?.size > 2_000_000) {
      truncateSync(LOG_FILE, 0);
    }
    appendFileSync(LOG_FILE, line + "\n");
  } catch {
    /* logging must never stop printing */
  }
}

function loadConfig() {
  let cfg;
  try {
    cfg = JSON.parse(readFileSync(join(HERE, "config.json"), "utf8"));
  } catch (err) {
    log("Can't read config.json next to the agent:", err.message);
    process.exit(1);
  }
  const server = String(cfg.server ?? "https://pos.shopcarbon.com").replace(/\/+$/, "");
  const token = String(cfg.token ?? "").trim();
  if (!token || token.startsWith("PASTE")) {
    log("config.json has no agent key. Create one in POS → Settings → Locations → Print agent.");
    process.exit(1);
  }
  return { server, token };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Write raw bytes to the printer's TCP port; resolves when sent. */
function sendRaw(host, port, bytes) {
  return new Promise((resolve, reject) => {
    const sock = createConnection({ host, port });
    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      sock.destroy();
      err ? reject(err) : resolve();
    };
    sock.setTimeout(10_000, () => finish(new Error(`printer ${host}:${port} timed out`)));
    sock.on("error", (err) => finish(new Error(`printer ${host}:${port}: ${err.message}`)));
    sock.on("connect", () => {
      sock.end(bytes, () => {
        // Give the printer a moment to drain before closing.
        setTimeout(() => finish(), 300);
      });
    });
  });
}

async function report(cfg, id, ok, error) {
  try {
    await fetch(`${cfg.server}/api/print-agent/jobs/${id}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${cfg.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ ok, error }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    log(`job ${id}: couldn't report result:`, err.message);
  }
}

async function run(cfg) {
  const info = `${hostname()} · agent v${VERSION}`;
  let backoff = 1_000;
  let lastProblem = "";
  log(`Carbon print agent v${VERSION} → ${cfg.server}`);
  for (;;) {
    const started = Date.now();
    try {
      const res = await fetch(`${cfg.server}/api/print-agent/poll`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${cfg.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ info }),
        signal: AbortSignal.timeout(40_000),
      });
      if (res.status === 401) {
        if (lastProblem !== "401") log("Agent key was rejected — create a new one in Settings → Locations and update config.json.");
        lastProblem = "401";
        await sleep(30_000);
        continue;
      }
      if (!res.ok) throw new Error(`server answered ${res.status}`);
      if (lastProblem) log("Connected.");
      lastProblem = "";
      backoff = 1_000;
      const { jobs = [] } = await res.json();
      // The server holds each poll ~20 s; if something returns early with
      // nothing to do, don't spin.
      if (jobs.length === 0 && Date.now() - started < 1_000) await sleep(1_000);
      for (const job of jobs) {
        if (!job.host) {
          await report(cfg, job.id, false, "no printer host set for this location");
          continue;
        }
        try {
          await sendRaw(job.host, job.port || 9100, Buffer.from(job.hex, "hex"));
          log(`job ${job.id}: printed on ${job.host}:${job.port || 9100}`);
          await report(cfg, job.id, true);
        } catch (err) {
          log(`job ${job.id}: FAILED`, err.message);
          await report(cfg, job.id, false, err.message);
        }
      }
    } catch (err) {
      if (lastProblem !== err.message) log("Can't reach the POS server:", err.message);
      lastProblem = err.message;
      await sleep(backoff);
      backoff = Math.min(backoff * 2, 30_000);
    }
  }
}

async function testPrint(host, port) {
  const text = `Carbon print agent test\n${new Date().toLocaleString()}\n${hostname()}\n`;
  const bytes = Buffer.concat([
    Buffer.from([0x1b, 0x40]),
    Buffer.from(text, "ascii"),
    Buffer.from([0x1b, 0x64, 0x04, 0x1d, 0x56, 0x42, 0x00]),
  ]);
  await sendRaw(host, port, bytes);
  log(`Test slip sent to ${host}:${port}.`);
}

if (process.argv.includes("--test")) {
  const i = process.argv.indexOf("--test");
  const host = process.argv[i + 1];
  if (!host) {
    console.log("Usage: node carbon-print-agent.mjs --test <printer-ip> [port]");
    process.exit(1);
  }
  testPrint(host, Number(process.argv[i + 2] || 9100)).catch((err) => {
    log("Test print failed:", err.message);
    process.exit(1);
  });
} else {
  run(loadConfig());
}
