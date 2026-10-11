import { el, clear } from '@/ui/dom';
import { select, field, button, card, note, textInput, textArea } from '@/ui/form';
import { convertGeographicCoord, convertGeographicFeatureCollection, GEOGRAPHIC_SYSTEMS, type GeographicSystem } from '@/core/datum';
import type { CoordShift } from '@/core/types';
import { parseCoordPair, parseCoordLine } from '@/core/coordFormat';
import { createCoordFileCard } from '@/tools/coordFileCard';
import type { ToolModule } from '@/toolRegistry';

const SYSTEMS = GEOGRAPHIC_SYSTEMS.map((s) => ({ value: s.id, label: `${s.name} — ${s.full}` }));

/** 地理坐标系之间的一元坐标偏移 */
function shiftFor(from: GeographicSystem, to: GeographicSystem): CoordShift {
  return (lng, lat) => convertGeographicCoord(from, to, [lng, lat]) as [number, number];
}

export const coordConvertTool: ToolModule = {
  id: 'coord-convert',
  title: '坐标投影转换',
  subtitle: 'WGS-84 / GCJ-02 / BD-09 / CGCS2000 / PZ-90 / GRS-80 多坐标系互转',
  category: 'coord',
  mount(host, svc) {
    clear(host);

    const fromSel = select(SYSTEMS, () => undefined, 'WGS84');
    const toSel = select(SYSTEMS, () => undefined, 'GCJ02');

    const layout = el('div', { className: 'gt-stack' });
    const panel = el('div', { className: 'gt-output' });
    const result = el('div', { className: 'gt-result' });

    const common = card('坐标系统设置', [
      field('源坐标系', fromSel),
      field('目标坐标系', toSel),
      note('支持含基准的多种地理坐标系；GCJ-02 / BD-09 为中国偏移系，CGCS2000 / PZ-90 / GRS-80 为大地基准。'),
    ]);
    layout.append(common);

    /* ---------- 单点 ---------- */
    const lngInput = textInput('经度 / X（支持 116.39 或 116°23\'45"E）');
    const latInput = textInput('纬度 / Y（支持 39.91 或 39°54\'27"N）');
    const singleBtn = button('转换', () => {
      const p = parseCoordPair(lngInput.value, latInput.value);
      if (!p) {
        svc.toast('请输入有效坐标（十进制或 度/度分/度分秒）', 'warning');
        return;
      }
      const out = convertGeographicCoord(fromSel.value as GeographicSystem, toSel.value as GeographicSystem, p);
      svc.toast('转换完成', 'success');
      result.innerHTML =
        '<div class="gt-coord-card">' +
        `<div class="gt-coord-card__row"><span>经度</span><b>${out[0].toFixed(7)}</b></div>` +
        `<div class="gt-coord-card__row"><span>纬度</span><b>${out[1].toFixed(7)}</b></div>` +
        '</div>';
    });
    const single = card('单点坐标', [
      field('经度 / X', lngInput),
      field('纬度 / Y', latInput),
      singleBtn,
    ]);

    /* ---------- 批量 ---------- */
    const batchInput = textArea('每行一组：116.391,39.907 或 116°23\'45"E,39°54\'27"N 或 UTM/MGRS', 8);
    const batchOut = textArea('', 8);
    const batchBtn = button('批量转换', () => {
      const lines = batchInput.value.split(/\r?\n/);
      const valid: [number, number][] = [];
      let invalid = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        const p = parseCoordLine(line);
        if (p) valid.push(p);
        else invalid++;
      }
      if (valid.length === 0) {
        svc.toast('未解析到有效坐标对', 'warning');
        return;
      }
      const outLines = valid.map((p) => {
        const o = convertGeographicCoord(fromSel.value as GeographicSystem, toSel.value as GeographicSystem, p);
        return `${o[0].toFixed(7)},${o[1].toFixed(7)}`;
      });
      batchOut.value = outLines.join('\n');
      svc.toast(`转换 ${valid.length} 行${invalid ? `，跳过 ${invalid} 行` : ''}`, 'success');
    });
    const copyBtn = button('复制结果', () => {
      if (!batchOut.value) return;
      navigator.clipboard.writeText(batchOut.value).then(() => svc.toast('已复制', 'success'));
    }, 'ghost');
    const downloadBtn = button('下载 CSV', () => {
      if (!batchOut.value) return;
      svc.downloadText('lng,lat\n' + batchOut.value + '\n', 'converted.csv', 'text/csv');
    }, 'ghost');
    const batch = card('批量粘贴（多行 经度,纬度）', [
      field('输入（每行一组）', batchInput),
      batchBtn,
      field('结果', batchOut),
      el('div', { className: 'gt-btn-row' }, copyBtn, downloadBtn),
    ]);

    /* ---------- 文件 ---------- */
    // 两个坐标类工具共用同一份文件转换卡片（见 tools/coordFileCard.ts）
    const fileCard = createCoordFileCard(svc, {
      transform: () => (fc) =>
        convertGeographicFeatureCollection(
          fc,
          fromSel.value as GeographicSystem,
          toSel.value as GeographicSystem
        ),
      // 地理坐标系之间始终可以就地改写 KML / GPX
      inPlaceShift: () => shiftFor(fromSel.value as GeographicSystem, toSel.value as GeographicSystem),
      targetIsGeographic: () => true,
    });

    const modeSel = select(
      [
        { value: 'single', label: '单点坐标' },
        { value: 'batch', label: '批量粘贴' },
        { value: 'file', label: '文件转换' },
      ],
      (mode) => switchMode(mode),
      'single'
    );
    layout.append(field('转换模式', modeSel), panel);

    function switchMode(mode: string): void {
      clear(panel);
      result.innerHTML = '';
      switch (mode) {
        case 'single':
          panel.appendChild(single);
          panel.appendChild(result);
          break;
        case 'batch':
          panel.appendChild(batch);
          break;
        case 'file':
          panel.appendChild(fileCard.element);
          break;
      }
    }

    host.appendChild(layout);
    switchMode('single');
  },
};
