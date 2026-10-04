import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../App';
import { LeftRail } from '../shell/LeftRail';
import { TopBar } from '../shell/TopBar';
import { NAV_ITEMS } from '../shell/navigation';
import { countOpenQuestions } from '../lib/grove';
import { useGroveStore } from '../store/useGroveStore';
import { mockGroveResponse } from '../mocks/mockData';

describe('LeftRail', () => {
  it('lists the six screens in order', () => {
    render(<LeftRail activeScreen="grove" onNavigate={() => {}} hollowCount={3} />);
    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const labels = within(nav)
      .getAllByRole('button')
      .map((button) => button.textContent);
    expect(labels).toEqual([
      'Current Grove',
      'Timeline',
      'Saved Groves',
      'Work Context',
      'Ask Memory',
      'Privacy',
    ]);
  });

  it('marks only the active screen as the current page', () => {
    render(<LeftRail activeScreen="saved" onNavigate={() => {}} hollowCount={0} />);
    expect(screen.getByRole('button', { name: 'Saved Groves' })).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(screen.getByRole('button', { name: 'Current Grove' })).not.toHaveAttribute(
      'aria-current'
    );
  });

  it('reports the clicked screen', () => {
    const onNavigate = vi.fn();
    render(<LeftRail activeScreen="grove" onNavigate={onNavigate} hollowCount={0} />);
    fireEvent.click(screen.getByRole('button', { name: 'Privacy' }));
    expect(onNavigate).toHaveBeenCalledWith('privacy');
  });

  it.each([
    [0, 'No tabs are resting in the Hollow'],
    [1, '1 tab is resting in the Hollow'],
    [3, '3 tabs are resting in the Hollow'],
  ])('shows the Hollow count for %i tabs', (count, line) => {
    render(<LeftRail activeScreen="grove" onNavigate={() => {}} hollowCount={count} />);
    expect(screen.getByText(line)).toBeInTheDocument();
  });
});

describe('TopBar', () => {
  it('shows the screen title and the open-question count', () => {
    render(<TopBar title="Current Grove" openQuestionCount={2} />);
    expect(screen.getByRole('heading', { name: 'Current Grove' })).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText(/open questions/)).toBeInTheDocument();
  });

  it('uses the singular for one open question', () => {
    render(<TopBar title="Current Grove" openQuestionCount={1} />);
    expect(screen.getByText(/open question$/)).toBeInTheDocument();
  });

  it('calls onGrow when Grow grove is clicked', () => {
    const onGrow = vi.fn();
    render(<TopBar title="Current Grove" openQuestionCount={0} onGrow={onGrow} />);
    fireEvent.click(screen.getByRole('button', { name: 'Grow grove' }));
    expect(onGrow).toHaveBeenCalledTimes(1);
  });

  it('disables Grow grove while a grow is running', () => {
    render(<TopBar title="Current Grove" openQuestionCount={0} isGrowing />);
    expect(screen.getByRole('button', { name: 'Growing…' })).toBeDisabled();
  });

  it('submits a trimmed memory question and ignores an empty one', () => {
    const onAskMemory = vi.fn();
    render(<TopBar title="Current Grove" openQuestionCount={0} onAskMemory={onAskMemory} />);
    const input = screen.getByPlaceholderText('Have I researched…?');
    const form = screen.getByRole('search');

    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.submit(form);
    expect(onAskMemory).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '  session storage ' } });
    fireEvent.submit(form);
    expect(onAskMemory).toHaveBeenCalledWith('session storage');
  });
});

describe('countOpenQuestions', () => {
  it('returns 0 without a grove', () => {
    expect(countOpenQuestions(null)).toBe(0);
  });

  it('counts only open questions across all trees', () => {
    const [first, ...rest] = mockGroveResponse.trees;
    const grove = {
      ...mockGroveResponse,
      trees: [
        {
          ...first,
          unresolved_questions: [
            { ...first.unresolved_questions[0], id: 'a', status: 'open' as const },
            { ...first.unresolved_questions[0], id: 'b', status: 'resolved' as const },
          ],
        },
        ...rest.map((tree) => ({ ...tree, unresolved_questions: [] })),
      ],
    };
    expect(countOpenQuestions(grove)).toBe(1);
  });
});

describe('App shell', () => {
  beforeEach(() => {
    useGroveStore.setState({ grove: mockGroveResponse, activeScreen: 'grove', isStreaming: false });
  });

  it('opens on Current Grove with the canvas, and lists the contract trees in Outline', () => {
    render(<App />);
    expect(screen.getByRole('heading', { level: 1, name: 'Current Grove' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /Living Grove/ })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    for (const tree of mockGroveResponse.trees) {
      expect(screen.getByRole('heading', { level: 2, name: tree.project.name })).toBeInTheDocument();
    }
  });

  it('shows the open-question count from the grove', () => {
    render(<App />);
    const banner = screen.getByRole('banner');
    expect(
      within(banner).getByText(String(countOpenQuestions(mockGroveResponse)))
    ).toBeInTheDocument();
  });

  it('switches screen from the left rail', () => {
    render(<App />);
    for (const item of NAV_ITEMS) {
      fireEvent.click(screen.getByRole('button', { name: item.label }));
      expect(screen.getByRole('heading', { level: 1, name: item.label })).toBeInTheDocument();
    }
  });

  it('takes a memory question to Ask Memory and shows it as text', () => {
    render(<App />);
    fireEvent.change(screen.getByPlaceholderText('Have I researched…?'), {
      target: { value: '<b>session storage</b>' },
    });
    fireEvent.submit(screen.getByRole('search'));
    expect(screen.getByRole('heading', { level: 1, name: 'Ask Memory' })).toBeInTheDocument();
    // The question is carried over as plain text, never as markup.
    const ask = within(screen.getByRole('search', { name: 'Ask memory' }));
    expect(ask.getByRole('textbox')).toHaveValue('<b>session storage</b>');
    expect(document.querySelector('main b')).toBeNull();
  });

  it('opens and closes the evidence drawer from a provenance pill', () => {
    render(<App />);
    expect(screen.queryByRole('complementary', { name: 'Evidence' })).not.toBeInTheDocument();

    const goal = mockGroveResponse.trees[0].goal;
    fireEvent.click(screen.getByRole('button', { name: 'Outline' }));
    fireEvent.click(screen.getAllByRole('button', { name: /Inferred/ })[0]);
    const drawer = screen.getByRole('complementary', { name: 'Evidence' });
    expect(within(drawer).getByText(goal.text)).toBeInTheDocument();
    expect(within(drawer).getByText(goal.evidence[0].why)).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close evidence' }));
    expect(screen.queryByRole('complementary', { name: 'Evidence' })).not.toBeInTheDocument();
  });

  it('shows an empty state when there is no grove', () => {
    useGroveStore.setState({ grove: null });
    render(<App />);
    expect(screen.getByText('No grove yet.')).toBeInTheDocument();
  });
});
