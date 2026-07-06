export type PitchPoint = {
  time: number;
  frequency: number | null;
  midi: number | null;
  rms: number;
  voiced: boolean;
};

export type YinOptions = {
  sampleRate: number;
  minFrequency?: number;
  maxFrequency?: number;
  threshold?: number;
  minRms?: number;
};

const DEFAULT_MIN_FREQUENCY = 70;
const DEFAULT_MAX_FREQUENCY = 1100;
const DEFAULT_THRESHOLD = 0.12;
const DEFAULT_MIN_RMS = 0.012;
const MAX_FRAME_JUMP_SEMITONES = 7;
const MAX_BRIDGE_GAP_SECONDS = 0.16;

export function hzToMidi(frequency: number): number {
  return 69 + 12 * Math.log2(frequency / 440);
}

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

export function formatNote(midi: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const rounded = Math.round(midi);
  const octave = Math.floor(rounded / 12) - 1;
  return `${names[((rounded % 12) + 12) % 12]}${octave}`;
}

export function centsDifference(actualMidi: number, targetMidi: number): number {
  return (actualMidi - targetMidi) * 100;
}

export function calculateRms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples.length);
}

export function detectPitchYin(samples: Float32Array, options: YinOptions): number | null {
  const minFrequency = options.minFrequency ?? DEFAULT_MIN_FREQUENCY;
  const maxFrequency = options.maxFrequency ?? DEFAULT_MAX_FREQUENCY;
  const threshold = options.threshold ?? DEFAULT_THRESHOLD;
  const minRms = options.minRms ?? DEFAULT_MIN_RMS;
  const rms = calculateRms(samples);

  if (rms < minRms) {
    return null;
  }

  const minTau = Math.max(2, Math.floor(options.sampleRate / maxFrequency));
  const maxTau = Math.min(samples.length - 1, Math.ceil(options.sampleRate / minFrequency));
  const difference = new Float32Array(maxTau + 1);
  const cumulativeMean = new Float32Array(maxTau + 1);

  for (let tau = 1; tau <= maxTau; tau += 1) {
    let sum = 0;
    for (let index = 0; index < samples.length - tau; index += 1) {
      const delta = samples[index] - samples[index + tau];
      sum += delta * delta;
    }
    difference[tau] = sum;
  }

  cumulativeMean[0] = 1;
  let runningSum = 0;
  for (let tau = 1; tau <= maxTau; tau += 1) {
    runningSum += difference[tau];
    cumulativeMean[tau] = runningSum === 0 ? 1 : (difference[tau] * tau) / runningSum;
  }

  let tauEstimate = -1;
  for (let tau = minTau; tau <= maxTau; tau += 1) {
    if (cumulativeMean[tau] < threshold) {
      while (tau + 1 <= maxTau && cumulativeMean[tau + 1] < cumulativeMean[tau]) {
        tau += 1;
      }
      tauEstimate = tau;
      break;
    }
  }

  if (tauEstimate === -1) {
    return null;
  }

  const betterTau = parabolicInterpolation(cumulativeMean, tauEstimate);
  const frequency = options.sampleRate / betterTau;
  return Number.isFinite(frequency) && frequency >= minFrequency && frequency <= maxFrequency ? frequency : null;
}

export function makePitchPoint(time: number, samples: Float32Array, sampleRate: number, minRms?: number): PitchPoint {
  const rms = calculateRms(samples);
  const frequency = detectPitchYin(samples, { sampleRate, minRms });
  return {
    time,
    frequency,
    midi: frequency ? hzToMidi(frequency) : null,
    rms,
    voiced: frequency !== null,
  };
}

export function smoothPitchTrack(points: PitchPoint[]): PitchPoint[] {
  const octaveCorrected = correctOctaveJumps(points);
  const bridged = bridgeShortGaps(octaveCorrected);
  const despiked = removeIsolatedSpikes(bridged);
  return medianSmooth(despiked);
}

