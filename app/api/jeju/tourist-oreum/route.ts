import { getOreumList } from '@/lib/jeju/tourist-oreum'

export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(): Promise<Response> {
  const today = new Date().toISOString().slice(0, 10)
  const result = await getOreumList({ today })
  return Response.json(result)
}
