import { supabase } from './supabase' 
import { encryptText } from './crypto'
// 세션 생성
export async function createSession(data: any) {
  return await supabase.from('sessions').insert([data]).select().single()
}

// 참여자 추가
export async function addParticipant(data: any) {
  return await supabase.from('session_participants').insert([data])
}

// AI 응답 저장
export async function saveAiResponse(data: any) {
  return await supabase.from('ai_responses').insert([data])
}

// 토론 로그
export async function saveDebateLog(data: any) {
  return await supabase.from('debate_logs').insert([data])
}

// 투표
export async function saveVote(data: any) {
  return await supabase.from('votes').insert([data])
}

// 점수
export async function saveScore(data: any) {
  return await supabase.from('scores').insert([data])
}

// 사용자 선택
export async function saveUserSelection(data: any) {
  return await supabase.from('user_selections').insert([data])
}

// 결과 저장
export async function saveSessionResult(data: any) {
  return await supabase.from('session_results').insert([data])
}

// 비용 로그
export async function saveModelCost(data: any) {
  return await supabase.from('model_cost_logs').insert([data])
}

// 통계 조회
export async function getSelectionStats() {
  return await supabase.from('user_selections').select('*')
}

export async function getWinnerStats() {
  return await supabase.from('session_results').select('*')
}

export async function getScoreStats() {
  return await supabase.from('scores').select('*')
}
export async function saveUserApiKey({
    user_id,
    provider,
    api_key
  }: {
    user_id: string
    provider: string
    api_key: string
  }) {
    const encrypted = encryptText(api_key)
  
    return await supabase.from('user_api_keys').insert([
      {
        user_id,
        provider,
        encrypted_key: encrypted
      }
    ])
  }