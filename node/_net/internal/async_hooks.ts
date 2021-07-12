import {getOptionValue} from "./options";

const async_wrap = internalBinding("async_wrap")
const { async_hook_fields } = async_wrap
const { kDefaultTriggerAsyncId, kAsyncIdCounter, kExecutionAsyncId, kInit, kBefore, kAfter, kDestroy, kPromiseResolve } = async_wrap.constants
const { async_id_fields } = async_wrap
const { resource_symbol } = internalBinding('symbols');
const { ErrorCaptureStackTrace } = primordials


// Increment the internal id counter and return the value. Important that the
// counter increment first. Since it's done the same way in
// Environment::new_async_uid()
export function newAsyncId(): number {
  return ++async_id_fields[kAsyncIdCounter];
}
export function defaultTriggerAsyncIdScope(triggerAsyncId, block, ...args) {
  if (triggerAsyncId === undefined)
    return Reflect.apply(block, null, args);
  // CHECK(NumberIsSafeInteger(triggerAsyncId))
  // CHECK(triggerAsyncId > 0)
  const oldDefaultTriggerAsyncId = async_id_fields[kDefaultTriggerAsyncId];
  async_id_fields[kDefaultTriggerAsyncId] = triggerAsyncId;

  try {
    return Reflect.apply(block, null, args);
  } finally {
    async_id_fields[kDefaultTriggerAsyncId] = oldDefaultTriggerAsyncId;
  }
}

export const { async_id_symbol } = internalBinding('symbols');
export const { trigger_async_id_symbol } = internalBinding("symbols")

const init_symbol = Symbol('init');
const before_symbol = Symbol('before');
const after_symbol = Symbol('after');
const destroy_symbol = Symbol('destroy');
const promise_resolve_symbol = Symbol('promiseResolve');
const { owner_symbol } = internalBinding('symbols');
export { owner_symbol }
export const symbols = {
    async_id_symbol, trigger_async_id_symbol,
    init_symbol, before_symbol, after_symbol, destroy_symbol,
    promise_resolve_symbol, owner_symbol
}

// Return the triggerAsyncId meant for the constructor calling it. It's up to
// the user to safeguard this call and make sure it's zero'd out when the
// constructor is complete.
export function getDefaultTriggerAsyncId() {
  const defaultTriggerAsyncId = async_id_fields[kDefaultTriggerAsyncId];
  // If defaultTriggerAsyncId isn't set, use the executionAsyncId
  if (defaultTriggerAsyncId < 0)
    return async_id_fields[kExecutionAsyncId];
  return defaultTriggerAsyncId;
}

function hasHooks(key) {
  return async_hook_fields[key] > 0;
}

export  function initHooksExist() {
  return hasHooks(kInit);
}

function copyHooks(destination, source) {
  destination[kInit] = source[kInit];
  destination[kBefore] = source[kBefore];
  destination[kAfter] = source[kAfter];
  destination[kDestroy] = source[kDestroy];
  destination[kPromiseResolve] = source[kPromiseResolve];
}

// Then restore the correct hooks array in case any hooks were added/removed
// during hook callback execution.
function restoreActiveHooks() {
  active_hooks.array = active_hooks.tmp_array;
  copyHooks(async_hook_fields, active_hooks.tmp_fields);

  active_hooks.tmp_array = null;
  active_hooks.tmp_fields = null;
}

// Used to fatally abort the process if a callback throws.
function fatalError(e) {
  if (typeof e.stack === 'string') {
    process._rawDebug(e.stack);
  } else {
    const o = { message: e };
    ErrorCaptureStackTrace(o, fatalError);
    process._rawDebug(o.stack);
  }

  if (getOptionValue('--abort-on-uncaught-exception')) {
    process.abort();
  }
  process.exit(1);
}

// Used by C++ to call all init() callbacks. Because some state can be setup
// from C++ there's no need to perform all the same operations as in
// emitInitScript.
function emitInitNative(asyncId, type, triggerAsyncId, resource) {
  active_hooks.call_depth += 1;
  resource = lookupPublicResource(resource);
  // Use a single try/catch for all hooks to avoid setting up one per iteration.
  try {
    // Using var here instead of let because "for (var ...)" is faster than let.
    // Refs: https://github.com/nodejs/node/pull/30380#issuecomment-552948364
    for (var i = 0; i < active_hooks.array.length; i++) {
      if (typeof active_hooks.array[i][init_symbol] === 'function') {
        active_hooks.array[i][init_symbol](
          asyncId, type, triggerAsyncId,
          resource
        );
      }
    }
  } catch (e) {
    fatalError(e);
  } finally {
    active_hooks.call_depth -= 1;
  }

  // Hooks can only be restored if there have been no recursive hook calls.
  // Also the active hooks do not need to be restored if enable()/disable()
  // weren't called during hook execution, in which case active_hooks.tmp_array
  // will be null.
  if (active_hooks.call_depth === 0 && active_hooks.tmp_array !== null) {
    restoreActiveHooks();
  }
}

export function emitInit(asyncId, type, triggerAsyncId, resource) {
  // Short circuit all checks for the common case. Which is that no hooks have
  // been set. Do this to remove performance impact for embedders (and core).
  if (!hasHooks(kInit))
    return;

  if (triggerAsyncId === null) {
    triggerAsyncId = getDefaultTriggerAsyncId();
  }

  emitInitNative(asyncId, type, triggerAsyncId, resource);
}

// Properties in active_hooks are used to keep track of the set of hooks being
// executed in case another hook is enabled/disabled. The new set of hooks is
// then restored once the active set of hooks is finished executing.
const active_hooks = {
  // Array of all AsyncHooks that will be iterated whenever an async event
  // fires. Using var instead of (preferably const) in order to assign
  // active_hooks.tmp_array if a hook is enabled/disabled during hook
  // execution.
  array: [],
  // Use a counter to track nested calls of async hook callbacks and make sure
  // the active_hooks.array isn't altered mid execution.
  call_depth: 0,
  // Use to temporarily store and updated active_hooks.array if the user
  // enables or disables a hook while hooks are being processed. If a hook is
  // enabled() or disabled() during hook execution then the current set of
  // active hooks is duplicated and set equal to active_hooks.tmp_array. Any
  // subsequent changes are on the duplicated array. When all hooks have
  // completed executing active_hooks.tmp_array is assigned to
  // active_hooks.array.
  tmp_array: null,
  // Keep track of the field counts held in active_hooks.tmp_array. Because the
  // async_hook_fields can't be reassigned, store each uint32 in an array that
  // is written back to async_hook_fields when active_hooks.array is restored.
  tmp_fields: null
};

function lookupPublicResource(resource) {
  if (typeof resource !== 'object' || resource === null) return resource;
  // TODO(addaleax): Merge this with owner_symbol and use it across all
  // AsyncWrap instances.
  const publicResource = resource[resource_symbol];
  if (publicResource !== undefined)
    return publicResource;
  return resource;
}
