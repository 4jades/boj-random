import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as http from "node:http";
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

// 설정 파일 경로
const SELECTED_PROBLEMS_PATH = path.join(
  __dirname,
  '..',
  'selected-problems.json'
);

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
 * 검색 쿼리 생성 (골드 4~5 + 맞은 사람 5000명 이상 + 유저가 푼 문제 제외)
 */
function buildSearchQuery(): string {
  let query = 'tier:g5..g4 solved:5000..';

  if (EXCLUDE_USER_IDS.length > 0) {
    const excludeConditions = EXCLUDE_USER_IDS.map(
      (id) => `!solved_by:${id}`
    ).join(' ');
    query = `${query} ${excludeConditions}`;
  }

  return query;
}

/**
 * solved.ac API로 골드 4~5 문제 검색
 */
async function fetchGoldProblems(page: number = 1): Promise<SearchResponse> {
  const query = encodeURIComponent(buildSearchQuery());
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
 * 모든 골드 4~5 문제 가져오기
 */
async function fetchAllGoldProblems(): Promise<SolvedProblem[]> {
  const allProblems: SolvedProblem[] = [];
  let page = 1;
  const maxPages = 50;

  while (page <= maxPages) {
    const response = await fetchGoldProblems(page);

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
 * 랜덤 문제 선택
 */
async function selectRandomProblem(): Promise<{
  problem: SolvedProblem;
  record: SelectedProblemRecord;
  availableCount: number;
  totalCount: number;
} | null> {
  const selectedData = loadSelectedProblems();
  const selectedIds = new Set(selectedData.problems.map((p) => p.problemId));

  const allProblems = await fetchAllGoldProblems();
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
    .setDescription('랜덤으로 골드 4~5 백준 문제를 선택합니다'),
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

  try {
    const result = await selectRandomProblem();

    if (result === null) {
      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle('⚠️ 문제 없음')
        .setDescription(
          '모든 골드 4~5 문제를 이미 선택했습니다!\n`/reset` 명령어로 기록을 초기화하세요.'
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
    case 'boj-reset':
      await handleResetCommand(interaction);
      break;
  }
});

// ============================================================
// HTTP 헬스체크 서버 (fly.io 머신 유지용)
// ============================================================

const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  if (req.url === '/health' || req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      bot: client.user?.tag || 'not ready'
    }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, () => {
  console.log(`🏥 헬스체크 서버가 포트 ${PORT}에서 실행 중입니다`);
});

// 봇 로그인
client.login(DISCORD_TOKEN).catch((error: unknown) => {
  console.error('❌ 봇 로그인 실패:', error);
  process.exit(1);
});
