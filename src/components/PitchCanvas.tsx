import { useEffect, useRef } from 'react';
import { formatNote, type PitchPoint } from '../audio/pitch';
import type { PitchMatch } from '../audio/compare';

type Props = {
  reference: PitchPoint[];
  live: PitchPoint[];
  target: PitchPoint | null;
  showTargetGuide: boolean;
  currentTime: number;
  duration: number;
  match: PitchMatch | null;
};

const WINDOW_SECONDS = 12;
const FIXED_MIN_MIDI = 43;
const FIXED_MAX_MIDI = 84;
const MAX_DRAWN_JUMP_SEMITONES = 7;
const NOTE_GUTTER_WIDTH = 64;

export default function PitchCanvas({ reference, live, target, showTargetGuide, currentTime, duration, match }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPitchMap(context, rect.width, rect.height, reference, live, target, showTargetGuide, currentTime, duration, match);
  }, [reference, live, target, showTargetGuide, currentTime, duration, match]);

  return <canvas ref={canvasRef} className="pitch-canvas" aria-label="音高轨迹图" />;
}

function drawPitchMap(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  reference: PitchPoint[],
  live: PitchPoint[],
  target: PitchPoint | null,
  showTargetGuide: boolean,
  currentTime: number,
  duration: number,
  match: PitchMatch | null,
) {
  context.clearRect(0, 0, width, height);
  const gradient = context.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, '#f6efe2');
  gradient.addColorStop(0.55, '#eef3e8');
  gradient.addColorStop(1, '#e4edf3');
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  const timeStart = Math.max(0, currentTime - WINDOW_SECONDS * 0.35);
  const timeEnd = Math.min(Math.max(duration, WINDOW_SECONDS), timeStart + WINDOW_SECONDS);
  const minMidi = FIXED_MIN_MIDI;
  const maxMidi = FIXED_MAX_MIDI;
  const plotLeft = NOTE_GUTTER_WIDTH;
  const plotWidth = Math.max(1, width - plotLeft);

  const cursorX = xForTime(currentTime, timeStart, timeEnd, plotLeft, plotWidth);

  drawGrid(context, width, height, plotLeft, minMidi, maxMidi);
  if (showTargetGuide) {
    drawTargetGuide(context, width, height, plotLeft, minMidi, maxMidi, target);
  }
  drawLine(context, reference, timeStart, timeEnd, minMidi, maxMidi, plotLeft, plotWidth, height, '#2f6f73', 3);
  drawLine(context, live, timeStart, timeEnd, minMidi, maxMidi, plotLeft, plotWidth, height, matchColor(match), 4);

  context.strokeStyle = '#20201d';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(cursorX, 0);
  context.lineTo(cursorX, height);
  context.stroke();

  if (showTargetGuide) {
    drawTargetBadge(context, width, height, plotLeft, minMidi, maxMidi, cursorX, target);
  }

}

function drawGrid(context: CanvasRenderingContext2D, width: number, height: number, plotLeft: number, minMidi: number, maxMidi: number) {
  context.fillStyle = 'rgba(255, 250, 240, 0.62)';
  context.fillRect(0, 0, plotLeft, height);
  context.strokeStyle = 'rgba(42, 39, 33, 0.2)';
  context.beginPath();
  context.moveTo(plotLeft, 0);
  context.lineTo(plotLeft, height);
  context.stroke();

  context.strokeStyle = 'rgba(42, 39, 33, 0.12)';
  context.lineWidth = 1;
  context.font = '600 13px Georgia, serif';
  context.textBaseline = 'middle';

  for (let midi = minMidi; midi <= maxMidi; midi += 1) {
    const y = yForMidi(midi, minMidi, maxMidi, height);
    const isOctave = Math.round(midi) % 12 === 0;
    const isSharp = formatNote(midi).includes('#');
    context.strokeStyle = isOctave ? 'rgba(42, 39, 33, 0.22)' : 'rgba(42, 39, 33, 0.1)';
    context.beginPath();
    context.moveTo(plotLeft, y);
    context.lineTo(width, y);
    context.stroke();

    context.fillStyle = isSharp ? 'rgba(42, 39, 33, 0.42)' : 'rgba(42, 39, 33, 0.72)';
    context.fillText(formatNote(midi), 12, y);
  }
}

