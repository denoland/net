// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
// Based on https://github.com/golang/go/blob/891682/src/bytes/buffer_test.go
// and https://github.com/golang/go/blob/891682/src/bufio/bufio_test.go.
// Copyright 2009 The Go Authors. All rights reserved.
// Use of this source code is governed by a BSD-style
// license that can be found in the LICENSE file.
import {
  assert,
  assertEquals,
  assertThrows,
  assertThrowsAsync,
  fail,
} from "../testing/asserts.ts";
import {
  Buffer,
  BufferFullError,
  BufReader,
  BufWriter,
  BufWriterSync,
  PartialReadError,
  readAll,
  readAllSync,
  ReadLineResult,
  readLines,
  readStringDelim,
  writeAll,
  writeAllSync,
} from "./buffer.ts";
import * as iotest from "./_iotest.ts";
import { StringReader } from "./readers.ts";
import { StringWriter } from "./writers.ts";
import { copy } from "../bytes/mod.ts";

const MAX_SIZE = 2 ** 32 - 2;
// N controls how many iterations of certain checks are performed.
const N = 100;
let testBytes: Uint8Array | null;
let testString: string | null;

const ignoreMaxSizeTests = true;

function init(): void {
  if (testBytes == null) {
    testBytes = new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      testBytes[i] = "a".charCodeAt(0) + (i % 26);
    }
    const decoder = new TextDecoder();
    testString = decoder.decode(testBytes);
  }
}

function check(buf: Buffer, s: string): void {
  const bytes = buf.bytes();
  assertEquals(buf.length, bytes.byteLength);
  const decoder = new TextDecoder();
  const bytesStr = decoder.decode(bytes);
  assertEquals(bytesStr, s);
  assertEquals(buf.length, s.length);
}

// Fill buf through n writes of byte slice fub.
// The initial contents of buf corresponds to the string s;
// the result is the final contents of buf returned as a string.
async function fillBytes(
  buf: Buffer,
  s: string,
  n: number,
  fub: Uint8Array,
): Promise<string> {
  check(buf, s);
  for (; n > 0; n--) {
    const m = await buf.write(fub);
    assertEquals(m, fub.byteLength);
    const decoder = new TextDecoder();
    s += decoder.decode(fub);
    check(buf, s);
  }
  return s;
}

// Empty buf through repeated reads into fub.
// The initial contents of buf corresponds to the string s.
async function empty(
  buf: Buffer,
  s: string,
  fub: Uint8Array,
) {
  check(buf, s);
  while (true) {
    const r = await buf.read(fub);
    if (r === null) {
      break;
    }
    s = s.slice(r);
    check(buf, s);
  }
  check(buf, "");
}

function repeat(c: string, bytes: number): Uint8Array {
  assertEquals(c.length, 1);
  const ui8 = new Uint8Array(bytes);
  ui8.fill(c.charCodeAt(0));
  return ui8;
}

Deno.test("bufferNewBuffer", () => {
  init();
  assert(testBytes);
  assert(testString);
  const buf = new Buffer(testBytes.buffer as ArrayBuffer);
  check(buf, testString);
});

Deno.test("bufferBasicOperations", async () => {
  assert(testBytes);
  assert(testString);
  const buf = new Buffer();
  for (let i = 0; i < 5; i++) {
    check(buf, "");

    buf.reset();
    check(buf, "");

    buf.truncate(0);
    check(buf, "");

    let n = await buf.write(testBytes.subarray(0, 1));
    assertEquals(n, 1);
    check(buf, "a");

    n = await buf.write(testBytes.subarray(1, 2));
    assertEquals(n, 1);
    check(buf, "ab");

    n = await buf.write(testBytes.subarray(2, 26));
    assertEquals(n, 24);
    check(buf, testString.slice(0, 26));

    buf.truncate(26);
    check(buf, testString.slice(0, 26));

    buf.truncate(20);
    check(buf, testString.slice(0, 20));

    await empty(buf, testString.slice(0, 20), new Uint8Array(5));
    await empty(buf, "", new Uint8Array(100));

    // TODO(bartlomieju): buf.writeByte()
    // TODO(bartlomieju): buf.readByte()
  }
});

