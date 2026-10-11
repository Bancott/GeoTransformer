import 'leaflet/dist/leaflet.css';
import '@/styles/theme.css';
import '@/styles/main.css';
import { elById } from '@/ui/dom';
import { initTheme } from '@/ui/theme';
import { createApp } from '@/app';

// 首屏配色已由 index.html 的内联脚本设定，这里接管后续的切换与系统联动
initTheme();

const root = elById<HTMLDivElement>('app');
createApp(root);
