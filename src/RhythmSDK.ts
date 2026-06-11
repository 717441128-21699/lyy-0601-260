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
  EventCallbackMap,
  ReplayComparison,
  NoteDiscrepancy,
  ReplaySummary,
  FailureCategory,
  BatchReplayResult,
  SlideWaypoint
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
    this.pendingNoteWindow = options.pendingNoteWindow ?? 3000;

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
    if (this.options.latency !== undefined) {
      this.timeline.setLatency(this.options.latency);
    }
    this.isInitialized = true;
  }

  private setupTimeProviders(): void {
    const getTime = () => this.timeline.getCurrentTime();
    this.inputManager.setTimeProvider(getTime);
    this.judge.setTimeProvider(getTime);
  }

  private getCallbacks(): Partial<EventCallbackMap> {
    return this.options.callbacks || {};
  }

  private setupCallbacks(): void {
    this.judge.setJudgeResultCallback((result) => {
      this.comboCounter.processJudge(result.level);
      this.resultGenerator.addJudgeResult(result);
      const cb = this.getCallbacks().onNoteJudge;
      if (cb) {
        try { cb(result); } catch (e) { console.error(e); }
      }
    });

    this.judge.setNoteMissCallback((note) => {
      const cb = this.getCallbacks().onNoteMiss;
      if (cb) {
        try { cb(note); } catch (e) { console.error(e); }
      }
    });

    this.judge.setHoldProgressCallback((noteId, progress) => {
      const cb = this.getCallbacks().onHoldProgress;
      if (cb) {
        try { cb(noteId, progress); } catch (e) { console.error(e); }
      }
    });

    this.comboCounter.setComboChangeCallback((combo, maxCombo) => {
      const cb = this.getCallbacks().onComboChange;
      if (cb) {
        try { cb(combo, maxCombo); } catch (e) { console.error(e); }
      }
    });

    this.comboCounter.setScoreChangeCallback((score) => {
      const cb = this.getCallbacks().onScoreChange;
      if (cb) {
        try { cb(score); } catch (e) { console.error(e); }
      }
    });

    this.timeline.setOnStateChange((state, prev) => {
      if (state === GameState.FINISHED && prev === GameState.PLAYING) {
        this.handleGameFinish();
      }
      const cb = this.getCallbacks().onStateChange;
      if (cb) {
        try { cb(state, prev); } catch (e) { console.error(e); }
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
    const recordedEvents = this.inputManager.getRecordedEvents();
    this.resultGenerator.setInputEvents(recordedEvents);

    const result = this.resultGenerator.generateResult(
      this.difficultyConfig.scoreConfig.perfect,
      this.difficultyConfig.scoreConfig.good,
      this.difficultyConfig.scoreConfig.comboBonus
    );
    const cb = this.getCallbacks().onGameFinish;
    if (cb) {
      try {
        cb(result);
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
    const data = this.resultGenerator.generatePlaybackData();
    data.difficultyConfig = { ...this.difficultyConfig };
    data.latency = this.timeline.getLatency();
    data.practiceMode = this.practiceMode;
    const chart = this.chartReader.getChart();
    if (chart) {
      data.chartTitle = chart.title;
    }
    return data;
  }

  compareReplay(
    originalResult: GameResult,
    playbackData: PlaybackData,
    chart: ChartData
  ): ReplayComparison {
    const replayResult = RhythmSDK.replayPlaybackData(playbackData, chart);
    const originalMap = new Map<string, JudgeResult>();
    for (const r of originalResult.noteResults) {
      originalMap.set(r.noteId, r);
    }
    const replayMap = new Map<string, JudgeResult>();
    for (const r of replayResult.noteResults) {
      replayMap.set(r.noteId, r);
    }
    const allNoteIds = new Set([...originalMap.keys(), ...replayMap.keys()]);
    const discrepancies: NoteDiscrepancy[] = [];
    let consistentCount = 0;
    for (const noteId of allNoteIds) {
      const orig = originalMap.get(noteId);
      const repl = replayMap.get(noteId);
      if (!orig || !repl) {
        discrepancies.push({
          noteId,
          originalLevel: orig?.level ?? JudgeLevel.MISS,
          replayLevel: repl?.level ?? JudgeLevel.MISS,
          originalOffset: orig?.offset ?? 0,
          replayOffset: repl?.offset ?? 0
        });
        continue;
      }
      if (orig.level === repl.level) {
        consistentCount++;
      } else {
        discrepancies.push({
          noteId,
          originalLevel: orig.level,
          replayLevel: repl.level,
          originalOffset: orig.offset,
          replayOffset: repl.offset
        });
      }
    }
    const totalNotes = allNoteIds.size;
    const consistencyRate = totalNotes > 0 ? Math.round((consistentCount / totalNotes) * 10000) / 100 : 100;
    return {
      scoreMatch: originalResult.score === replayResult.score,
      originalScore: originalResult.score,
      replayScore: replayResult.score,
      maxComboMatch: originalResult.maxCombo === replayResult.maxCombo,
      originalMaxCombo: originalResult.maxCombo,
      replayMaxCombo: replayResult.maxCombo,
      statsMatch: originalResult.stats.perfect === replayResult.stats.perfect
        && originalResult.stats.good === replayResult.stats.good
        && originalResult.stats.miss === replayResult.stats.miss,
      originalStats: { ...originalResult.stats },
      replayStats: { ...replayResult.stats },
      noteDiscrepancies: discrepancies,
      consistencyRate
    };
  }

  generateReplaySummary(
    originalResult: GameResult,
    playbackData: PlaybackData,
    chart: ChartData
  ): ReplaySummary {
    const comparison = this.compareReplay(originalResult, playbackData, chart);
    const inputEvents = playbackData.inputEvents;
    const touchStarts = inputEvents.filter(e => e.type === 'touchstart').length;
    const touchMoves = inputEvents.filter(e => e.type === 'touchmove').length;
    const touchEnds = inputEvents.filter(e => e.type === 'touchend').length;
    const pointerSet = new Set(inputEvents.map(e => e.pointerId));
    const times = inputEvents.map(e => e.time);
    const duration = times.length > 0 ? Math.max(...times) - Math.min(...times) : 0;
    const failureBreakdown: Record<FailureCategory, number> = {
      wrong_track: 0,
      path_incomplete: 0,
      path_out_of_order: 0,
      path_early: 0,
      path_late: 0,
      early_press: 0,
      late_press: 0,
      short_hold: 0,
      timeout: 0,
      no_input: 0
    };
    for (const r of originalResult.noteResults) {
      if (r.level === JudgeLevel.MISS && r.failureCategory) {
        failureBreakdown[r.failureCategory]++;
      }
    }
    return {
      discrepancies: comparison.noteDiscrepancies,
      inputTrajectorySummary: {
        totalEvents: inputEvents.length,
        touchStarts,
        touchMoves,
        touchEnds,
        uniquePointers: pointerSet.size,
        duration: Math.round(duration)
      },
      failureBreakdown,
      consistencyRate: comparison.consistencyRate,
      scoreMatch: comparison.scoreMatch,
      maxComboMatch: comparison.maxComboMatch
    };
  }

  generateReplaySummaryJSON(
    originalResult: GameResult,
    playbackData: PlaybackData,
    chart: ChartData
  ): string {
    const summary = this.generateReplaySummary(originalResult, playbackData, chart);
    const comparison = this.compareReplay(originalResult, playbackData, chart);
    const payload = {
      runId: playbackData.runId,
      chartTitle: playbackData.chartTitle,
      generatedAt: new Date().toISOString(),
      summary,
      comparison,
      originalScore: originalResult.score,
      replayScore: comparison.replayScore,
      passed: summary.scoreMatch && summary.maxComboMatch && comparison.statsMatch,
      noteCount: {
        total: chart.notes.length,
        originalJudged: originalResult.noteResults.length,
        replayJudged: comparison.replayStats.perfect + comparison.replayStats.good + comparison.replayStats.miss
      }
    };
    return JSON.stringify(payload, null, 2);
  }

  static batchReplayPlaybackData(
    runs: Array<{ playbackData: PlaybackData; chart: ChartData }>,
    passCondition: (result: GameResult, comparison: ReplayComparison) => boolean = (result, comp) => comp.scoreMatch && comp.statsMatch
  ): BatchReplayResult {
    const perRunResults: BatchReplayResult['perRunResults'] = [];
    const totalFailureCategories: Record<FailureCategory, number> = {
      wrong_track: 0,
      path_incomplete: 0,
      path_out_of_order: 0,
      path_early: 0,
      path_late: 0,
      early_press: 0,
      late_press: 0,
      short_hold: 0,
      timeout: 0,
      no_input: 0
    };
    let totalNotes = 0;
    let totalConsistentNotes = 0;
    let passedRuns = 0;
    for (const { playbackData, chart } of runs) {
      const replayResult = RhythmSDK.replayPlaybackData(playbackData, chart);
      const originalMap = new Map<string, JudgeResult>();
      for (const r of playbackData.judgeResults) {
        originalMap.set(r.noteId, r);
      }
      const replayMap = new Map<string, JudgeResult>();
      for (const r of replayResult.noteResults) {
        replayMap.set(r.noteId, r);
      }
      const allNoteIds = new Set([...originalMap.keys(), ...replayMap.keys()]);
      const discrepancies: NoteDiscrepancy[] = [];
      let consistent = 0;
      for (const noteId of allNoteIds) {
        const orig = originalMap.get(noteId);
        const repl = replayMap.get(noteId);
        if (!orig || !repl) {
          discrepancies.push({
            noteId,
            originalLevel: orig?.level ?? JudgeLevel.MISS,
            replayLevel: repl?.level ?? JudgeLevel.MISS,
            originalOffset: orig?.offset ?? 0,
            replayOffset: repl?.offset ?? 0
          });
        } else if (orig.level === repl.level) {
          consistent++;
        } else {
          discrepancies.push({
            noteId,
            originalLevel: orig.level,
            replayLevel: repl.level,
            originalOffset: orig.offset,
            replayOffset: repl.offset
          });
        }
      }
      totalNotes += allNoteIds.size;
      totalConsistentNotes += consistent;
      const consistencyRate = allNoteIds.size > 0 ? Math.round((consistent / allNoteIds.size) * 10000) / 100 : 100;
      const comparison: ReplayComparison = {
        scoreMatch: playbackData.judgeResults.length > 0
          ? replayResult.score === RhythmSDK.calculateScoreFromResults(playbackData.judgeResults)
          : true,
        originalScore: playbackData.judgeResults.length > 0
          ? RhythmSDK.calculateScoreFromResults(playbackData.judgeResults)
          : replayResult.score,
        replayScore: replayResult.score,
        maxComboMatch: true,
        originalMaxCombo: 0,
        replayMaxCombo: replayResult.maxCombo,
        statsMatch: true,
        originalStats: { perfect: 0, good: 0, miss: 0 },
        replayStats: { ...replayResult.stats },
        noteDiscrepancies: discrepancies,
        consistencyRate
      };
      const failures: string[] = [];
      if (!comparison.scoreMatch) failures.push('score_mismatch');
      if (!comparison.statsMatch) failures.push('stats_mismatch');
      if (discrepancies.length > 0) failures.push(`note_mismatch:${discrepancies.length}`);
      const passed = passCondition(replayResult, comparison);
      if (passed) passedRuns++;
      const runId = playbackData.runId || `run-${perRunResults.length}`;
      const chartTitle = playbackData.chartTitle || chart.title;
      for (const r of replayResult.noteResults) {
        if (r.level === JudgeLevel.MISS && r.failureCategory) {
          totalFailureCategories[r.failureCategory]++;
        }
      }
      const touchStarts = playbackData.inputEvents.filter(e => e.type === 'touchstart').length;
      const touchMoves = playbackData.inputEvents.filter(e => e.type === 'touchmove').length;
      const touchEnds = playbackData.inputEvents.filter(e => e.type === 'touchend').length;
      const pointerSet = new Set(playbackData.inputEvents.map(e => e.pointerId));
      const times = playbackData.inputEvents.map(e => e.time);
      const duration = times.length > 0 ? Math.max(...times) - Math.min(...times) : 0;
      const failureBreakdown: Record<FailureCategory, number> = {
        wrong_track: 0, path_incomplete: 0, path_out_of_order: 0,
        path_early: 0, path_late: 0, early_press: 0, late_press: 0,
        short_hold: 0, timeout: 0, no_input: 0
      };
      for (const r of replayResult.noteResults) {
        if (r.level === JudgeLevel.MISS && r.failureCategory) {
          failureBreakdown[r.failureCategory]++;
        }
      }
      perRunResults.push({
        runId,
        chartTitle,
        passed,
        score: replayResult.score,
        accuracy: replayResult.accuracy,
        grade: replayResult.grade,
        consistencyRate,
        failures,
        summary: {
          discrepancies,
          inputTrajectorySummary: {
            totalEvents: playbackData.inputEvents.length,
            touchStarts, touchMoves, touchEnds,
            uniquePointers: pointerSet.size,
            duration: Math.round(duration)
          },
          failureBreakdown,
          consistencyRate,
          scoreMatch: comparison.scoreMatch,
          maxComboMatch: comparison.maxComboMatch
        },
        comparison
      });
    }
    const totalRuns = runs.length;
    const totalConsistencyRate = totalNotes > 0 ? Math.round((totalConsistentNotes / totalNotes) * 10000) / 100 : 100;
    return {
      totalRuns,
      passedRuns,
      failedRuns: totalRuns - passedRuns,
      passRate: totalRuns > 0 ? Math.round((passedRuns / totalRuns) * 10000) / 100 : 100,
      perRunResults,
      failureCategories: totalFailureCategories,
      generatedAt: new Date().toISOString(),
      totalNotes,
      totalConsistencyRate
    };
  }

  private static calculateScoreFromResults(results: JudgeResult[]): number {
    let score = 0;
    let combo = 0;
    for (const r of results.sort((a, b) => a.time - b.time)) {
      if (r.level === JudgeLevel.PERFECT) {
        combo++;
        score += 1000 + Math.min(50, Math.floor(combo / 10)) * 10;
      } else if (r.level === JudgeLevel.GOOD) {
        combo++;
        score += 500 + Math.min(50, Math.floor(combo / 10)) * 10;
      } else {
        combo = 0;
      }
    }
    return score;
  }

  static replayPlaybackData(
    playbackData: PlaybackData,
    chart: ChartData,
    callbacks?: Partial<EventCallbackMap>
  ): GameResult {
    const sdk = new RhythmSDK({
      playbackMode: true,
      playbackData,
      difficulty: playbackData.difficultyConfig
        ? {
            judgeRanges: playbackData.difficultyConfig.judgeRanges,
            scoreConfig: playbackData.difficultyConfig.scoreConfig,
            noteSpeed: playbackData.difficultyConfig.noteSpeed,
            trackCount: playbackData.difficultyConfig.trackCount
          }
        : undefined,
      latency: playbackData.latency,
      practiceMode: playbackData.practiceMode,
      callbacks
    });
    sdk.loadChart(chart);
    const judgeResults: JudgeResult[] = [];
    if (!callbacks?.onNoteJudge) {
      sdk.setCallbacks({
        onNoteJudge: (r) => { judgeResults.push(r); }
      });
    }
    sdk.initialize();
    sdk.setPlaybackMode(true, playbackData);
    const allNotes = sdk.chartReader.getNotes();
    sdk.judge.registerPendingNotes(allNotes);
    let lastEventTime = 0;
    for (const e of playbackData.inputEvents) {
      if (e.time > lastEventTime) lastEventTime = e.time;
    }
    const simEnd = chart.duration + 3000;
    const simDuration = Math.max(simEnd, lastEventTime + 1000);
    let simTime = 0;
    const step = 16;
    while (simTime < simDuration) {
      sdk.inputManager.updatePlayback(simTime);
      sdk.judge.update(simTime);
      simTime += step;
    }
    sdk.judge.checkMissedNotes(simTime);
    const result = sdk.getResult();
    sdk.destroy();
    return result;
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
