declare module 'qrcode/lib/browser.js' {
  export interface QRToCanvasOptions {
    width?: number;
    margin?: number;
    color?: { dark?: string; light?: string };
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
  }
  export function toCanvas(
    canvas: HTMLCanvasElement,
    text: string,
    options?: QRToCanvasOptions
  ): Promise<HTMLCanvasElement>;
  const QRCode: { toCanvas: typeof toCanvas };
  export default QRCode;
}
