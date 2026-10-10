'use client'

export function CrisisPulseStyles() {
  return (
    <style jsx global>{`
      @keyframes crisis-flare {
        0% { transform: scale(1); opacity: 0.55; }
        100% { transform: scale(3.1); opacity: 0; }
      }
      .crisis-flare {
        transform-origin: center;
        animation: crisis-flare 1.8s ease-out infinite;
      }
      @keyframes crisis-flare-dot {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.35; }
      }
      .crisis-flare-dot { animation: crisis-flare-dot 1.6s ease-in-out infinite; }
      @keyframes crisis-pulse-border {
        0%, 100% { box-shadow: 0 0 0 0 rgba(251, 113, 133, 0.55); }
        50% { box-shadow: 0 0 0 8px rgba(251, 113, 133, 0); }
      }
      .crisis-pulse-border {
        animation: crisis-pulse-border 1.5s ease-out infinite;
      }
    `}</style>
  )
}
