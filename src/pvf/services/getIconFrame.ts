
import * as vscode from 'vscode';

export interface IconFrameResult { ok: boolean; base64?: string; error?: string; }

// path: 图像资源脚本路径（如 texture/icon/foo.img） frameIndex: 帧序号
export async function getIconFrameBase64(path: string, frameIndex: number): Promise<IconFrameResult> {
  try {
    const norm = path.trim().replace(/[`'"\\]+/g,'/').replace(/^[\/]+/,'').replace(/\/+/g,'/').toLowerCase();
    // 确保有 sprite/ 前缀
    const logical = norm.startsWith('sprite/') ? norm : 'sprite/' + norm;
    // 从配置获取 npk 根目录
    const root = (vscode.workspace.getConfiguration().get<string>('pvf.npkRoot') || '').trim();
    if (!root) return { ok:false, error:'no_npk_root' };
    const { loadAlbumForImage } = await import('../../commander/previewAni/npkResolver.js');
    const { getSpriteRgba } = await import('../../npk/imgReader.js');
    const album: any = await loadAlbumForImage({} as any, root, logical).catch(()=>undefined);
    if (!album || !album.sprites || !album.sprites[frameIndex]) return { ok:false, error:'frame_not_found' };
    const rgba: Uint8Array | undefined = getSpriteRgba(album, frameIndex);
    if (!rgba) return { ok:false, error:'decode_failed' };
    const sp = album.sprites[frameIndex];
    const png = await encodeSimplePng(rgba, sp.width, sp.height);
    return { ok:true, base64: png.toString('base64') };
  } catch (e:any) {
    return { ok:false, error:String(e?.message||e) };
  }
}

async function encodeSimplePng(rgba: Uint8Array, w: number, h: number): Promise<Buffer> {
  const zlib = await import('zlib');
  const stride = w * 4;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y=0;y<h;y++) {
    raw[y*(stride+1)] = 0; // filter
    const line = rgba.subarray(y*stride, y*stride+stride);
    line.forEach((v,i)=>{ raw[y*(stride+1)+1+i]=v; });
  }
  function crc32(buf: Uint8Array): number { let crc = ~0; for (let i=0;i<buf.length;i++){ crc ^= buf[i]; for (let j=0;j<8;j++){ const m = -(crc & 1); crc = (crc>>>1) ^ (0xEDB88320 & m); } } return ~crc >>> 0; }
  function chunk(type: string, data: Uint8Array, out: number[]) { const len=data.length; out.push((len>>>24)&255,(len>>>16)&255,(len>>>8)&255,len&255); const tb=Buffer.from(type,'ascii'); const cdata=new Uint8Array(tb.length+data.length); cdata.set(tb,0); cdata.set(data,tb.length); const c=crc32(cdata); for(const b of cdata) out.push(b); out.push((c>>>24)&255,(c>>>16)&255,(c>>>8)&255,c&255); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w,0); ihdr.writeUInt32BE(h,4); ihdr[8]=8; ihdr[9]=6; ihdr[10]=ihdr[11]=ihdr[12]=0; const idat = zlib.deflateSync(raw,{level:9});
  const out: number[] = []; out.push(137,80,78,71,13,10,26,10); chunk('IHDR', ihdr, out); chunk('IDAT', idat, out); chunk('IEND', new Uint8Array(), out); return Buffer.from(out);
}
export default getIconFrameBase64;
