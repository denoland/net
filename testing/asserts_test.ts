// Copyright 2018-2019 the Deno authors. All rights reserved. MIT license.

import {
  assert,
  assertNotEquals,
  assertStrContains,
  assertArrayContains,
  assertMatch,
  assertEquals,
  assertThrows,
  AssertionError,
  equal,
  fail,
  unimplemented,
  unreachable,
  assertSetEquals,
  assertNotSetEquals
} from "./asserts.ts";
import { test } from "./mod.ts";

test(function testingEqual() {
  assert(equal("world", "world"));
  assert(!equal("hello", "world"));
  assert(equal(5, 5));
  assert(!equal(5, 6));
  assert(equal(NaN, NaN));
  assert(equal({ hello: "world" }, { hello: "world" }));
  assert(!equal({ world: "hello" }, { hello: "world" }));
  assert(
    equal(
      { hello: "world", hi: { there: "everyone" } },
      { hello: "world", hi: { there: "everyone" } }
    )
  );
  assert(
    !equal(
      { hello: "world", hi: { there: "everyone" } },
      { hello: "world", hi: { there: "everyone else" } }
    )
  );
  assert(equal(/deno/, /deno/));
  assert(!equal(/deno/, /node/));
  assert(equal(new Date(2019, 0, 3), new Date(2019, 0, 3)));
  assert(!equal(new Date(2019, 0, 3), new Date(2019, 1, 3)));
});

test(function testingNotEquals() {
  const a = { foo: "bar" };
  const b = { bar: "foo" };
  assertNotEquals(a, b);
  assertNotEquals("Denosaurus", "Tyrannosaurus");
  let didThrow;
  try {
    assertNotEquals("Raptor", "Raptor");
    didThrow = false;
  } catch (e) {
    assert(e instanceof AssertionError);
    didThrow = true;
  }
  assertEquals(didThrow, true);
});

test(function testingAssertStringContains() {
  assertStrContains("Denosaurus", "saur");
  assertStrContains("Denosaurus", "Deno");
  assertStrContains("Denosaurus", "rus");
  let didThrow;
  try {
    assertStrContains("Denosaurus", "Raptor");
    didThrow = false;
  } catch (e) {
    assert(e instanceof AssertionError);
    didThrow = true;
  }
  assertEquals(didThrow, true);
});

test(function testingArrayContains() {
  const fixture = ["deno", "iz", "luv"];
  const fixtureObject = [{ deno: "luv" }, { deno: "Js" }];
  assertArrayContains(fixture, ["deno"]);
  assertArrayContains(fixtureObject, [{ deno: "luv" }]);
  let didThrow;
  try {
    assertArrayContains(fixtureObject, [{ deno: "node" }]);
    didThrow = false;
  } catch (e) {
    assert(e instanceof AssertionError);
    didThrow = true;
  }
  assertEquals(didThrow, true);
});

test(function testingAssertStringContainsThrow() {
  let didThrow = false;
  try {
    assertStrContains("Denosaurus from Jurassic", "Raptor");
  } catch (e) {
    assert(
      e.message ===
        `actual: "Denosaurus from Jurassic" expected to contains: "Raptor"`
    );
    assert(e instanceof AssertionError);
    didThrow = true;
  }
  assert(didThrow);
});

test(function testingAssertStringMatching() {
  assertMatch("foobar@deno.com", RegExp(/[a-zA-Z]+@[a-zA-Z]+.com/));
});

test(function testingAssertStringMatchingThrows() {
  let didThrow = false;
  try {
    assertMatch("Denosaurus from Jurassic", RegExp(/Raptor/));
  } catch (e) {
    assert(
      e.message ===
        `actual: "Denosaurus from Jurassic" expected to match: "/Raptor/"`
    );
    assert(e instanceof AssertionError);
    didThrow = true;
  }
  assert(didThrow);
});

test(function testingAssertsUnimplemented() {
  let didThrow = false;
  try {
    unimplemented();
  } catch (e) {
    assert(e.message === "unimplemented");
    assert(e instanceof AssertionError);
    didThrow = true;
  }
  assert(didThrow);
});

test(function testingAssertsUnreachable() {
  let didThrow = false;
  try {
    unreachable();
  } catch (e) {
    assert(e.message === "unreachable");
    assert(e instanceof AssertionError);
    didThrow = true;
  }
  assert(didThrow);
});

test(function testingAssertFail() {
  assertThrows(fail, AssertionError, "Failed assertion.");
  assertThrows(
    () => {
      fail("foo");
    },
    AssertionError,
    "Failed assertion: foo"
  );
});

test(function testingAssertSetEquals() {
  const setA = new Set([1, 2, 3]);
  const setB = new Set([1]);
  const setC = new Set([3, 2, 1]);
  assertSetEquals(setA, setC);

  assertThrows(
    () => assertSetEquals(setA, setB),
    AssertionError,
    "Expected set to equal"
  );

  assertThrows(
    () => assertSetEquals(setA, setB, "test"),
    AssertionError,
    "test"
  );
});

test(function testingAssertNotSetEquals() {
  const setA = new Set([1, 2, 3]);
  const setB = new Set([1]);
  const setC = new Set([3, 2, 1]);
  assertNotSetEquals(setA, setB);

  assertThrows(
    () => assertNotSetEquals(setA, setC),
    AssertionError,
    "Expected set not to equal"
  );

  assertThrows(
    () => assertNotSetEquals(setA, setC, "test"),
    AssertionError,
    "test"
  );
});
