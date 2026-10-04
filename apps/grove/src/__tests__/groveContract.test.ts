import { describe, it, expect } from 'vitest';
import groveContract from '@contracts/grove.example.json';
import degradedContract from '@contracts/grove.degraded.example.json';
import snapshotContract from '@contracts/snapshot.example.json';
import streamContract from '@contracts/grove.stream.example.ndjson?raw';
import {
  indexTabs,
  normalizeGrove,
  normalizeStreamMessage,
  type WireGrove,
  type WireStreamMessage,
} from '../adapters/groveContract';
import { mockGroveResponse } from '../mocks/mockData';

// These tests read the real files in contracts/, so a change there fails here
// instead of at integration.
const wire = groveContract as WireGrove;
const index = indexTabs(snapshotContract.open_tabs);
const grove = normalizeGrove(wire, index);

describe('grove contract adapter (C3)', () => {
  it('the mock is the contract example', () => {
    expect(mockGroveResponse).toEqual(grove);
  });

  it('keeps every tree, in order, with its identity and attention', () => {
    expect(grove.trees.map((tree) => tree.project.name)).toEqual(wire.trees.map((t) => t.name));
    grove.trees.forEach((tree, i) => {
      expect(tree.cluster_ref).toBe(wire.trees[i].project_id);
      expect(tree.project.id).toBe(wire.trees[i].project_id);
      expect(tree.attention_minutes).toBe(wire.trees[i].attention_min);
      expect(tree.days_since_active).toBe(wire.trees[i].days_since_active);
      expect(tree.canopy).toBe(wire.trees[i].canopy);
    });
  });

  it('marks a tree dormant exactly when its canopy is amber', () => {
    grove.trees.forEach((tree, i) => {
      expect(tree.status).toBe(wire.trees[i].canopy === 'amber' ? 'dormant' : 'active');
    });
    expect(grove.trees.some((tree) => tree.status === 'dormant')).toBe(true);
  });

  it('flattens branch leaves into tabs and keeps them on their branch', () => {
    grove.trees.forEach((tree, i) => {
      const wireLeaves = wire.trees[i].branches.flatMap((branch) => branch.leaves);
      expect(tree.tabs.map((tab) => tab.tab_ref)).toEqual(wireLeaves.map((leaf) => leaf.tab_ref));
      expect(tree.tabs.map((tab) => tab.dwell_minutes)).toEqual(wireLeaves.map((l) => l.dwell_min));
      tree.branches.forEach((branch, b) => {
        expect(branch.label).toBe(wire.trees[i].branches[b].label);
        expect(branch.tab_refs).toEqual(wire.trees[i].branches[b].leaves.map((l) => l.tab_ref));
      });
      expect(new Set(tree.branches.map((branch) => branch.branch_ref)).size).toBe(
        tree.branches.length
      );
    });
  });

  it('maps stones to decisions and mushrooms to questions', () => {
    const first = grove.trees[0];
    const wireFirst = wire.trees[0];
    expect(first.decisions.map((d) => d.id)).toEqual(wireFirst.stones.map((s) => s.id));
    expect(first.decisions[0].stone_kind).toBe(wireFirst.stones[0].kind);
    expect(first.unresolved_questions[0].question).toBe(wireFirst.mushrooms[0].text);
    expect(first.unresolved_questions[0].recurrence_count).toBe(wireFirst.mushrooms[0].recurrence);
    expect(first.current_direction.text).toBe(wireFirst.direction?.text);
    expect(first.next_actions[0].action).toBe(wireFirst.next_actions[0].text);
  });

  it('keeps provenance, confidence, display wording and evidence kinds on claims', () => {
    const goal = grove.trees[0].goal;
    const wireGoal = wire.trees[0].goal;
    expect(goal.provenance).toBe(wireGoal.provenance);
    expect(goal.confidence).toBe(wireGoal.confidence);
    expect(goal.display_text).toBe(wireGoal.display_text);
    expect(goal.evidence).toEqual(
      wireGoal.evidence.map((e) => ({ ref: e.ref, why: e.why, ref_kind: e.ref_kind }))
    );
  });

  it('names meadow, fog and sprout tabs from the snapshot', () => {
    expect(grove.meadow.tabs).toHaveLength(wire.meadow.length);
    expect(grove.fog).toHaveLength(wire.fog.length);
    expect(grove.sprouts).toHaveLength(wire.sprouts.length);

    const loose = [
      ...grove.meadow.tabs,
      ...(grove.fog ?? []).map((item) => item.tab),
      ...grove.sprouts.flatMap((sprout) => sprout.tabs),
    ];
    for (const tab of loose) {
      expect(tab.title).toBe(index.get(tab.tab_ref)?.title);
      expect(tab.domain).toBe(index.get(tab.tab_ref)?.domain);
    }
    expect(grove.fog?.[0].reason).toBe(wire.fog[0].reason);
    expect(grove.sprouts[0].tab_count).toBe(wire.sprouts[0].tab_refs.length);
  });

  it('falls back to a neutral title when the snapshot does not know a tab', () => {
    const withoutSnapshot = normalizeGrove(wire);
    expect(withoutSnapshot.meadow.tabs[0].title).toBe('Untitled tab');
  });

  it('maps fireflies to past connections', () => {
    expect(grove.past_connections?.[0]).toMatchObject({
      tree_cluster_ref: wire.fireflies[0].project_id,
      past_project_title: wire.fireflies[0].past_project_name,
      similarity: wire.fireflies[0].similarity,
    });
  });

  it('reads the degraded (Seedling) example: banner, fogged trees, no direction', () => {
    const degraded = normalizeGrove(degradedContract as WireGrove, index);
    expect(degraded.degraded).toBe(true);
    expect(degraded.banner_text).toBe(degradedContract.banner_text);
    expect(degraded.trees).toHaveLength(degradedContract.trees.length);
    expect(degraded.trees.every((tree) => tree.fogged)).toBe(true);
    expect(degraded.trees[0].current_direction.text).toBe('');
  });

  it('reads the stream example as clusters, one tree per cluster, then done', () => {
    const lines = streamContract
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as WireStreamMessage);
    const messages = lines.map((line) => normalizeStreamMessage(line, index, wire.generated_at));

    expect(messages[0].type).toBe('clusters');
    expect(messages[messages.length - 1].type).toBe('done');
    const trees = messages.filter((message) => message.type === 'tree');
    if (messages[0].type !== 'clusters') throw new Error('first line must be clusters');
    expect(trees).toHaveLength(messages[0].clusters.length);
    expect(messages[0].clusters[0].cluster_ref).toMatch(/^p_/);
    for (const tree of trees) {
      if (tree.type !== 'tree') continue;
      expect(tree.project.name).toBeTruthy();
      expect(tree.tabs.length).toBeGreaterThan(0);
    }
  });
});
