/**
 * 地图数据符号样式。
 *
 * 这些颜色绘制在底图瓦片之上，**刻意不随界面主题变化**：
 * 瓦片本身（高德街道 / Esri 影像 / Carto 等）在深浅两种主题下都是浅色或影像底，
 * 若符号颜色跟随深色主题变亮变浅，反而降低与底图的对比度，影响判读。
 * 因此这里维护一份与主题解耦的常量，供所有地图图层复用，避免颜色散落在各处。
 */
export const MAP_SYMBOL = {
  /** 线与面的描边色（与品牌主色一致） */
  stroke: '#2f7d3a',
  strokeWeight: 2,
  strokeOpacity: 0.9,
  /** 面填充：同色低不透明度，避免遮挡底图 */
  fill: '#2f7d3a',
  fillOpacity: 0.15,
  /** 点标记：主色描边 + 强调色填充，保证在浅色底图上足够醒目 */
  pointRadius: 6,
  pointStroke: '#2f7d3a',
  pointFill: '#f0c040',
  pointFillOpacity: 0.9,
} as const;
