import { makePitchPoint, smoothPitchTrack, type PitchPoint } from './pitch';

export type ReferenceAnalysis = {
  buffer: AudioBuffer;
  points: PitchPoint[];
  duration: number;
  voicedRatio: number;
};

export type AnalysisProgress = {
  phase: 'decode' | 'scan' | 'smooth';
  percent: number;
  voicedPoints: number;
  totalFrames: number;
};

const WINDOW_SIZE = 4096;
const HOP_SIZE = 1024;
const FRAMES_PER_BATCH = 120;

export async function decodeAudioFile(file: File, audioContext: AudioContext): Promise<AudioBuffer> {
  const arrayBuffer = await file.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

export async function analyzeReferenceBuffer(buffer: AudioBuffer, onProgress?: (progress: AnalysisProgress) => void): Promise<ReferenceAnalysis> {
  const mono = downmixToMono(buffer);
  const points: PitchPoint[] = [];
  const totalFrames = Math.max(0, Math.floor((mono.length - WINDOW_SIZE) / HOP_SIZE) + 1);
  let voicedPoints = 0;

  onProgress?.({ phase: 'scan', percent: 0, voicedPoints, totalFrames });

  for (let start = 0, frameIndex = 0; start + WINDOW_SIZE <= mono.length; start += HOP_SIZE, frameIndex += 1) {
    const frame = mono.slice(start, start + WINDOW_SIZE);
    const point = makePitchPoint((start + WINDOW_SIZE / 2) / buffer.sampleRate, frame, buffer.sampleRate);
    points.push(point);
    if (point.voiced) {
      voicedPoints += 1;
    }

    if (frameIndex % FRAMES_PER_BATCH === 0) {
      onProgress?.({
        phase: 'scan',
        percent: totalFrames === 0 ? 0 : Math.round((frameIndex / totalFrames) * 92),
        voicedPoints,
        totalFrames,
      });
      await yieldToBrowser();
    }
  }

  onProgress?.({ phase: 'smooth', percent: 94, voicedPoints, totalFrames });
  await yieldToBrowser();
  const smoothed = smoothPitchTrack(points);
  const voicedCount = smoothed.filter((point) => point.voiced).length;
  onProgress?.({ phase: 'smooth', percent: 100, voicedPoints: voicedCount, totalFrames });

  return {
    buffer,
    points: smoothed,
    duration: buffer.duration,
    voicedRatio: smoothed.length === 0 ? 0 : voicedCount / smoothed.length,
  };
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

export function findPitchAtTime(points: PitchPoint[], time: number): PitchPoint | null {
  if (points.length === 0) {
    return null;
  }

  let low = 0;
  let high = points.length - 1;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (points[middle].time < time) {
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  const current = points[Math.min(low, points.length - 1)];
  const previous = points[Math.max(0, low - 1)];
  return Math.abs(current.time - time) < Math.abs(previous.time - time) ? current : previous;
}

function downmixToMono(buffer: AudioBuffer): Float32Array {
  const mono = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      mono[index] += data[index] / buffer.numberOfChannels;
    }
  }
  return mono;
}