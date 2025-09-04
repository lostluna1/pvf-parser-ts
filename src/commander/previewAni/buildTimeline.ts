import * as vscode from 'vscode';
import { FrameSeqEntry, TimelineFrame } from './types';
import { loadAlbumForImage } from './npkResolver';
import { loadAniFromPvf } from './pvfResolver';
import { parseAniText } from './parseAni';
import { getSpriteRgba } from '../../npk/imgReader.js';
import { PvfModel } from '../../pvf/model';
import { ParsedAls, AlsAddRef } from './parseAls';

export async function buildTimelineFromFrames(context: vscode.ExtensionContext, root: string, framesSeq: FrameSeqEntry[], out?: vscode.OutputChannel): Promise<{ timeline: TimelineFrame[], albumMap: Map<string, any> }>{
  const albumMap = new Map<string, any>();
  const uniqueImgs = Array.from(new Set(framesSeq.map(f => (f.img || '').trim()).filter(s => s.length > 0)));
  // load albums
  const total = uniqueImgs.length || 1; let done = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '查找并加载 IMG 资源…' }, async (p) => {
    for (const img of uniqueImgs) { const al = await loadAlbumForImage(context, root, img, out); if (al) albumMap.set(img, al); done++; p.report({ increment: (done/total)*100, message: `${done}/${total}` }); }
  });
  if (uniqueImgs.length > 0 && albumMap.size === 0) { vscode.window.showWarningMessage('未找到任何 IMG 资源，仅显示坐标/碰撞盒。'); }
  return buildTimelineFromSequence(framesSeq, albumMap);
}

export async function buildTimelineFromPvfFrames(context: vscode.ExtensionContext, model: PvfModel, root: string, framesSeq: FrameSeqEntry[], out?: vscode.OutputChannel): Promise<{ timeline: TimelineFrame[], albumMap: Map<string, any> }>{
  const albumMap = new Map<string, any>();
  const uniqueImgs = Array.from(new Set(framesSeq.map(f => (f.img || '').trim()).filter(s => s.length > 0)));
  
  // 首先尝试从PVF中解析引用的ANI文件
  const extendedFrames: FrameSeqEntry[] = [];
  
  for (const f of framesSeq) {
    const imgKey = (f.img || '').trim();
    
    // 检查是否是ANI文件引用
    if (imgKey.toLowerCase().includes('.ani')) {
      out?.appendLine(`[PVF] 检测到ANI文件引用: ${imgKey}`);
      
      try {
        const aniContent = await loadAniFromPvf(model, imgKey, out);
        if (aniContent) {
          out?.appendLine(`[PVF] 成功加载ANI文件，开始解析...`);
          const { framesSeq: subFrames } = parseAniText(aniContent);
          
          // 应用当前帧的变换到子帧
          for (const subFrame of subFrames) {
            const combinedFrame: FrameSeqEntry = {
              ...subFrame,
              // 组合位置偏移
              pos: {
                x: (f.pos?.x || 0) + (subFrame.pos?.x || 0),
                y: (f.pos?.y || 0) + (subFrame.pos?.y || 0)
              },
              // 组合缩放
              scale: f.scale ? {
                x: (f.scale.x || 1) * (subFrame.scale?.x || 1),
                y: (f.scale.y || 1) * (subFrame.scale?.y || 1)
              } : subFrame.scale,
              // 组合旋转
              rotate: (f.rotate || 0) + (subFrame.rotate || 0),
              // 使用父帧的延迟，如果子帧没有指定
              delay: subFrame.delay || f.delay
            };
            extendedFrames.push(combinedFrame);
          }
          
          out?.appendLine(`[PVF] ANI文件解析完成，包含 ${subFrames.length} 帧`);
        } else {
          out?.appendLine(`[PVF] 无法加载ANI文件: ${imgKey}，使用原始帧`);
          extendedFrames.push(f);
        }
      } catch (error) {
        out?.appendLine(`[PVF] 解析ANI文件时出错: ${String(error)}`);
        extendedFrames.push(f);
      }
    } else {
      extendedFrames.push(f);
    }
  }
  
  // 获取所有唯一的IMG文件
  const uniqueImgsFromExtended = Array.from(new Set(extendedFrames.map(f => (f.img || '').trim()).filter(s => s.length > 0 && !s.toLowerCase().includes('.ani'))));
  
  // 从NPK加载IMG资源
  const total = uniqueImgsFromExtended.length || 1; let done = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '查找并加载 IMG 资源…' }, async (p) => {
    for (const img of uniqueImgsFromExtended) { 
      const al = await loadAlbumForImage(context, root, img, out); 
      if (al) albumMap.set(img, al); 
      done++; 
      p.report({ increment: (done/total)*100, message: `${done}/${total}` }); 
    }
  });
  
  if (uniqueImgsFromExtended.length > 0 && albumMap.size === 0) { 
    vscode.window.showWarningMessage('未找到任何 IMG 资源，仅显示坐标/碰撞盒。'); 
  }
  
  return buildTimelineFromSequence(extendedFrames, albumMap);
}

