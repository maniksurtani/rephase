import { writeFile } from 'node:fs/promises';
import { buildDeploymentConfig, configurationHelp, deploymentConfigPath, isMainModule, readBaseConfig } from './check-deploy-config.mjs';

export async function configureCloudflare(env = process.env) {
  const config = buildDeploymentConfig(await readBaseConfig(), env);
  await writeFile(deploymentConfigPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  return config;
}

if (isMainModule(import.meta.url)) {
  try {
    const args = process.argv.slice(2);
    if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
      console.log(`Usage: node scripts/configure-cloudflare.mjs [--help]\n${configurationHelp}\nWrites ignored wrangler.deploy.json locally; no remote resources are changed.`);
    } else {
      if (args.length) throw new Error('Unknown option. Usage: node scripts/configure-cloudflare.mjs [--help]');
      await configureCloudflare();
      console.log('Prepared ignored wrangler.deploy.json with public settings. No remote resources were changed.');
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
