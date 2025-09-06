import { PvfFile } from './pvfFile';
import { StringTable } from './stringTable';
import { encodingForKey } from './helpers';
import * as iconv from 'iconv-lite';

// File name checksum compatible with pvfUtility DataHelper.GetFileNameHashCode
export function getFileNameHashCode(dataBytes: Uint8Array): number {
  let num = 0x1505 >>> 0;
  for (let i = 0; i < dataBytes.length; i++) {
    num = ((num * 0x21) + dataBytes[i]) >>> 0;
  }
  return (num * 0x21) >>> 0;
}

// Render stringtable.bin to human-readable text given fileList and optional loaded strtable
export function renderStringTableText(fileList: Map<string, PvfFile>, existing?: StringTable): string {
  if (existing) return existing.dumpText();
  const f = fileList.get('stringtable.bin');
  if (!f) return '';
  const bytes = f.data ? f.data.subarray(0, f.dataLen) : new Uint8Array();
  const st = new StringTable(encodingForKey('stringtable.bin'));
  st.load(bytes);
  return st.dumpText();
}