Deno.test("bufferReadEmptyAtEOF", async () => {
  // check that EOF of 'buf' is not reached (even though it's empty) if
  // results are written to buffer that has 0 length (ie. it can't store any data)
  const buf = new Buffer();
  const zeroLengthTmp = new Uint8Array(0);
  const result = await buf.read(zeroLengthTmp);
  assertEquals(result, 0);
});

Deno.test("bufferLargeByteWrites", async () => {
  init();
  const buf = new Buffer();
  const limit = 9;
  for (let i = 3; i < limit; i += 3) {
    const s = await fillBytes(buf, "", 5, testBytes!);
    await empty(buf, s, new Uint8Array(Math.floor(testString!.length / i)));
  }
  check(buf, "");
});

Deno.test("bufferTooLargeByteWrites", async () => {
  init();
  const tmp = new Uint8Array(72);
  const growLen = Number.MAX_VALUE;
  const xBytes = repeat("x", 0);
  const buf = new Buffer(xBytes.buffer as ArrayBuffer);
  await buf.read(tmp);

  assertThrows(
    () => {
      buf.grow(growLen);
    },
    Error,
    "grown beyond the maximum size",
  );
});

Deno.test({
  name: "bufferGrowWriteMaxBuffer",
  ignore: ignoreMaxSizeTests,
  fn() {
    const bufSize = 16 * 1024;
    const capacities = [MAX_SIZE, MAX_SIZE - 1];
    for (const capacity of capacities) {
      let written = 0;
      const buf = new Buffer();
      const writes = Math.floor(capacity / bufSize);
      for (let i = 0; i < writes; i++) {
        written += buf.writeSync(repeat("x", bufSize));
      }

      if (written < capacity) {
        written += buf.writeSync(repeat("x", capacity - written));
      }

      assertEquals(written, capacity);
    }
  },
});

Deno.test({
  name: "bufferGrowReadCloseMaxBufferPlus1",
  ignore: ignoreMaxSizeTests,
  async fn() {
    const reader = new Buffer(new ArrayBuffer(MAX_SIZE + 1));
    const buf = new Buffer();

    await assertThrowsAsync(
      async () => {
        await buf.readFrom(reader);
      },
      Error,
      "grown beyond the maximum size",
    );
  },
});

Deno.test({
  name: "bufferGrowReadSyncCloseMaxBufferPlus1",
  ignore: ignoreMaxSizeTests,
  fn() {
    const reader = new Buffer(new ArrayBuffer(MAX_SIZE + 1));
    const buf = new Buffer();

    assertThrows(
      () => {
        buf.readFromSync(reader);
      },
      Error,
      "grown beyond the maximum size",
    );
  },
});

Deno.test({
  name: "bufferGrowReadSyncCloseToMaxBuffer",
  ignore: ignoreMaxSizeTests,
  fn() {
    const capacities = [MAX_SIZE, MAX_SIZE - 1];
    for (const capacity of capacities) {
      const reader = new Buffer(new ArrayBuffer(capacity));
      const buf = new Buffer();
      buf.readFromSync(reader);

      assertEquals(buf.length, capacity);
    }
  },
});

Deno.test({
  name: "bufferGrowReadCloseToMaxBuffer",
  ignore: ignoreMaxSizeTests,
  async fn() {
    const capacities = [MAX_SIZE, MAX_SIZE - 1];
    for (const capacity of capacities) {
      const reader = new Buffer(new ArrayBuffer(capacity));
      const buf = new Buffer();
      await buf.readFrom(reader);
      assertEquals(buf.length, capacity);
    }
  },
});

