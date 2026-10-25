import {
  getConquestProbability,
  getExpectedRemainingMobileAttackers,
} from './combatMath';
import { GameState, getCardTradeBonus } from './gameState';
import {
  CONTINENTS,
  ContinentId,
  mapVersion,
  TERRITORIES,
  TERRITORY_MAP,
} from './mapData';

export interface AIReinforceAction {
  territoryId: string;
  amount: number;
  reason: string;
}

export interface AIAttackDecision {
  fromId: string;
  toId: string;
  winProb: number;
  score: number;
  reason: string;
}

export interface AIFortifyDecision {
  fromId: string;
  toId: string;
  amount: number;
  path: string[];
}

interface ContinentEval {
  continentId: ContinentId;
  totalTerritories: number;
  myTerritories: number;
  enemyTerritories: number;
  enemyTroops: number;
  myTroops: number;
  localMyMobileTroops: number;
  externalThreat: number;
  canCompleteThisTurn: boolean;
  isMissionTarget: boolean;
  attractiveness: number;
}

interface ContinentGuardDuty {
  bonusAtStake: number;
  continentIds: ContinentId[];
  continentNames: string[];
  isForwardShield: boolean;
}

interface AttackCorridor {
  fromId: string;
  path: string[]; // ordered sequence of enemy territories [step1, step2, ...]
  totalDefenders: number;
  minTroopsRequired: number;
  chainWinProb: number;
  expectedFinalTroops: number;
}

interface EliminationPlan {
  targetPlayerId: number;
  isInstantVictory: boolean;
  triggersCardCascade: boolean;
  cardsLooted: number;
  corridors: AttackCorridor[];
  totalExtraTroopsNeeded: number;
  feasibleThisTurn: boolean;
  priorityScore: number;
}

interface OpponentProfile {
  playerId: number;
  territories: number;
  troops: number;
  income: number;
  continents: ContinentId[];
  cards: number;
  isLeader: boolean;
  isNearVictory: boolean;
  threatMultiplier: number;
}

// Dynamic continent topology cache (automatically refreshed when mapVersion changes)
const CONTINENT_TERRITORIES: Record<ContinentId, string[]> = {
  north_america: [],
  south_america: [],
  europe: [],
  africa: [],
  asia: [],
  australia: [],
};

const CONTINENT_GATEWAYS: Record<ContinentId, string[]> = {
  north_america: [],
  south_america: [],
  europe: [],
  africa: [],
  asia: [],
  australia: [],
};

const CONTINENT_EXTERNAL_NEIGHBORS: Record<ContinentId, string[]> = {
  north_america: [],
  south_america: [],
  europe: [],
  africa: [],
  asia: [],
  australia: [],
};

let cachedTopologyMapVersion = -1;

function ensureTopologyCache(): void {
  if (cachedTopologyMapVersion === mapVersion) return;
  cachedTopologyMapVersion = mapVersion;

  for (const cId of Object.keys(CONTINENTS) as ContinentId[]) {
    const cTerrs = TERRITORIES.filter((t) => t.continent === cId);
    CONTINENT_TERRITORIES[cId] = cTerrs.map((t) => t.id);

    const gateways: string[] = [];
    const extSet = new Set<string>();
    for (const t of cTerrs) {
      let hasExternal = false;
      for (const nId of t.neighbors) {
        if (TERRITORY_MAP[nId]?.continent !== cId) {
          hasExternal = true;
          extSet.add(nId);
        }
      }
      if (hasExternal) {
        gateways.push(t.id);
      }
    }
    CONTINENT_GATEWAYS[cId] = gateways;
    CONTINENT_EXTERNAL_NEIGHBORS[cId] = Array.from(extSet);
  }
}

ensureTopologyCache();

export class GrandmasterAI {
  // ==========================================================================
  // 1. MULTI-HOP MARKOV CHAIN COMBAT & FAST MULTI-SOURCE PATHFINDING ENGINE
  // ==========================================================================

  /**
   * Evaluates sequential conquest of a chain of enemy territories `[e_1, e_2, ..., e_k]`
   * starting with `startTroops` on a friendly launch territory.
   */
  public static evaluateAttackChain(
    state: GameState,
    startTroops: number,
    enemyPath: string[],
    leaveBehindPerStep = 1
  ): { chainWinProb: number; expectedFinalTroops: number; totalDefenders: number } {
    let currentTroops = startTroops;
    let chainWinProb = 1.0;
    let totalDefenders = 0;

    for (const enemyId of enemyPath) {
      const defTroops = state.territories[enemyId].troops;
      totalDefenders += defTroops;

      const roundedCurrent = Math.floor(currentTroops);
      if (roundedCurrent < 1 + leaveBehindPerStep) {
        return { chainWinProb: 0, expectedFinalTroops: 0, totalDefenders };
      }

      const effectiveAttackers = roundedCurrent - (leaveBehindPerStep - 1);
      const stepProb = getConquestProbability(effectiveAttackers, defTroops);
      if (stepProb < 0.02) {
        return { chainWinProb: 0, expectedFinalTroops: 0, totalDefenders };
      }

      const expectedRemUncond = getExpectedRemainingMobileAttackers(
        effectiveAttackers,
        defTroops
      );
      const expectedAdvancing = expectedRemUncond / Math.max(0.05, stepProb);

      chainWinProb *= stepProb;
      currentTroops = expectedAdvancing;
    }

    return {
      chainWinProb,
      expectedFinalTroops: currentTroops,
      totalDefenders,
    };
  }

  /**
   * Computes via binary search the minimum starting troops needed on `fromId`
   * to conquer the entire `enemyPath` with probability >= `targetProb`.
   */
  public static getMinTroopsForChain(
    state: GameState,
    enemyPath: string[],
    targetProb = 0.66,
    leaveBehindPerStep = 1
  ): number {
    if (enemyPath.length === 0) return 1;
    let low = 1 + enemyPath.length * leaveBehindPerStep;
    let high = 160;
    let ans = high;

    while (low <= high) {
      const mid = (low + high) >> 1;
      const { chainWinProb } = this.evaluateAttackChain(
        state,
        mid,
        enemyPath,
        leaveBehindPerStep
      );
      if (chainWinProb >= targetProb) {
        ans = mid;
        high = mid - 1;
      } else {
        low = mid + 1;
      }
    }
    return ans;
  }

  /**
   * Fast Multi-Source Dijkstra search from all border territories owned by `playerId`
   * to find the lowest-casualty invasion corridor into any territory in `targetIds` (up to `maxHops`).
   */
  public static findShortestAttackCorridor(
    state: GameState,
    playerId: number,
    targetIds: Set<string>,
    maxHops = 4,
    targetWinProb = 0.65
  ): AttackCorridor | null {
    if (targetIds.size === 0) return null;

    const myTerrs = state.getPlayerTerritories(playerId);
    const dist: Record<string, number> = {};
    const origin: Record<string, string> = {};
    const parent: Record<string, string | null> = {};
    const hops: Record<string, number> = {};
    const queue: string[] = [];

    // Seed multi-source Dijkstra with all 1-hop enemy neighbors of our border territories
    for (const startState of myTerrs) {
      for (const nId of TERRITORY_MAP[startState.id].neighbors) {
        const nState = state.territories[nId];
        if (nState.ownerId === playerId) continue;
        // Effective cost accounts for step attrition minus existing mobile attackers at `startState`
        const stepAttrition = nState.troops * 1.15 + 1.25;
        const effectiveCost =
          stepAttrition - Math.min(stepAttrition * 0.85, (startState.troops - 1) * 0.7);
        if (dist[nId] === undefined || effectiveCost < dist[nId]) {
          dist[nId] = effectiveCost;
          origin[nId] = startState.id;
          parent[nId] = null;
          hops[nId] = 1;
          if (!queue.includes(nId)) {
            queue.push(nId);
          }
        }
      }
    }

    let bestCorridor: AttackCorridor | null = null;
    let bestNetCost = Infinity;

    while (queue.length > 0) {
      queue.sort((a, b) => dist[a] - dist[b]);
      const curr = queue.shift()!;
      const currHops = hops[curr];

      if (targetIds.has(curr)) {
        const path: string[] = [];
        let step: string | null = curr;
        while (step !== null) {
          path.unshift(step);
          step = parent[step] ?? null;
        }

        const fromId = origin[curr];
        const fromTroops = state.territories[fromId].troops;
        const minReq = this.getMinTroopsForChain(state, path, targetWinProb);
        const evalRes = this.evaluateAttackChain(state, fromTroops, path);
        const extraNeeded = Math.max(0, minReq - fromTroops);
        const netScore = extraNeeded * 1.4 + evalRes.totalDefenders * 0.6 + path.length * 0.8;

        if (netScore < bestNetCost) {
          bestNetCost = netScore;
          bestCorridor = {
            fromId,
            path,
            totalDefenders: evalRes.totalDefenders,
            minTroopsRequired: minReq,
            chainWinProb: evalRes.chainWinProb,
            expectedFinalTroops: evalRes.expectedFinalTroops,
          };
        }
        continue;
      }

      if (currHops >= maxHops) continue;

      for (const nextId of TERRITORY_MAP[curr].neighbors) {
        const nextState = state.territories[nextId];
        if (nextState.ownerId === playerId) continue;
        const nextCost = dist[curr] + nextState.troops * 1.15 + 1.25;
        if (dist[nextId] === undefined || nextCost < dist[nextId]) {
          dist[nextId] = nextCost;
          origin[nextId] = origin[curr];
          parent[nextId] = curr;
          hops[nextId] = currHops + 1;
          if (!queue.includes(nextId)) {
            queue.push(nextId);
          }
        }
      }
    }

    return bestCorridor;
  }

