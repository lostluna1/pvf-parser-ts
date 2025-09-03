import * as vscode from 'vscode';
import { FrameSeqEntry, TimelineFrame } from './types';
import { loadAlbumForImage } from './npkResolver';
import { getSpriteRgba } from '../../npk/imgReader.js';

export async function buildTimelineFromFrames(context: vscode.ExtensionContext, root: string, framesSeq: FrameSeqEntry[], out?: vscode.OutputChannel): Promise<{ timeline: TimelineFrame[], albumMap: Map<string, any> }>{
  const albumMap = new Map<string, any>();
  const uniqueImgs = Array.from(new Set(framesSeq.map(f => (f.img || '').trim()).filter(s => s.length > 0)));
  // load albums
  const total = uniqueImgs.length || 1; let done = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '查找并加载 IMG 资源…' }, async (p) => {
    for (const img of uniqueImgs) { const al = await loadAlbumForImage(context, root, img, out); if (al) albumMap.set(img, al); done++; p.report({ increment: (done/total)*100, message: `${done}/${total}` }); }
  });
  if (uniqueImgs.length > 0 && albumMap.size === 0) { vscode.window.showWarningMessage('未找到任何 IMG 资源，仅显示坐标/碰撞盒。'); }
  const timeline: TimelineFrame[] = [];
  const TRANSPARENT_1X1 = 'AAAAAA==';
  for (const f of framesSeq) {
    const imgKey = (f.img || '').trim();
    const al = imgKey ? albumMap.get(imgKey) : undefined;
    if (al) {
      const rgba = getSpriteRgba(al, f.idx);
      if (rgba) {
        const b64 = Buffer.from(rgba).toString('base64');
        const sp = al.sprites[f.idx];
        timeline.push({ rgba: b64, w: sp.width, h: sp.height, delay: f.delay, dx: f.pos?.x || 0, dy: f.pos?.y || 0, fid: f.idx, gfx: f.gfx ? (typeof f.gfx === 'string' ? f.gfx.replace(/^[\'"`]|[\'"`]$/g, '').toUpperCase() : String(f.gfx).toUpperCase()) : undefined, sx: f.scale?.x, sy: f.scale?.y, rot: f.rotate, tint: f.tint, atk: f.atk || [], dmg: f.dmg || [] });
        continue;
      }
    }
    timeline.push({ rgba: TRANSPARENT_1X1, w: 1, h: 1, delay: f.delay, dx: f.pos?.x || 0, dy: f.pos?.y || 0, fid: f.idx, gfx: f.gfx ? (typeof f.gfx === 'string' ? f.gfx.replace(/^[\'"`]|[\'"`]$/g, '').toUpperCase() : String(f.gfx).toUpperCase()) : undefined, sx: f.scale?.x, sy: f.scale?.y, rot: f.rotate, tint: f.tint, atk: f.atk || [], dmg: f.dmg || [] });
  }
  return { timeline, albumMap };
}
