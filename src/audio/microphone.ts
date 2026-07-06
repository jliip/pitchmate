import { makePitchPoint, type PitchPoint } from './pitch';

export type MicrophoneSession = {
  analyser: AnalyserNode;
  stream: MediaStream;
  source: MediaStreamAudioSourceNode;
  data: Float32Array<ArrayBuffer>;
  stop: () => void;
};

export async function createMicrophoneSession(audioContext: AudioContext): Promise<MicrophoneSession> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
    },
  });

  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 4096;
  analyser.smoothingTimeConstant = 0;
  const source = audioContext.createMediaStreamSource(stream);
  source.connect(analyser);
  const data = new Float32Array(analyser.fftSize);

  return {
    analyser,
    stream,
    source,
    data,
    stop: () => {
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
    },
  };
}

export function readMicrophonePitch(session: MicrophoneSession, time: number, minRms: number): PitchPoint {
  session.analyser.getFloatTimeDomainData(session.data);
  return makePitchPoint(time, session.data, session.analyser.context.sampleRate, minRms);
}