  /**
   * Computes total enemy troops reachable within `maxHops` steps from `fromId`.
   */
  public static getReachableEnemyTroops(
    state: GameState,
    fromId: string,
    playerId: number,
    maxHops = 3
  ): { enemyTerrCount: number; enemyTroopSum: number } {
    const visited = new Set<string>();
    const queue: { id: string; depth: number }[] = [];

    for (const nId of TERRITORY_MAP[fromId].neighbors) {
      if (state.territories[nId].ownerId !== playerId) {
        visited.add(nId);
        queue.push({ id: nId, depth: 1 });
      }
    }

    let enemyTerrCount = 0;
    let enemyTroopSum = 0;

    while (queue.length > 0) {
      const curr = queue.shift()!;
      enemyTerrCount++;
      enemyTroopSum += state.territories[curr.id].troops;

      if (curr.depth >= maxHops) continue;
      for (const nextId of TERRITORY_MAP[curr.id].neighbors) {
        if (
          state.territories[nextId].ownerId !== playerId &&
          !visited.has(nextId)
        ) {
          visited.add(nextId);
          queue.push({ id: nextId, depth: curr.depth + 1 });
        }
      }
    }

    return { enemyTerrCount, enemyTroopSum };
  }

  // ==========================================================================
  // 2. GLOBAL THREAT & OPPONENT PROFILER (ANTI-LEADER / BALANCE OF POWER)
  // ==========================================================================

  public static evaluateOpponents(
    state: GameState,
    myPlayerId: number
  ): Record<number, OpponentProfile> {
    const profiles: Record<number, OpponentProfile> = {};
    const ranking = state.getScoreRanking();
    const totalCaps = Object.keys(state.capitalTerritoryIds).length;

    let maxEnemyIncome = 3;
    for (const p of state.players) {
      if (p.id === myPlayerId || p.eliminated) continue;
      const inc = state.calculateTurnReinforcements(p.id).total;
      if (inc > maxEnemyIncome) maxEnemyIncome = inc;
    }

    for (const p of state.players) {
      if (p.id === myPlayerId || p.eliminated) continue;
      const terrs = state.getPlayerTerritories(p.id);
      const troops = state.getPlayerTotalTroops(p.id);
      const reinf = state.calculateTurnReinforcements(p.id);
      const rankEntry = ranking.find((r) => r.player.id === p.id);
      const isLeader = rankEntry?.rank === 1;

      let isNearVictory = false;
      let threatMultiplier =
        1.0 + (reinf.total / Math.max(4, maxEnemyIncome)) * 0.35;

      if (isLeader) {
        threatMultiplier += 0.3;
      }

      if (state.gameMode === 'CAPITALS' && totalCaps >= 2) {
        const controlledCaps = state.getPlayerControlledCapitals(p.id).length;
        if (controlledCaps >= totalCaps - 1) {
          isNearVictory = true;
          threatMultiplier += 0.9;
        } else if (controlledCaps >= 2) {
          threatMultiplier += 0.4;
        }
      } else if (state.gameMode === 'DOMINATION_70') {
        if (terrs.length >= 24) {
          isNearVictory = true;
          threatMultiplier += 0.85;
        } else if (terrs.length >= 20) {
          threatMultiplier += 0.4;
        }
      } else if (state.gameMode === 'SECRET_MISSIONS') {
        const twoPlus = terrs.filter((t) => t.troops >= 2).length;
        if (
          terrs.length >= 20 ||
          twoPlus >= 15 ||
          reinf.continents.length >= 2
        ) {
          isNearVictory = true;
          threatMultiplier += 0.7;
        }
      } else if (state.gameMode === 'TURN_LIMIT') {
        if (isLeader) {
          threatMultiplier += state.turnNumber >= 8 ? 0.75 : 0.35;
          if (state.turnNumber >= 9) isNearVictory = true;
        }
      } else {
        if (terrs.length >= 22 || reinf.total >= 12) {
          isNearVictory = true;
          threatMultiplier += 0.6;
        }
      }

      profiles[p.id] = {
        playerId: p.id,
        territories: terrs.length,
        troops,
        income: reinf.total,
        continents: reinf.continents,
        cards: p.cards.length,
        isLeader,
        isNearVictory,
        threatMultiplier,
      };
    }

    return profiles;
  }

  // ==========================================================================
  // 3. CONTINENT & FORWARD-SHIELD CHOKE-POINT TOPOLOGY
  // ==========================================================================

  /**
   * Computes which owned border territories are actively guarding an owned continent.
   * Detects BOTH interior gateways (e.g. `indonesia`, `venezuela`, `brazil`)
   * AND 1-step exterior forward buffer shields (e.g. `siam` shielding Australia,
   * `central_america` shielding South America, `middle_east` shielding Egypt/East Africa).
   */
  public static getContinentGuardDuties(
    state: GameState,
    playerId: number
  ): Record<string, ContinentGuardDuty> {
    ensureTopologyCache();
    const duties: Record<string, ContinentGuardDuty> = {};
    const ownedContinents = state.getPlayerContinents(playerId);

    const addDuty = (
      tId: string,
      cId: ContinentId,
      bonus: number,
      isForwardShield: boolean
    ) => {
      if (!duties[tId]) {
        duties[tId] = {
          bonusAtStake: 0,
          continentIds: [],
          continentNames: [],
          isForwardShield,
        };
      }
      if (!duties[tId].continentIds.includes(cId)) {
        duties[tId].bonusAtStake += bonus;
        duties[tId].continentIds.push(cId);
        duties[tId].continentNames.push(CONTINENTS[cId].name);
      }
      if (isForwardShield) {
        duties[tId].isForwardShield = true;
      }
    };

    for (const cId of ownedContinents) {
      const bonus = CONTINENTS[cId].bonus;
      const gateways = CONTINENT_GATEWAYS[cId];

      for (const gwId of gateways) {
        if (state.isBorderTerritory(gwId)) {
          addDuty(gwId, cId, bonus, false);
        } else {
          const extNeighbors = TERRITORY_MAP[gwId].neighbors.filter(
            (nId) =>
              TERRITORY_MAP[nId].continent !== cId &&
              state.territories[nId].ownerId === playerId &&
              state.isBorderTerritory(nId)
          );
          if (extNeighbors.length > 0 && extNeighbors.length <= 2) {
            for (const shieldId of extNeighbors) {
              addDuty(shieldId, cId, bonus / extNeighbors.length, true);
            }
          }
        }
      }
    }

    return duties;
  }

  /**
   * Evaluates whether conquering `candidateToId` creates a 1-territory exterior buffer shield
   * that seals 1 or more gateways of a continent already owned by `playerId`.
   */
  public static getForwardShieldExpansionBonus(
    state: GameState,
    playerId: number,
    candidateToId: string
  ): { bonusScore: number; continentName: string | null } {
    ensureTopologyCache();
    const ownedContinents = state.getPlayerContinents(playerId);
    if (ownedContinents.length === 0) {
      return { bonusScore: 0, continentName: null };
    }

    let totalScore = 0;
    let bestContName: string | null = null;

    for (const cId of ownedContinents) {
      if (TERRITORY_MAP[candidateToId].continent === cId) continue;
      if (!CONTINENT_EXTERNAL_NEIGHBORS[cId].includes(candidateToId)) continue;

      let gatewaysSealed = 0;
      for (const gwId of CONTINENT_GATEWAYS[cId]) {
        if (!TERRITORY_MAP[gwId].neighbors.includes(candidateToId)) continue;
        const otherExposed = TERRITORY_MAP[gwId].neighbors.some(
          (nId) =>
            nId !== candidateToId &&
            state.territories[nId].ownerId !== playerId
        );
        if (!otherExposed) {
          gatewaysSealed++;
        }
      }

      if (gatewaysSealed > 0) {
        const val = CONTINENTS[cId].bonus * 8 * gatewaysSealed;
        if (val > totalScore) {
          totalScore = val;
          bestContName = CONTINENTS[cId].name;
        }
      }
    }

    return { bonusScore: totalScore, continentName: bestContName };
  }

