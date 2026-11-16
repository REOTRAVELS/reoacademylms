import { spawnSync } from 'node:child_process';

const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const runNpm = (args, env = process.env) => {
  const result = spawnSync(npmCommand, args, {
    env,
    shell: process.platform === 'win32',
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
};

if (process.env.VERCEL_ENV === 'production') {
  if (!process.env.DIRECT_URL) {
    throw new Error('DIRECT_URL is required to apply production database migrations.');
  }

  runNpm(['run', 'prisma:deploy', '--workspace', 'server'], {
    ...process.env,
    DATABASE_URL: process.env.DIRECT_URL,
  });
}

runNpm(['run', 'prisma:generate', '--workspace', 'server']);
runNpm(['run', 'build']);
