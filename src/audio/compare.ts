import { centsDifference, formatNote, type PitchPoint } from './pitch';

export type PitchMatch = {
  target: PitchPoint;
  actual: PitchPoint;
  cents: number;
  band: 'hit' | 'close' | 'miss';
  direction: 'flat' | 'sharp' | 'center';
  label: string;
};

export type ScoreState = {
  frames: number;
  hits: number;
  close: number;
  misses: number;
};

export const emptyScore: ScoreState = {
  frames: 0,
  hits: 0,
  close: 0,
  misses: 0,
};

export function comparePitch(target: PitchPoint | null, actual: PitchPoint | null): PitchMatch | null {
  if (!target?.voiced || !actual?.voiced || target.midi === null || actual.midi === null) {
    return null;
  }

  const cents = centsDifference(actual.midi, target.midi);
  const absolute = Math.abs(cents);
  const band = absolute <= 25 ? 'hit' : absolute <= 55 ? 'close' : 'miss';
  const direction = absolute <= 12 ? 'center' : cents < 0 ? 'flat' : 'sharp';
  const sign = cents > 0 ? '+' : '';

  return {
    target,
    actual,
    cents,
    band,
    direction,
    label: `${formatNote(target.midi)} / ${sign}${Math.round(cents)} cents`,
  };
}

export function addScoreFrame(score: ScoreState, match: PitchMatch | null): ScoreState {
  if (!match) {
    return score;
  }

  return {
    frames: score.frames + 1,
    hits: score.hits + (match.band === 'hit' ? 1 : 0),
    close: score.close + (match.band === 'close' ? 1 : 0),
    misses: score.misses + (match.band === 'miss' ? 1 : 0),
  };
}

export function scorePercent(score: ScoreState): number {
  if (score.frames === 0) {
    return 0;
  }
  return Math.round(((score.hits + score.close * 0.55) / score.frames) * 100);
}