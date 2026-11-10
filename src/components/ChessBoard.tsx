import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Chessboard } from 'react-chessboard';
import { Chess, type Square } from 'chess.js';
import type { Arrow, PromotionPieceOption } from 'react-chessboard/dist/chessboard/types';
import { GradeIcon } from './GradeIcon';
import type { Grade } from '../analysis/classify';

type Side = 'w' | 'b';

export interface BoardBadge {
  square: string;
  grade: Grade;
}

interface Props {
  fen: string;
  orientation: Side;
  /** Which color the user may move. null = board is read-only. */
  movable: Side | null;
  onMove?: (from: string, to: string, promotion?: string) => boolean;
  lastMove?: { from: string; to: string } | null;
  badge?: BoardBadge | null;
  arrows?: Arrow[];
}

const BadgeContext = createContext<BoardBadge | null>(null);

// Rendered by react-chessboard for every square; draws the grade icon in the corner.
const BadgeSquare = forwardRef<HTMLDivElement, { children: ReactNode; square: string; style: CSSProperties }>(
  function BadgeSquare({ children, square, style }, ref) {
    const badge = useContext(BadgeContext);
    return (
      <div ref={ref} style={{ ...style, position: 'relative' }}>
        {children}
        {badge && badge.square === square && (
          <span className="square-badge">
            <GradeIcon grade={badge.grade} size={26} />
          </span>
        )}
      </div>
    );
  },
);

const LIGHT = { backgroundColor: '#ebecd0' };
const DARK = { backgroundColor: '#739552' };
const HIGHLIGHT = 'inset 0 0 0 999px rgba(255, 255, 51, 0.42)';

export function ChessBoard({ fen, orientation, movable, onMove, lastMove, badge, arrows }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(560);
  const [selected, setSelected] = useState<string | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);

  const chess = useMemo(() => new Chess(fen), [fen]);
  const canMove = movable !== null && chess.turn() === movable && !chess.isGameOver();

  // Clear selection whenever the position changes.
  useEffect(() => {
    setSelected(null);
    setPromo(null);
  }, [fen]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    // Ignore 0 widths (the board is hidden on another tab).
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      if (w > 0) setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const legalFrom = (sq: string) => (canMove ? chess.moves({ square: sq as Square, verbose: true }) : []);
  const targets = useMemo(() => (selected ? legalFrom(selected) : []), [selected, chess, canMove]); // eslint-disable-line react-hooks/exhaustive-deps

  const needsPromotion = (from: string, to: string) =>
    legalFrom(from).some((m) => m.to === to && m.promotion);

  function tryMove(from: string, to: string, promotion?: string): boolean {
    if (!canMove || !onMove) return false;
    const ok = legalFrom(from).some((m) => m.to === to);
    if (!ok) return false;
    setSelected(null);
    return onMove(from, to, promotion);
  }

  function onSquareClick(square: Square) {
    if (!canMove) return;
    if (selected && targets.some((m) => m.to === square)) {
      if (needsPromotion(selected, square)) {
        setPromo({ from: selected, to: square });
        return;
      }
      tryMove(selected, square);
      return;
    }
    const piece = chess.get(square);
    if (piece && piece.color === movable) setSelected(square === selected ? null : square);
    else setSelected(null);
  }

  function onPromotionPieceSelect(piece?: PromotionPieceOption, from?: Square, to?: Square) {
    const f = promo?.from ?? from;
    const t = promo?.to ?? to;
    setPromo(null);
    if (!piece || !f || !t) return false;
    return tryMove(f, t, piece[1].toLowerCase());
  }

  const squareStyles = useMemo(() => {
    const s: Record<string, CSSProperties> = {};
    const add = (sq: string, style: CSSProperties) => (s[sq] = { ...s[sq], ...style });
    if (lastMove) {
      add(lastMove.from, { boxShadow: HIGHLIGHT });
      add(lastMove.to, { boxShadow: HIGHLIGHT });
    }
    if (selected) add(selected, { boxShadow: HIGHLIGHT });
    for (const m of targets) {
      const capture = !!chess.get(m.to as Square) || m.flags.includes('e');
      add(m.to, {
        backgroundImage: capture
          ? 'radial-gradient(circle, transparent 57%, rgba(0,0,0,0.16) 58%)'
          : 'radial-gradient(circle, rgba(0,0,0,0.16) 21%, transparent 22%)',
        cursor: 'pointer',
      });
    }
    if (chess.inCheck()) {
      const board = chess.board();
      for (const row of board)
        for (const p of row)
          if (p && p.type === 'k' && p.color === chess.turn())
            add(p.square, {
              backgroundImage:
                'radial-gradient(circle, rgba(255,0,0,0.9) 0%, rgba(231,0,0,0.5) 40%, transparent 72%)',
            });
    }
    return s;
  }, [lastMove, selected, targets, chess]);

  return (
    <div className="board-frame" ref={wrapRef}>
      <BadgeContext.Provider value={badge ?? null}>
        <Chessboard
          id="main-board"
          position={fen}
          boardWidth={width}
          boardOrientation={orientation === 'w' ? 'white' : 'black'}
          arePiecesDraggable={canMove}
          isDraggablePiece={({ piece }) => canMove && piece[0] === movable}
          onPieceDragBegin={(_, sq) => setSelected(sq)}
          onPieceDrop={(from, to) => (needsPromotion(from, to) ? false : tryMove(from, to))}
          onPromotionCheck={(from, to) => canMove && needsPromotion(from, to)}
          onPromotionPieceSelect={onPromotionPieceSelect}
          showPromotionDialog={!!promo}
          promotionToSquare={(promo?.to as Square) ?? null}
          onSquareClick={onSquareClick}
          customSquare={BadgeSquare as never}
          customSquareStyles={squareStyles}
          customLightSquareStyle={LIGHT}
          customDarkSquareStyle={DARK}
          customArrows={arrows}
          customArrowColor="rgba(129, 182, 76, 0.85)"
          customBoardStyle={{ borderRadius: '4px', boxShadow: '0 6px 24px rgba(0,0,0,0.45)' }}
          customNotationStyle={{ fontWeight: 600, fontSize: '12px' }}
          animationDuration={180}
          areArrowsAllowed
        />
      </BadgeContext.Provider>
    </div>
  );
}
