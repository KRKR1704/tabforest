import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProvenancePill } from '../components/ProvenancePill';
import { EvidenceDrawer, type EvidenceClaim } from '../components/EvidenceDrawer';
import type { GroveTab } from '../types';

describe('ProvenancePill', () => {
  it.each([
    ['stated', 'Stated'],
    ['sourced', 'Sourced'],
    ['inferred', 'Inferred'],
    ['hypothesis', 'Hypothesis'],
  ] as const)('labels %s in text, not by color alone', (provenance, label) => {
    render(<ProvenancePill provenance={provenance} confidence={0.5} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows confidence to two decimals for inferred and hypothesis claims', () => {
    const { container, rerender } = render(<ProvenancePill provenance="inferred" confidence={0.8} />);
    expect(container).toHaveTextContent('Inferred· confidence 0.80');
    rerender(<ProvenancePill provenance="hypothesis" confidence={0.414} />);
    expect(container).toHaveTextContent('Hypothesis· confidence 0.41');
  });

  it('shows no confidence for stated and sourced claims', () => {
    const { container, rerender } = render(<ProvenancePill provenance="stated" confidence={1} />);
    expect(container).toHaveTextContent(/^Stated$/);
    rerender(<ProvenancePill provenance="sourced" confidence={1} />);
    expect(container).toHaveTextContent(/^Sourced$/);
  });

  it('is a button only when it can open evidence', () => {
    const onClick = vi.fn();
    const { rerender } = render(<ProvenancePill provenance="inferred" confidence={0.7} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(<ProvenancePill provenance="inferred" confidence={0.7} onClick={onClick} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

describe('EvidenceDrawer', () => {
  const tabs: GroveTab[] = [
    {
      tab_ref: 't1',
      domain: 'fastapi.tiangolo.com',
      title: 'Security - FastAPI',
      dwell_minutes: 9.5,
      is_open: true,
    },
  ];

  const claim: EvidenceClaim = {
    kind: 'Goal',
    text: 'Choose an authentication architecture',
    provenance: 'inferred',
    confidence: 0.82,
    evidence: [
      { ref: 't1', why: 'official security docs, 9.5 min' },
      { ref: 'q1', why: 'search: jwt vs session auth fastapi' },
      { ref: 'n7', why: 'user note' },
      { ref: 'd2', why: 'meeting transcript' },
    ],
  };

  it('renders nothing without a claim', () => {
    const { container } = render(<EvidenceDrawer claim={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the claim, its provenance and every evidence item', () => {
    render(<EvidenceDrawer claim={claim} tabs={tabs} onClose={() => {}} />);
    expect(screen.getByRole('heading', { name: claim.text })).toBeInTheDocument();
    expect(screen.getByText('Inferred')).toBeInTheDocument();
    expect(screen.getByText('Roots · 4')).toBeInTheDocument();
    for (const item of claim.evidence) {
      expect(screen.getByText(item.why)).toBeInTheDocument();
    }
  });

  it('names tab evidence by title and domain, and labels the other sources', () => {
    render(<EvidenceDrawer claim={claim} tabs={tabs} onClose={() => {}} />);
    expect(screen.getByText('Security - FastAPI')).toBeInTheDocument();
    expect(screen.getByText(/fastapi\.tiangolo\.com/)).toBeInTheDocument();
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Your note')).toBeInTheDocument();
    expect(screen.getByText('Document')).toBeInTheDocument();
  });

  it('labels contract evidence by its ref_kind, whatever the ref looks like', () => {
    render(
      <EvidenceDrawer
        claim={{
          ...claim,
          evidence: [
            { ref: '00000000-0000-4000-8000-000000000001', ref_kind: 'query', why: 'asked four ways' },
            { ref: 'n_40000000-0000-4000-8000-000000000001', ref_kind: 'note', why: 'written down' },
          ],
        }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText('Search')).toBeInTheDocument();
    expect(screen.getByText('Your note')).toBeInTheDocument();
  });

  it('shows the verbatim quote of a sourced claim', () => {
    render(
      <EvidenceDrawer
        claim={{ ...claim, provenance: 'sourced', quote: "We'll go with Functions" }}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("We'll go with Functions")).toBeInTheDocument();
  });

  it('says so when a claim has no evidence', () => {
    render(<EvidenceDrawer claim={{ ...claim, evidence: [] }} onClose={() => {}} />);
    expect(screen.getByText('No evidence is recorded for this claim.')).toBeInTheDocument();
  });

  it('closes from the close button and from Escape', () => {
    const onClose = vi.fn();
    render(<EvidenceDrawer claim={claim} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close evidence' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('renders model and page text as text, never as markup', () => {
    const hostile = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(
      <EvidenceDrawer
        claim={{
          kind: 'Decision',
          text: hostile,
          provenance: 'sourced',
          quote: hostile,
          evidence: [{ ref: 't1', why: hostile }],
        }}
        tabs={[{ ...tabs[0], title: hostile, domain: hostile }]}
        onClose={() => {}}
      />
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('script')).toBeNull();
    expect(screen.getAllByText(hostile).length).toBeGreaterThanOrEqual(3);
  });
});

describe('source code', () => {
  it('never injects HTML (SPEC §12)', () => {
    const sources = import.meta.glob('../**/*.{ts,tsx}', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>;
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('__tests__'))
      .filter(([, code]) => /dangerouslySetInnerHTML|\.innerHTML|\.outerHTML|\.html\(/.test(code))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });
});
