/**
 * 音符类型枚举
 */
export enum NoteType {
  TAP = 'tap',
  HOLD = 'hold',
  SLIDE = 'slide',
  SWIPE = 'swipe'
}

/**
 * 判定等级枚举
 */
export enum JudgeLevel {
  PERFECT = 'perfect',
  GOOD = 'good',
  MISS = 'miss',
  NONE = 'none'
}

/**
 * 游戏状态枚举
 */
export enum GameState {
  IDLE = 'idle',
  PLAYING = 'playing',
  PAUSED = 'paused',
  FINISHED = 'finished'
}

/**
 * 坐标点（用于滑动轨迹）
 */
export interface Point {
  x: number;
  y: number;
  time: number;
}

/**
 * 单个音符定义
 */
export interface Note {
  id: string;
  type: NoteType;
  time: number;
  track: number;
  endTime?: number;
  endTrack?: number;
  slidePath?: Point[];
  value?: number;
}

/**
 * 谱面数据
 */
export interface ChartData {
  title: string;
  difficulty: string;
  bpm: number;
  duration: number;
  notes: Note[];
  offset?: number;
}

/**
 * 判定区间配置（单位：毫秒）
 */
export interface JudgeRanges {
  perfect: number;
  good: number;
}

/**
 * 输入事件
 */
export interface InputEvent {
  id: number;
  type: 'touchstart' | 'touchmove' | 'touchend';
  x: number;
  y: number;
  time: number;
  pointerId: number;
  track?: number;
}

/**
 * 判定结果
 */
export interface JudgeResult {
  noteId: string;
  level: JudgeLevel;
  offset: number;
  time: number;
  noteType: NoteType;
  track: number;
}

/**
 * 分数配置
 */
export interface ScoreConfig {
  perfect: number;
  good: number;
  miss: number;
  comboBonus: number;
}

/**
 * 判定统计
 */
export interface JudgeStats {
  perfect: number;
  good: number;
  miss: number;
}

/**
 * 结算数据
 */
export interface GameResult {
  score: number;
  maxCombo: number;
  stats: JudgeStats;
  accuracy: number;
  grade: string;
  noteResults: JudgeResult[];
  playbackData: PlaybackData;
}

/**
 * 回放数据
 */
export interface PlaybackData {
  inputEvents: InputEvent[];
  judgeResults: JudgeResult[];
  chartNotes: Note[];
}

/**
 * 难度配置
 */
export interface DifficultyConfig {
  judgeRanges: JudgeRanges;
  scoreConfig: ScoreConfig;
  noteSpeed: number;
  trackCount: number;
}

/**
 * 事件回调类型
 */
export type EventCallbackMap = {
  onNoteJudge: (result: JudgeResult) => void;
  onComboChange: (combo: number, maxCombo: number) => void;
  onScoreChange: (score: number) => void;
  onStateChange: (state: GameState, prevState: GameState) => void;
  onGameFinish: (result: GameResult) => void;
  onNoteMiss: (note: Note) => void;
  onHoldProgress: (noteId: string, progress: number) => void;
};

/**
 * SDK 配置选项
 */
export interface SDKOptions {
  difficulty?: Partial<DifficultyConfig>;
  latency?: number;
  practiceMode?: boolean;
  autoPlay?: boolean;
  playbackMode?: boolean;
  playbackData?: PlaybackData;
  callbacks?: Partial<EventCallbackMap>;
}

/**
 * 长按状态
 */
export interface HoldState {
  noteId: string;
  startTime: number;
  isHolding: boolean;
  pointerId: number;
}
