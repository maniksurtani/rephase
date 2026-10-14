import { execFileSync } from 'node:child_process';
import { isMainModule, projectRoot } from './check-deploy-config.mjs';

export function validateGithubRemote(url) {
  if (typeof url !== 'string' || !/^(?:https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*(?:\.git)?$/.test(url)) {
    throw new Error('Use an HTTPS or SSH GitHub repository URL without credentials, query strings or shell syntax.');
  }
  return url;
}

function git(args) {
  return execFileSync('git', args, {
    cwd: projectRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  }).trim();
}

export function githubRemote(args = process.argv.slice(2)) {
  if (args.includes('--help')) {
    console.log('Usage: npm run github:remote -- --url https://github.com/OWNER/REPO.git [--check-empty] [--configure]\nDefault only prints commands. --check-empty reads the remote; --configure adds origin locally. Never pushes, replaces a remote or creates a GitHub repository.');
    return;
  }
  let url;
  let configure = false;
  let checkEmpty = false;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--url') url = args[++i];
    else if (args[i] === '--configure') configure = true;
    else if (args[i] === '--check-empty') checkEmpty = true;
    else throw new Error('Unrecognized option. Use --help for GitHub remote setup.');
  }
  validateGithubRemote(url);
  const branch = git(['branch', '--show-current']);
  if (!branch || !/^[A-Za-z0-9_./-]+$/.test(branch)) throw new Error('Check out a named local branch before configuring the remote.');
  let existing;
  try { existing = git(['remote', 'get-url', 'origin']); } catch { existing = null; }
  if (existing && existing.replace(/\.git$/, '') !== url.replace(/\.git$/, '')) {
    throw new Error('An origin remote already exists with a different URL. It was preserved. Inspect git remote -v before proceeding.');
  }
  if (checkEmpty) {
    let references;
    try { references = git(['ls-remote', url]); }
    catch { throw new Error('Could not read the remote. Check that it exists and that GitHub authentication works.'); }
    if (references) throw new Error('The remote already contains commits/references. No remote or history was changed. Use an empty repository or reconcile its history first.');
    console.log('The GitHub remote is empty.');
  }
  if (configure && !existing) {
    git(['remote', 'add', 'origin', url]);
    console.log('Added origin locally. No code was pushed.');
  } else if (!existing) console.log(`git remote add origin ${url}`);
  console.log(`git push -u origin ${branch}`);
  console.log('Run the push only when you are ready to upload the source. For HTTPS, authenticate with GitHub CLI or a credential manager; SSH uses your GitHub SSH key.');
}

if (isMainModule(import.meta.url)) {
  try { githubRemote(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
