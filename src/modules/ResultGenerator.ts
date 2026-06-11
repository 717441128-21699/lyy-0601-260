import {
  GameResult,
  JudgeResult,
  JudgeStats,
  PlaybackData,
  Note,
  InputEvent,
  JudgeLevel
} from '../types';

export interface GradeThreshold {
  grade: string;
  minAccuracy: number;
  minPerfectRatio?: number;
}

export const DEFAULT_GRADE_THRESHOLDS: GradeThreshold[] = [
  { grade: 'S+', minAccuracy: 99.5, minPerfectRatio: 0.95 },
  { grade: 'S', minAccuracy: 98, minPerfectRatio: 0.85 },
  { grade: 'A+', minAccuracy: 95 },
  { grade: 'A', minAccuracy: 90 },
  { grade: 'B+', minAccuracy: 85 },
  { grade: 'B', minAccuracy: 80 },
  { grade: 'C', minAccuracy: 70 },
  { grade: 'D', minAccuracy: 60 },
  { grade: 'F', minAccuracy: 0 }
];

export class ResultGenerator {
  private gradeThresholds: GradeThreshold[];
  private noteResults: JudgeResult[] = [];
  private inputEvents: InputEvent[] = [];
  private chartNotes: Note[] = [];

  constructor(thresholds?: GradeThreshold[]) {
    this.gradeThresholds = thresholds || [...DEFAULT_GRADE_THRESHOLDS];
  }

  setGradeThresholds(thresholds: GradeThreshold[]): void {
    this.gradeThresholds = [...thresholds].sort((a, b) => b.minAccuracy - a.minAccuracy);
  }

  getGradeThresholds(): GradeThreshold[] {
    return [...this.gradeThresholds];
  }

  setJudgeResults(results: JudgeResult[]): void {
    this.noteResults = [...results];
  }

  addJudgeResult(result: JudgeResult): void {
    this.noteResults.push(result);
  }

  setInputEvents(events: InputEvent[]): void {
    this.inputEvents = [...events];
  }

  setChartNotes(notes: Note[]): void {
    this.chartNotes = [...notes];
  }

  calculateStats(): JudgeStats {
    const stats: JudgeStats = { perfect: 0, good: 0, miss: 0 };
    for (const result of this.noteResults) {
      switch (result.level) {
        case JudgeLevel.PERFECT:
          stats.perfect++;
          break;
        case JudgeLevel.GOOD:
          stats.good++;
          break;
        case JudgeLevel.MISS:
          stats.miss++;
          break;
      }
    }
    return stats;
  }

  calculateAccuracy(stats?: JudgeStats): number {
    const s = stats || this.calculateStats();
    const total = s.perfect + s.good + s.miss;
    if (total === 0) return 0;
    const weighted = s.perfect * 100 + s.good * 50;
    return Math.round((weighted / (total * 100)) * 10000) / 100;
  }

  calculateMaxCombo(): number {
    let maxCombo = 0;
    let currentCombo = 0;
    const sortedResults = [...this.noteResults].sort((a, b) => a.time - b.time);
    for (const result of sortedResults) {
      if (result.level !== JudgeLevel.MISS) {
        currentCombo++;
        maxCombo = Math.max(maxCombo, currentCombo);
      } else {
        currentCombo = 0;
      }
    }
    return maxCombo;
  }

  calculatePerfectRatio(stats?: JudgeStats): number {
    const s = stats || this.calculateStats();
    const total = s.perfect + s.good + s.miss;
    if (total === 0) return 0;
    return s.perfect / total;
  }

  calculateGrade(accuracy?: number, perfectRatio?: number): string {
    const acc = accuracy ?? this.calculateAccuracy();
    const pr = perfectRatio ?? this.calculatePerfectRatio();
    for (const threshold of this.gradeThresholds) {
      if (acc >= threshold.minAccuracy) {
        if (threshold.minPerfectRatio !== undefined) {
          if (pr >= threshold.minPerfectRatio) {
            return threshold.grade;
          }
        } else {
          return threshold.grade;
        }
      }
    }
    return this.gradeThresholds[this.gradeThresholds.length - 1].grade;
  }

  calculateScore(
    perfectScore: number = 1000,
    goodScore: number = 500,
    comboBonus: number = 10
  ): number {
    let score = 0;
    let combo = 0;
    const sortedResults = [...this.noteResults].sort((a, b) => a.time - b.time);
    for (const result of sortedResults) {
      if (result.level === JudgeLevel.PERFECT) {
        combo++;
        const bonus = Math.min(50, Math.floor(combo / 10)) * comboBonus;
        score += perfectScore + bonus;
      } else if (result.level === JudgeLevel.GOOD) {
        combo++;
        const bonus = Math.min(50, Math.floor(combo / 10)) * comboBonus;
        score += goodScore + bonus;
      } else {
        combo = 0;
      }
    }
    return score;
  }

