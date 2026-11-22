// make.fun tiny-stack-vm entry: runs every instance in $MAKEFUN_INPUT_DIR and writes
// stdout.bin + exit.txt per instance into $MAKEFUN_OUTPUT_DIR (ISA v1, see kit's ISA.md).
import { readdirSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';

// Per opcode byte: immediate size (255 = unknown opcode), pops, pushes.
const IMM = new Uint8Array(256).fill(255);
const POP = new Uint8Array(256);
const PSH = new Uint8Array(256);
for (const [b, im, po, pu] of [
  [0x00, 0, 0, 0], [0x01, 1, 0, 1], [0x02, 4, 0, 1], [0x03, 0, 1, 0],
  [0x04, 0, 1, 2], [0x05, 0, 2, 2], [0x06, 0, 2, 3], [0x07, 0, 3, 3],
  [0x10, 0, 2, 1], [0x11, 0, 2, 1], [0x12, 0, 2, 1], [0x13, 0, 2, 1],
  [0x14, 0, 2, 1], [0x15, 0, 2, 1], [0x16, 0, 2, 1], [0x17, 0, 1, 1],
  [0x18, 0, 2, 1], [0x19, 0, 2, 1], [0x1a, 0, 2, 1], [0x1b, 0, 1, 1],
  [0x1c, 0, 2, 1], [0x1d, 0, 2, 1], [0x1e, 0, 2, 1], [0x20, 0, 2, 1],
  [0x21, 0, 2, 1], [0x22, 0, 2, 1], [0x30, 2, 0, 0], [0x31, 2, 1, 0],
  [0x32, 2, 1, 0], [0x33, 2, 0, 0], [0x34, 0, 0, 0], [0x40, 0, 1, 1],
  [0x41, 0, 2, 0], [0x50, 0, 1, 0], [0x51, 0, 1, 0], [0x52, 0, 0, 1],
  [0x53, 0, 1, 0],
]) { IMM[b] = im; POP[b] = po; PSH[b] = pu; }

export const OUT = new Uint8Array(65536);
export let olen = 0;

// Runs one program to completion (exit/trap); output bytes land in OUT[0..olen).
export function run(p: Uint8Array, inp: Uint8Array): number {
  const n = p.length;
  const D = new Int32Array(256), C = new Int32Array(64), M = new Int32Array(256);
  let sp = 0, csp = 0, ip = 0, pc = 0, steps = 0;
  olen = 0;
  for (;;) {
    if (steps === 1000000) return 10;          // step limit
    if (pc < 0 || pc >= n) return 9;           // pc outside program
    const op = p[pc], im = IMM[op];
    if (im > 4) return 5;                      // unknown opcode
    if (pc + im >= n) return 9;                // immediate cut off
    const po = POP[op];
    if (sp < po) return 2;                     // underflow
    if (sp - po + PSH[op] > 256) return 3;     // overflow
    steps++;
    pc += 1 + im;
    switch (op) {
      case 0x00: return 0;                     // HALT
      case 0x01: D[sp++] = p[pc - 1] << 24 >> 24; break;
      case 0x02: D[sp++] = p[pc - 4] | p[pc - 3] << 8 | p[pc - 2] << 16 | p[pc - 1] << 24; break;
      case 0x03: sp--; break;                  // POP
      case 0x04: D[sp] = D[sp - 1]; sp++; break; // DUP
      case 0x05: { const t = D[sp - 1]; D[sp - 1] = D[sp - 2]; D[sp - 2] = t; break; } // SWAP
      case 0x06: D[sp] = D[sp - 2]; sp++; break; // OVER
      case 0x07: { const t = D[sp - 3]; D[sp - 3] = D[sp - 2]; D[sp - 2] = D[sp - 1]; D[sp - 1] = t; break; } // ROT
      case 0x10: D[sp - 2] = D[sp - 2] + D[sp - 1]; sp--; break; // ADD (Int32Array store wraps)
      case 0x11: D[sp - 2] = D[sp - 2] - D[sp - 1]; sp--; break; // SUB
      case 0x12: D[sp - 2] = Math.imul(D[sp - 2], D[sp - 1]); sp--; break; // MUL
      case 0x13: { const b = D[sp - 1], a = D[sp - 2]; if (b === 0) return 4; // DIV (ToInt32 truncates; INT_MIN/-1 wraps to INT_MIN)
        D[sp - 2] = a / b; sp--; break; }
      case 0x14: { const b = D[sp - 1], a = D[sp - 2]; if (b === 0) return 4; // MOD (sign of a; x%-1 -> -0 -> 0)
        D[sp - 2] = a % b; sp--; break; }
      case 0x15: { const b = D[sp - 1], a = D[sp - 2]; if (b === 0) return 4; // DIVU
        D[sp - 2] = Math.floor((a >>> 0) / (b >>> 0)); sp--; break; }
      case 0x16: { const b = D[sp - 1], a = D[sp - 2]; if (b === 0) return 4; // MODU
        D[sp - 2] = (a >>> 0) % (b >>> 0); sp--; break; }
      case 0x17: D[sp - 1] = -D[sp - 1]; break; // NEG
      case 0x18: D[sp - 2] &= D[sp - 1]; sp--; break; // AND
      case 0x19: D[sp - 2] |= D[sp - 1]; sp--; break; // OR
      case 0x1a: D[sp - 2] ^= D[sp - 1]; sp--; break; // XOR
      case 0x1b: D[sp - 1] = ~D[sp - 1]; break; // NOT
      case 0x1c: D[sp - 2] = D[sp - 2] << (D[sp - 1] & 31); sp--; break; // SHL
      case 0x1d: D[sp - 2] = D[sp - 2] >> (D[sp - 1] & 31); sp--; break; // SHR arithmetic
      case 0x1e: D[sp - 2] = D[sp - 2] >>> (D[sp - 1] & 31); sp--; break; // SHRU logical
      case 0x20: D[sp - 2] = D[sp - 2] === D[sp - 1] ? 1 : 0; sp--; break; // EQ
      case 0x21: D[sp - 2] = D[sp - 2] < D[sp - 1] ? 1 : 0; sp--; break; // LT
      case 0x22: D[sp - 2] = (D[sp - 2] >>> 0) < (D[sp - 1] >>> 0) ? 1 : 0; sp--; break; // LTU
      case 0x30: case 0x31: case 0x32: {       // JMP/JZ/JNZ
        let take = true;
        if (op !== 0x30) { const v = D[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc += (p[pc - 2] | p[pc - 1] << 8) << 16 >> 16;
        break; }
      case 0x33:                               // CALL (unsigned 16-bit target)
        if (csp === 64) return 7;
        C[csp++] = pc;
        pc = p[pc - 2] | p[pc - 1] << 8;
        break;
      case 0x34:                               // RET
        if (csp === 0) return 8;
        pc = C[--csp];
        break;
      case 0x40: { const a = D[sp - 1]; if (a < 0 || a > 255) return 6; D[sp - 1] = M[a]; break; } // LOAD
      case 0x41: { const a = D[sp - 1]; if (a < 0 || a > 255) return 6; M[a] = D[sp - 2]; sp -= 2; break; } // STORE
      case 0x50: {                             // PRINT
        const s = String(D[sp - 1]);
        if (olen + s.length > 65536) return 11;
        for (let i = 0; i < s.length; i++) OUT[olen++] = s.charCodeAt(i);
        sp--;
        break; }
      case 0x51:                               // PUTC
        if (olen === 65536) return 11;
        OUT[olen++] = D[--sp] & 255;
        break;
      case 0x52: D[sp++] = ip < inp.length ? inp[ip++] : -1; break; // IN
      case 0x53: return D[--sp] & 255;         // EXIT
    }
  }
}

const SRC = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const DST = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
mkdirSync(DST, { recursive: true });
for (const id of readdirSync(SRC).sort()) {
  const exit = run(readFileSync(`${SRC}/${id}/program.bin`), readFileSync(`${SRC}/${id}/input.bin`));
  mkdirSync(`${DST}/${id}`, { recursive: true });
  writeFileSync(`${DST}/${id}/stdout.bin`, OUT.subarray(0, olen));
  writeFileSync(`${DST}/${id}/exit.txt`, `${exit}\n`);
}
