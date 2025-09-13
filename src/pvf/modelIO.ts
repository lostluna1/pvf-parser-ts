import * as fs from 'fs/promises';
import * as path from 'path';
import { performance } from 'perf_hooks';
import { PvfCrypto } from './crypto';
import { PvfFile } from './pvfFile';

// Note: typed as any to avoid circular type import
export async function openImpl(this: any, filePath: string, progress?: any) {
  this.pvfPath = filePath;
  const fd = await fs.open(filePath, 'r');
  let pos = 0;
  const readBuf = async (len: number) => {
    const b = Buffer.alloc(len);
    await fd.read({ buffer: b, position: pos });
    pos += len;
    return b;
  };

  // header
  this.guidLen = (await readBuf(4)).readInt32LE(0);
  this.guid = await readBuf(this.guidLen);
  this.fileVersion = (await readBuf(4)).readInt32LE(0);
  const fileTreeLen = (await readBuf(4)).readInt32LE(0);
  const fileTreeChecksum = (await readBuf(4)).readUInt32LE(0);
  const fileCount = (await readBuf(4)).readInt32LE(0);

  const fileTreeEnc = await readBuf(fileTreeLen);
  const fileTree = PvfCrypto.decrypt(fileTreeEnc, fileTreeLen, fileTreeChecksum);

  this.fileList.clear();
  const dv = new DataView(fileTree.buffer, fileTree.byteOffset, fileTree.byteLength);
  let tp = 0;
  for (let i = 0; i < fileCount; i++) {
    const fileNameChecksum = dv.getUint32(tp, true); tp += 4;
    const nameLen = dv.getUint32(tp, true); tp += 4;
    const nameBytes = fileTree.subarray(tp, tp + nameLen); tp += nameLen;
    const dataLen = dv.getInt32(tp, true); tp += 4;
    const checksum = dv.getUint32(tp, true); tp += 4;
    const offset = dv.getInt32(tp, true); tp += 4;
    const pf = new PvfFile(fileNameChecksum, nameBytes, dataLen, checksum, offset);
    this.fileList.set(pf.fileName, pf);
    if (progress && i % 512 === 0) progress(Math.floor((i / fileCount) * 50));
  }
  if (progress) progress(50); // 确保文件列表阶段结束后显示 50%
  this.baseOffset = pos; // data section start offset
  // -------- 优化解密：批量读取数据区 + 切片解密 --------
  const values: PvfFile[] = [...this.fileList.values()];
  // 计算数据区总长度（按最大 offset + blockLength）
  let dataSectionSize = 0;
  for (const f of values) {
    const end = f.offset + f.blockLength;
    if (end > dataSectionSize) dataSectionSize = end;
  }
  const BULK_THRESHOLD = 1024 * 1024 * 1024; // 1GB 阈值，超出则回退逐块
  let bulk: Buffer | null = null;
  try {
    if (dataSectionSize > 0 && dataSectionSize <= BULK_THRESHOLD) {
      bulk = Buffer.allocUnsafe(dataSectionSize);
      await fd.read({ buffer: bulk, position: this.baseOffset });
    }
  } catch {
    bulk = null; // 回退
  }
  // 复用单一缓冲（逐块路径）以减少频繁 alloc
  let reusableBuf: Buffer | null = null;
  for (let i = 0; i < values.length; i++) {
    const f: any = values[i];
    if (f.dataLen > 0) {
      try {
        let encView: Uint8Array;
        if (bulk) {
          encView = new Uint8Array(bulk.buffer, bulk.byteOffset + f.offset, f.blockLength);
        } else {
          if (!reusableBuf || reusableBuf.length < f.blockLength) reusableBuf = Buffer.alloc(f.blockLength);
          await fd.read({ buffer: reusableBuf, position: this.baseOffset + f.offset });
          encView = new Uint8Array(reusableBuf.buffer, reusableBuf.byteOffset, f.blockLength);
        }
        // 直接调用加解密函数 (保持 C# 逻辑)；PvfFile.initFile 里再次 decrypt 会复制，所以改为手动流程以少一次 alloc
        const dec = PvfCrypto.decrypt(encView, f.blockLength, f.checksum);
        // zero padding (与 initFile 一致)
        for (let z = 0; z < f.blockLength - f.dataLen; z++) dec[f.dataLen + z] = 0;
        f.data = dec;
      } catch (e) {
        if (process.env.PVF_DEBUG_OPEN === '1') console.warn('[pvf open] decrypt fail', f.fileName, (e as any)?.message);
        f.data = new Uint8Array(0);
      }
    } else {
      f.data = new Uint8Array(0);
    }
    if (progress && i % 1024 === 0) progress(50 + Math.floor((i / values.length) * 20));
  }
  await fd.close();

  // reset lazy caches
  this.childrenCache.clear();
  this.rootChildren = null;

  // Load stringtable and string view for script decompile (best-effort)
  try {
    await this.loadStringAssets();
  } catch {
    // ignore, decompile will fallback partially
  }
  if (progress) progress(50); // string 资源加载完成，保持 50%
}

