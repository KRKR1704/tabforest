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
import { AskMemory } from './screens/AskMemory';
import { SignIn } from './screens/SignIn';
import { Onboarding } from './screens/Onboarding';
import { GroveGuide } from './screens/GroveGuide';
import { getAccount } from './adapters/me';
import { clearLastGrove } from './lib/lastGrove';
import { ResumeCard } from './components/ResumeCard';
import { resumeContext } from './adapters/contexts';
import { sendBridgeMessage } from './adapters/bridge';
import { restorePayload } from './lib/contextCard';
import { useResumeStore } from './store/useResumeStore';
import { countOpenQuestions } from './lib/grove';
import { restoreStoredGrove, runGrow } from './grow/controller';

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
  const authState = useBridgeStore((state) => state.authState);
  const authChecked = useBridgeStore((state) => state.authChecked);
  const bridgeSignIn = useBridgeStore((state) => state.signIn);
  const bridgeSignOut = useBridgeStore((state) => state.signOut);
  const setGrove = useGroveStore((state) => state.setGrove);
  const [onboarding, setOnboarding] = useState(false);
  const [guide, setGuide] = useState(false);
  const signedOut = authChecked && !authState.signed_in;

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

  // Open: show the last stored grove at once, then grow from the open tabs. Both wait until the extension has
  // said the user is signed in; before that the API only answers 401 and the grove would stay empty.
  const signedIn = authChecked && authState.signed_in;
  useEffect(() => {
    if (!growOnOpen || showInspector || !signedIn) return;
    void restoreStoredGrove().then(() => runGrow({ auto: true }));
  }, [growOnOpen, signedIn]);

  // Once the user is known to be signed in, ask the server who they are. The
  // first call for a new account says first_sign_in, which starts onboarding.
  useEffect(() => {
    if (!authChecked || !authState.signed_in) return;
    let cancelled = false;
    void getAccount().then((account) => {
      if (!cancelled && account?.first_sign_in) setOnboarding(true);
    });
    return () => {
      cancelled = true;
    };
  }, [authChecked, authState.signed_in]);

  const signIn = useCallback(async () => {
    const ok = await bridgeSignIn();
    if (!ok) return false;
    // Sign-in always lands on the grove, grown for this user from their open tabs.
    setActiveScreen('grove');
    if (growOnOpen) void runGrow({ auto: true });
    return true;
  }, [bridgeSignIn, growOnOpen, setActiveScreen]);

  const signOut = useCallback(async () => {
    await bridgeSignOut();
    // Nothing of this user's grove stays on screen or on the device for the next one.
    clearLastGrove();
    setGrove(null);
    setResume(null);
    setResumeNotice(null);
    setEvidence(null);
    setOnboarding(false);
    setGuide(false);
    setActiveScreen('grove');
  }, [bridgeSignOut, setGrove, setResume, setActiveScreen]);

  const closeEvidence = useCallback(() => setEvidence(null), []);

  if (ContractInspector && showInspector) {
    return (
      <Suspense fallback={null}>
        <ContractInspector />
      </Suspense>
    );
  }

  if (signedOut) return <SignIn onSignIn={signIn} />;
  if (onboarding) {
    return (
      <Onboarding
        name={authState.display_name?.split(' ')[0]}
        onDone={() => {
          setOnboarding(false);
          // A first-time user goes on to the tour of what each thing in the grove means.
          setGuide(true);
        }}
      />
    );
  }
  if (guide) return <GroveGuide onDone={() => setGuide(false)} />;

  return (
    <AppShell
      activeScreen={activeScreen}
      onNavigate={(screen) => {
        setEvidence(null);
        setActiveScreen(screen);
      }}
      hollowCount={hollowCount}
      userName={authState.display_name || authState.email}
      onSignOut={() => void signOut()}
      onOpenGuide={() => {
        setEvidence(null);
        setGuide(true);
      }}
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
              onResume={startResume}
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
      ) : activeScreen === 'memory' ? (
        <AskMemory query={memoryQuery} onAsk={setMemoryQuery} onOpenGrove={startResume} />
      ) : (
        <ScreenPlaceholder description={navItemFor(activeScreen).description} />
      )}
    </AppShell>
  );
};

export default App;
