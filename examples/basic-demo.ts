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
  FailureCategory
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
      { id: 'hold-early', type: NoteType.HOLD, time: 1000, track: 0, endTime: 2500 },
      { id: 'hold-late', type: NoteType.HOLD, time: 3000, track: 0, endTime: 4500 },
      { id: 'slide-early', type: NoteType.SLIDE, time: 5000, track: 0, endTime: 6500, endTrack: 3 }
    ]
  };
  judge.registerPendingNotes(chart.notes);

  mockTime = 500;
  const holdEarlyStart = judge.handleInput({
    id: 1, type: 'touchstart', x: 50, y: 500, time: mockTime, pointerId: 10, track: 0
  });
  if (holdEarlyStart !== null) throw new Error('HOLD早按: 按下不应产生判定');
  const rc0: number = results.length;
  if (rc0 !== 0) throw new Error('HOLD早按: 按下时不应有结算, 实际: ' + rc0);
  console.log('HOLD早按(偏移-500ms)按下: 无判定 ✓');

  mockTime = 2530;
  const holdEarlyEnd = judge.handleInput({
    id: 2, type: 'touchend', x: 50, y: 500, time: mockTime, pointerId: 10, track: 0
  });
  if (!holdEarlyEnd) throw new Error('HOLD早按: 松手应产生判定');
  const rc1: number = results.length;
  if (rc1 !== 1) throw new Error('HOLD早按: 只应结算一次, 实际: ' + rc1);
  if (holdEarlyEnd.startOffset === undefined) throw new Error('HOLD早按: 应携带 startOffset');
  if (holdEarlyEnd.level !== JudgeLevel.MISS) throw new Error('HOLD早按(startOffset超窗): 应判 MISS, 实际: ' + holdEarlyEnd.level);
  if (holdEarlyEnd.failureCategory !== 'early_press') throw new Error('HOLD早按: failureCategory 应为 early_press, 实际: ' + holdEarlyEnd.failureCategory);
  console.log('HOLD早按松手: level=' + holdEarlyEnd.level + ', startOffset=' + holdEarlyEnd.startOffset.toFixed(0) + 'ms, failure=' + holdEarlyEnd.failureCategory + ' ✓');

  mockTime = 3800;
  judge.handleInput({
    id: 3, type: 'touchstart', x: 50, y: 500, time: mockTime, pointerId: 11, track: 0
  });
  mockTime = 4530;
  const holdLateEnd = judge.handleInput({
    id: 4, type: 'touchend', x: 50, y: 500, time: mockTime, pointerId: 11, track: 0
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

function testSlideWaypointPath(): void {
  console.log('\n=== 测试滑动音符路径校验(slideWaypoints) ===');
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
  judge.handleInput({
    id: 10, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 1, track: 0
  });
  mockTime = 1500;
  judge.handleInput({
    id: 11, type: 'touchmove', x: 150, y: 500, time: mockTime, pointerId: 1, track: 1
  });
  mockTime = 2000;
  judge.handleInput({
    id: 12, type: 'touchmove', x: 250, y: 500, time: mockTime, pointerId: 1, track: 2
  });
  mockTime = 2500;
  judge.handleInput({
    id: 13, type: 'touchmove', x: 350, y: 500, time: mockTime, pointerId: 1, track: 3
  });
  mockTime = 3030;
  judge.handleInput({
    id: 14, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 1, track: 3
  });
  const okResult = results.find(r => r.noteId === 'slide-waypoint-ok');
  if (!okResult) throw new Error('路径完整SLIDE应产生判定');
  if (okResult.level === JudgeLevel.MISS) throw new Error('按路径0→1→3滑到终点不应判 MISS');
  if (okResult.pathComplete !== true) throw new Error('pathComplete 应为 true');
  console.log('0→1→3(经1轨): level=' + okResult.level + ', pathComplete=' + okResult.pathComplete + ' ✓');

  mockTime = 4050;
  judge.handleInput({
    id: 20, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 2, track: 0
  });
  mockTime = 5000;
  judge.handleInput({
    id: 21, type: 'touchmove', x: 350, y: 500, time: mockTime, pointerId: 2, track: 3
  });
  mockTime = 6030;
  judge.handleInput({
    id: 22, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 2, track: 3
  });
  const skipResult = results.find(r => r.noteId === 'slide-waypoint-skip');
  if (!skipResult) throw new Error('跳过中间点SLIDE应产生判定');
  if (skipResult.level !== JudgeLevel.MISS) throw new Error('跳过1轨直接到3应判 MISS, 实际: ' + skipResult.level);
  if (skipResult.pathComplete === true) throw new Error('pathComplete 不应为 true');
  if (skipResult.failureCategory !== 'path_incomplete') throw new Error('failureCategory 应为 path_incomplete, 实际: ' + skipResult.failureCategory);
  console.log('0→3(跳过1轨): MISS, pathComplete=' + skipResult.pathComplete + ', failure=' + skipResult.failureCategory + ' ✓');

  console.log('✅ 滑动路径校验通过');
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
  judge.handleInput({
    id: 30, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 5, track: 0
  });
  mockTime = 2530;
  judge.handleInput({
    id: 31, type: 'touchend', x: 150, y: 500, time: mockTime, pointerId: 5, track: 1
  });
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
    pathComplete: false, failureCategory: 'wrong_track'
  });
  generator.setJudgeResults(judgeResults);
  generator.setInputEvents([]);
  const debugList = generator.generateNoteDebugList();
  const slideDebug = debugList.find(d => d.noteId === 'note-21');
  if (!slideDebug) throw new Error('调试列表应包含 note-21');
  const report = generator.generateSummaryReport();
  if (!report.includes('音符调试明细')) throw new Error('报告应包含调试明细');
  console.log('SLIDE调试: pathComplete=' + slideDebug.autoSettled + ' ✓');
}

