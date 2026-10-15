import type { spawn as nodeSpawn } from 'node:child_process';
type CurlOptions = { method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: string; maxTime?: number };

export function validateAiUrl(value: string): string {
  const u = new URL(value);
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password) throw new Error('AI 地址只支持不含账号密码的 HTTP(S)');
  if (u.protocol === 'http:' && !['localhost','127.0.0.1','[::1]'].includes(u.hostname)) throw new Error('远程 AI 服务必须使用 HTTPS；HTTP 仅限本机回环地址');
  return value;
}
const quote = (s: string) => '"' + s.replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n').replace(/\r/g,'\\r').replace(/\t/g,'\\t') + '"';
/** curl verifies TLS. Credentials and request content go through stdin, never process arguments. */
export function curlJson(url: string, options: CurlOptions = {}): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve, reject) => {
    try {
      validateAiUrl(url);
      const nodeRequire = (0, eval)('require') as (name: string) => { spawn: typeof nodeSpawn };
      const { spawn } = nodeRequire('node:child_process');
      const config = [`url = ${quote(url)}`, `request = ${quote(options.method || 'GET')}`];
      for (const [k,v] of Object.entries(options.headers || {})) {
        if (/[\r\n:]/.test(k) || /[\r\n]/.test(v)) throw new Error('请求头无效');
        config.push(`header = ${quote(`${k}: ${v}`)}`);
      }
      if (options.body !== undefined) config.push(`data = ${quote(options.body)}`);
      const child = spawn(/win/i.test(navigator.userAgent) ? 'curl.exe' : 'curl', ['--disable','--silent','--show-error','--proto','=http,https','--max-time',String(options.maxTime ?? 45),'--write-out','\n__LUBI_STATUS__:%{http_code}','--config','-'], { windowsHide: true, shell: false });
      let out = ''; let failed = false;
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => { out += chunk; if (out.length > 8 * 1024 * 1024) { failed = true; child.kill(); } });
      // Drain stderr but never display server content, URLs or credentials in error notices.
      child.stderr.resume();
      child.on('error', () => reject(new Error('无法启动 curl，请检查桌面网络环境')));
      child.stdin.on('error', () => reject(new Error('curl 请求写入失败')));
      child.stdin.end(config.join('\n') + '\n');
      child.on('close', code => {
        const marker = out.lastIndexOf('\n__LUBI_STATUS__:');
        const status = marker >= 0 ? Number(out.slice(marker + 17).trim()) : 0;
        if (failed || code !== 0 || !status) { reject(new Error(`安全网络请求失败（curl ${code ?? '未知'}）；请核对 HTTPS 证书和连接，不会跳过证书验证`)); return; }
        try { resolve({ status, json: JSON.parse(out.slice(0, marker)) }); } catch { reject(new Error('接口返回的不是 JSON')); }
      });
    } catch (e) { reject(e instanceof Error ? e : new Error('网络请求失败')); }
  });
}
