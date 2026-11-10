// Opening book built from the Lichess chess-openings dataset (scripts/build-openings.mjs).

type Entry = [eco: string, name: string] | 0;
let book: Record<string, Entry> | null = null;
let loading: Promise<void> | null = null;

export function loadOpenings(): Promise<void> {
  if (!loading) {
    loading = fetch(`${import.meta.env.BASE_URL}openings.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Record<string, Entry>>) : {}))
      .then((data) => {
        book = data;
      })
      .catch(() => {
        book = {};
      });
  }
  return loading;
}

const keyOf = (fen: string) => fen.split(' ').slice(0, 4).join(' ');

/** Whether the position is part of known opening theory. */
export function isBook(fen: string): boolean {
  return !!book && keyOf(fen) in book;
}

/** The opening name for this position, if it has one. */
export function openingName(fen: string): { eco: string; name: string } | null {
  const e = book?.[keyOf(fen)];
  return e ? { eco: e[0], name: e[1] } : null;
}
