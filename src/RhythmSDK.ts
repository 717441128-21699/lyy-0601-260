import { ChartReader } from './modules/ChartReader';
import { Timeline } from './modules/Timeline';
import { InputManager } from './modules/InputManager';
import { Judge } from './modules/Judge';
import { ComboCounter } from './modules/ComboCounter';
import { ResultGenerator } from './modules/ResultGenerator';
import { createDifficultyConfig, DEFAULT_DIFFICULTY } from './config';
import {
  ChartData,
  SDKOptions,
  DifficultyConfig,
  GameState,
  InputEvent,
  JudgeResult,
  JudgeLevel,
  Note,
  NoteType,
  GameResult,
  PlaybackData,
  JudgeRanges,
  ScoreConfig,
  EventCallbackMap
} from './types';

export class RhythmSDK {
  private chartReader: ChartReader;
  private timeline: Timeline;
  private inputManager: InputManager;
  private judge: Judge;
  private comboCounter: ComboCounter;
  private resultGenerator: ResultGenerator;

  private difficultyConfig: DifficultyConfig;
  private options: SDKOptions;
  private isInitialized: boolean = false;
  private pendingNoteWindow: number = 500;
  private autoPlayMode: boolean = false;
  private practiceMode: boolean = false;
  private playbackMode: boolean = false;
  private cleanupFns: Array<() => void> = [];

  constructor(options: SDKOptions = {}) {
    this.options = options;
    this.difficultyConfig = this.mergeDifficultyConfig(options.difficulty);
    this.autoPlayMode = options.autoPlay ?? false;
    this.practiceMode = options.practiceMode ?? false;
    this.playbackMode = options.playbackMode ?? false;

    this.chartReader = new ChartReader();
    this.timeline = new Timeline();
    this.inputManager = new InputManager();
    this.judge = new Judge(this.difficultyConfig.judgeRanges);
    this.comboCounter = new ComboCounter(this.difficultyConfig.scoreConfig);
    this.resultGenerator = new ResultGenerator();
  }

  private mergeDifficultyConfig(
    overrides?: Partial<DifficultyConfig>
  ): DifficultyConfig {
    if (!overrides) return { ...DEFAULT_DIFFICULTY };
    return createDifficultyConfig(undefined, overrides);
  }

  setDifficulty(preset?: 'easy' | 'normal' | 'hard' | 'expert', overrides?: Partial<DifficultyConfig>): void {
    this.difficultyConfig = createDifficultyConfig(preset, overrides);
    this.applyDifficultyConfig();
  }

  private applyDifficultyConfig(): void {
    this.judge.setJudgeRanges(this.difficultyConfig.judgeRanges);
    this.comboCounter.setScoreConfig(this.difficultyConfig.scoreConfig);
    this.inputManager.setTrackCount(this.difficultyConfig.trackCount);
  }

  setJudgeRanges(ranges: JudgeRanges): void {
    this.difficultyConfig.judgeRanges = { ...ranges };
    this.judge.setJudgeRanges(ranges);
  }

  setScoreConfig(config: ScoreConfig): void {
    this.difficultyConfig.scoreConfig = { ...config };
    this.comboCounter.setScoreConfig(config);
  }

  setLatency(latency: number): void {
    this.timeline.setLatency(latency);
  }

  setPracticeMode(enabled: boolean): void {
    this.practiceMode = enabled;
    this.judge.setPracticeMode(enabled);
    this.comboCounter.setPracticeMode(enabled);
  }

  setAutoPlay(enabled: boolean): void {
    this.autoPlayMode = enabled;
  }

  setPlaybackMode(enabled: boolean, playbackData?: PlaybackData): void {
    this.playbackMode = enabled;
    if (playbackData) {
      this.options.playbackData = playbackData;
    }
    if (this.options.playbackData) {
      this.inputManager.setPlaybackMode(enabled, this.options.playbackData.inputEvents);
    }
  }

  setCallbacks(callbacks: Partial<EventCallbackMap>): void {
    this.options.callbacks = { ...this.options.callbacks, ...callbacks };
  }

  loadChart(chart: ChartData): void {
    this.chartReader.loadChart(chart);
    this.timeline.setDuration(this.chartReader.getDuration() + 2000);
    this.timeline.setChartOffset(this.chartReader.getOffset());
    this.resultGenerator.setChartNotes(this.chartReader.getNotes());
  }