  /**
   * Simulates conquering `toId` and returns how it changes the player's total border territory count.
   */
  public static evaluateBorderDelta(
    state: GameState,
    playerId: number,
    toId: string
  ): { borderCountDelta: number; becomesInteriorCount: number } {
    const prevOwner = state.territories[toId].ownerId;
    if (prevOwner === playerId) {
      return { borderCountDelta: 0, becomesInteriorCount: 0 };
    }

    const affectedIds = [
      toId,
      ...TERRITORY_MAP[toId].neighbors.filter(
        (nId) => state.territories[nId].ownerId === playerId
      ),
    ];

    let bordersBefore = 0;
    for (const id of affectedIds) {
      if (id !== toId && state.isBorderTerritory(id)) {
        bordersBefore++;
      }
    }

    state.territories[toId].ownerId = playerId;
    let bordersAfter = 0;
    let becomesInteriorCount = 0;
    for (const id of affectedIds) {
      const isBorderNow = state.isBorderTerritory(id);
      if (isBorderNow) {
        bordersAfter++;
      } else if (id !== toId) {
        becomesInteriorCount++;
      }
    }
    state.territories[toId].ownerId = prevOwner;

    return {
      borderCountDelta: bordersAfter - bordersBefore,
      becomesInteriorCount,
    };
  }

  /**
   * Evaluates all 6 continents from the perspective of `playerId`.
   */
  public static evaluateContinents(
    state: GameState,
    playerId: number
  ): Record<ContinentId, ContinentEval> {
    ensureTopologyCache();
    const result = {} as Record<ContinentId, ContinentEval>;

    const reinfAvailable =
      state.currentPlayer.id === playerId && state.phase === 'REINFORCE'
        ? state.reinforcementsRemaining
        : 0;

    for (const cId of Object.keys(CONTINENTS) as ContinentId[]) {
      const cDef = CONTINENTS[cId];
      const terrIds = CONTINENT_TERRITORIES[cId];
      let myTerritories = 0;
      let enemyTerritories = 0;
      let enemyTroops = 0;
      let myTroops = 0;
      let localMyMobileTroops = 0;

      for (const tId of terrIds) {
        const ts = state.territories[tId];
        if (ts.ownerId === playerId) {
          myTerritories++;
          myTroops += ts.troops;
          localMyMobileTroops += Math.max(0, ts.troops - 1);
        } else {
          enemyTerritories++;
          enemyTroops += ts.troops;
        }
      }

      for (const extId of CONTINENT_EXTERNAL_NEIGHBORS[cId]) {
        const extState = state.territories[extId];
        if (extState.ownerId === playerId) {
          localMyMobileTroops += Math.max(0, extState.troops - 1);
        }
      }

      let externalThreat = 0;
      for (const extId of CONTINENT_EXTERNAL_NEIGHBORS[cId]) {
        const extState = state.territories[extId];
        if (extState.ownerId !== playerId) {
          externalThreat += Math.max(0, extState.troops - 1);
        }
      }

      const ownershipRatio = myTerritories / Math.max(1, terrIds.length);
      const chokeCount = Math.max(1, CONTINENT_GATEWAYS[cId].length);
      const defenseEfficiency = cDef.bonus / chokeCount;
      const troopAdvantage =
        (myTroops + reinfAvailable + 2) / (enemyTroops + 2);

      const estClearCost = Math.ceil(enemyTroops * 1.15) + enemyTerritories;
      const canCompleteThisTurn =
        enemyTerritories > 0 &&
        localMyMobileTroops + reinfAvailable >= estClearCost + 1;

      let attractiveness =
        ownershipRatio * 48 +
        defenseEfficiency * 20 +
        Math.min(3.0, troopAdvantage) * 18 -
        enemyTroops * 1.5 -
        Math.max(0, externalThreat - myTroops) * 0.45;

      if (enemyTerritories === 0) {
        attractiveness += 60 + cDef.bonus * 5;
      } else {
        if (canCompleteThisTurn) {
          attractiveness += 44 + cDef.bonus * 6;
        }
        if (enemyTerritories === 1) {
          attractiveness += 40;
        } else if (enemyTerritories === 2 && myTerritories >= 2) {
          attractiveness += 24;
        }
      }

      result[cId] = {
        continentId: cId,
        totalTerritories: terrIds.length,
        myTerritories,
        enemyTerritories,
        enemyTroops,
        myTroops,
        localMyMobileTroops,
        externalThreat,
        canCompleteThisTurn,
        isMissionTarget: false,
        attractiveness,
      };
    }

    const player = state.players[playerId];
    if (
      state.gameMode === 'SECRET_MISSIONS' &&
      player?.mission?.type === 'CONTINENTS'
    ) {
      const reqs = player.mission.requiredContinents ?? [];
      for (const reqId of reqs) {
        if (result[reqId]) {
          result[reqId].attractiveness += 120;
          result[reqId].isMissionTarget = true;
        }
      }

      const extraCount = player.mission.extraContinentsCount ?? 0;
      if (extraCount > 0) {
        const nonReqs = (Object.keys(CONTINENTS) as ContinentId[])
          .filter((cId) => !reqs.includes(cId))
          .sort((a, b) => result[b].attractiveness - result[a].attractiveness);
        for (let i = 0; i < Math.min(extraCount, nonReqs.length); i++) {
          result[nonReqs[i]].attractiveness += 90;
          result[nonReqs[i]].isMissionTarget = true;
        }
      }
    }

    return result;
  }

  /**
   * Computes external enemy threat adjacent to a territory.
   */
  public static getAdjacentEnemyThreat(
    state: GameState,
    territoryId: string,
    ownerId: number
  ): number {
    let sumMobileThreat = 0;
    let maxStackThreat = 0;
    for (const nId of TERRITORY_MAP[territoryId].neighbors) {
      const nState = state.territories[nId];
      if (nState.ownerId !== ownerId) {
        const mobile = Math.max(0.5, nState.troops - 1);
        sumMobileThreat += mobile;
        if (mobile > maxStackThreat) {
          maxStackThreat = mobile;
        }
      }
    }
    return maxStackThreat * 0.65 + sumMobileThreat * 0.45;
  }

  /**
   * Checks if an enemy player completely owns the continent of `territoryId`.
   */
  public static getEnemyContinentBreakBonus(
    state: GameState,
    territoryId: string
  ): number {
    ensureTopologyCache();
    const tState = state.territories[territoryId];
    const cId = TERRITORY_MAP[territoryId].continent;
    const cTerrIds = CONTINENT_TERRITORIES[cId];
    const allOwnedByThisEnemy = cTerrIds.every(
      (id) => state.territories[id].ownerId === tState.ownerId
    );
    if (allOwnedByThisEnemy) {
      return CONTINENTS[cId].bonus * 18;
    }
    return 0;
  }

  // ==========================================================================
  // 4. PLAYER ELIMINATION & CARD-BOUNTY CASCADE PLANNER
  // ==========================================================================