function buildTimelineFromSequence(framesSeq: FrameSeqEntry[], albumMap: Map<string, any>): { timeline: TimelineFrame[], albumMap: Map<string, any> } {
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
        // 分离：dx,dy 为 ANI 原始 [IMAGE POS]；ox,oy 为 IMG 内部偏移（sprite.x,y）
        timeline.push({ rgba: b64, w: sp.width, h: sp.height, delay: f.delay, dx: (f.pos?.x || 0), dy: (f.pos?.y || 0), ox: sp.x || 0, oy: sp.y || 0, fid: f.idx, gfx: f.gfx ? (typeof f.gfx === 'string' ? f.gfx.replace(/^[\'"`]|[\'"`]$/g, '').toUpperCase() : String(f.gfx).toUpperCase()) : undefined, sx: f.scale?.x, sy: f.scale?.y, rot: f.rotate, tint: f.tint, atk: f.atk || [], dmg: f.dmg || [] });
        continue;
      }
    }
    timeline.push({ rgba: TRANSPARENT_1X1, w: 1, h: 1, delay: f.delay, dx: f.pos?.x || 0, dy: f.pos?.y || 0, ox: 0, oy: 0, fid: f.idx, gfx: f.gfx ? (typeof f.gfx === 'string' ? f.gfx.replace(/^[\'"`]|[\'"`]$/g, '').toUpperCase() : String(f.gfx).toUpperCase()) : undefined, sx: f.scale?.x, sy: f.scale?.y, rot: f.rotate, tint: f.tint, atk: f.atk || [], dmg: f.dmg || [] });
  }
  return { timeline, albumMap };
}

/**
 * 组合主 ani 与 ALS 附加图层，生成含多图层的 timeline。主帧数保持不变；附加层帧数不足时该层在该帧不绘制；超过则忽略多余部分。
 */
export async function buildCompositeTimeline(context: vscode.ExtensionContext, root: string, mainFrames: FrameSeqEntry[], alsParsed: ParsedAls | null, layerAniMap: Map<string, { frames: FrameSeqEntry[]; relLayer: number; order: number; id: string; source: string }>, out?: vscode.OutputChannel) : Promise<{ timeline: any[], albumMap: Map<string, any> }> {
  // 收集所有帧引用的 IMG
  const collectImgs = (frames: FrameSeqEntry[]) => frames.map(f=> (f.img||'').trim()).filter(s=> s.length>0 && !s.toLowerCase().endsWith('.ani'));
  let allImgs: string[] = collectImgs(mainFrames);
  for (const v of layerAniMap.values()) allImgs.push(...collectImgs(v.frames));
  const uniqueImgs = Array.from(new Set(allImgs));
  const albumMap = new Map<string, any>();
  const total = uniqueImgs.length || 1; let done = 0;
  await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: '加载所有图层 IMG 资源…' }, async (p) => {
    for (const img of uniqueImgs) { const al = await loadAlbumForImage(context, root, img, out); if (al) albumMap.set(img, al); done++; p.report({ increment: (done/total)*100, message: `${done}/${total}` }); }
  });
  if (uniqueImgs.length > 0 && albumMap.size === 0) { vscode.window.showWarningMessage('未找到任何 IMG 资源，仅显示坐标/碰撞盒'); }

  const TRANSPARENT_1X1 = 'AAAAAA==';
  const makeLayerFrame = (f: FrameSeqEntry): any => {
    const imgKey = (f.img||'').trim();
    const al = imgKey? albumMap.get(imgKey): undefined;
    if (al) {
      const rgba = getSpriteRgba(al, f.idx);
      if (rgba) {
        const b64 = Buffer.from(rgba).toString('base64');
        const sp = al.sprites[f.idx];
        return { rgba: b64, w: sp.width, h: sp.height, dx: (f.pos?.x||0), dy: (f.pos?.y||0), ox: sp.x||0, oy: sp.y||0, fid: f.idx, gfx: f.gfx, sx: f.scale?.x, sy: f.scale?.y, rot: f.rotate, tint: f.tint };
      }
    }
    return { rgba: TRANSPARENT_1X1, w:1, h:1, dx:(f.pos?.x||0), dy:(f.pos?.y||0), ox:0, oy:0, fid: f.idx };
  };

  const layerList = Array.from(layerAniMap.values()).sort((a,b)=> a.relLayer === b.relLayer ? a.order - b.order : a.relLayer - b.relLayer);
  if (out) {
    for (const l of layerList) {
      out.appendLine(`[ALS] 图层 id=${l.id} rel=${l.relLayer} order=${l.order} 帧数=${l.frames.length}`);
    }
  }
  const timeline: any[] = [];
  for (let i=0;i<mainFrames.length;i++) {
    const mf = mainFrames[i];
    const mainLayerFrame = makeLayerFrame(mf);
    // 主帧作为单独对象，同时放入 layers 数组；攻击盒等沿用主帧
    const layers: any[] = [];
    // 先绘制所有在主层以下的图层
    for (const l of layerList) {
      if (l.relLayer < 0) {
        if (i < l.frames.length) { layers.push({ ...makeLayerFrame(l.frames[i]), __rel: l.relLayer, __order: l.order, __id: l.id }); }
      }
    }
    // 主帧
    layers.push({ ...mainLayerFrame, __main: true, __rel: 0, __order: 0, __id: 'MAIN' });
    // 主层以上图层
    for (const l of layerList) {
      if (l.relLayer >= 0) {
        if (i < l.frames.length) { layers.push({ ...makeLayerFrame(l.frames[i]), __rel: l.relLayer, __order: l.order, __id: l.id }); }
      }
    }
    // 按 relLayer, order, 以及是否主层 排序（已按逻辑插入，但再稳固）
    layers.sort((a,b)=> (a.__rel===b.__rel)? (a.__order - b.__order) : (a.__rel - b.__rel));
    timeline.push({
      // 主帧公开字段（沿用 mainLayerFrame + delay + 盒子信息）
      rgba: mainLayerFrame.rgba,
      w: mainLayerFrame.w,
      h: mainLayerFrame.h,
      dx: mainLayerFrame.dx,
      dy: mainLayerFrame.dy,
      fid: mainLayerFrame.fid,
      delay: mf.delay,
      atk: mf.atk || [],
      dmg: mf.dmg || [],
      layers
    });
  }
  return { timeline, albumMap };
}

export async function expandAlsLayers(isPvf: boolean, context: vscode.ExtensionContext, model: PvfModel | undefined, root: string, baseDir: string, alsParsed: ParsedAls, out?: vscode.OutputChannel): Promise<Map<string, { frames: FrameSeqEntry[]; relLayer: number; order: number; id: string; source: string }>> {
  const layerMap = new Map<string, { frames: FrameSeqEntry[]; relLayer: number; order: number; id: string; source: string }>();
  const joinAndNormalize = (baseDirLocal: string, rel: string) => {
    const relParts = rel.replace(/^\/+/, '').split('/');
    const baseParts = baseDirLocal ? baseDirLocal.split('/').filter(p => p.length>0) : [];
    const outArr: string[] = [...baseParts];
    for (const part of relParts) {
      if (part === '..') { if (outArr.length>0) outArr.pop(); }
      else if (part === '.' || part === '') { /* skip */ }
      else outArr.push(part);
    }
    return outArr.join('/');
  };
  for (const add of alsParsed.adds) {
    const decl = alsParsed.uses.get(add.id);
    if (!decl) { out?.appendLine(`[ALS] 引用未找到对应声明 id=${add.id}`); continue; }
    if (layerMap.has(add.id)) { out?.appendLine(`[ALS] 重复引用 id=${add.id}，已忽略后续`); continue; }
    const rawPath = decl.path;
    let aniContent: string | undefined;
    try {
      if (isPvf && model) {
        let candidate = rawPath;
  // 以 ./ 或 ../ 开头的相对路径
          if (/^(\.\.\/|\.\/)/.test(rawPath)) {
          candidate = joinAndNormalize(baseDir, rawPath);
          out?.appendLine(`[ALS] 相对路径解析: base='${baseDir}' raw='${rawPath}' -> '${candidate}'`);
        }
        aniContent = await loadAniFromPvf(model, candidate, out);
          if (aniContent && !/\[frame\d{3}\]/i.test(aniContent)) {
            // 可能编码不正确，尝试原始字节直接 decode
            try {
              const keyNorm = candidate.replace(/^\/+/, '').toLowerCase();
              const f = (model as any).getFileByKey(keyNorm);
              if (f) {
                const rawBytes: Uint8Array = await (model as any).readFileBytes(keyNorm);
                const buf = Buffer.from(rawBytes);
                const utf8 = buf.toString('utf8');
                if (/\[frame\d{3}\]/i.test(utf8)) { aniContent = utf8; out?.appendLine('[ALS] UTF-8 回退解析子 ani 成功'); }
                else {
                  const iconv = require('iconv-lite');
                  const cp949 = iconv.decode(buf, 'cp949');
                  if (/\[frame\d{3}\]/i.test(cp949)) { aniContent = cp949; out?.appendLine('[ALS] cp949 回退解析子 ani 成功'); }
                }
              }
            } catch {}
          }
      } else {
        const fs = await import('fs/promises');
        const pathMod = await import('path');
        const cleaned = rawPath.replace(/^[`'\"]+/, '').replace(/[`'\"]+$/, '');
        const abs = pathMod.isAbsolute(cleaned) ? cleaned : pathMod.join(baseDir, cleaned);
        aniContent = await fs.readFile(abs, 'utf8');
      }
    } catch (e) { out?.appendLine(`[ALS] 读取附加 ani 失败 id=${add.id} path=${rawPath} -> ${String(e)}`); }
    if (!aniContent) { continue; }
    const { framesSeq } = parseAniText(aniContent);
    out?.appendLine(`[ALS] 解析附加 ani 成功 id=${add.id} 帧数=${framesSeq.length}`);
    layerMap.set(add.id, { frames: framesSeq, relLayer: add.relLayer, order: add.order, id: add.id, source: decl.path });
  }
  return layerMap;
}

