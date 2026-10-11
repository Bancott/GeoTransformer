import { el, clear } from '@/ui/dom';
import { select, field, button, card, note, textArea, textInput } from '@/ui/form';
import { parseCoordLine, decimalToDMS, decimalToDegreeMinute, wgs84ToUtm, wgs84ToMgrs } from '@/core/coordFormat';
import type { ToolModule } from '@/toolRegistry';

function fmtD(n: number): string {
  return Number(n.toFixed(7)).toString();
}

export const coordFormatTool: ToolModule = {
  id: 'coord-format',
  title: '坐标格式解析',
  subtitle: 'DMS / 度分 / 十进制 / UTM / MGRS 互转',
  category: 'coord',
  mount(host, svc) {
    clear(host);

    const layout = el('div', { className: 'gt-stack' });

    /* ---------- 解析：任意格式 -> 十进制度 ---------- */
    const parseInput = textArea('每行一个坐标：\n116.3958,39.9075\n116°23\'45"E,39°54\'27"N\n50N 123456 789012\n50SMK4796917670', 8);
    const parseOut = el('div', { className: 'gt-output' });
    const parseBtn = button('解析为十进制度', () => {
      const lines = parseInput.value.split(/\r?\n/);
      const rows: string[] = [];
      let ok = 0;
      let fail = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        const p = parseCoordLine(line);
        if (p) {
          rows.push(`${fmtD(p[0])},${fmtD(p[1])}`);
          ok++;
        } else {
          rows.push(`!! 无法解析：${line.trim()}`);
          fail++;
        }
      }
      clear(parseOut);
      if (rows.length === 0) parseOut.appendChild(note('没有可解析的行'));
      else parseOut.appendChild(el('pre', { className: 'gt-coord-card', text: rows.join('\n') }));
      svc.toast(`解析完成：成功 ${ok} 行${fail ? `，失败 ${fail} 行` : ''}`, ok ? 'success' : 'warning');
    });
    const parseCard = card('任意格式 → 十进制度', [
      field('输入', parseInput),
      parseBtn,
      parseOut,
    ]);

    /* ---------- 格式化：十进制度 -> DMS / 度分 / UTM / MGRS ---------- */
    const lngInput = textInput('如 116.3958');
    const latInput = textInput('如 39.9075');
    const formatOut = el('div', { className: 'gt-output' });
    const fmtBtn = button('生成各格式', () => {
      const lng = Number(lngInput.value);
      const lat = Number(latInput.value);
      if (Number.isNaN(lng) || Number.isNaN(lat)) {
        svc.toast('请输入有效十进制度坐标', 'warning');
        return;
      }
      const utm = wgs84ToUtm(lng, lat);
      const mgrs = wgs84ToMgrs(lng, lat);
      clear(formatOut);
      const rows = el('div', { className: 'gt-coord-card' });
      const add = (label: string, val: string): void => {
        const r = el('div', { className: 'gt-coord-card__row' });
        r.append(el('span', { text: label }), el('b', { text: val }));
        rows.appendChild(r);
      };
      add('DMS 经度', decimalToDMS(lng, false));
      add('DMS 纬度', decimalToDMS(lat, true));
      add('度分 经度', decimalToDegreeMinute(lng, false));
      add('度分 纬度', decimalToDegreeMinute(lat, true));
      add('UTM', `${utm.zone}${utm.south ? 'S' : 'N'} ${Math.round(utm.easting)} ${Math.round(utm.northing)}`);
      add('MGRS', mgrs);
      formatOut.appendChild(rows);
    });
    const inline = el('div', { className: 'gt-inline' }, field('经度 / X', lngInput), field('纬度 / Y', latInput));
    const formatCard = card('十进制度 → DMS / 度分 / UTM / MGRS', [
      inline,
      fmtBtn,
      formatOut,
    ]);

    const modeSel = select(
      [
        { value: 'parse', label: '解析为十进制度' },
        { value: 'format', label: '格式化输出' },
      ],
      (m) => {
        parseCard.style.display = m === 'parse' ? '' : 'none';
        formatCard.style.display = m === 'format' ? '' : 'none';
      },
      'parse'
    );

    layout.append(field('模式', modeSel), parseCard, formatCard);
    host.appendChild(layout);
  },
};
