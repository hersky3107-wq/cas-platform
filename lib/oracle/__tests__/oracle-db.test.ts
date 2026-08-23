/**
 * Guards the model_cost_logs and ai_responses schema contracts: neither table
 * has a defining migration for its original columns (model_cost_logs' one
 * additive column, oracle_session_id, does — see
 * 20260823000001_model_cost_logs_oracle_session_id.sql). These in-memory
 * fakes enforce the LIVE columns confirmed via PostgREST introspection, the
 * same in-memory-fake pattern the runner tests use
 * (lib/oracle/runner/__tests__/fakes.ts), applied here to Supabase tables
 * instead of the runner store.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const MODEL_COST_LOGS_COLUMNS = new Set([
  'id',
  'session_id',
  'ai_name',
  'model_name',
  'input_tokens',
  'output_tokens',
  'cost_usd',
  'response_time_ms',
  'created_at',
  'oracle_session_id',
  'is_estimated',
  'http_attempts',
  'final_attempt_ms',
])
const MODEL_COST_LOGS_NOT_NULL = ['ai_name', 'model_name']

const AI_RESPONSES_COLUMNS = new Set([
  'id',
  'session_id',
  'participant_id',
  'ai_name',
  'model_name',
  'response_text',
  'response_time_ms',
  'token_input',
  'token_output',
  'created_at',
  'tale_language',
])
const AI_RESPONSES_NOT_NULL = ['ai_name', 'model_name', 'response_text']

/** Only session ids inserted into this set are valid FK targets, like real `sessions` rows. */
const KNOWN_SESSION_IDS = new Set(['real-session-1'])

type Row = Record<string, unknown>
type InsertResult = { error: { message: string } | null; data: Row[] }

function makeSessionFkInsert(
  columns: Set<string>,
  notNullColumns: string[],
  relation: string,
): (rows: Row[]) => InsertResult {
  return (rows) => {
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (!columns.has(key)) {
          return { error: { message: `column "${key}" of relation "${relation}" does not exist` }, data: [] }
        }
      }
      for (const col of notNullColumns) {
        if (row[col] == null) {
          return {
            error: { message: `null value in column "${col}" of relation "${relation}" violates not-null constraint` },
            data: [],
          }
        }
      }
      if (row.session_id != null && !KNOWN_SESSION_IDS.has(row.session_id as string)) {
        return {
          error: {
            message: `insert or update on table "${relation}" violates foreign key constraint (Key (session_id)=(${row.session_id}) is not present in table "sessions")`,
          },
          data: [],
        }
      }
    }
    return { error: null, data: rows }
  }
}

const insertedRows: Row[] = []
const insertedAiResponses: Row[] = []
const insertModelCostLogs = makeSessionFkInsert(MODEL_COST_LOGS_COLUMNS, MODEL_COST_LOGS_NOT_NULL, 'model_cost_logs')
const insertAiResponses = makeSessionFkInsert(AI_RESPONSES_COLUMNS, AI_RESPONSES_NOT_NULL, 'ai_responses')

const tableHandlers: Record<string, (rows: Row[]) => InsertResult> = {
  model_cost_logs: (rows) => {
    const result = insertModelCostLogs(rows)
    if (!result.error) insertedRows.push(...rows)
    return result
  },
  ai_responses: (rows) => {
    const result = insertAiResponses(rows)
    if (!result.error) insertedAiResponses.push(...rows)
    return result
  },
}

vi.mock('@/lib/supabase/server', () => ({
  supabaseAdmin: {
    from(table: string) {
      return {
        insert: async (rows: Row[]) => {
          const handler = tableHandlers[table]
          if (!handler) throw new Error(`no fake handler registered for table "${table}"`)
          return handler(rows)
        },
      }
    },
  },
}))

const { oracleInsertCostLog, oracleInsertAiResponse } = await import('../oracle-db')

