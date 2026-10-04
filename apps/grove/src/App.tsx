import React, { Suspense, useCallback, useEffect, useState } from 'react';
import { useGroveStore } from './store/useGroveStore';
import { useBridgeStore } from './store/useBridgeStore';
import type { GroveTab } from './types';
import { AppShell } from './shell/AppShell';
import { navItemFor } from './shell/navigation';
import { EvidenceDrawer, type EvidenceClaim } from './components/EvidenceDrawer';
import { CurrentGrove } from './screens/CurrentGrove';
import { ScreenPlaceholder } from './screens/ScreenPlaceholder';
import { Timeline } from './screens/Timeline';
import { SavedGroves } from './screens/SavedGroves';
import { WorkContext } from './screens/WorkContext';
import { Privacy } from './screens/Privacy';
import { ResumeCard } from './components/ResumeCard';
import { resumeContext } from './adapters/contexts';
import { sendBridgeMessage } from './adapters/bridge';
import { restorePayload } from './lib/contextCard';
import { useResumeStore } from './store/useResumeStore';
import { countOpenQuestions } from './lib/grove';
import { runGrow } from './grow/controller';

// The S-1 contract inspector stays reachable in development at #inspector.
// The DEV guard keeps it out of the production bundle.
const ContractInspector = import.meta.env.DEV
  ? React.lazy(() => import('./dev/ContractInspector'))
  : null;
const showInspector = window.location.hash === '#inspector';

interface AppProps {
  /** Grow a grove from the open tabs as soon as the page opens. */
  growOnOpen?: boolean;
}

export const App: React.FC<AppProps> = ({ growOnOpen = false }) => {
  const grove = useGroveStore((state) => state.grove);
  const activeScreen = useGroveStore((state) => state.activeScreen);
  const setActiveScreen = useGroveStore((state) => state.setActiveScreen);
  const isStreaming = useGroveStore((state) => state.isStreaming);
  const hollowCount = useBridgeStore((state) => state.hollowCount);
  const initializeBridge = useBridgeStore((state) => state.initializeBridge);

  const [evidence, setEvidence] = useState<{ claim: EvidenceClaim; tabs: GroveTab[] } | null>(null);
  const [memoryQuery, setMemoryQuery] = useState('');
  const resume = useResumeStore((state) => state.resume);
  const setResume = useResumeStore((state) => state.setResume);
  const [resumeNotice, setResumeNotice] = useState<string | null>(null);

  // Resume: fetch the card, pin it above the grove, and let the user choose what to reopen.
  const startResume = useCallback(
    async (contextId: string) => {
      const result = await resumeContext(contextId);
      if (!result) return false;
      setResumeNotice(null);
      setResume(result);
      setEvidence(null);
      setActiveScreen('grove');
      return true;
    },
    [setResume, setActiveScreen]
  );

  const restore = useCallback(
    async (which: 'important' | 'all') => {
      if (!resume) return;
      const payload = restorePayload(resume, which);
      const reply = await sendBridgeMessage('RESTORE', payload);
      const count = payload.tab_refs.length;
      setResumeNotice(
        reply.ok
          ? `Reopened ${count} ${count === 1 ? 'tab' : 'tabs'}.`
          : 'Could not reopen the tabs.'
      );
    },
    [resume]
  );

  useEffect(() => {
    initializeBridge();
  }, [initializeBridge]);

  useEffect(() => {
    if (growOnOpen && !showInspector) void runGrow();
  }, [growOnOpen]);

  const closeEvidence = useCallback(() => setEvidence(null), []);

  if (ContractInspector && showInspector) {
    return (
      <Suspense fallback={null}>
        <ContractInspector />
      </Suspense>
    );
  }

  return (
    <AppShell
      activeScreen={activeScreen}
      onNavigate={(screen) => {
        setEvidence(null);
        setActiveScreen(screen);
      }}
      hollowCount={hollowCount}
      openQuestionCount={countOpenQuestions(grove)}
      isGrowing={isStreaming}
      onGrow={() => {
        setEvidence(null);
        setActiveScreen('grove');
        void runGrow();
      }}
      onAskMemory={(query) => {
        setEvidence(null);
        setMemoryQuery(query);
        setActiveScreen('memory');
      }}
      drawer={
        <EvidenceDrawer claim={evidence?.claim ?? null} tabs={evidence?.tabs} onClose={closeEvidence} />
      }
    >
      {activeScreen === 'grove' ? (
        <div className="flex h-full flex-col">
          {resume && (
            <ResumeCard
              resume={resume}
              notice={resumeNotice}
              onRestore={(which) => void restore(which)}
              onDismiss={() => {
                setResume(null);
                setResumeNotice(null);
              }}
            />
          )}
          <div className="min-h-0 flex-1">
            <CurrentGrove
              grove={grove}
              onShowEvidence={(claim, tabs) => setEvidence({ claim, tabs })}
              onHideEvidence={closeEvidence}
            />
          </div>
        </div>
      ) : activeScreen === 'timeline' ? (
        <Timeline grove={grove} />
      ) : activeScreen === 'saved' ? (
        <SavedGroves onResume={startResume} />
      ) : activeScreen === 'work-context' ? (
        <WorkContext />
      ) : activeScreen === 'privacy' ? (
        <Privacy />
      ) : (
        <ScreenPlaceholder description={navItemFor(activeScreen).description}>
          {activeScreen === 'memory' && memoryQuery && (
            <p className="mt-6 text-sm text-forest-200">
              You asked: <span className="font-medium text-forest-50">{memoryQuery}</span>
            </p>
          )}
        </ScreenPlaceholder>
      )}
    </AppShell>
  );
};

export default App;