Deno.test({
  name: "bufferReadCloseToMaxBufferWithInitialGrow",
  ignore: ignoreMaxSizeTests,
  async fn() {
    const capacities = [MAX_SIZE, MAX_SIZE - 1, MAX_SIZE - 512];
    for (const capacity of capacities) {
      const reader = new Buffer(new ArrayBuffer(capacity));
      const buf = new Buffer();
      buf.grow(MAX_SIZE);
      await buf.readFrom(reader);
      assertEquals(buf.length, capacity);
    }
  },
});

Deno.test("bufferLargeByteReads", async () => {
  init();
  assert(testBytes);
  assert(testString);
  const buf = new Buffer();
  for (let i = 3; i < 30; i += 3) {
    const n = Math.floor(testBytes.byteLength / i);
    const s = await fillBytes(buf, "", 5, testBytes.subarray(0, n));
    await empty(buf, s, new Uint8Array(testString.length));
  }
  check(buf, "");
});

Deno.test("bufferCapWithPreallocatedSlice", () => {
  const buf = new Buffer(new ArrayBuffer(10));
  assertEquals(buf.capacity, 10);
});

Deno.test("bufferReadFrom", async () => {
  init();
  assert(testBytes);
  assert(testString);
  const buf = new Buffer();
  for (let i = 3; i < 30; i += 3) {
    const s = await fillBytes(
      buf,
      "",
      5,
      testBytes.subarray(0, Math.floor(testBytes.byteLength / i)),
    );
    const b = new Buffer();
    await b.readFrom(buf);
    const fub = new Uint8Array(testString.length);
    await empty(b, s, fub);
  }
  assertThrowsAsync(async function () {
    await new Buffer().readFrom(null!);
  });
});

Deno.test("bufferReadFromSync", async () => {
  init();
  assert(testBytes);
  assert(testString);
  const buf = new Buffer();
  for (let i = 3; i < 30; i += 3) {
    const s = await fillBytes(
      buf,
      "",
      5,
      testBytes.subarray(0, Math.floor(testBytes.byteLength / i)),
    );
    const b = new Buffer();
    b.readFromSync(buf);
    const fub = new Uint8Array(testString.length);
    await empty(b, s, fub);
  }
  assertThrows(function () {
    new Buffer().readFromSync(null!);
  });
});

Deno.test("bufferTestGrow", async () => {
  const tmp = new Uint8Array(72);
  for (const startLen of [0, 100, 1000, 10000]) {
    const xBytes = repeat("x", startLen);
    for (const growLen of [0, 100, 1000, 10000]) {
      const buf = new Buffer(xBytes.buffer as ArrayBuffer);
      // If we read, this affects buf.off, which is good to test.
      const nread = (await buf.read(tmp)) ?? 0;
      buf.grow(growLen);
      const yBytes = repeat("y", growLen);
      await buf.write(yBytes);
      // Check that buffer has correct data.
      assertEquals(
        buf.bytes().subarray(0, startLen - nread),
        xBytes.subarray(nread),
      );
      assertEquals(
        buf.bytes().subarray(startLen - nread, startLen - nread + growLen),
        yBytes,
      );
    }
  }
});

Deno.test("testBufferBytesArrayBufferLength", () => {
  // defaults to copy
  const args = [undefined, { copy: true }] as const;
  for (const arg of args) {
    const bufSize = 64 * 1024;
    const bytes = new TextEncoder().encode("a".repeat(bufSize));
    const reader = new Buffer();
    writeAllSync(reader, bytes);

    const writer = new Buffer();
    writer.readFromSync(reader);
    const actualBytes = writer.bytes(arg);

    assertEquals(actualBytes.byteLength, bufSize);
    assert(actualBytes.buffer !== writer.bytes(arg).buffer);
    assertEquals(actualBytes.byteLength, actualBytes.buffer.byteLength);
  }
});

Deno.test("testBufferBytesCopyFalse", () => {
  const bufSize = 64 * 1024;
  const bytes = new TextEncoder().encode("a".repeat(bufSize));
  const reader = new Buffer();
  writeAllSync(reader, bytes);

  const writer = new Buffer();
  writer.readFromSync(reader);
  const actualBytes = writer.bytes({ copy: false });

  assertEquals(actualBytes.byteLength, bufSize);
  assertEquals(actualBytes.buffer, writer.bytes({ copy: false }).buffer);
  assert(actualBytes.buffer.byteLength > actualBytes.byteLength);
});