function drawTargetGuide(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  plotLeft: number,
  minMidi: number,
  maxMidi: number,
  target: PitchPoint | null,
) {
  if (!target?.voiced || target.midi === null) {
    return;
  }

  const noteMidi = Math.round(target.midi);
  const y = yForMidi(noteMidi, minMidi, maxMidi, height);
  context.fillStyle = 'rgba(47, 111, 115, 0.1)';
  context.fillRect(plotLeft, y - 9, width - plotLeft, 18);
  context.strokeStyle = 'rgba(47, 111, 115, 0.64)';
  context.lineWidth = 2;
  context.beginPath();
  context.moveTo(plotLeft, y);
  context.lineTo(width, y);
  context.stroke();

}

function drawTargetBadge(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  plotLeft: number,
  minMidi: number,
  maxMidi: number,
  cursorX: number,
  target: PitchPoint | null,
) {
  if (!target?.voiced || target.midi === null) {
    return;
  }

  const noteMidi = Math.round(target.midi);
  const y = yForMidi(noteMidi, minMidi, maxMidi, height);
  const label = formatNote(noteMidi);
  const labelWidth = 62;
  const labelHeight = 34;
  const labelX = Math.min(width - labelWidth - 8, Math.max(plotLeft + 8, cursorX - labelWidth / 2));
  const labelY = Math.min(height - labelHeight - 8, Math.max(8, y - labelHeight / 2));

  context.fillStyle = '#2f6f73';
  roundRect(context, labelX, labelY, labelWidth, labelHeight, 8);
  context.fill();
  context.fillStyle = '#fffaf0';
  context.font = '800 17px Georgia, serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(label, labelX + labelWidth / 2, labelY + labelHeight / 2);
  context.textAlign = 'start';
}

function drawLine(
  context: CanvasRenderingContext2D,
  points: PitchPoint[],
  timeStart: number,
  timeEnd: number,
  minMidi: number,
  maxMidi: number,
  plotLeft: number,
  plotWidth: number,
  height: number,
  color: string,
  lineWidth: number,
) {
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  let drawing = false;
  let previousMidi: number | null = null;

  context.beginPath();
  for (const point of points) {
    if (!point.voiced || point.midi === null || point.time < timeStart || point.time > timeEnd) {
      drawing = false;
      previousMidi = null;
      continue;
    }

    const x = xForTime(point.time, timeStart, timeEnd, plotLeft, plotWidth);
    const y = yForMidi(point.midi, minMidi, maxMidi, height);
    if (!drawing || previousMidi === null) {
      context.moveTo(x, y);
      drawing = true;
    } else if (Math.abs(point.midi - previousMidi) <= MAX_DRAWN_JUMP_SEMITONES) {
      context.lineTo(x, y);
    } else {
      context.moveTo(x, y);
    }
    previousMidi = point.midi;
  }
  context.stroke();
}

function xForTime(time: number, timeStart: number, timeEnd: number, plotLeft: number, plotWidth: number): number {
  return plotLeft + ((time - timeStart) / Math.max(0.1, timeEnd - timeStart)) * plotWidth;
}

function yForMidi(midi: number, minMidi: number, maxMidi: number, height: number): number {
  const normalized = (midi - minMidi) / Math.max(1, maxMidi - minMidi);
  return height - Math.min(1, Math.max(0, normalized)) * height;
}

function matchColor(match: PitchMatch | null): string {
  if (!match) {
    return '#8d6b48';
  }
  if (match.band === 'hit') {
    return '#2d8b57';
  }
  if (match.band === 'close') {
    return '#c88424';
  }
  return '#c74b3f';
}

function roundRect(context: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + radius);
  context.lineTo(x + width, y + height - radius);
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  context.lineTo(x + radius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - radius);
  context.lineTo(x, y + radius);
  context.quadraticCurveTo(x, y, x + radius, y);
}