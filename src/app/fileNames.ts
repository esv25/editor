/**
 * A file name taken from the document's first heading or line, or null if
 * there is no usable text. Without extension.
 */
export function titleFromContent(content: string): string | null {
  // First non-empty line outside code blocks (and not a horizontal rule).
  let inFence = false;
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => {
      if (/^(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence;
        return false;
      }
      return !inFence && line !== '' && !/^[-*_]{3,}$/.test(line);
    });

  const cleaned = (firstLine ?? '')
    .replace(/^#{1,6}\s+/, '') // heading marks
    .replace(/^([-*+]|\d+[.)])\s+(\[[ xX]\]\s+)?/, '') // list / task markers
    .replace(/[*_`~[\]]/g, '') // inline markup
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '') // characters Windows doesn't allow
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, ''); // Windows strips trailing dots/spaces

  if (!cleaned) return null;
  return cleaned.length > 60 ? cleaned.slice(0, 60).trimEnd() : cleaned;
}

/** File name for a new document: its title, or a timestamp. Without extension. */
export function suggestFileName(content: string, now = new Date()): string {
  const title = titleFromContent(content);
  if (title) return title;
  const pad = (n: number) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return `Notat ${date} ${pad(now.getHours())}.${pad(now.getMinutes())}`;
}
