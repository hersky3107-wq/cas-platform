import fs from 'fs'
import path from 'path'

const root = path.join(process.cwd(), 'app', 'api')

const blockA = /  const token = typeof body\.supabaseAccessToken === 'string' \? body\.supabaseAccessToken : undefined\n\n  const supabaseAuth = token\n    \? createSupabaseWithToken\(token\)\n    : await createSupabaseRouteAuthClient\(\)\n  const supabase = supabaseAdmin\n  const \{\n    data: \{ user \},\n    error: authErr,\n  \} = await supabaseAuth\.auth\.getUser\(\)\n  if \(authErr \|\| !user\) \{\n    return Response\.json\(\{ error: 'Invalid session' \}, \{ status: 401 \}\)\n  \}/g

const replA = `  const { user, error: authErr, accessToken: token } = await resolveRouteAuth(req, body)
  const supabase = supabaseAdmin
  if (authErr || !user) {
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }`

const blockB = /  const supabaseAuth = token\n    \? createSupabaseWithToken\(token\)\n    : await createSupabaseRouteAuthClient\(\)\n  const supabase = supabaseAdmin\n  const \{\n    data: \{ user \},\n    error: authErr,\n  \} = await supabaseAuth\.auth\.getUser\(\)\n  if \(authErr \|\| !user\) \{\n    return NextResponse\.json\(\{ error: 'Invalid session' \}, \{ status: 401 \}\)\n  \}/g

const replB = `  const { user, error: authErr } = await resolveRouteAuth(req, body)
  const supabase = supabaseAdmin
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }`

const blockC = /  const supabase = token \? createSupabaseWithToken\(token\) : await createSupabaseRouteAuthClient\(\)\n  const \{\n    data: \{ user \},\n    error: authErr,\n  \} = await supabase\.auth\.getUser\(\)\n  if \(authErr \|\| !user\) \{\n    return Response\.json\(\{ error: 'Invalid session' \}, \{ status: 401 \}\)\n  \}/g

const replC = `  const { user, supabase, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user) {
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }`

const blockD = /  const supabaseAuth = await createSupabaseRouteAuthClient\(\)\n  const \{\n    data: \{ user \},\n    error: authErr,\n  \} = await supabaseAuth\.auth\.getUser\(\)\n  if \(authErr \|\| !user\) return jsonResp\(\{ error: 'Invalid session' \}, 401\)/g

const replD = `  const { user, error: authErr } = await resolveRouteAuth(req)
  if (authErr || !user) return jsonResp({ error: 'Invalid session' }, 401)`

const blockE = /  const supabaseAuth = await createSupabaseRouteAuthClient\(\)\n  const \{\n    data: \{ user \},\n    error: authErr,\n  \} = await supabaseAuth\.auth\.getUser\(\)\n  if \(authErr \|\| !user\) \{\n    return jsonResp\(\{ error: 'Invalid session' \}, 401\)\n  \}/g

const replE = `  const { user, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user) {
    return jsonResp({ error: 'Invalid session' }, 401)
  }`

const blockF = /  const supabaseAuth = token \? createSupabaseWithToken\(token\) : await createSupabaseRouteAuthClient\(\)\n  const \{\n    data: \{ user \},\n    error: authErr,\n  \} = await supabaseAuth\.auth\.getUser\(\)\n  if \(authErr \|\| !user\) \{\n    return NextResponse\.json\(\{ error: 'Invalid session' \}, \{ status: 401 \}\)\n  \}/g

const replF = `  const { user, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 })
  }`

const blockG = /  const supabaseAuth = await createSupabaseRouteAuthClient\(\);\n  const \{\n    data: \{ user \},\n    error: authErr,\n  \} = await supabaseAuth\.auth\.getUser\(\);\n  if \(authErr \|\| !user\) return NextResponse\.json\(\{ error: "Invalid session" \}, \{ status: 401 \}\);/g

const replG = `  const { user, error: authErr } = await resolveRouteAuth(req);
  if (authErr || !user) return NextResponse.json({ error: "Invalid session" }, { status: 401 });`

