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
  Judge
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

function createSlideOnlyChart(): ChartData {
  return {
    title: 'Slide Test',
    difficulty: 'normal',
    bpm: 120,
    duration: 8000,
    notes: [
      {
        id: 'slide-ok',
        type: NoteType.SLIDE,
        time: 1000,
        track: 0,
        endTime: 2500,
        endTrack: 3
      },
      {
        id: 'slide-track1',
        type: NoteType.SLIDE,
        time: 3000,
        track: 0,
        endTime: 4500,
        endTrack: 3
      },
      {
        id: 'slide-track2',
        type: NoteType.SLIDE,
        time: 5000,
        track: 0,
        endTime: 6500,
        endTrack: 3
      }
    ]
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
  console.log('前5个音符:', reader.getNotes().slice(0, 5).map(n => ({
    id: n.id, type: n.type, time: n.time, track: n.track
  })));
  const upcoming = reader.getUpcomingNotes(2000, 1000);
  console.log('时间点 2000ms 附近的音符数:', upcoming.length);
}

function testComboCounter(): void {
  console.log('\n=== 测试连击统计模块 ===');
  const counter = new ComboCounter({
    perfect: 1000, good: 500, miss: 0, comboBonus: 10
  });
  console.log('初始分数:', counter.getScore());
  console.log('初始连击:', counter.getCombo());
  for (let i = 0; i < 5; i++) counter.processJudge(JudgeLevel.PERFECT);
  console.log('5次PERFECT后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
  counter.processJudge(JudgeLevel.GOOD);
  console.log('1次GOOD后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
  counter.processJudge(JudgeLevel.MISS);
  console.log('1次MISS后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
  for (let i = 0; i < 10; i++) counter.processJudge(JudgeLevel.PERFECT);
  console.log('10次PERFECT后 - 分数:', counter.getScore(), '连击:', counter.getCombo(), '最大连击:', counter.getMaxCombo());
  console.log('准确率:', counter.getAccuracy().toFixed(2) + '%');
  console.log('判定统计:', counter.getStats());
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
  const goodTap = judge.handleInput({
    id: 2, type: 'touchstart', x: 150, y: 500, time: 1580, pointerId: 1, track: 1
  });
  console.log('GOOD点击判定结果:', goodTap ? `level=${goodTap.level}, offset=${goodTap.offset}ms` : '无');
  mockTime = 3000;
  const missed = judge.checkMissedNotes();
  console.log('超时Miss音符数:', missed.length);
  console.log('已判定音符数:', judge.getJudgedNoteCount());
  judge.reset();
  console.log('重置后待判定音符数:', judge.getPendingNotes().length);
}

function testHoldSlideSettleOnRelease(): void {
  console.log('\n=== 测试HOLD/SLIDE松手才结算 ===');
  const judge = new Judge({ perfect: 100, good: 200 });
  let mockTime = 0;
  judge.setTimeProvider(() => mockTime);
  const results: JudgeResult[] = [];
  const comboLog: JudgeLevel[] = [];
  judge.setJudgeResultCallback(r => {
    results.push(r);
    comboLog.push(r.level);
  });

  const chart: ChartData = {
    title: 'Settle Test',
    difficulty: 'normal',
    bpm: 120,
    duration: 10000,
    notes: [
      { id: 'hold-1', type: NoteType.HOLD, time: 1000, track: 0, endTime: 2500 },
      { id: 'slide-1', type: NoteType.SLIDE, time: 3000, track: 0, endTime: 4500, endTrack: 3 }
    ]
  };
  judge.registerPendingNotes(chart.notes);

  mockTime = 1050;
  const holdStart = judge.handleInput({
    id: 1, type: 'touchstart', x: 50, y: 500, time: mockTime, pointerId: 10, track: 0
  });
  if (holdStart !== null) throw new Error('HOLD 按下不应产生判定结果, 得到: ' + holdStart.level);
  const resultCount0: number = results.length;
  if (resultCount0 !== 0) throw new Error('HOLD 按下时不应有任何结算, 实际结算数: ' + resultCount0);
  console.log('HOLD 按下: 无判定 ✓');

  mockTime = 2530;
  const holdEnd = judge.handleInput({
    id: 2, type: 'touchend', x: 50, y: 500, time: mockTime, pointerId: 10, track: 0
  });
  if (!holdEnd) throw new Error('HOLD 松手应产生判定');
  const resultCount1: number = results.length;
  if (resultCount1 !== 1) throw new Error('HOLD 应只结算一次, 实际: ' + resultCount1);
  if (holdEnd.startOffset === undefined) throw new Error('HOLD 应携带 startOffset');
  console.log('HOLD 松手: level=' + holdEnd.level + ', startOffset=' + holdEnd.startOffset.toFixed(0) + 'ms, 只结算1次 ✓');

  mockTime = 3050;
  const slideStart = judge.handleInput({
    id: 3, type: 'touchstart', x: 50, y: 500, time: mockTime, pointerId: 11, track: 0
  });
  if (slideStart !== null) throw new Error('SLIDE 按下不应产生判定结果');
  const resultCount2: number = results.length;
  if (resultCount2 !== 1) throw new Error('SLIDE 按下时结算数不应增加, 实际: ' + resultCount2);
  console.log('SLIDE 按下: 无判定 ✓');

  mockTime = 4530;
  const slideEnd = judge.handleInput({
    id: 4, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 11, track: 3
  });
  if (!slideEnd) throw new Error('SLIDE 松手应产生判定');
  const resultCount3: number = results.length;
  if (resultCount3 !== 2) throw new Error('SLIDE 应只结算一次, 实际: ' + resultCount3);
  if (slideEnd.startOffset === undefined) throw new Error('SLIDE 应携带 startOffset');
  if (slideEnd.actualEndTrack !== 3) throw new Error('SLIDE 应携带 actualEndTrack=3');
  console.log('SLIDE 松手: level=' + slideEnd.level + ', startOffset=' + slideEnd.startOffset.toFixed(0) + 'ms, actualEndTrack=' + slideEnd.actualEndTrack + ', 只结算1次 ✓');

  console.log('✅ HOLD/SLIDE 均只在松手时产生唯一判定');
}

function testSlideTrackValidation(): void {
  console.log('\n=== 测试滑动音符终点轨道校验(含多轨道+练习模式) ===');
  const judge = new Judge({ perfect: 100, good: 200 });
  let mockTime = 0;
  judge.setTimeProvider(() => mockTime);
  const chart = createSlideOnlyChart();
  judge.registerPendingNotes(chart.notes);
  const results: JudgeResult[] = [];
  judge.setJudgeResultCallback(r => results.push(r));

  mockTime = 1020;
  judge.handleInput({
    id: 10, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 1, track: 0
  });
  mockTime = 2520;
  judge.handleInput({
    id: 11, type: 'touchend', x: 350, y: 500, time: mockTime, pointerId: 1, track: 3
  });
  const okResult = results.find(r => r.noteId === 'slide-ok');
  if (!okResult) throw new Error('SLIDE-OK 应产生最终判定');
  if (okResult.level === JudgeLevel.MISS) throw new Error('SLIDE 到达终点轨道3 不应判 MISS');
  if (okResult.endTrack !== 3) throw new Error('SLIDE 最终结果应携带 endTrack=3');
  if (okResult.actualEndTrack !== 3) throw new Error('SLIDE 最终结果应携带 actualEndTrack=3');
  console.log('0→3轨: ' + okResult.level + ', actualEndTrack=' + okResult.actualEndTrack + ' ✓');

  mockTime = 3020;
  judge.handleInput({
    id: 12, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 2, track: 0
  });
  mockTime = 4520;
  judge.handleInput({
    id: 13, type: 'touchend', x: 150, y: 500, time: mockTime, pointerId: 2, track: 1
  });
  const track1Result = results.find(r => r.noteId === 'slide-track1');
  if (!track1Result) throw new Error('SLIDE-track1 应产生最终判定');
  if (track1Result.level !== JudgeLevel.MISS) throw new Error('停在1轨应判 MISS, 实际: ' + track1Result.level);
  if (track1Result.actualEndTrack !== 1) throw new Error('actualEndTrack 应为 1');
  console.log('0→1轨(应到3): MISS, actualEndTrack=' + track1Result.actualEndTrack + ' ✓');

  mockTime = 5020;
  judge.handleInput({
    id: 14, type: 'touchstart', x: 20, y: 500, time: mockTime, pointerId: 3, track: 0
  });
  mockTime = 6520;
  judge.handleInput({
    id: 15, type: 'touchend', x: 250, y: 500, time: mockTime, pointerId: 3, track: 2
  });
  const track2Result = results.find(r => r.noteId === 'slide-track2');
  if (!track2Result) throw new Error('SLIDE-track2 应产生最终判定');
  if (track2Result.level !== JudgeLevel.MISS) throw new Error('停在2轨应判 MISS, 实际: ' + track2Result.level);
  console.log('0→2轨(应到3): MISS ✓');

  console.log('--- 练习模式下 SLIDE 轨道不匹配也不通过 ---');
  const practiceJudge = new Judge({ perfect: 100, good: 200 });
  practiceJudge.setPracticeMode(true);
  let pMockTime = 0;
  practiceJudge.setTimeProvider(() => pMockTime);
  const practiceResults: JudgeResult[] = [];
  practiceJudge.setJudgeResultCallback(r => practiceResults.push(r));
  practiceJudge.registerPendingNotes([{
    id: 'slide-practice',
    type: NoteType.SLIDE,
    time: 1000,
    track: 0,
    endTime: 2500,
    endTrack: 3
  }]);
  pMockTime = 1020;
  practiceJudge.handleInput({
    id: 20, type: 'touchstart', x: 20, y: 500, time: pMockTime, pointerId: 5, track: 0
  });
  pMockTime = 2520;
  practiceJudge.handleInput({
    id: 21, type: 'touchend', x: 150, y: 500, time: pMockTime, pointerId: 5, track: 1
  });
  const pResult = practiceResults.find(r => r.noteId === 'slide-practice');
  if (!pResult) throw new Error('练习模式 SLIDE 应产生判定');
  if (pResult.level !== JudgeLevel.MISS) throw new Error('练习模式: 终点轨道不匹配仍应 MISS, 实际: ' + pResult.level);
  console.log('练习模式 0→1轨(应到3): MISS ✓');

  console.log('--- 超时自动结算: SLIDE 没滑到终点也是 Miss ---');
  const autoJudge = new Judge({ perfect: 100, good: 200 });
  let aMockTime = 0;
  autoJudge.setTimeProvider(() => aMockTime);
  const autoResults: JudgeResult[] = [];
  autoJudge.setJudgeResultCallback(r => autoResults.push(r));
  autoJudge.registerPendingNotes([{
    id: 'slide-auto',
    type: NoteType.SLIDE,
    time: 1000,
    track: 0,
    endTime: 2500,
    endTrack: 3
  }]);
  aMockTime = 1020;
  autoJudge.handleInput({
    id: 30, type: 'touchstart', x: 20, y: 500, time: aMockTime, pointerId: 6, track: 0
  });
  aMockTime = 4000;
  autoJudge.update(aMockTime);
  const autoResult = autoResults.find(r => r.noteId === 'slide-auto');
  if (!autoResult) throw new Error('超时自动结算应产生判定');
  if (autoResult.level !== JudgeLevel.MISS) throw new Error('超时结算: 手指在0轨没到3轨应 MISS, 实际: ' + autoResult.level);
  if (!autoResult.autoSettled) throw new Error('超时结算应标记 autoSettled=true');
  console.log('超时自动结算(停在0轨): MISS, autoSettled=' + autoResult.autoSettled + ' ✓');

  console.log('✅ 滑动轨道全面验证通过');
}

function testResultGenerator(): void {
  console.log('\n=== 测试结果输出模块(含调试信息) ===');
  const generator = new ResultGenerator();
  const chart = createSampleChart();
  generator.setChartNotes(chart.notes);
  const judgeResults: JudgeResult[] = [];
  for (let i = 0; i < 15; i++) {
    judgeResults.push({
      noteId: `note-${i}`, level: JudgeLevel.PERFECT,
      offset: Math.random() * 40 - 20,
      time: chart.notes[i].time,
      noteType: chart.notes[i].type, track: chart.notes[i].track
    });
  }
  for (let i = 15; i < 20; i++) {
    judgeResults.push({
      noteId: `note-${i}`, level: JudgeLevel.GOOD,
      offset: Math.random() * 100 - 50,
      time: chart.notes[i].time,
      noteType: chart.notes[i].type, track: chart.notes[i].track
    });
  }
  judgeResults.push({
    noteId: `note-20`, level: JudgeLevel.MISS, offset: 200,
    time: 12200, noteType: NoteType.HOLD, track: 1,
    startOffset: -500, actualEndTrack: 1, autoSettled: true
  });
  judgeResults.push({
    noteId: `note-21`, level: JudgeLevel.PERFECT, offset: 10,
    time: 15500, noteType: NoteType.SLIDE, track: 0,
    endTrack: 3, startOffset: 15, actualEndTrack: 3, autoSettled: false
  });
  generator.setJudgeResults(judgeResults);
  generator.setInputEvents([]);
  const stats = generator.calculateStats();
  console.log('判定统计:', stats);
  console.log('准确率:', generator.calculateAccuracy(stats).toFixed(2) + '%');
  console.log('最大连击:', generator.calculateMaxCombo());
  console.log('评级:', generator.calculateGrade());
  console.log('平均偏移:', generator.getAverageOffset() + 'ms');
  console.log('偏移分布:', generator.getOffsetDistribution());
  const debugList = generator.generateNoteDebugList();
  const holdDebug = debugList.find(d => d.noteId === 'note-20');
  if (!holdDebug) throw new Error('调试列表应包含 note-20');
  if (holdDebug.startOffset !== -500) throw new Error('note-20 startOffset 应为 -500');
  if (holdDebug.autoSettled !== true) throw new Error('note-20 autoSettled 应为 true');
  console.log('HOLD调试: startOffset=' + holdDebug.startOffset + ', actualEndTrack=' + holdDebug.actualEndTrack + ', autoSettled=' + holdDebug.autoSettled + ' ✓');
  const slideDebug = debugList.find(d => d.noteId === 'note-21');
  if (!slideDebug) throw new Error('调试列表应包含 note-21');
  if (slideDebug.actualEndTrack !== 3) throw new Error('note-21 actualEndTrack 应为 3');
  console.log('SLIDE调试: endTrack=' + slideDebug.endTrack + ', actualEndTrack=' + slideDebug.actualEndTrack + ' ✓');
  const report = generator.generateSummaryReport();
  if (!report.includes('音符调试明细')) throw new Error('报告应包含调试明细');
  if (!report.includes('[超时结算]')) throw new Error('报告应标记超时结算');
  console.log('\n' + report);
}

function testDifficultyConfig(): void {
  console.log('\n=== 测试难度配置 ===');
  console.log('默认判定区间:', createDifficultyConfig().judgeRanges);
  console.log('Easy判定区间:', createDifficultyConfig('easy').judgeRanges);
  console.log('Hard判定区间:', createDifficultyConfig('hard').judgeRanges);
  console.log('Expert判定区间:', createDifficultyConfig('expert').judgeRanges);
  const custom = createDifficultyConfig('normal', {
    judgeRanges: { perfect: 30, good: 80 }, trackCount: 6
  });
  console.log('自定义配置 - 判定:', custom.judgeRanges, '轨道数:', custom.trackCount);
}

async function testFullSDKWorkflow(): Promise<void> {
  console.log('\n=== 测试完整SDK工作流(含运行时挂载回调+SLIDE验证+回放) ===');
  let finalResult: GameResult | null = null;
  const runtimeCallbacksReceived: { judge: number; combo: number } = { judge: 0, combo: 0 };
  const sdk = new RhythmSDK({
    difficulty: { trackCount: 4, judgeRanges: { perfect: 50, good: 120 } },
    callbacks: {
      onStateChange: (state, prev) => {
        console.log(`[构造回调] 状态变化: ${prev} -> ${state}`);
      }
    }
  });
  await new Promise<void>(resolve => {
    const chart = createSampleChart();
    sdk.loadChart(chart);
    console.log('已加载谱面:', chart.title, '音符数:', chart.notes.length);
    sdk.initialize();
    sdk.setTrackCaptureArea(0, 400, 400, 200);
    sdk.start();
    console.log('SDK状态:', sdk.getState());
    console.log('⏳ 游戏开始 2000ms 后动态挂载 onNoteJudge / onComboChange 回调...');
    setTimeout(() => {
      console.log('🔌 运行时挂载回调生效');
      sdk.setCallbacks({
        onNoteJudge: (result) => {
          runtimeCallbacksReceived.judge++;
          if (result.level !== JudgeLevel.MISS) {
            const extra = result.startOffset !== undefined ? ` 按下偏移:${result.startOffset.toFixed(0)}ms` : '';
            const endT = result.actualEndTrack !== undefined ? ` 实际轨:${result.actualEndTrack}` : '';
            console.log(`[运行时回调] 判定: ${result.level} 音符${result.noteId} 偏移${result.offset.toFixed(0)}ms${extra}${endT}`);
          }
        },
        onComboChange: (combo, max) => {
          runtimeCallbacksReceived.combo++;
          if (combo > 0 && combo % 5 === 0) {
            console.log(`[运行时回调] 连击: ${combo} (最大: ${max})`);
          }
        },
        onGameFinish: (result) => {
          finalResult = result;
          console.log('\n[运行时回调] 游戏结束！');
          console.log(`最终分数: ${result.score}`);
          console.log(`评级: ${result.grade}`);
          console.log(`最大连击: ${result.maxCombo}`);
          console.log(`准确率: ${result.accuracy}%`);
          console.log(`统计 - P:${result.stats.perfect} G:${result.stats.good} M:${result.stats.miss}`);
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
        console.log('\n=== 手动获取结算 ===');
        const playback = sdk.exportPlaybackData();
        console.log(`回放数据: 输入事件${playback.inputEvents.length}个, 判定${playback.judgeResults.length}个`);
        console.log(`回放携带难度配置: ${!!playback.difficultyConfig}, 延迟: ${playback.latency}ms`);
        console.log('当前分数:', sdk.getScore());
        console.log('当前连击:', sdk.getCombo());
        console.log('准确率:', sdk.getAccuracy().toFixed(2) + '%');
        console.log(`运行时回调收到 - 判定事件: ${runtimeCallbacksReceived.judge}次, 连击事件: ${runtimeCallbacksReceived.combo}次`);
        if (runtimeCallbacksReceived.judge === 0) {
          throw new Error('运行时挂载回调后应能收到判定事件');
        }
        const slideResult = sdk.getJudgeResults().find(r => r.noteType === NoteType.SLIDE);
        if (slideResult) {
          console.log('SLIDE音符结算 - level:', slideResult.level, 'endTrack:', slideResult.endTrack, 'actualEndTrack:', slideResult.actualEndTrack, 'autoSettled:', slideResult.autoSettled);
          if (slideResult.actualEndTrack !== 3) throw new Error('SLIDE 应携带 actualEndTrack=3');
          if (slideResult.startOffset === undefined) throw new Error('SLIDE 应携带 startOffset');
        }
        const holdResult = sdk.getJudgeResults().find(r => r.noteType === NoteType.HOLD);
        if (holdResult) {
          console.log('HOLD音符结算 - level:', holdResult.level, 'startOffset:', holdResult.startOffset, 'actualEndTrack:', holdResult.actualEndTrack, 'autoSettled:', holdResult.autoSettled);
          if (holdResult.startOffset === undefined) throw new Error('HOLD 应携带 startOffset');
        }
        console.log('\n--- 回放一致性验证 ---');
        const replayResult = RhythmSDK.replayPlaybackData(playback, chart);
        console.log('原局分数:', sdk.getScore(), '回放分数:', replayResult.score);
        console.log('原局P/G/M:', sdk.getStats().perfect + '/' + sdk.getStats().good + '/' + sdk.getStats().miss,
          '回放P/G/M:', replayResult.stats.perfect + '/' + replayResult.stats.good + '/' + replayResult.stats.miss);
        if (replayResult.stats.perfect !== sdk.getStats().perfect || replayResult.stats.good !== sdk.getStats().good) {
          throw new Error('回放判定统计与原局不一致');
        }
        console.log('✅ 回放判定统计与原局一致');

        sdk.reset();
        console.log('\n重置后状态:', sdk.getState());
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
  await runTest('HOLD/SLIDE松手才结算', testHoldSlideSettleOnRelease);
  await runTest('滑动音符终点轨道校验(多轨道+练习+超时)', testSlideTrackValidation);
  await runTest('结果输出模块(含调试信息)', testResultGenerator);
  await runTest('难度配置', testDifficultyConfig);
  await runTest('完整SDK工作流(回调+SLIDE+回放)', testFullSDKWorkflow);
  printFinalSummary();
}

main().catch(e => {
  console.error('测试执行异常:', e);
  process.exit(1);
});
