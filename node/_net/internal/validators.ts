import {hideStackFrames} from "./errors";
import {ERR_INVALID_ARG_TYPE, ERR_OUT_OF_RANGE} from "../../_errors";

function isInt32(value: number): boolean {
  return value === (value | 0);
}

const { NumberIsInteger } = primordials

export const validateInt32 = hideStackFrames(
  (value, name, min = -2147483648, max = 2147483647) => {
    // The defaults for min and max correspond to the limits of 32-bit integers.
    if (!isInt32(value)) {
      if (typeof value !== 'number') {
        throw new ERR_INVALID_ARG_TYPE(name, 'number', value);
      }
      if (!NumberIsInteger(value)) {
        throw new ERR_OUT_OF_RANGE(name, 'an integer', value);
      }
      throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    }
    if (value < min || value > max) {
      throw new ERR_OUT_OF_RANGE(name, `>= ${min} && <= ${max}`, value);
    }
  }
);

export function validateString(value: string, name: string): void {
  if (typeof value !== 'string')
    throw new ERR_INVALID_ARG_TYPE(name, 'string', value);
}

import { codes } from "./errors.ts"
const { ERR_SOCKET_BAD_PORT } = codes

// Check that the port number is not NaN when coerced to a number,
// is an integer and that it falls within the legal range of port numbers.
export function validatePort(port: number | string, name = 'Port', { allowZero = true } = {}): number | string {
  if ((typeof port !== 'number' && typeof port !== 'string') ||
    (typeof port === 'string' && port.trim().length === 0) ||
    +port !== (+port >>> 0) ||
    port > 0xFFFF ||
    (port === 0 && !allowZero)) {
    throw new ERR_SOCKET_BAD_PORT(name, port, allowZero);
  }
  return port || 0;
}
