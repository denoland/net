// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.
import { deleteCookie, getCookies, setCookie } from "./cookie.ts";
import { assert, assertEquals, assertThrows } from "../testing/asserts.ts";

Deno.test({
  name: "Cookie parser",
  fn(): void {
    let headers = new Headers();
    assertEquals(getCookies(headers), {});
    headers = new Headers();
    headers.set("Cookie", "foo=bar");
    assertEquals(getCookies(headers), { foo: "bar" });

    headers = new Headers();
    headers.set("Cookie", "full=of  ; tasty=chocolate");
    assertEquals(getCookies(headers), { full: "of  ", tasty: "chocolate" });

    headers = new Headers();
    headers.set("Cookie", "igot=99; problems=but...");
    assertEquals(getCookies(headers), { igot: "99", problems: "but..." });

    headers = new Headers();
    headers.set("Cookie", "PREF=al=en-GB&f1=123; wide=1; SID=123");
    assertEquals(getCookies(headers), {
      PREF: "al=en-GB&f1=123",
      wide: "1",
      SID: "123",
    });
  },
});

Deno.test({
  name: "Cookie Name Validation",
  fn(): void {
    const tokens = [
      '"id"',
      "id\t",
      "i\td",
      "i d",
      "i;d",
      "{id}",
      "[id]",
      '"',
      "id\u0091",
    ];
    const headers = new Headers();
    tokens.forEach((name) => {
      assertThrows(
        (): void => {
          setCookie(headers, {
            name,
            value: "Cat",
            httpOnly: true,
            secure: true,
            maxAge: 3,
          });
        },
        Error,
        'Invalid cookie name: "' + name + '".',
      );
    });
  },
});

Deno.test({
  name: "Cookie Value Validation",
  fn(): void {
    const tokens = [
      "1f\tWa",
      "\t",
      "1f Wa",
      "1f;Wa",
      '"1fWa',
      "1f\\Wa",
      '1f"Wa',
      '"',
      "1fWa\u0005",
      "1f\u0091Wa",
    ];
    const headers = new Headers();
    tokens.forEach((value) => {
      assertThrows(
        (): void => {
          setCookie(
            headers,
            {
              name: "Space",
              value,
              httpOnly: true,
              secure: true,
              maxAge: 3,
            },
          );
        },
        Error,
        "RFC2616 cookie 'Space'",
      );
    });
  },
});

Deno.test({
  name: "Cookie Path Validation",
  fn(): void {
    const path = "/;domain=sub.domain.com";
    const headers = new Headers();
    assertThrows(
      (): void => {
        setCookie(headers, {
          name: "Space",
          value: "Cat",
          httpOnly: true,
          secure: true,
          path,
          maxAge: 3,
        });
      },
      Error,
      path + ": Invalid cookie path char ';'",
    );
  },
});

Deno.test({
  name: "Cookie Domain Validation",
  fn(): void {
    const tokens = ["-domain.com", "domain.org.", "domain.org-"];
    const headers = new Headers();
    tokens.forEach((domain) => {
      assertThrows(
        (): void => {
          setCookie(headers, {
            name: "Space",
            value: "Cat",
            httpOnly: true,
            secure: true,
            domain,
            maxAge: 3,
          });
        },
        Error,
        "Invalid first/last char in cookie domain: " + domain,
      );
    });
  },
});

Deno.test({
  name: "Cookie Delete",
  fn(): void {
    let headers = new Headers();
    deleteCookie(headers, "deno");
    assertEquals(
      headers.get("Set-Cookie"),
      "deno=; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      domain: "deno.land",
      path: "/",
    });
    deleteCookie(headers, "Space", { domain: "", path: "" });
    assertEquals(
      headers.get("Set-Cookie"),
      "Space=Cat; Domain=deno.land; Path=/, Space=; Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    );
  },
});