describe('oracleInsertCostLog / model_cost_logs schema contract', () => {
  beforeEach(() => {
    insertedRows.length = 0
    insertedAiResponses.length = 0
  })

  it('primary insert uses only real columns and succeeds with a valid session id', async () => {
    await oracleInsertCostLog({
      sessionId: 'real-session-1',
      aiName: 'DeepSeek',
      modelName: 'deepseek/deepseek-v3.2',
      promptTokens: 100,
      completionTokens: 50,
      totalTokens: 150,
      responseTimeMs: 1234,
      errorText: null,
    })

    expect(insertedRows).toHaveLength(1)
    const row = insertedRows[0]
    expect(Object.keys(row).every((key) => MODEL_COST_LOGS_COLUMNS.has(key))).toBe(true)
    expect(row).toMatchObject({
      session_id: 'real-session-1',
      ai_name: 'DeepSeek',
      model_name: 'deepseek/deepseek-v3.2',
      input_tokens: 100,
      output_tokens: 50,
      response_time_ms: 1234,
    })
    // No column for these — confirms they are dropped, not silently sent as unknown keys.
    expect(row).not.toHaveProperty('prompt_tokens')
    expect(row).not.toHaveProperty('completion_tokens')
    expect(row).not.toHaveProperty('total_tokens')
    expect(row).not.toHaveProperty('error_text')
  })

  it('omits session_id when null (the oracle_job_sessions-id case) instead of violating the FK', async () => {
    await oracleInsertCostLog({
      sessionId: null,
      aiName: 'DeepSeek',
      modelName: 'deepseek/deepseek-v3.2',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      responseTimeMs: 42,
    })

    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).not.toHaveProperty('session_id')
    expect(insertedRows[0]).toMatchObject({ ai_name: 'DeepSeek', model_name: 'deepseek/deepseek-v3.2' })
  })

  it('falls back without ever violating the ai_name / model_name NOT NULL constraints when the primary insert fails', async () => {
    // Foreign, unknown session id (e.g. an oracle_job_sessions id passed by
    // mistake) makes the primary insert fail on the FK — this is the exact
    // shape of failure the fallback must recover from.
    await oracleInsertCostLog({
      sessionId: 'unknown-job-session-id',
      aiName: 'Kimi',
      modelName: 'moonshotai/kimi-k3',
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
      responseTimeMs: 99,
    })

    expect(insertedRows).toHaveLength(1)
    const row = insertedRows[0]
    // This is the regression this test guards: the old fallback shipped
    // `{ session_id, model_name }` with no ai_name, which is NOT NULL with
    // no default — that fallback insert itself failed, surfacing an
    // "ai_name" error from the smoke run.
    expect(row.ai_name).toBe('Kimi')
    expect(row.model_name).toBe('moonshotai/kimi-k3')
    expect(Object.keys(row).every((key) => MODEL_COST_LOGS_COLUMNS.has(key))).toBe(true)
  })

  it('writes oracle_session_id for the rebuild path (sessionId null, oracleSessionId set)', async () => {
    await oracleInsertCostLog({
      sessionId: null,
      oracleSessionId: 'oracle-job-session-1',
      aiName: 'DeepSeek',
      modelName: 'deepseek/deepseek-v3.2',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      responseTimeMs: 42,
    })

    expect(insertedRows).toHaveLength(1)
    const row = insertedRows[0]
    expect(row.oracle_session_id).toBe('oracle-job-session-1')
    expect(row).not.toHaveProperty('session_id')
  })

  it('omits oracle_session_id for legacy callers that never set it', async () => {
    await oracleInsertCostLog({
      sessionId: 'real-session-1',
      aiName: 'DeepSeek',
      modelName: 'deepseek/deepseek-v3.2',
      promptTokens: 10,
      completionTokens: 5,
      totalTokens: 15,
      responseTimeMs: 42,
    })

    expect(insertedRows).toHaveLength(1)
    expect(insertedRows[0]).not.toHaveProperty('oracle_session_id')
    expect(insertedRows[0].session_id).toBe('real-session-1')
  })

  it('keeps oracle_session_id in the fallback row even when the primary insert fails on the session_id FK', async () => {
    await oracleInsertCostLog({
      sessionId: 'unknown-job-session-id',
      oracleSessionId: 'oracle-job-session-2',
      aiName: 'Kimi',
      modelName: 'moonshotai/kimi-k3',
      promptTokens: 20,
      completionTokens: 10,
      totalTokens: 30,
      responseTimeMs: 99,
    })

    expect(insertedRows).toHaveLength(1)
    const row = insertedRows[0]
    expect(row).not.toHaveProperty('session_id')
    expect(row.oracle_session_id).toBe('oracle-job-session-2')
    expect(row.ai_name).toBe('Kimi')
    expect(row.model_name).toBe('moonshotai/kimi-k3')
  })
})

describe('oracleInsertAiResponse / ai_responses schema contract', () => {
  beforeEach(() => {
    insertedRows.length = 0
    insertedAiResponses.length = 0
  })

  it('primary insert uses only real columns (no target_ai_name / prompt_tokens / completion_tokens / error_text)', async () => {
    await oracleInsertAiResponse('real-session-1', 'DeepSeek', 'deepseek/deepseek-v3.2', {
      responseText: 'a reading',
      responseTimeMs: 500,
      promptTokens: 100,
      completionTokens: 50,
      errorText: null,
    })

    expect(insertedAiResponses).toHaveLength(1)
    const row = insertedAiResponses[0]
    expect(Object.keys(row).every((key) => AI_RESPONSES_COLUMNS.has(key))).toBe(true)
    expect(row).toMatchObject({
      session_id: 'real-session-1',
      ai_name: 'DeepSeek',
      model_name: 'deepseek/deepseek-v3.2',
      response_text: 'a reading',
      response_time_ms: 500,
      token_input: 100,
      token_output: 50,
    })
    expect(row).not.toHaveProperty('target_ai_name')
    expect(row).not.toHaveProperty('prompt_tokens')
    expect(row).not.toHaveProperty('completion_tokens')
    expect(row).not.toHaveProperty('error_text')
  })

  it('falls back without violating ai_name / model_name / response_text NOT NULL when the session_id FK fails', async () => {
    await oracleInsertAiResponse('unknown-job-session-id', 'Kimi', 'moonshotai/kimi-k3', {
      responseText: 'a reading',
      responseTimeMs: 500,
      promptTokens: 20,
      completionTokens: 10,
      errorText: null,
    })

    expect(insertedAiResponses).toHaveLength(1)
    const row = insertedAiResponses[0]
    expect(row).not.toHaveProperty('session_id')
    expect(row).toMatchObject({
      ai_name: 'Kimi',
      model_name: 'moonshotai/kimi-k3',
      response_text: 'a reading',
      token_input: 20,
      token_output: 10,
    })
    expect(Object.keys(row).every((key) => AI_RESPONSES_COLUMNS.has(key))).toBe(true)
  })
})
