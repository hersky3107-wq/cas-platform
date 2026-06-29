import { getOlleList } from '@/lib/jeju/tourist-olle'

export const runtime = 'nodejs'
export const maxDuration = 30

// NO import from app/api/synod/* or any AIMANI credit path.

export async function GET(): Promise<Response> {
  const result = await getOlleList()
  return Response.json(result)
}
