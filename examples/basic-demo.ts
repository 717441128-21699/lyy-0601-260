import {
  RhythmSDK,
  ChartData,
  NoteType,
  JudgeLevel,
  GameState,
  GameResult,
  JudgeResult,
  createDifficultyConfig,
  ChartReader,
  ComboCounter,
  ResultGenerator,
  Judge,
  FailureCategory,
  SlideWaypoint,
  PlaybackData,
  BatchReplayResult
} from '../src/index';

if (typeof requestAnimationFrame === 'undefined') {
  (global as any).requestAnimationFrame = (cb: FrameRequestCallback): number => {
    return setTimeout(() => cb(performance.now()), 16) as unknown as number;
  };
  (global as any).cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
}

function createSampleChart(): ChartData {
  const notes = [];
  let noteId = 0;
  const trackCount = 4;
  for (let i = 0; i < 20; i++) {
    const time = 1000 + i * 500;
    const track = i % trackCount;
    notes.push({
      id: `note-${noteId++}`,
      type: NoteType.TAP,
      time,
      track
    });
  }
  notes.push({
    id: `note-${noteId++}`,
    type: NoteType.HOLD,
    time: 12000,
    track: 1,
    endTime: 14000
  });
  notes.push({
    id: `note-${noteId++}`,
    type: NoteType.SLIDE,
    time: 15000,
    track: 0,
    endTime: 17000,
    endTrack: 3
  });
  return {
    title: 'Demo Song',
    difficulty: 'normal',
    bpm: 120,
    duration: 20000,
    notes,
    offset: 0
  };
}

type TestFn = () => void | Promise<void>;

const testResults: Array<{ name: string; passed: boolean; error?: string }> = [];

async function runTest(name: string, fn: TestFn): Promise<void> {
  try {
    const result = fn();
    if (result instanceof Promise) {
      await result;
    }
    testResults.push({ name, passed: true });
    console.log(`✅ ${name} 测试通过`);
  } catch (e: any) {
    testResults.push({ name, passed: false, error: e?.message || String(e) });
    console.error(`❌ ${name} 测试失败:`, e);
  }
}

function printFinalSummary(): void {
  const passed = testResults.filter(r => r.passed).length;
  const total = testResults.length;
  console.log('\n========================================');
  console.log(`所有测试完成: ${passed}/${total} 项通过`);
  if (passed === total) {
    console.log('🎉 全部测试通过！');
  } else {
    console.log('⚠️  以下测试失败:');
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`   - ${r.name}: ${r.error}`);
    });
  }
  console.log('========================================');
  process.exit(passed === total ? 0 : 1);
}

function testChartReader(): void {
  console.log('\n=== 测试谱面读取模块 ===');
  const reader = new ChartReader();
  const chart = createSampleChart();
  reader.loadChart(chart);
  console.log('谱面标题:', reader.getChart()?.title);
  console.log('BPM:', reader.getBpmAtTime(0));
  console.log('音符总数:', reader.getTotalNoteCount());
  console.log('谱面时长:', reader.getDuration(), 'ms');
  const upcoming = reader.getUpcomingNotes(2000, 1000);
  console.log('时间点 2000ms 附近的音符数:', upcoming.length);
}

