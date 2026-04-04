import { spawn } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldRetry(output) {
  const lower = output.toLowerCase();
  return lower.includes('spawn eperm') || lower.includes('syscall: \'spawn\'');
}

function getWindowsEsbuildSource(rootDir) {
  if (process.platform !== 'win32') return null;

  const archMap = {
    x64: 'win32-x64',
    arm64: 'win32-arm64',
    ia32: 'win32-ia32',
  };

  const esbuildArch = archMap[process.arch] ?? `win32-${process.arch}`;
  const candidates = [
    path.join(rootDir, 'node_modules', 'vite', 'node_modules', '@esbuild', esbuildArch, 'esbuild.exe'),
    path.join(rootDir, 'node_modules', '@esbuild', esbuildArch, 'esbuild.exe'),
  ];

  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

function configureWindowsEsbuild(rootDir) {
  if (process.platform !== 'win32') return;

  const sourceBinary = getWindowsEsbuildSource(rootDir);
  if (!sourceBinary) return;

  const tempDir = path.join(os.tmpdir(), 'mockapi-esbuild');
  mkdirSync(tempDir, { recursive: true });
  const targetBinary = path.join(tempDir, `esbuild-${process.pid}-${Date.now()}.exe`);
  copyFileSync(sourceBinary, targetBinary);

  process.env.ESBUILD_BINARY_PATH = targetBinary;
  process.env.ESBUILD_WORKER_THREADS = '0';
}

async function runVitest(args) {
  return new Promise((resolve) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const vitestEntrypoint = path.resolve(__dirname, '..', 'node_modules', 'vitest', 'vitest.mjs');
    const command = existsSync(vitestEntrypoint) ? process.execPath : 'npx';
    const commandArgs = existsSync(vitestEntrypoint) ? [vitestEntrypoint, ...args] : ['vitest', ...args];

    let settled = false;
    let combined = '';
    const finish = (payload) => {
      if (settled) return;
      settled = true;
      resolve(payload);
    };

    let child;
    try {
      child = spawn(command, commandArgs, {
        stdio: ['inherit', 'pipe', 'pipe'],
      });
    } catch (err) {
      combined += String(err?.message || err);
      finish({ code: 1, output: combined });
      return;
    }

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', (chunk) => {
      const text = chunk.toString();
      combined += text;
      process.stderr.write(text);
    });

    child.on('error', (err) => {
      combined += String(err?.message || err);
      finish({ code: 1, output: combined });
    });

    child.on('close', (code) => {
      finish({ code: code ?? 1, output: combined });
    });
  });
}

async function main() {
  const args = process.argv.slice(2);
  const retries = Number(process.env.VITEST_EPERM_RETRIES ?? '3');
  const baseDelayMs = Number(process.env.VITEST_EPERM_RETRY_DELAY_MS ?? '1200');
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const projectRoot = path.resolve(__dirname, '..');

  for (let attempt = 1; attempt <= retries; attempt++) {
    configureWindowsEsbuild(projectRoot);
    const result = await runVitest(args);
    if (result.code === 0) {
      process.exit(0);
    }

    const retryable = shouldRetry(result.output);
    const hasAttemptsLeft = attempt < retries;
    if (!retryable || !hasAttemptsLeft) {
      process.exit(result.code);
    }

    const delay = baseDelayMs * attempt;
    process.stderr.write(
      `\n[vitest-retry] Detected transient spawn EPERM, retrying (${attempt + 1}/${retries}) in ${delay}ms...\n`,
    );
    await sleep(delay);
  }
}

main();
