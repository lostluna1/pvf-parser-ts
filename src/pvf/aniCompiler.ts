import { ANIData, Effect_Item, DAMAGE_TYPE_Item, FLIP_TYPE_Item } from './binaryAni';

// 更严格 & 接近反编译输出结构的编译器：
//  - 行级解析（保持括号标签与其值行关系）
//  - 支持所有 decompileBinaryAni 中出现的条目
//  - 严格校验数值/顺序，出错返回 null 以触发文本回退保存
export function compileBinaryAni(text: string, fileName: string = 'unknown.ani'): Uint8Array | null {
  try {
    // 预处理：统一换行，去除 BOM，保留空行用于 FRAME 分割（但解析时会跳过空白）
    let src = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (src.charCodeAt(0) === 0xFEFF) src = src.slice(1);
    const rawLines = src.split('\n');
    const lines: string[] = rawLines.map(l => l.trim()).filter(l => l.length > 0);
    if (!lines.length) return null;
    // 跳过头部
    if (lines[0] === '#PVF_File') lines.shift();

    // 工具函数
    let idx = 0;
    const peek = () => lines[idx];
    const eof = () => idx >= lines.length;
    const next = () => lines[idx++];
    const expectBracket = (tag: string) => { const l = peek(); if (!l || l.toUpperCase() !== tag) throw new Error('expect ' + tag); next(); };
    const isBracket = (l: string) => l.startsWith('[') && l.endsWith(']');
    const parseIntLine = (): number => { const l = next(); const v = parseInt(l, 10); if (isNaN(v)) throw new Error('int parse fail: ' + l); return v; };
    const parseNumberTokens = (want: number): number[] => { const l = next(); const parts = l.split(/\s+/); if (parts.length < want) throw new Error('need '+want+' nums'); return parts.slice(0, want).map(p=>{ const v = parseInt(p,10); if (isNaN(v)) throw new Error('num fail '+p); return v|0; }); };
    const parseFloatTokens = (want: number): number[] => { const l = next(); const parts = l.split(/\s+/); if (parts.length < want) throw new Error('need '+want+' floats'); return parts.slice(0,want).map(p=>{ const v=parseFloat(p); if (isNaN(v)) throw new Error('float fail'); return v; }); };
    const stripBacktick = (s: string) => s.replace(/^`|`$/g, '');

    interface OverallItem { type: ANIData; payload: any }
    interface FrameBox { type: ANIData.DAMAGE_BOX | ANIData.ATTACK_BOX; nums: number[] }
    interface FrameItem { type: ANIData; payload?: any }
    interface FrameInfo { boxes: FrameBox[]; image: { path: string|null; index: number; posX: number; posY: number }; items: FrameItem[] }

    const overall: OverallItem[] = [];

    // 先扫描找 [FRAME MAX] 位置（保持弹性：允许 overall 中穿插空行已在 lines 过滤阶段去除）
    let frameMaxDeclared = -1; let frameMaxLine = -1;
    for (let i=0;i<lines.length;i++) {
      const u = lines[i].toUpperCase();
      if (u === '[FRAME MAX]') { frameMaxLine = i; if (i+1 < lines.length) { const v = parseInt(lines[i+1],10); if (!isNaN(v)) frameMaxDeclared = v; } break; }
    }
    if (frameMaxLine === -1) throw new Error('missing [FRAME MAX]');

    // 解析 overall (0 .. frameMaxLine-1)
    idx = 0;
    while (idx < frameMaxLine) {
      const l = peek();
      if (!l) break;
      if (!isBracket(l)) { idx++; continue; }
      const u = l.toUpperCase();
      if (u === '[FRAME MAX]') break; // 安全
      next(); // consume tag
      switch (u) {
        case '[LOOP]': overall.push({ type: ANIData.LOOP, payload: parseIntLine() & 0xFF }); break;
        case '[SHADOW]': overall.push({ type: ANIData.SHADOW, payload: parseIntLine() & 0xFF }); break;
        case '[COORD]': overall.push({ type: ANIData.COORD, payload: parseIntLine() & 0xFFFF }); break;
        case '[OPERATION]': overall.push({ type: ANIData.OPERATION, payload: parseIntLine() & 0xFFFF }); break;
        case '[SPECTRUM]': {
          const level = parseIntLine() & 0xFF;
          expectBracket('[SPECTRUM TERM]'); const term = parseIntLine()|0;
            expectBracket('[SPECTRUM LIFE TIME]'); const life = parseIntLine()|0;
            expectBracket('[SPECTRUM COLOR]'); const rgba = parseNumberTokens(4).map(v=> v & 0xFF);
            expectBracket('[SPECTRUM EFFECT]'); const effRaw = next(); const effName = stripBacktick(effRaw).toUpperCase();
          const effMap: Record<string, Effect_Item> = { NONE:Effect_Item.NONE, DODGE:Effect_Item.DODGE, LINEARDODGE:Effect_Item.LINEARDODGE, DARK:Effect_Item.DARK, XOR:Effect_Item.XOR, MONOCHROME:Effect_Item.MONOCHROME, SPACEDISTORT:Effect_Item.SPACEDISTORT };
          const eff = effMap[effName]; if (eff === undefined) throw new Error('bad spectrum effect');
          overall.push({ type: ANIData.SPECTRUM, payload: { level, term, life, rgba, eff } });
          break; }
        default: throw new Error('unknown overall tag '+u);
      }
    }

    // 解析 frame max 块
    expectBracket('[FRAME MAX]');
    const declared = parseIntLine();
    const frames: FrameInfo[] = [];
    // 读取每个 frame
    function parseFrameHeader(expectIndex: number) {
      const tag = `[FRAME${String(expectIndex).padStart(3,'0')}]`;
      expectBracket(tag);
    }

    let frameIndex = 0;
    while (!eof()) {
      const l = peek();
      if (!l.startsWith('[FRAME')) break; // 额外 frames 以外的内容忽略
      parseFrameHeader(frameIndex);
      const info: FrameInfo = { boxes: [], image: { path: null, index: 0, posX: 0, posY: 0 }, items: [] };
      // 扫描直到下一个 FRAME 或 EOF
      while (!eof()) {
        const cur = peek();
        if (!cur) { next(); continue; }
        if (cur.startsWith('[FRAME') && cur.endsWith(']')) break; // 下一个 frame
        if (!isBracket(cur)) { idx++; continue; }
        const u = cur.toUpperCase();
        next();
        switch (u) {
          case '[DAMAGE BOX]': {
            const nums = parseNumberTokens(6); info.boxes.push({ type: ANIData.DAMAGE_BOX, nums }); break; }
          case '[ATTACK BOX]': {
            const nums = parseNumberTokens(6); info.boxes.push({ type: ANIData.ATTACK_BOX, nums }); break; }
          case '[IMAGE]': {
            const pathLine = stripBacktick(next());
            const idxLine = parseIntLine();
            info.image.path = pathLine === '' ? null : pathLine;
            info.image.index = idxLine | 0;
            break; }
          case '[IMAGE POS]': {
            const nums = parseNumberTokens(2); info.image.posX = nums[0]; info.image.posY = nums[1]; break; }
          case '[LOOP]': info.items.push({ type: ANIData.LOOP, payload: parseIntLine() & 0xFF }); break;
          case '[SHADOW]': info.items.push({ type: ANIData.SHADOW, payload: parseIntLine() & 0xFF }); break;
          case '[PRELOAD]': { // PRELOAD 行可能跟一个 1
            let maybe = peek();
            if (maybe && !isBracket(maybe)) { // consume value (通常 1)
              idx++;
            }
            info.items.push({ type: ANIData.PRELOAD }); break; }
          case '[COORD]': info.items.push({ type: ANIData.COORD, payload: parseIntLine() & 0xFFFF }); break;
          case '[IMAGE RATE]': { const f2 = parseFloatTokens(2); info.items.push({ type: ANIData.IMAGE_RATE, payload: f2 }); break; }
          case '[IMAGE ROTATE]': { const f1 = parseFloatTokens(1); info.items.push({ type: ANIData.IMAGE_ROTATE, payload: f1[0] }); break; }
          case '[CLIP]': { const nums = parseNumberTokens(4); info.items.push({ type: ANIData.CLIP, payload: nums.map(v=> v & 0xFFFF) }); break; }
          case '[RGBA]': { const nums = parseNumberTokens(4); info.items.push({ type: ANIData.RGBA, payload: nums.map(v=> v & 0xFF) }); break; }
          case '[INTERPOLATION]': info.items.push({ type: ANIData.INTERPOLATION, payload: parseIntLine() & 0xFF }); break;
          case '[DELAY]': info.items.push({ type: ANIData.DELAY, payload: parseIntLine()|0 }); break;
          case '[SET FLAG]': info.items.push({ type: ANIData.SET_FLAG, payload: parseIntLine()|0 }); break;
          case '[LOOP START]': info.items.push({ type: ANIData.LOOP_START }); break;
          case '[LOOP END]': info.items.push({ type: ANIData.LOOP_END, payload: parseIntLine()|0 }); break;
          case '[PLAY SOUND]': { const name = stripBacktick(next()); info.items.push({ type: ANIData.PLAY_SOUND, payload: name }); break; }
          case '[GRAPHIC EFFECT]': {
            const effRaw = next(); const effName = stripBacktick(effRaw).toUpperCase();
            const effMap: Record<string, Effect_Item> = { NONE:Effect_Item.NONE, DODGE:Effect_Item.DODGE, LINEARDODGE:Effect_Item.LINEARDODGE, DARK:Effect_Item.DARK, XOR:Effect_Item.XOR, MONOCHROME:Effect_Item.MONOCHROME, SPACEDISTORT:Effect_Item.SPACEDISTORT };
            const eff = effMap[effName]; if (eff === undefined) throw new Error('bad effect');
            let extra: any = undefined;
            if (eff === Effect_Item.MONOCHROME) { extra = parseNumberTokens(3).map(v=> v & 0xFF); }
            else if (eff === Effect_Item.SPACEDISTORT) { const n2 = parseNumberTokens(2).map(v=> v & 0xFFFF); extra = n2; }
            info.items.push({ type: ANIData.GRAPHIC_EFFECT, payload: { eff, extra } });
            break; }
          case '[DAMAGE TYPE]': { const dvRaw = next(); const map: Record<string, DAMAGE_TYPE_Item> = { '`NORMAL`':DAMAGE_TYPE_Item.NORMAL, '`SUPERARMOR`':DAMAGE_TYPE_Item.SUPERARMOR, '`UNBREAKABLE`':DAMAGE_TYPE_Item.UNBREAKABLE }; const dv = map[dvRaw.toUpperCase()]; if (dv===undefined) throw new Error('bad damage type'); info.items.push({ type: ANIData.DAMAGE_TYPE, payload: dv }); break; }
          case '[FLIP TYPE]': { const fvRaw = next(); const map: Record<string, FLIP_TYPE_Item> = { '`HORIZON`':FLIP_TYPE_Item.HORIZON, '`VERTICAL`':FLIP_TYPE_Item.VERTICAL, '`ALL`':FLIP_TYPE_Item.ALL }; const fv=map[fvRaw.toUpperCase()]; if (fv===undefined) throw new Error('bad flip type'); info.items.push({ type: ANIData.FLIP_TYPE, payload: fv }); break; }
          default: // 未知标签 -> 直接失败（回退文本保存）
            throw new Error('unknown frame tag '+u);
        }
      }
      frames.push(info); frameIndex++;
    }

    // 若声明帧数与实际不符，以实际覆盖声明；编译输出端写实际帧数
    const frameCount = frames.length;
    if (frameMaxDeclared !== -1 && frameMaxDeclared !== frameCount) {
      // 不抛异常：宽容处理
    }

    // 收集图片（顺序：首次出现）
    const imageSet: string[] = [];
    for (const fr of frames) {
      if (fr.image.path && !imageSet.includes(fr.image.path)) imageSet.push(fr.image.path);
    }

    // 写二进制
    const data: number[] = [];
    const pushU16 = (v:number)=>{ data.push(v & 0xFF, (v>>>8)&0xFF); };
    const pushI16 = (v:number)=>{ if (v<0) v = 0x10000 + (v & 0xFFFF); pushU16(v); };
    const pushU32 = (v:number)=>{ data.push(v &0xFF,(v>>>8)&0xFF,(v>>>16)&0xFF,(v>>>24)&0xFF); };
    const pushI32 = (v:number)=> pushU32(v|0);
    const pushF32 = (f:number)=>{ const buf=new ArrayBuffer(4); new DataView(buf).setFloat32(0,f,true); const b=new Uint8Array(buf); data.push(b[0],b[1],b[2],b[3]); };

    // frame count
    pushU16(frameCount);
    // images
    pushU16(imageSet.length);
    for (const img of imageSet) {
      pushU32(img.length);
      for (let i=0;i<img.length;i++) data.push(img.charCodeAt(i) & 0x7F);
    }

    // overall items
    pushU16(overall.length);
    for (const o of overall) {
      pushU16(o.type);
      switch (o.type) {
        case ANIData.LOOP:
        case ANIData.SHADOW: data.push(o.payload & 0xFF); break;
        case ANIData.COORD:
        case ANIData.OPERATION: pushU16(o.payload & 0xFFFF); break;
        case ANIData.SPECTRUM: {
          const p = o.payload; data.push(p.level & 0xFF); pushU32(p.term|0); pushU32(p.life|0); data.push(p.rgba[0]&0xFF,p.rgba[1]&0xFF,p.rgba[2]&0xFF,p.rgba[3]&0xFF); pushU16(p.eff & 0xFFFF); break; }
        default: throw new Error('serialize overall unsupported');
      }
    }

    // frames
    for (const fr of frames) {
      // boxes
      pushU16(fr.boxes.length);
      for (const b of fr.boxes) {
        pushU16(b.type);
        for (const n of b.nums) pushI32(n|0);
      }
      // image index
      if (fr.image.path) {
        const idxImg = imageSet.indexOf(fr.image.path);
        pushI16(idxImg);
        pushI16(fr.image.index|0);
      } else {
        pushI16(-1);
        pushI16(0);
      }
      pushI32(fr.image.posX|0); pushI32(fr.image.posY|0);
      // frame items
      pushU16(fr.items.length);
      for (const it of fr.items) {
        pushU16(it.type);
        switch (it.type) {
          case ANIData.LOOP:
          case ANIData.SHADOW:
          case ANIData.INTERPOLATION: data.push(it.payload & 0xFF); break;
          case ANIData.COORD: pushU16(it.payload & 0xFFFF); break;
          case ANIData.PRELOAD: /* 无额外数据 */ break;
          case ANIData.IMAGE_RATE: pushF32(it.payload[0]); pushF32(it.payload[1]); break;
          case ANIData.IMAGE_ROTATE: pushF32(it.payload); break;
          case ANIData.RGBA: data.push(it.payload[0],it.payload[1],it.payload[2],it.payload[3]); break;
          case ANIData.GRAPHIC_EFFECT: {
            const p = it.payload; pushU16(p.eff & 0xFFFF); if (p.eff === Effect_Item.MONOCHROME) { data.push(p.extra[0],p.extra[1],p.extra[2]); } else if (p.eff === Effect_Item.SPACEDISTORT) { pushU16(p.extra[0]); pushU16(p.extra[1]); } break; }
          case ANIData.DELAY:
          case ANIData.SET_FLAG:
            pushI32(it.payload|0); break;
          case ANIData.PLAY_SOUND: {
            const name: string = it.payload || ''; pushU32(name.length); for (let i=0;i<name.length;i++) data.push(name.charCodeAt(i) & 0x7F); break; }
          case ANIData.DAMAGE_TYPE:
          case ANIData.FLIP_TYPE: pushU16(it.payload & 0xFFFF); break;
          case ANIData.LOOP_START: break;
          case ANIData.LOOP_END: pushI32(it.payload|0); break;
          case ANIData.CLIP: { const a = it.payload as number[]; for (const v of a) pushU16(v & 0xFFFF); break; }
          default: throw new Error('serialize frame item unsupported');
        }
      }
    }

    return new Uint8Array(data);
  } catch {
    return null; // 触发上层回退文本保存逻辑
  }
}
