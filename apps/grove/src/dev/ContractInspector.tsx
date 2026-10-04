import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Trees,
  Cpu,
  Sparkles,
  ShieldCheck,
  Play,
  Layers,
  Database,
  RefreshCw,
  CheckCircle2,
  Terminal,
  Activity,
  Compass,
} from 'lucide-react';
import { useGroveStore } from '../store/useGroveStore';
import { useBridgeStore } from '../store/useBridgeStore';
import { getGrove, streamGrowGrove, isMockMode } from '../adapters/grove';
import { searchMemory } from '../adapters/memory';
import { getTimeline } from '../adapters/platform';
import { mockSnapshot } from '../mocks/mockData';

export const ContractInspector: React.FC = () => {
  const {
    grove,
    isStreaming,
    streamProgress,
    handleStreamMessage,
  } = useGroveStore();

  const {
    authState,
    token,
    hollowCount,
    isConnectedToExtension,
    initializeBridge,
    signIn,
    signOut,
  } = useBridgeStore();

  const [activeTab, setActiveTab] = useState<'grove' | 'contracts' | 'bridge' | 'stream'>('grove');
  const [streamLog, setStreamLog] = useState<string[]>([]);

  useEffect(() => {
    initializeBridge();
  }, [initializeBridge]);

  // TanStack Query verification for Grove API
  const { data: queryGrove, refetch } = useQuery({
    queryKey: ['grove-data'],
    queryFn: getGrove,
    initialData: grove || undefined,
  });

  // Verify memory & timeline adapters
  const { data: memoryData } = useQuery({
    queryKey: ['memory-test'],
    queryFn: () => searchMemory('session storage'),
  });

  const { data: timelineData } = useQuery({
    queryKey: ['timeline-test'],
    queryFn: () => getTimeline('p_10000000-0000-4000-8000-000000000001', '24h'),
  });

  const startStreamSimulation = () => {
    setStreamLog([]);
    setStreamLog((prev) => [...prev, '[START] Initiating NDJSON stream POST /api/grove/grow?stream=1...']);
    streamGrowGrove(
      mockSnapshot,
      (msg) => {
        handleStreamMessage(msg);
        setStreamLog((prev) => [
          ...prev,
          `[NDJSON LINE] Type: ${msg.type} — ${
            msg.type === 'clusters'
              ? `${msg.clusters.length} clusters identified`
              : msg.type === 'tree'
              ? `Tree "${msg.project.name}" arrived`
              : `Done (run_id: ${msg.run_id}, degraded: ${msg.degraded})`
          }`,
        ]);
      },
      (runId, degraded) => {
        setStreamLog((prev) => [
          ...prev,
          `[COMPLETED] Stream completed cleanly (run: ${runId}, degraded: ${degraded})`,
        ]);
      }
    );
  };

  return (
    <div className="min-h-screen bg-forest-950 text-forest-50 flex flex-col font-sans">
      {/* Top Bar */}
      <header className="h-16 border-b border-forest-800 bg-forest-900/60 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-forest-800 border border-forest-700 flex items-center justify-center text-forest-300 shadow-inner">
            <Trees className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-serif text-lg font-semibold tracking-tight text-forest-100">
                TabForest
              </h1>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-forest-800 text-forest-300 border border-forest-700">
                Lane S Foundation
              </span>
            </div>
            <p className="text-xs text-forest-400">The Living Grove · Contract & Architecture Core</p>
          </div>
        </div>

        {/* Status badges */}
        <div className="flex items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 border border-forest-800 text-forest-300">
            <Compass className="w-3.5 h-3.5 text-forest-400" />
            <span>Mode:</span>
            <span className="font-semibold text-forest-200">
              {isMockMode() ? 'VITE_MOCK=1 (Contracts)' : 'Live API'}
            </span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 border border-forest-800 text-forest-300">
            <ShieldCheck className="w-3.5 h-3.5 text-forest-400" />
            <span>Hollow Count:</span>
            <span className="font-semibold text-emerald-400">{hollowCount}</span>
          </div>

          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-forest-900 border border-forest-800">
            <span
              className={`w-2 h-2 rounded-full ${
                isConnectedToExtension ? 'bg-emerald-400 shadow-glow-leaf' : 'bg-amberCanopy'
              }`}
            />
            <span className="text-forest-300">
              {isConnectedToExtension ? 'Extension Bridge' : 'Mock Bridge'}
            </span>
          </div>

          {authState.signed_in ? (
            <button
              onClick={signOut}
              className="px-3 py-1.5 rounded-lg bg-forest-800 hover:bg-forest-700 text-forest-200 border border-forest-700 transition"
            >
              {authState.display_name} (Sign Out)
            </button>
          ) : (
            <button
              onClick={signIn}
              className="px-3 py-1.5 rounded-lg bg-forest-600 hover:bg-forest-500 text-white font-medium transition shadow-md"
            >
              Sign In
            </button>
          )}
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 flex flex-col gap-6">
        {/* Navigation Tabs */}
        <nav className="flex items-center gap-2 border-b border-forest-800 pb-2">
          <button
            onClick={() => setActiveTab('grove')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
              activeTab === 'grove'
                ? 'bg-forest-800 text-white shadow-inner border border-forest-700'
                : 'text-forest-400 hover:text-forest-200 hover:bg-forest-900'
            }`}
          >
            <Trees className="w-4 h-4" />
            Grove Trees ({queryGrove?.trees.length || 0})
          </button>
          <button
            onClick={() => setActiveTab('stream')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
              activeTab === 'stream'
                ? 'bg-forest-800 text-white shadow-inner border border-forest-700'
                : 'text-forest-400 hover:text-forest-200 hover:bg-forest-900'
            }`}
          >
            <Activity className="w-4 h-4 text-emerald-400" />
            NDJSON Stream Controller
          </button>
          <button
            onClick={() => setActiveTab('contracts')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
              activeTab === 'contracts'
                ? 'bg-forest-800 text-white shadow-inner border border-forest-700'
                : 'text-forest-400 hover:text-forest-200 hover:bg-forest-900'
            }`}
          >
            <Database className="w-4 h-4 text-sky-400" />
            Connections C3–C8 Verification
          </button>
          <button
            onClick={() => setActiveTab('bridge')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition flex items-center gap-2 ${
              activeTab === 'bridge'
                ? 'bg-forest-800 text-white shadow-inner border border-forest-700'
                : 'text-forest-400 hover:text-forest-200 hover:bg-forest-900'
            }`}
          >
            <Cpu className="w-4 h-4 text-amberCanopy-light" />
            Bridge Inspector
          </button>
        </nav>

        {/* Tab Content 1: Grove Trees Summary */}
        {activeTab === 'grove' && (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-serif text-2xl text-forest-100 font-semibold">
                  Living Grove Contract Data
                </h2>
                <p className="text-sm text-forest-400">
                  Schema {queryGrove?.schema_version} · Run ID:{' '}
                  <code className="text-forest-300 font-mono text-xs">{queryGrove?.run_id}</code>
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => refetch()}
                  className="px-3.5 py-2 rounded-lg bg-forest-800 hover:bg-forest-700 text-forest-200 text-sm font-medium border border-forest-700 transition flex items-center gap-2"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refetch Grove
                </button>
                <button
                  onClick={startStreamSimulation}
                  className="px-4 py-2 rounded-lg bg-forest-600 hover:bg-forest-500 text-white text-sm font-medium transition shadow-md flex items-center gap-2"
                >
                  <Play className="w-4 h-4 fill-white" />
                  Grow Grove (Stream)
                </button>
              </div>
            </div>

            {/* Tree Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {queryGrove?.trees.map((tree) => (
                <div
                  key={tree.cluster_ref}
                  className="forest-card p-5 flex flex-col justify-between hover:border-forest-600 transition"
                >
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between">
                      <span className="text-xs font-mono text-forest-400">{tree.cluster_ref}</span>
                      <span
                        className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${
                          tree.status === 'active'
                            ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                            : 'bg-amber-950 text-amber-300 border border-amber-800'
                        }`}
                      >
                        {tree.status}
                      </span>
                    </div>

                    <h3 className="font-serif text-lg font-semibold text-forest-100">
                      {tree.project.name}
                    </h3>

                    <p className="text-xs text-forest-300 italic">
                      "{tree.goal.text}"
                    </p>

                    <div className="flex items-center gap-2 text-xs text-forest-400">
                      <span>Attention:</span>
                      <span className="font-semibold text-forest-200">
                        {tree.attention_minutes}m
                      </span>
                      <span>·</span>
                      <span>Tabs:</span>
                      <span className="font-semibold text-forest-200">
                        {tree.tabs.length}
                      </span>
                    </div>

                    {/* Branches */}
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {tree.branches.map((b) => (
                        <span
                          key={b.branch_ref}
                          className="px-2 py-0.5 rounded bg-forest-800 text-[11px] text-forest-300 border border-forest-700"
                        >
                          🌿 {b.label}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Decisions & Questions Preview */}
                  <div className="border-t border-forest-800/80 pt-3 mt-4 flex items-center justify-between text-xs text-forest-400">
                    <span>Decisions: {tree.decisions.length}</span>
                    <span>Questions: {tree.unresolved_questions.length}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* Meadow & Sprouts Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              <div className="forest-card p-4">
                <h4 className="font-serif text-sm font-semibold text-forest-200 mb-2 flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-400" />
                  Wildflower Meadow (Singletons)
                </h4>
                <p className="text-xs text-forest-400 mb-3">
                  Low-affinity tabs routed to the meadow without cluttering active trees.
                </p>
                <div className="flex flex-col gap-1.5">
                  {queryGrove?.meadow.tabs.map((tab) => (
                    <div
                      key={tab.tab_ref}
                      className="text-xs bg-forest-950/60 p-2 rounded border border-forest-800 flex items-center justify-between"
                    >
                      <span className="text-forest-300 truncate max-w-xs">{tab.title}</span>
                      <span className="text-[10px] text-forest-500">{tab.domain}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="forest-card p-4">
                <h4 className="font-serif text-sm font-semibold text-forest-200 mb-2 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-amberCanopy-light" />
                  Emerging Sprouts (&lt; 30 min, &lt; 3 tabs)
                </h4>
                <p className="text-xs text-forest-400 mb-3">
                  New exploratory branches at the edge of the forest.
                </p>
                <div className="flex flex-col gap-1.5">
                  {queryGrove?.sprouts.map((sprout) => (
                    <div
                      key={sprout.sprout_ref}
                      className="text-xs bg-forest-950/60 p-2 rounded border border-forest-800 flex items-center justify-between"
                    >
                      <span className="text-forest-300 font-medium">🌱 {sprout.label}</span>
                      <span className="text-[10px] text-forest-400">
                        {sprout.tab_count} tabs · {sprout.age_minutes}m old
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 2: Stream Controller */}
        {activeTab === 'stream' && (
          <div className="flex flex-col gap-5">
            <div className="forest-card p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="font-serif text-lg font-semibold text-forest-100">
                    NDJSON Stream Flow Simulation (C3)
                  </h3>
                  <p className="text-xs text-forest-400">
                    Tests streaming grow per SPEC §7 & §9.3 (clusters → tree × n → done)
                  </p>
                </div>
                <button
                  onClick={startStreamSimulation}
                  disabled={isStreaming}
                  className="px-4 py-2 rounded-lg bg-forest-600 hover:bg-forest-500 disabled:opacity-50 text-white text-sm font-medium transition shadow-md flex items-center gap-2"
                >
                  <Play className="w-4 h-4 fill-white" />
                  {isStreaming ? 'Streaming...' : 'Run Stream Test'}
                </button>
              </div>

              {/* Stream Progress Bar */}
              <div className="bg-forest-950 p-4 rounded-lg border border-forest-800 mb-4">
                <div className="flex items-center justify-between text-xs text-forest-300 mb-2">
                  <span>Stream Status: {isStreaming ? 'Active' : 'Idle'}</span>
                  <span>
                    Trees Received: {streamProgress.treesReceivedCount} /{' '}
                    {streamProgress.totalTreesExpected || 3}
                  </span>
                </div>
                <div className="w-full bg-forest-900 rounded-full h-2 overflow-hidden border border-forest-800">
                  <div
                    className="bg-emerald-500 h-full transition-all duration-300 shadow-glow-leaf"
                    style={{
                      width: `${
                        streamProgress.totalTreesExpected > 0
                          ? (streamProgress.treesReceivedCount / streamProgress.totalTreesExpected) * 100
                          : isStreaming
                          ? 33
                          : 0
                      }%`,
                    }}
                  />
                </div>
              </div>

              {/* Stream Terminal Output */}
              <div className="bg-black/80 rounded-lg p-4 font-mono text-xs text-emerald-400 border border-forest-800 h-64 overflow-y-auto">
                <div className="flex items-center gap-2 text-forest-400 border-b border-forest-900 pb-2 mb-3">
                  <Terminal className="w-3.5 h-3.5" />
                  <span>NDJSON Stream Log</span>
                </div>
                {streamLog.length === 0 ? (
                  <p className="text-forest-600 italic">Click "Run Stream Test" to observe line-by-line streaming.</p>
                ) : (
                  streamLog.map((log, idx) => <p key={idx} className="mb-1 leading-relaxed">{log}</p>)
                )}
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 3: Contract Connections */}
        {activeTab === 'contracts' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="forest-card p-5">
              <h3 className="font-serif text-base font-semibold text-forest-100 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                C3 & C4: Grove & Claims
              </h3>
              <p className="text-xs text-forest-400 mb-3">
                POST /api/grove/grow, GET /api/grove, PATCH /api/claims, POST /api/notes
              </p>
              <div className="bg-forest-950 p-3 rounded text-xs font-mono text-forest-300 border border-forest-800">
                Grove trees verified: {queryGrove?.trees.length} clusters, {queryGrove?.trees[0].decisions.length} decisions
              </div>
            </div>

            <div className="forest-card p-5">
              <h3 className="font-serif text-base font-semibold text-forest-100 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                C5: Memory Search & Prune
              </h3>
              <p className="text-xs text-forest-400 mb-3">
                GET /api/memory/search, POST /api/tabs/prune-suggestions
              </p>
              <div className="bg-forest-950 p-3 rounded text-xs font-mono text-forest-300 border border-forest-800">
                Memory search: {memoryData?.ok ? `${memoryData.result.matches.length} match for "${memoryData.result.query}"` : 'unavailable'}
              </div>
            </div>

            <div className="forest-card p-5">
              <h3 className="font-serif text-base font-semibold text-forest-100 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                C7: Platform & Timeline
              </h3>
              <p className="text-xs text-forest-400 mb-3">
                GET /api/projects/timeline, GET /api/me, GET /api/sessions
              </p>
              <div className="bg-forest-950 p-3 rounded text-xs font-mono text-forest-300 border border-forest-800">
                Timeline: {timelineData?.status === 'ok' ? `${timelineData.timeline.lanes.length} lanes for ${timelineData.timeline.name}` : timelineData?.status}
              </div>
            </div>

            <div className="forest-card p-5">
              <h3 className="font-serif text-base font-semibold text-forest-100 mb-3 flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                C8: Chrome Extension Bridge
              </h3>
              <p className="text-xs text-forest-400 mb-3">
                16 typed message types implemented from contracts/bridge.types.ts
              </p>
              <div className="bg-forest-950 p-3 rounded text-xs font-mono text-forest-300 border border-forest-800">
                Bridge status: Token active ({token?.substring(0, 15)}...), Hollow Count: {hollowCount}
              </div>
            </div>
          </div>
        )}

        {/* Tab Content 4: Bridge Inspector */}
        {activeTab === 'bridge' && (
          <div className="forest-card p-5">
            <h3 className="font-serif text-base font-semibold text-forest-100 mb-3">
              Extension Bridge State Inspector
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="bg-forest-950 p-3 rounded border border-forest-800">
                <span className="text-forest-400 block mb-1">User Profile (GET_AUTH_STATE):</span>
                <pre className="font-mono text-forest-300 overflow-x-auto">
                  {JSON.stringify(authState, null, 2)}
                </pre>
              </div>

              <div className="bg-forest-950 p-3 rounded border border-forest-800">
                <span className="text-forest-400 block mb-1">Token Status (GET_TOKEN):</span>
                <pre className="font-mono text-forest-300 overflow-x-auto">
                  {JSON.stringify({ token, hollowCount }, null, 2)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="h-10 border-t border-forest-800/60 bg-forest-950 px-6 flex items-center justify-between text-[11px] text-forest-500">
        <span>TabForest Living Grove · GirlHacks 2026</span>
        <span>Built with React 18, TypeScript, Tailwind, Zustand & TanStack Query</span>
      </footer>
    </div>
  );
};

export default ContractInspector;
