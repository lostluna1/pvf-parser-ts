"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PvfCrypto = void 0;
class PvfCrypto {
    static rotl(x, n) {
        return ((x << n) | (x >>> (32 - n))) >>> 0;
    }
    static rotr(x, n) {
        return ((x >>> n) | (x << (32 - n))) >>> 0;
    }
    static createBuffKey(buf, trueLen, fileNameHash) {
        let num1 = (~fileNameHash) >>> 0;
        let index = 0;
        const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        while (index < trueLen) {
            const b0 = (buf[index] ^ num1) & 0xff;
            let num3 = ((num1 >>> 8) ^ checksumDic[b0]) >>> 0;
            const b1 = ((view.getUint8(index + 1) ^ num3) & 0xff) >>> 0;
            let num5 = ((num3 >>> 8) ^ checksumDic[b1]) >>> 0;
            const b2 = ((view.getUint8(index + 2) ^ num5) & 0xff) >>> 0;
            let num7 = ((num5 >>> 8) ^ checksumDic[b2]) >>> 0;
            const b3 = ((view.getUint8(index + 3) ^ num7) & 0xff) >>> 0;
            num1 = ((num7 >>> 8) ^ checksumDic[b3]) >>> 0;
            index += 4;
        }
        return (~num1) >>> 0;
    }
    static decrypt(source, len, checksum) {
        const key = 2175242257 >>> 0;
        const out = new Uint8Array(len);
        const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
        for (let i = 0; i < len; i += 4) {
            const v = view.getUint32(i, true) ^ key ^ checksum;
            const r = PvfCrypto.rotr(v >>> 0, 6);
            out[i] = r & 0xff;
            out[i + 1] = (r >>> 8) & 0xff;
            out[i + 2] = (r >>> 16) & 0xff;
            out[i + 3] = (r >>> 24) & 0xff;
        }
        return out;
    }
    static encrypt(source, len, checksum) {
        const key = 2175242257 >>> 0;
        const truelen = (len + 3) & -4;
        const out = new Uint8Array(truelen);
        const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
        for (let i = 0; i < truelen; i += 4) {
            const v = PvfCrypto.rotl(view.getUint32(i, true), 6) ^ checksum ^ key;
            out[i] = v & 0xff;
            out[i + 1] = (v >>> 8) & 0xff;
            out[i + 2] = (v >>> 16) & 0xff;
            out[i + 3] = (v >>> 24) & 0xff;
        }
        return out;
    }
}
exports.PvfCrypto = PvfCrypto;
// Build checksumDic like C# static ctor
const checksumDic = (() => {
    const dic = new Uint32Array(256);
    let num1 = 1 >>> 0;
    let num2 = 128 >>> 0;
    while (num2 > 0) {
        const num3 = (num1 & 1) === 0 ? 0 : 3988292384 >>> 0;
        num1 = ((num1 >>> 1) ^ num3) >>> 0;
        let num4 = 0;
        const num5Init = num2 >>> 0;
        const num6 = (num2 * 2) >>> 0;
        let num5 = num5Init;
        do {
            const num7 = (dic[num4] ^ num1) >>> 0;
            dic[num5] = num7 >>> 0;
            const num8 = (num2 * 2) >>> 0;
            num5 = (num5 + num8) >>> 0;
            num4 = (num4 + num6) >>> 0;
        } while (num4 < 256);
        num2 = (num2 / 2) >>> 0;
    }
    return dic;
})();
//# sourceMappingURL=crypto.js.map