function testDifficultyConfig(): void {
  console.log('\n=== 测试难度配置 ===');
  console.log('默认判定区间:', createDifficultyConfig().judgeRanges);
  console.log('Easy判定区间:', createDifficultyConfig('easy').judgeRanges);
}

async function testFullSDKWorkflow(): Promise<void> {
  console.log('\n=== 测试完整SDK工作流(回放+对比+复盘+延迟) ===');
  const runtimeCallbacksReceived: { judge: number; combo: number } = { judge: 0, combo: 0 };
  const sdk = new RhythmSDK({
    difficulty: { trackCount: 4, judgeRanges: { perfect: 50, good: 120 } },
    latency: 30,
    callbacks: {
      onStateChange: (state, prev) => {
        console.log(`[构造回调] 状态变化: ${prev} -> ${state}`);
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
    setTimeout(() => {
      sdk.setCallbacks({
        onNoteJudge: (result) => {
          runtimeCallbacksReceived.judge++;
          if (result.level !== JudgeLevel.MISS) {
            const fc = result.failureCategory ? ` failure=${result.failureCategory}` : '';
            console.log(`[运行时回调] 判定: ${result.level} 音符${result.noteId} 偏移${result.offset.toFixed(0)}ms${fc}`);
          }
        },
        onComboChange: (combo, max) => {
          runtimeCallbacksReceived.combo++;
        }
      });
    }, 2000);
    const notes = chart.notes.filter(n => n.type === NoteType.TAP).slice(0, 12);
    notes.forEach((note, idx) => {
      const timeOffset = (idx % 3 === 0) ? 10 : (idx % 3 === 1 ? 60 : 200);
      setTimeout(() => {
        const x = note.track * 100 + 50;
        sdk.handleInput(x, 500, 'touchstart', idx);
        setTimeout(() => sdk.handleInput(x, 500, 'touchend', idx), 30);
      }, note.time + timeOffset);
    });
    const holdNote = chart.notes.find(n => n.type === NoteType.HOLD);
    if (holdNote) {
      setTimeout(() => sdk.handleInput(150, 500, 'touchstart', 99), holdNote.time + 20);
      setTimeout(() => sdk.handleInput(150, 500, 'touchend', 99), (holdNote.endTime || holdNote.time) - 100);
    }
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
        console.log(`回放携带延迟: ${playback.latency}ms, 难度: ${!!playback.difficultyConfig}`);

        if (runtimeCallbacksReceived.judge === 0) {
          throw new Error('运行时挂载回调后应能收到判定事件');
        }

        const slideResult = sdk.getJudgeResults().find(r => r.noteType === NoteType.SLIDE);
        if (slideResult) {
          console.log('SLIDE: level=' + slideResult.level + ' endTrack=' + slideResult.endTrack + ' actualEndTrack=' + slideResult.actualEndTrack + ' pathComplete=' + slideResult.pathComplete);
          if (slideResult.pathComplete === undefined) throw new Error('SLIDE 应携带 pathComplete');
        }

        const originalResult = sdk.getResult();

        console.log('\n--- 回放对比报告 ---');
        const comparison = sdk.compareReplay(originalResult, playback, chart);
        const reportGen = new ResultGenerator();
        const compReport = reportGen.generateReplayComparisonReport(comparison);
        console.log(compReport);

        console.log('\n--- 复盘摘要 ---');
        const summary = sdk.generateReplaySummary(originalResult, playback, chart);
        const summaryReport = reportGen.generateReplaySummaryReport(summary);
        console.log(summaryReport);

        if (summary.inputTrajectorySummary.totalEvents === 0) {
          throw new Error('输入轨迹摘要不应为空');
        }
        if (summary.failureBreakdown.no_input === undefined) {
          throw new Error('失败分类应包含 no_input 字段');
        }

        const replayResult = RhythmSDK.replayPlaybackData(playback, chart);
        if (replayResult.stats.perfect !== originalResult.stats.perfect || replayResult.stats.good !== originalResult.stats.good) {
          throw new Error('回放 P/G 与原局不一致');
        }
        console.log('回放P/G一致: ' + replayResult.stats.perfect + '/' + replayResult.stats.good);

        if (playback.latency !== 30) {
          throw new Error('导出回放数据应携带 latency=30, 实际: ' + playback.latency);
        }
        console.log('回放数据延迟校准值: ' + playback.latency + 'ms ✓');

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
  await runTest('滑动音符路径校验(slideWaypoints)', testSlideWaypointPath);
  await runTest('滑动轨道+失败分类', testSlideTrackAndFailureCategory);
  await runTest('结果输出模块', testResultGenerator);
  await runTest('难度配置', testDifficultyConfig);
  await runTest('完整SDK工作流(回放+对比+复盘+延迟)', testFullSDKWorkflow);
  printFinalSummary();
}

main().catch(e => {
  console.error('测试执行异常:', e);
  process.exit(1);
});
