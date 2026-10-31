import { build } from 'esbuild';
export async function bundleScript(filename) {
  const result = await build({
    entryPoints: [filename],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'silent',
    legalComments: 'none',
  });
  return result.outputFiles[0].text;
}
