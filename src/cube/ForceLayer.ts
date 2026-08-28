// The force layer: a second set of colours that rides on the faces the viewer
// cannot see. Pure decision logic, no three.js — the renderer only asks it
// "which layer does this face show right now".

import { CubeStateData, FaceColor, FaceKey } from './CubeState';
import { FACE_KEYS, cloneCubeState } from './CubeLayout';

/**
 * Where one face takes its colours from.
 *  - 'real'  → the true cube state, what an honest cube would show
 *  - 'force' → the programmed target state
 */
export type FaceRenderMode = 'real' | 'force';

/** What changed after looking at the cube's current orientation. */
export interface ForceLayerUpdate {
  /** Faces now in view wearing the force — their colours become the real ones. */
  commit: FaceKey[];
  /** Faces that just went out of sight and have taken the force on. */
  hidden: FaceKey[];
  /** True when the last face has been revealed: the cube now *is* the force. */
  finished: boolean;
}

/**
 * A face is only given the force once it is a hair past edge-on, where it
 * projects to nothing and the swap cannot be seen.
 */
const HIDE_DOT = 0.03;

/** How far a forced face must turn into view before its colours are committed. */
const REVEAL_DOT = -0.03;

export class ForceLayer {
  /** The live target. Null once the force has been fully revealed or cleared. */
  private target: CubeStateData | null = null;
  /** The force as loaded — kept after the reveal so Reset can arm it again. */
  private configured: CubeStateData | null = null;
  private mode: Record<FaceKey, FaceRenderMode> = {
    U: 'real', D: 'real', F: 'real', B: 'real', L: 'real', R: 'real',
  };
  /** Faces already shown wearing the force. They are never forced again. */
  private committed: Set<FaceKey> = new Set();

  /** A force is configured (whether or not it is still waiting to be seen). */
  isConfigured(): boolean { return this.configured !== null; }

  /** The force layer is still riding on the unseen faces. */
  isArmed(): boolean { return this.target !== null; }

  /** At least one face has been revealed — the illusion is under way. */
  isRevealing(): boolean { return this.target !== null && this.committed.size > 0; }

  /** The force as it was loaded, for re-arming after a reset. */
  configuredState(): CubeStateData | null {
    return this.configured ? cloneCubeState(this.configured) : null;
  }

  /**
   * Load a force and put it on every face that is out of sight right now.
   * `dots` is the per-face facing value (negative = in view).
   */
  arm(state: CubeStateData, dots: Record<FaceKey, number>) {
    this.target = cloneCubeState(state);
    this.configured = cloneCubeState(state);
    this.committed.clear();
    for (const face of FACE_KEYS) {
      this.mode[face] = dots[face] > 0 ? 'force' : 'real';
    }
  }

  /** Drop the force entirely — the cube goes back to being an ordinary cube. */
  clear() {
    this.target = null;
    this.configured = null;
    this.committed.clear();
    for (const face of FACE_KEYS) this.mode[face] = 'real';
  }

  modeOf(face: FaceKey): FaceRenderMode {
    return this.target !== null ? this.mode[face] : 'real';
  }

  /** The nine target colours for a face, or null when nothing is armed. */
  targetColors(face: FaceKey): FaceColor[] | null {
    return this.target ? [...this.target[face]] : null;
  }

  /**
   * Decide what the current orientation means for the force layer.
   *
   *  - a face that has turned out of sight takes the force on, unseen;
   *  - a forced face that has turned into view must have its colours committed
   *    as the real ones. Nothing changes on screen at that instant — the face
   *    already shows them — but from then on that face is an honest part of the
   *    cube and is never forced again, so ordinary turns keep working.
   *
   * The caller is responsible for actually copying the committed colours into
   * the real state; this only reports which faces need it.
   */
  evaluate(dots: Record<FaceKey, number>): ForceLayerUpdate {
    const commit: FaceKey[] = [];
    const hidden: FaceKey[] = [];

    if (!this.target) return { commit, hidden, finished: false };

    for (const face of FACE_KEYS) {
      if (this.mode[face] === 'force') {
        if (dots[face] < REVEAL_DOT) {
          this.mode[face] = 'real';
          this.committed.add(face);
          commit.push(face);
        }
      } else if (!this.committed.has(face) && dots[face] > HIDE_DOT) {
        this.mode[face] = 'force';
        hidden.push(face);
      }
    }

    return { commit, hidden, finished: this.committed.size >= FACE_KEYS.length };
  }

  /**
   * Put the layer away once every face has been revealed. The configured force
   * is kept so a reset can arm it again; the cube itself now genuinely holds the
   * force state, so from here on it is an ordinary cube.
   *
   * Called by the owner after it has committed the last face — the target has to
   * stay readable until then.
   */
  retire() {
    this.target = null;
    this.committed.clear();
    for (const face of FACE_KEYS) this.mode[face] = 'real';
  }
}
