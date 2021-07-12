// Type checking used by timers.enroll() and Socket#setTimeout()

import {emitInit, getDefaultTriggerAsyncId, initHooksExist, newAsyncId, trigger_async_id_symbol} from "./async_hooks";

export function getTimerDuration(msecs: number, name: string): number {
  if (msecs < 0 || !isFinite(msecs)) {
    throw new RangeError(`${name} is a non-negative finite number: ${msecs}`);
  }

  // Ensure that msecs fits into signed int32
  if (msecs > TIMEOUT_MAX) {
    process.emitWarning(`${msecs} does not fit into a 32-bit signed integer.` +
      `\nTimer duration was truncated to ${TIMEOUT_MAX}.`,
      'TimeoutOverflowWarning');
    return TIMEOUT_MAX;
  }

  return msecs;
}

export const kTimeout = Symbol('timeout')

const { getLibuvNow, scheduleTimer, toggleTimerRef } = internalBinding("timers")
const { MathTrunc } = primordials

const timerListMap = Object.create(null);

let timerListId = Number.MAX_SAFE_INTEGER;

function TimersList(expiry, msecs: number) {
  this._idleNext = this; // Create the list with the linkedlist properties to
  this._idlePrev = this; // Prevent any unnecessary hidden class changes.
  this.expiry = expiry;
  this.id = timerListId++;
  this.msecs = msecs;
  this.priorityQueuePosition = null;
}

function setPosition(node, pos) {
  node.priorityQueuePosition = pos;
}

import PriorityQueue from './priority_queue.ts'
const timerListQueue = new PriorityQueue(compareTimersLists, setPosition);

function compareTimersLists(a, b) {
  const expiryDiff = a.expiry - b.expiry;
  if (expiryDiff === 0) {
    if (a.id < b.id)
      return -1;
    if (a.id > b.id)
      return 1;
  }
  return expiryDiff;
}

let nextExpiry = Infinity;

import L from './linkedlist.ts'

function insert(item, msecs: number, start = getLibuvNow()) {
  // Truncate so that accuracy of sub-millisecond timers is not assumed.
  msecs = MathTrunc(msecs);
  item._idleStart = start;

  // Use an existing list if there is one, otherwise we need to make a new one.
  let list = timerListMap[msecs];
  if (list === undefined) {
    debug('no %d list was found in insert, creating a new one', msecs);
    const expiry = start + msecs;
    timerListMap[msecs] = list = new TimersList(expiry, msecs);
    timerListQueue.insert(list);

    if (nextExpiry > expiry) {
      scheduleTimer(msecs);
      nextExpiry = expiry;
    }
  }

  L.append(list, item);
}

let refCount = 0;
// Timeout values > TIMEOUT_MAX are set to 1.
const TIMEOUT_MAX = 2 ** 31 - 1;

function incRefCount(): void {
  if (refCount++ === 0)
    toggleTimerRef(true);
}

const kRefed = Symbol('refed');
const kHasPrimitive = Symbol('kHasPrimitive');

const async_id_symbol = Symbol('asyncId');

function initAsyncResource(resource, type): void {
  const asyncId = resource[async_id_symbol] = newAsyncId();
  const triggerAsyncId =
    resource[trigger_async_id_symbol] = getDefaultTriggerAsyncId();
  if (initHooksExist())
    emitInit(asyncId, type, triggerAsyncId, resource);
}


// Timer constructor function.
// The entire prototype is defined in lib/timers.js
export class Timeout {
  public _idleTimeout;
  public _idlePrev: Timeout
  public _idleNext: Timeout
  public _idleStart: null
  public _onTimeout: Function
  public _timerArgs
  public _repeat
  public _destroyed: boolean
  constructor(callback: Function, after, args: undefined, isRepeat: boolean, isRefed: boolean) {
    after *= 1; // Coalesce to number or NaN
    if (!(after >= 1 && after <= TIMEOUT_MAX)) {
      if (after > TIMEOUT_MAX) {
        process.emitWarning(`${after} does not fit into` +
          ' a 32-bit signed integer.' +
          '\nTimeout duration was set to 1.',
          'TimeoutOverflowWarning');
      }
      after = 1; // Schedule on next tick, follows browser behavior
    }

    this._idleTimeout = after;
    this._idlePrev = this;
    this._idleNext = this;
    this._idleStart = null;
    // This must be set to null first to avoid function tracking
    // on the hidden class, revisit in V8 versions after 6.2
    this._onTimeout = null;
    this._onTimeout = callback;
    this._timerArgs = args;
    this._repeat = isRepeat ? after : null;
    this._destroyed = false;

    if (isRefed)
      incRefCount();
    this[kRefed] = isRefed;
    this[kHasPrimitive] = false;

    initAsyncResource(this, 'Timeout');
  }
}

export function setUnrefTimeout(callback: Function, after): Timeout {
  // Type checking identical to setTimeout()

  const timer = new Timeout(callback, after, undefined, false, false);
  insert(timer, timer._idleTimeout);

  return timer;
}
