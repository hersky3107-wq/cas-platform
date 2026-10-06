import { MetadataRoute } from 'next'
import { createClient } from '@supabase/supabase-js'

const tables = [
  'compare_sessions',
  'persona_sessions',
  'custom_sessions',
  'panel_sessions',
  'deep_sessions',
  'comedy_sessions',
  'tale_sessions',
  'oracle_sessions',
  'suit_sessions',
  'arena_sessions',
]

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticRoutes: MetadataRoute.Sitemap = [
    {
      url: 'https://www.aimani.ai',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1,
    },
    {
      url: 'https://www.aimani.ai/modes/compare',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: 'https://www.aimani.ai/modes/arena',
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
  ]

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  if (!url || !key) return staticRoutes

  const supabaseAdmin = createClient(url, key)
  const shareRoutes: MetadataRoute.Sitemap = []

  for (const table of tables) {
    const { data } = await supabaseAdmin
      .from(table)
      .select('share_id, updated_at')
      .eq('is_public', true)

    if (data) {
      for (const row of data) {
        shareRoutes.push({
          url: `https://www.aimani.ai/share/${row.share_id}`,
          lastModified: new Date(row.updated_at),
          changeFrequency: 'monthly',
          priority: 0.6,
        })
      }
    }
  }

  return [...staticRoutes, ...shareRoutes]
}