Deno.test("testBufferBytesCopyFalseGrowExactBytes", () => {
  const bufSize = 64 * 1024;
  const bytes = new TextEncoder().encode("a".repeat(bufSize));
  const reader = new Buffer();
  writeAllSync(reader, bytes);

  const writer = new Buffer();
  writer.grow(bufSize);
  writer.readFromSync(reader);
  const actualBytes = writer.bytes({ copy: false });

  assertEquals(actualBytes.byteLength, bufSize);
  assertEquals(actualBytes.buffer.byteLength, actualBytes.byteLength);
});

const encoder = new TextEncoder();

async function readBytes(buf: BufReader): Promise<string> {
  const b = new Uint8Array(1000);
  let nb = 0;
  while (true) {
    const c = await buf.readByte();
    if (c === null) {
      break; // EOF
    }
    b[nb] = c;
    nb++;
  }
  const decoder = new TextDecoder();
  return decoder.decode(b.subarray(0, nb));
}

Deno.test("bufioReaderSimple", async function () {
  const data = "hello world";
  const b = new BufReader(new StringReader(data));
  const s = await readBytes(b);
  assertEquals(s, data);
});

interface ReadMaker {
  name: string;
  fn: (r: Deno.Reader) => Deno.Reader;
}

const readMakers: ReadMaker[] = [
  { name: "full", fn: (r): Deno.Reader => r },
  {
    name: "byte",
    fn: (r): iotest.OneByteReader => new iotest.OneByteReader(r),
  },
  { name: "half", fn: (r): iotest.HalfReader => new iotest.HalfReader(r) },
  // TODO(bartlomieju): { name: "data+err", r => new iotest.DataErrReader(r) },
  // { name: "timeout", fn: r => new iotest.TimeoutReader(r) },
];

// Call read to accumulate the text of a file
async function reads(buf: BufReader, m: number): Promise<string> {
  const b = new Uint8Array(1000);
  let nb = 0;
  while (true) {
    const result = await buf.read(b.subarray(nb, nb + m));
    if (result === null) {
      break;
    }
    nb += result;
  }
  const decoder = new TextDecoder();
  return decoder.decode(b.subarray(0, nb));
}

interface NamedBufReader {
  name: string;
  fn: (r: BufReader) => Promise<string>;
}

const bufreaders: NamedBufReader[] = [
  { name: "1", fn: (b: BufReader): Promise<string> => reads(b, 1) },
  { name: "2", fn: (b: BufReader): Promise<string> => reads(b, 2) },
  { name: "3", fn: (b: BufReader): Promise<string> => reads(b, 3) },
  { name: "4", fn: (b: BufReader): Promise<string> => reads(b, 4) },
  { name: "5", fn: (b: BufReader): Promise<string> => reads(b, 5) },
  { name: "7", fn: (b: BufReader): Promise<string> => reads(b, 7) },
  { name: "bytes", fn: readBytes },
  // { name: "lines", fn: readLines },
];

const MIN_READ_BUFFER_SIZE = 16;
const bufsizes: number[] = [
  0,
  MIN_READ_BUFFER_SIZE,
  23,
  32,
  46,
  64,
  93,
  128,
  1024,
  4096,
];

Deno.test("bufioBufReader", async function () {
  const texts = new Array<string>(31);
  let str = "";
  let all = "";
  for (let i = 0; i < texts.length - 1; i++) {
    texts[i] = str + "\n";
    all += texts[i];
    str += String.fromCharCode((i % 26) + 97);
  }
  texts[texts.length - 1] = all;

  for (const text of texts) {
    for (const readmaker of readMakers) {
      for (const bufreader of bufreaders) {
        for (const bufsize of bufsizes) {
          const read = readmaker.fn(new StringReader(text));
          const buf = new BufReader(read, bufsize);
          const s = await bufreader.fn(buf);
          const debugStr = `reader=${readmaker.name} ` +
            `fn=${bufreader.name} bufsize=${bufsize} want=${text} got=${s}`;
          assertEquals(s, text, debugStr);
        }
      }
    }
  }
});