function testComboCounter(): void {
  console.log('\n=== 测试连击统计模块 ===');
  const counter = new ComboCounter({
    perfect: 1000, good: 500, miss: 0, comboBonus: 10
  });
  for (let i = 0; i < 5; i++) counter.processJudge(JudgeLevel.PERFECT);
  console.log('5次PERFECT后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
  counter.processJudge(JudgeLevel.MISS);
  console.log('1次MISS后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
  counter.reset();
  console.log('重置后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
}

function testJudgeModule(): void {
  console.log('\n=== 测试判定计算模块 ===');
  const judge = new Judge({ perfect: 50, good: 120 });
  let mockTime = 1000;
  judge.setTimeProvider(() => mockTime);
  const chart = createSampleChart();
  judge.registerPendingNotes(chart.notes);
  console.log('待判定音符数:', judge.getPendingNotes().length);
  const perfectTap = judge.handleInput({
    id: 1, type: 'touchstart', x: 50, y: 500, time: 1005, pointerId: 0, track: 0
  });
  console.log('PERFECT点击判定结果:', perfectTap ? `level=${perfectTap.level}, offset=${perfectTap.offset}ms` : '无');
  mockTime = 3000;
  const missed = judge.checkMissedNotes();
  console.log('超时Miss音符数:', missed.length);
  judge.reset();
}

function testHoldSlideSettleOnRelease(): void {
  console.log('\n=== 测试HOLD/SLIDE松手才结算(含极端偏移) ===');
  const judge = new Judge({ perfect: 100, good: 200 });
  let mockTime = 0;
  judge.setTimeProvider(() => mockTime);
  const results: JudgeResult[] = [];
  judge.setJudgeResultCallback(r => results.push(r));

  const chart: ChartData = {
    title: 'Settle Test',
    difficulty: 'normal',
    bpm: 120,
    duration: 10000,
    notes: [
      { id: 'hold-veryearly', type: NoteType.HOLD, time: 3000, track: 0, endTime: 4500 },
      { id: 'hold-early', type: NoteType.HOLD, time: 1000, track: 1, endTime: 2500 },
      { id: 'hold-late', type: NoteType.HOLD, time: 3000, track: 2, endTime: 4500 },
      { id: 'slide-early', type: NoteType.SLIDE, time: 5000, track: 0, endTime: 6500, endTrack: 3 }
    ]
  };
  judge.registerPendingNotes(chart.notes);

  mockTime = 500;
  const holdVeryEarlyStart = judge.handleInput({
    id: 100, type: 'touchstart', x: 50, y: 500, time: mockTime, pointerId: 99, track: 0
  });
  if (holdVeryEarlyStart !== null) throw new Error('HOLD极早按: 按下不应产生判定');
  const rc00: number = results.length;
  if (rc00 !== 0) throw new Error('HOLD极早按: 按下时不应有结算, 实际: ' + rc00);
  console.log('HOLD极早按(偏移-2500ms)按下: 无判定 ✓');

  mockTime = 4530;
  const holdVeryEarlyEnd = judge.handleInput({
    id: 101, type: 'touchend', x: 50, y: 500, time: mockTime, pointerId: 99, track: 0
  });
  if (!holdVeryEarlyEnd) throw new Error('HOLD极早按: 松手应产生判定');
  const rc01: number = results.length;
  if (rc01 !== 1) throw new Error('HOLD极早按: 只应结算一次, 实际: ' + rc01);
  if (holdVeryEarlyEnd.startOffset === undefined) throw new Error('HOLD极早按: 应携带 startOffset');
  if (holdVeryEarlyEnd.startOffset !== -2500) throw new Error('HOLD极早按: startOffset 应为 -2500, 实际: ' + holdVeryEarlyEnd.startOffset);
  console.log('HOLD极早按松手: level=' + holdVeryEarlyEnd.level + ', startOffset=' + holdVeryEarlyEnd.startOffset + 'ms, 只结算1次 ✓');

  mockTime = 500;
  const holdEarlyStart = judge.handleInput({
    id: 1, type: 'touchstart', x: 150, y: 500, time: mockTime, pointerId: 10, track: 1
  });
  if (holdEarlyStart !== null) throw new Error('HOLD早按: 按下不应产生判定');
  const rc0: number = results.length;
  if (rc0 !== 1) throw new Error('HOLD早按: 按下时不应有新结算, 实际: ' + rc0);
  console.log('HOLD早按(偏移-500ms)按下: 无判定 ✓');

  mockTime = 2530;
  const holdEarlyEnd = judge.handleInput({
    id: 2, type: 'touchend', x: 150, y: 500, time: mockTime, pointerId: 10, track: 1
  });
  if (!holdEarlyEnd) throw new Error('HOLD早按: 松手应产生判定');
  const rc1: number = results.length;
  if (rc1 !== 2) throw new Error('HOLD早按: 只应结算一次, 实际: ' + rc1);
  if (holdEarlyEnd.startOffset === undefined) throw new Error('HOLD早按: 应携带 startOffset');
  if (holdEarlyEnd.level !== JudgeLevel.MISS) throw new Error('HOLD早按(startOffset超窗): 应判 MISS, 实际: ' + holdEarlyEnd.level);
  if (holdEarlyEnd.failureCategory !== 'early_press') throw new Error('HOLD早按: failureCategory 应为 early_press, 实际: ' + holdEarlyEnd.failureCategory);
  console.log('HOLD早按松手: level=' + holdEarlyEnd.level + ', startOffset=' + holdEarlyEnd.startOffset.toFixed(0) + 'ms, failure=' + holdEarlyEnd.failureCategory + ' ✓');

  mockTime = 3800;
  judge.handleInput({
    id: 3, type: 'touchstart', x: 250, y: 500, time: mockTime, pointerId: 11, track: 2
  });
  mockTime = 4530;
  const holdLateEnd = judge.handleInput({
    id: 4, type: 'touchend', x: 250, y: 500, time: mockTime, pointerId: 11, track: 2
  });
  if (!holdLateEnd) throw new Error('HOLD晚按: 松手应产生判定');
  if (holdLateEnd.startOffset === undefined) throw new Error('HOLD晚按: 应携带 startOffset');
  console.log('HOLD晚按松手: level=' + holdLateEnd.level + ', startOffset=' + holdLateEnd.startOffset.toFixed(0) + 'ms ✓');

  mockTime = 4200;
  judge.handleInput({
    id: 5, type: 'touchstart', x: 50, y: 500, time: mockTime, pointerId: 12, track: 0
  });
  mockTime = 6530;
  const slideEarlyEnd = judge.handleInput({
    id: 6, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 12, track: 3
  });
  if (!slideEarlyEnd) throw new Error('SLIDE早按: 松手应产生判定');
  if (slideEarlyEnd.startOffset === undefined) throw new Error('SLIDE早按: 应携带 startOffset');
  console.log('SLIDE早按松手: level=' + slideEarlyEnd.level + ', startOffset=' + slideEarlyEnd.startOffset.toFixed(0) + 'ms, pathComplete=' + slideEarlyEnd.pathComplete + ' ✓');

  console.log('✅ HOLD/SLIDE 极端偏移仍绑定手指，松手统一结算');
}

function testSlideWaypointDetailed(): void {
  console.log('\n=== 测试滑动音符路径校验(详细:顺序/时间) ===');
  const judge = new Judge({ perfect: 100, good: 200 });
  let mockTime = 0;
  judge.setTimeProvider(() => mockTime);
  const results: JudgeResult[] = [];
  judge.setJudgeResultCallback(r => results.push(r));

  const waypointsTimed: SlideWaypoint[] = [
    { track: 0, minProgress: 0.0, maxProgress: 0.2 },
    { track: 1, minProgress: 0.3, maxProgress: 0.5 },
    { track: 3, minProgress: 0.7, maxProgress: 0.9 }
  ];

  const notes = [
    {
      id: 'slide-ok-timed',
      type: NoteType.SLIDE,
      time: 1000,
      track: 0,
      endTime: 3000,
      endTrack: 3,
      slideWaypoints: waypointsTimed
    },
    {
      id: 'slide-early-wp1',
      type: NoteType.SLIDE,
      time: 4000,
      track: 0,
      endTime: 6000,
      endTrack: 3,
      slideWaypoints: waypointsTimed
    },
    {
      id: 'slide-late-wp2',
      type: NoteType.SLIDE,
      time: 7000,
      track: 0,
      endTime: 9000,
      endTrack: 3,
      slideWaypoints: waypointsTimed
    },
    {
      id: 'slide-outoforder',
      type: NoteType.SLIDE,
      time: 10000,
      track: 0,
      endTime: 12000,
      endTrack: 3,
      slideWaypoints: [0, 1, 3]
    }
  ];
  judge.registerPendingNotes(notes);

  mockTime = 1020;
  judge.handleInput({ id: 10, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 1, track: 0 });
  mockTime = 1600;
  judge.handleInput({ id: 11, type: 'touchmove', x: 150, y: 500, time: mockTime, pointerId: 1, track: 1 });
  mockTime = 2400;
  judge.handleInput({ id: 12, type: 'touchmove', x: 350, y: 500, time: mockTime, pointerId: 1, track: 3 });
  mockTime = 3020;
  judge.handleInput({ id: 13, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 1, track: 3 });
  const okTimed = results.find(r => r.noteId === 'slide-ok-timed');
  if (!okTimed) throw new Error('定时路径SLIDE应产生判定');
  if (okTimed.level === JudgeLevel.MISS) throw new Error('定时路径SLIDE不应判 MISS, 实际: ' + okTimed.level + ' fc=' + okTimed.failureCategory);
  if (okTimed.pathComplete !== true) throw new Error('pathComplete 应为 true');
  console.log('定时路径0→1→3(按进度范围): level=' + okTimed.level + ', pathComplete=' + okTimed.pathComplete + ' ✓');

  mockTime = 4020;
  judge.handleInput({ id: 20, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 2, track: 0 });
  mockTime = 4200;
  judge.handleInput({ id: 21, type: 'touchmove', x: 150, y: 500, time: mockTime, pointerId: 2, track: 1 });
  mockTime = 5500;
  judge.handleInput({ id: 22, type: 'touchmove', x: 350, y: 500, time: mockTime, pointerId: 2, track: 3 });
  mockTime = 6020;
  judge.handleInput({ id: 23, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 2, track: 3 });
  const earlyWp1 = results.find(r => r.noteId === 'slide-early-wp1');
  if (!earlyWp1) throw new Error('wp1太早应产生判定');
  if (earlyWp1.level !== JudgeLevel.MISS) throw new Error('wp1太早(progress0.1<0.3)应判 MISS, 实际: ' + earlyWp1.level + ' fc=' + earlyWp1.failureCategory);
  if (earlyWp1.failureCategory !== 'path_early') throw new Error('failureCategory 应为 path_early, 实际: ' + earlyWp1.failureCategory);
  if (!earlyWp1.pathFailureDetail || earlyWp1.pathFailureDetail.reason !== 'early') {
    throw new Error('pathFailureDetail.reason 应为 early, 实际: ' + JSON.stringify(earlyWp1.pathFailureDetail));
  }
  console.log('wp1太早(progress0.1<0.3): MISS, failure=' + earlyWp1.failureCategory + ', detail=' + JSON.stringify(earlyWp1.pathFailureDetail) + ' ✓');

  mockTime = 7020;
  judge.handleInput({ id: 30, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 3, track: 0 });
  mockTime = 7800;
  judge.handleInput({ id: 31, type: 'touchmove', x: 150, y: 500, time: mockTime, pointerId: 3, track: 1 });
  mockTime = 8900;
  judge.handleInput({ id: 32, type: 'touchmove', x: 350, y: 500, time: mockTime, pointerId: 3, track: 3 });
  mockTime = 9020;
  judge.handleInput({ id: 33, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 3, track: 3 });
  const lateWp2 = results.find(r => r.noteId === 'slide-late-wp2');
  if (!lateWp2) throw new Error('wp2太晚应产生判定');
  if (lateWp2.level !== JudgeLevel.MISS) throw new Error('wp2太晚(progress0.95>0.9) 应为 MISS, 实际: ' + lateWp2.level);
  if (lateWp2.failureCategory !== 'path_late') throw new Error('failureCategory 应为 path_late, 实际: ' + lateWp2.failureCategory);
  console.log('wp2太晚: MISS, failure=' + lateWp2.failureCategory + ' ✓');

  mockTime = 10020;
  judge.handleInput({ id: 40, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 4, track: 0 });
  mockTime = 10500;
  judge.handleInput({ id: 41, type: 'touchmove', x: 350, y: 500, time: mockTime, pointerId: 4, track: 3 });
  mockTime = 10800;
  judge.handleInput({ id: 42, type: 'touchmove', x: 150, y: 500, time: mockTime, pointerId: 4, track: 1 });
  mockTime = 12020;
  judge.handleInput({ id: 43, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 4, track: 3 });
  const outOfOrder = results.find(r => r.noteId === 'slide-outoforder');
  if (!outOfOrder) throw new Error('顺序错应产生判定');
  if (outOfOrder.level !== JudgeLevel.MISS) throw new Error('顺序错(0→3→1→3)应判 MISS, 实际: ' + outOfOrder.level);
  if (outOfOrder.failureCategory !== 'path_out_of_order') throw new Error('failureCategory 应为 path_out_of_order, 实际: ' + outOfOrder.failureCategory);
  if (!outOfOrder.pathFailureDetail || outOfOrder.pathFailureDetail.reason !== 'out_of_order') {
    throw new Error('pathFailureDetail.reason 应为 out_of_order, 实际: ' + JSON.stringify(outOfOrder.pathFailureDetail));
  }
  console.log('顺序错(0→3→1→3): MISS, failure=' + outOfOrder.failureCategory + ', detail=' + JSON.stringify(outOfOrder.pathFailureDetail) + ' ✓');

  console.log('✅ 滑动路径详细校验(顺序/时间)通过');
}

function testSlideWaypointPath(): void {
  console.log('\n=== 测试滑动音符路径校验(基础) ===');
  const judge = new Judge({ perfect: 100, good: 200 });
  let mockTime = 0;
  judge.setTimeProvider(() => mockTime);
  const results: JudgeResult[] = [];
  judge.setJudgeResultCallback(r => results.push(r));

  const notes = [
    {
      id: 'slide-waypoint-ok',
      type: NoteType.SLIDE,
      time: 1000,
      track: 0,
      endTime: 3000,
      endTrack: 3,
      slideWaypoints: [0, 1, 3]
    },
    {
      id: 'slide-waypoint-skip',
      type: NoteType.SLIDE,
      time: 4000,
      track: 0,
      endTime: 6000,
      endTrack: 3,
      slideWaypoints: [0, 1, 3]
    }
  ];
  judge.registerPendingNotes(notes);

  mockTime = 1050;
  judge.handleInput({ id: 10, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 1, track: 0 });
  mockTime = 1500;
  judge.handleInput({ id: 11, type: 'touchmove', x: 150, y: 500, time: mockTime, pointerId: 1, track: 1 });
  mockTime = 2000;
  judge.handleInput({ id: 12, type: 'touchmove', x: 250, y: 500, time: mockTime, pointerId: 1, track: 2 });
  mockTime = 2500;
  judge.handleInput({ id: 13, type: 'touchmove', x: 350, y: 500, time: mockTime, pointerId: 1, track: 3 });
  mockTime = 3030;
  judge.handleInput({ id: 14, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 1, track: 3 });
  const okResult = results.find(r => r.noteId === 'slide-waypoint-ok');
  if (!okResult) throw new Error('路径完整SLIDE应产生判定');
  if (okResult.level === JudgeLevel.MISS) throw new Error('按路径0→1→3滑到终点不应判 MISS');
  if (okResult.pathComplete !== true) throw new Error('pathComplete 应为 true');
  console.log('0→1→3(经1轨): level=' + okResult.level + ', pathComplete=' + okResult.pathComplete + ' ✓');

  mockTime = 4050;
  judge.handleInput({ id: 20, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 2, track: 0 });
  mockTime = 5000;
  judge.handleInput({ id: 21, type: 'touchmove', x: 350, y: 500, time: mockTime, pointerId: 2, track: 3 });
  mockTime = 6030;
  judge.handleInput({ id: 22, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 2, track: 3 });
  const skipResult = results.find(r => r.noteId === 'slide-waypoint-skip');
  if (!skipResult) throw new Error('跳过中间点SLIDE应产生判定');
  if (skipResult.level !== JudgeLevel.MISS) throw new Error('跳过1轨直接到3应判 MISS, 实际: ' + skipResult.level);
  if (skipResult.pathComplete === true) throw new Error('pathComplete 不应为 true');
  if (skipResult.failureCategory !== 'path_incomplete') throw new Error('failureCategory 应为 path_incomplete, 实际: ' + skipResult.failureCategory);
  console.log('0→3(跳过1轨): MISS, pathComplete=' + skipResult.pathComplete + ', failure=' + skipResult.failureCategory + ' ✓');

  console.log('✅ 基础滑动路径校验通过');
}

function testSlideTrackAndFailureCategory(): void {
  console.log('\n=== 测试滑动轨道+失败分类 ===');
  const judge = new Judge({ perfect: 100, good: 200 });
  let mockTime = 0;
  judge.setTimeProvider(() => mockTime);
  const results: JudgeResult[] = [];
  judge.setJudgeResultCallback(r => results.push(r));
  judge.registerPendingNotes([{
    id: 'slide-wrong',
    type: NoteType.SLIDE,
    time: 1000,
    track: 0,
    endTime: 2500,
    endTrack: 3
  }]);
  mockTime = 1050;
  judge.handleInput({ id: 30, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 5, track: 0 });
  mockTime = 2530;
  judge.handleInput({ id: 31, type: 'touchend', x: 150, y: 500, time: mockTime, pointerId: 5, track: 1 });
  const r = results.find(x => x.noteId === 'slide-wrong');
  if (!r) throw new Error('应产生判定');
  if (r.level !== JudgeLevel.MISS) throw new Error('停在1轨应 MISS');
  if (r.failureCategory !== 'wrong_track') throw new Error('failureCategory 应为 wrong_track, 实际: ' + r.failureCategory);
  console.log('0→1轨(应到3): MISS, failure=wrong_track ✓');

  const noInputJudge = new Judge({ perfect: 100, good: 200 });
  let nmt = 0;
  noInputJudge.setTimeProvider(() => nmt);
  const noInputResults: JudgeResult[] = [];
  noInputJudge.setJudgeResultCallback(r => noInputResults.push(r));
  noInputJudge.registerPendingNotes([{
    id: 'slide-noinput',
    type: NoteType.SLIDE,
    time: 1000,
    track: 0,
    endTime: 2500,
    endTrack: 3
  }]);
  nmt = 3000;
  noInputJudge.checkMissedNotes();
  const nr = noInputResults.find(x => x.noteId === 'slide-noinput');
  if (!nr) throw new Error('无输入应产生判定');
  if (nr.failureCategory !== 'no_input') throw new Error('无输入 failureCategory 应为 no_input, 实际: ' + nr.failureCategory);
  console.log('未输入超时: MISS, failure=no_input ✓');

  console.log('✅ 失败分类验证通过');
}

function testResultGenerator(): void {
  console.log('\n=== 测试结果输出模块 ===');
  const generator = new ResultGenerator();
  const chart = createSampleChart();
  generator.setChartNotes(chart.notes);
  const judgeResults: JudgeResult[] = [];
  for (let i = 0; i < 15; i++) {
    judgeResults.push({
      noteId: `note-${i}`, level: JudgeLevel.PERFECT,
      offset: 10, time: chart.notes[i].time,
      noteType: chart.notes[i].type, track: chart.notes[i].track
    });
  }
  judgeResults.push({
    noteId: `note-20`, level: JudgeLevel.MISS, offset: 200,
    time: 12200, noteType: NoteType.HOLD, track: 1,
    startOffset: -500, actualEndTrack: 1, autoSettled: true,
    failureCategory: 'early_press'
  });
  judgeResults.push({
    noteId: `note-21`, level: JudgeLevel.MISS, offset: 10,
    time: 15500, noteType: NoteType.SLIDE, track: 0,
    endTrack: 3, startOffset: 15, actualEndTrack: 1,
    pathComplete: false, failureCategory: 'wrong_track',
    pathFailureDetail: { waypointIndex: 2, expectedTrack: 3, actualTrack: 1, reason: 'missing' }
  });
  generator.setJudgeResults(judgeResults);
  generator.setInputEvents([]);
  const debugList = generator.generateNoteDebugList();
  const slideDebug = debugList.find(d => d.noteId === 'note-21');
  if (!slideDebug) throw new Error('调试列表应包含 note-21');
  if (!slideDebug.pathFailureDetail) throw new Error('调试列表应包含 pathFailureDetail');
  if (!slideDebug.pathFailureDetail.includes('reason=missing')) {
    throw new Error('pathFailureDetail 应包含 reason=missing');
  }
  const report = generator.generateSummaryReport();
  if (!report.includes('路径:')) throw new Error('报告应包含路径失败明细');
  if (!report.includes('失败:wrong_track')) throw new Error('报告应包含失败分类');
  console.log('SLIDE调试: pathComplete=' + slideDebug.pathComplete + ', failure=' + slideDebug.failureCategory + ', detail=' + slideDebug.pathFailureDetail + ' ✓');
}

function testDifficultyConfig(): void {
  console.log('\n=== 测试难度配置 ===');
  console.log('默认判定区间:', createDifficultyConfig().judgeRanges);
  console.log('Easy判定区间:', createDifficultyConfig('easy').judgeRanges);
}

function testOfflineReplayConsistency(): void {
  console.log('\n=== 测试离线回放稳定性 + 批量回放 + JSON摘要 ===');
  const chart = createSampleChart();
  const playbackData1: PlaybackData = {
    inputEvents: [],
    judgeResults: [],
    chartNotes: chart.notes,
    difficultyConfig: createDifficultyConfig('normal'),
    latency: 30,
    practiceMode: false,
    runId: 'test-run-001',
    chartTitle: chart.title
  };
  const playbackData2: PlaybackData = {
    inputEvents: [],
    judgeResults: [],
    chartNotes: chart.notes,
    difficultyConfig: createDifficultyConfig('normal'),
    latency: 30,
    practiceMode: false,
    runId: 'test-run-002',
    chartTitle: chart.title
  };
  const result1 = RhythmSDK.replayPlaybackData(playbackData1, chart);
  const result2 = RhythmSDK.replayPlaybackData(playbackData2, chart);
  if (result1.stats.miss !== chart.notes.length) {
    throw new Error('离线回放应结算所有 Miss 音符, 预期: ' + chart.notes.length + ', 实际: ' + result1.stats.miss);
  }
  console.log('离线回放: 全部 ' + chart.notes.length + ' 音符结算为 Miss ✓');
  if (result1.score !== result2.score || result1.stats.miss !== result2.stats.miss) {
    throw new Error('两次相同输入离线回放结果应一致');
  }
  console.log('离线回放稳定性: 两次相同输入结果一致 ✓');

  console.log('\n--- 批量回放测试 ---');
  const batchResult: BatchReplayResult = RhythmSDK.batchReplayPlaybackData([
    { playbackData: playbackData1, chart },
    { playbackData: playbackData2, chart }
  ]);
  console.log('批量回放结果: 共 ' + batchResult.totalRuns + ' 局, 通过 ' + batchResult.passedRuns + ' 局, 通过率 ' + batchResult.passRate + '%');
  if (batchResult.totalRuns !== 2) throw new Error('批量回放应有 2 局, 实际: ' + batchResult.totalRuns);
  if (batchResult.perRunResults.length !== 2) throw new Error('perRunResults 应有 2 条');
  if (!batchResult.failureCategories.no_input) {
    throw new Error('failureCategories 应统计 no_input 数量');
  }
  console.log('失败分类统计: no_input=' + batchResult.failureCategories.no_input + ', 总一致率=' + batchResult.totalConsistencyRate + '% ✓');

  console.log('\n--- 机器可读JSON摘要 ---');
  const sdk = new RhythmSDK();
  sdk.loadChart(chart);
  sdk.initialize();
  const jsonSummary = sdk.generateReplaySummaryJSON(result1, playbackData1, chart);
  const parsed = JSON.parse(jsonSummary);
  if (parsed.runId !== 'test-run-001') throw new Error('JSON 应包含 runId');
  if (!parsed.generatedAt) throw new Error('JSON 应包含 generatedAt');
  if (typeof parsed.passed !== 'boolean') throw new Error('JSON 应包含 passed 布尔值');
  if (!parsed.summary || !parsed.comparison) throw new Error('JSON 应包含 summary 和 comparison');
  console.log('JSON摘要: runId=' + parsed.runId + ', passed=' + parsed.passed + ', 可被 JSON.parse ✓');

  sdk.destroy();
  console.log('✅ 离线回放+批量回放+JSON摘要 通过');
}

async function testFullSDKWorkflow(): Promise<void> {
  console.log('\n=== 测试完整SDK工作流(回放+对比+复盘+延迟+早按) ===');
  const runtimeCallbacksReceived: { judge: number; combo: number } = { judge: 0, combo: 0 };
  const holdStartTimes: Record<string, number> = {};
  const sdk = new RhythmSDK({
    difficulty: { trackCount: 4, judgeRanges: { perfect: 50, good: 120 } },
    latency: 30,
    callbacks: {
      onStateChange: (state, prev) => {
        console.log(`[构造回调] 状态变化: ${prev} -> ${state}`);
      },
      onHoldProgress: (noteId, progress) => {
        if (!holdStartTimes[noteId]) holdStartTimes[noteId] = progress;
      }
    }
  });
  await new Promise<void>(resolve => {
    const chart = createSampleChart();
    sdk.loadChart(chart);
    console.log('已加载谱面:', chart.title, '延迟:', 30, 'ms');
    sdk.initialize();
    sdk.setTrackCaptureArea(0, 400, 400, 200);
    sdk.start();
    const holdNote = chart.notes.find(n => n.type === NoteType.HOLD);
    if (holdNote) {
      const veryEarlyTime = holdNote.time - 1000;
      setTimeout(() => {
        console.log(`  🔘 HOLD音符 time=${holdNote.time}ms, 提前 1000ms 按下 (time=${veryEarlyTime}ms)`);
        sdk.handleInput(150, 500, 'touchstart', 99);
      }, veryEarlyTime);
      setTimeout(() => {
        sdk.handleInput(150, 500, 'touchend', 99);
        console.log(`  🔘 HOLD音符松手, 应产生一次最终判定`);
      }, (holdNote.endTime || holdNote.time) + 30);
    }
    setTimeout(() => {
      sdk.setCallbacks({
        onNoteJudge: (result) => {
          runtimeCallbacksReceived.judge++;
          if (result.noteType === NoteType.HOLD && result.startOffset !== undefined) {
            console.log(`[运行时回调] HOLD判定: ${result.level} startOffset=${result.startOffset.toFixed(0)}ms`);
          }
        },
        onComboChange: (combo, max) => {
          runtimeCallbacksReceived.combo++;
        }
      });
    }, 2000);
    const notes = chart.notes.filter(n => n.type === NoteType.TAP).slice(0, 8);
    notes.forEach((note, idx) => {
      const timeOffset = (idx % 3 === 0) ? 10 : (idx % 3 === 1 ? 60 : 200);
      setTimeout(() => {
        const x = note.track * 100 + 50;
        sdk.handleInput(x, 500, 'touchstart', idx);
        setTimeout(() => sdk.handleInput(x, 500, 'touchend', idx), 30);
      }, note.time + timeOffset);
    });
    const slideNote = chart.notes.find(n => n.type === NoteType.SLIDE);
    if (slideNote) {
      setTimeout(() => sdk.handleInput(20, 500, 'touchstart', 88), slideNote.time + 20);
      setTimeout(() => sdk.handleInput(350, 500, 'touchend', 88), (slideNote.endTime || slideNote.time) + 20);
    }
    setTimeout(() => {
      sdk.stop();
      setTimeout(() => {
        const playback = sdk.exportPlaybackData();
        console.log(`回放数据: 输入${playback.inputEvents.length}个, 判定${playback.judgeResults.length}个`);
        console.log(`回放携带延迟: ${playback.latency}ms, 难度: ${!!playback.difficultyConfig}, runId=${playback.runId}`);

        const holdResult = sdk.getJudgeResults().find(r => r.noteType === NoteType.HOLD);
        if (holdResult) {
          if (holdResult.startOffset === undefined) throw new Error('HOLD 应携带 startOffset');
          if (Math.abs(holdResult.startOffset - (-1000)) > 50) {
            throw new Error('HOLD startOffset 应接近 -1000ms, 实际: ' + holdResult.startOffset);
          }
          console.log('HOLD 早按 startOffset: ' + holdResult.startOffset + 'ms ✓');
          const holdJudgeCount = sdk.getJudgeResults().filter(r => r.noteId === holdResult.noteId).length;
          if (holdJudgeCount !== 1) throw new Error('HOLD 应只产生1次判定, 实际: ' + holdJudgeCount);
          console.log('HOLD 只产生 1 次最终判定 ✓');
        }

        const originalResult = sdk.getResult();
        const replayResult = RhythmSDK.replayPlaybackData(playback, chart);
        console.log('原局 P/G/M: ' + originalResult.stats.perfect + '/' + originalResult.stats.good + '/' + originalResult.stats.miss);
        console.log('回放 P/G/M: ' + replayResult.stats.perfect + '/' + replayResult.stats.good + '/' + replayResult.stats.miss);
        console.log('原局分数: ' + originalResult.score + ', 回放分数: ' + replayResult.score);
        if (replayResult.stats.perfect !== originalResult.stats.perfect || replayResult.stats.good !== originalResult.stats.good) {
          throw new Error('回放 P/G 与原局不一致');
        }
        if (playback.latency !== 30) {
          throw new Error('导出回放数据应携带 latency=30, 实际: ' + playback.latency);
        }
        console.log('回放数据延迟校准值: ' + playback.latency + 'ms ✓');

        const comparison = sdk.compareReplay(originalResult, playback, chart);
        console.log('一致率: ' + comparison.consistencyRate + '% ✓');

        const summary = sdk.generateReplaySummary(originalResult, playback, chart);
        if (summary.failureBreakdown.path_out_of_order === undefined) {
          throw new Error('失败分类应包含 path_out_of_order');
        }
        console.log('失败分类包含新增路径类型 ✓');

        const json = sdk.generateReplaySummaryJSON(originalResult, playback, chart);
        console.log('JSON摘要可解析: ' + (JSON.parse(json).passed !== undefined ? '✓' : '✗'));

        sdk.reset();
        sdk.destroy();
        console.log('SDK已销毁');
        resolve();
      }, 500);
    }, 22000);
  });
}

async function main(): Promise<void> {
  console.log('\n========================================');
  console.log('  音乐节奏游戏评分 SDK - 本地测试套件');
  console.log('========================================');
  await runTest('谱面读取模块', testChartReader);
  await runTest('连击统计模块', testComboCounter);
  await runTest('判定计算模块', testJudgeModule);
  await runTest('HOLD/SLIDE松手才结算(含极端偏移)', testHoldSlideSettleOnRelease);
  await runTest('滑动音符路径校验(基础)', testSlideWaypointPath);
  await runTest('滑动音符路径校验(详细:顺序/时间)', testSlideWaypointDetailed);
  await runTest('滑动轨道+失败分类', testSlideTrackAndFailureCategory);
  await runTest('结果输出模块(含路径失败明细)', testResultGenerator);
  await runTest('难度配置', testDifficultyConfig);
  await runTest('离线回放+批量回放+JSON摘要', testOfflineReplayConsistency);
  await runTest('完整SDK工作流(早按绑定+延迟+JSON)', testFullSDKWorkflow);
  printFinalSummary();
}

main().catch(e => {
  console.error('测试执行异常:', e);
  process.exit(1);
});