export async function saveImpl(this: any, filePath: string, progress?: any) {
  const profileMarks: Record<string, number> = {};
  const mark = (k: string) => { profileMarks[k] = performance.now(); };
  const since = (a: string, b: string) => (profileMarks[b] - profileMarks[a]).toFixed(1);
  mark('start');
  let writeCallsCaptured = 0; // 供日志阶段读取
  let fastPathUsed = false;   // 标记是否使用 fastPath
  await this.ensureStringTableUpToDate();
  mark('afterEnsureStringTable');

  const files = [...this.fileList.values()].sort((a: any, b: any) => a.fileNameChecksum - b.fileNameChecksum);
  const fileCount = files.length;
  // 统计变化情况
  let changedFiles = 0, changedBytes = 0, totalBytesPlanned = 0;
  for (const f of files) {
    totalBytesPlanned += f.blockLength;
    if (f.changed && f.data) { changedFiles++; changedBytes += f.blockLength; }
  }
  console.log('[pvf save] pre-stats fileCount=', fileCount, 'changedFiles=', changedFiles, 'changedBytesMB=', (changedBytes/1024/1024).toFixed(2), 'totalMB=', (totalBytesPlanned/1024/1024).toFixed(2));

  // ---------- 构建文件树（小内存） ----------
  let fileTreeLen = 0;
  for (const f of files) fileTreeLen += f.fileNameLen + 20;
  fileTreeLen = (fileTreeLen + 3) & -4;
  const fileTree = new Uint8Array(fileTreeLen);
  const dv = new DataView(fileTree.buffer);
  let tp = 0;
  let dataOffset = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    dv.setUint32(tp, f.fileNameChecksum, true); tp += 4;
    dv.setUint32(tp, f.fileNameLen, true); tp += 4;
    fileTree.set(f.fileNameBytes, tp); tp += f.fileNameLen;
    dv.setInt32(tp, f.dataLen, true); tp += 4;
    dv.setUint32(tp, f.checksum, true); tp += 4;
    dv.setInt32(tp, dataOffset, true); tp += 4;
    dataOffset += f.blockLength;
    if (progress && i % 1024 === 0) progress(Math.floor((i / (files.length * 2)) * 100));
  }
  const fileTreeChecksum = PvfCrypto.createBuffKey(fileTree, fileTreeLen, this.fileList.size >>> 0);
  const fileTreeEnc = PvfCrypto.encrypt(fileTree, fileTreeLen, fileTreeChecksum);
  mark('afterFileTree');

  const ending = Buffer.from([0, ...Buffer.from('This pvf Pack was created by pvfUtility.')]);

  // 如果保存路径与当前打开路径相同，先写临时文件避免覆盖源导致读取失败
  const sameTarget = this.pvfPath && path.resolve(this.pvfPath) === path.resolve(filePath);
  const targetPath = sameTarget ? filePath + '.tmp-saving' : filePath;

  const destFd = await fs.open(targetPath, 'w');
  const srcFd = this.pvfPath ? await fs.open(this.pvfPath, 'r') : undefined;
  // ---------- 计算数据区总大小以决定是否批量读取 ----------
  let bulkData: Buffer | undefined;
  if (srcFd && files.length > 0) {
    let maxEnd = 0;
    for (const f of files) {
      const end = f.offset + f.blockLength;
      if (end > maxEnd) maxEnd = end;
    }
    const dataSectionSize = maxEnd; // offsets 相对 data section 起点 (this.baseOffset)
  const BULK_LIMIT = 2 * 1024 * 1024 * 1024; // 2GB 阈值（如内存允许可调更高；若 OOM 可下调）
    try {
      if (dataSectionSize > 0 && dataSectionSize <= BULK_LIMIT) {
        bulkData = Buffer.allocUnsafe(dataSectionSize);
        // 一次性顺序读取全部数据区
        await srcFd.read({ buffer: bulkData, position: this.baseOffset });
        if (progress) progress(5); // 小幅提示批量读取完成
      }
    } catch {
      bulkData = undefined; // 回退
    }
  }
  let writePos = 0;
  try {
    // ---------- 写入头部 ----------
    const header = Buffer.alloc(4 + this.guidLen + 4 + 4 + 4 + 4 + fileTreeEnc.length);
    let hp = 0;
    header.writeInt32LE(this.guidLen, hp); hp += 4;
    this.guid.copy(header, hp); hp += this.guidLen;
    header.writeInt32LE(this.fileVersion, hp); hp += 4;
    header.writeInt32LE(fileTreeLen, hp); hp += 4;
    header.writeUInt32LE(fileTreeChecksum, hp); hp += 4;
    header.writeInt32LE(fileCount, hp); hp += 4;
    Buffer.from(fileTreeEnc).copy(header, hp); hp += fileTreeEnc.length;
    await destFd.write(header, 0, header.length, writePos); writePos += header.length;
  mark('afterHeader');

    // ---------- 写入文件数据（流式） ----------
    // 计算数据区总长度（仅文件数据，不含结尾）用于 fastPath 判定
    const totalDataBytes = dataOffset;
    const FASTPATH_LIMIT = 1.5 * 1024 * 1024 * 1024; // 1.5GB
    const enableFastPath = !!bulkData && totalDataBytes <= FASTPATH_LIMIT;

  console.log('[pvf save] fastPath candidate bulkData=', !!bulkData, 'totalDataBytesMB=', (totalDataBytes/1024/1024).toFixed(2), 'enableFastPath=', enableFastPath);
  if (enableFastPath) {
      // ---------- FAST PATH: 一次准备所有块，然后批量 writev ----------
      const buffers: Buffer[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        if (f.blockLength <= 0) continue;
        if (f.changed && f.data) {
          const enc = PvfCrypto.encryptFast(f.data, f.blockLength, f.checksum);
          buffers.push(Buffer.from(enc));
        } else {
          // unchanged -> 直接引用 bulkData 视图
          const sliceOffset = bulkData!.byteOffset + f.offset;
          buffers.push(Buffer.from(bulkData!.buffer, sliceOffset, f.blockLength));
        }
        if (progress && i % 8192 === 0) progress(Math.floor(((i) / (files.length * 2)) * 100));
      }
      mark('afterFiles');
      // 写入所有数据块（分批避免一次 writev 过多）
      const MAX_V = 8192;
      let idx = 0;
      while (idx < buffers.length) {
        const group = buffers.slice(idx, idx + MAX_V);
        if ((destFd as any).writev) {
          await (destFd as any).writev(group, writePos);
          for (const b of group) writePos += b.length;
        } else {
          const merged = Buffer.concat(group);
          await destFd.write(merged, 0, merged.length, writePos); writePos += merged.length;
        }
        idx += MAX_V;
      }
  await destFd.write(ending, 0, ending.length, writePos); writePos += ending.length;
  mark('afterEnding');
  for (const f of files) f.changed = false;
  writeCallsCaptured = Math.ceil(buffers.length / 8192) + 2;
  fastPathUsed = true; // 不再继续普通路径
  console.log('[pvf save][fastPath] blocks=', buffers.length, 'writeGroups≈', writeCallsCaptured);
  // 不在此处 return，留给正常流程执行 rename / 日志 / 返回值
    }

    // 如果 fastPath 已完成，跳过普通路径实现
    if (fastPathUsed) {
      // fastPath 已完成 afterFiles/afterEnding 标记
    } else {
    // ---- 普通路径：聚合多个小块，使用 writev (若可用) 或拼接 ----
  const TARGET_BATCH_BYTES = 4 * 1024 * 1024; // 提升批大小以减少 write 调用
    const MAX_BATCH_BUFFERS = 2048; // 防止过多引用
    let batch: Buffer[] = [];
    let batchBytes = 0;
    let writeCalls = 0; // 底层写次数
    const flushBatch = async () => {
      if (!batchBytes) return;
      try {
        if ((destFd as any).writev && batch.length > 1) {
          // Node FileHandle.writev(buffers, position?)
          await (destFd as any).writev(batch, writePos);
          writePos += batchBytes;
        } else if (batch.length === 1) {
          const b = batch[0];
          await destFd.write(b, 0, b.length, writePos); writePos += b.length;
        } else {
          // 拼接成一个 Buffer 再写
          const merged = Buffer.concat(batch, batchBytes);
          await destFd.write(merged, 0, merged.length, writePos); writePos += merged.length;
        }
      } finally {
        writeCalls++;
        batch = []; batchBytes = 0;
      }
    };
    const pushBlock = async (buf: Buffer) => {
      // 大块直接单独刷写，避免复制
      if (buf.length >= TARGET_BATCH_BYTES) {
        await flushBatch();
        await destFd.write(buf, 0, buf.length, writePos); writePos += buf.length; writeCalls++;
        return;
      }
      batch.push(buf); batchBytes += buf.length;
      if (batchBytes >= TARGET_BATCH_BYTES || batch.length >= MAX_BATCH_BUFFERS) {
        await flushBatch();
      }
    };
    const copyEncrypted = async (f: any) => {
      if (!srcFd) return false;
      if (bulkData) {
        // 零拷贝创建 Buffer 视图（不复制数据）
        const sliceOffset = bulkData.byteOffset + f.offset;
        const buf = Buffer.from(bulkData.buffer, sliceOffset, f.blockLength);
        await pushBlock(buf);
        return true;
      }
      const total = f.blockLength;
      const chunkSize = total > 4 * 1024 * 1024 ? 1 * 1024 * 1024 : total;
      let remaining = total;
      let srcPos = this.baseOffset + f.offset;
      const buf = Buffer.alloc(Math.min(chunkSize, total));
      while (remaining > 0) {
        const readLen = Math.min(buf.length, remaining);
        const { bytesRead } = await srcFd.read({ buffer: buf, position: srcPos, length: readLen });
        if (bytesRead !== readLen) throw new Error('Unexpected EOF while copying block');
        await pushBlock(buf.subarray(0, readLen));
        srcPos += readLen; remaining -= readLen;
      }
      return true;
    };

  for (let i = 0; i < files.length; i++) {
      const f = files[i];
      if (f.blockLength > 0) {
        if (f.changed && f.data) {
          const enc = PvfCrypto.encryptFast(f.data, f.blockLength, f.checksum);
          await pushBlock(Buffer.from(enc));
        } else if (srcFd) {
          await copyEncrypted(f);
        } else {
          if (!f.data) {
            const data = await this.readAndDecrypt(f);
            const enc = PvfCrypto.encryptFast(data, f.blockLength, f.checksum);
            await pushBlock(Buffer.from(enc));
          } else {
            const enc = PvfCrypto.encryptFast(f.data, f.blockLength, f.checksum);
            await pushBlock(Buffer.from(enc));
          }
        }
      }
      if (progress && i % 8192 === 0) progress(Math.floor(((fileCount + i) / (fileCount * 2)) * 100));
    }
    await flushBatch();
    mark('afterFiles');
    // ---------- 写入结尾标记 ----------
    await pushBlock(ending);
    await flushBatch();
    mark('afterEnding');
    writeCallsCaptured = writeCalls;
    }
  } finally {
    await destFd.close();
    if (srcFd) await srcFd.close();
  }

  // 若为同路径保存，替换原文件（fastPath 和普通路径都需执行）
  if (sameTarget) {
    await fs.rename(targetPath, filePath);
  }

  // 普通路径才需要在此清除 changed；fastPath 已清除
  if (!fastPathUsed) {
    for (const f of files) f.changed = false;
  }
  mark('afterFlagClear');

  // 输出性能分析
  try {
    console.log('[pvf save] phases (ms):', {
      ensureStringTable: since('start', 'afterEnsureStringTable'),
      buildFileTree: since('afterEnsureStringTable', 'afterFileTree'),
      headerWrite: since('afterFileTree', 'afterHeader'),
      fileWrites: since('afterHeader', 'afterFiles'),
      endingWrite: since('afterFiles', 'afterEnding'),
      flagClear: since('afterEnding', 'afterFlagClear'),
      total: since('start', 'afterFlagClear')
  });
  console.log('[pvf save] writeCalls(staging flushes) =', writeCallsCaptured);
    if (typeof globalThis !== 'undefined') (globalThis as any).__lastPvfSaveProfile = profileMarks;
  } catch { /* ignore logging errors */ }
  return true;
}

