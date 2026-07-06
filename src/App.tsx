import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AudioLines, Mic, Pause, Play, RotateCcw, Upload } from 'lucide-react';
import { comparePitch, type PitchMatch } from './audio/compare';
import { createMicrophoneSession, readMicrophonePitch, type MicrophoneSession } from './audio/microphone';
import { formatNote, midiToHz, type PitchPoint } from './audio/pitch';
import { analyzeReferenceBuffer, decodeAudioFile, findPitchAtTime, type AnalysisProgress, type ReferenceAnalysis } from './audio/referenceTrack';
import PitchCanvas from './components/PitchCanvas';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

const MAX_LIVE_POINTS = 900;
const TARGET_NOTE_HOLD_SECONDS = 0.32;
const TARGET_NOTE_CONFIRM_SECONDS = 0.08;
const IMMEDIATE_NOTE_JUMP_SEMITONES = 2;

export default function App() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const micSessionRef = useRef<MicrophoneSession | null>(null);
  const animationRef = useRef<number | null>(null);
  const playStartedAtRef = useRef(0);
  const playOffsetRef = useRef(0);
  const displayedTargetRef = useRef<PitchPoint | null>(null);
  const displayedNoteRef = useRef<number | null>(null);
  const displayedSinceRef = useRef(0);
  const candidateNoteRef = useRef<number | null>(null);
  const candidateSinceRef = useRef(0);

  const [reference, setReference] = useState<ReferenceAnalysis | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [status, setStatus] = useState('上传人声清晰的音频');
  const [isPlaying, setIsPlaying] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [livePoints, setLivePoints] = useState<PitchPoint[]>([]);
  const [latestMatch, setLatestMatch] = useState<PitchMatch | null>(null);
  const [latencyMs, setLatencyMs] = useState(0);
  const [minRms, setMinRms] = useState(0.012);
  const [analysisProgress, setAnalysisProgress] = useState<AnalysisProgress | null>(null);
  const [showTargetGuide, setShowTargetGuide] = useState(true);
  const [referenceFileName, setReferenceFileName] = useState('');
  const [displayedTarget, setDisplayedTarget] = useState<PitchPoint | null>(null);

  const currentTarget = useMemo(
    () => findPitchAtTime(reference?.points ?? [], Math.max(0, currentTime - latencyMs / 1000)),
    [currentTime, latencyMs, reference?.points],
  );

  useEffect(() => {
    const now = performance.now() / 1000;

    if (!currentTarget?.voiced || currentTarget.midi === null) {
      candidateNoteRef.current = null;
      return;
    }

    const note = Math.round(currentTarget.midi);
    const quantizedTarget = {
      ...currentTarget,
      midi: note,
      frequency: midiToHz(note),
    };

    if (displayedNoteRef.current === null) {
      displayedTargetRef.current = quantizedTarget;
      displayedNoteRef.current = note;
      displayedSinceRef.current = now;
      setDisplayedTarget(quantizedTarget);
      return;
    }

    if (displayedNoteRef.current === note) {
      displayedTargetRef.current = quantizedTarget;
      candidateNoteRef.current = null;
      setDisplayedTarget(quantizedTarget);
      return;
    }

    const noteJump = Math.abs(note - displayedNoteRef.current);
    if (noteJump >= IMMEDIATE_NOTE_JUMP_SEMITONES) {
      displayedTargetRef.current = quantizedTarget;
      displayedNoteRef.current = note;
      displayedSinceRef.current = now;
      candidateNoteRef.current = null;
      setDisplayedTarget(quantizedTarget);
      return;
    }

    if (candidateNoteRef.current !== note) {
      candidateNoteRef.current = note;
      candidateSinceRef.current = now;
    }

    const displayHeldLongEnough = now - displayedSinceRef.current >= TARGET_NOTE_HOLD_SECONDS;
    const candidateConfirmed = now - candidateSinceRef.current >= TARGET_NOTE_CONFIRM_SECONDS;
    if (displayHeldLongEnough && candidateConfirmed) {
      displayedTargetRef.current = quantizedTarget;
      displayedNoteRef.current = note;
      displayedSinceRef.current = now;
      candidateNoteRef.current = null;
      setDisplayedTarget(quantizedTarget);
    }
  }, [currentTarget]);

  useEffect(() => {
    return () => {
      stopPlayback();
      stopMicrophone();
      audioContextRef.current?.close();
    };
  }, []);

  useEffect(() => {
    if (!micEnabled && !isPlaying) {
      return;
    }

    const tick = () => {
      const audioContext = audioContextRef.current;
      const referenceTrack = reference;
      const playbackTime = isPlaying && audioContext ? Math.min(referenceTrack?.duration ?? 0, audioContext.currentTime - playStartedAtRef.current + playOffsetRef.current) : currentTime;
      setCurrentTime(playbackTime);

      if (micEnabled && micSessionRef.current) {
        const micPoint = readMicrophonePitch(micSessionRef.current, playbackTime, minRms);
        setLivePoints((points) => [...points.slice(-MAX_LIVE_POINTS + 1), micPoint]);

        const target = findPitchAtTime(referenceTrack?.points ?? [], Math.max(0, playbackTime - latencyMs / 1000));
        const match = comparePitch(target, micPoint);
        setLatestMatch(match);
      }

      animationRef.current = requestAnimationFrame(tick);
    };

    animationRef.current = requestAnimationFrame(tick);
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [currentTime, isPlaying, latencyMs, micEnabled, minRms, reference]);

  async function getAudioContext(): Promise<AudioContext> {
    const existing = audioContextRef.current;
    if (existing) {
      if (existing.state === 'suspended') {
        await existing.resume();
      }
      return existing;
    }

    const audioContext = new AudioContext();
    audioContextRef.current = audioContext;
    return audioContext;
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setReferenceFileName(file.name);
    setLoadState('loading');
    setAnalysisProgress({ phase: 'decode', percent: 0, voicedPoints: 0, totalFrames: 0 });
    setStatus('正在读取音频文件...');
    stopPlayback();
    setCurrentTime(0);
    setLivePoints([]);
    setLatestMatch(null);
    setDisplayedTarget(null);
    displayedTargetRef.current = null;
    displayedNoteRef.current = null;
    candidateNoteRef.current = null;

    try {
      const audioContext = await getAudioContext();
      const buffer = await decodeAudioFile(file, audioContext);
      setStatus('解码完成，开始扫描音高...');
      const analysis = await analyzeReferenceBuffer(buffer, (progress) => {
        setAnalysisProgress(progress);
        setStatus(progressLabel(progress));
      });
      setReference(analysis);
      setLoadState('ready');
      setAnalysisProgress(null);
      setStatus(analysis.voicedRatio > 0.05 ? `已提取 ${analysis.points.filter((point) => point.voiced).length} 个有声音高点` : '音高点很少，建议换一段更清晰的人声音频');
    } catch (error) {
      console.error(error);
      setLoadState('error');
      setAnalysisProgress(null);
      setStatus('无法解析这个音频文件，请换成浏览器支持的 mp3/wav/m4a');
    }
  }

  async function togglePlayback() {
    if (!reference) {
      setStatus('先上传参考音频');
      return;
    }

    if (isPlaying) {
      pausePlayback();
      return;
    }

    const audioContext = await getAudioContext();
    const source = audioContext.createBufferSource();
    source.buffer = reference.buffer;
    source.connect(audioContext.destination);
    source.onended = () => {
      if (sourceRef.current !== source) {
        return;
      }
      setIsPlaying(false);
      setCurrentTime(reference.duration);
      playOffsetRef.current = 0;
      sourceRef.current = null;
    };

    const offset = currentTime >= reference.duration ? 0 : currentTime;
    playOffsetRef.current = offset;
    playStartedAtRef.current = audioContext.currentTime;
    sourceRef.current = source;
    source.start(0, offset);
    setIsPlaying(true);
    setStatus('播放中');
  }

  async function toggleMicrophone() {
    if (micEnabled) {
      stopMicrophone();
      setMicEnabled(false);
      setStatus('麦克风已关闭');
      return;
    }

    try {
      const audioContext = await getAudioContext();
      const session = await createMicrophoneSession(audioContext);
      micSessionRef.current = session;
      setMicEnabled(true);
      setStatus('麦克风已开启，建议戴耳机避免串音');
    } catch (error) {
      console.error(error);
      setStatus('无法打开麦克风，请检查浏览器权限');
    }
  }

  function pausePlayback() {
    const audioContext = audioContextRef.current;
    if (audioContext) {
      playOffsetRef.current = Math.min(reference?.duration ?? 0, audioContext.currentTime - playStartedAtRef.current + playOffsetRef.current);
      setCurrentTime(playOffsetRef.current);
    }
    stopPlayback();
  }

  function stopPlayback() {
    const source = sourceRef.current;
    if (source) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    sourceRef.current = null;
    setIsPlaying(false);
  }

  function stopMicrophone() {
    micSessionRef.current?.stop();
    micSessionRef.current = null;
  }

  function restartPractice() {
    stopPlayback();
    playOffsetRef.current = 0;
    setCurrentTime(0);
    setLivePoints([]);
    setLatestMatch(null);
    setDisplayedTarget(null);
    displayedTargetRef.current = null;
    displayedNoteRef.current = null;
    candidateNoteRef.current = null;
  }

  const targetLabel = displayedTarget?.midi ? formatNote(displayedTarget.midi) : '--';
  const actualLabel = latestMatch?.actual.midi ? formatNote(latestMatch.actual.midi) : '--';
  const deviationLabel = latestMatch ? `${latestMatch.cents > 0 ? '+' : ''}${Math.round(latestMatch.cents)} cents` : '--';

  return (
    <main className="app-shell">
      <section className="workspace">
        <aside className="control-panel">
          <div className="brand-block">
            <div className="mark"><AudioLines size={24} /></div>
            <div>
              <p className="eyebrow">PitchMate</p>
              <h1>音准练唱台</h1>
            </div>
          </div>

          <label className="upload-zone">
            <Upload size={22} />
            <span className="upload-copy">
              <strong>上传参考音频</strong>
              <small>{referenceFileName || 'mp3 / wav / m4a，人声越清晰越好'}</small>
            </span>
            <span className="upload-action">点击选择</span>
            <input type="file" accept="audio/*" onChange={handleFileChange} />
          </label>

          <div className="status-card" data-state={loadState}>
            <span className="status-indicator" aria-hidden="true" />
            <div className="status-content">
              <span>{status}</span>
              {analysisProgress ? (
                <div className="analysis-progress" aria-label="音频分析进度">
                  <div style={{ width: `${analysisProgress.percent}%` }} />
                </div>
              ) : null}
            </div>
          </div>

          <div className="range-group">
            <label>
              延迟校正 <span>{latencyMs}ms</span>
            </label>
            <input type="range" min="-250" max="250" step="10" value={latencyMs} onChange={(event) => setLatencyMs(Number(event.target.value))} />
          </div>

          <div className="range-group">
            <label>
              麦克风门限 <span>{minRms.toFixed(3)}</span>
            </label>
            <input type="range" min="0.004" max="0.05" step="0.002" value={minRms} onChange={(event) => setMinRms(Number(event.target.value))} />
          </div>

          <label className="toggle-row">
            <span>目标高亮线</span>
            <input type="checkbox" checked={showTargetGuide} onChange={(event) => setShowTargetGuide(event.target.checked)} />
          </label>

          <div className="side-metrics">
            <Metric label="目标" value={targetLabel} />
            <Metric label="你唱的" value={actualLabel} />
            <Metric label="偏差" value={deviationLabel} accent={latestMatch?.band ?? 'idle'} />
          </div>
        </aside>

        <section className="trainer-panel">
          <PitchCanvas reference={reference?.points ?? []} live={livePoints} target={displayedTarget} showTargetGuide={showTargetGuide} currentTime={currentTime} duration={reference?.duration ?? 0} match={latestMatch} />

          <div className="timeline-row">
            <span>{formatTime(currentTime)}</span>
            <input
              type="range"
              min="0"
              max={reference?.duration ?? 0}
              step="0.01"
              value={currentTime}
              disabled={!reference}
              onChange={(event) => {
                const time = Number(event.target.value);
                pausePlayback();
                playOffsetRef.current = time;
                setCurrentTime(time);
              }}
            />
            <span>{formatTime(reference?.duration ?? 0)}</span>
          </div>

          <div className="transport-row">
            <div className="round-controls">
              <button className="round-button main" onClick={togglePlayback} disabled={!reference || loadState === 'loading'} aria-label={isPlaying ? '暂停' : '播放'}>
                {isPlaying ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button className="round-button" onClick={restartPractice} aria-label="重新开始">
                <RotateCcw size={18} />
              </button>
            </div>

            <button className={micEnabled ? 'mic-button active' : 'mic-button'} onClick={toggleMicrophone}>
              <Mic size={18} />
              {micEnabled ? '关闭麦克风' : '开启麦克风'}
            </button>
          </div>
        </section>
      </section>
    </main>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="metric" data-accent={accent ?? 'idle'}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function formatTime(seconds: number): string {
  const safeSeconds = Math.max(0, seconds);
  const minutes = Math.floor(safeSeconds / 60);
  const rest = Math.floor(safeSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${rest}`;
}

function progressLabel(progress: AnalysisProgress): string {
  if (progress.phase === 'decode') {
    return '正在读取音频文件...';
  }
  if (progress.phase === 'smooth') {
    return `正在平滑音高轨迹 ${progress.percent}%`;
  }
  return `正在识别音高 ${progress.percent}%\n已找到 ${progress.voicedPoints} 个音高点`;
}

