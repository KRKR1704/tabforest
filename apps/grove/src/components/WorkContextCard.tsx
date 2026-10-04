import React from 'react';
import type { WorkClaim, WorkContextResponse, WorkDocument } from '../types';
import { ProvenancePill } from './ProvenancePill';
import { MushroomIcon } from './icons';

interface WorkContextCardProps {
  result: WorkContextResponse;
}

const SOURCE_LABELS: Record<WorkDocument['source_type'], string> = {
  ticket: 'Ticket',
  pull_request: 'Pull request',
  account_note: 'Account note',
  transcript: 'Transcript',
  document: 'Document',
};

/** Who said it, where and when: only the parts the server verified. */
function attribution(claim: WorkClaim & { speaker?: string }): string {
  return [claim.speaker, claim.source, claim.timestamp].filter(Boolean).join(' · ');
}

const Claim: React.FC<{
  claim: WorkClaim & { speaker?: string };
  lead?: React.ReactNode;
  note?: string | null;
}> = ({ claim, lead, note }) => (
  <li data-claim-id={claim.id} className="py-3">
    <div className="flex flex-wrap items-start gap-x-3 gap-y-1.5">
      {lead}
      <p className="min-w-0 flex-1 text-sm text-forest-50">{claim.display_text}</p>
      <ProvenancePill provenance={claim.provenance} confidence={claim.confidence} />
    </div>
    {note && <p className="mt-1 text-xs text-forest-300">{note}</p>}
    {claim.quote && (
      <figure className="mt-2 border-l-2 border-stoneGray pl-3">
        <blockquote className="font-serif text-sm italic text-forest-100">{claim.quote}</blockquote>
        {attribution(claim) && (
          <figcaption className="mt-1 text-xs text-forest-400">{attribution(claim)}</figcaption>
        )}
      </figure>
    )}
  </li>
);

const Section: React.FC<{ title: string; empty?: string; count: number; children: React.ReactNode }> = ({
  title,
  empty,
  count,
  children,
}) => (
  <section className="border-t border-forest-800 py-4">
    <h3 className="text-xs font-medium uppercase tracking-wider text-forest-400">{title}</h3>
    {count === 0 ? (
      <p className="mt-2 text-sm text-forest-300">{empty}</p>
    ) : (
      <ul className="divide-y divide-forest-800">{children}</ul>
    )}
  </section>
);

/** One project state rebuilt from the artifacts the user handed over (SPEC §3.5). */
export const WorkContextCard: React.FC<WorkContextCardProps> = ({ result }) => {
  const nameOf = (id: string | null) => {
    if (!id) return null;
    const target = [...result.blockers, ...result.open_questions].find((item) => item.id === id);
    return target ? `Unblocks: ${target.text}` : null;
  };
  const actions = [...result.next_actions].sort((a, b) => a.rank - b.rank);

  return (
    <article aria-label="Reconstructed project">
      <p className="text-xs font-medium uppercase tracking-wider text-forest-400">Project</p>
      <h2 className="mt-1 font-serif text-2xl font-semibold text-forest-50">{result.project}</h2>

      <section className="py-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-forest-400">Goal</h3>
        <ul>
          <Claim claim={result.goal} />
        </ul>
      </section>

      <Section title="Decisions" count={result.decisions.length} empty="No decision was found.">
        {result.decisions.map((decision) => (
          <Claim key={decision.id} claim={decision} />
        ))}
      </Section>

      <Section title="Blockers" count={result.blockers.length} empty="Nothing is blocked.">
        {result.blockers.map((blocker) => (
          <Claim key={blocker.id} claim={blocker} />
        ))}
      </Section>

      <Section
        title="Open questions"
        count={result.open_questions.length}
        empty="No question was left open."
      >
        {result.open_questions.map((question) => (
          <Claim
            key={question.id}
            claim={question}
            lead={<MushroomIcon className="mt-0.5 h-4 w-4 shrink-0 text-amberCanopy-light" />}
            note={
              question.status === 'resolved'
                ? `Resolved: ${question.answer ?? 'no answer recorded'}`
                : `Raised ${question.recurrence} ${question.recurrence === 1 ? 'time' : 'times'}, no answer`
            }
          />
        ))}
      </Section>

      <Section title="Owners" count={result.owners.length} empty="No owner was named.">
        {result.owners.map((owner) => (
          <Claim key={owner.id} claim={owner} note={`${owner.person}: ${owner.task}`} />
        ))}
      </Section>

      <Section title="Next actions" count={actions.length} empty="No next action was found.">
        {actions.map((action) => (
          <Claim
            key={action.id}
            claim={action}
            lead={<span className="w-5 shrink-0 text-sm font-semibold text-forest-300">{action.rank}.</span>}
            note={nameOf(action.unblocks)}
          />
        ))}
      </Section>

      <section className="border-t border-forest-800 py-4">
        <h3 className="text-xs font-medium uppercase tracking-wider text-forest-400">
          Evidence · {result.documents.length} {result.documents.length === 1 ? 'source' : 'sources'}
        </h3>
        <ul className="mt-2 space-y-1">
          {result.documents.map((document) => (
            <li key={document.id} className="text-sm text-forest-100">
              {document.title}{' '}
              <span className="text-forest-400">· {SOURCE_LABELS[document.source_type]}</span>
            </li>
          ))}
        </ul>
      </section>
    </article>
  );
};
