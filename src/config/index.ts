import { DifficultyConfig, JudgeRanges, ScoreConfig } from '../types';

export const DEFAULT_JUDGE_RANGES: JudgeRanges = {
  perfect: 50,
  good: 120
};

export const DEFAULT_SCORE_CONFIG: ScoreConfig = {
  perfect: 1000,
  good: 500,
  miss: 0,
  comboBonus: 10
};

export const DEFAULT_DIFFICULTY: DifficultyConfig = {
  judgeRanges: { ...DEFAULT_JUDGE_RANGES },
  scoreConfig: { ...DEFAULT_SCORE_CONFIG },
  noteSpeed: 1.0,
  trackCount: 4
};

export const EASY_DIFFICULTY: DifficultyConfig = {
  judgeRanges: {
    perfect: 70,
    good: 150
  },
  scoreConfig: {
    perfect: 800,
    good: 400,
    miss: 0,
    comboBonus: 8
  },
  noteSpeed: 0.8,
  trackCount: 4
};

export const NORMAL_DIFFICULTY: DifficultyConfig = {
  ...DEFAULT_DIFFICULTY
};

export const HARD_DIFFICULTY: DifficultyConfig = {
  judgeRanges: {
    perfect: 35,
    good: 90
  },
  scoreConfig: {
    perfect: 1200,
    good: 600,
    miss: 0,
    comboBonus: 15
  },
  noteSpeed: 1.3,
  trackCount: 6
};

export const EXPERT_DIFFICULTY: DifficultyConfig = {
  judgeRanges: {
    perfect: 25,
    good: 70
  },
  scoreConfig: {
    perfect: 1500,
    good: 750,
    miss: 0,
    comboBonus: 20
  },
  noteSpeed: 1.5,
  trackCount: 8
};

export const DIFFICULTY_PRESETS: Record<string, DifficultyConfig> = {
  easy: EASY_DIFFICULTY,
  normal: NORMAL_DIFFICULTY,
  hard: HARD_DIFFICULTY,
  expert: EXPERT_DIFFICULTY
};

export function createDifficultyConfig(
  preset?: keyof typeof DIFFICULTY_PRESETS,
  overrides?: Partial<DifficultyConfig>
): DifficultyConfig {
  const base = preset ? { ...DIFFICULTY_PRESETS[preset] } : { ...DEFAULT_DIFFICULTY };
  if (overrides) {
    if (overrides.judgeRanges) {
      base.judgeRanges = { ...base.judgeRanges, ...overrides.judgeRanges };
    }
    if (overrides.scoreConfig) {
      base.scoreConfig = { ...base.scoreConfig, ...overrides.scoreConfig };
    }
    if (overrides.noteSpeed !== undefined) {
      base.noteSpeed = overrides.noteSpeed;
    }
    if (overrides.trackCount !== undefined) {
      base.trackCount = overrides.trackCount;
    }
  }
  return base;
}
