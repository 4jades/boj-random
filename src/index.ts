import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  GatewayIntentBits,
  SlashCommandBuilder,
  REST,
  Routes,
  EmbedBuilder,
  ChatInputCommandInteraction,
  Events,
  SlashCommandIntegerOption,
  SlashCommandBooleanOption,
  Interaction,
} from 'discord.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 설정: 제외할 백준 아이디 목록 (이 유저들이 푼 문제는 제외됨)
// ============================================================
const EXCLUDE_USER_IDS: string[] = [
  'lindasoo',
  'gmyun1999',
  'hyuns6677',
  'mapledt001',
  'xornjsrlaals',
];

// 설정 파일 경로 (기본: 프로젝트 루트)
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..');
const SELECTED_PROBLEMS_PATH = path.join(DATA_DIR, 'selected-problems.json');

// solved.ac API 기본 URL
const SOLVED_AC_API_BASE = 'https://solved.ac/api/v3';

// Discord 토큰 (환경변수에서 로드)
function getDiscordToken(): string {
  const token = process.env.DISCORD_TOKEN;
  if (!token) {
    console.error('❌ DISCORD_TOKEN 환경변수가 설정되지 않았습니다.');
    process.exit(1);
  }
  return token;
}

const DISCORD_TOKEN = getDiscordToken();

interface SolvedProblem {
  problemId: number;
  titleKo: string;
  level: number;
  acceptedUserCount: number;
  averageTries: number;
}

interface SearchResponse {
  count: number;
  items: SolvedProblem[];
}

interface SelectedProblemRecord {
  problemId: number;
  title: string;
  tier: string;
  selectedAt: string;
  url: string;
}

interface SelectedProblemsData {
  problems: SelectedProblemRecord[];
}

/**
 * 레벨을 티어 문자열로 변환
 */
function levelToTier(level: number): string {
  const tierMap: Record<number, string> = {
    1: '🤎 Bronze',
    2: '🤍 Silver',
    3: '💛 Gold',
    4: '💚 Platinum',
    5: '🩵 Diamond',
    6: '🩷 Ruby',
  };

  const tierIndex = Math.floor((level - 1) / 5) + 1;
  const tierNumber = 5 - ((level - 1) % 5);
  return `${tierMap[tierIndex]} ${tierNumber}`;
}

/**
 * 티어 색상 반환
 */
function getTierColor(level: number): number {
  const tierIndex = Math.floor((level - 1) / 5) + 1;
  const colorMap: Record<number, number> = {
    1: 0xad5600, // Bronze
    2: 0x435f7a, // Silver
    3: 0xec9a00, // Gold
    4: 0x27e2a4, // Platinum
    5: 0x00b4fc, // Diamond
    6: 0xff0062, // Ruby
  };
  return colorMap[tierIndex] ?? 0x808080;
}

/**
 * 선택된 문제 목록 로드
 */
function loadSelectedProblems(): SelectedProblemsData {
  if (fs.existsSync(SELECTED_PROBLEMS_PATH)) {
    const data = fs.readFileSync(SELECTED_PROBLEMS_PATH, 'utf8');
    return JSON.parse(data) as SelectedProblemsData;
  }
  return { problems: [] };
}

/**
 * 선택된 문제 저장
 */
function saveSelectedProblems(data: SelectedProblemsData): void {
  fs.writeFileSync(
    SELECTED_PROBLEMS_PATH,
    JSON.stringify(data, null, 2),
    'utf8'
  );
}

/**
 * 검색 쿼리 생성 (맞은 사람 5000명 이상 + 유저가 푼 문제 제외)
 * @param hard true면 골드 3~2 (g3..g2), false면 골드 4~5 (g5..g4)
 */
function buildSearchQuery(hard: boolean = false): string {
  const tierRange = hard ? 'tier:g3..g2' : 'tier:g5..g4';
  let query = `${tierRange} solved:5000..`;

  if (EXCLUDE_USER_IDS.length > 0) {
    const excludeConditions = EXCLUDE_USER_IDS.map(
      (id) => `!solved_by:${id}`
    ).join(' ');
    query = `${query} ${excludeConditions}`;
  }

  return query;
}

/**
 * solved.ac API로 문제 검색 (hard: g3~g2, 기본: g5~g4)
 */
