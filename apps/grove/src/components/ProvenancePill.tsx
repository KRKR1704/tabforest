import React from 'react';
import type { Provenance } from '../types';
import { PROVENANCE_TOKENS, formatConfidence } from '../theme/provenance';

interface ProvenancePillProps {
  provenance: Provenance;
  confidence?: number;
  /** When given, the pill is a button, used to open the evidence behind the claim. */
  onClick?: () => void;
}

export const ProvenancePill: React.FC<ProvenancePillProps> = ({ provenance, confidence, onClick }) => {
  const token = PROVENANCE_TOKENS[provenance];
  const Icon = token.icon;
  const score =
    token.showsConfidence && confidence !== undefined ? formatConfidence(confidence) : null;
  const className = `pill-provenance ${token.className}`;

  const content = (
    <>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{token.label}</span>
      {score && (
        <span>
          <span aria-hidden="true">· </span>
          <span className="sr-only">confidence </span>
          {score}
        </span>
      )}
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={`${token.meaning} Show evidence.`}
        data-provenance={provenance}
        className={`${className} cursor-pointer hover:brightness-125`}
      >
        {content}
      </button>
    );
  }

  return (
    <span title={token.meaning} data-provenance={provenance} className={className}>
      {content}
    </span>
  );
};