  public static evaluateEliminationPlans(
    state: GameState,
    playerId: number
  ): EliminationPlan[] {
    const player = state.players[playerId];
    const activeOpponents = state.players.filter(
      (p) => p.id !== playerId && !p.eliminated
    );
    const reinfAvailable =
      state.currentPlayer.id === playerId && state.phase === 'REINFORCE'
        ? state.reinforcementsRemaining
        : 0;

    const plans: EliminationPlan[] = [];

    for (const opp of activeOpponents) {
      const oppTerrs = state.getPlayerTerritories(opp.id);
      if (oppTerrs.length === 0) continue;

      const isMissionTarget =
        state.gameMode === 'SECRET_MISSIONS' &&
        player.mission?.type === 'ELIMINATE_PLAYER' &&
        !player.mission.fallbackTo24 &&
        player.mission.targetPlayerId === opp.id;

      const isLastOpponent = activeOpponents.length === 1;
      const isInstantVictory = isMissionTarget || isLastOpponent;

      const oppIds = new Set(oppTerrs.map((t) => t.id));

      if (oppTerrs.length > 5) {
        if (!isMissionTarget) continue;
        const approachCorr = this.findShortestAttackCorridor(
          state,
          playerId,
          oppIds,
          4,
          0.58
        );
        if (approachCorr) {
          plans.push({
            targetPlayerId: opp.id,
            isInstantVictory: false,
            triggersCardCascade: false,
            cardsLooted: opp.cards.length,
            corridors: [approachCorr],
            totalExtraTroopsNeeded: Math.max(
              0,
              approachCorr.minTroopsRequired -
                state.territories[approachCorr.fromId].troops
            ),
            feasibleThisTurn: true,
            priorityScore: 95,
          });
        }
        continue;
      }

      const visited = new Set<string>();
      const components: Set<string>[] = [];

      for (const t of oppTerrs) {
        if (visited.has(t.id)) continue;
        const comp = new Set<string>();
        const q = [t.id];
        visited.add(t.id);
        while (q.length > 0) {
          const curr = q.shift()!;
          comp.add(curr);
          for (const nId of TERRITORY_MAP[curr].neighbors) {
            if (oppIds.has(nId) && !visited.has(nId)) {
              visited.add(nId);
              q.push(nId);
            }
          }
        }
        components.push(comp);
      }

      const corridors: AttackCorridor[] = [];
      let totalExtraNeeded = 0;
      let possible = true;

      for (const comp of components) {
        const entryCorridor = this.findShortestAttackCorridor(
          state,
          playerId,
          comp,
          3,
          isInstantVictory ? 0.50 : 0.64
        );
        if (!entryCorridor) {
          possible = false;
          break;
        }

        const fullChain = [...entryCorridor.path];
        for (const cTerrId of comp) {
          if (!fullChain.includes(cTerrId)) {
            fullChain.push(cTerrId);
          }
        }

        const minReq = this.getMinTroopsForChain(
          state,
          fullChain,
          isInstantVictory ? 0.48 : 0.62
        );
        const evalChain = this.evaluateAttackChain(
          state,
          state.territories[entryCorridor.fromId].troops,
          fullChain
        );

        const extraForComp = Math.max(
          0,
          minReq - state.territories[entryCorridor.fromId].troops
        );
        totalExtraNeeded += extraForComp;

        corridors.push({
          fromId: entryCorridor.fromId,
          path: fullChain,
          totalDefenders: evalChain.totalDefenders,
          minTroopsRequired: minReq,
          chainWinProb: evalChain.chainWinProb,
          expectedFinalTroops: evalChain.expectedFinalTroops,
        });
      }

      if (!possible || corridors.length === 0) continue;

      const feasibleThisTurn = totalExtraNeeded <= reinfAvailable;
      const cardsLooted = opp.cards.length;
      const triggersCardCascade =
        cardsLooted > 0 && player.cards.length + cardsLooted >= 5;
      const nextTradeVal = getCardTradeBonus(state.cardTradesCompleted);

      let priorityScore = 0;
      if (isInstantVictory) {
        priorityScore = feasibleThisTurn ? 340 : 140;
      } else if (feasibleThisTurn) {
        priorityScore = 70 + cardsLooted * 30;
        if (triggersCardCascade) {
          priorityScore += 65 + nextTradeVal * 9;
        }
        if (state.gameMode === 'TURN_LIMIT') {
          priorityScore += 55;
        }
      } else if (oppTerrs.length <= 2 && cardsLooted >= 2) {
        priorityScore = 40 + cardsLooted * 14;
      }

      if (priorityScore > 0) {
        plans.push({
          targetPlayerId: opp.id,
          isInstantVictory,
          triggersCardCascade,
          cardsLooted,
          corridors,
          totalExtraTroopsNeeded: totalExtraNeeded,
          feasibleThisTurn,
          priorityScore,
        });
      }
    }

    plans.sort((a, b) => b.priorityScore - a.priorityScore);
    return plans;
  }

  // ==========================================================================
  // 5. SMART CARD TRADING
  // ==========================================================================

  public static shouldTradeCards(state: GameState, playerId: number): boolean {
    const player = state.players[playerId];
    const set = state.findValidCardSet(player.cards, playerId);
    if (!set) return false;
    if (player.cards.length >= 4) return true;

    const nextBonus = getCardTradeBonus(state.cardTradesCompleted);
    if (nextBonus >= 6) return true;

    const hasTerritoryMatch = set.some(
      (c) =>
        c.territoryId && state.territories[c.territoryId]?.ownerId === playerId
    );
    if (hasTerritoryMatch) return true;

    return state.turnNumber >= 2;
  }

  // ==========================================================================
  // 6. GRANDMASTER REINFORCEMENT PLANNER
  // ==========================================================================

