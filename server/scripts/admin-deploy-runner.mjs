#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

const WORKER_FLAG = "--detached-worker";
const rawArgs = process.argv.slice(2);

// PM2 reloads the main application by terminating its process tree. A single
// detached child is still a descendant of that tree, so launch a second-stage
// worker and let this short-lived launcher exit before deployment begins.
if (rawArgs[0] !== WORKER_FLAG) {
  const worker = spawn(process.execPath, [process.argv[1], WORKER_FLAG, ...rawArgs], {
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  worker.unref();
  process.exit(0);
}

const [root, statusDir, id, requestedAt, rawOperatorId, rawAllowSchemaExpand] = rawArgs.slice(1);
const operatorId = Number(rawOperatorId);
const allowSchemaExpand = rawAllowSchemaExpand === "1" ? "1" : "0";
const startedAt = new Date().toISOString();
const statusPath = path.join(statusDir || "", "status.json");
const lockPath = path.join(statusDir || "", "deploy.lock");
const logPath = path.join(statusDir || "", "deploy.log");
const deployTimeoutSeconds = (() => {
  const parsed = Number(process.env.ADMIN_DEPLOY_TIMEOUT_SECONDS || "1800");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1800;
})();
const killGraceMs = (() => {
  const parsed = Number(process.env.ADMIN_DEPLOY_KILL_GRACE_MS || "10000");
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 10000;
})();
let logFd = null;
let finished = false;
let child = null;
let watchdog = null;
let forceKillTimer = null;
let timedOut = false;

function writeStatus(state) {
  mkdirSync(statusDir, { recursive: true, mode: 0o700 });
  const temporary = `${statusPath}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify({ version: 1, ...state }, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, statusPath);
}

function appendLog(message) {
  if (logFd === null) return;
  writeSync(logFd, `${message}\n`);
}

function currentCommit() {
  try {
    return execFileSync("git", ["-C", root, "rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 3_000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function finish(phase, exitCode, message) {
  if (finished) return;
  finished = true;
  if (watchdog) clearTimeout(watchdog);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  const deployedCommit = currentCommit();
  try {
    appendLog(`[admin-deploy] ${message}${deployedCommit ? ` (${deployedCommit.slice(0, 12)})` : ""}`);
    writeStatus({
      id,
      phase,
      requestedAt,
      startedAt,
      finishedAt: new Date().toISOString(),
      operatorId,
      pid: process.pid,
      exitCode,
      deployedCommit,
      message,
    });
  } finally {
    rmSync(lockPath, { force: true });
    if (logFd !== null) closeSync(logFd);
  }
  process.exitCode = phase === "success" ? 0 : 1;
}

function signalChildProcessGroup(signal) {
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") appendLog(`[admin-deploy] 无法向部署进程组发送 ${signal}：${error.message}`);
  }
}

function stopDeployment(reason) {
  if (finished || timedOut) return;
  timedOut = true;
  appendLog(`[admin-deploy] ${reason}，正在终止部署进程组`);
  signalChildProcessGroup("SIGTERM");
  forceKillTimer = setTimeout(() => signalChildProcessGroup("SIGKILL"), killGraceMs);
  forceKillTimer.unref();
}

try {
  if (
    !root
    || !statusDir
    || !id
    || !requestedAt
    || !Number.isInteger(operatorId)
    || operatorId <= 0
    || rawAllowSchemaExpand !== "1"
  ) {
    throw new Error("runner 参数不完整");
  }
  const deployScript = path.join(root, "deploy.sh");
  if (!existsSync(deployScript)) throw new Error("deploy.sh 不存在");
  const bashPath = existsSync("/usr/bin/bash") ? "/usr/bin/bash" : "/bin/bash";
  if (!existsSync(bashPath)) throw new Error("Bash 不存在");

  mkdirSync(statusDir, { recursive: true, mode: 0o700 });
  logFd = openSync(logPath, "w", 0o600);
  appendLog(`[admin-deploy] ${startedAt} 管理员 #${operatorId} 发起更新部署`);
  appendLog(`[admin-deploy] 执行固定命令: bash deploy.sh update`);
  appendLog(`[admin-deploy] 管理员 #${operatorId} 已确认仅执行向后兼容的扩展迁移`);
  writeStatus({
    id,
    phase: "running",
    requestedAt,
    startedAt,
    finishedAt: null,
    operatorId,
    pid: process.pid,
    exitCode: null,
    deployedCommit: "",
    message: "正在拉取代码并执行增量部署",
  });

  child = spawn(bashPath, [deployScript, "update"], {
    cwd: root,
    env: {
      ...process.env,
      CPU_WEB_ADMIN_DEPLOY: "1",
      DEPLOY_BUILD_MODE: "ci",
      DEPLOY_ALLOW_SCHEMA_EXPAND: allowSchemaExpand,
    },
    detached: process.platform !== "win32",
    stdio: ["ignore", logFd, logFd],
  });
  watchdog = setTimeout(
    () => stopDeployment(`部署执行超过 ${deployTimeoutSeconds} 秒`),
    deployTimeoutSeconds * 1000,
  );
  watchdog.unref();
  child.once("error", (error) => finish("failed", 1, `部署命令启动失败：${error.message}`));
  child.once("close", (code, signal) => {
    if (timedOut) finish("failed", 124, `部署执行超过 ${deployTimeoutSeconds} 秒，已终止并释放部署锁`);
    else if (code === 0) finish("success", 0, "更新部署完成");
    else finish("failed", Number.isInteger(code) ? code : 1, `更新部署失败${signal ? `（${signal}）` : ""}`);
  });
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  try {
    if (logFd === null && statusDir) {
      mkdirSync(statusDir, { recursive: true, mode: 0o700 });
      logFd = openSync(logPath, "a", 0o600);
    }
    finish("failed", 1, `部署 runner 启动失败：${message}`);
  } catch {
    rmSync(lockPath, { force: true });
    process.exitCode = 1;
  }
}
