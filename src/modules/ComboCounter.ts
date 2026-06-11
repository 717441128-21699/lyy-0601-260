import { JudgeLevel, ScoreConfig, JudgeStats } from '../types';

export type ComboChangeCallback = (combo: number, maxCombo: number) => void;
export type ScoreChangeCallback = (score: number) => void;

export class ComboCounter {
  private combo: number = 0;
  private maxCombo: number = 0;
  private score: number = 0;
  private stats: JudgeStats = {
    perfect: 0,
    good: 0,
    miss: 0
  };
  private scoreConfig: ScoreConfig;
  private comboCallback: ComboChangeCallback | null = null;
  private scoreCallback: ScoreChangeCallback | null = null;
  private practiceMode: boolean = false;
  private scoreMultiplier: number = 1.0;

  constructor(config: ScoreConfig) {
    this.scoreConfig = { ...config };
  }

  setScoreConfig(config: ScoreConfig): void {
    this.scoreConfig = { ...config };
  }

  getScoreConfig(): ScoreConfig {
    return { ...this.scoreConfig };
  }

  setComboChangeCallback(cb: ComboChangeCallback): void {
    this.comboCallback = cb;
  }

  setScoreChangeCallback(cb: ScoreChangeCallback): void {
    this.scoreCallback = cb;
  }

  setPracticeMode(enabled: boolean): void {
    this.practiceMode = enabled;
    if (enabled) {
      this.scoreMultiplier = 0.5;
    } else {
      this.scoreMultiplier = 1.0;
    }
  }

  setScoreMultiplier(multiplier: number): void {
    this.scoreMultiplier = Math.max(0, multiplier);
  }

  getCombo(): number {
    return this.combo;
  }

  getMaxCombo(): number {
    return this.maxCombo;
  }

  getScore(): number {
    return Math.floor(this.score);
  }

  getStats(): JudgeStats {
    return { ...this.stats };
  }

  getTotalNotes(): number {
    return this.stats.perfect + this.stats.good + this.stats.miss;
  }

  getAccuracy(): number {
    const total = this.getTotalNotes();
    if (total === 0) return 0;
    const weightedScore = this.stats.perfect * 100 + this.stats.good * 50;
    return (weightedScore / (total * 100)) * 100;
  }

  processJudge(level: JudgeLevel): { scoreGain: number; comboChanged: boolean } {
    let scoreGain = 0;
    let comboChanged = false;

    switch (level) {
      case JudgeLevel.PERFECT:
        this.stats.perfect++;
        this.combo++;
        comboChanged = true;
        scoreGain = this.calculateScore(this.scoreConfig.perfect);
        break;
      case JudgeLevel.GOOD:
        this.stats.good++;
        this.combo++;
        comboChanged = true;
        scoreGain = this.calculateScore(this.scoreConfig.good);
        break;
      case JudgeLevel.MISS:
        this.stats.miss++;
        if (!this.practiceMode) {
          if (this.combo > 0) {
            this.combo = 0;
            comboChanged = true;
          }
        } else {
          this.combo++;
          comboChanged = true;
        }
        scoreGain = this.scoreConfig.miss;
        break;
    }

    if (this.combo > this.maxCombo) {
      this.maxCombo = this.combo;
    }

    if (scoreGain > 0) {
      this.score += scoreGain;
      this.emitScoreChange();
    }

    if (comboChanged) {
      this.emitComboChange();
    }

    return { scoreGain, comboChanged };
  }

  private calculateScore(baseScore: number): number {
    const comboBonus = Math.min(50, Math.floor(this.combo / 10)) * this.scoreConfig.comboBonus;
    return Math.floor((baseScore + comboBonus) * this.scoreMultiplier);
  }

  private emitComboChange(): void {
    if (this.comboCallback) {
      try {
        this.comboCallback(this.combo, this.maxCombo);
      } catch (e) {
        console.error('Combo callback error:', e);
      }
    }
  }

  private emitScoreChange(): void {
    if (this.scoreCallback) {
      try {
        this.scoreCallback(this.getScore());
      } catch (e) {
        console.error('Score callback error:', e);
      }
    }
  }

  addBonusScore(bonus: number): void {
    if (bonus <= 0) return;
    this.score += Math.floor(bonus * this.scoreMultiplier);
    this.emitScoreChange();
  }

  reset(): void {
    this.combo = 0;
    this.maxCombo = 0;
    this.score = 0;
    this.stats = { perfect: 0, good: 0, miss: 0 };
    this.emitComboChange();
    this.emitScoreChange();
  }

  destroy(): void {
    this.comboCallback = null;
    this.scoreCallback = null;
  }
}
