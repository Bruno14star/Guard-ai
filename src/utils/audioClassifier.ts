import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';

const YAMNET_MODEL_URL = 'https://tfhub.dev/google/tfjs-model/yamnet/tfjs/1';

// Relevant AudioSet class indices used by YAMNet (521 classes):
// 0: Speech, 427: Gunshot/gunfire, 428: Machine gun, 429: Fusillade, 430: Artillery fire, 432: Explosion, 436: Firecracker
const GUNSHOT_CLASS_INDICES = [427, 428, 429, 430, 432];
const SAFE_AMBIENT_LABELS: Record<number, string> = {
  0: 'Talking',
  300: 'Vehicle',
  348: 'Engine / Generator',
  354: 'Door Slam',
  436: 'Firecracker / Tyre Burst',
};

let cachedYamnet: tf.GraphModel | null = null;
let yamnetLoadPromise: Promise<tf.GraphModel | null> | null = null;
let cachedCoco: cocoSsd.ObjectDetection | null = null;
let cocoLoadPromise: Promise<cocoSsd.ObjectDetection | null> | null = null;

export async function loadYamnetModel(): Promise<tf.GraphModel | null> {
  if (cachedYamnet) return cachedYamnet;
  if (yamnetLoadPromise) return yamnetLoadPromise;
  yamnetLoadPromise = tf
    .loadGraphModel(YAMNET_MODEL_URL, { fromTFHub: true })
    .then((model) => {
      cachedYamnet = model;
      return model;
    })
    .catch((err) => {
      console.warn('YAMNet TFHub model unavailable offline, using acoustic DSP classifier:', err);
      return null;
    });
  return yamnetLoadPromise;
}

export async function loadCocoSsdModel(): Promise<cocoSsd.ObjectDetection | null> {
  if (cachedCoco) return cachedCoco;
  if (cocoLoadPromise) return cocoLoadPromise;
  cocoLoadPromise = cocoSsd
    .load()
    .then((model) => {
      cachedCoco = model;
      return model;
    })
    .catch((err) => {
      console.warn('COCO-SSD load fallback:', err);
      return null;
    });
  return cocoLoadPromise;
}

export interface AudioAnalysisFrame {
  splDb: number;
  peakAmplitude: number;
  riseTimeMs: number;
  decayMs: number;
  midHighRatio: number;
  gunshotConfidence: number; // 0..1 probabilistic
  detectedClass: string;
  isGunshot: boolean;
  usedYamnet: boolean;
}

/**
 * Analyze a 1-second mono PCM window + frequency spectrum with YAMNet + Acoustic Impulse Physics
 */
