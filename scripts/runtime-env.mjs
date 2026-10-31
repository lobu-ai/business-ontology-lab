import fs from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
await fs.mkdir('.runtime', { recursive: true });
try {
  await fs.writeFile(
    '.runtime/runtime.env',
    'ENCRYPTION_KEY=' + randomBytes(32).toString('base64') + '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Created ignored local runtime configuration');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Reusing existing local runtime configuration');
}