Deno.test("bufioBufferFull", async function () {
  const longString =
    "And now, hello, world! It is the time for all good men to come to the" +
    " aid of their party";
  const buf = new BufReader(new StringReader(longString), MIN_READ_BUFFER_SIZE);
  const decoder = new TextDecoder();

  try {
    await buf.readSlice("!".charCodeAt(0));
    fail("readSlice should throw");
  } catch (err) {
    assert(err instanceof BufferFullError);
    assert(err.partial instanceof Uint8Array);
    assertEquals(decoder.decode(err.partial), "And now, hello, ");
  }

  const line = await buf.readSlice("!".charCodeAt(0));
  assert(line !== null);
  const actual = decoder.decode(line);
  assertEquals(actual, "world!");
});

Deno.test("bufioReadString", async function () {
  const string = "And now, hello world!";
  const buf = new BufReader(new StringReader(string), MIN_READ_BUFFER_SIZE);

  const line = await buf.readString(",");
  assert(line !== null);
  assertEquals(line, "And now,");
  assertEquals(line.length, 8);

  const line2 = await buf.readString(",");
  assert(line2 !== null);
  assertEquals(line2, " hello world!");

  assertEquals(await buf.readString(","), null);

  try {
    await buf.readString("deno");

    fail("should throw");
  } catch (err) {
    assert(err.message, "Delimiter should be a single character");
  }
});

const testInput = encoder.encode(
  "012\n345\n678\n9ab\ncde\nfgh\nijk\nlmn\nopq\nrst\nuvw\nxy",
);
const testInputrn = encoder.encode(
  "012\r\n345\r\n678\r\n9ab\r\ncde\r\nfgh\r\nijk\r\nlmn\r\nopq\r\nrst\r\n" +
    "uvw\r\nxy\r\n\n\r\n",
);
const testOutput = encoder.encode("0123456789abcdefghijklmnopqrstuvwxy");

// TestReader wraps a Uint8Array and returns reads of a specific length.
class TestReader implements Deno.Reader {
  constructor(private data: Uint8Array, private stride: number) {}

  read(buf: Uint8Array): Promise<number | null> {
    let nread = this.stride;
    if (nread > this.data.byteLength) {
      nread = this.data.byteLength;
    }
    if (nread > buf.byteLength) {
      nread = buf.byteLength;
    }
    if (nread === 0) {
      return Promise.resolve(null);
    }
    copy(this.data, buf as Uint8Array);
    this.data = this.data.subarray(nread);
    return Promise.resolve(nread);
  }
}

async function testReadLine(input: Uint8Array) {
  for (let stride = 1; stride < 2; stride++) {
    let done = 0;
    const reader = new TestReader(input, stride);
    const l = new BufReader(reader, input.byteLength + 1);
    while (true) {
      const r = await l.readLine();
      if (r === null) {
        break;
      }
      const { line, more } = r;
      assertEquals(more, false);
      // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
      const want = testOutput.subarray(done, done + line.byteLength);
      assertEquals(
        line,
        want,
        `Bad line at stride ${stride}: want: ${want} got: ${line}`,
      );
      done += line.byteLength;
    }
    assertEquals(
      done,
      testOutput.byteLength,
      `readLine didn't return everything: got: ${done}, ` +
        `want: ${testOutput} (stride: ${stride})`,
    );
  }
}

Deno.test("bufioReadLine", async function () {
  await testReadLine(testInput);
  await testReadLine(testInputrn);
});

