import {Buffer} from "../../buffer.ts";
const { WriteWrap, streamBaseState, kLastWriteWasAsync, kBytesWritten, kReadBytesOrError, kArrayBufferOffset } = internalBinding("stream_wrap")
import { symbols } from './async_hooks.ts';
const owner_symbol = symbols.owner_symbol
export const kUpdateTimer = Symbol('kUpdateTimer');
export const kAfterAsyncWrite = Symbol('kAfterAsyncWrite');
const { UV_EOF } = internalBinding('uv');
const kMaybeDestroy = Symbol('kMaybeDestroy');
export const kBuffer = Symbol('kBuffer');
export const kBufferGen = Symbol('kBufferGen');
export const kBufferCb = Symbol('kBufferCb');
import { FastBuffer } from './buffer.ts');
import {
  errnoException
} from './errors.ts'

function onWriteComplete(status: number): void {
  debug('onWriteComplete', status, this.error);

  const stream = this.handle[owner_symbol];

  if (stream.destroyed) {
    if (typeof this.callback === 'function')
      this.callback(null);
    return;
  }

  // TODO (ronag): This should be moved before if(stream.destroyed)
  // in order to avoid swallowing error.
  if (status < 0) {
    const ex = errnoException(status, 'write', this.error);
    if (typeof this.callback === 'function')
      this.callback(ex);
    else
      stream.destroy(ex);
    return;
  }

  stream[kUpdateTimer]();
  stream[kAfterAsyncWrite](this);

  if (typeof this.callback === 'function')
    this.callback(null);
}

function createWriteWrap(handle, callback: Function) {
  const req = new WriteWrap();

  req.handle = handle;
  req.oncomplete = onWriteComplete;
  req.async = false;
  req.bytes = 0;
  req.buffer = null;
  req.callback = callback;

  return req;
}

function handleWriteReq(req: WriteWrap, data, encoding: string) {
  const { handle } = req;

  switch (encoding) {
    case 'buffer':
    {
      const ret = handle.writeBuffer(req, data);
      if (streamBaseState[kLastWriteWasAsync])
        req.buffer = data;
      return ret;
    }
    case 'latin1':
    case 'binary':
      return handle.writeLatin1String(req, data);
    case 'utf8':
    case 'utf-8':
      return handle.writeUtf8String(req, data);
    case 'ascii':
      return handle.writeAsciiString(req, data);
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return handle.writeUcs2String(req, data);
    default:
    {
      const buffer = Buffer.from(data, encoding);
      const ret = handle.writeBuffer(req, buffer);
      if (streamBaseState[kLastWriteWasAsync])
        req.buffer = buffer;
      return ret;
    }
  }
}

function afterWriteDispatched(req, err, cb): void {
  req.bytes = streamBaseState[kBytesWritten];
  req.async = !!streamBaseState[kLastWriteWasAsync];

  if (err !== 0)
    return cb(errnoException(err, 'write', req.error));

  if (!req.async && typeof req.callback === 'function') {
    req.callback();
  }
}

export const kHandle = Symbol('kHandle');
export function writevGeneric(self, data, encoding, cb) {
  const req = createWriteWrap(self[kHandle], cb);
  const err = handleWriteReq(req, data, encoding);

  afterWriteDispatched(req, err, cb);
  return req;
}

export function writeGeneric(self, data, encoding, cb) {
  const req = createWriteWrap(self[kHandle], cb);
  const err = handleWriteReq(req, data, encoding);

  afterWriteDispatched(req, err, cb);
  return req;
}

function isUint8Array(arr: unknown): boolean {
  return arr.constructor === Uint8Array
}

export function onStreamRead(arrayBuffer) {
  const nread = streamBaseState[kReadBytesOrError];

  const handle = this;
  const stream = this[owner_symbol];

  stream[kUpdateTimer]();

  if (nread > 0 && !stream.destroyed) {
    let ret;
    let result;
    const userBuf = stream[kBuffer];
    if (userBuf) {
      result = (stream[kBufferCb](nread, userBuf) !== false);
      const bufGen = stream[kBufferGen];
      if (bufGen !== null) {
        const nextBuf = bufGen();
        if (isUint8Array(nextBuf))
          stream[kBuffer] = ret = nextBuf;
      }
    } else {
      const offset = streamBaseState[kArrayBufferOffset];
      const buf = new FastBuffer(arrayBuffer, offset, nread);
      result = stream.push(buf);
    }
    if (!result) {
      handle.reading = false;
      if (!stream.destroyed) {
        const err = handle.readStop();
        if (err)
          stream.destroy(errnoException(err, 'read'));
      }
    }

    return ret;
  }

  if (nread === 0) {
    return;
  }

  if (nread !== UV_EOF) {
    // CallJSOnreadMethod expects the return value to be a buffer.
    // Ref: https://github.com/nodejs/node/pull/34375
    stream.destroy(errnoException(nread, 'read'));
    return;
  }

  // Defer this until we actually emit end
  if (stream._readableState.endEmitted) {
    if (stream[kMaybeDestroy])
      stream[kMaybeDestroy]();
  } else {
    if (stream[kMaybeDestroy])
      stream.on('end', stream[kMaybeDestroy]);

    // TODO(ronag): Without this `readStop`, `onStreamRead`
    // will be called once more (i.e. after Readable.ended)
    // on Windows causing a ECONNRESET, failing the
    // test-https-truncate test.
    if (handle.readStop) {
      const err = handle.readStop();
      if (err) {
        // CallJSOnreadMethod expects the return value to be a buffer.
        // Ref: https://github.com/nodejs/node/pull/34375
        stream.destroy(errnoException(err, 'read'));
        return;
      }
    }

    // Push a null to signal the end of data.
    // Do it before `maybeDestroy` for correct order of events:
    // `end` -> `close`
    stream.push(null);
    stream.read(0);
  }
}

import {getTimerDuration, kTimeout, setUnrefTimeout} from "./timers.ts"
const kSession = Symbol('kSession');


export function setStreamTimeout(msecs, callback: Function) {
  if (this.destroyed)
    return this;

  this.timeout = msecs;

  // Type checking identical to timers.enroll()
  msecs = getTimerDuration(msecs, 'msecs');

  // Attempt to clear an existing timer in both cases -
  //  even if it will be rescheduled we don't want to leak an existing timer.
  clearTimeout(this[kTimeout]);

  if (msecs === 0) {
    if (callback !== undefined) {
      this.removeListener('timeout', callback);
    }
  } else {
    this[kTimeout] = setUnrefTimeout(this._onTimeout.bind(this), msecs);
    if (this[kSession]) this[kSession][kUpdateTimer]();

    if (callback !== undefined) {
      this.once('timeout', callback);
    }
  }
  return this;
}
