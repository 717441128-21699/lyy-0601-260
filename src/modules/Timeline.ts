import { GameState } from '../types';

export type TimelineCallback = (currentTime: number, deltaTime: number) => void;

export class Timeline {
  private state: GameState = GameState.IDLE;
  private startTime: number = 0;
  private pausedTime: number = 0;
  private accumulatedPauseTime: number = 0;
  private latency: number = 0;
  private chartOffset: number = 0;
  private lastFrameTime: number = 0;
  private speed: number = 1.0;
  private duration: number = Infinity;

  private rafId: number | null = null;
  private callbacks: Set<TimelineCallback> = new Set();
  private onStateChange: ((state: GameState, prev: GameState) => void) | null = null;

  constructor() {
    this.tick = this.tick.bind(this);
  }

  setLatency(latency: number): void {
    this.latency = latency;
  }

  setChartOffset(offset: number): void {
    this.chartOffset = offset;
  }

  setSpeed(speed: number): void {
    this.speed = Math.max(0.1, Math.min(5.0, speed));
  }

  setDuration(duration: number): void {
    this.duration = duration;
  }

  getSpeed(): number {
    return this.speed;
  }

  getLatency(): number {
    return this.latency;
  }

  getState(): GameState {
    return this.state;
  }

  getCurrentTime(): number {
    if (this.state === GameState.IDLE) return 0;
    if (this.state === GameState.PAUSED) {
      return (this.pausedTime - this.startTime - this.accumulatedPauseTime) * this.speed
        - this.latency - this.chartOffset;
    }
    const now = performance.now();
    return (now - this.startTime - this.accumulatedPauseTime) * this.speed
      - this.latency - this.chartOffset;
  }

  getRawTime(): number {
    return this.getCurrentTime() + this.latency + this.chartOffset;
  }

  setOnStateChange(cb: (state: GameState, prev: GameState) => void): void {
    this.onStateChange = cb;
  }

  private changeState(newState: GameState): void {
    if (this.state === newState) return;
    const prev = this.state;
    this.state = newState;
    if (this.onStateChange) {
      this.onStateChange(newState, prev);
    }
  }

  start(): void {
    if (this.state === GameState.PLAYING) return;
    const now = performance.now();
    if (this.state === GameState.PAUSED) {
      this.accumulatedPauseTime += now - this.pausedTime;
    } else {
      this.startTime = now;
      this.accumulatedPauseTime = 0;
    }
    this.lastFrameTime = now;
    this.changeState(GameState.PLAYING);
    this.startLoop();
  }

  pause(): void {
    if (this.state !== GameState.PLAYING) return;
    this.pausedTime = performance.now();
    this.stopLoop();
    this.changeState(GameState.PAUSED);
  }

  resume(): void {
    if (this.state !== GameState.PAUSED) return;
    this.start();
  }

  stop(): void {
    this.stopLoop();
    this.changeState(GameState.FINISHED);
  }

  reset(): void {
    this.stopLoop();
    this.state = GameState.IDLE;
    this.startTime = 0;
    this.pausedTime = 0;
    this.accumulatedPauseTime = 0;
    this.lastFrameTime = 0;
  }

  seek(targetTime: number): void {
    const effectiveTarget = targetTime + this.latency + this.chartOffset;
    const now = performance.now();
    this.startTime = now - (effectiveTarget / this.speed) - this.accumulatedPauseTime;
    this.lastFrameTime = now;
  }

  addCallback(cb: TimelineCallback): () => void {
    this.callbacks.add(cb);
    return () => this.callbacks.delete(cb);
  }

  removeCallback(cb: TimelineCallback): void {
    this.callbacks.delete(cb);
  }

  private startLoop(): void {
    if (this.rafId !== null) return;
    this.rafId = requestAnimationFrame(this.tick);
  }

  private stopLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private tick(now: number): void {
    if (this.state !== GameState.PLAYING) return;
    const deltaTime = (now - this.lastFrameTime) * this.speed;
    this.lastFrameTime = now;
    const currentTime = this.getCurrentTime();
    this.callbacks.forEach(cb => {
      try {
        cb(currentTime, deltaTime);
      } catch (e) {
        console.error('Timeline callback error:', e);
      }
    });
    if (currentTime >= this.duration) {
      this.stop();
      return;
    }
    this.rafId = requestAnimationFrame(this.tick);
  }

  destroy(): void {
    this.stopLoop();
    this.callbacks.clear();
    this.onStateChange = null;
  }
}
