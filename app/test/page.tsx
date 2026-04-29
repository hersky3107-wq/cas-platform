'use client'

import { useEffect } from 'react'
import {
  createSession,
  addParticipant,
  saveAiResponse,
  saveUserSelection
} from '@/lib/db/helpers'

export default function TestPage() {

  useEffect(() => {
    async function runTest() {

      // 1. 세션 생성
      const { data: session } = await createSession({
        mode: 'compare',
        prompt: 'AI 중 누가 더 똑똑한가?'
      })

      if (!session) return

      // 2. 참가자 추가
      await addParticipant({
        session_id: session.id,
        ai_name: 'GPT',
        model_name: 'gpt-4'
      })

      await addParticipant({
        session_id: session.id,
        ai_name: 'Claude',
        model_name: 'claude-3'
      })

      // 3. AI 응답 저장
      await saveAiResponse({
        session_id: session.id,
        ai_name: 'GPT',
        model_name: 'gpt-4',
        response_text: '나는 최고의 AI다.'
      })

      await saveAiResponse({
        session_id: session.id,
        ai_name: 'Claude',
        model_name: 'claude-3',
        response_text: '나는 더 깊이 사고한다.'
      })

      // 4. 유저 선택
      await saveUserSelection({
        session_id: session.id,
        selected_ai_name: 'GPT',
        reason: '더 직관적이다'
      })

      console.log('테스트 완료', session.id)
    }

    runTest()
  }, [])

  return <div>DB 테스트 실행중...</div>
}