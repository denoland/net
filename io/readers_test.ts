// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { assertEquals } from "../testing/asserts.ts";
import { LimitedReader, MultiReader, StringReader } from "./readers.ts";
import { StringWriter } from "./writers.ts";
import { copyN } from "./ioutil.ts";
import { readAll } from "./buffer.ts";

Deno.test("ioStringReader", async function () {
  const r = new StringReader("abcdef");
  const res0 = await r.read(new Uint8Array(6));
  assertEquals(res0, 6);
  const res1 = await r.read(new Uint8Array(6));
  assertEquals(res1, null);
});

Deno.test("ioStringReader", async function () {
  const decoder = new TextDecoder();
  const r = new StringReader("abcdef");
  const buf = new Uint8Array(3);
  const res1 = await r.read(buf);
  assertEquals(res1, 3);
  assertEquals(decoder.decode(buf), "abc");
  const res2 = await r.read(buf);
  assertEquals(res2, 3);
  assertEquals(decoder.decode(buf), "def");
  const res3 = await r.read(buf);
  assertEquals(res3, null);
  assertEquals(decoder.decode(buf), "def");
});

Deno.test("ioMultiReader", async function () {
  const r = new MultiReader(new StringReader("abc"), new StringReader("def"));
  const w = new StringWriter();
  const n = await copyN(r, w, 4);
  assertEquals(n, 4);
  assertEquals(w.toString(), "abcd");
  await Deno.copy(r, w);
  assertEquals(w.toString(), "abcdef");
});

Deno.test("ioLimitedReader", async function () {
  const decoder = new TextDecoder();
  let sr = new StringReader("abc");
  let r = new LimitedReader(sr, 2);
  let buffer = await readAll(r);
  assertEquals(decoder.decode(buffer), "ab");
  assertEquals(decoder.decode(await readAll(sr)), "c");
  sr = new StringReader("abc");
  r = new LimitedReader(sr, 3);
  buffer = await readAll(r);
  assertEquals(decoder.decode(buffer), "abc");
  assertEquals((await readAll(r)).length, 0);
  sr = new StringReader("abc");
  r = new LimitedReader(sr, 4);
  buffer = await readAll(r);
  assertEquals(decoder.decode(buffer), "abc");
  assertEquals((await readAll(r)).length, 0);
});

Deno.test("ioLimitedReader", async function () {
  const rb = new StringReader("abc");
  const wb = new StringWriter();
  await Deno.copy(new LimitedReader(rb, -1), wb);
  assertEquals(wb.toString(), "");
});
