import 'server-only'

import { Polar } from '@polar-sh/sdk'

let _polarClient: Polar | null = null

export function getPolarClient(): Polar {
  if (!process.env.POLAR_ACCESS_TOKEN?.trim()) {
    throw new Error('Server misconfigured: missing POLAR_ACCESS_TOKEN')
  }
  if (!_polarClient) {
    _polarClient = new Polar({ accessToken: process.env.POLAR_ACCESS_TOKEN! })
  }
  return _polarClient
}
