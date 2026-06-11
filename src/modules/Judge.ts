import {
  Note,
  NoteType,
  JudgeLevel,
  JudgeResult,
  JudgeRanges,
  InputEvent,
  Point,
  HoldState,
  FailureCategory,
  SlideWaypoint
} from '../types';

export type JudgeResultCallback = (result: JudgeResult) => void;
export type NoteMissCallback = (note: Note) => void;
export type HoldProgressCallback = (noteId: string, progress: number) => void;

interface PathCheckResult {
  complete: boolean;
  failureCategory?: FailureCategory;
  failureDetail?: {
    waypointIndex: number;
    expectedTrack: number;
    actualTrack?: number;
    reason: 'missing' | 'out_of_order' | 'early' | 'late';
  };
}

export class Judge {
  private judgeRanges: JudgeRanges;
  private pendingNotes: Map<string, Note> = new Map();
  private judgedNotes: Set<string> = new Set();
  private holdStates: Map<string, HoldState> = new Map();
  private pointerNoteMap: Map<number, string> = new Map();
  private resultCallback: JudgeResultCallback | null = null;
  private missCallback: NoteMissCallback | null = null;
  private holdProgressCallback: HoldProgressCallback | null = null;
  private getCurrentTime: () => number = () => performance.now();
  private practiceMode: boolean = false;

  constructor(ranges: JudgeRanges) {
    this.judgeRanges = { ...ranges };
  }

  setJudgeRanges(ranges: JudgeRanges): void {
    this.judgeRanges = { ...ranges };
  }

  getJudgeRanges(): JudgeRanges {
    return { ...this.judgeRanges };
  }

  setTimeProvider(provider: () => number): void {
    this.getCurrentTime = provider;
  }

  setPracticeMode(enabled: boolean): void {
    this.practiceMode = enabled;
  }

  setJudgeResultCallback(cb: JudgeResultCallback): void {
    this.resultCallback = cb;
  }

  setNoteMissCallback(cb: NoteMissCallback): void {
    this.missCallback = cb;
  }

  setHoldProgressCallback(cb: HoldProgressCallback): void {
    this.holdProgressCallback = cb;
  }

  registerPendingNote(note: Note): void {
    if (this.judgedNotes.has(note.id)) return;
    this.pendingNotes.set(note.id, note);
  }

  registerPendingNotes(notes: Note[]): void {
    notes.forEach(n => this.registerPendingNote(n));
  }

  isNoteJudged(noteId: string): boolean {
    return this.judgedNotes.has(noteId);
  }

  getPendingNotes(): Note[] {
    return Array.from(this.pendingNotes.values());
  }

  getJudgedNoteCount(): number {
    return this.judgedNotes.size;
  }

  handleInput(event: InputEvent): JudgeResult | null {
    if (event.type === 'touchstart') {
      return this.handleTapInput(event);
    } else if (event.type === 'touchend') {
      return this.handleReleaseInput(event);
    } else if (event.type === 'touchmove') {
      this.handleMoveUpdate(event);
      return null;
    }
    return null;
  }

