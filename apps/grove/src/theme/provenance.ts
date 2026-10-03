import type { LucideIcon } from 'lucide-react';
import { CloudFog, Footprints, PenLine, Quote } from 'lucide-react';
import type { Provenance } from '../types';

export interface ProvenanceToken {
  label: string;
  /** What the label means, shown as a tooltip. */
  meaning: string;
  icon: LucideIcon;
  /** Stated and sourced claims are not scored; their certainty comes from the note or quote. */
  showsConfidence: boolean;
  className: string;
}

// Mirrors the stone encoding in SPEC §9.1: carved and solid for stated or
// sourced, moss and dashed for inferred, fog for a hypothesis.
export const PROVENANCE_TOKENS: Record<Provenance, ProvenanceToken> = {
  stated: {
    label: 'Stated',
    meaning: 'You said this in a note, pin or correction.',
    icon: PenLine,
    showsConfidence: false,
    className: 'border-solid border-stoneGray bg-stoneGray-dark/40 text-stoneGray-light',
  },
  sourced: {
    label: 'Sourced',
    meaning: 'A document you supplied says this, quoted verbatim.',
    icon: Quote,
    showsConfidence: false,
    className: 'border-solid border-stoneGray bg-stoneGray-dark/40 text-stoneGray-light',
  },
  inferred: {
    label: 'Inferred',
    meaning: 'Concluded from your browsing behavior.',
    icon: Footprints,
    showsConfidence: true,
    className: 'border-dashed border-moss bg-moss-dark/25 text-moss-light',
  },
  hypothesis: {
    label: 'Hypothesis',
    meaning: 'Plausible, but weakly supported.',
    icon: CloudFog,
    showsConfidence: true,
    className: 'border-dotted border-forest-500 bg-forest-800/60 text-forest-200',
  },
};

export function formatConfidence(confidence: number): string {
  return confidence.toFixed(2);
}