  loadChartFromJSON(json: string): void {
    this.chartReader.loadChartFromJSON(json);
    this.timeline.setDuration(this.chartReader.getDuration() + 2000);
    this.timeline.setChartOffset(this.chartReader.getOffset());
    this.resultGenerator.setChartNotes(this.chartReader.getNotes());
  }

  initialize(): void {
    if (this.isInitialized) return;
    this.setupTimeProviders();
    this.setupCallbacks();
    this.setupTimelineLoop();
    this.applyDifficultyConfig();
    this.judge.setPracticeMode(this.practiceMode);
    this.comboCounter.setPracticeMode(this.practiceMode);
    this.isInitialized = true;
  }

  private setupTimeProviders(): void {
    const getTime = () => this.timeline.getCurrentTime();
    this.inputManager.setTimeProvider(getTime);
    this.judge.setTimeProvider(getTime);
  }

  private setupCallbacks(): void {
    const cbs = this.options.callbacks || {};

    this.judge.setJudgeResultCallback((result) => {
      this.comboCounter.processJudge(result.level);
      this.resultGenerator.addJudgeResult(result);
      if (cbs.onNoteJudge) {
        try { cbs.onNoteJudge(result); } catch (e) { console.error(e); }
      }
    });

    this.judge.setNoteMissCallback((note) => {
      if (cbs.onNoteMiss) {
        try { cbs.onNoteMiss(note); } catch (e) { console.error(e); }
      }
    });

    this.judge.setHoldProgressCallback((noteId, progress) => {
      if (cbs.onHoldProgress) {
        try { cbs.onHoldProgress(noteId, progress); } catch (e) { console.error(e); }
      }
    });

    this.comboCounter.setComboChangeCallback((combo, maxCombo) => {
      if (cbs.onComboChange) {
        try { cbs.onComboChange(combo, maxCombo); } catch (e) { console.error(e); }
      }
    });

    this.comboCounter.setScoreChangeCallback((score) => {
      if (cbs.onScoreChange) {
        try { cbs.onScoreChange(score); } catch (e) { console.error(e); }
      }
    });

    this.timeline.setOnStateChange((state, prev) => {
      if (state === GameState.FINISHED && prev === GameState.PLAYING) {
        this.handleGameFinish();
      }
      if (cbs.onStateChange) {
        try { cbs.onStateChange(state, prev); } catch (e) { console.error(e); }
      }
    });

    this.inputManager.addListener((event) => {
      this.judge.handleInput(event);
    });
  }

  private setupTimelineLoop(): void {
    const cleanup = this.timeline.addCallback((currentTime, deltaTime) => {
      this.update(currentTime);
    });
    this.cleanupFns.push(cleanup);
  }

  private update(currentTime: number): void {
    const upcomingNotes = this.chartReader.getUpcomingNotes(
      currentTime - 100,
      this.pendingNoteWindow
    );
    this.judge.registerPendingNotes(upcomingNotes);
    this.judge.update(currentTime);

    if (this.playbackMode && this.options.playbackData) {
      this.inputManager.updatePlayback(currentTime);
    }

    if (this.autoPlayMode) {
      this.runAutoPlay(currentTime);
    }
  }

  private runAutoPlay(currentTime: number): void {
    const notes = this.chartReader.getNotesInTimeRange(
      currentTime - 10,
      currentTime + 10
    );
    for (const note of notes) {
      if (this.judge.isNoteJudged(note.id)) continue;
      if (note.type === NoteType.TAP || note.type === NoteType.SWIPE) {
        if (Math.abs(currentTime - note.time) < 5) {
          this.inputManager.handleTouchStart(
            note.track * 100 + 50,
            500,
            Math.floor(Math.random() * 10)
          );
          setTimeout(() => {
            this.inputManager.handleTouchEnd(
              note.track * 100 + 50,
              500,
              Math.floor(Math.random() * 10)
            );
          }, 20);
        }
      }
    }
  }

  start(): void {
    if (!this.isInitialized) {
      this.initialize();
    }
    this.resetInternalState();
    this.timeline.start();
  }

  pause(): void {
    this.timeline.pause();
  }

  resume(): void {
    this.timeline.resume();
  }

  stop(): void {
    this.timeline.stop();
  }