  public static planReinforcements(state: GameState): AIReinforceAction[] {
    const player = state.currentPlayer;
    const myTerrs = state.getPlayerTerritories(player.id);
    if (myTerrs.length === 0 || state.reinforcementsRemaining <= 0) return [];

    const actions: AIReinforceAction[] = [];
    let rem = state.reinforcementsRemaining;

    const addReinforce = (
      territoryId: string,
      amount: number,
      reason: string
    ) => {
      if (amount <= 0) return;
      const existing = actions.find((a) => a.territoryId === territoryId);
      if (existing) {
        existing.amount += amount;
      } else {
        actions.push({ territoryId, amount, reason });
      }
      rem -= amount;
    };

    // ------------------------------------------------------------------------
    // STEP 1: "18 Territories with 2+ Troops" Secret Mission Instant-Win / Top-Up
    // ------------------------------------------------------------------------
    if (
      state.gameMode === 'SECRET_MISSIONS' &&
      player.mission?.type === 'TERRITORIES_18_TROOPS_2' &&
      myTerrs.length >= 14
    ) {
      const oneTroopTerrs = myTerrs
        .filter((t) => t.troops === 1)
        .sort((a, b) => {
          const aB = state.isBorderTerritory(a.id) ? 1 : 0;
          const bB = state.isBorderTerritory(b.id) ? 1 : 0;
          return bB - aB;
        });

      const twoPlusCount = myTerrs.length - oneTroopTerrs.length;
      const neededFor18 = Math.max(0, 18 - twoPlusCount);

      if (myTerrs.length >= 18 || oneTroopTerrs.length > 0) {
        const toTopUp =
          myTerrs.length >= 18
            ? Math.min(
                oneTroopTerrs.length,
                Math.max(neededFor18, oneTroopTerrs.length)
              )
            : oneTroopTerrs.length;
        for (let i = 0; i < toTopUp && rem > 0; i++) {
          addReinforce(
            oneTroopTerrs[i].id,
            1,
            'Missionsziel: 18 Gebiete mit 2+ Truppen sichern'
          );
        }
        if (rem <= 0) return actions;
      }
    }

    const contEvals = this.evaluateContinents(state, player.id);
    const guardDuties = this.getContinentGuardDuties(state, player.id);
    const opponentProfiles = this.evaluateOpponents(state, player.id);
    const eliminationPlans = this.evaluateEliminationPlans(state, player.id);

    // ------------------------------------------------------------------------
    // STEP 2: Precompute Multi-Hop Campaign Bonuses
    // ------------------------------------------------------------------------
    const multiHopLaunchScore: Record<string, { score: number; reason: string }> =
      {};
    const recordLaunchBoost = (tId: string, score: number, reason: string) => {
      if (!multiHopLaunchScore[tId] || score > multiHopLaunchScore[tId].score) {
        multiHopLaunchScore[tId] = { score, reason };
      }
    };

    // 2a. Player Elimination / Secret Mission Target Corridors
    for (const plan of eliminationPlans) {
      const targetName = state.players[plan.targetPlayerId].name;
      for (const corr of plan.corridors) {
        const label = plan.isInstantVictory
          ? `Sieg-Offensive: Eliminiere ${targetName}`
          : `Kopfgeld-Jagd auf ${targetName} (${plan.cardsLooted} Karten)`;
        recordLaunchBoost(corr.fromId, plan.priorityScore * 1.45, label);
      }
    }

    // 2b. Multi-Hop Enemy Continent Break Corridors
    for (const cId of Object.keys(CONTINENTS) as ContinentId[]) {
      const cTerrIds = CONTINENT_TERRITORIES[cId];
      const firstOwner = state.territories[cTerrIds[0]].ownerId;
      if (firstOwner === player.id) continue;
      const allOwnedByOneEnemy = cTerrIds.every(
        (id) => state.territories[id].ownerId === firstOwner
      );
      if (!allOwnedByOneEnemy) continue;

      const rivalMult = opponentProfiles[firstOwner]?.threatMultiplier ?? 1.0;
      const corr = this.findShortestAttackCorridor(
        state,
        player.id,
        new Set(cTerrIds),
        3,
        0.58
      );
      if (corr) {
        const extraNeeded = Math.max(
          0,
          corr.minTroopsRequired - state.territories[corr.fromId].troops
        );
        if (extraNeeded <= rem + 4) {
          const breakVal =
            CONTINENTS[cId].bonus * 25 * rivalMult - corr.path.length * 8;
          recordLaunchBoost(
            corr.fromId,
            breakVal,
            `Durchbruch gegen ${CONTINENTS[cId].name}-Bonus (${state.players[firstOwner].name})`
          );
        }
      }
    }

    // 2c. Multi-Hop Enemy Capital Siege Corridors (in CAPITALS mode)
    if (state.gameMode === 'CAPITALS') {
      const enemyCapIds = Object.values(state.capitalTerritoryIds).filter(
        (tId) => state.territories[tId].ownerId !== player.id
      );
      for (const capId of enemyCapIds) {
        const corr = this.findShortestAttackCorridor(
          state,
          player.id,
          new Set([capId]),
          3,
          0.58
        );
        if (corr) {
          const extraNeeded = Math.max(
            0,
            corr.minTroopsRequired - state.territories[corr.fromId].troops
          );
          const isLastCap = enemyCapIds.length === 1;
          if (extraNeeded <= rem + (isLastCap ? 6 : 2)) {
            const capScore = isLastCap ? 280 : 120;
            recordLaunchBoost(
              corr.fromId,
              capScore,
              `Belagerung der Hauptstadt 🏛️ ${TERRITORY_MAP[capId].name}`
            );
          }
        }
      }
    }

    // 2d. Continent Conquest Spearheads (including Multi-Hop Approach for Mission Continents)
    for (const cId of Object.keys(CONTINENTS) as ContinentId[]) {
      const cEval = contEvals[cId];
      if (cEval.enemyTerritories === 0 || cEval.attractiveness < 28) continue;

      const enemyInCont = CONTINENT_TERRITORIES[cId].filter(
        (id) => state.territories[id].ownerId !== player.id
      );
      const enemySet = new Set(enemyInCont);

      let bestSpearheadId: string | null = null;
      let bestSpearheadMetric = -Infinity;

      for (const tState of myTerrs) {
        const adjInCont = TERRITORY_MAP[tState.id].neighbors.filter((nId) =>
          enemySet.has(nId)
        );
        if (adjInCont.length === 0) continue;
        const metric =
          tState.troops * 4 +
          adjInCont.length * 14 +
          (TERRITORY_MAP[tState.id].continent === cId ? 15 : 0);
        if (metric > bestSpearheadMetric) {
          bestSpearheadMetric = metric;
          bestSpearheadId = tState.id;
        }
      }

      if (bestSpearheadId) {
        const mult = cEval.canCompleteThisTurn ? 1.85 : 1.35;
        recordLaunchBoost(
          bestSpearheadId,
          cEval.attractiveness * mult,
          `Speerspitze zur Eroberung von ${CONTINENTS[cId].name}`
        );
      } else if (cEval.isMissionTarget) {
        const approachCorr = this.findShortestAttackCorridor(
          state,
          player.id,
          enemySet,
          4,
          0.60
        );
        if (approachCorr) {
          recordLaunchBoost(
            approachCorr.fromId,
            cEval.attractiveness * 1.25,
            `Missions-Korridor nach ${CONTINENTS[cId].name}`
          );
        }
      }
    }

    // ------------------------------------------------------------------------
    // STEP 3: Score Every Border Territory
    // ------------------------------------------------------------------------
    const scoredTerritories: {
      id: string;
      offenseScore: number;
      defenseScore: number;
      urgentDeficit: number;
      deadEndCap: number;
      totalScore: number;
      reason: string;
    }[] = [];

    for (const tState of myTerrs) {
      const tDef = TERRITORY_MAP[tState.id];
      if (!state.isBorderTerritory(tState.id)) continue;

      let offenseScore = 0;
      let defenseScore = 0;
      let urgentDeficit = 0;
      let reason = 'Grenzsicherung';

      const adjEnemyThreat = this.getAdjacentEnemyThreat(
        state,
        tState.id,
        player.id
      );

      // 1. Capital defense in CAPITALS mode
      if (state.isCapitalTerritory(tState.id)) {
        const desiredGarrison = Math.ceil(adjEnemyThreat * 0.95) + 3;
        const capDeficit = Math.max(0, desiredGarrison - tState.troops);
        if (capDeficit > 0) {
          urgentDeficit = Math.max(urgentDeficit, capDeficit);
          defenseScore += 85 + capDeficit * 14;
          reason = `Befestige Hauptstadt 🏛️ ${tDef.name}`;
        } else {
          defenseScore += 28;
        }
      }

      // 2. Continent Gateway OR Forward Buffer Shield Defense
      const guardDuty = guardDuties[tState.id];
      if (guardDuty) {
        const desiredGuard = Math.ceil(adjEnemyThreat * 0.88) + 2;
        const deficit = Math.max(0, desiredGuard - tState.troops);
        if (deficit > 0) {
          urgentDeficit = Math.max(urgentDeficit, deficit);
          defenseScore += 55 + deficit * 11 + guardDuty.bonusAtStake * 8;
          reason = guardDuty.isForwardShield
            ? `Sichere Vorposten-Schild für ${guardDuty.continentNames.join(' & ')}`
            : `Verteidige ${guardDuty.continentNames.join(' & ')}-Engpass`;
        } else {
          defenseScore += 15 + guardDuty.bonusAtStake * 2.5;
        }
      }

      // 3. Multi-hop / Primary Spearhead Campaign Score
      const launchBoost = multiHopLaunchScore[tState.id];
      if (launchBoost) {
        offenseScore += launchBoost.score;
        if (launchBoost.score > defenseScore) {
          reason = launchBoost.reason;
        }
      }

      // 4. Direct 1-Hop Neighbor Tactical Opportunities
      for (const nId of tDef.neighbors) {
        const nState = state.territories[nId];
        if (nState.ownerId === player.id) continue;

        const rivalMult =
          opponentProfiles[nState.ownerId]?.threatMultiplier ?? 1.0;

        if (state.isCapitalTerritory(nId)) {
          const capVal = Math.max(35, 110 - nState.troops * 1.5) * rivalMult;
          if (capVal > offenseScore * 0.5) {
            offenseScore += capVal;
            reason = `Belagerung der Hauptstadt 🏛️ ${TERRITORY_MAP[nId].name}`;
          }
        }

        const breakBonus = this.getEnemyContinentBreakBonus(state, nId);
        if (breakBonus > 0) {
          const breakVal =
            breakBonus * 1.65 * rivalMult - nState.troops * 1.8;
          offenseScore += Math.max(25, breakVal);
          reason = `Breche Kontinentbonus (${
            CONTINENTS[TERRITORY_MAP[nId].continent].name
          })`;
        }

        const shieldExp = this.getForwardShieldExpansionBonus(
          state,
          player.id,
          nId
        );
        if (shieldExp.bonusScore > 0 && nState.troops <= tState.troops + rem) {
          offenseScore += shieldExp.bonusScore;
          if (offenseScore > defenseScore && reason === 'Grenzsicherung') {
            reason = `Vorposten-Puffer für ${shieldExp.continentName} sichern`;
          }
        }

        if (nState.troops <= 2) {
          const borderDelta = this.evaluateBorderDelta(state, player.id, nId);
          offenseScore +=
            (16 + Math.max(0, -borderDelta.borderCountDelta) * 14) * rivalMult;
        }
      }

      // 5. Mode-specific blitz expansion
      const weakAdjCount = tDef.neighbors.filter(
        (nId) =>
          state.territories[nId].ownerId !== player.id &&
          state.territories[nId].troops <= 2
      ).length;

      if (
        (state.gameMode === 'DOMINATION_70' && myTerrs.length >= 24) ||
        (state.gameMode === 'SECRET_MISSIONS' &&
          (player.mission?.type === 'TERRITORIES_24' ||
            player.mission?.fallbackTo24) &&
          myTerrs.length >= 19) ||
        (state.gameMode === 'TURN_LIMIT' &&
          state.turnNumber >= state.maxTurns - 2)
      ) {
        offenseScore += weakAdjCount * 30;
      }

      if (player.aiPersonality === 'grandmaster_conqueror') {
        offenseScore *= 1.2;
      } else if (player.aiPersonality === 'grandmaster_strategist') {
        defenseScore *= 1.2;
      } else if (player.aiPersonality === 'grandmaster_bounty') {
        if (eliminationPlans.length > 0) offenseScore *= 1.25;
      }

      const reach = this.getReachableEnemyTroops(
        state,
        tState.id,
        player.id,
        3
      );
      const deadEndCap =
        reach.enemyTerrCount <= 2
          ? Math.max(
              urgentDeficit,
              Math.max(
                2,
                Math.ceil(reach.enemyTroopSum * 1.8) +
                  reach.enemyTerrCount +
                  2 -
                  tState.troops
              )
            )
          : 999;

      scoredTerritories.push({
        id: tState.id,
        offenseScore,
        defenseScore,
        urgentDeficit,
        deadEndCap,
        totalScore: offenseScore + defenseScore,
        reason,
      });
    }

    if (scoredTerritories.length === 0) {
      addReinforce(myTerrs[0].id, rem, 'Verstärkung');
      return actions;
    }

    scoredTerritories.sort((a, b) => b.totalScore - a.totalScore);

    // ------------------------------------------------------------------------
    // STEP 4: Surgical Allocation (Urgent Choke Defense + Concentrated Spearhead)
    // ------------------------------------------------------------------------
    const top = scoredTerritories[0];

    const urgentDefenders = scoredTerritories.filter(
      (s) => s.id !== top.id && s.urgentDeficit > 0 && s.defenseScore >= 72
    );

    if (urgentDefenders.length > 0 && rem >= 4) {
      const defTarget = urgentDefenders[0];
      const defAlloc = Math.min(
        defTarget.urgentDeficit,
        Math.max(1, Math.floor(rem * 0.35))
      );
      if (defAlloc > 0) {
        addReinforce(defTarget.id, defAlloc, defTarget.reason);
      }
    }

    if (rem > 0) {
      if (scoredTerritories.length >= 2 && top.deadEndCap < rem) {
        addReinforce(top.id, top.deadEndCap, top.reason);
        addReinforce(
          scoredTerritories[1].id,
          rem,
          scoredTerritories[1].reason
        );
      } else if (
        scoredTerritories.length >= 2 &&
        rem >= 6 &&
        scoredTerritories[1].totalScore >= top.totalScore * 0.82 &&
        top.offenseScore < 140
      ) {
        const primaryAmount = Math.max(1, Math.round(rem * 0.72));
        const secondaryAmount = rem - primaryAmount;
        addReinforce(top.id, primaryAmount, top.reason);
        if (secondaryAmount > 0) {
          addReinforce(
            scoredTerritories[1].id,
            secondaryAmount,
            scoredTerritories[1].reason
          );
        }
      } else {
        addReinforce(top.id, rem, top.reason);
      }
    }

    return actions;
  }

