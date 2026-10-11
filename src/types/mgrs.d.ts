declare module 'mgrs' {
  /** 十进制 [lng, lat] -> MGRS 字符串（默认精度 1m 等高精度） */
  export function forward(ll: [number, number], accuracy?: number): string;
  /** MGRS 字符串 -> WGS84 包围盒 [minX, minY, maxX, maxY] */
  export function inverse(mgrs: string): [number, number, number, number];
  /** MGRS 字符串 -> WGS84 中心点 [lng, lat] */
  export function toPoint(mgrs: string): [number, number];
}
