import { Buffer } from 'buffer'
import process from 'process'

;(globalThis as typeof globalThis & { Buffer?: typeof Buffer; process?: typeof process }).Buffer =
  Buffer
;(globalThis as typeof globalThis & { process?: typeof process }).process = process
