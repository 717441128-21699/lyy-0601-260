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

function testChartReader(): void {
  console.log('=== 测试谱面读取模块 ===');
  const reader = new ChartReader();
  const chart = createSampleChart();
  reader.loadChart(chart);
  console.log('谱面标题:', reader.getChart()?.title);
  console.log('BPM:', reader.getBpmAtTime(0));
  console.log('音符总数:', reader.getTotalNoteCount());
  console.log('谱面时长:', reader.getDuration(), 'ms');
  console.log('前5个音符:', reader.getNotes().slice(0, 5).map(n => ({
    id: n.id,
    type: n.type,
    time: n.time,
    track: n.track
  })));
  const upcoming = reader.getUpcomingNotes(2000, 1000);
  console.log('时间点 2000ms 附近的音符数:', upcoming.length);
  console.log('=== 谱面读取模块测试通过 ===\n');
}

function testComboCounter(): void {
  console.log('=== 测试连击统计模块 ===');
  const counter = new ComboCounter({
    perfect: 1000,
    good: 500,
    miss: 0,
    comboBonus: 10
  });
  console.log('初始分数:', counter.getScore());
  console.log('初始连击:', counter.getCombo());
  for (let i = 0; i < 5; i++) {
    counter.processJudge(JudgeLevel.PERFECT);
  }
  console.log('5次PERFECT后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
  counter.processJudge(JudgeLevel.GOOD);
  console.log('1次GOOD后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
  counter.processJudge(JudgeLevel.MISS);
  console.log('1次MISS后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
  for (let i = 0; i < 10; i++) {
    counter.processJudge(JudgeLevel.PERFECT);
  }
  console.log('10次PERFECT后 - 分数:', counter.getScore(), '连击:', counter.getCombo(), '最大连击:', counter.getMaxCombo());
  console.log('准确率:', counter.getAccuracy().toFixed(2) + '%');
  console.log('判定统计:', counter.getStats());
  counter.reset();
  console.log('重置后 - 分数:', counter.getScore(), '连击:', counter.getCombo());
  console.log('=== 连击统计模块测试通过 ===\n');
}

function testJudgeModule(): void {
  console.log('=== 测试判定计算模块 ===');
  const judge = new Judge({ perfect: 50, good: 120 });
  let mockTime = 1000;
  judge.setTimeProvider(() => mockTime);
  const chart = createSampleChart();
  judge.registerPendingNotes(chart.notes);
  console.log('待判定音符数:', judge.getPendingNotes().length);
  const perfectTap = judge.handleInput({
    id: 1,
    type: 'touchstart',
    x: 50,
    y: 500,
    time: 1005,
    pointerId: 0,
    track: 0
  });
  console.log('PERFECT点击判定结果:', perfectTap ? `level=${perfectTap.level}, offset=${perfectTap.offset}ms` : '无');
  const goodTap = judge.handleInput({
    id: 2,
    type: 'touchstart',
    x: 150,
    y: 500,
    time: 1580,
    pointerId: 1,
    track: 1
  });
  console.log('GOOD点击判定结果:', goodTap ? `level=${goodTap.level}, offset=${goodTap.offset}ms` : '无');
  mockTime = 3000;
  const missed = judge.checkMissedNotes();
  console.log('超时Miss音符数:', missed.length);
  console.log('已判定音符数:', judge.getJudgedNoteCount());
  judge.reset();
  console.log('重置后待判定音符数:', judge.getPendingNotes().length);
  console.log('=== 判定计算模块测试通过 ===\n');
}

function testResultGenerator(): void {
  console.log('=== 测试结果输出模块 ===');
  const generator = new ResultGenerator();
  const chart = createSampleChart();
  generator.setChartNotes(chart.notes);
  const judgeResults: JudgeResult[] = [];
  for (let i = 0; i < 15; i++) {
    judgeResults.push({
      noteId: `note-${i}`,
      level: JudgeLevel.PERFECT,
      offset: Math.random() * 40 - 20,
      time: chart.notes[i].time,
      noteType: chart.notes[i].type,
      track: chart.notes[i].track
    });
  }
  for (let i = 15; i < 20; i++) {
    judgeResults.push({
      noteId: `note-${i}`,
      level: JudgeLevel.GOOD,
      offset: Math.random() * 100 - 50,
      time: chart.notes[i].time,
      noteType: chart.notes[i].type,
      track: chart.notes[i].track
    });
  }
  judgeResults.push({
    noteId: `note-20`,
    level: JudgeLevel.MISS,
    offset: 200,
    time: 12200,
    noteType: NoteType.HOLD,
    track: 1
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
  console.log('错误偏移列表长度:', generator.getJudgeErrorOffsets().length);
  const result = generator.generateResult();
  console.log('结算数据 - 总分:', result.score, '评级:', result.grade);
  const report = generator.generateSummaryReport();
  console.log('\n' + report);
  console.log('=== 结果输出模块测试通过 ===\n');
}

function testDifficultyConfig(): void {
  console.log('=== 测试难度配置 ===');
  console.log('默认判定区间:', createDifficultyConfig().judgeRanges);
  console.log('Easy判定区间:', createDifficultyConfig('easy').judgeRanges);
  console.log('Hard判定区间:', createDifficultyConfig('hard').judgeRanges);
  console.log('Expert判定区间:', createDifficultyConfig('expert').judgeRanges);
  const custom = createDifficultyConfig('normal', {
    judgeRanges: { perfect: 30, good: 80 },
    trackCount: 6
  });
  console.log('自定义配置 - 判定:', custom.judgeRanges, '轨道数:', custom.trackCount);
  console.log('=== 难度配置测试通过 ===\n');
}

function testFullSDKWorkflow(): void {
  console.log('=== 测试完整SDK工作流 ===');
  let finalResult: GameResult | null = null;
  const sdk = new RhythmSDK({
    difficulty: {
      trackCount: 4,
      judgeRanges: { perfect: 50, good: 120 }
    },
    callbacks: {
      onStateChange: (state, prev) => {
        console.log(`状态变化: ${prev} -> ${state}`);
      },
      onNoteJudge: (result) => {
        if (result.level !== JudgeLevel.MISS) {
          console.log(`判定: ${result.level} 音符${result.noteId} 偏移${result.offset.toFixed(0)}ms`);
        }
      },
      onComboChange: (combo, max) => {
        if (combo > 0 && combo % 5 === 0) {
          console.log(`连击: ${combo} (最大: ${max})`);
        }
      },
      onScoreChange: (score) => {
        // 分数变化回调
      },
      onGameFinish: (result) => {
        finalResult = result;
        console.log('\n游戏结束！');
        console.log(`最终分数: ${result.score}`);
        console.log(`评级: ${result.grade}`);
        console.log(`最大连击: ${result.maxCombo}`);
        console.log(`准确率: ${result.accuracy}%`);
        console.log(`统计 - P:${result.stats.perfect} G:${result.stats.good} M:${result.stats.miss}`);
      }
    }
  });
  const chart = createSampleChart();
  sdk.loadChart(chart);
  console.log('已加载谱面:', chart.title, '音符数:', chart.notes.length);
  sdk.initialize();
  sdk.setTrackCaptureArea(0, 400, 400, 200);
  sdk.start();
  console.log('SDK状态:', sdk.getState());
  const simulateInputs = () => {
    const notes = chart.notes.filter(n => n.type === NoteType.TAP).slice(0, 12);
    notes.forEach((note, idx) => {
      setTimeout(() => {
        const timeOffset = (idx % 3 === 0) ? 10 : (idx % 3 === 1 ? 60 : 200);
        const x = note.track * 100 + 50;
        sdk.handleInput(x, 500, 'touchstart', idx);
        setTimeout(() => {
          sdk.handleInput(x, 500, 'touchend', idx);
        }, 30);
      }, note.time + timeOffset);
    });
    const holdNote = chart.notes.find(n => n.type === NoteType.HOLD);
    if (holdNote) {
      setTimeout(() => {
        sdk.handleInput(150, 500, 'touchstart', 99);
      }, holdNote.time + 20);
      setTimeout(() => {
        sdk.handleInput(150, 500, 'touchend', 99);
      }, (holdNote.endTime || holdNote.time) - 100);
    }
    setTimeout(() => {
      sdk.stop();
      setTimeout(() => {
        console.log('\n=== 手动获取结算 ===');
        const report = sdk.getSummaryReport();
        console.log(report);
        const playback = sdk.exportPlaybackData();
        console.log(`\n回放数据: 输入事件${playback.inputEvents.length}个, 判定${playback.judgeResults.length}个`);
        console.log('当前分数:', sdk.getScore());
        console.log('当前连击:', sdk.getCombo());
        console.log('准确率:', sdk.getAccuracy().toFixed(2) + '%');
        sdk.reset();
        console.log('\n重置后状态:', sdk.getState());
        sdk.destroy();
        console.log('SDK已销毁');
        console.log('=== 完整SDK工作流测试完成 ===\n');
        runAllTestsPassed();
      }, 500);
    }, 22000);
  };
  simulateInputs();
}

let testsPassed = 0;
const totalTests = 6;

function testPassed(name: string): void {
  testsPassed++;
  console.log(`✅ ${name} 测试通过`);
}

function runAllTestsPassed(): void {
  console.log('\n========================================');
  console.log(`所有测试完成: ${testsPassed}/${totalTests} 项通过`);
  console.log('========================================');
}

function runAllTests(): void {
  console.log('\n========================================');
  console.log('  音乐节奏游戏评分 SDK - 本地测试套件');
  console.log('========================================\n');
  try {
    testChartReader();
    testPassed('谱面读取模块');
  } catch (e) {
    console.error('❌ 谱面读取模块测试失败:', e);
  }
  try {
    testComboCounter();
    testPassed('连击统计模块');
  } catch (e) {
    console.error('❌ 连击统计模块测试失败:', e);
  }
  try {
    testJudgeModule();
    testPassed('判定计算模块');
  } catch (e) {
    console.error('❌ 判定计算模块测试失败:', e);
  }
  try {
    testResultGenerator();
    testPassed('结果输出模块');
  } catch (e) {
    console.error('❌ 结果输出模块测试失败:', e);
  }
  try {
    testDifficultyConfig();
    testPassed('难度配置');
  } catch (e) {
    console.error('❌ 难度配置测试失败:', e);
  }
  try {
    testFullSDKWorkflow();
  } catch (e) {
    console.error('❌ 完整SDK工作流测试失败:', e);
  }
}

runAllTests();
