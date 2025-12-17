import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ============================================================
// 설정: 제외할 백준 아이디 목록 (이 유저들이 푼 문제는 제외됨)
// ============================================================
const EXCLUDE_USER_IDS: string[] = [
  // 예시: "user1", "user2"
  "lindasoo",
  'gmyun1999',
  'hyuns6677',
  'mapledt001',
  'xornjsrlaals'
];

// 선택된 문제 기록 파일 경로
const SELECTED_PROBLEMS_PATH = path.join(__dirname, "..", "selected-problems.json");

// solved.ac API 기본 URL
const SOLVED_AC_API_BASE = "https://solved.ac/api/v3";

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
    1: "🤎 Bronze",
    2: "🤍 Silver",
    3: "💛 Gold",
    4: "💚 Platinum",
    5: "🩵 Diamond",
    6: "🩷 Ruby",
  };

  const tierIndex = Math.floor((level - 1) / 5) + 1;
  const tierNumber = 5 - ((level - 1) % 5);
  return `${tierMap[tierIndex]} ${tierNumber}`;
}

/**
 * 선택된 문제 목록 로드
 */
function loadSelectedProblems(): SelectedProblemsData {
  if (fs.existsSync(SELECTED_PROBLEMS_PATH)) {
    const data = fs.readFileSync(SELECTED_PROBLEMS_PATH, "utf8");
    return JSON.parse(data) as SelectedProblemsData;
  }
  return { problems: [] };
}

/**
 * 선택된 문제 저장
 */
function saveSelectedProblems(data: SelectedProblemsData): void {
  fs.writeFileSync(SELECTED_PROBLEMS_PATH, JSON.stringify(data, null, 2), "utf8");
}

/**
 * 검색 쿼리 생성 (골드 4~5 + 맞은 사람 5000명 이상 + 유저가 푼 문제 제외)
 */
function buildSearchQuery(): string {
  // 기본 쿼리: 골드 5~4 범위, 맞은 사람 5000명 이상
  let query = "tier:g5..g4 solved:5000..";

  // 제외할 유저가 있으면 !solved_by 조건 추가
  if (EXCLUDE_USER_IDS.length > 0) {
    const excludeConditions = EXCLUDE_USER_IDS.map((id) => `!solved_by:${id}`).join(" ");
    query = `${query} ${excludeConditions}`;
  }

  return query;
}

/**
 * solved.ac API로 골드 4~5 문제 검색 (유저가 푼 문제 제외)
 */
async function fetchGoldProblems(page: number = 1): Promise<SearchResponse> {
  const query = encodeURIComponent(buildSearchQuery());
  const url = `${SOLVED_AC_API_BASE}/search/problem?query=${query}&page=${page}&sort=random`;

  const response = await fetch(url, {
    headers: { "x-solvedac-language": "ko" },
  });

  if (!response.ok) {
    throw new Error(`API 요청 실패: ${response.status} ${response.statusText}`);
  }

  return (await response.json()) as SearchResponse;
}

/**
 * 모든 골드 4~5 문제 가져오기 (페이지네이션 처리)
 */
async function fetchAllGoldProblems(): Promise<SolvedProblem[]> {
  const allProblems: SolvedProblem[] = [];
  let page = 1;
  const maxPages = 50; // 최대 50페이지까지만 (약 2500문제)

  console.log("🔍 골드 4~5 문제 목록을 가져오는 중...");
  
  if (EXCLUDE_USER_IDS.length > 0) {
    console.log(`👤 제외할 유저: ${EXCLUDE_USER_IDS.join(", ")}`);
  }

  while (page <= maxPages) {
    const response = await fetchGoldProblems(page);
    
    if (response.items.length === 0) {
      break;
    }

    allProblems.push(...response.items);
    
    // 첫 페이지에서 총 문제 수 확인
    if (page === 1) {
      const excludeText = EXCLUDE_USER_IDS.length > 0 ? " (유저가 푼 문제 제외)" : "";
      console.log(`📊 총 ${response.count}개의 골드 4~5 문제가 있습니다.${excludeText}`);
    }

    // 모든 문제를 가져왔으면 종료
    if (allProblems.length >= response.count) {
      break;
    }

    page++;
    
    // API 호출 간격 조절 (rate limiting 방지)
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
 * 랜덤 문제 선택 및 기록
 */
async function selectRandomProblem(): Promise<void> {
  const selectedData = loadSelectedProblems();
  const selectedIds = new Set(selectedData.problems.map((p) => p.problemId));

  console.log(`📝 이전에 선택된 문제: ${selectedIds.size}개\n`);

  // 모든 골드 4~5 문제 가져오기
  const allProblems = await fetchAllGoldProblems();

  // 이미 선택된 문제 제외
  const availableProblems = allProblems.filter((p) => !selectedIds.has(p.problemId));

  console.log(`\n✅ 선택 가능한 문제: ${availableProblems.length}개`);

  if (availableProblems.length === 0) {
    console.log("\n⚠️  모든 골드 4~5 문제를 이미 선택했습니다!");
    console.log("💡 선택 기록을 초기화하려면 selected-problems.json 파일을 삭제하세요.");
    return;
  }

  // 랜덤 선택
  const selectedProblem = getRandomElement(availableProblems);
  const tier = levelToTier(selectedProblem.level);
  const problemUrl = `https://www.acmicpc.net/problem/${selectedProblem.problemId}`;

  // 기록에 추가
  const newRecord: SelectedProblemRecord = {
    problemId: selectedProblem.problemId,
    title: selectedProblem.titleKo,
    tier,
    selectedAt: new Date().toISOString(),
    url: problemUrl,
  };

  selectedData.problems.push(newRecord);
  saveSelectedProblems(selectedData);

  // 결과 출력
  console.log("\n🎲 ==================== 선택된 문제 ====================");
  console.log(`📌 문제 번호: ${selectedProblem.problemId}`);
  console.log(`📖 제목: ${selectedProblem.titleKo}`);
  console.log(`🏆 티어: ${tier}`);
  console.log(`👥 맞은 사람: ${selectedProblem.acceptedUserCount}명`);
  console.log(`📊 평균 시도: ${selectedProblem.averageTries.toFixed(2)}회`);
  console.log(`🔗 링크: ${problemUrl}`);
  console.log("======================================================\n");
}

// 메인 실행
selectRandomProblem().catch((error) => {
  console.error("❌ 오류 발생:", error);
  process.exit(1);
});

