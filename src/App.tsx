import { useEffect, useRef, useState, useCallback } from 'react';
import { CubeScene } from './cube/CubeScene';
import { isSolved, MoveType } from './cube/CubeState';
import { ForceCubieSnapshot } from './cube/RubiksCube';

const PRESET_STORAGE_KEY = 'cubemix_presets';
const DEFAULT_PRESET_KEY = 'cubemix_default_preset';
const FORCE_ON_STARTUP_KEY = 'cubemix_force_on_startup';
const MAX_PRESETS = 5;
const BG_STORAGE_KEY = 'cubemix_bg';
const SHOW_TITLE_KEY = 'cubemix_show_title';

/** Arming the default force at launch is the default behaviour. */
function isForceOnStartup(): boolean {
  return localStorage.getItem(FORCE_ON_STARTUP_KEY) !== 'false';
}

interface Preset {
  id: string;
  name: string;
  forceSnapshot: ForceCubieSnapshot[];
  savedAt: number;
}

function loadPresets(): Preset[] {
  try {
    const raw = localStorage.getItem(PRESET_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function savePresets(presets: Preset[]) {
  localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets));
}

const SCRAMBLE_MOVES: MoveType[] = ['U', "U'", 'D', "D'", 'F', "F'", 'B', "B'", 'L', "L'", 'R', "R'"];

function applyBackground(url: string) {
  const root = document.querySelector<HTMLElement>('.app-root');
  if (!root) return;
  if (url) {
    root.style.backgroundImage = `url(${url})`;
    root.style.backgroundSize = 'cover';
    root.style.backgroundPosition = 'center';
    root.style.backgroundRepeat = 'no-repeat';
  } else {
    root.style.backgroundImage = '';
    root.style.backgroundSize = '';
    root.style.backgroundPosition = '';
    root.style.backgroundRepeat = '';
  }
}

// Force Panel Component
function ForcePanel({ 
    isOpen, 
    onClose, 
    cubeScene,
    onTitleToggle,
  }: { 
    isOpen: boolean; 
    onClose: () => void; 
    cubeScene: CubeScene | null;
    onTitleToggle: (show: boolean) => void;
  }) {
    const [forceSnapshotExists, setForceSnapshotExists] = useState(false);
    const [status, setStatus] = useState<string>('');
    const [presets, setPresets] = useState<Preset[]>([]);
    const [defaultPresetId, setDefaultPresetId] = useState<string | null>(null);
    const [namingSlot, setNamingSlot] = useState<string | null>(null);
    const [nameInput, setNameInput] = useState('');
    const [bgUrl, setBgUrl] = useState<string>(() => localStorage.getItem(BG_STORAGE_KEY) ?? '');
    const [showTitle, setShowTitle] = useState<boolean>(() => localStorage.getItem(SHOW_TITLE_KEY) !== 'false');
    const [forceOnStartup, setForceOnStartup] = useState<boolean>(isForceOnStartup);
    const bgInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
      if (isOpen) {
        if (cubeScene) setForceSnapshotExists(cubeScene.hasForce());
        const loaded = loadPresets();
        setPresets(loaded);
        setDefaultPresetId(localStorage.getItem(DEFAULT_PRESET_KEY));
        setStatus('');
        setNamingSlot(null);
        setNameInput('');
        setBgUrl(localStorage.getItem(BG_STORAGE_KEY) ?? '');
        setShowTitle(localStorage.getItem(SHOW_TITLE_KEY) !== 'false');
        setForceOnStartup(isForceOnStartup());
        // Arm the default preset on open — the force lands on the hidden faces
        // straight away, the three faces in view keep their real colours.
        const defId = localStorage.getItem(DEFAULT_PRESET_KEY);
        if (defId && cubeScene) {
          const defPreset = loaded.find(p => p.id === defId);
          if (defPreset) {
            cubeScene.setForceSnapshotFromData(defPreset.forceSnapshot);
            setForceSnapshotExists(true);
          }
        }
      }
    }, [cubeScene, isOpen]);

    const handleBgUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        localStorage.setItem(BG_STORAGE_KEY, dataUrl);
        setBgUrl(dataUrl);
        applyBackground(dataUrl);
        setStatus('Pozadie nastavené');
      };
      reader.readAsDataURL(file);
    };

    const handleRemoveBg = () => {
      localStorage.removeItem(BG_STORAGE_KEY);
      setBgUrl('');
      applyBackground('');
      setStatus('Pozadie odstránené');
    };

    const handleTitleToggle = () => {
      const next = !showTitle;
      setShowTitle(next);
      localStorage.setItem(SHOW_TITLE_KEY, String(next));
      onTitleToggle(next);
    };

    const handleForceOnStartupToggle = () => {
      const next = !forceOnStartup;
      setForceOnStartup(next);
      localStorage.setItem(FORCE_ON_STARTUP_KEY, String(next));
    };

    if (!isOpen) return null;

    const handleSetSnapshot = () => {
      if (!cubeScene) return;
      cubeScene.setForceSnapshot();
      setForceSnapshotExists(true);
      setStatus('Aktuálny stav kocky je teraz force');
    };

    const handleClear = () => {
      if (!cubeScene) return;
      cubeScene.clearForceSnapshot();
      setForceSnapshotExists(false);
      setStatus('Force Cube vymazaný');
    };

    const handleSavePreset = () => {
      if (!cubeScene || !namingSlot) return;
      const name = nameInput.trim() || `Preset ${presets.length + 1}`;
      const forceSnapshot = cubeScene.takeForceSnapshot();
      const updated = [
        ...presets.filter(p => p.id !== namingSlot),
        { id: namingSlot, name, forceSnapshot, savedAt: Date.now() },
      ].slice(-MAX_PRESETS);
      savePresets(updated);
      setPresets(updated);
      setNamingSlot(null);
      setNameInput('');
      setStatus(`Preset "${name}" uložený`);
    };

    const handleLoadPreset = (preset: Preset) => {
      if (!cubeScene) return;
      cubeScene.setForceSnapshotFromData(preset.forceSnapshot);
      setForceSnapshotExists(true);
      setStatus(`Force nastavený: "${preset.name}"`);
    };

    const handleDeletePreset = (id: string) => {
      const updated = presets.filter(p => p.id !== id);
      savePresets(updated);
      setPresets(updated);
      if (defaultPresetId === id) {
        localStorage.removeItem(DEFAULT_PRESET_KEY);
        setDefaultPresetId(null);
      }
    };

    const handleSetDefault = (id: string) => {
      if (defaultPresetId === id) {
        // Unpin
        localStorage.removeItem(DEFAULT_PRESET_KEY);
        setDefaultPresetId(null);
        setStatus('Predvolený preset zrušený');
      } else {
        localStorage.setItem(DEFAULT_PRESET_KEY, id);
        setDefaultPresetId(id);
        // Set as force snapshot immediately (does not change cube state)
        const preset = presets.find(p => p.id === id);
        if (preset && cubeScene) {
          cubeScene.setForceSnapshotFromData(preset.forceSnapshot);
          setForceSnapshotExists(true);
        }
        const name = preset?.name ?? '';
        setStatus(`"${name}" nastavený ako predvolený force`);
      }
    };

    return (
      <div className="force-panel-overlay" onClick={onClose}>
        <div className="force-panel" onClick={e => e.stopPropagation()}>
          <div className="force-panel-header">
            <h2>Tajné nastavenia</h2>
            <button onClick={onClose}>✕</button>
          </div>

          <div className="force-panel-content">

            {/* ── Force snapshot section ── */}
            <div className="force-section-title">Force Mode</div>
            <div className="force-status">
              Force Cube: {forceSnapshotExists ? 'ULOŽENÝ ✓' : 'žiadny'}
            </div>
            <div className="force-buttons">
              <button onClick={handleSetSnapshot} className="force-btn">
                Snapshot Force Cube (presná kópia)
              </button>
              <button onClick={handleClear} className="force-btn force-btn-danger">
                Vymazať Force Cube
              </button>
            </div>
            <div className="force-hint">
              <p><strong>Žiadne dvojkliknutie.</strong> Force sedí na skrytých stranách automaticky, stále.</p>
              <p><strong>Otáčanie vrstiev</strong> vyzerá úplne normálne — kocka má reálne farby.</p>
              <p><strong>Prvých 5 ťahov</strong> sa kocka nedá otáčať celá — je zamknutá, kým sa force neprikryje.</p>
              <p><strong>Keď kockou otočíš</strong>, odkryté strany už majú force a ostanú tak. Nové skryté strany si vezmú ďalšiu časť force.</p>
              <p><strong>Po dokončení</strong> sa force sám vráti, len čo kocku znova zamiešaš — dá sa opakovať bez resetu.</p>
            </div>

            {/* ── Divider ── */}
            <div className="force-divider" />

            {/* ── Background section ── */}
            <div className="force-section-title">Pozadie</div>

            {bgUrl ? (
              <div className="bg-preview-wrap">
                <img className="bg-preview-img" src={bgUrl} alt="Aktuálne pozadie" />
                <div className="bg-preview-actions">
                  <button className="force-btn" onClick={() => bgInputRef.current?.click()}>
                    Zmeniť fotku
                  </button>
                  <button className="force-btn force-btn-danger" onClick={handleRemoveBg}>
                    Odstrániť
                  </button>
                </div>
              </div>
            ) : (
              <button className="force-btn bg-upload-btn" onClick={() => bgInputRef.current?.click()}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                  <polyline points="21 15 16 10 5 21"/>
                </svg>
                Nahrať fotku zo zariadenia
              </button>
            )}

            <input
              ref={bgInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleBgUpload}
            />

            {/* ── Divider ── */}
            <div className="force-divider" />

            {/* ── Title visibility section ── */}
            <div className="force-section-title">Nápis</div>
            <div className="title-toggle-row">
              <span className="title-toggle-label">Zobraziť nápis v hornej lište</span>
              <button
                className={`toggle-switch ${showTitle ? 'toggle-on' : ''}`}
                onClick={handleTitleToggle}
                aria-pressed={showTitle}
                aria-label="Zobraziť nápis"
              >
                <span className="toggle-knob" />
              </button>
            </div>

            {/* ── Force on startup section ── */}
            <div className="force-section-title">Force pri zapínaní</div>
            <div className="title-toggle-row">
              <div className="startup-toggle-text">
                <span className="title-toggle-label">Nasadiť force hneď po spustení</span>
                <span className="startup-toggle-hint">Vyžaduje predvolený preset (hviezdička). Vypni, ak chceš skladať nový preset.</span>
              </div>
              <button
                className={`toggle-switch ${forceOnStartup ? 'toggle-on' : ''}`}
                onClick={handleForceOnStartupToggle}
                aria-pressed={forceOnStartup}
                aria-label="Aktivovať force pri spustení"
              >
                <span className="toggle-knob" />
              </button>
            </div>

            {/* ── Divider ── */}
            <div className="force-divider" />

            {/* ── Preset snapshots section ── */}
            <div className="force-section-title">Presety kocky</div>
            <div className="preset-hint">Ťuknutím nasadíš preset ako force — skryté strany ho dostanú okamžite. Hviezdičkou nastavíš predvolený (nasadí sa sám pri spustení).</div>

            {presets.length === 0 && (
              <div className="force-status">Žiadne presety uložené</div>
            )}

            <div className="preset-list">
              {presets.map(preset => {
                const isDefault = defaultPresetId === preset.id;
                return (
                  <button
                    key={preset.id}
                    className={`preset-card${isDefault ? ' preset-card-default' : ''}`}
                    onClick={() => handleLoadPreset(preset)}
                  >
                    <span className="preset-card-name">{preset.name}</span>
                    <div className="preset-card-actions" onClick={e => e.stopPropagation()}>
                      <button
                        className={`preset-star-btn${isDefault ? ' preset-star-on' : ''}`}
                        onClick={() => handleSetDefault(preset.id)}
                        aria-label={isDefault ? 'Zrušiť predvolený' : 'Nastaviť ako predvolený'}
                        title={isDefault ? 'Predvolený — klikni na zrušenie' : 'Nastaviť ako predvolený'}
                      >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill={isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                        </svg>
                      </button>
                      <button
                        className="preset-delete-btn"
                        onClick={() => handleDeletePreset(preset.id)}
                        aria-label="Vymazať preset"
                      >
                        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                      </button>
                    </div>
                  </button>
                );
              })}
            </div>

            {presets.length < MAX_PRESETS && (
              namingSlot ? (
                <div className="preset-name-row">
                  <input
                    className="preset-input"
                    placeholder="Názov presetu..."
                    value={nameInput}
                    onChange={e => setNameInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) handleSavePreset(); }}
                    autoFocus
                  />
                  <button className="force-btn" onClick={handleSavePreset}>Uložiť</button>
                  <button className="force-btn force-btn-danger" onClick={() => setNamingSlot(null)}>✕</button>
                </div>
              ) : (
                <button
                  className="force-btn preset-add-btn"
                  onClick={() => { setNamingSlot(`preset_${Date.now()}`); setNameInput(''); }}
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                  Uložiť aktuálny stav kocky
                </button>
              )
            )}

            {status && <div className="force-status">{status}</div>}
          </div>
        </div>
      </div>
    );
  }

