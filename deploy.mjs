#!/usr/bin/env node
// deploy.mjs: ship Bellhop Concierge to the Reliable VPS. Idempotent.
//   node deploy.mjs             sync + build (podman, local) + ship image + (re)run container + health
//   node deploy.mjs --status    container state + health
//   node deploy.mjs --logs      tail container logs
//   node deploy.mjs --rollback  re-run the previous image (kept as :prev)
//   node deploy.mjs --sync-env  push local server/.env to the VPS and recreate the container
// Env: DEPLOY_HOST and DEPLOY_USER are required (set them in server/.env or the shell).
// The Caddy route is NOT managed here (root-owned addon dir); see deploy/README.md.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const HOST = process.env.DEPLOY_HOST;
const USER = process.env.DEPLOY_USER;
if (!HOST || !USER) {
  console.error('deploy: set DEPLOY_HOST and DEPLOY_USER (see deploy/README.md)');
  process.exit(2);
}
const TARGET = `${USER}@${HOST}`;
const REMOTE = `/home/${USER}/bellhop-concierge`;
const NAME = 'bellhop-concierge';
const IMAGE = `localhost/${NAME}`;
const PORT = 4040;
const NETWORK = 'localai_default'; // Caddy's network: it reaches us by container name
const SSH_OPTS = ['-o', 'ConnectTimeout=5', '-o', 'BatchMode=yes'];
const LOCAL_ENV = join(ROOT, 'server', '.env');
const TAR = `/tmp/${NAME}-image.tar.gz`;

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: 'inherit', ...opts });
// Run a command on the VPS inside the docker group (the house `sg docker -c` pattern).
const remote = (cmd, { quiet = false } = {}) => {
  const r = spawnSync('ssh', [...SSH_OPTS, TARGET, `sg docker -c '${cmd.replace(/'/g, `'\\''`)}'`],
    { encoding: 'utf8', stdio: quiet ? 'pipe' : ['ignore', 'inherit', 'inherit'] });
  if (r.status !== 0 && !quiet) throw new Error(`remote failed: ${cmd}`);
  return (r.stdout || '').trim();
};

function ensureLocalEnv() {
  if (existsSync(LOCAL_ENV)) return;
  const secret = randomBytes(36).toString('base64'); // 48 chars
  writeFileSync(LOCAL_ENV, `CONCIERGE_TOOL_SECRET=${secret}\nQLOO_MOCK=1\nTICKETMASTER_MOCK=1\nPORT=${PORT}\n`, { mode: 0o600 });
  chmodSync(LOCAL_ENV, 0o600);
  console.log('generated server/.env (secret not printed)');
}

function pushEnv() {
  sh('scp', [...SSH_OPTS, LOCAL_ENV, `${TARGET}:${REMOTE}/.env`]);
  sh('ssh', [...SSH_OPTS, TARGET, `chmod 600 ${REMOTE}/.env`]);
}

function run(image) {
  remote(`docker rm -f ${NAME} >/dev/null 2>&1; docker run -d --name ${NAME} --restart unless-stopped ` +
    `--network ${NETWORK} -p 127.0.0.1:${PORT}:${PORT} --env-file ${REMOTE}/.env ` +
    `-v ${NAME}-data:/app/server/data ${image}`);
}

function health() {
  remote(`sleep 3; curl -s --max-time 5 http://127.0.0.1:${PORT}/health; echo`);
}

const arg = process.argv[2];
if (arg === '--status') {
  console.log(remote(`docker ps -a --filter name=^${NAME}$ --format '{{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}'`, { quiet: true }) || 'not running');
  health(); process.exit(0);
}
if (arg === '--logs') { remote(`docker logs --tail 80 ${NAME}`); process.exit(0); }
if (arg === '--rollback') { run(`${IMAGE}:prev`); health(); process.exit(0); }
if (arg === '--sync-env') { ensureLocalEnv(); pushEnv(); run(`${IMAGE}:latest`); health(); process.exit(0); }

ensureLocalEnv();
console.log('-- sync source (tar over ssh; the VPS has no rsync)');
sh('bash', ['-c', `tar czf - -C ${ROOT} --exclude=node_modules --exclude=server/data --exclude='.env*' --exclude=.git --exclude=.serena . | ` +
  `ssh ${SSH_OPTS.join(' ')} ${TARGET} 'mkdir -p ${REMOTE} && tar xzf - -C ${REMOTE}'`]);
// .env is created on first deploy only; later changes go through --sync-env.
if (!remote(`test -f ${REMOTE}/.env && echo yes`, { quiet: true })) pushEnv();

console.log('-- build (podman, local)');
sh('podman', ['build', '--format', 'docker', '-t', `${IMAGE}:latest`, '-f', 'Containerfile', '.'], { cwd: ROOT });
console.log('-- ship');
sh('bash', ['-c', `podman save ${IMAGE}:latest | gzip > ${TAR}`]);
sh('scp', [...SSH_OPTS, TAR, `${TARGET}:${TAR}`]);
remote(`docker tag ${IMAGE}:latest ${IMAGE}:prev 2>/dev/null || true`);
remote(`gunzip -c ${TAR} | docker load && rm -f ${TAR}`);
console.log('-- run');
run(`${IMAGE}:latest`);
health();
