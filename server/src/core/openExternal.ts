import { execFile } from 'node:child_process';

/**
 * Otwiera link w domyślnej przeglądarce systemu (poza panelem), żeby zewnętrzne strony
 * nie zastępowały karty z aplikacją. Bez powłoki: adres idzie jako pojedynczy argument.
 */
export function openExternal(url: string): Promise<void> {
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
        : ['xdg-open', [url]];
  return new Promise((resolve, reject) => {
    const child = execFile(cmd, args, { timeout: 10_000 }, (err) => (err ? reject(err) : resolve()));
    child.unref();
  });
}
