import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runner = fileURLToPath(new URL("../scripts/admin-deploy-runner.mjs", import.meta.url));

test("admin deployment runner terminates a hung process group and releases its lock", { skip: process.platform === "win32" }, () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "cpu-admin-deploy-runner-"));
  const statusDir = path.join(root, ".git", "cpu-web-admin-deploy");
  try {
    mkdirSync(path.join(root, "server"), { recursive: true });
    mkdirSync(statusDir, { recursive: true });
    writeFileSync(
      path.join(root, "deploy.sh"),
      "#!/usr/bin/env bash\nprintf '%s' \"$DEPLOY_ALLOW_SCHEMA_EXPAND\" > schema-expand.txt\ntrap '' TERM\nsleep 30 &\nwait\n",
    );
    writeFileSync(path.join(statusDir, "deploy.lock"), "locked\n");

    const requestedAt = new Date().toISOString();
    const result = spawnSync(process.execPath, [
      runner,
      "--detached-worker",
      root,
      statusDir,
      "timeout-test",
      requestedAt,
      "11",
      "1",
    ], {
      env: {
        ...process.env,
        ADMIN_DEPLOY_TIMEOUT_SECONDS: "1",
        ADMIN_DEPLOY_KILL_GRACE_MS: "100",
      },
      encoding: "utf8",
      timeout: 5_000,
    });

    assert.equal(result.signal, null);
    assert.equal(result.status, 1);
    assert.equal(existsSync(path.join(statusDir, "deploy.lock")), false);
    const status = JSON.parse(readFileSync(path.join(statusDir, "status.json"), "utf8"));
    assert.equal(status.phase, "failed");
    assert.equal(status.exitCode, 124);
    assert.equal(readFileSync(path.join(root, "schema-expand.txt"), "utf8"), "1");
    assert.match(status.message, /已终止并释放部署锁/u);
    const log = readFileSync(path.join(statusDir, "deploy.log"), "utf8");
    assert.match(log, /已确认仅执行向后兼容的扩展迁移/u);
    assert.match(log, /正在终止部署进程组/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