  getAverageOffset(): number {
    const validResults = this.noteResults.filter(
      r => r.level === JudgeLevel.PERFECT || r.level === JudgeLevel.GOOD
    );
    if (validResults.length === 0) return 0;
    const sum = validResults.reduce((acc, r) => acc + r.offset, 0);
    return Math.round((sum / validResults.length) * 100) / 100;
  }

  getOffsetDistribution(): { early: number; perfect: number; late: number } {
    let early = 0;
    let perfect = 0;
    let late = 0;
    const validResults = this.noteResults.filter(
      r => r.level === JudgeLevel.PERFECT || r.level === JudgeLevel.GOOD
    );
    for (const r of validResults) {
      if (r.offset < -20) early++;
      else if (r.offset > 20) late++;
      else perfect++;
    }
    return { early, perfect, late };
  }

  getMissedNoteIds(): string[] {
    return this.noteResults
      .filter(r => r.level === JudgeLevel.MISS)
      .map(r => r.noteId);
  }

  getJudgeErrorOffsets(): Array<{ noteId: string; offset: number; level: JudgeLevel; startOffset?: number; actualEndTrack?: number; autoSettled?: boolean }> {
    return this.noteResults
      .filter(r => r.level !== JudgeLevel.PERFECT)
      .map(r => ({
        noteId: r.noteId,
        offset: r.offset,
        level: r.level,
        startOffset: r.startOffset,
        actualEndTrack: r.actualEndTrack,
        autoSettled: r.autoSettled
      }));
  }

  generateNoteDebugList(): Array<{
    noteId: string;
    noteType: string;
    level: string;
    startOffset: number | undefined;
    endOffset: number;
    track: number;
    endTrack: number | undefined;
    actualEndTrack: number | undefined;
    autoSettled: boolean | undefined;
  }> {
    return this.noteResults.map(r => ({
      noteId: r.noteId,
      noteType: r.noteType,
      level: r.level,
      startOffset: r.startOffset,
      endOffset: r.offset,
      track: r.track,
      endTrack: r.endTrack,
      actualEndTrack: r.actualEndTrack,
      autoSettled: r.autoSettled
    }));
  }

  generatePlaybackData(): PlaybackData {
    return {
      inputEvents: [...this.inputEvents],
      judgeResults: [...this.noteResults],
      chartNotes: [...this.chartNotes]
    };
  }

  generateResult(
    perfectScore?: number,
    goodScore?: number,
    comboBonus?: number
  ): GameResult {
    const stats = this.calculateStats();
    const accuracy = this.calculateAccuracy(stats);
    const perfectRatio = this.calculatePerfectRatio(stats);
    const grade = this.calculateGrade(accuracy, perfectRatio);
    const maxCombo = this.calculateMaxCombo();
    const score = this.calculateScore(perfectScore, goodScore, comboBonus);
    return {
      score,
      maxCombo,
      stats,
      accuracy,
      grade,
      noteResults: [...this.noteResults],
      playbackData: this.generatePlaybackData()
    };
  }

  generateSummaryReport(): string {
    const result = this.generateResult();
    const avgOffset = this.getAverageOffset();
    const offsetDist = this.getOffsetDistribution();
    const debugList = this.generateNoteDebugList();
    const lines = [
      '=== 游戏结算报告 ===',
      '',
      `总分: ${result.score}`,
      `评级: ${result.grade}`,
      `准确率: ${result.accuracy}%`,
      `最大连击: ${result.maxCombo}`,
      '',
      '--- 判定统计 ---',
      `Perfect: ${result.stats.perfect}`,
      `Good: ${result.stats.good}`,
      `Miss: ${result.stats.miss}`,
      '',
      '--- 偏移分析 ---',
      `平均偏移: ${avgOffset}ms`,
      `早按: ${offsetDist.early}次`,
      `准点: ${offsetDist.perfect}次`,
      `晚按: ${offsetDist.late}次`,
      '',
      `Perfect 比率: ${(this.calculatePerfectRatio() * 100).toFixed(1)}%`,
      '',
      '--- 音符调试明细 ---'
    ];
    for (const d of debugList) {
      let line = `  ${d.noteId} [${d.noteType}] ${d.level}`;
      if (d.startOffset !== undefined) {
        line += ` 按下偏移:${d.startOffset.toFixed(0)}ms`;
      }
      line += ` 结束偏移:${d.endOffset.toFixed(0)}ms`;
      if (d.endTrack !== undefined) {
        line += ` 目标轨:${d.endTrack}`;
      }
      if (d.actualEndTrack !== undefined) {
        line += ` 实际轨:${d.actualEndTrack}`;
      }
      if (d.autoSettled) {
        line += ' [超时结算]';
      }
      lines.push(line);
    }
    return lines.join('\n');
  }

  exportResultToJSON(): string {
    return JSON.stringify(this.generateResult(), null, 2);
  }

  reset(): void {
    this.noteResults = [];
    this.inputEvents = [];
    this.chartNotes = [];
  }

  destroy(): void {
    this.reset();
  }
}