function correctOctaveJumps(points: PitchPoint[]): PitchPoint[] {
  const corrected: PitchPoint[] = [];

  for (const point of points) {
    const previous = findPreviousVoiced(corrected, corrected.length);
    if (!point.voiced || point.midi === null || previous?.midi === null || previous === null) {
      corrected.push(point);
      continue;
    }

    let midi = point.midi;
    while (midi - previous.midi > 9) {
      midi -= 12;
    }
    while (previous.midi - midi > 9) {
      midi += 12;
    }

    corrected.push({
      ...point,
      midi,
      frequency: midiToHz(midi),
    });
  }

  return corrected;
}

function bridgeShortGaps(points: PitchPoint[]): PitchPoint[] {
  const bridged = [...points];
  let index = 0;

  while (index < bridged.length) {
    if (bridged[index].voiced) {
      index += 1;
      continue;
    }

    const gapStart = index;
    while (index < bridged.length && !bridged[index].voiced) {
      index += 1;
    }

    const gapEnd = index - 1;
    const before = gapStart > 0 ? bridged[gapStart - 1] : null;
    const after = index < bridged.length ? bridged[index] : null;
    if (!before?.voiced || !after?.voiced || before.midi === null || after.midi === null) {
      continue;
    }

    const gapSeconds = after.time - before.time;
    if (gapSeconds > MAX_BRIDGE_GAP_SECONDS || Math.abs(after.midi - before.midi) > 1.4) {
      continue;
    }

    for (let fillIndex = gapStart; fillIndex <= gapEnd; fillIndex += 1) {
      const progress = (bridged[fillIndex].time - before.time) / Math.max(0.001, after.time - before.time);
      const midi = before.midi + (after.midi - before.midi) * progress;
      bridged[fillIndex] = {
        ...bridged[fillIndex],
        frequency: midiToHz(midi),
        midi,
        voiced: true,
      };
    }
  }

  return bridged;
}

function removeIsolatedSpikes(points: PitchPoint[]): PitchPoint[] {
  return points.map((point, index) => {
    if (!point.voiced || point.midi === null) {
      return point;
    }

    const previous = findPreviousVoiced(points, index);
    const next = findNextVoiced(points, index);
    if (!previous?.midi || !next?.midi) {
      return point;
    }

    const previousJump = Math.abs(point.midi - previous.midi);
    const nextJump = Math.abs(point.midi - next.midi);
    const neighborDistance = Math.abs(previous.midi - next.midi);
    if (previousJump > MAX_FRAME_JUMP_SEMITONES && nextJump > MAX_FRAME_JUMP_SEMITONES && neighborDistance <= 2) {
      return {
        ...point,
        frequency: null,
        midi: null,
        voiced: false,
      };
    }

    return point;
  });
}

function medianSmooth(points: PitchPoint[]): PitchPoint[] {
  return points.map((point, index) => {
    if (!point.voiced || point.midi === null) {
      return point;
    }

    const neighborhood = points
      .slice(Math.max(0, index - 2), Math.min(points.length, index + 3))
      .filter((candidate) => candidate.voiced && candidate.midi !== null && Math.abs(candidate.midi - point.midi!) <= MAX_FRAME_JUMP_SEMITONES)
      .map((candidate) => candidate.midi as number)
      .sort((left, right) => left - right);

    if (neighborhood.length < 3) {
      return point;
    }

    const midi = neighborhood[Math.floor(neighborhood.length / 2)];
    return {
      ...point,
      midi,
      frequency: midiToHz(midi),
    };
  });
}

function findPreviousVoiced(points: PitchPoint[], fromIndex: number): PitchPoint | null {
  for (let index = fromIndex - 1; index >= 0; index -= 1) {
    if (points[index].voiced) {
      return points[index];
    }
  }
  return null;
}

function findNextVoiced(points: PitchPoint[], fromIndex: number): PitchPoint | null {
  for (let index = fromIndex + 1; index < points.length; index += 1) {
    if (points[index].voiced) {
      return points[index];
    }
  }
  return null;
}

function parabolicInterpolation(values: Float32Array, tau: number): number {
  const left = values[tau - 1] ?? values[tau];
  const center = values[tau];
  const right = values[tau + 1] ?? values[tau];
  const denominator = left + right - 2 * center;

  if (denominator === 0) {
    return tau;
  }

  return tau + (left - right) / (2 * denominator);
}