import { useState } from 'react';
import { App } from './App';
import { Puzzles } from './components/Puzzles';
import { MyMistakes } from './components/MyMistakes';

type Tab = 'play' | 'puzzles' | 'mistakes';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'play', label: 'Play', icon: '♟' },
  { id: 'puzzles', label: 'Puzzles', icon: '🧩' },
  { id: 'mistakes', label: 'My mistakes', icon: '↻' },
];

export function Shell() {
  const [tab, setTab] = useState<Tab>('play');
  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Sections">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            ♞
          </span>
          <span>ChessGuide</span>
        </div>
        {TABS.map((t) => (
          <button key={t.id} className="nav-item" aria-current={tab === t.id} onClick={() => setTab(t.id)}>
            <span className="nav-icon" aria-hidden="true">
              {t.icon}
            </span>
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
      <main className="content">
        {/* Keep the game mounted on other tabs so it isn't lost. */}
        <div hidden={tab !== 'play'}>
          <App onOpenMistakes={() => setTab('mistakes')} />
        </div>
        {tab === 'puzzles' && <Puzzles />}
        {tab === 'mistakes' && <MyMistakes />}
      </main>
    </div>
  );
}