Deno.test({
  name: "Cookie Set",
  fn(): void {
    let headers = new Headers();
    setCookie(headers, { name: "Space", value: "Cat" });
    assertEquals(headers.get("Set-Cookie"), "Space=Cat");

    headers = new Headers();
    setCookie(headers, { name: "Space", value: "Cat", secure: true });
    assertEquals(headers.get("Set-Cookie"), "Space=Cat; Secure");

    headers = new Headers();
    setCookie(headers, { name: "Space", value: "Cat", httpOnly: true });
    assertEquals(headers.get("Set-Cookie"), "Space=Cat; HttpOnly");

    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      httpOnly: true,
      secure: true,
    });
    assertEquals(headers.get("Set-Cookie"), "Space=Cat; Secure; HttpOnly");

    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      httpOnly: true,
      secure: true,
      maxAge: 2,
    });
    assertEquals(
      headers.get("Set-Cookie"),
      "Space=Cat; Secure; HttpOnly; Max-Age=2",
    );

    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      httpOnly: true,
      secure: true,
      maxAge: 0,
    });
    assertEquals(
      headers.get("Set-Cookie"),
      "Space=Cat; Secure; HttpOnly; Max-Age=0",
    );

    let error = false;
    headers = new Headers();
    try {
      setCookie(headers, {
        name: "Space",
        value: "Cat",
        httpOnly: true,
        secure: true,
        maxAge: -1,
      });
    } catch {
      error = true;
    }
    assert(error);

    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      httpOnly: true,
      secure: true,
      maxAge: 2,
      domain: "deno.land",
    });
    assertEquals(
      headers.get("Set-Cookie"),
      "Space=Cat; Secure; HttpOnly; Max-Age=2; Domain=deno.land",
    );

    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      httpOnly: true,
      secure: true,
      maxAge: 2,
      domain: "deno.land",
      sameSite: "Strict",
    });
    assertEquals(
      headers.get("Set-Cookie"),
      "Space=Cat; Secure; HttpOnly; Max-Age=2; Domain=deno.land; " +
        "SameSite=Strict",
    );

    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      httpOnly: true,
      secure: true,
      maxAge: 2,
      domain: "deno.land",
      sameSite: "Lax",
    });
    assertEquals(
      headers.get("Set-Cookie"),
      "Space=Cat; Secure; HttpOnly; Max-Age=2; Domain=deno.land; SameSite=Lax",
    );

    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      httpOnly: true,
      secure: true,
      maxAge: 2,
      domain: "deno.land",
      path: "/",
    });
    assertEquals(
      headers.get("Set-Cookie"),
      "Space=Cat; Secure; HttpOnly; Max-Age=2; Domain=deno.land; Path=/",
    );

    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      httpOnly: true,
      secure: true,
      maxAge: 2,
      domain: "deno.land",
      path: "/",
      unparsed: ["unparsed=keyvalue", "batman=Bruce"],
    });
    assertEquals(
      headers.get("Set-Cookie"),
      "Space=Cat; Secure; HttpOnly; Max-Age=2; Domain=deno.land; Path=/; " +
        "unparsed=keyvalue; batman=Bruce",
    );

    headers = new Headers();
    setCookie(headers, {
      name: "Space",
      value: "Cat",
      httpOnly: true,
      secure: true,
      maxAge: 2,
      domain: "deno.land",
      path: "/",
      expires: new Date(Date.UTC(1983, 0, 7, 15, 32)),
    });
    assertEquals(
      headers.get("Set-Cookie"),
      "Space=Cat; Secure; HttpOnly; Max-Age=2; Domain=deno.land; Path=/; " +
        "Expires=Fri, 07 Jan 1983 15:32:00 GMT",
    );

    headers = new Headers();
    setCookie(headers, { name: "__Secure-Kitty", value: "Meow" });
    assertEquals(headers.get("Set-Cookie"), "__Secure-Kitty=Meow; Secure");

    headers = new Headers();
    setCookie(headers, {
      name: "__Host-Kitty",
      value: "Meow",
      domain: "deno.land",
    });
    assertEquals(
      headers.get("Set-Cookie"),
      "__Host-Kitty=Meow; Secure; Path=/",
    );

    headers = new Headers();
    setCookie(headers, { name: "cookie-1", value: "value-1", secure: true });
    setCookie(headers, { name: "cookie-2", value: "value-2", maxAge: 3600 });
    assertEquals(
      headers.get("Set-Cookie"),
      "cookie-1=value-1; Secure, cookie-2=value-2; Max-Age=3600",
    );

    headers = new Headers();
    setCookie(headers, { name: "", value: "" });
    assertEquals(headers.get("Set-Cookie"), null);
  },
});
