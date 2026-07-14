import { Suspense } from "react";

import GameDayFlowsPrototype from "./game-day-flows-prototype";

// PROTOTYPE — Three game-day information architectures, switchable via
// ?variant=A|B|C on /prototype/game-day-flows.
export default function GameDayFlowsPrototypePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-[#f4f1e8]" />}>
      <GameDayFlowsPrototype />
    </Suspense>
  );
}