const blockH = /  const supabaseAuth = token\n    \? createSupabaseWithToken\(token\)\n    : await createSupabaseRouteAuthClient\(\)\n  const \{\n    data: \{ user \},\n    error: authErr,\n  \} = await supabaseAuth\.auth\.getUser\(\)\n  if \(authErr \|\| !user\) \{\n    return new Response\(JSON\.stringify\(\{ error: 'Invalid session' \}\), \{\n      status: 401,\n      headers: \{ 'Content-Type': 'application\/json' \},\n    \}\)\n  \}/g

const replH = `  const { user, error: authErr } = await resolveRouteAuth(req, body)
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid session' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }`

const blockI =
  /  const supabaseAuth =\n    token\n      \? createSupabaseWithToken\(token\)\n      : await createSupabaseRouteAuthClient\(\)\n  const supabase = supabaseAdmin\n  const tokenForRouter = token \|\| undefined\n  const \{\n    data: \{ user \},\n    error: authErr,\n  \} = await supabaseAuth\.auth\.getUser\(\)\n  if \(authErr \|\| !user\) \{\n    console\.log\('\[api\/suit\] auth failed:', authErr\?\.message \?\? 'no_user'\)\n    return Response\.json\(\{ error: 'Invalid session' \}, \{ status: 401 \}\)\n  \}/g

const replI = `  const { user, error: authErr, accessToken } = await resolveRouteAuth(req, body)
  const supabase = supabaseAdmin
  const tokenForRouter = accessToken || token || undefined
  if (authErr || !user) {
    console.log('[api/suit] auth failed:', authErr?.message ?? 'no_user')
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  }`

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name)
    if (fs.statSync(p).isDirectory()) walk(p, files)
    else if (name === 'route.ts') files.push(p)
  }
  return files
}

for (const file of walk(root)) {
  let s = fs.readFileSync(file, 'utf8')
  if (!s.includes('createSupabaseRouteAuthClient') && !s.includes('Invalid session')) continue
  if (s.includes('resolveRouteAuth')) continue

  const orig = s
  s = s.replace(blockA, replA)
  s = s.replace(blockB, replB)
  s = s.replace(blockC, replC)
  s = s.replace(blockD, replD)
  s = s.replace(blockE, replE)
  s = s.replace(blockF, replF)
  s = s.replace(blockG, replG)
  s = s.replace(blockH, replH)
  s = s.replace(blockI, replI)

  if (s === orig) continue

  s = s.replace(
    /import \{ createSupabaseWithToken \} from '@\/lib\/supabase\/server-client'\nimport \{ createSupabaseRouteAuthClient \} from '@\/lib\/supabase\/route-auth'/,
    `import { resolveRouteAuth } from '@/lib/supabase/route-auth'`
  )
  s = s.replace(
    /import \{ createSupabaseRouteAuthClient \} from '@\/lib\/supabase\/route-auth'\nimport \{ supabaseAdmin \}/,
    `import { resolveRouteAuth } from '@/lib/supabase/route-auth'\nimport { supabaseAdmin }`
  )
  s = s.replace(
    /import \{ createSupabaseWithToken \} from '@\/lib\/supabase\/server-client'\nimport \{ createSupabaseRouteAuthClient \} from '@\/lib\/supabase\/route-auth'\nimport/,
    `import { resolveRouteAuth } from '@/lib/supabase/route-auth'\nimport`
  )
  s = s.replace(
    /import \{ createSupabaseRouteAuthClient \} from '@\/lib\/supabase\/route-auth'/,
    `import { resolveRouteAuth } from '@/lib/supabase/route-auth'`
  )
  s = s.replace(/import \{ createSupabaseWithToken \} from '@\/lib\/supabase\/server-client'\n/, '')

  s = s.replace(/export async function POST\(\) \{/g, 'export async function POST(req: Request) {')
  s = s.replace(/export async function GET\(\) \{/g, 'export async function GET(req: Request) {')

  fs.writeFileSync(file, s)
  console.log('patched', path.relative(process.cwd(), file))
}