  private handleTapInput(event: InputEvent): JudgeResult | null {
    const candidates = this.getCandidateNotes(event);
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => {
      const aIsHold = a.type === NoteType.HOLD || a.type === NoteType.SLIDE;
      const bIsHold = b.type === NoteType.HOLD || b.type === NoteType.SLIDE;
      const aOffset = event.time - a.time;
      const bOffset = event.time - b.time;
      if (aIsHold && bIsHold) {
        const aPast = aOffset > 0;
        const bPast = bOffset > 0;
        if (aPast !== bPast) return aPast ? -1 : 1;
        if (aPast) {
          return aOffset - bOffset;
        } else {
          const aAbs = Math.abs(aOffset);
          const bAbs = Math.abs(bOffset);
          if (aAbs <= this.judgeRanges.good * 4 || bAbs <= this.judgeRanges.good * 4) {
            return aAbs - bAbs;
          }
          return aOffset - bOffset;
        }
      }
      return Math.abs(aOffset) - Math.abs(bOffset);
    });
    for (const note of candidates) {
      if (this.pointerNoteMap.has(event.pointerId)) continue;
      if (this.judgedNotes.has(note.id)) continue;
      if (note.type === NoteType.TAP || note.type === NoteType.SWIPE) {
        return this.judgeTapNote(note, event);
      }
      if (note.type === NoteType.HOLD || note.type === NoteType.SLIDE) {
        this.startHoldNote(note, event);
        return null;
      }
    }
    return null;
  }

  private getCandidateNotes(event: InputEvent): Note[] {
    const currentTime = event.time;
    const track = event.track;
    const holdWindow = this.judgeRanges.good * 20;
    const tapWindow = this.judgeRanges.good * 2;
    const result: Note[] = [];
    for (const [id, note] of this.pendingNotes) {
      if (this.judgedNotes.has(id)) continue;
      if (this.holdStates.has(id)) continue;
      if (track !== undefined && note.track !== track) {
        if (note.type !== NoteType.SLIDE) continue;
        const endTrack = note.endTrack ?? note.track;
        if (note.track !== track && endTrack !== track) {
          const waypoints = note.slideWaypoints;
          if (!waypoints) continue;
          const trackList = waypoints.map(w => typeof w === 'number' ? w : w.track);
          if (!trackList.includes(track)) continue;
        }
      }
      const timeDiff = Math.abs(currentTime - note.time);
      if (note.type === NoteType.HOLD || note.type === NoteType.SLIDE) {
        if (timeDiff <= holdWindow) {
          result.push(note);
        }
      } else {
        if (timeDiff <= tapWindow) {
          result.push(note);
        }
      }
    }
    return result;
  }

  private judgeTapNote(note: Note, event: InputEvent): JudgeResult {
    const offset = event.time - note.time;
    const level = this.getJudgeLevel(offset);
    const failureCategory = level === JudgeLevel.MISS ? this.categorizeTapFailure(offset) : undefined;
    const result: JudgeResult = {
      noteId: note.id,
      level,
      offset,
      time: event.time,
      noteType: note.type,
      track: note.track,
      failureCategory
    };
    this.finalizeNote(note.id);
    this.emitResult(result);
    return result;
  }

  private startHoldNote(note: Note, event: InputEvent): void {
    const startOffset = event.time - note.time;
    const track = event.track ?? note.track;
    const visitedTracks = [track];
    const trackVisitTimes = [{ track, time: event.time }];
    this.holdStates.set(note.id, {
      noteId: note.id,
      startTime: event.time,
      startOffset,
      isHolding: true,
      pointerId: event.pointerId,
      lastTrack: track,
      visitedTracks,
      trackVisitTimes
    });
    this.pointerNoteMap.set(event.pointerId, note.id);
  }

  private handleMoveUpdate(event: InputEvent): void {
    const noteId = this.pointerNoteMap.get(event.pointerId);
    if (!noteId) return;
    const holdState = this.holdStates.get(noteId);
    if (holdState && event.track !== undefined) {
      holdState.lastTrack = event.track;
      const lastVisited = holdState.visitedTracks[holdState.visitedTracks.length - 1];
      if (lastVisited !== event.track) {
        holdState.visitedTracks.push(event.track);
        holdState.trackVisitTimes.push({ track: event.track, time: event.time });
      }
    }
    const note = this.pendingNotes.get(noteId);
    if (!note || !holdState) return;
    const endTime = note.endTime || note.time;
    const totalDuration = endTime - note.time;
    const currentDuration = event.time - holdState.startTime;
    const progress = Math.min(1, Math.max(0, currentDuration / totalDuration));
    if (this.holdProgressCallback) {
      this.holdProgressCallback(noteId, progress);
    }
  }

  private normalizeWaypoints(waypoints: Array<number | SlideWaypoint> | undefined): SlideWaypoint[] | null {
    if (!waypoints || waypoints.length === 0) return null;
    return waypoints.map(w => typeof w === 'number' ? { track: w } : w);
  }

  private checkPathComplete(note: Note, visitedTracks: number[]): PathCheckResult {
    const waypoints = this.normalizeWaypoints(note.slideWaypoints);
    if (!waypoints) return { complete: true };
    const result: PathCheckResult = { complete: false };
    let wpIdx = 0;
    let maxJVisited = -1;
    for (let i = 0; i < visitedTracks.length && wpIdx < waypoints.length; i++) {
      const t = visitedTracks[i];
      if (t === waypoints[wpIdx].track) {
        if (maxJVisited > wpIdx) {
          result.failureCategory = 'path_out_of_order';
          result.failureDetail = {
            waypointIndex: wpIdx,
            expectedTrack: waypoints[wpIdx].track,
            actualTrack: t,
            reason: 'out_of_order'
          };
          return result;
        }
        wpIdx++;
      } else {
        for (let j = 0; j < waypoints.length; j++) {
          if (t === waypoints[j].track) {
            if (j < wpIdx) {
              result.failureCategory = 'path_out_of_order';
              result.failureDetail = {
                waypointIndex: j,
                expectedTrack: waypoints[j].track,
                actualTrack: t,
                reason: 'out_of_order'
              };
              return result;
            }
            if (j > wpIdx) {
              maxJVisited = Math.max(maxJVisited, j);
            }
          }
        }
      }
    }
    if (wpIdx >= waypoints.length) {
      result.complete = true;
      return result;
    }
    if (maxJVisited > wpIdx) {
      result.failureCategory = 'path_incomplete';
      result.failureDetail = {
        waypointIndex: wpIdx,
        expectedTrack: waypoints[wpIdx].track,
        actualTrack: waypoints[maxJVisited].track,
        reason: 'missing'
      };
      return result;
    }
    result.failureCategory = 'path_incomplete';
    result.failureDetail = {
      waypointIndex: wpIdx,
      expectedTrack: waypoints[wpIdx].track,
      reason: 'missing'
    };
    return result;
  }

  private checkPathCompleteWithTiming(
    note: Note,
    trackVisitTimes: Array<{ track: number; time: number }>
  ): PathCheckResult {
    const waypoints = this.normalizeWaypoints(note.slideWaypoints);
    if (!waypoints) return { complete: true };
    const endTime = note.endTime || note.time;
    const totalDuration = endTime - note.time;
    const orderResult = this.checkPathComplete(note, trackVisitTimes.map(t => t.track));
    if (!orderResult.complete && orderResult.failureCategory !== 'path_incomplete') {
      return orderResult;
    }
    let wpIdx = 0;
    for (const visit of trackVisitTimes) {
      if (wpIdx >= waypoints.length) break;
      if (visit.track !== waypoints[wpIdx].track) continue;
      const wp = waypoints[wpIdx];
      const visitOffset = visit.time - note.time;
      const progress = totalDuration > 0 ? visitOffset / totalDuration : 0;
      if (wp.minTime !== undefined && visitOffset < wp.minTime) {
        return {
          complete: false,
          failureCategory: 'path_early',
          failureDetail: {
            waypointIndex: wpIdx,
            expectedTrack: wp.track,
            actualTrack: visit.track,
            reason: 'early'
          }
        };
      }
      if (wp.maxTime !== undefined && visitOffset > wp.maxTime) {
        return {
          complete: false,
          failureCategory: 'path_late',
          failureDetail: {
            waypointIndex: wpIdx,
            expectedTrack: wp.track,
            actualTrack: visit.track,
            reason: 'late'
          }
        };
      }
      if (wp.minProgress !== undefined && progress < wp.minProgress) {
        return {
          complete: false,
          failureCategory: 'path_early',
          failureDetail: {
            waypointIndex: wpIdx,
            expectedTrack: wp.track,
            actualTrack: visit.track,
            reason: 'early'
          }
        };
      }
      if (wp.maxProgress !== undefined && progress > wp.maxProgress) {
        return {
          complete: false,
          failureCategory: 'path_late',
          failureDetail: {
            waypointIndex: wpIdx,
            expectedTrack: wp.track,
            actualTrack: visit.track,
            reason: 'late'
          }
        };
      }
      wpIdx++;
    }
    if (wpIdx >= waypoints.length) {
      return { complete: true };
    }
    return orderResult;
  }

  private handleReleaseInput(event: InputEvent): JudgeResult | null {
    const noteId = this.pointerNoteMap.get(event.pointerId);
    if (!noteId) return null;
    const note = this.pendingNotes.get(noteId);
    const holdState = this.holdStates.get(noteId);
    if (!note || !holdState) {
      this.pointerNoteMap.delete(event.pointerId);
      return null;
    }
    const actualEndTrack = event.track ?? holdState.lastTrack;
    if (event.track !== undefined) {
      holdState.lastTrack = event.track;
      const lastVisited = holdState.visitedTracks[holdState.visitedTracks.length - 1];
      if (lastVisited !== event.track) {
        holdState.visitedTracks.push(event.track);
        holdState.trackVisitTimes.push({ track: event.track, time: event.time });
      }
    }
    if (note.type === NoteType.HOLD) {
      return this.endHoldNote(note, event, holdState, actualEndTrack, false);
    }
    if (note.type === NoteType.SLIDE) {
      return this.endSlideNote(note, event, holdState, actualEndTrack, false);
    }
    this.pointerNoteMap.delete(event.pointerId);
    this.holdStates.delete(noteId);
    return null;
  }

  private categorizeTapFailure(offset: number): FailureCategory {
    if (offset < -this.judgeRanges.good) return 'early_press';
    if (offset > this.judgeRanges.good) return 'late_press';
    return 'no_input';
  }

  private categorizeHoldFailure(
    startLevel: JudgeLevel,
    holdRatio: number,
    autoSettled: boolean,
    startOffset: number
  ): FailureCategory {
    if (autoSettled) return 'timeout';
    if (startLevel === JudgeLevel.MISS) {
      return startOffset < 0 ? 'early_press' : 'late_press';
    }
    if (holdRatio < 0.5) return 'short_hold';
    return 'no_input';
  }

  private categorizeSlideFailure(
    trackMatch: boolean,
    pathCheck: PathCheckResult,
    startLevel: JudgeLevel,
    holdRatio: number,
    autoSettled: boolean,
    startOffset: number
  ): FailureCategory {
    if (autoSettled) return 'timeout';
    if (!trackMatch) return 'wrong_track';
    if (pathCheck.failureCategory) return pathCheck.failureCategory;
    if (startLevel === JudgeLevel.MISS) {
      return startOffset < 0 ? 'early_press' : 'late_press';
    }
    if (holdRatio < 0.5) return 'short_hold';
    return 'no_input';
  }

  private endHoldNote(
    note: Note,
    event: InputEvent,
    holdState: HoldState,
    actualEndTrack: number,
    autoSettled: boolean
  ): JudgeResult {
    const endTime = note.endTime || note.time;
    const releaseOffset = event.time - endTime;
    const holdDuration = event.time - holdState.startTime;
    const totalDuration = endTime - note.time;
    const holdRatio = totalDuration > 0 ? Math.min(1, holdDuration / totalDuration) : 1;
    const startLevel = this.getJudgeLevel(holdState.startOffset);
    let level: JudgeLevel;
    if (startLevel === JudgeLevel.MISS) {
      level = JudgeLevel.MISS;
    } else if (holdRatio >= 0.95 && Math.abs(releaseOffset) <= this.judgeRanges.perfect) {
      level = JudgeLevel.PERFECT;
    } else if (holdRatio >= 0.8 && Math.abs(releaseOffset) <= this.judgeRanges.good) {
      level = JudgeLevel.GOOD;
    } else if (holdRatio >= 0.5) {
      level = JudgeLevel.GOOD;
    } else {
      level = JudgeLevel.MISS;
    }
    if (this.practiceMode && level === JudgeLevel.MISS && startLevel !== JudgeLevel.MISS && holdRatio >= 0.5) {
      level = JudgeLevel.GOOD;
    }
    const failureCategory = level === JudgeLevel.MISS
      ? this.categorizeHoldFailure(startLevel, holdRatio, autoSettled, holdState.startOffset)
      : undefined;
    const result: JudgeResult = {
      noteId: note.id,
      level,
      offset: releaseOffset,
      time: event.time,
      noteType: note.type,
      track: note.track,
      startOffset: holdState.startOffset,
      actualEndTrack,
      autoSettled,
      failureCategory
    };
    this.pointerNoteMap.delete(event.pointerId);
    this.holdStates.delete(note.id);
    this.finalizeNote(note.id);
    this.emitResult(result);
    return result;
  }

  private endSlideNote(
    note: Note,
    event: InputEvent,
    holdState: HoldState,
    actualEndTrack: number,
    autoSettled: boolean
  ): JudgeResult {
    const endTime = note.endTime || note.time;
    const endTrack = note.endTrack ?? note.track;
    const releaseOffset = event.time - endTime;
    const trackMatch = actualEndTrack === endTrack;
    const holdDuration = event.time - holdState.startTime;
    const totalDuration = endTime - note.time;
    const holdRatio = totalDuration > 0 ? Math.min(1, holdDuration / totalDuration) : 1;
    const startLevel = this.getJudgeLevel(holdState.startOffset);
    const pathCheck = this.checkPathCompleteWithTiming(note, holdState.trackVisitTimes);
    let level: JudgeLevel;
    if (!trackMatch) {
      level = JudgeLevel.MISS;
    } else if (!pathCheck.complete) {
      level = JudgeLevel.MISS;
    } else if (startLevel === JudgeLevel.MISS) {
      level = JudgeLevel.MISS;
    } else if (holdRatio >= 0.95 && Math.abs(releaseOffset) <= this.judgeRanges.perfect) {
      level = JudgeLevel.PERFECT;
    } else if (holdRatio >= 0.8 && Math.abs(releaseOffset) <= this.judgeRanges.good) {
      level = JudgeLevel.GOOD;
    } else if (holdRatio >= 0.5) {
      level = JudgeLevel.GOOD;
    } else {
      level = JudgeLevel.MISS;
    }
    if (level === JudgeLevel.MISS && (!trackMatch || !pathCheck.complete)) {
    } else if (this.practiceMode && level === JudgeLevel.MISS && startLevel !== JudgeLevel.MISS && trackMatch && pathCheck.complete && holdRatio >= 0.5) {
      level = JudgeLevel.GOOD;
    }
    const failureCategory = level === JudgeLevel.MISS
      ? this.categorizeSlideFailure(trackMatch, pathCheck, startLevel, holdRatio, autoSettled, holdState.startOffset)
      : undefined;
    const result: JudgeResult = {
      noteId: note.id,
      level,
      offset: releaseOffset,
      time: event.time,
      noteType: note.type,
      track: note.track,
      endTrack,
      startOffset: holdState.startOffset,
      actualEndTrack,
      autoSettled,
      pathComplete: pathCheck.complete,
      failureCategory,
      pathFailureDetail: pathCheck.failureDetail
    };
    this.pointerNoteMap.delete(event.pointerId);
    this.holdStates.delete(note.id);
    this.finalizeNote(note.id);
    this.emitResult(result);
    return result;
  }

  checkMissedNotes(currentTime?: number): Note[] {
    const time = currentTime ?? this.getCurrentTime();
    const missWindow = this.judgeRanges.good;
    const missed: Note[] = [];
    for (const [id, note] of this.pendingNotes) {
      if (this.judgedNotes.has(id)) continue;
      if (this.holdStates.has(id)) continue;
      let missThreshold: number;
      if (note.type === NoteType.HOLD || note.type === NoteType.SLIDE) {
        const endTime = note.endTime || note.time;
        missThreshold = endTime + missWindow;
      } else {
        missThreshold = note.time + missWindow;
      }
      if (time > missThreshold) {
        missed.push(note);
        const failureCategory: FailureCategory = 'no_input';
        const result: JudgeResult = {
          noteId: id,
          level: JudgeLevel.MISS,
          offset: time - note.time,
          time: time,
          noteType: note.type,
          track: note.track,
          endTrack: note.type === NoteType.SLIDE ? note.endTrack : undefined,
          autoSettled: true,
          failureCategory
        };
        this.finalizeNote(id);
        this.emitResult(result);
        if (this.missCallback) {
          this.missCallback(note);
        }
      }
    }
    return missed;
  }

  update(currentTime: number): void {
    this.checkMissedNotes(currentTime);
    this.checkAutoHoldCompletion(currentTime);
  }

  private checkAutoHoldCompletion(currentTime: number): void {
    const toComplete: Array<{
      noteId: string;
      note: Note;
      state: HoldState;
    }> = [];
    for (const [noteId, state] of this.holdStates) {
      const note = this.pendingNotes.get(noteId);
      if (!note) continue;
      const endTime = note.endTime || note.time;
      if (currentTime > endTime + this.judgeRanges.good) {
        if (state.isHolding) {
          toComplete.push({ noteId, note, state });
        }
      }
    }
    for (const { note, state } of toComplete) {
      const fakeEvent: InputEvent = {
        id: -1,
        type: 'touchend',
        x: 0,
        y: 0,
        time: currentTime,
        pointerId: state.pointerId,
        track: state.lastTrack
      };
      const actualEndTrack = state.lastTrack;
      if (note.type === NoteType.HOLD) {
        this.endHoldNote(note, fakeEvent, state, actualEndTrack, true);
      } else if (note.type === NoteType.SLIDE) {
        this.endSlideNote(note, fakeEvent, state, actualEndTrack, true);
      }
    }
  }

  private getJudgeLevel(offset: number): JudgeLevel {
    const absOffset = Math.abs(offset);
    if (absOffset <= this.judgeRanges.perfect) {
      return JudgeLevel.PERFECT;
    } else if (absOffset <= this.judgeRanges.good) {
      return JudgeLevel.GOOD;
    }
    return JudgeLevel.MISS;
  }

  private finalizeNote(noteId: string): void {
    this.judgedNotes.add(noteId);
    this.pendingNotes.delete(noteId);
  }

  private emitResult(result: JudgeResult): void {
    if (this.resultCallback) {
      try {
        this.resultCallback(result);
      } catch (e) {
        console.error('Judge result callback error:', e);
      }
    }
  }

  calculateDistance(point1: Point, point2: Point): number {
    const dx = point1.x - point2.x;
    const dy = point1.y - point2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  reset(): void {
    this.pendingNotes.clear();
    this.judgedNotes.clear();
    this.holdStates.clear();
    this.pointerNoteMap.clear();
  }

  destroy(): void {
    this.reset();
    this.resultCallback = null;
    this.missCallback = null;
    this.holdProgressCallback = null;
  }
}
