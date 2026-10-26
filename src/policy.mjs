import fs from 'node:fs/promises';
import path from 'node:path';

const fold = p => process.platform === 'win32' ? p.toLowerCase() : p;
export function within(file, root) {
  const rel=path.relative(fold(root),fold(file));
  return rel === '' || (!rel.startsWith('..'+path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
async function canonical(file) {
  try { return await fs.realpath(file); }
  catch (e) {
    if (e.code !== 'ENOENT') throw e;
    const parent=path.dirname(file);
    if (parent===file) throw e;
    return path.join(await canonical(parent),path.basename(file));
  }
}
export class Policy {
  constructor(config){this.config=config;}
  async resolve(input='.',mode='read') {
    if (typeof input !== 'string' || input.includes('\0') || input.length > 2048) throw Error('Invalid path');
    if (process.platform==='win32' && (/^[\\/]{2}/.test(input) || /:/.test(input.replace(/^[A-Za-z]:/,'')) || input.split(/[\\/]/).some(p=>/[. ]$/.test(p)&&p!=='.'&&p!=='..') || input.split(/[\\/]/).some(p=>/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))) throw Error('Network, device, stream, and ambiguous paths are blocked.');
    const target=path.resolve(this.config.workspace,input);
    const roots=mode==='write'?this.config.writeRoots:[...this.config.readRoots,...this.config.writeRoots];
    if (!roots.some(r=>within(target,r))) throw Error(`Path outside configured ${mode} roots. Default workspace: ${this.config.workspace}`);
    const actual=await canonical(target);
    const realRoots=await Promise.all(roots.map(canonical));
    if (!realRoots.some(r=>within(actual,r))) throw Error('Symlink/junction escapes configured roots.');
    const protectedPaths=[this.config.data,this.config.skillsDir??path.join(this.config.app,'extensions','skills'),path.join(this.config.app,'extensions'),path.join(this.config.app,'.history'),path.join(this.config.app,'src'),path.join(this.config.app,'public'),path.join(this.config.app,'test'),path.join(this.config.app,'scripts'),path.join(this.config.app,'config.json'),path.join(this.config.app,'package.json')];
    if (protectedPaths.some(p=>within(target,p)||within(actual,p))) throw Error('Agent control files are protected from tools.');
    if (actual.split(path.sep).some(p => /^(\.ssh|\.aws|\.azure|\.gnupg|\.git|\.env(?:\..*)?|credentials|id_rsa|id_ed25519)$/i.test(p))) throw Error('Credential and control directories are excluded.');
    return actual;
  }
}
