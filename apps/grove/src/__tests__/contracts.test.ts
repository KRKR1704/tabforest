import { describe, it, expect } from 'vitest';
import {
  mockGroveResponse,
  mockSnapshot,
  mockTimelineResponse,
  mockSavedContexts,
  mockWorkContextResponse,
  mockMemorySearchResponse,
  mockPruneSuggestionsResponse,
  mockUserProfile,
  mockSessions,
} from '../mocks/mockData';

describe('Contracts & Payload Validation', () => {
  it('validates Grove JSON structure conforms to schema v1.0 and SPEC §15', () => {
    expect(mockGroveResponse.schema_version).toBe('1.0');
    expect(mockGroveResponse.trees.length).toBeGreaterThan(0);
    const tree = mockGroveResponse.trees[0];
    expect(tree.cluster_ref).toBe(tree.project.id);
    expect(tree.goal.text).toBeTruthy();
    expect(tree.goal.confidence).toBeGreaterThan(0);
    expect(['stated', 'sourced', 'inferred', 'hypothesis']).toContain(tree.goal.provenance);
    expect(tree.branches.length).toBeGreaterThan(0);
    expect(tree.decisions.length).toBeGreaterThan(0);
    expect(tree.tabs.length).toBeGreaterThan(0);
  });

  it('validates 28-tab snapshot payload conforms to SPEC §4.2', () => {
    expect(mockSnapshot.open_tabs).toHaveLength(28);
    const tab = mockSnapshot.open_tabs[0];
    expect(tab.tab_ref).toBeTruthy();
    expect(tab.domain).toBeTruthy();
    expect(tab.title).toBeTruthy();
    expect(tab.dup_key).toBeTruthy();
  });

  it('validates Timeline buckets conform to continuous aggregate format', () => {
    expect(mockTimelineResponse.project_id).toBe('p-backend-auth');
    expect(mockTimelineResponse.buckets.length).toBeGreaterThan(0);
    const bucket = mockTimelineResponse.buckets[0];
    expect(bucket.minutes).toBeGreaterThan(0);
    expect(bucket.branch_label).toBeTruthy();
    expect(bucket.markers).toBeDefined();
  });

  it('validates Saved Context and Resume Card contracts', () => {
    expect(mockSavedContexts.list.length).toBeGreaterThan(0);
    const resume = mockSavedContexts.resumeCard;
    expect(resume.important_tabs.length).toBeGreaterThan(0);
    expect(resume.goal).toBeTruthy();
  });

  it('validates Work Context response with verified quotes', () => {
    expect(mockWorkContextResponse.project).toBeTruthy();
    expect(mockWorkContextResponse.decisions[0].quote).toBeTruthy();
    expect(mockWorkContextResponse.handoff_brief_markdown).toContain('Handoff Brief');
  });

  it('validates Memory search and Prune suggestions', () => {
    expect(mockMemorySearchResponse.results.length).toBeGreaterThan(0);
    expect(mockPruneSuggestionsResponse.suggestions.length).toBeGreaterThan(0);
    expect(mockPruneSuggestionsResponse.suggestions[0].kind).toBe('exact_duplicate');
  });

  it('validates User profile and Session metrics', () => {
    expect(mockUserProfile.email).toBe('maya@tabforest.local');
    expect(mockSessions[0].tab_switches).toBeGreaterThan(0);
  });
});