// Side Panel Component
function SidePanel({
  isOpen,
  onClose,
  onScramble,
  onSolve,
  onReset,
  scrambling,
  solving,
  solved,
  busy,
}: {
  isOpen: boolean;
  onClose: () => void;
  onScramble: () => void;
  onSolve: () => void;
  onReset: () => void;
  scrambling: boolean;
  solving: boolean;
  solved: boolean;
  busy: boolean;
}) {
  if (!isOpen) return null;

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <h2>MENU</h2>
          <button className="drawer-close" onClick={onClose}>✕</button>
        </div>

        <div className="drawer-actions">
          <button
            className="drawer-action-btn"
            onClick={() => { onScramble(); onClose(); }}
            disabled={busy}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 3 21 3 21 8" /><line x1="4" y1="20" x2="21" y2="3" />
              <polyline points="21 16 21 21 16 21" /><line x1="15" y1="15" x2="21" y2="21" />
              <line x1="4" y1="4" x2="9" y2="9" />
            </svg>
            <span>{scrambling ? 'Scrambling...' : 'Scramble'}</span>
          </button>

          <button
            className={`drawer-action-btn drawer-action-solve ${solving ? 'active' : ''}`}
            onClick={() => { onSolve(); onClose(); }}
            disabled={busy || solved}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
            <span>{solving ? 'Solving...' : 'Solve'}</span>
          </button>

          <button
            className="drawer-action-btn drawer-action-reset"
            onClick={() => { onReset(); onClose(); }}
            disabled={busy}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
            <span>Reset</span>
          </button>
        </div>
      </div>
    </>
  );
}

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const cubeSceneRef = useRef<CubeScene | null>(null);
  const [solved, setSolved] = useState(true);

  // Apply saved background image immediately on mount
  useEffect(() => {
    const saved = localStorage.getItem(BG_STORAGE_KEY);
    if (saved) applyBackground(saved);
  }, []);
  const [showTitle, setShowTitle] = useState<boolean>(() => localStorage.getItem(SHOW_TITLE_KEY) !== 'false');
  const [showPanel, setShowPanel] = useState(false);

  // PWA install prompt
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [installPrompt, setInstallPrompt] = useState<any>(null);
  const [installDismissed, setInstallDismissed] = useState(() => localStorage.getItem('pwa_dismissed') === '1');

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (e: any) => {
      e.preventDefault();
      setInstallPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    if (outcome === 'accepted') setInstallPrompt(null);
  };

  const handleInstallDismiss = () => {
    setInstallDismissed(true);
    localStorage.setItem('pwa_dismissed', '1');
  };

  const showInstallBar = !!installPrompt && !installDismissed;
  const [scrambling, setScrambling] = useState(false);
  const [solving, setSolving] = useState(false);
  const [showSolvedBanner, setShowSolvedBanner] = useState(false);
  const [showForcePanel, setShowForcePanel] = useState(false);
  const scrambleRef = useRef(false);
  const solveRef = useRef(false);
  const titlePressTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!mountRef.current) return;
    const scene = new CubeScene(mountRef.current);
    cubeSceneRef.current = scene;
    scene.setOnStateChange((state) => {
      const s = isSolved(state);
      setSolved(s);
      if (s) {
        setShowSolvedBanner(true);
        setTimeout(() => setShowSolvedBanner(false), 3000);
      }
    });

    // Arm the default preset right away: the three faces out of view get the
    // force layer immediately, the cube on screen stays completely normal.
    if (isForceOnStartup()) {
      const defId = localStorage.getItem(DEFAULT_PRESET_KEY);
      if (defId) {
        const defPreset = loadPresets().find(p => p.id === defId);
        if (defPreset) scene.setForceSnapshotFromData(defPreset.forceSnapshot);
      }
    }

    return () => {
      if (titlePressTimer.current) clearTimeout(titlePressTimer.current);
      scene.destroy(); cubeSceneRef.current = null;
    };
  }, []);

  const handleScramble = useCallback(() => {
    if (!cubeSceneRef.current || scrambling || solving) return;
    solveRef.current = false;
    setSolving(false);
    setScrambling(true);
    scrambleRef.current = true;
    setSolved(false);
    setShowSolvedBanner(false);
    cubeSceneRef.current.clearHistory();
    const total = 20;
    let count = 0;
    let lastFace = '';
    const next = () => {
      if (count >= total || !scrambleRef.current) {
        setScrambling(false);
        scrambleRef.current = false;
        return;
      }
      let move: MoveType;
      do { move = SCRAMBLE_MOVES[Math.floor(Math.random() * SCRAMBLE_MOVES.length)]; } while (move[0] === lastFace);
      lastFace = move[0];
      cubeSceneRef.current?.executeMove(move);
      count++;
      setTimeout(next, 90);
    };
    next();
  }, [scrambling, solving]);

  const handleSolve = useCallback(() => {
    // Once part of the force has been revealed the move history no longer
    // describes the cube on screen, so replaying it backwards is meaningless.
    if (!cubeSceneRef.current || scrambling || solving || solved || cubeSceneRef.current.isForceInProgress()) return;
    const sequence = cubeSceneRef.current.getSolveSequence();
    if (sequence.length === 0) return;
    setSolving(true);
    solveRef.current = true;
    let index = 0;
    const next = () => {
      if (index >= sequence.length || !solveRef.current) {
        setSolving(false);
        solveRef.current = false;
        return;
      }
      cubeSceneRef.current?.executeSolveMove(sequence[index]);
      index++;
      setTimeout(next, 220);
    };
    next();
  }, [scrambling, solving, solved]);

  const handleReset = useCallback(() => {
    if (!cubeSceneRef.current) return;
    scrambleRef.current = false;
    solveRef.current = false;
    setScrambling(false);
    setSolving(false);
    cubeSceneRef.current.reset();
    setShowSolvedBanner(false);
  }, []);

  const busy = scrambling || solving;

  const onTitleMouseDown = () => {
    titlePressTimer.current = window.setTimeout(() => {
      setShowForcePanel(true);
    }, 3000);
  };

  const onTitleMouseUp = () => {
    if (titlePressTimer.current) {
      clearTimeout(titlePressTimer.current);
      titlePressTimer.current = null;
    }
  };

  return (
    <div className="app-root">

      {/* Top bar */}
      <header className="topbar">
        <button 
          className="topbar-icon" 
          onClick={() => setShowPanel(!showPanel)}
          onMouseDown={onTitleMouseDown}
          onMouseUp={onTitleMouseUp}
          onMouseLeave={onTitleMouseUp}
          onTouchStart={onTitleMouseDown}
          onTouchEnd={onTitleMouseUp}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {showTitle && (
          <span className="topbar-title">
            CUBEMIX
          </span>
        )}
        <div className="topbar-stats" />
      </header>

      {/* Solved toast */}
      {showSolvedBanner && (
        <div className="solved-toast">SOLVED!</div>
      )}

      {/* Cube area */}
      <div className="cube-area">
        <div className="canvas-wrap" ref={mountRef} />
      </div>

      {/* Side panel with Scramble + Solve + Reset */}
      <SidePanel
        isOpen={showPanel}
        onClose={() => setShowPanel(false)}
        onScramble={handleScramble}
        onSolve={handleSolve}
        onReset={handleReset}
        scrambling={scrambling}
        solving={solving}
        solved={solved}
        busy={busy}
      />

      {/* Force Panel */}
      <ForcePanel 
        isOpen={showForcePanel}
        onClose={() => setShowForcePanel(false)}
        cubeScene={cubeSceneRef.current}
        onTitleToggle={setShowTitle}
      />

      {/* PWA Install Banner */}
      {showInstallBar && (
        <div className="pwa-install-bar">
          <div className="pwa-install-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
              <polyline points="7 10 12 15 17 10"/>
              <line x1="12" y1="15" x2="12" y2="3"/>
            </svg>
          </div>
          <div className="pwa-install-text">
            <strong>Nainštalovať CUBEMIX</strong>
            <span>Pridaj na plochu ako app</span>
          </div>
          <button className="pwa-install-btn" onClick={handleInstall}>Stiahnuť</button>
          <button className="pwa-install-dismiss" onClick={handleInstallDismiss}>✕</button>
        </div>
      )}
    </div>
  );
}