Deno.test("bufioPeek", async function () {
  const decoder = new TextDecoder();
  const p = new Uint8Array(10);
  // string is 16 (minReadBufferSize) long.
  const buf = new BufReader(
    new StringReader("abcdefghijklmnop"),
    MIN_READ_BUFFER_SIZE,
  );

  let actual = await buf.peek(1);
  assert(actual !== null);
  assertEquals(decoder.decode(actual), "a");

  actual = await buf.peek(4);
  assert(actual !== null);
  assertEquals(decoder.decode(actual), "abcd");

  try {
    await buf.peek(32);
    fail("peek() should throw");
  } catch (err) {
    assert(err instanceof BufferFullError);
    assert(err.partial instanceof Uint8Array);
    assertEquals(decoder.decode(err.partial), "abcdefghijklmnop");
  }

  await buf.read(p.subarray(0, 3));
  assertEquals(decoder.decode(p.subarray(0, 3)), "abc");

  actual = await buf.peek(1);
  assert(actual !== null);
  assertEquals(decoder.decode(actual), "d");

  actual = await buf.peek(1);
  assert(actual !== null);
  assertEquals(decoder.decode(actual), "d");

  actual = await buf.peek(1);
  assert(actual !== null);
  assertEquals(decoder.decode(actual), "d");

  actual = await buf.peek(2);
  assert(actual !== null);
  assertEquals(decoder.decode(actual), "de");

  const res = await buf.read(p.subarray(0, 3));
  assertEquals(decoder.decode(p.subarray(0, 3)), "def");
  assert(res !== null);

  actual = await buf.peek(4);
  assert(actual !== null);
  assertEquals(decoder.decode(actual), "ghij");

  await buf.read(p);
  assertEquals(decoder.decode(p), "ghijklmnop");

  actual = await buf.peek(0);
  assert(actual !== null);
  assertEquals(decoder.decode(actual), "");

  const r = await buf.peek(1);
  assert(r === null);
  /* TODO
  Test for issue 3022, not exposing a reader's error on a successful Peek.
  buf = NewReaderSize(dataAndEOFReader("abcd"), 32)
  if s, err := buf.Peek(2); string(s) != "ab" || err != nil {
    t.Errorf(`Peek(2) on "abcd", EOF = %q, %v; want "ab", nil`, string(s), err)
  }
  if s, err := buf.Peek(4); string(s) != "abcd" || err != nil {
    t.Errorf(
      `Peek(4) on "abcd", EOF = %q, %v; want "abcd", nil`,
      string(s),
      err
    )
  }
  if n, err := buf.Read(p[0:5]); string(p[0:n]) != "abcd" || err != nil {
    t.Fatalf("Read after peek = %q, %v; want abcd, EOF", p[0:n], err)
  }
  if n, err := buf.Read(p[0:1]); string(p[0:n]) != "" || err != io.EOF {
    t.Fatalf(`second Read after peek = %q, %v; want "", EOF`, p[0:n], err)
  }
  */
});

Deno.test("bufioWriter", async function () {
  const data = new Uint8Array(8192);

  for (let i = 0; i < data.byteLength; i++) {
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    data[i] = " ".charCodeAt(0) + (i % ("~".charCodeAt(0) - " ".charCodeAt(0)));
  }

  const w = new Buffer();
  for (const nwrite of bufsizes) {
    for (const bs of bufsizes) {
      // Write nwrite bytes using buffer size bs.
      // Check that the right amount makes it out
      // and that the data is correct.

      w.reset();
      const buf = new BufWriter(w, bs);

      const context = `nwrite=${nwrite} bufsize=${bs}`;
      const n = await buf.write(data.subarray(0, nwrite));
      assertEquals(n, nwrite, context);

      await buf.flush();

      const written = w.bytes();
      assertEquals(written.byteLength, nwrite);

      for (let l = 0; l < written.byteLength; l++) {
        assertEquals(written[l], data[l]);
      }
    }
  }
});

