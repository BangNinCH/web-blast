import { randomBytes } from 'node:crypto'

export const makeReferralCode = () => randomBytes(4).toString('hex').toUpperCase()

export const randomDelay = ([minMs, maxMs]) => {
  if (minMs === maxMs) return minMs
  return minMs + Math.floor(Math.random() * (maxMs - minMs + 1))
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
