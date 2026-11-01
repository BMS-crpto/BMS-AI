/**
 * Read-only GitHub and Render connectors, driven by chat commands:
 *
 *   /github repos
 *   /github files <repo> [path]
 *   /github read <repo> <path>
 *   /github commits <repo>
 *   /render services
 *   /render deploys <service name>
 *
 * Only accounts listed in ADMIN_EMAILS may use them. Tokens stay on the server.
 * Every request is a GET: nothing here can change, commit or redeploy anything.
 */

const TIMEOUT_MS = 10_000;
const MAX_CHARS = 12_000;
const GITHUB_OWNER = () => process.env.GITHUB_OWNER || 'BMS-crpto';

export type ConnectorCommand = { service: 'github' | 'render'; action: string; args: string[]; rest: string };

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = (process.env.ADMIN_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(email.toLowerCase());
}

export function parseCommand(text: string): ConnectorCommand | null {
  const [first, ...others] = text.trim().split('\n');
  const m = first.trim().match(/^\/(github|render)\s+([a-z]+)(?:\s+(.*))?$/i);
  if (!m) return null;
  return {
    service: m[1].toLowerCase() as 'github' | 'render',
    action: m[2].toLowerCase(),
    args: (m[3] || '').split(/\s+/).filter(Boolean),
    rest: others.join('\n').trim(),
  };
}

const BLOCKED_PATH = /(^|\/)(\.env[^/]*|.*\.pem|.*\.key|id_rsa[^/]*|\.npmrc|secrets?[^/]*)$/i;

async function getJson(url: string, headers: Record<string, string>, service: string): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new Error(`${service} did not respond. Try again in a moment.`);
  }
  if (res.status === 401 || res.status === 403) throw new Error(`${service} rejected the token. Check the token and its permissions in Render's Environment settings.`);
  if (res.status === 404) throw new Error(`${service} could not find that (check the name or path).`);
  if (res.status === 429) throw new Error(`${service} rate limit reached. Try again shortly.`);
  if (!res.ok) throw new Error(`${service} returned an error (HTTP ${res.status}).`);
  return res.json();
}

const gh = (path: string) =>
  getJson(`https://api.github.com${path}`, {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'BMS-AI',
  }, 'GitHub');

const rd = (path: string) =>
  getJson(`https://api.render.com/v1${path}`, {
    Authorization: `Bearer ${process.env.RENDER_API_KEY}`,
    Accept: 'application/json',
  }, 'Render');

function repoPath(arg: string | undefined): string {
  if (!arg) throw new Error('Add a repository name, for example: /github files BMS-AI');
  const full = arg.includes('/') ? arg : `${GITHUB_OWNER()}/${arg}`;
  if (!/^[\w.-]+\/[\w.-]+$/.test(full)) throw new Error('That repository name looks invalid.');
  return full;
}

function cap(text: string): string {
  return text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + '\n\n(shortened)' : text;
}

async function githubCommand(c: ConnectorCommand): Promise<string> {
  if (!process.env.GITHUB_TOKEN) throw new Error('GitHub is not connected. Add GITHUB_TOKEN in Render → Environment.');
  switch (c.action) {
    case 'repos': {
      const repos = await gh('/user/repos?per_page=30&sort=updated');
      if (!repos.length) return 'No repositories visible to this token.';
      return repos.map((r: any) => `• ${r.full_name}${r.private ? ' (private)' : ''}, updated ${String(r.pushed_at || r.updated_at).slice(0, 10)}`).join('\n');
    }
    case 'files': {
      const repo = repoPath(c.args[0]);
      const path = (c.args[1] || '').replace(/^\/+/, '');
      const items = await gh(`/repos/${repo}/contents/${encodeURI(path)}`);
      if (!Array.isArray(items)) return `${path} is a file. Use /github read ${c.args[0]} ${path}`;
      return `${repo}/${path}\n` + items.map((i: any) => `${i.type === 'dir' ? '📁' : '📄'} ${i.name}`).join('\n');
    }
    case 'read': {
      const repo = repoPath(c.args[0]);
      const path = (c.args[1] || '').replace(/^\/+/, '');
      if (!path) throw new Error('Add a file path, for example: /github read BMS-AI package.json');
      if (BLOCKED_PATH.test(path)) throw new Error('For safety, secret-looking files (.env, keys) cannot be read.');
      const file = await gh(`/repos/${repo}/contents/${encodeURI(path)}`);
      if (Array.isArray(file)) throw new Error('That is a folder. Use /github files instead.');
      if (file.size > 100_000 || !file.content) throw new Error('That file is too large or not readable as text.');
      return cap(`${repo}/${path}\n\n` + Buffer.from(String(file.content), 'base64').toString('utf8'));
    }
    case 'commits': {
      const repo = repoPath(c.args[0]);
      const commits = await gh(`/repos/${repo}/commits?per_page=10`);
      return commits.map((k: any) => `• ${String(k.sha).slice(0, 7)}  ${String(k.commit.author?.date || '').slice(0, 10)}  ${String(k.commit.message).split('\n')[0]}`).join('\n');
    }
    default:
      throw new Error('GitHub commands: repos, files <repo> [path], read <repo> <path>, commits <repo>');
  }
}

async function renderCommand(c: ConnectorCommand): Promise<string> {
  if (!process.env.RENDER_API_KEY) throw new Error('Render is not connected. Add RENDER_API_KEY in Render → Environment.');
  const services = async () => (await rd('/services?limit=20')).map((s: any) => s.service);
  switch (c.action) {
    case 'services': {
      const list = await services();
      if (!list.length) return 'No services found.';
      return list.map((s: any) => `• ${s.name} (${s.type})${s.suspended === 'suspended' ? ' [suspended]' : ''} ${s.serviceDetails?.url || ''}`.trim()).join('\n');
    }
    case 'deploys': {
      const name = c.args.join(' ').toLowerCase();
      if (!name) throw new Error('Add a service name, for example: /render deploys bms-ai');
      const svc = (await services()).find((s: any) => s.name.toLowerCase() === name || s.id === name || s.name.toLowerCase().includes(name));
      if (!svc) throw new Error('No Render service matches that name. Try /render services');
      const deploys = (await rd(`/services/${encodeURIComponent(svc.id)}/deploys?limit=5`)).map((d: any) => d.deploy);
      return `${svc.name}: last deploys\n` + deploys.map((d: any) =>
        `• ${d.status}  ${String(d.createdAt || '').slice(0, 16).replace('T', ' ')}  ${String(d.commit?.message || d.trigger || '').split('\n')[0].slice(0, 70)}`).join('\n');
    }
    default:
      throw new Error('Render commands: services, deploys <service name>');
  }
}

export async function runCommand(c: ConnectorCommand): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const text = c.service === 'github' ? await githubCommand(c) : await renderCommand(c);
    return { ok: true, text };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'The connector failed.' };
  }
}