async function fetchProblems(
  page: number = 1,
  hard: boolean = false
): Promise<SearchResponse> {
  const query = encodeURIComponent(buildSearchQuery(hard));
  const url = `${SOLVED_AC_API_BASE}/search/problem?query=${query}&page=${page}&sort=random`;

  const response = await fetch(url, {
    headers: { 'x-solvedac-language': 'ko' },
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as SearchResponse;
}

/**
 * 조건에 맞는 문제 전부 가져오기 (hard: g3~g2, 기본: g5~g4)
 */
async function fetchAllProblems(hard: boolean = false): Promise<SolvedProblem[]> {
  const allProblems: SolvedProblem[] = [];
  let page = 1;
  const maxPages = 50;

  while (page <= maxPages) {
    const response = await fetchProblems(page, hard);

    if (response.items.length === 0) {
      break;
    }

    allProblems.push(...response.items);

    if (allProblems.length >= response.count) {
      break;
    }

    page++;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return allProblems;
}

/**
 * 배열에서 랜덤 요소 선택
 */
function getRandomElement<T>(array: T[]): T {
  const randomIndex = Math.floor(Math.random() * array.length);
  return array[randomIndex];
}

/**
 * 특정 유저가 푼 문제 목록 가져오기
 */
async function fetchUserSolvedProblems(userId: string): Promise<Set<number>> {
  const solvedProblems = new Set<number>();
  let page = 1;
  const maxPages = 100;

  try {
    while (page <= maxPages) {
      const url = `${SOLVED_AC_API_BASE}/search/problem?query=solved_by:${userId}&page=${page}&sort=id&direction=asc`;
      const response = await fetch(url, {
        headers: { 'x-solvedac-language': 'ko' },
      });

      if (!response.ok) {
        break;
      }

      const data = (await response.json()) as SearchResponse;

      if (data.items.length === 0) {
        break;
      }

      for (const problem of data.items) {
        solvedProblems.add(problem.problemId);
      }

      if (solvedProblems.size >= data.count) {
        break;
      }

      page++;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  } catch (error) {
    console.error(`Failed to fetch solved problems for ${userId}:`, error);
  }

  return solvedProblems;
}

/**
 * 유저별 통계 계산
 */
async function calculateUserStats(): Promise<
  Array<{ userId: string; solved: number; unsolved: number; total: number; unsolvedProblems: SelectedProblemRecord[] }>
> {
  const selectedData = loadSelectedProblems();

  const stats = [];

  for (const userId of EXCLUDE_USER_IDS) {
    const solvedProblems = await fetchUserSolvedProblems(userId);

    let solved = 0;
    const unsolvedProblems: SelectedProblemRecord[] = [];

    for (const problem of selectedData.problems) {
      if (solvedProblems.has(problem.problemId)) {
        solved++;
      } else {
        unsolvedProblems.push(problem);
      }
    }

    stats.push({
      userId,
      solved,
      unsolved: unsolvedProblems.length,
      total: selectedData.problems.length,
      unsolvedProblems,
    });
  }

  return stats;
}

/**
 * 랜덤 문제 선택
 * @param hard true면 골드 3~2, false면 골드 4~5
 */
async function selectRandomProblem(hard: boolean = false): Promise<{
  problem: SolvedProblem;
  record: SelectedProblemRecord;
  availableCount: number;
  totalCount: number;
} | null> {
  const selectedData = loadSelectedProblems();
  const selectedIds = new Set(selectedData.problems.map((p) => p.problemId));

  const allProblems = await fetchAllProblems(hard);
  const availableProblems = allProblems.filter(
    (p) => !selectedIds.has(p.problemId)
  );

  if (availableProblems.length === 0) {
    return null;
  }

  const selectedProblem = getRandomElement(availableProblems);
  const tier = levelToTier(selectedProblem.level);
  const problemUrl = `https://www.acmicpc.net/problem/${selectedProblem.problemId}`;

  const newRecord: SelectedProblemRecord = {
    problemId: selectedProblem.problemId,
    title: selectedProblem.titleKo,
    tier,
    selectedAt: new Date().toISOString(),
    url: problemUrl,
  };

  selectedData.problems.push(newRecord);
  saveSelectedProblems(selectedData);

  return {
    problem: selectedProblem,
    record: newRecord,
    availableCount: availableProblems.length - 1,
    totalCount: allProblems.length,
  };
}

// ============================================================
// Discord 봇 설정
// ============================================================

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

// 슬래시 커맨드 정의
const commands = [
  new SlashCommandBuilder()
    .setName('boj-random')
    .setDescription('랜덤으로 골드 4~5 백준 문제를 선택합니다. hard 옵션 시 골드 3~2.')
    .addBooleanOption((option: SlashCommandBooleanOption) =>
      option
        .setName('hard')
        .setDescription('true면 골드 3~2 난이도 추천 (기본: 골드 4~5)')
    ),
  new SlashCommandBuilder()
    .setName('boj-history')
    .setDescription('최근 선택된 문제 목록을 확인합니다')
    .addIntegerOption((option: SlashCommandIntegerOption) =>
      option
        .setName('count')
        .setDescription('표시할 문제 수 (기본값: 5)')
        .setMinValue(1)
        .setMaxValue(20)
    ),
  new SlashCommandBuilder()
    .setName('boj-stats')
    .setDescription('유저별 문제 풀이 통계를 확인합니다'),
  new SlashCommandBuilder()
    .setName('boj-reset')
    .setDescription('선택 기록을 초기화합니다'),
];

// 커맨드 등록
async function registerCommands(): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

  try {
    console.log('🔄 슬래시 커맨드 등록 중...');

    await rest.put(Routes.applicationCommands(client.user?.id ?? ''), {
      body: commands.map((cmd) => cmd.toJSON()),
    });

    console.log('✅ 슬래시 커맨드 등록 완료!');
  } catch (error) {
    console.error('❌ 슬래시 커맨드 등록 실패:', error);
  }
}

// /random 커맨드 핸들러
async function handleRandomCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply();

  const hard = interaction.options.getBoolean('hard') ?? false;

  try {
    const result = await selectRandomProblem(hard);

    if (result === null) {
      const tierRange = hard ? '골드 3~2' : '골드 4~5';
      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('⚠️ 문제 없음')
        .setDescription(
          `모든 ${tierRange} 문제를 이미 선택했습니다!\n\`/boj-reset\` 명령어로 기록을 초기화하세요.`
        );

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    const { problem, record, availableCount, totalCount } = result;

    const embed = new EmbedBuilder()
      .setColor(getTierColor(problem.level))
      .setTitle(`🎲 ${record.title}`)
      .setURL(record.url)
      .setDescription(`**문제 번호:** ${problem.problemId}`)
      .addFields(
        { name: '🏆 티어', value: record.tier, inline: true },
        {
          name: '👥 맞은 사람',
          value: `${problem.acceptedUserCount.toLocaleString()}명`,
          inline: true,
        },
        {
          name: '📊 평균 시도',
          value: `${problem.averageTries.toFixed(2)}회`,
          inline: true,
        }
      )
      .setFooter({
        text: `남은 문제: ${availableCount}개 / 전체: ${totalCount}개`,
      })
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('문제 선택 오류:', error);

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('❌ 오류 발생')
      .setDescription(
        '문제를 가져오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      );

    await interaction.editReply({ embeds: [embed] });
  }
}

// /history 커맨드 핸들러
async function handleHistoryCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const count = interaction.options.getInteger('count') ?? 5;
  const selectedData = loadSelectedProblems();

  if (selectedData.problems.length === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x808080)
      .setTitle('📝 선택 기록')
      .setDescription(
        '아직 선택된 문제가 없습니다. `/random` 명령어로 문제를 선택해보세요!'
      );

    await interaction.reply({ embeds: [embed] });
    return;
  }

  const recentProblems = selectedData.problems.slice(-count).reverse();

  const problemList = recentProblems
    .map((p, index) => {
      const date = new Date(p.selectedAt).toLocaleDateString('ko-KR');
      return `**${index + 1}.** [${p.title}](${p.url}) - ${p.tier} (${date})`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x00b4fc)
    .setTitle(`📝 최근 선택된 문제 (${recentProblems.length}개)`)
    .setDescription(problemList)
    .setFooter({
      text: `총 ${selectedData.problems.length}개의 문제가 선택됨`,
    });

  await interaction.reply({ embeds: [embed] });
}

// /stats 커맨드 핸들러
async function handleStatsCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  await interaction.deferReply();

  try {
    const stats = await calculateUserStats();

    if (stats.length === 0 || stats[0].total === 0) {
      const embed = new EmbedBuilder()
        .setColor(0x808080)
        .setTitle('📊 유저별 통계')
        .setDescription(
          '아직 선택된 문제가 없습니다. `/boj-random` 명령어로 문제를 선택해보세요!'
        );

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // 통계를 코드 블록 형식으로 포맷팅
    const longestName = Math.max(...stats.map((s) => s.userId.length));
    const header = `유저${' '.repeat(longestName - 2)} | 완료 | 미완료 | 진행률`;
    const separator = '-'.repeat(header.length);

    const rows = stats.map((stat) => {
      const padding = ' '.repeat(longestName - stat.userId.length);
      const percentage = stat.total > 0
        ? ((stat.solved / stat.total) * 100).toFixed(1)
        : '0.0';
      const solvedStr = stat.solved.toString().padStart(4);
      const unsolvedStr = stat.unsolved.toString().padStart(6);
      const percentStr = `${percentage}%`.padStart(7);

      return `${stat.userId}${padding} |${solvedStr} |${unsolvedStr} | ${percentStr}`;
    });

    const tableContent = [header, separator, ...rows].join('\n');

    const embed = new EmbedBuilder()
      .setColor(0x00b4fc)
      .setTitle('📊 유저별 문제 풀이 통계')
      .setDescription(`\`\`\`\n${tableContent}\n\`\`\``)
      .setFooter({
        text: `총 ${stats[0].total}개의 문제가 선택됨`,
      })
      .setTimestamp();

    for (const stat of stats) {
      if (stat.unsolvedProblems.length === 0) {
        embed.addFields({ name: `✅ ${stat.userId}`, value: '모든 문제 완료!' });
        continue;
      }

      const lines: string[] = [];
      for (const p of stat.unsolvedProblems) {
        const line = `• [${p.title}](${p.url}) - ${p.tier}`;
        if ((lines.join('\n') + '\n' + line).length > 950) {
          const remaining = stat.unsolvedProblems.length - lines.length;
          lines.push(`...외 ${remaining}개`);
          break;
        }
        lines.push(line);
      }

      embed.addFields({
        name: `❌ ${stat.userId} (${stat.unsolvedProblems.length}개 미완료)`,
        value: lines.join('\n'),
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('통계 조회 오류:', error);

    const embed = new EmbedBuilder()
      .setColor(0xff0000)
      .setTitle('❌ 오류 발생')
      .setDescription(
        '통계를 가져오는 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.'
      );

    await interaction.editReply({ embeds: [embed] });
  }
}

// /reset 커맨드 핸들러
async function handleResetCommand(
  interaction: ChatInputCommandInteraction
): Promise<void> {
  const selectedData = loadSelectedProblems();
  const count = selectedData.problems.length;

  saveSelectedProblems({ problems: [] });

  const embed = new EmbedBuilder()
    .setColor(0x00ff00)
    .setTitle('🔄 기록 초기화 완료')
    .setDescription(`${count}개의 선택 기록이 초기화되었습니다.`);

  await interaction.reply({ embeds: [embed] });
}

// 봇 준비 완료 이벤트
client.once(Events.ClientReady, async (readyClient: Client<true>) => {
  console.log(`✅ 봇이 준비되었습니다! ${readyClient.user.tag}로 로그인됨`);
  console.log(`👤 ${EXCLUDE_USER_IDS.join(', ')} 유저가 푼 문제는 제외됩니다`);

  await registerCommands();
});

// 인터랙션 이벤트 핸들러
client.on(Events.InteractionCreate, async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  switch (interaction.commandName) {
    case 'boj-random':
      await handleRandomCommand(interaction);
      break;
    case 'boj-history':
      await handleHistoryCommand(interaction);
      break;
    case 'boj-stats':
      await handleStatsCommand(interaction);
      break;
    case 'boj-reset':
      await handleResetCommand(interaction);
      break;
  }
});

// 봇 로그인
client.login(DISCORD_TOKEN).catch((error: unknown) => {
  console.error('❌ 봇 로그인 실패:', error);
  process.exit(1);
});
