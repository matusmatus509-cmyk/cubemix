import { CubeStateData, FaceColor, FaceKey } from './CubeState';
import { cloneCubeState, FACE_KEYS } from './CubeLayout';
import { assertCubeState } from './CubeValidity';

export type FaceDots = Record<FaceKey, number>;
export type FaceRenderMode = 'real' | 'force';
// Protect faces close to edge-on from an observable colour change.
export const isFaceHidden = (dot: number) => dot > 0.04;
export interface ForceUpdate {
  repaint: boolean;
  baseline: CubeStateData | null;
}

/** Display overlay only. The owner keeps a separate, complete legal real state. */
export class ForceLayer {
  private configured: CubeStateData | null = null;
  private target: CubeStateData | null = null;
  private revealing = false;
  private modes: Record<FaceKey, FaceRenderMode> = {U:'real',D:'real',F:'real',B:'real',L:'real',R:'real'};

  arm(state: CubeStateData, dots: FaceDots) {
    assertCubeState(state);
    this.configured = cloneCubeState(state);
    this.prepareMix(dots);
  }

  /** Each new mixing cycle starts with real visible faces and a force underneath. */
  prepareMix(dots: FaceDots) {
    if (!this.configured) return;
    this.target = cloneCubeState(this.configured);
    this.revealing = false;
    for (const f of FACE_KEYS) this.modes[f] = isFaceHidden(dots[f]) ? 'force' : 'real';
  }

  clear() { this.configured = null; this.retire(); }
  configuredState() { return this.configured ? cloneCubeState(this.configured) : null; }
  isConfigured() { return this.configured !== null; }
  isArmed() { return this.target !== null; }
  isRevealing() { return this.target !== null && this.revealing; }
  modeOf(face: FaceKey): FaceRenderMode { return this.target ? this.modes[face] : 'real'; }
  targetColors(face: FaceKey): FaceColor[] | null { return this.target ? [...this.target[face]] : null; }

  /** Newly hidden faces acquire force. Never copy individual faces into reality. */
  evaluate(dots: FaceDots): ForceUpdate {
    if (!this.target) return {repaint:false, baseline:null};
    let repaint = false;
    if (FACE_KEYS.some(f => this.modes[f] === 'force' && dots[f] < -0.04)) this.revealing = true;
    for (const f of FACE_KEYS) {
      if (this.modes[f] === 'real' && isFaceHidden(dots[f])) {
        this.modes[f] = 'force';
        repaint = true;
      }
    }
    // Once every formerly real face has passed out of sight, all six displayed
    // faces already equal target. Replacing the whole real baseline is invisible.
    const baseline = FACE_KEYS.every(f => this.modes[f] === 'force') ? cloneCubeState(this.target) : null;
    return {repaint, baseline};
  }

  retire() {
    this.target = null;
    this.revealing = false;
    for (const f of FACE_KEYS) this.modes[f] = 'real';
  }
}
