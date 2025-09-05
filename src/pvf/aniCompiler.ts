import { ANIData, Effect_Item, DAMAGE_TYPE_Item, FLIP_TYPE_Item } from './binaryAni';

// Compile textual ANI back to binary similar to pvfUtility BinaryAniCompiler (subset). Returns null on failure.
export function compileBinaryAni(text: string, fileName: string = 'unknown.ani'): Uint8Array | null {
  try {
    const split = text.split(/[\r\n\t]+/).map(s=> s.trim()).filter(s=> s.length>0 && s !== '#PVF_File');
    const count = split.length;
    const frameIndex: number[] = [];
    for (let j=0;j<count;j++) {
      const tok = split[j];
      if (tok.length>6 && tok.startsWith('[FRAME') && tok !== '[FRAME MAX]') frameIndex.push(j);
    }
    frameIndex.push(count);
    const frameCount = frameIndex.length - 1;
    const data: number[] = [];
    const pushU16 = (v:number)=>{ data.push(v & 0xFF, (v>>>8)&0xFF); };
    const pushI16 = (v:number)=>{ if (v<0) v = 0x10000 + (v & 0xFFFF); pushU16(v); };
    const pushU32 = (v:number)=>{ data.push(v & 0xFF, (v>>>8)&0xFF, (v>>>16)&0xFF, (v>>>24)&0xFF); };
    const pushI32 = (v:number)=>{ pushU32(v|0); };
    const pushF32 = (f:number)=>{ const buf=new ArrayBuffer(4); new DataView(buf).setFloat32(0,f,true); const b=new Uint8Array(buf); data.push(b[0],b[1],b[2],b[3]); };

    // frame max
    pushU16(frameCount);
    // image list
    const imgList: string[] = [];
    for (let j=0;j<count;j++) {
      if (split[j] === '[IMAGE]') {
        const imgFile = split[j+1];
        if (imgFile !== '``' && !imgList.includes(imgFile)) imgList.push(imgFile);
        if (imgFile === '``') split[j+1] = '-1';
      }
    }
    pushU16(imgList.length);
    for (const raw of imgList) {
      const inner = raw.replace(/^`|`$/g,'');
      pushU32(inner.length);
      for (let i=0;i<inner.length;i++) data.push(inner.charCodeAt(i)&0x7F);
    }

    const overallTemp: number[] = []; let overallCount=0;
    for (let j=0;j<frameIndex[0];j++) {
      const tok = split[j];
      if (!tok || tok[0] !== '[') continue;
      if (tok.startsWith('[FRAME')) continue;
      overallCount++;
      switch (tok) {
        case '[LOOP]': overallTemp.push(ANIData.LOOP & 0xFF, (ANIData.LOOP>>>8)&0xFF, Number(split[j+1]) & 0xFF); break;
        case '[SHADOW]': overallTemp.push(ANIData.SHADOW & 0xFF, (ANIData.SHADOW>>>8)&0xFF, Number(split[j+1]) & 0xFF); break;
        case '[COORD]': overallTemp.push(ANIData.COORD & 0xFF,(ANIData.COORD>>>8)&0xFF, Number(split[j+1]) & 0xFF, Number(split[j+1])>>>8 & 0xFF); break;
        case '[OPERATION]': overallTemp.push(ANIData.OPERATION & 0xFF,(ANIData.OPERATION>>>8)&0xFF, Number(split[j+1]) & 0xFF, Number(split[j+1])>>>8 & 0xFF); break;
        case '[SPECTRUM]': {
          // simplified expectation of layout
          const termVal = split[j+3];
          const lifeVal = split[j+5];
          const c1 = split[j+7]; const c2 = split[j+8]; const c3 = split[j+9]; const c4 = split[j+10];
          const effectVal = split[j+12];
          overallTemp.push(ANIData.SPECTRUM & 0xFF,(ANIData.SPECTRUM>>>8)&0xFF, Number(split[j+1]) & 0xFF);
          const pushU32To=(arr:number[],v:number)=> arr.push(v &0xFF,(v>>>8)&0xFF,(v>>>16)&0xFF,(v>>>24)&0xFF);
          pushU32To(overallTemp, Number(termVal));
          pushU32To(overallTemp, Number(lifeVal));
          overallTemp.push(Number(c1)&0xFF,Number(c2)&0xFF,Number(c3)&0xFF,Number(c4)&0xFF);
          const eff = effectVal.replace(/^`|`$/g,'').toUpperCase();
          const effMap: Record<string,Effect_Item> = { NONE:Effect_Item.NONE, DODGE:Effect_Item.DODGE, LINEARDODGE:Effect_Item.LINEARDODGE, DARK:Effect_Item.DARK, MONOCHROME:Effect_Item.MONOCHROME };
          const effVal = effMap[eff] ?? Effect_Item.NONE;
          overallTemp.push(effVal &0xFF,(effVal>>>8)&0xFF);
          break; }
        default: return null;
      }
    }
    pushU16(overallCount); data.push(...overallTemp);

    function effectNameToVal(name:string){ const n=name.toUpperCase(); switch(n){case '`NONE`':return Effect_Item.NONE;case '`DODGE`':return Effect_Item.DODGE;case '`LINEARDODGE`':return Effect_Item.LINEARDODGE;case '`DARK`':return Effect_Item.DARK;case '`XOR`':return Effect_Item.XOR;case '`MONOCHROME`':return Effect_Item.MONOCHROME;case '`SPACEDISTORT`':return Effect_Item.SPACEDISTORT;default:return -1;} }
    function damageTypeToVal(name:string){ const n=name.toUpperCase(); if(n==='`SUPERARMOR`')return DAMAGE_TYPE_Item.SUPERARMOR; if(n==='`NORMAL`')return DAMAGE_TYPE_Item.NORMAL; if(n==='`UNBREAKABLE`')return DAMAGE_TYPE_Item.UNBREAKABLE; return -1; }
    function flipTypeToVal(name:string){ const n=name.toUpperCase(); if(n==='`ALL`')return FLIP_TYPE_Item.ALL; if(n==='`HORIZON`')return FLIP_TYPE_Item.HORIZON; if(n==='`VERTICAL`')return FLIP_TYPE_Item.VERTICAL; return -1; }

    for (let fi=1; fi<frameIndex.length; fi++) {
      const start=frameIndex[fi-1]; const stop=frameIndex[fi];
      const boxTemp:number[]=[]; let boxCount=0; let imgFile='-1'; let imgFileIndex='0'; let imgPos1='0'; let imgPos2='0';
      const pushI32To=(arr:number[],v:number)=> arr.push(v &0xFF,(v>>>8)&0xFF,(v>>>16)&0xFF,(v>>>24)&0xFF);
      for (let j=start; j<stop; j++) {
        const tok = split[j]; if(!tok || tok[0] !== '[') continue;
        if (tok === '[DAMAGE BOX]' || tok === '[ATTACK BOX]') {
          const type = tok==='[DAMAGE BOX]' ? ANIData.DAMAGE_BOX : ANIData.ATTACK_BOX; boxTemp.push(type &0xFF,(type>>>8)&0xFF);
          for (let k=1;k<=6;k++){ pushI32To(boxTemp, parseInt(split[j+k],10)|0); }
          boxCount++; continue;
        }
        if (tok === '[IMAGE]') { imgFile = split[j+1]; imgFileIndex = split[j+2]; }
        if (tok === '[IMAGE POS]') { imgPos1 = split[j+1]; imgPos2 = split[j+2]; }
      }
      pushU16(boxCount); data.push(...boxTemp);
      if (imgFile !== '-1') { const idx = imgList.indexOf(imgFile); pushI16(idx); pushI16(parseInt(imgFileIndex,10)|0); } else { pushI16(-1); }
      pushI32(parseInt(imgPos1,10)|0); pushI32(parseInt(imgPos2,10)|0);
      const frameItemTemp:number[]=[]; let frameItemCount=0;
      for (let j=start; j<stop; j++) {
        const tok=split[j]; if(!tok || tok[0] !== '[') continue; if(tok.startsWith('[FRAME')) continue; if(tok==='[DAMAGE BOX]'||tok==='[ATTACK BOX]'||tok==='[IMAGE]'||tok==='[IMAGE POS]') continue;
        frameItemCount++;
        switch (tok) {
          case '[LOOP]': frameItemTemp.push(ANIData.LOOP &0xFF,(ANIData.LOOP>>>8)&0xFF, Number(split[j+1]) &0xFF); break;
          case '[SHADOW]': frameItemTemp.push(ANIData.SHADOW &0xFF,(ANIData.SHADOW>>>8)&0xFF, Number(split[j+1]) &0xFF); break;
          case '[PRELOAD]': frameItemTemp.push(ANIData.PRELOAD &0xFF,(ANIData.PRELOAD>>>8)&0xFF); break;
          case '[COORD]': { frameItemTemp.push(ANIData.COORD &0xFF,(ANIData.COORD>>>8)&0xFF); const v=Number(split[j+1])|0; frameItemTemp.push(v &0xFF,(v>>>8)&0xFF); break; }
          case '[IMAGE RATE]': { frameItemTemp.push(ANIData.IMAGE_RATE &0xFF,(ANIData.IMAGE_RATE>>>8)&0xFF); pushF32(parseFloat(split[j+1])); pushF32(parseFloat(split[j+2])); break; }
          case '[IMAGE ROTATE]': { frameItemTemp.push(ANIData.IMAGE_ROTATE &0xFF,(ANIData.IMAGE_ROTATE>>>8)&0xFF); pushF32(parseFloat(split[j+1])); break; }
          case '[CLIP]': { frameItemTemp.push(ANIData.CLIP &0xFF,(ANIData.CLIP>>>8)&0xFF); for(let k=1;k<=4;k++){ const v=parseInt(split[j+k],10)|0; frameItemTemp.push(v &0xFF,(v>>>8)&0xFF); } break; }
          case '[RGBA]': { frameItemTemp.push(ANIData.RGBA &0xFF,(ANIData.RGBA>>>8)&0xFF); for (let k=1;k<=4;k++){ frameItemTemp.push(Number(split[j+k]) &0xFF); } break; }
          case '[INTERPOLATION]': frameItemTemp.push(ANIData.INTERPOLATION &0xFF,(ANIData.INTERPOLATION>>>8)&0xFF, Number(split[j+1]) &0xFF); break;
          case '[DELAY]': { frameItemTemp.push(ANIData.DELAY &0xFF,(ANIData.DELAY>>>8)&0xFF); pushI32To(frameItemTemp, parseInt(split[j+1],10)|0); break; }
          case '[SET FLAG]': { frameItemTemp.push(ANIData.SET_FLAG &0xFF,(ANIData.SET_FLAG>>>8)&0xFF); pushI32To(frameItemTemp, parseInt(split[j+1],10)|0); break; }
          case '[LOOP START]': frameItemTemp.push(ANIData.LOOP_START &0xFF,(ANIData.LOOP_START>>>8)&0xFF); break;
          case '[LOOP END]': { frameItemTemp.push(ANIData.LOOP_END &0xFF,(ANIData.LOOP_END>>>8)&0xFF); pushI32To(frameItemTemp, parseInt(split[j+1],10)|0); break; }
          case '[PLAY SOUND]': { frameItemTemp.push(ANIData.PLAY_SOUND &0xFF,(ANIData.PLAY_SOUND>>>8)&0xFF); const raw=split[j+1].replace(/^`|`$/g,''); pushI32To(frameItemTemp, raw.length); for(const c of raw) frameItemTemp.push(c.charCodeAt(0)&0x7F); break; }
          case '[GRAPHIC EFFECT]': { frameItemTemp.push(ANIData.GRAPHIC_EFFECT &0xFF,(ANIData.GRAPHIC_EFFECT>>>8)&0xFF); const effVal = effectNameToVal(split[j+1]); if (effVal<0) return null; frameItemTemp.push(effVal &0xFF,(effVal>>>8)&0xFF); if (effVal===Effect_Item.MONOCHROME){ frameItemTemp.push(Number(split[j+2])&0xFF,Number(split[j+3])&0xFF,Number(split[j+4])&0xFF); } if (effVal===Effect_Item.SPACEDISTORT){ const a=parseInt(split[j+2],10)|0; const b=parseInt(split[j+3],10)|0; frameItemTemp.push(a &0xFF,(a>>>8)&0xFF,b &0xFF,(b>>>8)&0xFF); } break; }
          case '[DAMAGE TYPE]': { frameItemTemp.push(ANIData.DAMAGE_TYPE &0xFF,(ANIData.DAMAGE_TYPE>>>8)&0xFF); const dv=damageTypeToVal(split[j+1]); if(dv<0) return null; frameItemTemp.push(dv &0xFF,(dv>>>8)&0xFF); break; }
          case '[FLIP TYPE]': { frameItemTemp.push(ANIData.FLIP_TYPE &0xFF,(ANIData.FLIP_TYPE>>>8)&0xFF); const fv=flipTypeToVal(split[j+1]); if (fv<0) return null; frameItemTemp.push(fv &0xFF,(fv>>>8)&0xFF); break; }
          default: return null;
        }
      }
      pushU16(frameItemCount); data.push(...frameItemTemp);
    }

    return new Uint8Array(data);
  } catch { return null; }
}
