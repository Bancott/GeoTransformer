import { describe, it, expect } from 'vitest';
import { reprojectCoord, projectionKind, MERC_CODE_GCJ, MERC_CODE_BD09 } from '@/core/reproject';

describe('GCJ/BD 墨卡托复合投影', () => {
  it('projectionKind 判定', () => {
    expect(projectionKind(MERC_CODE_GCJ)).toBe('projected');
    expect(projectionKind(MERC_CODE_BD09)).toBe('projected');
    expect(projectionKind('GCJ02')).toBe('geographic');
  });
  it('4326 -> GCJ 墨卡托输出为米（大幅值）', () => {
    const out = reprojectCoord([116.39, 39.9], 'EPSG:4326', MERC_CODE_GCJ);
    expect(Math.abs(out[0])).toBeGreaterThan(1e6);
    expect(Math.abs(out[1])).toBeGreaterThan(1e5);
  });
  it('与 WGS84 往返一致（经 GCJ 中间坐标系）', () => {
    const src: [number, number] = [116.39128, 39.90752];
    const toMerc = reprojectCoord(src, 'EPSG:4326', MERC_CODE_GCJ);
    const back = reprojectCoord(toMerc, MERC_CODE_GCJ, 'EPSG:4326') as [number, number];
    expect(Math.abs(back[0] - src[0])).toBeLessThan(1e-5);
    expect(Math.abs(back[1] - src[1])).toBeLessThan(1e-5);
  });
  it('BD 墨卡托往返一致', () => {
    const src: [number, number] = [116.391, 39.907];
    const toMerc = reprojectCoord(src, 'EPSG:4326', MERC_CODE_BD09);
    const back = reprojectCoord(toMerc, MERC_CODE_BD09, 'EPSG:4326') as [number, number];
    expect(Math.abs(back[0] - src[0])).toBeLessThan(1e-5);
    expect(Math.abs(back[1] - src[1])).toBeLessThan(1e-5);
  });
});