  // ==========================================================================
  // 7. GRANDMASTER ATTACK SELECTOR & TOPOLOGICAL ORDERING
  // ==========================================================================

  public static chooseNextAttack(state: GameState): AIAttackDecision | null {
    const player = state.currentPlayer;
    const myTerrs = state.getPlayerTerritories(player.id);
    const contEvals = this.evaluateContinents(state, player.id);
    const guardDuties = this.getContinentGuardDuties(state, player.id);
    const opponentProfiles = this.evaluateOpponents(state, player.id);
    const eliminationPlans = this.evaluateEliminationPlans(state, player.id);

    const steppingStoneBonus: Record<
      string,
      { score: number; minWinProb: number; reason: string }
    > = {};
    const addSteppingStone = (
      fromId: string,
      toId: string,
      score: number,
      minWinProb: number,
      reason: string
    ) => {
      const key = `${fromId}->${toId}`;
      if (!steppingStoneBonus[key] || score > steppingStoneBonus[key].score) {
        steppingStoneBonus[key] = { score, minWinProb, reason };
      }
    };

    // 1. Elimination & Mission Target stepping stones
    for (const plan of eliminationPlans) {
      if (!plan.feasibleThisTurn && !plan.isInstantVictory) continue;
      const targetName = state.players[plan.targetPlayerId].name;
      for (const corr of plan.corridors) {
        if (corr.path.length > 0 && corr.chainWinProb >= 0.45) {
          addSteppingStone(
            corr.fromId,
            corr.path[0],
            plan.priorityScore * 1.45,
            plan.isInstantVictory ? 0.42 : 0.52,
            plan.isInstantVictory
              ? `Sieg-Offensive: Vernichte ${targetName}!`
              : `Offensive gegen ${targetName} (+${plan.cardsLooted} Karten)!`
          );
        }
      }
    }

    // 2. Multi-hop Continent Break stepping stones
    for (const cId of Object.keys(CONTINENTS) as ContinentId[]) {
      const cTerrIds = CONTINENT_TERRITORIES[cId];
      const firstOwner = state.territories[cTerrIds[0]].ownerId;
      if (firstOwner === player.id) continue;
      const allOwnedByOneEnemy = cTerrIds.every(
        (id) => state.territories[id].ownerId === firstOwner
      );
      if (!allOwnedByOneEnemy) continue;

      const rivalMult = opponentProfiles[firstOwner]?.threatMultiplier ?? 1.0;
      const corr = this.findShortestAttackCorridor(
        state,
        player.id,
        new Set(cTerrIds),
        3,
        0.52
      );
      if (corr && corr.path.length >= 2 && corr.chainWinProb >= 0.50) {
        addSteppingStone(
          corr.fromId,
          corr.path[0],
          CONTINENTS[cId].bonus * 20 * rivalMult,
          0.52,
          `Durchbruch zum Aufbrechen von ${CONTINENTS[cId].name}`
        );
      }
    }

    // 3. Multi-hop Mission Continent Approach Corridors
    for (const cId of Object.keys(CONTINENTS) as ContinentId[]) {
      const cEval = contEvals[cId];
      if (!cEval.isMissionTarget || cEval.myTerritories > 0) continue;
      const corr = this.findShortestAttackCorridor(
        state,
        player.id,
        new Set(CONTINENT_TERRITORIES[cId]),
        4,
        0.54
      );
      if (corr && corr.path.length >= 1 && corr.chainWinProb >= 0.50) {
        addSteppingStone(
          corr.fromId,
          corr.path[0],
          115,
          0.54,
          `Missions-Durchbruch nach ${CONTINENTS[cId].name}`
        );
      }
    }

    // 4. Multi-hop Capital Siege stepping stones
    if (state.gameMode === 'CAPITALS') {
      const enemyCapIds = Object.values(state.capitalTerritoryIds).filter(
        (tId) => state.territories[tId].ownerId !== player.id
      );
      for (const capId of enemyCapIds) {
        const corr = this.findShortestAttackCorridor(
          state,
          player.id,
          new Set([capId]),
          3,
          0.50
        );
        if (corr && corr.path.length >= 2 && corr.chainWinProb >= 0.48) {
          const isLastCap = enemyCapIds.length === 1;
          addSteppingStone(
            corr.fromId,
            corr.path[0],
            isLastCap ? 230 : 100,
            isLastCap ? 0.42 : 0.54,
            `Durchbruch zur Hauptstadt 🏛️ ${TERRITORY_MAP[capId].name}`
          );
        }
      }
    }

    const candidates: AIAttackDecision[] = [];

    for (const fromState of myTerrs) {
      if (fromState.troops < 2) continue;
      const fromDef = TERRITORY_MAP[fromState.id];

      const enemyNeighborsOfFrom = fromDef.neighbors.filter(
        (nId) => state.territories[nId].ownerId !== player.id
      );

      for (const toId of enemyNeighborsOfFrom) {
        const toState = state.territories[toId];
        const toDef = TERRITORY_MAP[toId];
        const winProb = getConquestProbability(fromState.troops, toState.troops);
        const expectedRem = getExpectedRemainingMobileAttackers(
          fromState.troops,
          toState.troops
        );
        const expectedCasualties = Math.max(
          0,
          fromState.troops - 1 - expectedRem
        );

        const rivalProfile = opponentProfiles[toState.ownerId];
        const rivalMult = rivalProfile?.threatMultiplier ?? 1.0;

        let minWinProb = 0.65;
        // Prefer low-casualty targets (1-2 defenders) without depressing base threshold
        let strategicScore =
          winProb * 100 + Math.max(0, 3 - toState.troops) * 5;
        let isMajorStrategicGoal = false;
        let reason = 'Taktischer Vorstoß';

        // 0. Stepping stone from multi-hop planner
        const stepBonus = steppingStoneBonus[`${fromState.id}->${toId}`];
        if (stepBonus) {
          strategicScore += stepBonus.score;
          minWinProb = Math.min(minWinProb, stepBonus.minWinProb);
          isMajorStrategicGoal = true;
          reason = stepBonus.reason;
        }

        // 1. Mode-specific high-value targets (Capitals, Secret Missions, 70% Domination, Turn Limit)
        if (state.isCapitalTerritory(toId)) {
          const enemyCapCount = Object.values(state.capitalTerritoryIds).filter(
            (id) => state.territories[id].ownerId !== player.id
          ).length;
          strategicScore += enemyCapCount === 1 ? 260 : 100 * rivalMult;
          minWinProb = Math.min(minWinProb, enemyCapCount === 1 ? 0.40 : 0.50);
          isMajorStrategicGoal = true;
          reason = `Erobere Hauptstadt 🏛️ ${toDef.name}!`;
        }

        if (state.gameMode === 'SECRET_MISSIONS' && player.mission) {
          const m = player.mission;
          if (
            m.type === 'ELIMINATE_PLAYER' &&
            !m.fallbackTo24 &&
            m.targetPlayerId === toState.ownerId
          ) {
            strategicScore += 80;
            minWinProb = Math.min(minWinProb, 0.50);
            isMajorStrategicGoal = true;
            reason = `Missionsziel: Vernichte ${state.players[toState.ownerId].name}`;
          } else if (
            m.type === 'TERRITORIES_24' ||
            m.fallbackTo24 ||
            m.type === 'TERRITORIES_18_TROOPS_2'
          ) {
            const targetCount = m.type === 'TERRITORIES_18_TROOPS_2' ? 18 : 24;
            if (toState.troops <= 2 || myTerrs.length >= targetCount - 3) {
              strategicScore += myTerrs.length >= targetCount - 2 ? 95 : 42;
              minWinProb = Math.min(
                minWinProb,
                myTerrs.length === targetCount - 1 ? 0.45 : 0.56
              );
              isMajorStrategicGoal = true;
              reason = `Missions-Expansion (${m.title})`;
            }
          }

          if (
            m.type === 'TERRITORIES_18_TROOPS_2' &&
            myTerrs.length >= 14 &&
            fromState.troops <= 3
          ) {
            continue;
          }
        }

        if (state.gameMode === 'DOMINATION_70') {
          if (myTerrs.length === 29) {
            strategicScore += 280;
            minWinProb = Math.min(minWinProb, 0.40);
            isMajorStrategicGoal = true;
            reason = `Sieg-Eroberung zur 70% Dominanz (30/30)!`;
          } else if (myTerrs.length >= 25 && toState.troops <= 3) {
            strategicScore += 55;
            minWinProb = Math.min(minWinProb, 0.55);
            isMajorStrategicGoal = true;
            reason = `Vorstoß zur 70% Dominanz (${myTerrs.length + 1}/30)`;
          }
        }

        if (
          state.gameMode === 'TURN_LIMIT' &&
          state.turnNumber >= state.maxTurns - 2
        ) {
          strategicScore += 36 * rivalMult;
          minWinProb = Math.min(minWinProb, 0.56);
          isMajorStrategicGoal = true;
        }

        // 2. Direct Enemy Continent Break
        const breakBonus = this.getEnemyContinentBreakBonus(state, toId);
        if (breakBonus > 0) {
          strategicScore += breakBonus * 1.6 * rivalMult;
          minWinProb = Math.min(minWinProb, 0.45);
          isMajorStrategicGoal = true;
          reason = `Zerschlage Kontinentbonus (${CONTINENTS[toDef.continent].name})`;
        }

        // 3. Continent Completion / Expansion & Topological Ordering
        const cEval = contEvals[toDef.continent];
        if (cEval.enemyTerritories === 1 && cEval.myTerritories > 0) {
          strategicScore += 80 + CONTINENTS[toDef.continent].bonus * 10;
          minWinProb = Math.min(minWinProb, 0.48);
          isMajorStrategicGoal = true;
          reason = `Vollende Kontinent ${CONTINENTS[toDef.continent].name}!`;
        } else if (
          cEval.canCompleteThisTurn ||
          cEval.isMissionTarget ||
          (cEval.attractiveness > 35 && winProb >= 0.70)
        ) {
          const boost = cEval.canCompleteThisTurn
            ? cEval.attractiveness * 0.95 + 28
            : cEval.attractiveness * 0.65;
          strategicScore += boost;
          if (cEval.canCompleteThisTurn) {
            minWinProb = Math.min(minWinProb, 0.58);
            isMajorStrategicGoal = true;
          }

          const otherEnemiesInSameCont = enemyNeighborsOfFrom.filter(
            (nId) =>
              nId !== toId && TERRITORY_MAP[nId].continent === toDef.continent
          );
          if (otherEnemiesInSameCont.length > 0) {
            const toTouchesOtherTarget = otherEnemiesInSameCont.some((otherId) =>
              toDef.neighbors.includes(otherId)
            );
            const isToGateway = CONTINENT_GATEWAYS[toDef.continent].includes(
              toId
            );

            if (!toTouchesOtherTarget) {
              const onwardInCont = toDef.neighbors.filter(
                (nId) =>
                  TERRITORY_MAP[nId].continent === toDef.continent &&
                  state.territories[nId].ownerId !== player.id &&
                  nId !== fromState.id
              ).length;
              if (onwardInCont === 0) {
                strategicScore += 28;
              }
            } else if (!isToGateway) {
              strategicScore += 18;
            }
          }

          if (reason === 'Taktischer Vorstoß') {
            reason = `Eroberung von ${CONTINENTS[toDef.continent].name}`;
          }
        }

        // 4. Direct Player Elimination (1 or 2 territories remaining)
        const enemyRemainingTerrs = state.getPlayerTerritories(
          toState.ownerId
        ).length;
        const enemyCards = state.players[toState.ownerId].cards.length;
        if (enemyRemainingTerrs === 1) {
          strategicScore += 115 + enemyCards * 28;
          minWinProb = Math.min(minWinProb, 0.42);
          isMajorStrategicGoal = true;
          reason = `Vernichte ${state.players[toState.ownerId].name} (+${enemyCards} Karten)!`;
        } else if (
          enemyRemainingTerrs === 2 &&
          fromState.troops >= toState.troops + 4
        ) {
          strategicScore += 48 + enemyCards * 15;
          isMajorStrategicGoal = true;
        }

        // 5. Forward Buffer Shield Capture
        const shieldExp = this.getForwardShieldExpansionBonus(
          state,
          player.id,
          toId
        );
        if (shieldExp.bonusScore > 0 && winProb >= 0.72) {
          strategicScore += shieldExp.bonusScore;
          isMajorStrategicGoal = true;
          if (reason === 'Taktischer Vorstoß') {
            reason = `Vorposten-Schild für ${shieldExp.continentName} sichern`;
          }
        }

        // 6. Border Consolidation vs Overextension Delta
        const borderDelta = this.evaluateBorderDelta(state, player.id, toId);
        if (borderDelta.borderCountDelta < 0) {
          strategicScore += Math.abs(borderDelta.borderCountDelta) * 25;
          if (winProb >= 0.72) {
            isMajorStrategicGoal = true;
            if (reason === 'Taktischer Vorstoß') {
              reason = 'Frontverkürzung & Kessel-Bereinigung';
            }
          }
        } else if (borderDelta.borderCountDelta > 0 && !isMajorStrategicGoal) {
          strategicScore -= borderDelta.borderCountDelta * 12;
        }

        // 7. Risk Card Farming & Post-Card Discipline
        if (!state.conqueredThisTurn) {
          strategicScore += 32;
          minWinProb = Math.min(minWinProb, 0.58);
          if (reason === 'Taktischer Vorstoß') {
            reason = 'Eroberung für Taktik-Karte';
          }
        } else if (!isMajorStrategicGoal) {
          minWinProb = Math.max(minWinProb, 0.86);
          strategicScore -= 18;
        }

        // 8. Choke-Point & Forward-Shield Preservation Check
        const guardDuty = guardDuties[fromState.id];
        const isFromCapital = state.isCapitalTerritory(fromState.id);
        if ((guardDuty || isFromCapital) && breakBonus === 0) {
          let otherEnemyThreat = 0;
          for (const nId of fromDef.neighbors) {
            if (nId !== toId && state.territories[nId].ownerId !== player.id) {
              otherEnemyThreat += Math.max(1, state.territories[nId].troops - 1);
            }
          }
          if (otherEnemyThreat > 0) {
            if (expectedRem < otherEnemyThreat + 2) {
              strategicScore -= isFromCapital ? 95 : 65;
            }
          }
        }

        if (winProb >= minWinProb && strategicScore >= 72) {
          candidates.push({
            fromId: fromState.id,
            toId,
            winProb,
            score: strategicScore,
            reason,
          });
        }
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0];
  }

  /**
   * Dynamic mid-battle evaluation after a combat dice roll when defender still holds `toId`.
   */
  public static shouldContinueAttack(
    state: GameState,
    fromId: string,
    toId: string
  ): boolean {
    const fromState = state.territories[fromId];
    const toState = state.territories[toId];
    if (!fromState || !toState || fromState.troops < 2 || toState.troops <= 0) {
      return false;
    }

    const player = state.currentPlayer;
    if (
      state.gameMode === 'SECRET_MISSIONS' &&
      player.mission?.type === 'TERRITORIES_18_TROOPS_2' &&
      state.getPlayerTerritories(player.id).length >= 14 &&
      fromState.troops <= 2
    ) {
      return false;
    }

    const winProb = getConquestProbability(fromState.troops, toState.troops);

    if (toState.troops === 1 && fromState.troops >= 4) {
      return true;
    }

    const isBreak = this.getEnemyContinentBreakBonus(state, toId) > 0;
    const isCapital = state.isCapitalTerritory(toId);
    const isLastTerrOfEnemy =
      state.getPlayerTerritories(toState.ownerId).length === 1;
    const toCont = TERRITORY_MAP[toId].continent;
    const enemyInCont = CONTINENT_TERRITORIES[toCont].filter(
      (id) => state.territories[id].ownerId !== player.id
    ).length;
    const isLastInContinent =
      enemyInCont === 1 && CONTINENT_TERRITORIES[toCont].length > 1;

    if (isBreak || isCapital || isLastTerrOfEnemy || isLastInContinent) {
      return winProb >= 0.36;
    }

    if (!state.conqueredThisTurn) {
      return winProb >= 0.45;
    }

    return winProb >= 0.50;
  }

  // ==========================================================================
  // 8. POST-CONQUEST TROOP ADVANCE (FORK & SPEARHEAD AWARE)
  // ==========================================================================

  public static chooseConquestMoveCount(
    state: GameState,
    fromId: string,
    toId: string,
    minMove: number,
    maxMove: number
  ): number {
    if (minMove >= maxMove) return maxMove;
    const player = state.currentPlayer;

    const fromIsBorder = state.isBorderTerritory(fromId);
    const toIsBorder = state.isBorderTerritory(toId);

    if (
      state.gameMode === 'SECRET_MISSIONS' &&
      player.mission?.type === 'TERRITORIES_18_TROOPS_2'
    ) {
      const safeMaxForFrom = Math.max(minMove, maxMove - 1);
      if (!fromIsBorder) {
        return safeMaxForFrom;
      }
      if (!toIsBorder) {
        return Math.min(safeMaxForFrom, Math.max(minMove, 2));
      }
      return safeMaxForFrom;
    }

    if (!fromIsBorder) {
      return maxMove;
    }

    if (!toIsBorder) {
      return minMove;
    }

    const fromDef = TERRITORY_MAP[fromId];
    const toDef = TERRITORY_MAP[toId];
    const toCont = toDef.continent;

    const fromExclusiveEnemies = fromDef.neighbors.filter(
      (nId) =>
        state.territories[nId].ownerId !== player.id &&
        !toDef.neighbors.includes(nId)
    );
    const toEnemies = toDef.neighbors.filter(
      (nId) => state.territories[nId].ownerId !== player.id
    );

    const fromHasSameContTarget = fromExclusiveEnemies.some(
      (nId) => TERRITORY_MAP[nId].continent === fromDef.continent
    );
    const toHasSameContTarget = toEnemies.some(
      (nId) => TERRITORY_MAP[nId].continent === toCont
    );

    if (fromHasSameContTarget && !toHasSameContTarget) {
      const toThreat = this.getAdjacentEnemyThreat(state, toId, player.id);
      const guardForTo = Math.min(
        maxMove,
        Math.max(minMove, Math.ceil(toThreat * 0.7))
      );
      return guardForTo;
    }

    const guardDuties = this.getContinentGuardDuties(state, player.id);
    const fromGuardDuty = guardDuties[fromId];
    const fromIsCapital = state.isCapitalTerritory(fromId);
    const fromThreat = this.getAdjacentEnemyThreat(state, fromId, player.id);
    const toThreat = this.getAdjacentEnemyThreat(state, toId, player.id);

    let requiredStayOnFrom = 1;
    if (fromIsCapital) {
      requiredStayOnFrom = Math.max(3, Math.ceil(fromThreat * 0.85) + 1);
    } else if (fromGuardDuty && toDef.continent !== fromDef.continent) {
      requiredStayOnFrom = Math.max(2, Math.ceil(fromThreat * 0.75) + 1);
    }

    const maxSafeAdvance = Math.max(
      minMove,
      maxMove - (requiredStayOnFrom - 1)
    );

    const hasAttackableTargetFromTo = toEnemies.some(
      (nId) => maxSafeAdvance >= state.territories[nId].troops + 1
    );
    if (hasAttackableTargetFromTo) {
      return maxSafeAdvance;
    }

    const toIsCapital = state.isCapitalTerritory(toId);
    const toGuardDuty = guardDuties[toId];
    const fromWeight =
      fromThreat +
      (fromIsCapital ? 8 : 0) +
      (fromGuardDuty ? fromGuardDuty.bonusAtStake * 2 : 0) +
      1.5;
    const toWeight =
      toThreat +
      (toIsCapital ? 8 : 0) +
      (toGuardDuty ? toGuardDuty.bonusAtStake * 2 : 0) +
      1.5;

    const totalAvailable = maxMove + 1;
    const desiredTo = Math.round(
      totalAvailable * (toWeight / (fromWeight + toWeight))
    );
    return Math.min(maxSafeAdvance, Math.max(minMove, desiredTo));
  }

  // ==========================================================================
  // 9. GLOBAL NETWORK FORTIFICATION (CHOKE-POINT & SPEARHEAD STAGING)
  // ==========================================================================

  public static chooseFortification(state: GameState): AIFortifyDecision | null {
    const player = state.currentPlayer;
    const myTerrs = state.getPlayerTerritories(player.id);

    const is18x2Mission =
      state.gameMode === 'SECRET_MISSIONS' &&
      player.mission?.type === 'TERRITORIES_18_TROOPS_2';

    if (is18x2Mission && myTerrs.length >= 18) {
      const oneTroopTerrs = myTerrs.filter((t) => t.troops === 1);
      const richTerrs = myTerrs
        .filter((t) => t.troops >= 3)
        .sort((a, b) => b.troops - a.troops);

      for (const fromT of richTerrs) {
        for (const toT of oneTroopTerrs) {
          const path = state.getOwnedPath(fromT.id, toT.id, player.id);
          if (path) {
            const moveAmt = Math.max(1, Math.floor((fromT.troops - 2) / 2));
            return {
              fromId: fromT.id,
              toId: toT.id,
              amount: moveAmt,
              path,
            };
          }
        }
      }
    }

    const guardDuties = this.getContinentGuardDuties(state, player.id);
    const contEvals = this.evaluateContinents(state, player.id);

    let bestMove: AIFortifyDecision | null = null;
    let bestGain = 8;

    for (const fromState of myTerrs) {
      if (fromState.troops <= 1) continue;
      if (is18x2Mission && myTerrs.length >= 14 && fromState.troops <= 2) {
        continue;
      }

      const fromIsBorder = state.isBorderTerritory(fromState.id);
      const fromThreat = this.getAdjacentEnemyThreat(
        state,
        fromState.id,
        player.id
      );
      const fromIsCapital = state.isCapitalTerritory(fromState.id);
      const fromGuard = guardDuties[fromState.id];

      let keepFloor = 1;
      if (is18x2Mission && myTerrs.length >= 14) {
        keepFloor = 2;
      }
      if (fromIsBorder) {
        if (fromIsCapital) {
          keepFloor = Math.max(keepFloor, Math.ceil(fromThreat * 1.1) + 3);
        } else if (fromGuard) {
          keepFloor = Math.max(keepFloor, Math.ceil(fromThreat * 0.95) + 2);
        } else {
          keepFloor = Math.max(keepFloor, Math.ceil(fromThreat * 0.85) + 1);
        }
      }

      const surplus = fromState.troops - keepFloor;
      if (surplus <= 0) continue;

      for (const toState of myTerrs) {
        if (toState.id === fromState.id) continue;
        if (!state.isBorderTerritory(toState.id)) continue;

        const path = state.getOwnedPath(fromState.id, toState.id, player.id);
        if (!path) continue;

        const toThreat = this.getAdjacentEnemyThreat(
          state,
          toState.id,
          player.id
        );
        const toIsCapital = state.isCapitalTerritory(toState.id);
        const toGuard = guardDuties[toState.id];
        const toCont = TERRITORY_MAP[toState.id].continent;
        const cEval = contEvals[toCont];

        let destImportance = toThreat * 4.5;
        if (toIsCapital) {
          const deficit = Math.max(0, toThreat + 3 - toState.troops);
          destImportance += 45 + deficit * 8;
        }
        if (toGuard) {
          const deficit = Math.max(0, toThreat + 2 - toState.troops);
          destImportance += toGuard.bonusAtStake * 9 + deficit * 7;
        }
        if (cEval.enemyTerritories > 0 && cEval.attractiveness > 35) {
          destImportance += cEval.attractiveness * 0.55;
        }

        const sourceImportance = fromIsBorder
          ? fromThreat * 4.5 +
            (fromIsCapital ? 45 : 0) +
            (fromGuard ? fromGuard.bonusAtStake * 9 : 0)
          : 0;

        const gain =
          destImportance -
          sourceImportance +
          surplus * (!fromIsBorder ? 9 : 4.5) +
          (!fromIsBorder ? 30 : 0);

        if (gain > bestGain) {
          bestGain = gain;
          bestMove = {
            fromId: fromState.id,
            toId: toState.id,
            amount: surplus,
            path,
          };
        }
      }
    }

    return bestMove;
  }
}
