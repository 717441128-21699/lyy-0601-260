import { InputEvent, Point } from '../types';

export type InputListener = (event: InputEvent) => void;

export class InputManager {
  private eventIdCounter: number = 0;
  private inputEvents: InputEvent[] = [];
  private activePointers: Map<number, InputEvent> = new Map();
  private pointerTracks: Map<number, number> = new Map();
  private listeners: Set<InputListener> = new Set();
  private enabled: boolean = true;
  private trackCount: number = 4;
  private trackWidth: number = 100;
  private captureArea: { x: number; y: number; width: number; height: number } | null = null;
  private recording: boolean = true;
  private playbackEvents: InputEvent[] = [];
  private playbackIndex: number = 0;
  private playbackMode: boolean = false;
  private getCurrentTime: () => number = () => performance.now();

  setTrackCount(count: number): void {
    this.trackCount = Math.max(1, count);
  }

  setTrackWidth(width: number): void {
    this.trackWidth = Math.max(1, width);
  }

  setCaptureArea(x: number, y: number, width: number, height: number): void {
    this.captureArea = { x, y, width, height };
  }

  setTimeProvider(provider: () => number): void {
    this.getCurrentTime = provider;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  setRecording(recording: boolean): void {
    this.recording = recording;
  }

  setPlaybackMode(enabled: boolean, events?: InputEvent[]): void {
    this.playbackMode = enabled;
    this.playbackIndex = 0;
    if (events) {
      this.playbackEvents = events;
    }
  }

  addListener(listener: InputListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  removeListener(listener: InputListener): void {
    this.listeners.delete(listener);
  }

  getRecordedEvents(): InputEvent[] {
    return [...this.inputEvents];
  }

  getActivePointerCount(): number {
    return this.activePointers.size;
  }

  getPointerTrack(pointerId: number): number | undefined {
    return this.pointerTracks.get(pointerId);
  }

  clearRecordedEvents(): void {
    this.inputEvents = [];
  }

  xToTrack(x: number): number {
    if (this.captureArea) {
      const relX = x - this.captureArea.x;
      const track = Math.floor((relX / this.captureArea.width) * this.trackCount);
      return Math.max(0, Math.min(this.trackCount - 1, track));
    }
    return Math.max(0, Math.min(this.trackCount - 1, Math.floor(x / this.trackWidth)));
  }

  handleTouchStart(x: number, y: number, pointerId: number = 0): InputEvent | null {
    if (!this.enabled || this.playbackMode) return null;
    const event: InputEvent = {
      id: this.eventIdCounter++,
      type: 'touchstart',
      x,
      y,
      time: this.getCurrentTime(),
      pointerId,
      track: this.xToTrack(x)
    };
    this.processEvent(event);
    return event;
  }

  handleTouchMove(x: number, y: number, pointerId: number = 0): InputEvent | null {
    if (!this.enabled || this.playbackMode) return null;
    if (!this.activePointers.has(pointerId)) return null;
    const event: InputEvent = {
      id: this.eventIdCounter++,
      type: 'touchmove',
      x,
      y,
      time: this.getCurrentTime(),
      pointerId,
      track: this.xToTrack(x)
    };
    this.processEvent(event);
    return event;
  }

  handleTouchEnd(x: number, y: number, pointerId: number = 0): InputEvent | null {
    if (!this.enabled || this.playbackMode) return null;
    if (!this.activePointers.has(pointerId)) return null;
    const event: InputEvent = {
      id: this.eventIdCounter++,
      type: 'touchend',
      x,
      y,
      time: this.getCurrentTime(),
      pointerId,
      track: this.xToTrack(x)
    };
    this.processEvent(event);
    return event;
  }

  handleTouchCancel(pointerId: number = 0): InputEvent | null {
    if (!this.activePointers.has(pointerId)) return null;
    const lastEvent = this.activePointers.get(pointerId)!;
    return this.handleTouchEnd(lastEvent.x, lastEvent.y, pointerId);
  }

  getActivePointers(): Map<number, InputEvent> {
    return new Map(this.activePointers);
  }

  getPointerTrajectory(pointerId: number): Point[] {
    return this.inputEvents
      .filter(e => e.pointerId === pointerId)
      .map(e => ({ x: e.x, y: e.y, time: e.time }));
  }

  updatePlayback(currentTime: number): void {
    if (!this.playbackMode) return;
    while (
      this.playbackIndex < this.playbackEvents.length &&
      this.playbackEvents[this.playbackIndex].time <= currentTime
    ) {
      const event = { ...this.playbackEvents[this.playbackIndex] };
      this.processEvent(event);
      this.playbackIndex++;
    }
  }

  private processEvent(event: InputEvent): void {
    if (event.type === 'touchstart') {
      this.activePointers.set(event.pointerId, event);
      if (event.track !== undefined) {
        this.pointerTracks.set(event.pointerId, event.track);
      }
    } else if (event.type === 'touchmove') {
      this.activePointers.set(event.pointerId, event);
      if (event.track !== undefined) {
        this.pointerTracks.set(event.pointerId, event.track);
      }
    } else if (event.type === 'touchend') {
      this.activePointers.delete(event.pointerId);
      this.pointerTracks.delete(event.pointerId);
    }
    if (this.recording) {
      this.inputEvents.push(event);
    }
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (e) {
        console.error('Input listener error:', e);
      }
    });
  }

  bindToElement(element: HTMLElement): () => void {
    const touchStartHandler = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        this.handleTouchStart(touch.clientX, touch.clientY, touch.identifier);
      }
    };
    const touchMoveHandler = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        this.handleTouchMove(touch.clientX, touch.clientY, touch.identifier);
      }
    };
    const touchEndHandler = (e: TouchEvent) => {
      e.preventDefault();
      for (let i = 0; i < e.changedTouches.length; i++) {
        const touch = e.changedTouches[i];
        this.handleTouchEnd(touch.clientX, touch.clientY, touch.identifier);
      }
    };
    const mouseDownHandler = (e: MouseEvent) => {
      e.preventDefault();
      this.handleTouchStart(e.clientX, e.clientY, 0);
    };
    const mouseMoveHandler = (e: MouseEvent) => {
      if (this.activePointers.has(0)) {
        this.handleTouchMove(e.clientX, e.clientY, 0);
      }
    };
    const mouseUpHandler = (e: MouseEvent) => {
      if (this.activePointers.has(0)) {
        this.handleTouchEnd(e.clientX, e.clientY, 0);
      }
    };
    element.addEventListener('touchstart', touchStartHandler, { passive: false });
    element.addEventListener('touchmove', touchMoveHandler, { passive: false });
    element.addEventListener('touchend', touchEndHandler, { passive: false });
    element.addEventListener('mousedown', mouseDownHandler);
    window.addEventListener('mousemove', mouseMoveHandler);
    window.addEventListener('mouseup', mouseUpHandler);
    return () => {
      element.removeEventListener('touchstart', touchStartHandler);
      element.removeEventListener('touchmove', touchMoveHandler);
      element.removeEventListener('touchend', touchEndHandler);
      element.removeEventListener('mousedown', mouseDownHandler);
      window.removeEventListener('mousemove', mouseMoveHandler);
      window.removeEventListener('mouseup', mouseUpHandler);
    };
  }

  destroy(): void {
    this.listeners.clear();
    this.activePointers.clear();
    this.pointerTracks.clear();
  }
}