Deno.test("bufioWriterSync", function (): void {
  const data = new Uint8Array(8192);

  for (let i = 0; i < data.byteLength; i++) {
    // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
    data[i] = " ".charCodeAt(0) + (i % ("~".charCodeAt(0) - " ".charCodeAt(0)));
  }

  const w = new Buffer();
  for (const nwrite of bufsizes) {
    for (const bs of bufsizes) {
      // Write nwrite bytes using buffer size bs.
      // Check that the right amount makes it out
      // and that the data is correct.

      w.reset();
      const buf = new BufWriterSync(w, bs);

      const context = `nwrite=${nwrite} bufsize=${bs}`;
      const n = buf.writeSync(data.subarray(0, nwrite));
      assertEquals(n, nwrite, context);

      buf.flush();

      const written = w.bytes();
      assertEquals(written.byteLength, nwrite);

      for (let l = 0; l < written.byteLength; l++) {
        assertEquals(written[l], data[l]);
      }
    }
  }
});

Deno.test("bufReaderReadFull", async function () {
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const text = "Hello World";
  const data = new Buffer(enc.encode(text));
  const bufr = new BufReader(data, 3);
  {
    const buf = new Uint8Array(6);
    const r = await bufr.readFull(buf);
    assert(r !== null);
    assertEquals(r, buf);
    assertEquals(dec.decode(buf), "Hello ");
  }
  {
    const buf = new Uint8Array(6);
    try {
      await bufr.readFull(buf);
      fail("readFull() should throw PartialReadError");
    } catch (err) {
      assert(err instanceof PartialReadError);
      assert(err.partial instanceof Uint8Array);
      assertEquals(err.partial.length, 5);
      assertEquals(dec.decode(buf.subarray(0, 5)), "World");
    }
  }
});