  seek(time: number): void {
    this.timeline.seek(time);
  }

  reset(): void {
    this.timeline.reset();
    this.resetInternalState();
  }

  private resetInternalState(): void {
    this.judge.reset();
    this.comboCounter.reset();
    this.resultGenerator.reset();
    this.inputManager.clearRecordedEvents();
    const allNotes = this.chartReader.getNotes();
    this.resultGenerator.setChartNotes(allNotes);
  }

  handleInput(x: number, y: number, type: 'touchstart' | 'touchmove' | 'touchend', pointerId: number = 0): InputEvent | null {
    if (type === 'touchstart') {
      return this.inputManager.handleTouchStart(x, y, pointerId);
    } else if (type === 'touchmove') {
      return this.inputManager.handleTouchMove(x, y, pointerId);
    } else {
      return this.inputManager.handleTouchEnd(x, y, pointerId);
    }
  }

  bindToElement(element: HTMLElement): () => void {
    const cleanup = this.inputManager.bindToElement(element);
    this.cleanupFns.push(cleanup);
    return cleanup;
  }

  setTrackCaptureArea(x: number, y: number, width: number, height: number): void {
    this.inputManager.setCaptureArea(x, y, width, height);
  }

  private handleGameFinish(): void {
    this.judge.checkMissedNotes();
    const allNotes = this.chartReader.getNotes();
    const totalNotes = allNotes.length;
    const judgedCount = this.judge.getJudgedNoteCount();
    if (judgedCount < totalNotes) {
      // Force judge remaining
    }
    const recordedEvents = this.inputManager.getRecordedEvents();
    this.resultGenerator.setInputEvents(recordedEvents);

    const result = this.resultGenerator.generateResult(
      this.difficultyConfig.scoreConfig.perfect,
      this.difficultyConfig.scoreConfig.good,
      this.difficultyConfig.scoreConfig.comboBonus
    );
    if (this.options.callbacks?.onGameFinish) {
      try {
        this.options.callbacks.onGameFinish(result);
      } catch (e) {
        console.error(e);
      }
    }
  }

  getResult(): GameResult {
    const recordedEvents = this.inputManager.getRecordedEvents();
    this.resultGenerator.setInputEvents(recordedEvents);
    return this.resultGenerator.generateResult(
      this.difficultyConfig.scoreConfig.perfect,
      this.difficultyConfig.scoreConfig.good,
      this.difficultyConfig.scoreConfig.comboBonus
    );
  }

  getSummaryReport(): string {
    const recordedEvents = this.inputManager.getRecordedEvents();
    this.resultGenerator.setInputEvents(recordedEvents);
    return this.resultGenerator.generateSummaryReport();
  }

  exportPlaybackData(): PlaybackData {
    const recordedEvents = this.inputManager.getRecordedEvents();
    this.resultGenerator.setInputEvents(recordedEvents);
    return this.resultGenerator.generatePlaybackData();
  }

  getState(): GameState {
    return this.timeline.getState();
  }

  getCurrentTime(): number {
    return this.timeline.getCurrentTime();
  }

  getCombo(): number {
    return this.comboCounter.getCombo();
  }

  getMaxCombo(): number {
    return this.comboCounter.getMaxCombo();
  }

  getScore(): number {
    return this.comboCounter.getScore();
  }

  getAccuracy(): number {
    return this.comboCounter.getAccuracy();
  }

  getStats() {
    return this.comboCounter.getStats();
  }

  getUpcomingNotes(windowMs: number = 2000): Note[] {
    return this.chartReader.getUpcomingNotes(this.timeline.getCurrentTime(), windowMs);
  }

  getChart(): ChartData | null {
    return this.chartReader.getChart();
  }

  getRecordedEvents(): InputEvent[] {
    return this.inputManager.getRecordedEvents();
  }

  getJudgeResults(): JudgeResult[] {
    return this.resultGenerator['noteResults'] || [];
  }

  destroy(): void {
    this.cleanupFns.forEach(fn => {
      try { fn(); } catch (e) {}
    });
    this.cleanupFns = [];
    this.timeline.destroy();
    this.inputManager.destroy();
    this.judge.destroy();
    this.comboCounter.destroy();
    this.resultGenerator.destroy();
    this.isInitialized = false;
  }
}