export async function readAndDecryptImpl(this: any, f: PvfFile): Promise<Uint8Array> {
  if (f.data) return f.data;
  // read raw encrypted bytes from pvf on disk and decrypt
  const fd = await fs.open(this.pvfPath, 'r');
  try {
    const buf = Buffer.alloc(f.blockLength);
    await fd.read({ buffer: buf, position: this.baseOffset + f.offset });
    const dec = PvfCrypto.decrypt(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), f.blockLength, f.checksum);
    // zero padding
    for (let i = 0; i < f.blockLength - f.dataLen; i++) dec[f.dataLen + i] = 0;
    f.data = dec; // cache
    return dec;
  } finally {
    await fd.close();
  }
}

/*
Checklist:

等效性结论
目前与 pvfUtility 的主要差异
可能出错的场景
如何验证与降低风险
等效性结论（总体）: 核心流程（文件树重建 → 头部写入 → 顺序写数据块/复用旧加密块 → 重命名替换）与 pvfUtility 的行为语义基本等效。未改动的文件：直接复制原加密数据（与 C# 连续流写一致）。已改动的文件：重新计算 checksum 后加密写入，偏移按新长度顺序累计，4字节对齐。整体格式一致性应保持。

主要实现差异（仍然“合理”但与 C# 不完全逐字节一致）:

fastPath：当没有改动文件时，批量 writev 引用 bulkData 切片；C# 是逐块顺序写。结果字节序相同，只是系统调用策略不同。
字符串表 / 文件树构建顺序：若排序规则与你的 C# 实现有细微不同，逻辑仍可被解析（只要内部索引一致），但二进制 diff 不会完全一致。
加密路径：encryptFast 使用 Uint32Array 加速；算法逻辑与原 encrypt 等价（需确保未越界处理尾部 <4 字节部分——如果已保留原逻辑即可）。
进度与日志：新增 profiling/统计，不影响格式。
fastPath 大文件阈值判断：超过阈值会回退普通路径；C# 没有这个分支。
潜在出错场景（建议重点关注）:

误判未改动：某文件内容改了但 checksum 未更新（例如调用链遗漏 writeFileData），导致写出旧加密数据 + 新 metadata 不匹配（读取时解压偏移串位）。
对齐处理错误：改变文件长度后未正确 4 字节填充导致后续偏移错位（确认你当前逻辑仍做 padding）。
多字节路径编码：路径含非 ASCII，字符串表编码/截断不一致（确保一致使用 UTF-8 或与格式规范匹配）。
encryptFast 尾余字节处理：如果文件长度不是 4 的倍数，最后 1–3 字节异或与滚动逻辑需与原版一致（确认已复用旧实现末尾分支）。
bulkData 与修改交织：若修改文件数据后又用 fastPath 仍引用旧 bulkData 切片（需保证修改后 file.changed=true，跳过 fastPath 或重新生成该块）。
超大文件/总大小接近 2GB：整数溢出或 Buffer.allocUnsafe 失败（建议在阈值附近加显式检查）。
写过程中崩溃：临时文件策略存在，但如果 rename 前异常，可能遗留 *.tmp。可加清理。
目录/文件数极端增减：字符串表或节点数组超过某固定上限（若格式有 32-bit 限制，需要边界校验）。
快速自检/回归验证建议:

保存后立即重新用你的 openImpl 打开同一个文件，逐项验证:
文件数一致
每个节点 path、size、checksum 恢复正确
随机抽 100 个文件（含新增/变更/未变/不同扩展名/零字节）解密比对原内存数据
统计重建：遍历文件树按 offset+size 还原数据段末尾，= 实际文件大小（去除 header 区域）→ 一致则偏移链正确
对比改动前后同一未修改文件的加密块：fastPath 情况应是二进制完全相同（可做一次 sha256 校验）
注入边界用例：
size = 0
size = 1,2,3（余字节分支）
size = 4n+1
极大文件（接近最大单文件）
路径含中文、长路径、同前缀路径（/abc 与 /abcd）
如果要再降低风险，可加的轻量增强:

保存后（调试模式）执行 reopen+抽样校验（可 behind flag）
在 fastPath 构建阶段断言 changedFiles == 0
encryptFast 尾部 assert：处理完后写入字节数 == 原 length
写出前预计算 finalSize，与写后 fs.statSync(tmp).size 对比
总体风险等级:

未改动保存：极低
少量改动：低（只要 changed 标记和 padding 正常）
大批量改动 + 混合多编码路径：中（建议跑一次全量 reopen 校验）
*/