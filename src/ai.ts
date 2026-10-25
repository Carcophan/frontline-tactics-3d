import {
  getConquestProbability,
  getExpectedRemainingMobileAttackers,
} from './combatMath';
import { GameState, getCardTradeBonus } from './gameState';
import {
  CONTINENTS,
  ContinentId,
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
  attractiveness: number;
}

export class GrandmasterAI {
  /**
   * Evaluates all 6 continents from the perspective of `playerId`.
   */
  public static evaluateContinents(
    state: GameState,
    playerId: number
  ): Record<ContinentId, ContinentEval> {
    const result = {} as Record<ContinentId, ContinentEval>;

    // Number of choke points per continent in classic Risk
    const chokeCount: Record<ContinentId, number> = {
      australia: 1, // Siam-Indonesia
      south_america: 2, // Central America, North Africa
      north_america: 3, // Alaska, Greenland, Central America
      africa: 3, // North Africa, Egypt, East Africa
      europe: 4, // Iceland, Western Europe, Southern Europe, Ukraine
      asia: 5,
    };

    for (const cId of Object.keys(CONTINENTS) as ContinentId[]) {
      const cDef = CONTINENTS[cId];
      const terrs = TERRITORIES.filter((t) => t.continent === cId);
      let myTerritories = 0;
      let enemyTerritories = 0;
      let enemyTroops = 0;
      let myTroops = 0;

      for (const t of terrs) {
        const ts = state.territories[t.id];
        if (ts.ownerId === playerId) {
          myTerritories++;
          myTroops += ts.troops;
        } else {
          enemyTerritories++;
          enemyTroops += ts.troops;
        }
      }

      const ownershipRatio = myTerritories / terrs.length;
      const defenseEfficiency = cDef.bonus / chokeCount[cId];
      const troopAdvantage = (myTroops + 2) / (enemyTroops + 2);

      // Attractiveness score for trying to conquer/hold this continent
      let attractiveness =
        ownershipRatio * 45 +
        defenseEfficiency * 18 +
        Math.min(2.5, troopAdvantage) * 16 -
        enemyTroops * 1.4;

      if (enemyTerritories === 0) {
        // Already owned! High priority to defend its borders
        attractiveness += 50;
      } else if (enemyTerritories === 1) {
        // 1 territory away from completing continent!
        attractiveness += 35;
      }

      // Secret Mission continent priority boost!
      const player = state.players[playerId];
      if (
        state.gameMode === 'SECRET_MISSIONS' &&
        player?.mission?.type === 'CONTINENTS'
      ) {
        if (player.mission.requiredContinents?.includes(cId)) {
          attractiveness += 58;
        } else if (player.mission.extraContinentsCount && ownershipRatio >= 0.4) {
          attractiveness += 28;
        }
      }

      result[cId] = {
        continentId: cId,
        totalTerritories: terrs.length,
        myTerritories,
        enemyTerritories,
        enemyTroops,
        myTroops,
        attractiveness,
      };
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
    let threat = 0;
    for (const nId of TERRITORY_MAP[territoryId].neighbors) {
      const nState = state.territories[nId];
      if (nState.ownerId !== ownerId) {
        // Mobile enemy troops that can attack us
        threat += Math.max(0.5, nState.troops - 1);
      }
    }
    return threat;
  }

  /**
   * Checks if an enemy player completely owns the continent of `territoryId`.
   * If so, breaking this territory denies the enemy a huge turn bonus!
   */
  public static getEnemyContinentBreakBonus(
    state: GameState,
    territoryId: string
  ): number {
    const tState = state.territories[territoryId];
    const cId = TERRITORY_MAP[territoryId].continent;
    const cTerrs = TERRITORIES.filter((t) => t.continent === cId);
    const allOwnedByThisEnemy = cTerrs.every(
      (t) => state.territories[t.id].ownerId === tState.ownerId
    );
    if (allOwnedByThisEnemy) {
      // Massive strategic priority to break an opponent's continent!
      return CONTINENTS[cId].bonus * 16;
    }
    return 0;
  }

  /**
   * Decides whether the AI should trade in a 3-card set right now.
   */
  public static shouldTradeCards(state: GameState, playerId: number): boolean {
    const player = state.players[playerId];
    const set = state.findValidCardSet(player.cards);
    if (!set) return false;
    if (player.cards.length >= 4) return true;
    // Also trade with 3 cards if trade bonus is >= 6 or we are in an intense position
    const nextBonus = getCardTradeBonus(state.cardTradesCompleted);
    return nextBonus >= 6 || state.turnNumber >= 2;
  }

  /**
   * Plans where to place all available reinforcements for the current AI player.
   * Concentrates forces on primary offensive spearheads and critical continent choke points.
   */
  public static planReinforcements(state: GameState): AIReinforceAction[] {
    const player = state.currentPlayer;
    const myTerrs = state.getPlayerTerritories(player.id);
    if (myTerrs.length === 0 || state.reinforcementsRemaining <= 0) return [];

    const contEvals = this.evaluateContinents(state, player.id);
    const ownedContinents = new Set(state.getPlayerContinents(player.id));

    // Special case for "18 territories with >= 2 troops" mission:
    // If we already own >= 15 territories, top up any 1-troop territories to 2 troops first!
    if (
      state.gameMode === 'SECRET_MISSIONS' &&
      player.mission?.type === 'TERRITORIES_18_TROOPS_2' &&
      myTerrs.length >= 15
    ) {
      const oneTroopTerrs = myTerrs.filter((t) => t.troops === 1);
      if (oneTroopTerrs.length > 0 && state.reinforcementsRemaining > 0) {
        const actions: AIReinforceAction[] = [];
        let rem = state.reinforcementsRemaining;
        for (const t of oneTroopTerrs) {
          if (rem <= 0) break;
          actions.push({
            territoryId: t.id,
            amount: 1,
            reason: 'Missionsziel: 2+ Truppen sichern',
          });
          rem--;
        }
        if (rem === 0) return actions;
      }
    }

    // Score each owned border territory for reinforcement value
    const scoredTerritories: {
      id: string;
      offenseScore: number;
      defenseScore: number;
      totalScore: number;
      reason: string;
    }[] = [];

    for (const tState of myTerrs) {
      const tDef = TERRITORY_MAP[tState.id];
      const isBorder = state.isBorderTerritory(tState.id);
      if (!isBorder) continue;

      let offenseScore = 0;
      let defenseScore = 0;
      let reason = 'Grenzsicherung';

      const cEval = contEvals[tDef.continent];
      const adjEnemyThreat = this.getAdjacentEnemyThreat(
        state,
        tState.id,
        player.id
      );

      // 0. Capital defense in CAPITALS mode
      if (state.isCapitalTerritory(tState.id)) {
        const capDeficit = adjEnemyThreat - tState.troops * 0.75;
        if (capDeficit > 0) {
          defenseScore += 65 + capDeficit * 10;
          reason = `Befestige Hauptstadt 🏛️ ${tDef.name}`;
        } else {
          defenseScore += 25;
        }
      }

      // 1. Defense of already-owned continent choke point
      if (ownedContinents.has(tDef.continent)) {
        const deficit = adjEnemyThreat - tState.troops * 0.85;
        if (deficit > 0) {
          defenseScore += 45 + deficit * 8 + CONTINENTS[tDef.continent].bonus * 6;
          reason = `Verteidige ${CONTINENTS[tDef.continent].name}-Engpass`;
        } else {
          defenseScore += 12 + CONTINENTS[tDef.continent].bonus * 2;
        }
      }

      // 2. Offense to complete a high-value continent
      const adjEnemiesInSameContinent = tDef.neighbors.filter(
        (nId) =>
          TERRITORY_MAP[nId].continent === tDef.continent &&
          state.territories[nId].ownerId !== player.id
      );
      if (adjEnemiesInSameContinent.length > 0 && cEval.attractiveness > 25) {
        offenseScore += cEval.attractiveness * 1.35;
        reason = `Offensive zur Eroberung von ${CONTINENTS[tDef.continent].name}`;
      }

      // 3. Offense to break an enemy-owned continent or capture Capitals / Mission targets!
      for (const nId of tDef.neighbors) {
        const nState = state.territories[nId];
        if (nState.ownerId !== player.id) {
          // Capital target in CAPITALS mode
          if (state.isCapitalTerritory(nId)) {
            offenseScore += Math.max(20, 85 - nState.troops * 2);
            reason = `Belagerung der Hauptstadt 🏛️ ${TERRITORY_MAP[nId].name}`;
          }

          // Elimination target in SECRET_MISSIONS mode
          if (
            state.gameMode === 'SECRET_MISSIONS' &&
            player.mission?.type === 'ELIMINATE_PLAYER' &&
            !player.mission.fallbackTo24 &&
            player.mission.targetPlayerId === nState.ownerId
          ) {
            offenseScore += 55;
            reason = `Missionsziel: Jagd auf ${state.players[nState.ownerId].name}`;
          }

          const breakBonus = this.getEnemyContinentBreakBonus(state, nId);
          if (breakBonus > 0) {
            offenseScore += breakBonus * 1.5 - nState.troops * 2;
            reason = `Breche feindlichen Kontinentbonus (${
              CONTINENTS[TERRITORY_MAP[nId].continent].name
            })`;
          }

          // 4. Bounty hunting: Enemy player is close to elimination (<= 2 territories)
          const enemyTerrCount = state.getPlayerTerritories(
            nState.ownerId
          ).length;
          const enemyCardCount = state.players[nState.ownerId].cards.length;
          if (enemyTerrCount <= 2) {
            offenseScore += 45 + enemyCardCount * 15;
            reason = `Eliminiere ${state.players[nState.ownerId].name} (${enemyCardCount} Karten)`;
          }

          // 5. Easy card farming target if we need a card
          if (nState.troops <= 2) {
            offenseScore += 14;
          }
        }
      }

      // Personality adjustments
      if (player.aiPersonality === 'grandmaster_conqueror') {
        offenseScore *= 1.25;
      } else if (player.aiPersonality === 'grandmaster_strategist') {
        defenseScore *= 1.25;
      }

      scoredTerritories.push({
        id: tState.id,
        offenseScore,
        defenseScore,
        totalScore: offenseScore + defenseScore,
        reason,
      });
    }

    if (scoredTerritories.length === 0) {
      return [
        {
          territoryId: myTerrs[0].id,
          amount: state.reinforcementsRemaining,
          reason: 'Verstärkung',
        },
      ];
    }

    scoredTerritories.sort((a, b) => b.totalScore - a.totalScore);

    // Grandmaster allocates 65-75% to top spearhead/chokepoint, and 25-35% to second priority if >= 4 troops
    const actions: AIReinforceAction[] = [];
    const total = state.reinforcementsRemaining;

    if (scoredTerritories.length === 1 || total <= 3) {
      actions.push({
        territoryId: scoredTerritories[0].id,
        amount: total,
        reason: scoredTerritories[0].reason,
      });
    } else {
      const primaryAmount = Math.max(1, Math.round(total * 0.7));
      const secondaryAmount = total - primaryAmount;
      actions.push({
        territoryId: scoredTerritories[0].id,
        amount: primaryAmount,
        reason: scoredTerritories[0].reason,
      });
      if (secondaryAmount > 0) {
        actions.push({
          territoryId: scoredTerritories[1].id,
          amount: secondaryAmount,
          reason: scoredTerritories[1].reason,
        });
      }
    }

    return actions;
  }

  /**
   * Chooses the best next attack for the current AI player, or null if the AI should stop attacking.
   */
  public static chooseNextAttack(state: GameState): AIAttackDecision | null {
    const player = state.currentPlayer;
    const myTerrs = state.getPlayerTerritories(player.id);
    const contEvals = this.evaluateContinents(state, player.id);

    const candidates: AIAttackDecision[] = [];

    for (const fromState of myTerrs) {
      if (fromState.troops < 2) continue; // Need at least 2 troops to attack

      const fromDef = TERRITORY_MAP[fromState.id];

      for (const toId of fromDef.neighbors) {
        const toState = state.territories[toId];
        if (toState.ownerId === player.id) continue;

        const toDef = TERRITORY_MAP[toId];
        const winProb = getConquestProbability(fromState.troops, toState.troops);

        // Minimum win probability threshold depends on strategic value
        let minWinProb = 0.66;
        let strategicScore = winProb * 100;
        let reason = 'Taktischer Vorstoß';

        // 0. Mode-specific high-value targets (Capitals, Secret Missions, 70% Domination, Turn Limit)
        if (state.isCapitalTerritory(toId)) {
          strategicScore += 75;
          minWinProb = 0.50;
          reason = `Erobere Hauptstadt 🏛️ ${toDef.name}!`;
        }

        if (state.gameMode === 'SECRET_MISSIONS' && player.mission) {
          const m = player.mission;
          if (
            m.type === 'ELIMINATE_PLAYER' &&
            !m.fallbackTo24 &&
            m.targetPlayerId === toState.ownerId
          ) {
            strategicScore += 55;
            minWinProb = Math.min(minWinProb, 0.54);
            reason = `Missionsziel: Vernichte ${state.players[toState.ownerId].name}`;
          } else if (
            (m.type === 'TERRITORIES_24' ||
              m.fallbackTo24 ||
              m.type === 'TERRITORIES_18_TROOPS_2') &&
            toState.troops <= 2
          ) {
            strategicScore += 32;
            minWinProb = Math.min(minWinProb, 0.58);
            reason = `Missions-Expansion (${m.title})`;
          }
          // In 18x2+ mode, don't attack out of a 2-troop territory unless we have a huge surplus elsewhere
          if (
            m.type === 'TERRITORIES_18_TROOPS_2' &&
            myTerrs.length >= 14 &&
            fromState.troops <= 2
          ) {
            continue;
          }
        }

        if (state.gameMode === 'DOMINATION_70' && myTerrs.length >= 25) {
          strategicScore += 35;
          minWinProb = Math.min(minWinProb, 0.56);
          reason = `Vorstoß zur 70% Dominanz (${myTerrs.length}/30)`;
        }

        if (
          state.gameMode === 'TURN_LIMIT' &&
          state.turnNumber >= state.maxTurns - 2
        ) {
          strategicScore += 25;
          minWinProb = Math.min(minWinProb, 0.56);
        }

        // 1. Breaking an opponent's completed continent!
        const breakBonus = this.getEnemyContinentBreakBonus(state, toId);
        if (breakBonus > 0) {
          strategicScore += breakBonus * 1.4;
          minWinProb = 0.48; // Willing to take calculated risks to stop an enemy continent bonus!
          reason = `Zerschlage Kontinentbonus (${CONTINENTS[toDef.continent].name})`;
        }

        // 2. Completing or expanding our target continent
        const cEval = contEvals[toDef.continent];
        if (cEval.enemyTerritories === 1 && cEval.myTerritories > 0) {
          strategicScore += 55 + CONTINENTS[toDef.continent].bonus * 8;
          minWinProb = 0.52;
          reason = `Vollende Kontinent ${CONTINENTS[toDef.continent].name}!`;
        } else if (cEval.attractiveness > 35) {
          strategicScore += cEval.attractiveness * 0.65;
          reason = `Expansion in ${CONTINENTS[toDef.continent].name}`;
        }

        // 3. Eliminating a player for their Risk cards!
        const enemyRemainingTerrs = state.getPlayerTerritories(
          toState.ownerId
        ).length;
        const enemyCards = state.players[toState.ownerId].cards.length;
        if (enemyRemainingTerrs === 1) {
          strategicScore += 80 + enemyCards * 20;
          minWinProb = 0.45;
          reason = `Vernichte ${state.players[toState.ownerId].name} (+${enemyCards} Karten)!`;
        } else if (enemyRemainingTerrs === 2 && fromState.troops >= toState.troops + 5) {
          strategicScore += 35 + enemyCards * 10;
        }

        // 4. First conquest of the turn to earn a Risk Card!
        if (!state.conqueredThisTurn) {
          strategicScore += 28;
          minWinProb = Math.min(minWinProb, 0.60);
          if (reason === 'Taktischer Vorstoß') {
            reason = 'Eroberung für Risiko-Karte';
          }
        } else {
          // Already got a card this turn: don't overextend unless the attack is strong or strategic
          minWinProb = Math.max(minWinProb, 0.68);
        }

        // 5. Check if attacking leaves `fromId` dangerously exposed if it guards an owned continent
        const ownedContinents = state.getPlayerContinents(player.id);
        if (
          ownedContinents.includes(fromDef.continent) &&
          toDef.continent !== fromDef.continent
        ) {
          // Launching an attack out of an owned continent choke-point:
          // Check other enemies adjacent to `fromId`
          let otherEnemyThreat = 0;
          for (const nId of fromDef.neighbors) {
            if (nId !== toId && state.territories[nId].ownerId !== player.id) {
              otherEnemyThreat += state.territories[nId].troops;
            }
          }
          const expectedRem = getExpectedRemainingMobileAttackers(
            fromState.troops,
            toState.troops
          );
          if (expectedRem < otherEnemyThreat + 2 && breakBonus === 0) {
            // Don't abandon our choke point unless we're breaking an enemy continent
            strategicScore -= 55;
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
   * Decides how many troops to move into a newly conquered territory (`toId`) from `fromId`.
   */
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

    // In 18 territories x 2+ troops mission, try to ensure both fromId and toId have >= 2 troops!
    if (
      state.gameMode === 'SECRET_MISSIONS' &&
      player.mission?.type === 'TERRITORIES_18_TROOPS_2'
    ) {
      // maxMove is (fromState.troops - 1). If we move <= maxMove - 1, fromId keeps >= 2 troops!
      const safeMaxForFrom = Math.max(minMove, maxMove - 1);
      if (!fromIsBorder) {
        return safeMaxForFrom;
      }
      if (!toIsBorder) {
        return Math.min(safeMaxForFrom, Math.max(minMove, 2));
      }
      return safeMaxForFrom;
    }

    // In CAPITALS mode, if `fromId` is a Capital and still borders enemies, keep at least 3 troops on it
    if (state.isCapitalTerritory(fromId) && fromIsBorder) {
      const capSafeMax = Math.max(minMove, maxMove - 2);
      if (!toIsBorder) return minMove;
      return capSafeMax;
    }

    // If `fromId` is now completely surrounded by friendly territories, move ALL troops forward!
    if (!fromIsBorder) {
      return maxMove;
    }

    // If `toId` has no adjacent enemies (e.g. dead-end corner like Eastern Australia or Argentina),
    // leave minimum troops in `toId` and keep the army on `fromId` border!
    if (!toIsBorder) {
      return minMove;
    }

    // Both are border territories: check if `toId` has further offensive targets this turn
    const fromThreat = this.getAdjacentEnemyThreat(state, fromId, player.id);
    const toThreat = this.getAdjacentEnemyThreat(state, toId, player.id);

    // Check if we want to keep attacking from `toId` right now
    const toDef = TERRITORY_MAP[toId];
    let hasGoodNextTargetFromTo = false;
    for (const nId of toDef.neighbors) {
      const nState = state.territories[nId];
      if (nState.ownerId !== player.id) {
        if (maxMove >= nState.troops + 2) {
          hasGoodNextTargetFromTo = true;
          break;
        }
      }
    }

    if (hasGoodNextTargetFromTo && fromThreat <= 2) {
      return Math.max(minMove, maxMove - 1);
    }

    // Otherwise balance proportionally to threat
    const totalAvailable = maxMove + 1; // including the 1 troop that stays at fromId
    const ratioTo = (toThreat + 2) / (fromThreat + toThreat + 4);
    const desiredTo = Math.round(totalAvailable * ratioTo);
    return Math.min(maxMove, Math.max(minMove, desiredTo));
  }

  /**
   * Chooses the best fortification move at the end of the turn:
   * Moves stranded interior armies (or low-threat surpluses) to the most critical border territory.
   */
  public static chooseFortification(state: GameState): AIFortifyDecision | null {
    const player = state.currentPlayer;
    const myTerrs = state.getPlayerTerritories(player.id);

    let bestMove: AIFortifyDecision | null = null;
    let bestGain = 8; // minimum threshold to bother fortifying

    for (const fromState of myTerrs) {
      if (fromState.troops <= 1) continue;

      const fromThreat = this.getAdjacentEnemyThreat(
        state,
        fromState.id,
        player.id
      );
      const fromIsBorder = state.isBorderTerritory(fromState.id);

      // How many surplus troops can leave `fromId` safely?
      const surplus = fromIsBorder
        ? Math.floor(fromState.troops - 1 - fromThreat * 0.9)
        : fromState.troops - 1;

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
        const toCont = TERRITORY_MAP[toState.id].continent;
        const ownedContinents = state.getPlayerContinents(player.id);
        const contBonusWeight = ownedContinents.includes(toCont)
          ? CONTINENTS[toCont].bonus * 5
          : 0;

        const gain =
          (toThreat - fromThreat) * 4 +
          surplus * 5 +
          contBonusWeight +
          (!fromIsBorder ? 25 : 0);

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
