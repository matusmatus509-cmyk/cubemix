import { CubeStateData } from './CubeState';
import { cloneCubeState, FACE_KEYS } from './CubeLayout';
import { assertCubeState } from './CubeValidity';
import { completeHiddenState, FaceDots, isFaceHidden } from './HiddenForce';
import { centerKey, orientCenters } from './CubeOrientation';

export const MIN_TURNS_BEFORE_ROTATION = 5;

/** Only complete legal cube states are committed; visible stickers are fixed. */
export class ForceLayer {
  private configured: CubeStateData | null = null;
  private armed = false;
  private turns = 0;
  private lastInput = '';
  arm(state: CubeStateData) {
    assertCubeState(state);
    this.configured = cloneCubeState(state);
    this.armed = true; this.turns = 0; this.lastInput = '';
  }
  clear() { this.configured = null; this.armed = false; this.turns = 0; this.lastInput = ''; }
  configuredState() { return this.configured ? cloneCubeState(this.configured) : null; }
  isConfigured() { return this.configured !== null; }
  isArmed() { return this.armed; }
  isRotationLocked() { return false; }
  noteTurn() {
    if (!this.configured) return;
    if (!this.armed) { this.armed = true; this.turns = 0; }
    this.turns++; this.lastInput = '';
  }
  isReady() { return this.armed && this.turns >= MIN_TURNS_BEFORE_ROTATION; }
  retire() { this.armed = false; }
  evaluate(state: CubeStateData, dots: FaceDots): CubeStateData | null {
    if (!this.isReady() || !this.configured) return null;
    const signature = FACE_KEYS.map(f => `${isFaceHidden(dots[f]) ? 1 : 0}${state[f].join('')}`).join('');
    if (signature === this.lastInput) return null;
    const next = completeHiddenState(state, this.configured, dots);
    this.lastInput = FACE_KEYS.map(f => `${isFaceHidden(dots[f]) ? 1 : 0}${next[f].join('')}`).join('');
    const target = orientCenters(this.configured, centerKey(state)).state;
    if (FACE_KEYS.every(f => next[f].every((c,i) => c === target[f][i]))) this.retire();
    return FACE_KEYS.some(f => next[f].some((c,i) => c !== state[f][i])) ? next : null;
  }
}
