// Copyright 2018-2021 the Deno authors. All rights reserved. MIT license.

use std::convert::TryInto;

use derive_more::{From, Into};
use wasm_bindgen::prelude::*;

mod digest;

#[wasm_bindgen]
#[derive(Clone, Into, From)]
pub struct DigestContext(digest::DigestContext);

#[wasm_bindgen]
pub fn digest(
  algorithm: String,
  data: js_sys::Uint8Array,
  length: Option<usize>,
) -> Result<Box<[u8]>, JsValue> {
  let mut context = DigestContext::new(&algorithm)?;
  context.update(data)?;
  context.digest_and_drop(length)
}

#[wasm_bindgen]
impl DigestContext {
  /// Creates a new digest context using a supported algorithm name.
  #[wasm_bindgen(constructor)]
  pub fn new(algorithm: &str) -> Result<DigestContext, JsValue> {
    Ok(
      digest::DigestContext::new(algorithm)
        .map_err(|message| JsValue::from(js_sys::TypeError::new(message)))?
        .into(),
    )
  }

  #[wasm_bindgen]
  pub fn update(&mut self, data: js_sys::Uint8Array) -> Result<(), JsValue> {
    // Every method call on `data` has to go through the JavaScript bindings, so
    // try to minimize them.

    let length = data.byte_length();

    let chunk_size: u32 = 65_536;
    let chunk_usize: usize = chunk_size.try_into().unwrap();

    if length <= chunk_size {
      let chunk = data.to_vec();
      self.0.update(&chunk);
    } else {
      for offset in (0u32..length).step_by(chunk_usize) {
        let chunk = data.subarray(offset, offset + chunk_size).to_vec();
        self.0.update(&chunk);
      }
    }

    Ok(())
  }

  #[wasm_bindgen]
  pub fn digest(&self, length: Option<usize>) -> Result<Box<[u8]>, JsValue> {
    self
      .0
      .digest(length)
      .map_err(|message| JsValue::from(js_sys::TypeError::new(message)))
  }

  #[wasm_bindgen]
  pub fn digest_and_reset(
    &mut self,
    length: Option<usize>,
  ) -> Result<Box<[u8]>, JsValue> {
    self
      .0
      .digest_and_reset(length)
      .map_err(|message| JsValue::from(js_sys::TypeError::new(message)))
  }

  // This is not exported because we can't "consume" the `self` object on the
  // JavaScript side, so it leaves a dead object, and maybe a dangling pointer.
  // However, this is used internally by digest_sync().
  pub fn digest_and_drop(
    mut self,
    length: Option<usize>,
  ) -> Result<Box<[u8]>, JsValue> {
    self
      .0
      .digest_and_reset(length)
      .map_err(|message| JsValue::from(js_sys::TypeError::new(message)))
  }

  #[wasm_bindgen]
  pub fn reset(&mut self) -> Result<(), JsValue> {
    self.0.reset();

    Ok(())
  }

  #[wasm_bindgen]
  #[allow(clippy::should_implement_trait)]
  pub fn clone(&self) -> DigestContext {
    Clone::clone(self)
  }
}
