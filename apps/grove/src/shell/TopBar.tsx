import React, { useState } from 'react';
import { Search } from 'lucide-react';
import { MushroomIcon } from '../components/icons';

interface TopBarProps {
  title: string;
  openQuestionCount: number;
  isGrowing?: boolean;
  onGrow?: () => void;
  onAskMemory?: (query: string) => void;
}

export const TopBar: React.FC<TopBarProps> = ({
  title,
  openQuestionCount,
  isGrowing = false,
  onGrow,
  onAskMemory,
}) => {
  const [query, setQuery] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const trimmed = query.trim();
    if (trimmed) onAskMemory?.(trimmed);
  };

  return (
    <header className="flex h-14 shrink-0 items-center gap-6 border-b border-forest-800 bg-forest-950 px-6">
      <h1 className="shrink-0 whitespace-nowrap font-serif text-xl font-semibold text-forest-50">
        {title}
      </h1>

      <form role="search" onSubmit={submit} className="ml-auto w-full max-w-sm">
        <label className="flex items-center gap-2 border-b border-forest-700 pb-1 focus-within:border-forest-400">
          <Search className="h-4 w-4 shrink-0 text-forest-400" aria-hidden="true" />
          <span className="sr-only">Have I researched this before?</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Have I researched…?"
            className="w-full bg-transparent text-sm text-forest-50 placeholder:text-forest-500 focus:outline-none"
          />
        </label>
      </form>

      <p className="flex shrink-0 items-center gap-1.5 text-sm text-forest-200">
        <MushroomIcon className="h-4 w-4 text-amberCanopy-light" />
        <span>
          <span className="font-semibold text-forest-50">{openQuestionCount}</span>{' '}
          {openQuestionCount === 1 ? 'open question' : 'open questions'}
        </span>
      </p>

      <button
        type="button"
        onClick={onGrow}
        disabled={isGrowing}
        className="shrink-0 rounded-md bg-forest-600 px-4 py-1.5 text-sm font-medium text-forest-50 hover:bg-forest-500 disabled:opacity-60"
      >
        {isGrowing ? 'Growing…' : 'Grow grove'}
      </button>
    </header>
  );
};