Deno.test("readStringDelimAndLines", async function () {
  const enc = new TextEncoder();
  const data = new Buffer(
    enc.encode("Hello World\tHello World 2\tHello World 3"),
  );
  const chunks_ = [];

  for await (const c of readStringDelim(data, "\t")) {
    chunks_.push(c);
  }

  assertEquals(chunks_.length, 3);
  assertEquals(chunks_, ["Hello World", "Hello World 2", "Hello World 3"]);

  const linesData = new Buffer(enc.encode("0\n1\n2\n3\n4\n5\n6\n7\n8\n9"));
  // consider data with windows newlines too
  const linesDataWindows = new Buffer(
    enc.encode("0\r\n1\r\n2\r\n3\r\n4\r\n5\r\n6\r\n7\r\n8\r\n9"),
  );
  const lines_ = [];

  for await (const l of readLines(linesData)) {
    lines_.push(l);
  }

  assertEquals(lines_.length, 10);
  assertEquals(lines_, ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

  // Now test for "windows" lines
  lines_.length = 0;
  for await (const l of readLines(linesDataWindows)) {
    lines_.push(l);
  }
  assertEquals(lines_.length, 10);
  assertEquals(lines_, ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
});

Deno.test(
  "bufReaderShouldNotShareArrayBufferAcrossReads",
  async function () {
    const decoder = new TextDecoder();
    const data = "abcdefghijklmnopqrstuvwxyz";
    const bufSize = 25;
    const b = new BufReader(new StringReader(data), bufSize);

    const r1 = (await b.readLine()) as ReadLineResult;
    assert(r1 !== null);
    assertEquals(decoder.decode(r1.line), "abcdefghijklmnopqrstuvwxy");

    const r2 = (await b.readLine()) as ReadLineResult;
    assert(r2 !== null);
    assertEquals(decoder.decode(r2.line), "z");
    assert(
      r1.line.buffer !== r2.line.buffer,
      "array buffer should not be shared across reads",
    );
  },
);

Deno.test({
  name: "Reset buffer after flush",
  async fn() {
    const stringWriter = new StringWriter();
    const bufWriter = new BufWriter(stringWriter);
    const encoder = new TextEncoder();
    await bufWriter.write(encoder.encode("hello\nworld\nhow\nare\nyou?\n\n"));
    await bufWriter.flush();
    await bufWriter.write(encoder.encode("foobar\n\n"));
    await bufWriter.flush();
    const actual = stringWriter.toString();
    assertEquals(actual, "hello\nworld\nhow\nare\nyou?\n\nfoobar\n\n");
  },
});

Deno.test({
  name: "Reset buffer after flush sync",
  fn(): void {
    const stringWriter = new StringWriter();
    const bufWriter = new BufWriterSync(stringWriter);
    const encoder = new TextEncoder();
    bufWriter.writeSync(encoder.encode("hello\nworld\nhow\nare\nyou?\n\n"));
    bufWriter.flush();
    bufWriter.writeSync(encoder.encode("foobar\n\n"));
    bufWriter.flush();
    const actual = stringWriter.toString();
    assertEquals(actual, "hello\nworld\nhow\nare\nyou?\n\nfoobar\n\n");
  },
});

Deno.test({
  name: "BufWriter.flush should write all bytes",
  async fn() {
    const bufSize = 16 * 1024;
    const data = new Uint8Array(bufSize);
    data.fill("a".charCodeAt(0));

    const cache: Uint8Array[] = [];
    const writer: Deno.Writer = {
      write(p: Uint8Array): Promise<number> {
        cache.push(p.subarray(0, 1));

        // Writer that only writes 1 byte at a time
        return Promise.resolve(1);
      },
    };

    const bufWriter = new BufWriter(writer);
    await bufWriter.write(data);

    await bufWriter.flush();
    const buf = new Uint8Array(cache.length);
    for (let i = 0; i < cache.length; i++) buf.set(cache[i], i);

    assertEquals(data, buf);
  },
});

Deno.test({
  name: "BufWriterSync.flush should write all bytes",
  fn(): void {
    const bufSize = 16 * 1024;
    const data = new Uint8Array(bufSize);
    data.fill("a".charCodeAt(0));

    const cache: Uint8Array[] = [];
    const writer: Deno.WriterSync = {
      writeSync(p: Uint8Array): number {
        cache.push(p.subarray(0, 1));
        // Writer that only writes 1 byte at a time
        return 1;
      },
    };

    const bufWriter = new BufWriterSync(writer);
    bufWriter.writeSync(data);

    bufWriter.flush();
    const buf = new Uint8Array(cache.length);
    for (let i = 0; i < cache.length; i++) buf.set(cache[i], i);

    assertEquals(data, buf);
  },
});

Deno.test("testReadAll", async () => {
  init();
  assert(testBytes);
  const reader = new Buffer(testBytes.buffer as ArrayBuffer);
  const actualBytes = await readAll(reader);
  assertEquals(testBytes.byteLength, actualBytes.byteLength);
  for (let i = 0; i < testBytes.length; ++i) {
    assertEquals(testBytes[i], actualBytes[i]);
  }
});

Deno.test("testReadAllSync", () => {
  init();
  assert(testBytes);
  const reader = new Buffer(testBytes.buffer as ArrayBuffer);
  const actualBytes = readAllSync(reader);
  assertEquals(testBytes.byteLength, actualBytes.byteLength);
  for (let i = 0; i < testBytes.length; ++i) {
    assertEquals(testBytes[i], actualBytes[i]);
  }
});

Deno.test("testwriteAll", async () => {
  init();
  assert(testBytes);
  const writer = new Buffer();
  await writeAll(writer, testBytes);
  const actualBytes = writer.bytes();
  assertEquals(testBytes.byteLength, actualBytes.byteLength);
  for (let i = 0; i < testBytes.length; ++i) {
    assertEquals(testBytes[i], actualBytes[i]);
  }
});

Deno.test("testWriteAllSync", () => {
  init();
  assert(testBytes);
  const writer = new Buffer();
  writeAllSync(writer, testBytes);
  const actualBytes = writer.bytes();
  assertEquals(testBytes.byteLength, actualBytes.byteLength);
  for (let i = 0; i < testBytes.length; ++i) {
    assertEquals(testBytes[i], actualBytes[i]);
  }
});
