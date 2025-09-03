import * as vscode from 'vscode';
import { Box3D, FrameSeqEntry } from './types';

export interface ParseResult {
  framesSeq: FrameSeqEntry[];
  groups: Map<string, { img: string; frames: FrameSeqEntry[] }>;
}

export function parseAniText(text: string): ParseResult {
  const groups = new Map<string, { img: string; frames: FrameSeqEntry[] }>();
  const framesSeq: FrameSeqEntry[] = [];
  const blockRegex = /\[FRAME(\d{3})\]([\s\S]*?)(?=\n\[FRAME|$)/gi; let bm: RegExpExecArray | null;
  while ((bm = blockRegex.exec(text)) !== null) {
    const block = bm[2] || '';
    // [IMAGE]
    let img = '';
    let idx = 0;
    const imgHeader = /\[IMAGE\]/i.exec(block);
    if (imgHeader) {
      const afterImg = block.slice(imgHeader.index + imgHeader[0].length);
      const lines = afterImg.split(/\r?\n/);
      let p = 0; while (p < lines.length && lines[p].trim() === '') p++;
      const pathLine = (lines[p] || '').trim(); p++;
      while (p < lines.length && lines[p].trim() === '') p++;
      const idxLine = (lines[p] || '').trim();
      if (pathLine.length > 0) {
        if ((pathLine.startsWith('`') && pathLine.endsWith('`')) || (pathLine.startsWith('"') && pathLine.endsWith('"')) || (pathLine.startsWith("'") && pathLine.endsWith("'"))) {
          img = pathLine.slice(1, -1).trim();
        } else { img = pathLine.trim(); }
      } else img = '';
      const parsed = parseInt(idxLine, 10); if (!Number.isNaN(parsed)) idx = parsed;
    }
    const delayM = /\[DELAY\]\s*\r?\n\s*(\d+)/i.exec(block); const delay = delayM ? parseInt(delayM[1], 10) : 50;
    const posM = /\[IMAGE POS\]\s*\r?\n\s*(-?\d+)\s+(-?\d+)/i.exec(block); const pos = posM ? { x: parseInt(posM[1], 10), y: parseInt(posM[2], 10) } : undefined;
    const geM = /\[GRAPHIC\s+EFFECT\]\s*\r?\n\s*([^\r\n]+)/i.exec(block);
    const rateM = /\[IMAGE\s+RATE\]\s*\r?\n\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/i.exec(block);
    const rotM = /\[IMAGE\s+ROTATE\]\s*\r?\n\s*(-?\d+(?:\.\d+)?)/i.exec(block);
    const rgbaM = /\[RGBA\]\s*\r?\n\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/i.exec(block);
    // boxes
    const atkBoxes: Box3D[] = []; const dmgBoxes: Box3D[] = [];
    const boxScan = (re: RegExp, into: Box3D[]) => { let m: RegExpExecArray | null; const rex = new RegExp(re.source, re.flags + (re.flags.includes('g') ? '' : 'g')); while ((m = rex.exec(block)) !== null) { const x=parseInt(m[1],10)|0, y=parseInt(m[2],10)|0, z=parseInt(m[3],10)|0, w=parseInt(m[4],10)|0, h=parseInt(m[5],10)|0, d=parseInt(m[6],10)|0; into.push({x,y,z,w,h,d}); } };
    boxScan(/\[ATTACK\s+BOX\][^\r\n]*\r?\n\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/i, atkBoxes);
    boxScan(/\[DAMAGE\s+BOX\][^\r\n]*\r?\n\s*(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)/i, dmgBoxes);
    let gfx: string | undefined = undefined;
    if (geM) { let g = String(geM[1]).trim(); if (/^["'`].*["'`]$/.test(g)) g = g.slice(1, -1); gfx = g.toUpperCase(); }
    let scale: { x: number, y: number } | undefined = undefined;
    if (rateM) { const x = parseFloat(rateM[1]); const y = parseFloat(rateM[2]); if (isFinite(x) && isFinite(y)) scale = { x, y }; }
    const rotate = rotM ? (parseFloat(rotM[1]) || 0) : undefined;
    let tint: [number, number, number, number] | undefined = undefined;
    if (rgbaM) { const r=Math.max(0,Math.min(255,parseInt(rgbaM[1],10)||0)); const g=Math.max(0,Math.min(255,parseInt(rgbaM[2],10)||0)); const b=Math.max(0,Math.min(255,parseInt(rgbaM[3],10)||0)); const a=Math.max(0,Math.min(255,parseInt(rgbaM[4],10)||0)); tint=[r,g,b,a]; }
    if (!groups.has(img)) groups.set(img, { img, frames: [] });
    const frame = { img, idx, delay, pos, gfx, scale, rotate, tint, atk: atkBoxes, dmg: dmgBoxes };
    groups.get(img)!.frames.push(frame);
    framesSeq.push(frame);
  }
  if (groups.size === 0) { vscode.window.showWarningMessage('未解析到任何帧，请检查 ANI 格式或文件内容'); }
  return { framesSeq, groups };
}
