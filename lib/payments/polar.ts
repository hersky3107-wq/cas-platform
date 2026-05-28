import 'server-only'

import { Polar } from '@polar-sh/sdk'

function requiredPolarEnv(): string | null {
  if (!process.env.POLAR_ACCESS_TOKEN?.trim()) return 'POLAR_ACCESS_TOKEN'
  return null
}

const missing = requiredPolarEnv()
if (missing) {
  // Throw at module init so routes fail fast with clear error.
  throw new Error(`Server misconfigured: missing ${missing}`)
}

export const polarClient = new Polar({
  accessToken: process.env.POLAR_ACCESS_TOKEN!,
})

