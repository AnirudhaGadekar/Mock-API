import fs from 'fs';
import path from 'path';
import madge from 'madge';
import depcheck from 'depcheck';

function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

async function checkCircularDependencies(): Promise<void> {
  console.log('🔎 Checking for circular dependencies...');
  try {
    const result = await madge('src', {
      fileExtensions: ['ts'],
      tsConfig: './tsconfig.json',
    });
    const circular = result.circular();
    if (circular.length > 0) {
      fail(`Circular dependencies detected:\n${circular.map((c) => c.join(' -> ')).join('\n')}`);
    }
  } catch (error) {
    fail(`Error checking circular dependencies.\n${(error as Error).message}`);
  }
}

async function checkUnusedDependencies(): Promise<void> {
  console.log('🔎 Checking for unused dependencies...');
  try {
    const result = await depcheck(process.cwd(), {});
    const hasUnused =
      result.dependencies.length > 0 ||
      result.devDependencies.length > 0 ||
      Object.keys(result.missing).length > 0;

    if (hasUnused) {
      console.warn('⚠️ Dependency issues found:', {
        unusedDependencies: result.dependencies,
        unusedDevDependencies: result.devDependencies,
        missing: result.missing,
      });
    }
  } catch (error) {
    console.warn('Depcheck found issues or failed to run', (error as Error).message);
  }
}

function scanLogs(dir: string): void {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      if (full.includes('scripts')) continue;
      scanLogs(full);
    } else if (file.endsWith('.ts') && !file.includes('seed') && !file.includes('test')) {
      const content = fs.readFileSync(full, 'utf-8');
      if (content.includes('console.log')) {
        fail(`console.log found in ${full}`);
      }
    }
  }
}

function scanTODO(dir: string): void {
  for (const file of fs.readdirSync(dir)) {
    const full = path.join(dir, file);
    if (fs.statSync(full).isDirectory()) {
      if (full.includes('scripts')) continue;
      scanTODO(full);
    } else if (file.endsWith('.ts') && !file.includes('seed') && !file.includes('test')) {
      const content = fs.readFileSync(full, 'utf-8');
      if (/TODO|FIXME/.test(content)) {
        fail(`TODO or FIXME found in ${full}`);
      }
    }
  }
}

async function main(): Promise<void> {
  await checkCircularDependencies();
  await checkUnusedDependencies();

  console.log('🔎 Checking for console.log in source...');
  scanLogs('src');

  console.log('🔎 Checking for TODO or FIXME...');
  scanTODO('src');

  console.log('✅ Static scan passed.');
}

main().catch((error) => {
  fail((error as Error).message);
});
