import type { HelpModalContent } from "@/components/HelpModal";
import { oracleFateHelpContent } from "@/lib/help-modal/oracle-fate-content";
import type { SystemId } from "@/lib/oracle/axes/types";
import { SINGLE_SYSTEM_BY_ID } from "@/lib/oracle/single-system-ui";

function genericHelp(system: SystemId): HelpModalContent {
  const copy = SINGLE_SYSTEM_BY_ID[system];
  const lines = copy.explanation.join("\n");
  const body = `${copy.name}

${lines}

해석자 수는 3·5·7 중에서 고르며, 그만큼의 AI 브랜드가 같은 계산을 서로의 답을 보지 않고 각자 읽습니다. 종합은 다른 AI가 씁니다.

프로필에 이미 있는 값은 다시 묻지 않습니다. 생년월일·시간·도시·이름은 계산에만 쓰이며 모델에게는 축 코드만 전달됩니다.

해석자 3명 6크레딧 · 5명 10 · 7명 15.`;
  return { EN: body, KO: body, JA: body, FR: body, ES: body, PT: body };
}

export function oracleSystemHelpContent(system: SystemId): HelpModalContent {
  if (system === "saju") return oracleFateHelpContent;
  return genericHelp(system);
}
