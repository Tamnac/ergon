/** Saves `content` as a file through the browser's download. */
export function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url));
}