export async function analyzeAudioWindow(
  waveform16k: Float32Array,
  sampleRate: number,
  freqData: Uint8Array,
  yamnetModel: tf.GraphModel | null
): Promise<AudioAnalysisFrame> {
  // 1. Real Acoustic Physics (Peak SPL, Rise Time, Decay, 1000-4000Hz energy ratio)
  let peak = 0;
  let peakIdx = 0;
  let sumSq = 0;
  for (let i = 0; i < waveform16k.length; i++) {
    const abs = Math.abs(waveform16k[i]);
    sumSq += waveform16k[i] * waveform16k[i];
    if (abs > peak) {
      peak = abs;
      peakIdx = i;
    }
  }
  const rms = Math.sqrt(sumSq / Math.max(1, waveform16k.length));
  // Reference normalized mic level to approximate SPL (calibrated conservatively)
  const splDb = Math.max(30, Math.min(130, 94 + 20 * Math.log10(Math.max(rms, peak * 0.35, 1e-5))));

  // Measure rise time before peak (threshold 15% of peak)
  let riseSamples = 0;
  for (let i = peakIdx; i >= 0 && i > peakIdx - sampleRate * 0.05; i--) {
    if (Math.abs(waveform16k[i]) < peak * 0.15) {
      riseSamples = peakIdx - i;
      break;
    }
  }
  const riseTimeMs = (riseSamples / sampleRate) * 1000;

  // Measure decay time after peak (drop to 20% of peak)
  let decaySamples = sampleRate * 0.25;
  for (let i = peakIdx; i < waveform16k.length && i < peakIdx + sampleRate * 0.4; i++) {
    if (Math.abs(waveform16k[i]) < peak * 0.2) {
      decaySamples = i - peakIdx;
      break;
    }
  }
  const decayMs = (decaySamples / sampleRate) * 1000;

  // 1000-4000 Hz spectral energy ratio
  const binHz = sampleRate / (freqData.length * 2);
  let bandEnergy = 0;
  let totalEnergy = 0;
  for (let i = 0; i < freqData.length; i++) {
    const hz = i * binHz;
    const val = freqData[i];
    totalEnergy += val;
    if (hz >= 1000 && hz <= 4000) bandEnergy += val;
  }
  const midHighRatio = totalEnergy > 0 ? bandEnergy / totalEnergy : 0;

  // 2. Run YAMNet inference if loaded
  let yamnetGunshotScore = 0;
  let yamnetLabel = 'Ambient';
  let usedYamnet = false;

  if (yamnetModel && waveform16k.length >= 15600) {
    try {
      const slice = waveform16k.slice(0, 15600);
      const inputTensor = tf.tensor1d(slice);
      const outputs = yamnetModel.execute(inputTensor) as tf.Tensor | tf.Tensor[];
      const scoresTensor = Array.isArray(outputs) ? outputs[0] : outputs;
      const scoresData = await scoresTensor.data();
      inputTensor.dispose();
      if (Array.isArray(outputs)) outputs.forEach((t) => t.dispose());
      else outputs.dispose();

      usedYamnet = true;
      // Average across frames (each frame has 521 scores)
      const numClasses = 521;
      const numFrames = Math.floor(scoresData.length / numClasses);
      if (numFrames > 0) {
        let maxClass = 0;
        let maxVal = 0;
        for (let c = 0; c < numClasses; c++) {
          let sum = 0;
          for (let f = 0; f < numFrames; f++) {
            sum += scoresData[f * numClasses + c];
          }
          const avg = sum / numFrames;
          if (GUNSHOT_CLASS_INDICES.includes(c)) {
            yamnetGunshotScore = Math.max(yamnetGunshotScore, avg);
          }
          if (avg > maxVal) {
            maxVal = avg;
            maxClass = c;
          }
        }
        yamnetLabel = SAFE_AMBIENT_LABELS[maxClass] || (GUNSHOT_CLASS_INDICES.includes(maxClass) ? 'Gunshot Impulse' : 'Ambient');
      }
    } catch {
      usedYamnet = false;
    }
  }

  // Acoustic impulse score (Strict physics: Peak > 90dB, rise < 5ms, decay < 200ms, 1-4kHz energy)
  let acousticScore = 0;
  if (splDb > 90 && peak > 0.45) {
    acousticScore += 0.4;
    if (riseTimeMs > 0 && riseTimeMs < 5) acousticScore += 0.25;
    if (decayMs < 200) acousticScore += 0.2;
    if (midHighRatio > 0.3) acousticScore += 0.15;
  }

  const combinedConfidence = usedYamnet
    ? Math.max(yamnetGunshotScore, 0.6 * yamnetGunshotScore + 0.4 * acousticScore)
    : acousticScore;

  const clampedConfidence = Math.min(0.95, Math.max(0, combinedConfidence));
  const isGunshot = clampedConfidence > 0.75 && splDb > 90;

  return {
    splDb: Math.round(splDb),
    peakAmplitude: Number(peak.toFixed(3)),
    riseTimeMs: Number(riseTimeMs.toFixed(1)),
    decayMs: Number(decayMs.toFixed(1)),
    midHighRatio: Number(midHighRatio.toFixed(2)),
    gunshotConfidence: Number(clampedConfidence.toFixed(2)),
    detectedClass: isGunshot ? 'Possible Gunshot' : yamnetLabel,
    isGunshot,
    usedYamnet,
  };
}

/**
 * Continuous loud Web Audio siren for Night Watch / Family SOS (stops ONLY when user calls stop())
 */
export class ContinuousAlarmController {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private intervalId: number | null = null;
  public active = false;

  start() {
    if (this.active) return;
    this.active = true;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.osc = this.ctx.createOscillator();
      this.gain = this.ctx.createGain();
      this.osc.type = 'sawtooth';
      this.osc.frequency.value = 880;
      this.gain.gain.value = 0.85;
      this.osc.connect(this.gain);
      this.gain.connect(this.ctx.destination);
      this.osc.start();

      let high = true;
      this.intervalId = window.setInterval(() => {
        if (this.osc && this.ctx) {
          high = !high;
          this.osc.frequency.setValueAtTime(high ? 1120 : 660, this.ctx.currentTime);
        }
        if (navigator.vibrate) {
          navigator.vibrate([400, 150, 400]);
        }
      }, 450);
    } catch (err) {
      console.warn('Alarm audio blocked:', err);
    }
  }

  stop() {
    this.active = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    try {
      this.osc?.stop();
      this.osc?.disconnect();
      this.gain?.disconnect();
      this.ctx?.close();
    } catch {
      // ignore cleanup errors
    }
    this.osc = null;
    this.gain = null;
    this.ctx = null;
    if (navigator.vibrate) {
      navigator.vibrate(0);
    }
  }
}
