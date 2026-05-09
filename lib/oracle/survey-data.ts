/** 15 oracle birth-time survey rows — wording fixed from product spec */

export type SurveyQuestionSpec = {
  id: keyof SurveyAnswersExpected
  text: string
  choices: string[]
}

/** q1-q15 selections are array indices into choices */

export type SurveyAnswersExpected = {
  q1: number
  q2: number
  q3: number
  q4: number
  q5: number
  q6: number
  q7: number
  q8: number
  q9: number
  q10: number
  q11: number
  q12: number
  q13: number
  q14: number
  q15: number
}

export const SURVEY_QUESTIONS: SurveyQuestionSpec[] = [
  {
    id: 'q1',
    text: 'Q1. When do you feel most energetic and alert?',
    choices: [
      'Late night to early dawn (11PM–3AM)',
      'Early morning, I wake up naturally (3AM–7AM)',
      'Mid-morning onwards (7AM–11AM)',
      'Around midday, peak energy at noon (11AM–1PM)',
      'Afternoon is when I really get going (1PM–5PM)',
      'Evening and night is my prime time (5PM–11PM)',
    ],
  },
  {
    id: 'q2',
    text: 'Q2. How do you communicate?',
    choices: [
      'Fast and direct — I get to the point immediately',
      'Slow and careful — I explain things thoroughly',
      'Depends on the situation',
    ],
  },
  {
    id: 'q3',
    text: 'Q3. How do you express emotions?',
    choices: [
      'My feelings show immediately on my face',
      'I keep things inside and rarely show emotion',
      'I express but recover quickly',
    ],
  },
  {
    id: 'q4',
    text: 'Q4. How do you make decisions?',
    choices: [
      'Intuitively and quickly — I trust my gut',
      'Carefully — I analyze before deciding',
      'I consult others before deciding',
    ],
  },
  {
    id: 'q5',
    text: 'Q5. When facing conflict, I tend to:',
    choices: [
      'Confront it head-on',
      'Step back and resolve it later',
      'Mediate and find a compromise',
    ],
  },
  {
    id: 'q6',
    text: 'Q6. What best describes your energy pattern?',
    choices: [
      'Once I start, I push through to the end',
      'Strong start but lose momentum midway',
      'Slow to start but grow stronger over time',
    ],
  },
  {
    id: 'q7',
    text: 'Q7. Your attitude toward money:',
    choices: [
      'I spend freely and enjoy the flow',
      'I save carefully and dislike waste',
      "I'm mostly indifferent unless I need something",
    ],
  },
  {
    id: 'q8',
    text: 'Q8. How do you relieve stress?',
    choices: [
      'Physical activity or going outside',
      'Alone time to think and reset',
      'Talking it out with someone',
      'Eating or sleeping it off',
    ],
  },
  {
    id: 'q9',
    text: 'Q9. In social situations, I:',
    choices: [
      'Connect with strangers easily and quickly',
      'Take time to open up but form deep bonds',
      'Know many people but keep things surface-level',
    ],
  },
  {
    id: 'q10',
    text: 'Q10. What do you fear most?',
    choices: [
      'Losing control of a situation',
      'Being left alone',
      'Failure or public embarrassment',
      'Change and uncertainty',
    ],
  },
  {
    id: 'q11',
    text: 'Q11. Face shape:',
    choices: [
      'Oval or long with a prominent forehead',
      'Round and full-faced',
      'Square or angular with strong cheekbones',
      'Inverted triangle, wide forehead, narrow chin',
    ],
  },
  {
    id: 'q12',
    text: 'Q12. Eyes:',
    choices: [
      'Large and sharp — my gaze is intense',
      'Narrow and long — a piercing look',
      'Soft and gentle — a warm expression',
      'Small but deep — quietly observant',
    ],
  },
  {
    id: 'q13',
    text: 'Q13. Body type:',
    choices: ['Tall and lean', 'Compact and muscular', 'Soft and full-bodied', 'Small and quick-moving'],
  },
  {
    id: 'q14',
    text: 'Q14. Skin tone and complexion:',
    choices: [
      'Fair and clear',
      'Ruddy or naturally flushed',
      'Warm golden or tawny',
      'Dark or with a cool undertone',
    ],
  },
  {
    id: 'q15',
    text: 'Q15. Hands:',
    choices: ['Long fingers, slender hands', 'Thick palms, broad hands', 'Small and firm', 'Warm and reddish'],
  },
]

export const SURVEY_SIJIN_ANCHORS: Record<
  string,
  { kr: string; midpointHHMM: string }
> = {
  'Late night to early dawn (11PM–3AM)': { kr: '子時', midpointHHMM: '01:00' },
  'Early morning, I wake up naturally (3AM–7AM)': { kr: '卯時', midpointHHMM: '05:00' },
  'Mid-morning onwards (7AM–11AM)': { kr: '巳時', midpointHHMM: '09:00' },
  'Around midday, peak energy at noon (11AM–1PM)': { kr: '午時', midpointHHMM: '12:00' },
  'Afternoon is when I really get going (1PM–5PM)': { kr: '申時', midpointHHMM: '15:00' },
  'Evening and night is my prime time (5PM–11PM)': { kr: '戌時', midpointHHMM: '21:00' },
}
