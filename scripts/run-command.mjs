import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

function processIsRunning(child) {
  return child.exitCode === null && child.signalCode === null;
}

function terminateProcessTree(child, signal, includeExitedLeader = false) {
  if (!includeExitedLeader && !processIsRunning(child)) return;

  if (process.platform === 'win32') {
    if (signal === 'SIGKILL') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill(signal);
    }
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== 'ESRCH' && processIsRunning(child)) child.kill(signal);
  }
}

export function runCommand(label, command, args, options = {}) {
  const {
    env = process.env,
    cwd = process.cwd(),
    timeoutMs = 120_000,
    allowFailure = false,
    stdio = 'inherit'
  } = options;

  // Process-group cleanup currently has a reliable POSIX implementation only.
  // Fail closed on Windows instead of claiming descendants were cleaned.
  if (process.platform === 'win32') {
    const error = new Error('Safe test runner hiện chỉ hỗ trợ POSIX process-group cleanup.');
    error.code = 'UNSUPPORTED_TEST_PLATFORM';
    return Promise.resolve({ code: 1, failed: !allowFailure, label, error, timedOut: false });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timedOut = false;
    let forceKillTimer;

    const child = spawn(command, args, {
      cwd,
      env,
      stdio,
      shell: false,
      detached: process.platform !== 'win32'
    });

    const forceKill = () => {
      if (forceKillTimer) return;
      forceKillTimer = setTimeout(() => {
        // Parent có thể đã nhận SIGTERM và đóng trước descendant. Vẫn gửi
        // SIGKILL theo process-group id để dọn descendant còn sống.
        terminateProcessTree(child, 'SIGKILL', true);
      }, 2_000);
    };

    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKillTimer && !timedOut) clearTimeout(forceKillTimer);
      process.removeListener('SIGINT', onSigint);
      process.removeListener('SIGTERM', onSigterm);
      resolve(result);
    };

    const onSigint = () => {
      timedOut = true;
      terminateProcessTree(child, 'SIGTERM');
      forceKill();
      setTimeout(() => process.exit(130), 3_000).unref?.();
    };
    const onSigterm = () => {
      timedOut = true;
      terminateProcessTree(child, 'SIGTERM');
      forceKill();
      setTimeout(() => process.exit(143), 3_000).unref?.();
    };

    process.once('SIGINT', onSigint);
    process.once('SIGTERM', onSigterm);

    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child, 'SIGTERM');
      forceKill();
    }, timeoutMs);
    timer.unref?.();

    child.on('error', (error) => {
      finish({ code: 1, failed: !allowFailure, label, error, timedOut });
    });

    child.on('close', (code, signal) => {
      // Một test process không được để lại background child sau khi leader
      // thoát, kể cả exit code 0. Dọn process group trước khi báo hoàn tất.
      terminateProcessTree(child, 'SIGKILL', true);
      finish({
        code: code ?? 1,
        failed: !allowFailure && (code !== 0 || timedOut),
        label,
        signal,
        timedOut
      });
    });
  });
}
