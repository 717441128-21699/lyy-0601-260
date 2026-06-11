export enum NoteType {
  TAP = 'tap',
  HOLD = 'hold',
  SLIDE = 'slide',
  SWIPE = 'swipe'
}

export enum JudgeLevel {
  PERFECT = 'perfect',
  GOOD = 'good',
  MISS = 'miss',
  NONE = 'none'
}

export enum GameState {
  IDLE = 'idle',
  PLAYING = 'playing',
  PAUSED = 'paused',
  FINISHED = 'finished'
}

export type FailureCategory =
  | 'wrong_track'
  | 'path_incomplete'
  | 'early_press'
  | 'late_press'
  | 'short_hold'
  | 'timeout'
  | 'no_input';

export interface Point {
  x: number;
  y: number;
  time: number;
}

export interface Note {
  id: string;
  type: NoteType;
  time: number;
  track: number;
  endTime?: number;
  endTrack?: number;
  slidePath?: Point[];
  slideWaypoints?: number[];
  value?: number;
}

export interface ChartData {
  title: string;
  difficulty: string;
  bpm: number;
  duration: number;
  notes: Note[];
  offset?: number;
}

export interface JudgeRanges {
  perfect: number;
  good: number;
}

export interface InputEvent {
  id: number;
  type: 'touchstart' | 'touchmove' | 'touchend';
  x: number;
  y: number;
  time: number;
  pointerId: number;
  track?: number;
}

export interface JudgeResult {
  noteId: string;
  level: JudgeLevel;
  offset: number;
  time: number;
  noteType: NoteType;
  track: number;
  endTrack?: number;
  startOffset?: number;
  actualEndTrack?: number;
  autoSettled?: boolean;
  pathComplete?: boolean;
  failureCategory?: FailureCategory;
}

export interface ScoreConfig {
  perfect: number;
  good: number;
  miss: number;
  comboBonus: number;
}

export interface JudgeStats {
  perfect: number;
  good: number;
  miss: number;
}

export interface GameResult {
  score: number;
  maxCombo: number;
  stats: JudgeStats;
  accuracy: number;
  grade: string;
  noteResults: JudgeResult[];
  playbackData: PlaybackData;
}

export interface PlaybackData {
  inputEvents: InputEvent[];
  judgeResults: JudgeResult[];
  chartNotes: Note[];
  difficultyConfig?: DifficultyConfig;
  latency?: number;
  practiceMode?: boolean;
}

export interface DifficultyConfig {
  judgeRanges: JudgeRanges;
  scoreConfig: ScoreConfig;
  noteSpeed: number;
  trackCount: number;
}

export type EventCallbackMap = {
  onNoteJudge: (result: JudgeResult) => void;
  onComboChange: (combo: number, maxCombo: number) => void;
  onScoreChange: (score: number) => void;
  onStateChange: (state: GameState, prevState: GameState) => void;
  onGameFinish: (result: GameResult) => void;
  onNoteMiss: (note: Note) => void;
  onHoldProgress: (noteId: string, progress: number) => void;
};

export interface SDKOptions {
  difficulty?: Partial<DifficultyConfig>;
  latency?: number;
  practiceMode?: boolean;
  autoPlay?: boolean;
  playbackMode?: boolean;
  playbackData?: PlaybackData;
  callbacks?: Partial<EventCallbackMap>;
}

export interface HoldState {
  noteId: string;
  startTime: number;
  startOffset: number;
  isHolding: boolean;
  pointerId: number;
  lastTrack: number;
  visitedTracks: number[];
}

export interface NoteDiscrepancy {
  noteId: string;
  originalLevel: JudgeLevel;
  replayLevel: JudgeLevel;
  originalOffset: number;
  replayOffset: number;
}

export interface ReplayComparison {
  scoreMatch: boolean;
  originalScore: number;
  replayScore: number;
  maxComboMatch: boolean;
  originalMaxCombo: number;
  replayMaxCombo: number;
  statsMatch: boolean;
  originalStats: JudgeStats;
  replayStats: JudgeStats;
  noteDiscrepancies: NoteDiscrepancy[];
  consistencyRate: number;
}

export interface ReplaySummary {
  discrepancies: NoteDiscrepancy[];
  inputTrajectorySummary: {
    totalEvents: number;
    touchStarts: number;
    touchMoves: number;
    touchEnds: number;
    uniquePointers: number;
    duration: number;
  };
  failureBreakdown: Record<FailureCategory, number>;
  consistencyRate: number;
  scoreMatch: boolean;
  maxComboMatch: boolean;
}
