import { GRADE_INFO, type Grade } from '../analysis/classify';

/** Round, colored move-quality icon in the style used by chess sites and streams. */
export function GradeIcon({ grade, size = 20 }: { grade: Grade; size?: number }) {
  const info = GRADE_INFO[grade];
  return (
    <svg
      className="grade-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={info.text}
    >
      <circle cx="12" cy="12" r="11.5" fill={info.color} />
      {grade === 'book' ? (
        // Open book
        <path
          d="M5 7.2c2.3-.8 4.6-.6 6.4.6v9.4c-1.8-1.1-4.1-1.3-6.4-.6zM19 7.2c-2.3-.8-4.6-.6-6.4.6v9.4c1.8-1.1 4.1-1.3 6.4-.6z"
          fill="#fff"
        />
      ) : grade === 'best' ? (
        <path
          d="M12 4.6l2.2 4.6 5 .6-3.7 3.4 1 5-4.5-2.5-4.5 2.5 1-5-3.7-3.4 5-.6z"
          fill="#fff"
        />
      ) : grade === 'excellent' ? (
        // Thumbs up
        <path
          d="M6 11h2.6v7.5H6zM9.6 18.5V11l3-5.2c.9-.3 1.8.4 1.7 1.4l-.5 2.8h3.7c1 0 1.7.9 1.5 1.9l-1.1 5.1c-.2.9-.9 1.5-1.8 1.5z"
          fill="#fff"
        />
      ) : grade === 'good' ? (
        <path d="M6.5 12.5l3.5 3.5 7.5-7.8" stroke="#fff" strokeWidth="2.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <text
          x="12"
          y="12.5"
          textAnchor="middle"
          dominantBaseline="central"
          fill="#fff"
          fontSize={info.symbol.length > 1 ? 11 : 15}
          fontWeight="800"
          fontFamily="system-ui, sans-serif"
        >
          {info.symbol}
        </text>
      )}
    </svg>
  );
}
