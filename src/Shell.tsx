import { useState } from 'react';
import { App } from './App';
import { Puzzles } from './components/Puzzles';
import { MyMistakes } from './components/MyMistakes';

type Tab = 'play' | 'puzzles' | 'mistakes';

export function Shell() {
  const [tab, setTab] = useState<Tab>('play');
  return (
    <>
      <nav className="tabs" aria-label="Sections">
        <strong className="brand">ChessGuide</strong>
        <button aria-current={tab === 'play'} onClick={() => setTab('play')}>
          Play
        </button>
        <button aria-current={tab === 'puzzles'} onClick={() => setTab('puzzles')}>
          Puzzles
        </button>
        <button aria-current={tab === 'mistakes'} onClick={() => setTab('mistakes')}>
          My mistakes
        </button>
      </nav>
      {/* Keep the game mounted while on the puzzles tab so it isn't lost. */}
      <div hidden={tab !== 'play'}>
        <App />
      </div>
      {tab === 'puzzles' && (
        <main className="app">
          <Puzzles />
        </main>
      )}
      {tab === 'mistakes' && (
        <main className="app">
          <MyMistakes />
        </main>
      )}
    </>
  );
}
