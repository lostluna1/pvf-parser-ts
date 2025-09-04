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
// 现在 relLayer 表示基于主 ani 的层级 (0=与主层同平面; >0 在主层之上; <0 在主层之下)
// order 表示 startFrame (可以为负数提前播放)
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

  // 图层列表：按 depth(relLayer) 升序；同 depth 保留文件出现顺序 (layerAniMap 插入顺序即 adds 顺序)
  const layerList = Array.from(layerAniMap.values()).map((v,i)=> ({v,i}))
    .sort((a,b)=> a.v.relLayer === b.v.relLayer ? a.i - b.i : a.v.relLayer - b.v.relLayer)
    .map(x=> x.v);
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
    // 主层加入
    layers.push({ ...mainLayerFrame, __main: true, __rel: 0, __order: 0, __id: 'MAIN' });
    for (const l of layerList) {
      const startFrame = l.order; // order => startFrame
      const frameIndex = i - startFrame;
      if (frameIndex < 0 || frameIndex >= l.frames.length) continue;
      layers.push({ ...makeLayerFrame(l.frames[frameIndex]), __rel: l.relLayer, __order: startFrame, __id: l.id, __start: startFrame });
    }
    // 排序：先 __rel (层级)，相同层级内主层优先，然后按出现顺序（不再改变），保持已插入顺序
    layers.sort((a,b)=> {
      if (a.__rel === b.__rel) {
        if (a.__main && !b.__main) return -1;
        if (b.__main && !a.__main) return 1;
        return 0; // 保持插入顺序
      }
      return a.__rel - b.__rel;
    });
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
  let candidate: string | undefined;
    try {
      if (isPvf && model) {
  candidate = rawPath;
        // 情况1: 以 ./ 或 ../ 开头的相对路径
        if (/^(\.\.\/|\.\/)/.test(rawPath)) {
          candidate = joinAndNormalize(baseDir, rawPath);
          out?.appendLine(`[ALS] 相对路径解析: base='${baseDir}' raw='${rawPath}' -> '${candidate}'`);
        } else {
          // 情况2: 既不以 ./ ../ 开头，也不以 / 开头 -> 视为与主 ani 同级（或其子层级）
          // 需求: "如果只有文件名或者没有顶级根目录的情况下则代表和主ani是同一个层级的"
          // 判定: 不以 / 开头，并且 (不含 / 仅文件名) 或 其第一个段不在根级(统一仍按相对处理)
          if (!rawPath.startsWith('/')) {
            // bare filename (不含 /) 或者开发者仍希望同级引用 -> 拼接 baseDir
            if (!rawPath.includes('/')) {
              candidate = joinAndNormalize(baseDir, './' + rawPath);
              out?.appendLine(`[ALS] 同级裸文件解析: base='${baseDir}' raw='${rawPath}' -> '${candidate}'`);
            } else {
              // 含子目录，但未显式使用 ./ ../，仍按相对处理
              candidate = joinAndNormalize(baseDir, rawPath);
              out?.appendLine(`[ALS] 相对子路径解析: base='${baseDir}' raw='${rawPath}' -> '${candidate}'`);
            }
          }
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
  // 使用解析后的候选路径（candidate）作为 source，便于后续保存时定位文件；若未解析则回退原始声明路径
  layerMap.set(add.id, { frames: framesSeq, relLayer: add.relLayer, order: add.order, id: add.id, source: (isPvf ? (candidate||rawPath) : (typeof (aniContent) === 'string' ? (candidate||decl.path) : decl.path)) });
  }
  return layerMap;
}

