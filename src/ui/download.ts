/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(text: string, fileName: string, mime = 'text/plain'): void {
  downloadBlob(new Blob([text], { type: `${mime};charset=utf-8` }), fileName);
}

export function downloadGeoJSON(fc: unknown, fileName: string): void {
  downloadText(JSON.stringify(fc, null, 2), fileName, 'application/geo+json');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}
